import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '1',
};

describe('SessionManager', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  it('evicts sessions when over limit', async () => {
    const { SessionManager } = await import('../src/copilot/session-manager');
    const destroyed = vi.fn(async () => {});
    const client = {
      createSession: vi.fn(async () => ({
        destroy: destroyed,
        on: () => () => {},
      })),
    };

    const manager = new SessionManager(client as any);
    await manager.switchProject('user', 'C:\\temp\\one', {
      model: 'gpt-5-mini',
      tools: [],
    });
    await manager.switchProject('user', 'C:\\temp\\two', {
      model: 'gpt-5-mini',
      tools: [],
    });

    expect(destroyed).toHaveBeenCalled();
    expect(manager.listSessions('user').length).toBe(1);
  });

  describe('operation tracking', () => {
    it('tracks operation start time when setBusy(true)', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      expect(manager.getOperationStartTime(userId)).toBeNull();
      
      manager.setBusy(userId, true);
      
      const startTime = manager.getOperationStartTime(userId);
      expect(startTime).not.toBeNull();
      expect(startTime).toBeInstanceOf(Date);
    });

    it('clears operation start time when setBusy(false)', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      expect(manager.getOperationStartTime(userId)).not.toBeNull();
      
      manager.setBusy(userId, false);
      expect(manager.getOperationStartTime(userId)).toBeNull();
    });

    it('calculates operation elapsed time correctly', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const elapsed = manager.getOperationElapsedMs(userId);
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(200);
    });

    it('returns null elapsed time when not busy', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      expect(manager.getOperationElapsedMs(userId)).toBeNull();
    });
  });

  describe('session metadata', () => {
    it('returns list of sessions with timestamps', async () => {
      // Override MAX_SESSIONS for this test
      process.env.MAX_SESSIONS = '5';
      
      vi.resetModules();
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      await manager.switchProject(userId, 'C:\\temp\\one', {
        model: 'gpt-5-mini',
        tools: [],
      });

      // Wait a bit before creating second session
      await new Promise(resolve => setTimeout(resolve, 50));
      
      await manager.switchProject(userId, 'C:\\temp\\two', {
        model: 'gpt-5-mini',
        tools: [],
      });

      const sessions = manager.getSessionsWithTimestamps(userId);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toHaveProperty('path');
      expect(sessions[0]).toHaveProperty('active');
      expect(sessions[0]).toHaveProperty('createdAt');
      expect(sessions[0].createdAt).toBeInstanceOf(Date);
      
      // Restore MAX_SESSIONS
      process.env.MAX_SESSIONS = '1';
    });
  });
});
