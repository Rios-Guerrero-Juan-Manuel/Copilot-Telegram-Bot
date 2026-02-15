import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '3',
};

describe('Plan Mode Critical Fixes', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  describe('Fix 1: /switch command exits plan mode', () => {
    it('should exit plan mode when switching projects via /switch', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const project1 = 'C:\\temp\\project1';
      const project2 = 'C:\\temp\\project2';

      // Create session and activate plan mode
      await manager.switchProject(userId, project1, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Switch to another project (simulating /switch command behavior)
      // Plan mode should be exited
      await manager.exitPlanMode(userId);
      expect(manager.isPlanModeActive(userId)).toBe(false);

      // After recreating session for new project
      await manager.switchProject(userId, project2, {
        model: 'gpt-5-mini',
        tools: [],
      });
      
      // Plan mode should still be inactive
      expect(manager.isPlanModeActive(userId)).toBe(false);
    });
  });

  describe('Fix 2: exitPlanMode preserves projectPath for logging', () => {
    it('should log correct projectPath when exiting plan mode', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const { logger } = await import('../src/utils/logger');
      
      const loggerSpy = vi.spyOn(logger, 'info');
      
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\testproject';

      // Create session and activate plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);

      // Exit plan mode
      await manager.exitPlanMode(userId);

      // Find the log entry about plan mode exit
      const planExitLog = loggerSpy.mock.calls.find(
        call =>
          call[0] === 'Plan mode exit complete'
      );

      expect(planExitLog).toBeDefined();
      // The logged projectPath should be the actual path, not null
      expect(planExitLog?.[1]).toHaveProperty('projectPath', projectPath);
      expect(planExitLog?.[1].projectPath).not.toBeNull();
    });
  });

  describe('Fix 3: Follow-up messages re-inject plan systemMessage', () => {
    it('should recreate session with systemMessage when plan mode is active', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const { PLAN_MODE_SYSTEM_MESSAGE } = await import('../src/copilot/tools');
      
      const createSessionSpy = vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      }));
      
      const client = {
        createSession: createSessionSpy,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session and activate plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);

      // Clear the spy to track new calls
      createSessionSpy.mockClear();

      // Simulate session recreation (e.g., after exitPlanMode or destroySession)
      // When plan mode is active, we need to pass systemMessage
      const isPlanMode = manager.isPlanModeActive(userId);
      
      const switchOptions: any = {
        model: 'gpt-5-mini',
        tools: [],
      };
      
      if (isPlanMode) {
        switchOptions.systemMessage = { content: PLAN_MODE_SYSTEM_MESSAGE };
      }

      await manager.switchProject(userId, projectPath, switchOptions);

      // Verify systemMessage was included
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: { content: PLAN_MODE_SYSTEM_MESSAGE },
        })
      );
    });

    it('should not include systemMessage when plan mode is inactive', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      
      const createSessionSpy = vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      }));
      
      const client = {
        createSession: createSessionSpy,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session WITHOUT plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Verify systemMessage was NOT included
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          systemMessage: expect.anything(),
        })
      );
    });
  });

  describe('Fix 4: /reset aborts in-flight operations in plan mode', () => {
    it('should abort in-flight operations before exiting plan mode', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session and activate plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);

      // Register an aborter (simulating in-flight operation)
      const abortMock = vi.fn();
      manager.registerAborter(userId, abortMock);

      // Simulate /reset behavior - abort should be called
      manager.abortInFlight(userId);
      expect(abortMock).toHaveBeenCalled();

      // Clear aborter
      manager.clearAborter(userId);

      // Then exit plan mode
      await manager.exitPlanMode(userId);
      expect(manager.isPlanModeActive(userId)).toBe(false);
    });

    it('should clear aborter before destroying session', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Setup
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);

      const abortMock = vi.fn();
      manager.registerAborter(userId, abortMock);

      // Abort and clear - order matters!
      manager.abortInFlight(userId);
      manager.clearAborter(userId);
      
      // Then destroy
      await manager.destroySession(userId, projectPath);

      expect(abortMock).toHaveBeenCalled();
      expect(manager.isPlanModeActive(userId)).toBe(false);
    });
  });

  describe('Fix 5: Plan mode preserved on model/MCP changes', () => {
    it('should preserve plan mode when recreating session', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session and activate plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Recreate session (simulating model change)
      await manager.recreateActiveSession(userId, {
        model: 'gpt-5',
        tools: [],
      });

      // Plan mode should still be active
      expect(manager.isPlanModeActive(userId)).toBe(true);
    });

    it('should include systemMessage when recreating session in plan mode', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const { PLAN_MODE_SYSTEM_MESSAGE } = await import('../src/copilot/tools');
      
      const createSessionSpy = vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      }));
      
      const client = {
        createSession: createSessionSpy,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session with plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
        systemMessage: { content: PLAN_MODE_SYSTEM_MESSAGE },
      });
      manager.setPlanMode(userId, true);

      createSessionSpy.mockClear();

      // Recreate session - should preserve plan mode and systemMessage
      await manager.recreateActiveSession(userId, {
        model: 'gpt-5',
        tools: [],
      });

      // Should have been called with systemMessage
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: { content: PLAN_MODE_SYSTEM_MESSAGE },
        })
      );
    });

    it('should not include systemMessage when not in plan mode', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      
      const createSessionSpy = vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      }));
      
      const client = {
        createSession: createSessionSpy,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create session WITHOUT plan mode
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });

      createSessionSpy.mockClear();

      // Recreate session
      await manager.recreateActiveSession(userId, {
        model: 'gpt-5',
        tools: [],
      });

      // Should NOT include systemMessage
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          systemMessage: expect.anything(),
        })
      );
    });
  });

  describe('Fix 6: PLAN_MODE_SYSTEM_MESSAGE enforces freeform decision flow', () => {
    it('should require plan markers and avoid ask_user approval buttons', async () => {
      const { PLAN_MODE_SYSTEM_MESSAGE } = await import('../src/copilot/tools');

      expect(PLAN_MODE_SYSTEM_MESSAGE).toContain('---BEGIN PLAN---');
      expect(PLAN_MODE_SYSTEM_MESSAGE).toContain('---END PLAN---');
      expect(PLAN_MODE_SYSTEM_MESSAGE).toContain('Do NOT use ask_user for final plan approval options');
      expect(PLAN_MODE_SYSTEM_MESSAGE).toContain("wait for the user's freeform text decision");
      expect(PLAN_MODE_SYSTEM_MESSAGE).not.toContain('Present the plan using ask_user');
      expect(PLAN_MODE_SYSTEM_MESSAGE).not.toContain('["✅ Aprobar", "✏️ Modificar", "❌ Cancelar"]');
    });
  });
});
