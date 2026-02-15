import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '3',
};

describe('Plan Mode State Management', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  describe('SessionManager plan mode tracking', () => {
    it('should track plan mode state per user', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';

      // Initially, plan mode should be inactive
      expect(manager.isPlanModeActive(userId)).toBe(false);

      // Activate plan mode
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Deactivate plan mode
      manager.setPlanMode(userId, false);
      expect(manager.isPlanModeActive(userId)).toBe(false);
    }, 10000);

    it('should handle multiple users independently', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const user1 = 'user1';
      const user2 = 'user2';

      manager.setPlanMode(user1, true);
      expect(manager.isPlanModeActive(user1)).toBe(true);
      expect(manager.isPlanModeActive(user2)).toBe(false);

      manager.setPlanMode(user2, true);
      expect(manager.isPlanModeActive(user1)).toBe(true);
      expect(manager.isPlanModeActive(user2)).toBe(true);

      manager.setPlanMode(user1, false);
      expect(manager.isPlanModeActive(user1)).toBe(false);
      expect(manager.isPlanModeActive(user2)).toBe(true);
    });

    it('should exit plan mode without destroying session', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const destroyMock = vi.fn(async () => {});
      const createMock = vi.fn(async () => ({
        destroy: destroyMock,
        on: () => () => {},
      }));
      
      const client = {
        createSession: createMock,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const projectPath = 'C:\\temp\\project';

      // Create a session first
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Activate plan mode
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      const initialSessionCount = createMock.mock.calls.length;
      const initialDestroyCount = destroyMock.mock.calls.length;

      // Exit plan mode - should preserve current session context
      await manager.exitPlanMode(userId);

      // Plan mode should be inactive
      expect(manager.isPlanModeActive(userId)).toBe(false);

      // Session should not be destroyed
      expect(destroyMock).toHaveBeenCalledTimes(initialDestroyCount);

      // No new session should be created
      expect(createMock).toHaveBeenCalledTimes(initialSessionCount);
    });

    it('should not recreate session if no active session exists when exiting plan mode', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const destroyMock = vi.fn(async () => {});
      const createMock = vi.fn(async () => ({
        destroy: destroyMock,
        on: () => () => {},
      }));
      
      const client = {
        createSession: createMock,
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';

      // Activate plan mode without a session
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Exit plan mode - should not try to recreate session
      await manager.exitPlanMode(userId);

      // Plan mode should be inactive
      expect(manager.isPlanModeActive(userId)).toBe(false);

      // No session should have been created or destroyed
      expect(createMock).not.toHaveBeenCalled();
      expect(destroyMock).not.toHaveBeenCalled();
    });

    it('should clear plan mode flags when destroying all sessions', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const user1 = 'user1';
      const user2 = 'user2';

      // Create sessions for both users
      await manager.switchProject(user1, 'C:\\temp\\project1', {
        model: 'gpt-5-mini',
        tools: [],
      });
      await manager.switchProject(user2, 'C:\\temp\\project2', {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Activate plan mode for both
      manager.setPlanMode(user1, true);
      manager.setPlanMode(user2, true);

      expect(manager.isPlanModeActive(user1)).toBe(true);
      expect(manager.isPlanModeActive(user2)).toBe(true);

      // Destroy all sessions
      await manager.destroyAll();

      // Plan mode should be cleared for all users
      expect(manager.isPlanModeActive(user1)).toBe(false);
      expect(manager.isPlanModeActive(user2)).toBe(false);
    });

    it('should clear plan mode when destroying a specific session', async () => {
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

      // Create a session
      await manager.switchProject(userId, projectPath, {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Activate plan mode
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Destroy the session
      await manager.destroySession(userId, projectPath);

      // Plan mode should be cleared
      expect(manager.isPlanModeActive(userId)).toBe(false);
    });
  });

  describe('Plan mode persistence', () => {
    it('should maintain plan mode when switching projects', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';

      // Create first project session
      await manager.switchProject(userId, 'C:\\temp\\project1', {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Activate plan mode
      manager.setPlanMode(userId, true);
      expect(manager.isPlanModeActive(userId)).toBe(true);

      // Switch to another project
      await manager.switchProject(userId, 'C:\\temp\\project2', {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Plan mode should still be active (it's user-wide, not project-specific)
      expect(manager.isPlanModeActive(userId)).toBe(true);
    });
  });
});
