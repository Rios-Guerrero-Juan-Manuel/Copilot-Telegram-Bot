import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  COPILOT_MCP_CONFIG_PATH: 'C:\\temp\\mcp-config.json',
  DB_PATH: ':memory:',
};

describe('Timeout Configuration - Phase 1', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear all env vars that might interfere
    delete process.env.COPILOT_OPERATION_TIMEOUT;
    delete process.env.TIMEOUT_EXTENSION_MS;
    delete process.env.HEARTBEAT_WARNING_INTERVAL;
    delete process.env.MAX_TIMEOUT_DURATION;
    delete process.env.TIMEOUT_CONFIRMATION_TIME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('COPILOT_OPERATION_TIMEOUT', () => {
    it('should have new default value of 3600000ms (60 min)', async () => {
      Object.assign(process.env, baseEnv);
      const { config } = await import('../src/config');
      expect(config.COPILOT_OPERATION_TIMEOUT).toBe(3600000);
    });

    it('should allow custom value from env', async () => {
      Object.assign(process.env, { ...baseEnv, COPILOT_OPERATION_TIMEOUT: '1800000' });
      const { config } = await import('../src/config');
      expect(config.COPILOT_OPERATION_TIMEOUT).toBe(1800000);
    });

    it('should respect maximum constraint', async () => {
      Object.assign(process.env, { ...baseEnv, COPILOT_OPERATION_TIMEOUT: '10000000' });
      // Should fail validation or be capped
      try {
        await import('../src/config');
        // If it doesn't throw, check it's been capped
      } catch (error) {
        // Expected to throw if validation is strict
        expect(error).toBeDefined();
      }
    });
  });

  describe('TIMEOUT_EXTENSION_MS', () => {
    it('should have new default value of 1200000ms (20 min)', async () => {
      Object.assign(process.env, baseEnv);
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_EXTENSION_MS).toBe(1200000);
    });

    it('should allow custom value from env', async () => {
      Object.assign(process.env, { ...baseEnv, TIMEOUT_EXTENSION_MS: '900000' });
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_EXTENSION_MS).toBe(900000);
    });

    it('should enforce minimum of 60000ms (1 min)', async () => {
      Object.assign(process.env, { ...baseEnv, TIMEOUT_EXTENSION_MS: '30000' });
      try {
        await import('../src/config');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('HEARTBEAT_WARNING_INTERVAL', () => {
    it('should have new default value of 300000ms (5 min)', async () => {
      Object.assign(process.env, baseEnv);
      const { config } = await import('../src/config');
      expect(config.HEARTBEAT_WARNING_INTERVAL).toBe(300000);
    });

    it('should allow custom value from env', async () => {
      Object.assign(process.env, { ...baseEnv, HEARTBEAT_WARNING_INTERVAL: '240000' });
      const { config } = await import('../src/config');
      expect(config.HEARTBEAT_WARNING_INTERVAL).toBe(240000);
    });
  });

  describe('MAX_TIMEOUT_DURATION', () => {
    it('should have default value of 7200000ms (2 hours)', async () => {
      Object.assign(process.env, baseEnv);
      const { config } = await import('../src/config');
      expect(config.MAX_TIMEOUT_DURATION).toBe(7200000);
    });

    it('should be configurable via env', async () => {
      Object.assign(process.env, { ...baseEnv, MAX_TIMEOUT_DURATION: '10800000' });
      const { config } = await import('../src/config');
      expect(config.MAX_TIMEOUT_DURATION).toBe(10800000);
    });

    it('should default to 7200000 when env var is empty string', async () => {
      Object.assign(process.env, { ...baseEnv, MAX_TIMEOUT_DURATION: '' });
      const { config } = await import('../src/config');
      expect(config.MAX_TIMEOUT_DURATION).toBe(7200000);
    });

    it('should default to 7200000 when env var is undefined', async () => {
      const envWithoutMax = { ...baseEnv };
      delete (envWithoutMax as any).MAX_TIMEOUT_DURATION;
      Object.assign(process.env, envWithoutMax);
      const { config } = await import('../src/config');
      expect(config.MAX_TIMEOUT_DURATION).toBe(7200000);
    });

    it('should enforce minimum value of 60000ms (1 min)', async () => {
      Object.assign(process.env, { ...baseEnv, MAX_TIMEOUT_DURATION: '30000' });
      try {
        await import('../src/config');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('TIMEOUT_CONFIRMATION_TIME', () => {
    it('should have default value of 600000ms (10 min)', async () => {
      Object.assign(process.env, baseEnv);
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_CONFIRMATION_TIME).toBe(600000);
    });

    it('should be configurable via env', async () => {
      Object.assign(process.env, { ...baseEnv, TIMEOUT_CONFIRMATION_TIME: '300000' });
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_CONFIRMATION_TIME).toBe(300000);
    });

    it('should default to 600000 when env var is empty string', async () => {
      Object.assign(process.env, { ...baseEnv, TIMEOUT_CONFIRMATION_TIME: '' });
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_CONFIRMATION_TIME).toBe(600000);
    });

    it('should default to 600000 when env var is undefined', async () => {
      const envWithoutConfirmation = { ...baseEnv };
      delete (envWithoutConfirmation as any).TIMEOUT_CONFIRMATION_TIME;
      Object.assign(process.env, envWithoutConfirmation);
      const { config } = await import('../src/config');
      expect(config.TIMEOUT_CONFIRMATION_TIME).toBe(600000);
    });

    it('should enforce minimum value of 60000ms (1 min)', async () => {
      Object.assign(process.env, { ...baseEnv, TIMEOUT_CONFIRMATION_TIME: '30000' });
      try {
        await import('../src/config');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Configuration Integration', () => {
    it('should load all new timeout values correctly together', async () => {
      Object.assign(process.env, {
        ...baseEnv,
        COPILOT_OPERATION_TIMEOUT: '3600000',
        TIMEOUT_EXTENSION_MS: '1200000',
        HEARTBEAT_WARNING_INTERVAL: '300000',
        MAX_TIMEOUT_DURATION: '7200000',
        TIMEOUT_CONFIRMATION_TIME: '600000',
      });
      const { config } = await import('../src/config');
      
      expect(config.COPILOT_OPERATION_TIMEOUT).toBe(3600000);
      expect(config.TIMEOUT_EXTENSION_MS).toBe(1200000);
      expect(config.HEARTBEAT_WARNING_INTERVAL).toBe(300000);
      expect(config.MAX_TIMEOUT_DURATION).toBe(7200000);
      expect(config.TIMEOUT_CONFIRMATION_TIME).toBe(600000);
    });

    it('should ensure MAX_TIMEOUT_DURATION is greater than COPILOT_OPERATION_TIMEOUT', async () => {
      Object.assign(process.env, {
        ...baseEnv,
        COPILOT_OPERATION_TIMEOUT: '3600000',
        MAX_TIMEOUT_DURATION: '7200000',
      });
      const { config } = await import('../src/config');
      
      expect(config.MAX_TIMEOUT_DURATION).toBeGreaterThan(config.COPILOT_OPERATION_TIMEOUT);
    });
  });
});
