import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('UserState', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '123',
      DEFAULT_PROJECT_PATH: 'C:\\temp',
      ALLOWED_PATHS: 'C:\\temp',
      DB_PATH: ':memory:',
    });
  });

  it('stores and retrieves projects', async () => {
    const { UserState } = await import('../src/state/user-state');
    const { config } = await import('../src/config');
    const state = new UserState(config);
    const user = state.getOrCreate('123');

    state.addProject(user.id, 'demo', 'C:\\temp\\demo');
    const projects = state.listProjects(user.id);
    expect(projects[0].name).toBe('demo');
    expect(state.getProjectPath(user.id, 'demo')).toBe('C:\\temp\\demo');
  });
});
