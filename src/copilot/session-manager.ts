import { CopilotClient, CopilotSession, Tool, MCPServerConfig } from '@github/copilot-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';

interface SessionMetadata {
  session: CopilotSession;
  createdAt: Date;
  options?: SessionOptions; // Cache options for efficient recreation
}

interface UserSessions {
  activeProject: string | null;
  sessions: Map<string, SessionMetadata>;
  cancelled: Set<string>;
  planModeActive: boolean;
  currentPlanId: number | null;
  planModeExitPendingNotice: boolean;
}

interface SessionOptions {
  model: string;
  tools: Tool[];
  mcpServers?: Record<string, MCPServerConfig>;
  systemMessage?: { content: string };
  reasoningEffort?: 'medium' | 'high' | 'xhigh';
  onUserInputRequest?: (
    request: {
      question: string;
      choices?: string[];
      allowFreeform?: boolean;
    },
    invocation: { sessionId: string }
  ) => Promise<{ answer: string; wasFreeform: boolean }> | { answer: string; wasFreeform: boolean };
}

/**
 * Manages Copilot sessions for multiple users and projects
 */
export class SessionManager {
  private client: CopilotClient;
  private userSessions = new Map<string, UserSessions>();
  private inFlight = new Set<string>();
  private aborters = new Map<string, () => void>();
  private operationStartTimes = new Map<string, Date>();
  private timeouts = new Map<string, NodeJS.Timeout>();
  private timeoutCallbacks = new Map<string, () => void>();
  private originalTimeouts = new Map<string, number>();
  private timeoutExtensions = new Map<string, number>();

  constructor(client: CopilotClient) {
    this.client = client;
  }

  /**
   * Gets or creates the UserSessions object for a user
   * 
   * @param userId - User identifier
   * @returns UserSessions object containing all session data for the user
   */
  private getUserSessions(userId: string): UserSessions {
    const existing = this.userSessions.get(userId);
    if (existing) return existing;
    const created: UserSessions = { 
      activeProject: null, 
      sessions: new Map(), 
      cancelled: new Set(),
      planModeActive: false,
      currentPlanId: null,
      planModeExitPendingNotice: false,
    };
    this.userSessions.set(userId, created);
    return created;
  }

