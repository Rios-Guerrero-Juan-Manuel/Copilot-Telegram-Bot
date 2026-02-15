import { ServerManagementService, AddServerParams } from './server-management';
import { logger } from '../utils/logger';
import { WIZARD_TIMEOUT_MS } from '../constants';
import { parseEnvVariables, formatParseError } from './env-parser';
import { escapeHtml } from '../utils/formatter';
import { i18n } from '../i18n/index.js';

export enum WizardStep {
  NAME = 'name',
  TYPE = 'type',
  COMMAND = 'command',
  ARGS = 'args',
  ENV = 'env',
  URL = 'url',
  CONFIRM = 'confirm',
  CONFIRM_DANGEROUS = 'confirm_dangerous',
}

interface WizardSession {
  userId: number;
  step: WizardStep;
  data: Partial<AddServerParams>;
  lastActivity: number;
  dangerousArgsInfo?: {
    flags: string[];
    fullCommand: string;
  };
  initialArgs?: string[]; // Args extracted from command input
}

export interface WizardResult {
  success: boolean;
  message: string;
  step?: WizardStep;
  complete?: boolean;
  cancelled?: boolean;
}

export interface WizardStatus {
  step: WizardStep;
  data: Partial<AddServerParams>;
}

const WIZARD_TIMEOUT = WIZARD_TIMEOUT_MS;
const CANCEL_KEYWORDS = ['cancelar', 'cancel', 'salir', 'exit', 'quit'];

/**
 * Interactive wizard for MCP server configuration
 * 
 * Provides a step-by-step guided flow for users to configure MCP servers
 * through Telegram. Handles both stdio and HTTP server types with validation
 * at each step.
 * 
 * Wizard Steps:
 * 1. NAME - Server name
 * 2. TYPE - stdio or http
 * 3. COMMAND/URL - Executable path or HTTP endpoint
 * 4. ARGS - Command arguments (stdio only)
 * 5. ENV - Environment variables (optional)
 * 6. CONFIRM - Review and confirm configuration
 * 7. CONFIRM_DANGEROUS - Confirm dangerous arguments (if detected)
 * 
 * Sessions automatically timeout after inactivity.
 * 
 * @example
 * const wizard = new ServerWizard(serverManagementService);
 * const result = wizard.startWizard(userId);
 * await sendMessage(result.message);
 * // User provides input...
 * const nextResult = await wizard.handleInput(userId, userInput);
 */
export class ServerWizard {
  private sessions = new Map<number, WizardSession>();
  private cleanupTimers = new Map<number, NodeJS.Timeout>();

  private readonly WIZARD_TTL_MS = WIZARD_TIMEOUT_MS;

  constructor(private serverService: ServerManagementService) {}

  /**
   * Gets the underlying ServerManagementService instance
   * 
   * @returns The server management service
   */
  getService(): ServerManagementService {
    return this.serverService;
  }

  /**
   * Starts a new wizard session for a user
   * 
   * Creates a new wizard session starting at the NAME step. If a session
   * already exists for the user, returns an error.
   * 
   * @param userId - The user's Telegram ID
   * @returns Result indicating success or failure with initial prompt message
   */
  startWizard(userId: number): WizardResult {
    if (this.sessions.has(userId)) {
      return {
        success: false,
        message: i18n.t(userId, 'mcpWizard.alreadyActive'),
      };
    }

    this.sessions.set(userId, {
      userId,
      step: WizardStep.NAME,
      data: {},
      lastActivity: Date.now(),
    });

    this.scheduleCleanup(userId);

    logger.info('Wizard started', { userId });

    return {
      success: true,
      message: this.getStepMessage(userId, WizardStep.NAME),
      step: WizardStep.NAME,
    };
  }

