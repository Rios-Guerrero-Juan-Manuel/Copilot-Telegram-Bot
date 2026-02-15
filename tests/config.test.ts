import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  COPILOT_MCP_CONFIG_PATH: 'C:\\temp\\mcp-config.json',
  DB_PATH: ':memory:',
};

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  it('loads required env vars', async () => {
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_BOT_TOKEN).toBe('token');
    expect(config.TELEGRAM_CHAT_ID).toBe('123');
  });

  it('should have default COPILOT_OPERATION_TIMEOUT of 3600000 (60 min)', async () => {
    const { config } = await import('../src/config');
    expect(config.COPILOT_OPERATION_TIMEOUT).toBe(3600000);
  });

  it('should allow custom COPILOT_OPERATION_TIMEOUT from env', async () => {
    process.env.COPILOT_OPERATION_TIMEOUT = '300000';
    const { config } = await import('../src/config');
    expect(config.COPILOT_OPERATION_TIMEOUT).toBe(300000);
  });

  it('should default allowlist restart flags correctly', async () => {
    delete process.env.ALLOWLIST_SETUP_AUTO_RESTART;
    delete process.env.ALLOWLIST_ADMIN_AUTO_RESTART;
    const { config } = await import('../src/config');
    expect(config.ALLOWLIST_SETUP_AUTO_RESTART).toBe(true);
    expect(config.ALLOWLIST_ADMIN_AUTO_RESTART).toBe(false);
  });
});