  /**
   * Switches to a different project or creates a new session
   * @param userId - User identifier
   * @param projectPath - Absolute path to project directory
   * @param options - Session configuration options
   * @returns Active Copilot session for the project
   */
  async switchProject(
    userId: string,
    projectPath: string,
    options: SessionOptions
  ): Promise<CopilotSession> {
    const user = this.getUserSessions(userId);
    const existing = user.sessions.get(projectPath);
    if (existing && !options.systemMessage) {
      user.activeProject = projectPath;
      logger.debug('Session switched to existing project', {
        userId,
        projectPath,
      });
      return existing.session;
    }

    if (existing) {
      logger.info('Destroying existing session for project', {
        userId,
        projectPath,
      });
      await existing.session.destroy();
      user.sessions.delete(projectPath);
    }

    if (user.sessions.size >= config.MAX_SESSIONS) {
      const entries = [...user.sessions.entries()];
      const oldest =
        entries.find(([path]) => path !== user.activeProject) ?? entries[0];
      if (oldest) {
        logger.info('Max sessions reached, destroying oldest session', {
          userId,
          oldestProjectPath: oldest[0],
          maxSessions: config.MAX_SESSIONS,
        });
        await oldest[1].session.destroy();
        user.sessions.delete(oldest[0]);
        if (user.activeProject === oldest[0]) {
          user.activeProject = null;
        }
      }
    }

    logger.info('Creating new session', sanitizeForLogging({
      userId,
      projectPath,
      model: options.model,
      toolsCount: options.tools.length,
      mcpServersCount: options.mcpServers ? Object.keys(options.mcpServers).length : 0,
      hasSystemMessage: !!options.systemMessage,
      hasUserInputHandler: !!options.onUserInputRequest,
    }));

    const session = await this.client.createSession({
      model: options.model,
      streaming: true,
      workingDirectory: projectPath,
      tools: options.tools,
      ...(options.systemMessage ? { systemMessage: options.systemMessage } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      ...(options.onUserInputRequest ? { onUserInputRequest: options.onUserInputRequest } : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      infiniteSessions: { enabled: true },
    });

    user.sessions.set(projectPath, {
      session,
      createdAt: new Date(),
      options, // Cache options for efficient recreation
    });
    user.activeProject = projectPath;
    
    logger.info('Session created successfully', {
      userId,
      projectPath,
      sessionCount: user.sessions.size,
    });
    
    return session;
  }

  /**
   * Gets the active Copilot session for a user
   * @param userId - User identifier
   * @returns Active session or undefined if none exists
   */
  getActiveSession(userId: string): CopilotSession | undefined {
    const user = this.userSessions.get(userId);
    if (!user?.activeProject) return undefined;
    const metadata = user.sessions.get(user.activeProject);
    return metadata?.session;
  }

  /**
   * Gets the active project path for a user
   * @param userId - User identifier
   * @returns Project path or null if no active project
   */
  getActiveProjectPath(userId: string): string | null {
    const user = this.userSessions.get(userId);
    return user?.activeProject ?? null;
  }

  /**
   * Recreates the active session with new options
   * @param userId - User identifier
   * @param options - Session configuration options
   * @returns Recreated session or undefined if no active project
   */
  async recreateActiveSession(
    userId: string,
    options: SessionOptions
  ): Promise<CopilotSession | undefined> {
    const active = this.getActiveProjectPath(userId);
    if (!active) return undefined;
    const user = this.getUserSessions(userId);
    
    const wasPlanModeActive = this.isPlanModeActive(userId);
    
    await this.destroySession(userId, active);
    
    const recreateOptions = { ...options };
    if (wasPlanModeActive) {
      const { PLAN_MODE_SYSTEM_MESSAGE } = await import('./tools');
      recreateOptions.systemMessage = { content: PLAN_MODE_SYSTEM_MESSAGE };
      
      logger.info('Recreating session with plan mode preserved', {
        userId,
        projectPath: active,
      });
    }
    
    const session = await this.switchProject(userId, active, recreateOptions);
    
    if (wasPlanModeActive) {
      this.setPlanMode(userId, true);
    }
    
    return session;
  }

  /**
   * Destroys a specific session for a user
   * @param userId - User identifier
   * @param projectPath - Path of the project session to destroy
   */
  async destroySession(userId: string, projectPath: string): Promise<void> {
    const user = this.userSessions.get(userId);
    const metadata = user?.sessions.get(projectPath);
    if (metadata) {
      logger.info('Destroying session', {
        userId,
        projectPath,
        sessionAge: Date.now() - metadata.createdAt.getTime(),
      });
      await metadata.session.destroy();
      user?.sessions.delete(projectPath);
      user?.cancelled.delete(projectPath);
      if (user && user.activeProject === projectPath) {
        user.activeProject = null;
        user.planModeActive = false;
        user.currentPlanId = null;
        user.planModeExitPendingNotice = false;
      }
      logger.info('Session destroyed successfully', {
        userId,
        projectPath,
      });
    }
  }

  /**
   * Destroys all sessions for all users
   */
  async destroyAll(): Promise<void> {
    for (const [, user] of this.userSessions) {
      for (const [, metadata] of user.sessions) {
        await metadata.session.destroy();
      }
      user.planModeActive = false;
    }
    this.userSessions.clear();
  }

  /**
   * Clears all sessions (alias for destroyAll)
   */
  async clearAll(): Promise<void> {
    await this.destroyAll();
  }

  /**
   * Lists all sessions for a user
   * @param userId - User identifier
   * @returns Array of session info with paths and active status
   */
  listSessions(userId: string): Array<{ path: string; active: boolean }> {
    const user = this.userSessions.get(userId);
    if (!user) return [];
    return [...user.sessions.keys()].map((path) => ({
      path,
      active: path === user.activeProject,
    }));
  }

  /**
   * Lists all sessions for a user with creation timestamps
   * @param userId - User identifier
   * @returns Array of session info with paths, active status, and timestamps
   */
  getSessionsWithTimestamps(userId: string): Array<{ 
    path: string; 
    active: boolean; 
    createdAt: Date;
  }> {
    const user = this.userSessions.get(userId);
    if (!user) return [];
    return [...user.sessions.entries()].map(([path, metadata]) => ({
      path,
      active: path === user.activeProject,
      createdAt: metadata.createdAt,
    }));
  }

  /**
   * Checks if a user has an active operation in progress
   * @param userId - User identifier
   * @returns true if user is busy, false otherwise
   */
  isBusy(userId: string): boolean {
    return this.inFlight.has(userId);
  }

  /**
   * Sets the busy status for a user
   * @param userId - User identifier
   * @param busy - Whether the user should be marked as busy
   */
  setBusy(userId: string, busy: boolean): void {
    if (busy) {
      this.inFlight.add(userId);
      this.operationStartTimes.set(userId, new Date());
    } else {
      this.inFlight.delete(userId);
      this.operationStartTimes.delete(userId);
      this.clearTimeout(userId);
      this.timeoutExtensions.delete(userId);
    }
  }

  /**
   * Gets the start time of the current operation
   * @param userId - User identifier
   * @returns Start time or null if no operation is running
   */
  getOperationStartTime(userId: string): Date | null {
    return this.operationStartTimes.get(userId) ?? null;
  }

  /**
   * Gets elapsed time for the current operation in milliseconds
   * @param userId - User identifier
   * @returns Elapsed time in milliseconds or null if no operation is running
   */
  getOperationElapsedMs(userId: string): number | null {
    const startTime = this.operationStartTimes.get(userId);
    if (!startTime) return null;
    return Date.now() - startTime.getTime();
  }

  /**
   * Lists model IDs currently available in Copilot CLI.
   *
   * Returns an empty list when the catalog cannot be fetched.
   */
  async listAvailableModels(): Promise<string[]> {
    try {
      const models = await this.client.listModels();
      return models
        .map((model) => model.id)
        .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.length > 0);
    } catch (error: any) {
      logger.warn('Failed to list available models from Copilot SDK', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Registers an aborter function for cancelling operations
   * @param userId - User identifier
   * @param aborter - Function to call when aborting the operation
   */
  registerAborter(userId: string, aborter: () => void): void {
    this.aborters.set(userId, aborter);
  }

  /**
   * Clears the registered aborter for a user
   * @param userId - User identifier
   */
  clearAborter(userId: string): void {
    this.aborters.delete(userId);
  }

  /**
   * Aborts the current in-flight operation for a user
   * @param userId - User identifier
   */
  abortInFlight(userId: string): void {
    const aborter = this.aborters.get(userId);
    if (aborter) aborter();
  }

  /**
   * Cancels the active session immediately using SDK's abort() method
   * 
   * Marks the session as cancelled to prevent race conditions before aborting.
   * 
   * @param userId - User identifier
   * @returns true if cancellation was successful, false otherwise
   */
  async cancelActiveSession(userId: string): Promise<boolean> {
    const user = this.getUserSessions(userId);
    const activePath = user.activeProject;
    
    if (!activePath) return false;
    
    const metadata = user.sessions.get(activePath);
    if (!metadata) return false;

    user.cancelled.add(activePath);

    try {
      await metadata.session.abort();
      return true;
    } catch (error: any) {
      user.cancelled.delete(activePath);
      return false;
    }
  }

  /**
   * Checks if a session path is marked as cancelled
   * @param userId - User identifier
   * @param projectPath - Project path to check
   * @returns true if the session is cancelled, false otherwise
   */
  isCancelled(userId: string, projectPath: string): boolean {
    const user = this.userSessions.get(userId);
    return user?.cancelled.has(projectPath) ?? false;
  }

  /**
   * Clears the cancelled flag for a session
   * @param userId - User identifier
   * @param projectPath - Project path to clear
   */
  clearCancelled(userId: string, projectPath: string): void {
    const user = this.userSessions.get(userId);
    user?.cancelled.delete(projectPath);
  }

  /**
   * Marks a session as cancelled
   * @param userId - User identifier
   * @param projectPath - Project path to mark as cancelled
   */
  setCancelled(userId: string, projectPath: string): void {
    const user = this.getUserSessions(userId);
    user.cancelled.add(projectPath);
  }

  /**
   * Starts a timeout for a user operation
   * 
   * @param userId - The user ID
   * @param timeoutMs - Timeout duration in milliseconds
   * @param callback - Function to call when timeout expires
   */
  startTimeout(userId: string, timeoutMs: number, callback: () => void): void {
    this.clearTimeout(userId);

    logger.debug('Starting operation timeout', {
      userId,
      timeoutMs,
    });

    this.originalTimeouts.set(userId, timeoutMs);
    this.timeoutCallbacks.set(userId, callback);
    this.timeoutExtensions.set(userId, 0);

    const timeout = setTimeout(callback, timeoutMs);
    this.timeouts.set(userId, timeout);
  }

  /**
   * Clears the timeout for a user
   * @param userId - The user ID
   */
  clearTimeout(userId: string): void {
    const timeout = this.timeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(userId);
    }
    this.timeoutCallbacks.delete(userId);
    this.originalTimeouts.delete(userId);
  }

  /**
   * Extends the timeout for a running operation
   * 
   * Calculates remaining time based on original timeout plus total extensions
   * minus elapsed time, then reschedules the timeout.
   * 
   * @param userId - The user ID
   * @param extensionMs - Additional time in milliseconds to extend
   * @returns true if successful, false if no active timeout or user not busy
   */
  extendTimeout(userId: string, extensionMs: number): boolean {
    if (!this.isBusy(userId)) {
      return false;
    }

    const existingTimeout = this.timeouts.get(userId);
    const callback = this.timeoutCallbacks.get(userId);
    const originalTimeout = this.originalTimeouts.get(userId);
    
    if (!existingTimeout || !callback || originalTimeout === undefined) {
      return false;
    }

    const startTime = this.operationStartTimes.get(userId);
    if (!startTime) {
      return false;
    }

    const elapsedMs = Date.now() - startTime.getTime();
    
    const currentExtension = this.timeoutExtensions.get(userId) ?? 0;
    const newExtension = currentExtension + extensionMs;
    this.timeoutExtensions.set(userId, newExtension);

    const totalTimeout = originalTimeout + newExtension;
    const remainingTime = Math.max(0, totalTimeout - elapsedMs);

    clearTimeout(existingTimeout);
    this.timeouts.delete(userId);

    const newTimeout = setTimeout(callback, remainingTime);
    this.timeouts.set(userId, newTimeout);

    return true;
  }

  /**
   * Gets the total timeout extensions for a user
   * @param userId - The user ID
   * @returns Total extension time in milliseconds, or 0 if none
   */
  getTimeoutExtension(userId: string): number {
    return this.timeoutExtensions.get(userId) ?? 0;
  }

  /**
   * Gets the original timeout value for a user
   * @param userId - The user ID
   * @returns Original timeout in milliseconds, or null if no timeout
   */
  getOriginalTimeout(userId: string): number | null {
    const timeout = this.originalTimeouts.get(userId);
    return timeout !== undefined ? timeout : null;
  }

  /**
   * Checks if user is in plan mode
   * @param userId - The user ID
   * @returns true if plan mode is active, false otherwise
   */
  isPlanModeActive(userId: string): boolean {
    const user = this.userSessions.get(userId);
    return user?.planModeActive ?? false;
  }

  /**
   * Checks if user is in plan mode (alias for isPlanModeActive)
   * @param userId - User identifier
   * @returns true if plan mode is active, false otherwise
   */
  isPlanMode(userId: string): boolean {
    return this.isPlanModeActive(userId);
  }

  /**
   * Sets plan mode state for a user
   * @param userId - The user ID
   * @param active - Whether plan mode should be active
   * @param planId - Optional plan ID to associate with plan mode
   */
  setPlanMode(userId: string, active: boolean, planId?: number): void {
    const user = this.getUserSessions(userId);
    user.planModeActive = active;
    if (active) {
      user.planModeExitPendingNotice = false;
    }
    
    if (planId !== undefined) {
      user.currentPlanId = planId;
    }
    
    logger.info('Plan mode state changed', {
      userId,
      active,
      planId: planId ?? user.currentPlanId,
    });
  }

  /**
   * Gets the current plan ID for a user
   * @param userId - The user ID
   * @returns Plan ID or null if no plan is active
   */
  getCurrentPlanId(userId: string): number | null {
    const user = this.userSessions.get(userId);
    return user?.currentPlanId ?? null;
  }

  /**
   * Sets the current plan ID for a user
   * @param userId - The user ID
   * @param planId - The plan ID
   */
  setCurrentPlanId(userId: string, planId: number): void {
    const user = this.getUserSessions(userId);
    user.currentPlanId = planId;
    
    logger.info('Current plan ID set', {
      userId,
      planId,
    });
  }

  /**
   * Clears the current plan ID for a user
   * @param userId - The user ID
   */
  clearCurrentPlanId(userId: string): void {
    const user = this.userSessions.get(userId);
    if (!user) return;
    
    const previousPlanId = user.currentPlanId;
    user.currentPlanId = null;
    
    logger.info('Current plan ID cleared', {
      userId,
      previousPlanId,
    });
  }

  /**
   * Consumes the pending "plan mode OFF" marker for the next prompt.
   *
   * @param userId - The user ID
   * @returns true if there was a pending marker, false otherwise
   */
  consumePlanModeExitPendingNotice(userId: string): boolean {
    const user = this.userSessions.get(userId);
    if (!user?.planModeExitPendingNotice) return false;
    user.planModeExitPendingNotice = false;
    return true;
  }

  /**
   * Exits plan mode by clearing flags while preserving the active session context.
   * 
   * @param userId - The user ID
   */
  async exitPlanMode(userId: string): Promise<void> {
    const user = this.userSessions.get(userId);
    
    if (!user) {
      logger.debug('exitPlanMode called for user with no sessions', { userId });
      return;
    }

    user.planModeActive = false;
    const previousPlanId = user.currentPlanId;
    user.currentPlanId = null;
    user.planModeExitPendingNotice = true;
    
    logger.info('Exiting plan mode', {
      userId,
      hasActiveProject: !!user.activeProject,
      previousPlanId,
      contextPreserved: !!user.activeProject,
    });

    if (user.activeProject) {
      logger.info('Plan mode exit complete', {
        userId,
        projectPath: user.activeProject,
        previousPlanId,
        sessionDestroyed: false,
      });
    }
  }
}