  /**
   * Processes user input for the current wizard step
   * 
   * Validates and processes the input according to the current step,
   * then advances to the next step or completes the wizard.
   * Supports cancellation keywords at any step.
   * 
   * @param userId - The user's Telegram ID
   * @param input - User's text input
   * @returns Result with next step message or completion status
   */
  handleInput(userId: number, input: string): WizardResult {
    const session = this.sessions.get(userId);
    
    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'mcpWizard.noActiveSession'),
      };
    }

    // Check for timeout
    if (Date.now() - session.lastActivity > WIZARD_TIMEOUT) {
      this.cleanupSession(userId);
      return {
        success: false,
        message: i18n.t(userId, 'mcpWizard.sessionExpired'),
      };
    }

    session.lastActivity = Date.now();
    this.scheduleCleanup(userId);

    if (CANCEL_KEYWORDS.includes(input.toLowerCase().trim())) {
      this.cleanupSession(userId);
      return {
        success: true,
        cancelled: true,
        message: i18n.t(userId, 'wizards.mcp.cancelled'),
      };
    }

    const result = this.processStep(session, input);
    
    if (result.success && !result.complete) {
      this.sessions.set(userId, session);
    }

    if (result.complete || result.cancelled) {
      this.cleanupSession(userId);
    }

    return result;
  }

  /**
   * Cancels an active wizard session
   * 
   * @param userId - The user's Telegram ID
   * @returns Result with cancellation message
   */
  cancelWizard(userId: number): WizardResult {
    const session = this.sessions.get(userId);
    
    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'mcpWizard.noActiveWizard'),
      };
    }

    this.cleanupSession(userId);
    logger.info('Wizard cancelled', { userId });

    return {
      success: true,
      message: i18n.t(userId, 'wizards.mcp.cancelled'),
    };
  }

  /**
   * Gets the status of current wizard session
   * 
   * @param userId - The user's Telegram ID
   * @returns Current wizard status or undefined if no active session
   */
  getStatus(userId: number): WizardStatus | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;

    return {
      step: session.step,
      data: session.data,
    };
  }

  /**
   * Processes input for the current step
   * 
   * @param session - Current wizard session
   * @param input - User's trimmed input
   * @returns Result for the step processing
   */
  private processStep(session: WizardSession, input: string): WizardResult {
    const trimmedInput = input.trim();

    switch (session.step) {
      case WizardStep.NAME:
        return this.processName(session, trimmedInput);
      
      case WizardStep.TYPE:
        return this.processType(session, trimmedInput);
      
      case WizardStep.COMMAND:
        return this.processCommand(session, trimmedInput);
      
      case WizardStep.ARGS:
        return this.processArgs(session, trimmedInput);
      
      case WizardStep.ENV:
        return this.processEnv(session, trimmedInput);
      
      case WizardStep.URL:
        return this.processUrl(session, trimmedInput);
      
      case WizardStep.CONFIRM:
        return this.processConfirm(session, trimmedInput);
      
      case WizardStep.CONFIRM_DANGEROUS:
        return this.processConfirmDangerous(session, trimmedInput);
      
      default:
        return {
          success: false,
          message: i18n.t(session.userId, 'mcpWizard.invalidState'),
        };
    }
  }

  /**
   * Processes the NAME step input
   * 
   * @param session - Current wizard session
   * @param name - Server name input
   * @returns Processing result
   */
  private processName(session: WizardSession, name: string): WizardResult {
    if (!name || name.trim() === '') {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.nameEmpty') + ' ' + this.getStepMessage(session.userId, WizardStep.NAME),
        step: WizardStep.NAME,
      };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.invalidName') + ' ' + this.getStepMessage(session.userId, WizardStep.NAME),
        step: WizardStep.NAME,
      };
    }

    session.data.name = name;
    session.step = WizardStep.TYPE;

    return {
      success: true,
      message: this.getStepMessage(session.userId, WizardStep.TYPE),
      step: WizardStep.TYPE,
    };
  }

  /**
   * Processes the TYPE step input
   * 
   * @param session - Current wizard session
   * @param type - Server type input
   * @returns Processing result
   */
  private processType(session: WizardSession, type: string): WizardResult {
    if (type === '1' || type.toLowerCase() === 'stdio') {
      session.data.type = 'stdio';
      session.step = WizardStep.COMMAND;
      return {
        success: true,
        message: this.getStepMessage(session.userId, WizardStep.COMMAND),
        step: WizardStep.COMMAND,
      };
    } else if (type === '2' || type.toLowerCase() === 'http') {
      session.data.type = 'http';
      session.step = WizardStep.URL;
      return {
        success: true,
        message: this.getStepMessage(session.userId, WizardStep.URL),
        step: WizardStep.URL,
      };
    } else {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.invalidType') + ' ' + this.getStepMessage(session.userId, WizardStep.TYPE),
        step: WizardStep.TYPE,
      };
    }
  }

  /**
   * Processes the COMMAND step input
   * 
   * Parses the command input to handle cases where user provides full command with args
   * (e.g., "node server.js --port 3000" or "npx -y @modelcontextprotocol/server").
   * 
   * @param session - Current wizard session
   * @param command - Command input
   * @returns Processing result
   */
  private processCommand(session: WizardSession, command: string): WizardResult {
    if (!command || command.trim() === '') {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.commandEmpty') + ' ' + this.getStepMessage(session.userId, WizardStep.COMMAND),
        step: WizardStep.COMMAND,
      };
    }

    const tokens = this.parseArgs(command.trim());
    
    if (tokens.length === 0) {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.commandEmpty') + ' ' + this.getStepMessage(session.userId, WizardStep.COMMAND),
        step: WizardStep.COMMAND,
      };
    }

    session.data.command = tokens[0];
    
    if (tokens.length > 1) {
      session.initialArgs = tokens.slice(1);
    } else {
      session.initialArgs = undefined;
    }

    session.step = WizardStep.ARGS;

    return {
      success: true,
      message: this.getStepMessage(session.userId, WizardStep.ARGS),
      step: WizardStep.ARGS,
    };
  }

  /**
   * Parses command-line arguments respecting quoted strings
   * 
   * Handles both single and double quotes, and escaped quotes within strings.
   * Backslash acts as escape only when preceding \, ", or ' (context-aware).
   * 
   * Special handling for Windows paths ending in backslash within quotes:
   * "C:\\Folder\\" -> C:\Folder\ (trailing backslash preserved, quote closes)
   * 
   * @param input - Command string to parse
   * @returns Array of parsed arguments
   */
  private parseArgs(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (char === '\\') {
        const nextChar = i + 1 < input.length ? input[i + 1] : null;
        
        const escapableChars = inQuote 
          ? ['\\', inQuote]
          : ['\\', '"', "'"];
        
        if (nextChar && escapableChars.includes(nextChar)) {
          if (inQuote && nextChar === '\\' && i + 2 < input.length && input[i + 2] === inQuote) {
            current += '\\';
            i++;
            continue;
          }
          
          current += nextChar;
          i++;
          continue;
        } else {
          current += char;
          continue;
        }
      }

      if (char === '"' || char === "'") {
        if (inQuote === char) {
          inQuote = null;
        } else if (inQuote === null) {
          inQuote = char;
        } else {
          current += char;
        }
        continue;
      }

      if (char === ' ' && inQuote === null) {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }

  /**
   * Processes the ARGS step input
   * 
   * @param session - Current wizard session
   * @param args - Arguments input
   * @returns Processing result
   */
  private processArgs(session: WizardSession, args: string): WizardResult {
    let finalArgs: string[] = session.initialArgs ? [...session.initialArgs] : [];
    
    if (args && args.trim() !== '') {
      const userArgs = this.parseArgs(args);
      finalArgs = [...finalArgs, ...userArgs];
    }
    
    session.data.args = finalArgs;

    session.step = WizardStep.ENV;

    return {
      success: true,
      message: this.getStepMessage(session.userId, WizardStep.ENV),
      step: WizardStep.ENV,
    };
  }

  /**
   * Processes the ENV step input
   * 
   * @param session - Current wizard session
   * @param env - Environment variables input
   * @returns Processing result
   */
  private processEnv(session: WizardSession, env: string): WizardResult {
    if (env && env.trim() !== '' && env !== '-') {
      try {
        const envVars = parseEnvVariables(env);

        if (Object.keys(envVars).length > 0) {
          session.data.env = envVars;
          
          logger.debug('Environment variables parsed successfully', {
            userId: session.userId,
            count: Object.keys(envVars).length,
            keys: Object.keys(envVars)
          });
        }
      } catch (error) {
        const errorMessage = formatParseError(error);
        
        logger.warn('Failed to parse environment variables', {
          userId: session.userId,
          input: env,
          error: error instanceof Error ? error.message : String(error)
        });
        
        return {
          success: false,
          message: `${errorMessage}\n\n` + i18n.t(session.userId, 'mcpWizard.envParseHelp'),
          step: session.step,
        };
      }
    }

    if (session.data.type === 'stdio' && session.data.command) {
      const dangerousCheck = this.serverService.detectDangerousArguments(
        session.data.command,
        session.data.args
      );

      if (dangerousCheck.isDangerous) {
        session.dangerousArgsInfo = {
          flags: dangerousCheck.dangerousFlags,
          fullCommand: dangerousCheck.fullCommand || '',
        };

        session.step = WizardStep.CONFIRM_DANGEROUS;

        logger.info('Dangerous arguments detected in wizard', {
          userId: session.userId,
          serverName: session.data.name,
          flags: dangerousCheck.dangerousFlags,
          fullCommand: dangerousCheck.fullCommand,
        });

        return {
          success: true,
          message: this.buildDangerousArgsMessage(session.userId, dangerousCheck.dangerousFlags, dangerousCheck.fullCommand || ''),
          step: WizardStep.CONFIRM_DANGEROUS,
        };
      }
    }

    session.step = WizardStep.CONFIRM;

    return {
      success: true,
      message: this.getStepMessage(session.userId, WizardStep.CONFIRM, session.data),
      step: WizardStep.CONFIRM,
    };
  }

  private processUrl(session: WizardSession, url: string): WizardResult {
    if (!url || url.trim() === '') {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.urlEmpty') + ' ' + this.getStepMessage(session.userId, WizardStep.URL),
        step: WizardStep.URL,
      };
    }

    try {
      new URL(url);
    } catch {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.invalidUrl') + ' ' + this.getStepMessage(session.userId, WizardStep.URL),
        step: WizardStep.URL,
      };
    }

    session.data.url = url;
    session.step = WizardStep.CONFIRM;

    return {
      success: true,
      message: this.getStepMessage(session.userId, WizardStep.CONFIRM, session.data),
      step: WizardStep.CONFIRM,
    };
  }

  /**
   * Processes the CONFIRM step input
   * 
   * @param session - Current wizard session
   * @param confirm - Confirmation input
   * @returns Processing result
   */
  private processConfirm(session: WizardSession, confirm: string): WizardResult {
    const confirmLower = confirm.toLowerCase();
    
    if (confirmLower === 'si' || confirmLower === 'yes' || confirmLower === 's' || confirmLower === 'y') {
      const result = this.serverService.addServer(session.data as AddServerParams);
      
      if (result.success) {
        let message = i18n.t(session.userId, 'wizards.mcp.created', { name: escapeHtml(session.data.name || '') });
        if (result.warnings && result.warnings.length > 0) {
          message += '\n\n' + result.warnings.map(escapeHtml).join('\n');
        }
        
        return {
          success: true,
          complete: true,
          message,
        };
      } else {
        return {
          success: false,
          message: i18n.t(session.userId, 'mcpWizard.errorCreatingServer', { error: escapeHtml(result.error || '') }),
          step: WizardStep.CONFIRM,
        };
      }
    } else if (confirmLower === 'no' || confirmLower === 'n') {
      return {
        success: true,
        cancelled: true,
        message: i18n.t(session.userId, 'wizards.mcp.cancelled'),
      };
    } else {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.invalidConfirmation') + ' ' + this.getStepMessage(session.userId, WizardStep.CONFIRM, session.data),
        step: WizardStep.CONFIRM,
      };
    }
  }

  /**
   * Processes the CONFIRM_DANGEROUS step input
   * 
   * @param session - Current wizard session
   * @param confirm - Confirmation input
   * @returns Processing result
   */
  private processConfirmDangerous(session: WizardSession, confirm: string): WizardResult {
    const confirmLower = confirm.toLowerCase();
    
    if (confirmLower === 'confirmar') {
      logger.info('User confirmed dangerous arguments in wizard', {
        userId: session.userId,
        serverName: session.data.name,
        flags: session.dangerousArgsInfo?.flags,
        fullCommand: session.dangerousArgsInfo?.fullCommand,
        decision: 'confirmed',
      });

      const paramsWithConfirmation: AddServerParams = {
        ...session.data as AddServerParams,
        confirmDangerousArgs: true,
      };

      const result = this.serverService.addServer(paramsWithConfirmation);
      
      if (result.success) {
        let message = i18n.t(session.userId, 'wizards.mcp.created', { name: escapeHtml(session.data.name || '') });
        if (result.warnings && result.warnings.length > 0) {
          message += '\n\n' + result.warnings.map(escapeHtml).join('\n');
        }
        
        return {
          success: true,
          complete: true,
          message,
        };
      } else {
        return {
          success: false,
          message: i18n.t(session.userId, 'mcpWizard.errorCreatingServer', { error: escapeHtml(result.error || '') }),
          step: WizardStep.CONFIRM_DANGEROUS,
        };
      }
    } else if (confirmLower === 'cancelar') {
      logger.info('User cancelled dangerous arguments in wizard', {
        userId: session.userId,
        serverName: session.data.name,
        flags: session.dangerousArgsInfo?.flags,
        fullCommand: session.dangerousArgsInfo?.fullCommand,
        decision: 'cancelled',
      });

      return {
        success: true,
        cancelled: true,
        message: i18n.t(session.userId, 'mcpWizard.operationCancelled'),
      };
    } else {
      return {
        success: false,
        message: i18n.t(session.userId, 'mcpWizard.confirmDangerousInvalid'),
        step: WizardStep.CONFIRM_DANGEROUS,
      };
    }
  }

  /**
   * Gets the appropriate message for a given wizard step
   * 
   * @param userId - The user's Telegram ID
   * @param step - The wizard step
   * @param data - Optional server data for CONFIRM step
   * @returns Message text for the step
   */
  private getStepMessage(userId: number, step: WizardStep, data?: Partial<AddServerParams>): string {
    switch (step) {
      case WizardStep.NAME:
        return i18n.t(userId, 'mcpWizard.enterName');
      
      case WizardStep.TYPE:
        return i18n.t(userId, 'mcpWizard.selectType');
      
      case WizardStep.COMMAND:
        return i18n.t(userId, 'mcpWizard.enterCommand');
      
      case WizardStep.ARGS:
        return i18n.t(userId, 'mcpWizard.enterArgs');
      
      case WizardStep.ENV:
        return i18n.t(userId, 'mcpWizard.enterEnv');
      
      case WizardStep.URL:
        return i18n.t(userId, 'mcpWizard.enterUrl');
      
      case WizardStep.CONFIRM:
        return this.buildConfirmMessage(userId, data);
      
      default:
        return '';
    }
  }

  /**
   * Builds the confirmation message with server configuration summary
   * 
   * @param userId - The user's Telegram ID
   * @param data - Server configuration data
   * @returns Formatted confirmation message
   */
  private buildConfirmMessage(userId: number, data?: Partial<AddServerParams>): string {
    if (!data) return '';

    const type = data.type === 'stdio' ? i18n.t(userId, 'mcp.types.stdio') : i18n.t(userId, 'mcp.types.http');
    let details = '';

    if (data.type === 'stdio') {
      const args = data.args && data.args.length > 0 ? data.args.map(escapeHtml).join(' ') : i18n.t(userId, 'common.none');
      const env = data.env && Object.keys(data.env).length > 0 
        ? Object.entries(data.env).map(([k, v]) => `   - ${escapeHtml(k)}=${escapeHtml(v)}`).join('\n')
        : i18n.t(userId, 'common.none');
      
      details = i18n.t(userId, 'mcpWizard.detailsStdio', {
        command: escapeHtml(data.command || ''),
        args,
        env: data.env && Object.keys(data.env).length > 0 ? '\n' + env : env
      });
    } else {
      details = i18n.t(userId, 'mcpWizard.detailsHttp', {
        url: escapeHtml(data.url || '')
      });
    }

    return i18n.t(userId, 'mcpWizard.confirmSummary', {
      current: '6',
      name: escapeHtml(data.name || ''),
      type,
      details
    });
  }

  /**
   * Builds security warning message for dangerous arguments
   * 
   * @param userId - The user's Telegram ID
   * @param flags - Dangerous flags detected
   * @param fullCommand - Full command string
   * @returns Formatted security warning message
   */
  private buildDangerousArgsMessage(userId: number, flags: string[], fullCommand: string): string {
    return i18n.t(userId, 'mcpWizard.confirmDangerous', {
      flags: flags.map(escapeHtml).join(', '),
      command: escapeHtml(fullCommand),
      warning: i18n.t(userId, 'serverManagement.securityRecommendation')
    });
  }

  /**
   * Schedules automatic cleanup after TTL expires
   * 
   * @param userId - The user ID
   */
  private scheduleCleanup(userId: number): void {
    const existingTimer = this.cleanupTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const session = this.sessions.get(userId);
      if (!session) return;

      const elapsed = Date.now() - session.lastActivity;
      if (elapsed >= this.WIZARD_TTL_MS) {
        logger.info('Wizard session cleaned up due to TTL expiration', {
          userId,
          ttlMs: this.WIZARD_TTL_MS,
          elapsedMs: elapsed,
        });
        this.cleanupSession(userId);
      }
    }, this.WIZARD_TTL_MS);

    this.cleanupTimers.set(userId, timer);
  }

  /**
   * Cleans up session data and timers
   * 
   * @param userId - The user ID
   */
  private cleanupSession(userId: number): void {
    this.sessions.delete(userId);
    
    const timer = this.cleanupTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(userId);
    }
  }
}
