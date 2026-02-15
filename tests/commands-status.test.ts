import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '5',
};

describe('/status command', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  it('shows idle status when not busy', async () => {
    const { SessionManager } = await import('../src/copilot/session-manager');
    const client = {
      createSession: vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      })),
    };

    const manager = new SessionManager(client as any);
    const userId = 'user123';

    expect(manager.isBusy(userId)).toBe(false);
    expect(manager.getOperationStartTime(userId)).toBeNull();
    expect(manager.getOperationElapsedMs(userId)).toBeNull();
  });

  it('shows busy status with elapsed time when operation in progress', async () => {
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

    expect(manager.isBusy(userId)).toBe(true);
    expect(manager.getOperationStartTime(userId)).toBeInstanceOf(Date);

    // Wait a bit to accumulate time
    await new Promise(resolve => setTimeout(resolve, 100));

    const elapsed = manager.getOperationElapsedMs(userId);
    expect(elapsed).not.toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('shows multiple sessions with timestamps', async () => {
    const { SessionManager } = await import('../src/copilot/session-manager');
    const client = {
      createSession: vi.fn(async () => ({
        destroy: async () => {},
        on: () => () => {},
      })),
    };

    const manager = new SessionManager(client as any);
    const userId = 'user123';

    await manager.switchProject(userId, 'C:\\temp\\project1', {
      model: 'gpt-5-mini',
      tools: [],
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    await manager.switchProject(userId, 'C:\\temp\\project2', {
      model: 'gpt-5-mini',
      tools: [],
    });

    const sessions = manager.getSessionsWithTimestamps(userId);
    expect(sessions).toHaveLength(2);

    const active = sessions.find(s => s.active);
    const inactive = sessions.find(s => !s.active);

    expect(active).toBeDefined();
    expect(inactive).toBeDefined();
    expect(active?.path).toBe('C:\\temp\\project2');
    expect(inactive?.path).toBe('C:\\temp\\project1');
  });

  it('clears operation time when operation completes', async () => {
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
    expect(manager.isBusy(userId)).toBe(true);
    expect(manager.getOperationElapsedMs(userId)).not.toBeNull();

    manager.setBusy(userId, false);
    expect(manager.isBusy(userId)).toBe(false);
    expect(manager.getOperationElapsedMs(userId)).toBeNull();
  });
});
