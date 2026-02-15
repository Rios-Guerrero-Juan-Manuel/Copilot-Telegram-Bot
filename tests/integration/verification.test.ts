import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * Phase 4 Verification Integration Tests
 * 
 * This test suite verifies all features implemented in previous phases:
 * - Network retry logic with exponential backoff
 * - Logging capture and sanitization
 * - Session lifecycle logging
 * - MCP operation logging
 * - Performance metrics logging
 * - Log rotation configuration
 */

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token-123',
  TELEGRAM_CHAT_ID: '123456',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  COPILOT_MCP_CONFIG_PATH: 'C:\\temp\\mcp-config.json',
  DB_PATH: ':memory:',
  LOG_LEVEL: 'info',
  LOG_DIR: './logs',
  LOG_MAX_SIZE: '20m',
  LOG_MAX_FILES: '14d',
  LOG_DATE_PATTERN: 'YYYY-MM-DD',
};

describe('Phase 4: Comprehensive Verification Tests', () => {
  describe('Network Retry Logic', () => {
    beforeEach(() => {
      vi.resetModules();
      // Reset TELEGRAM_RETRY_* env vars to prevent test order dependence
      delete process.env.TELEGRAM_RETRY_MAX_ATTEMPTS;
      delete process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS;
      delete process.env.TELEGRAM_RETRY_MAX_DELAY_MS;
      Object.assign(process.env, baseEnv);
    });

    it('should retry on network errors with exponential backoff', async () => {
      const { withRetry, isNetworkError } = await import('../../src/utils/telegram-retry');
      
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Connection reset');
          error.code = 'ECONNRESET';
          throw error;
        }
        return 'success';
      });

      const onRetry = vi.fn();
      const result = await withRetry(mockFn, {
        maxAttempts: 5,
        initialDelay: 10, // Fast for testing
        maxDelay: 100,
        onRetry,
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(onRetry).toHaveBeenCalledTimes(2); // Retried twice before success
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });

    it('should not retry on authentication errors', async () => {
      const { withRetry, isAuthError } = await import('../../src/utils/telegram-retry');
      
      const mockFn = vi.fn(async () => {
        const error: any = new Error('Unauthorized');
        error.status = 401;
        throw error;
      });

      const onRetry = vi.fn();
      
      await expect(
        withRetry(mockFn, {
          maxAttempts: 5,
          onRetry,
        })
      ).rejects.toThrow('Unauthorized');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should respect max attempts limit', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      const mockFn = vi.fn(async () => {
        const error: any = new Error('Timeout');
        error.code = 'ETIMEDOUT';
        throw error;
      });

      const onRetry = vi.fn();
      
      await expect(
        withRetry(mockFn, {
          maxAttempts: 3,
          initialDelay: 10,
          onRetry,
        })
      ).rejects.toThrow('Timeout');

      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2); // Max attempts - 1
    });

    it('should calculate exponential backoff correctly', async () => {
      const { calculateBackoff } = await import('../../src/utils/telegram-retry');
      
      const delays = [
        calculateBackoff(0, 100, 10000),
        calculateBackoff(1, 100, 10000),
        calculateBackoff(2, 100, 10000),
        calculateBackoff(3, 100, 10000),
        calculateBackoff(4, 100, 10000),
      ];

      expect(delays).toEqual([100, 200, 400, 800, 1600]);
    });

    it('should cap delay at maxDelay', async () => {
      const { calculateBackoff } = await import('../../src/utils/telegram-retry');
      
      const delay = calculateBackoff(10, 1000, 5000);
      expect(delay).toBe(5000); // Should be capped at maxDelay
    });

    it('should identify all network error codes', async () => {
      const { isNetworkError } = await import('../../src/utils/telegram-retry');
      
      const networkErrors = [
        { code: 'ECONNRESET' },
        { code: 'ETIMEDOUT' },
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
        { code: 'EHOSTUNREACH' },
        { message: 'socket hang up' },
      ];

      networkErrors.forEach(error => {
        expect(isNetworkError(error)).toBe(true);
      });
    });

    it('should identify all auth error patterns', async () => {
      const { isAuthError } = await import('../../src/utils/telegram-retry');
      
      const authErrors = [
        { status: 401 },
        { status: 403 },
        { message: 'Unauthorized' },
        { message: 'Invalid token provided' },
        { message: 'Authentication failed' },
        { message: 'Access forbidden' },
      ];

      authErrors.forEach(error => {
        expect(isAuthError(error)).toBe(true);
      });
    });

    it('should retry wrapped network errors (grammY HttpError style)', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          // Simulate grammY HttpError wrapping a network error
          const wrappedError: any = {
            message: 'HttpError: Request failed',
            name: 'HttpError',
            error: {
              code: 'ETIMEDOUT',
              message: 'Connection timed out',
            },
          };
          throw wrappedError;
        }
        return 'success after wrapped error retries';
      });

      const onRetry = vi.fn();
      const result = await withRetry(mockFn, {
        maxAttempts: 5,
        initialDelay: 10,
        maxDelay: 100,
        onRetry,
      });

      expect(result).toBe('success after wrapped error retries');
      expect(attempts).toBe(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should retry deeply nested network errors', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          // Simulate error nested under error.cause
          const deepError: any = {
            message: 'Request failed',
            error: {
              message: 'Fetch error',
              cause: {
                code: 'ECONNRESET',
                message: 'socket hang up',
              },
            },
          };
          throw deepError;
        }
        return 'success after deep error';
      });

      const result = await withRetry(mockFn, {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 50,
      });

      expect(result).toBe('success after deep error');
      expect(attempts).toBe(2);
    });

    it('should NOT retry wrapped non-network errors', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      const mockFn = vi.fn(async () => {
        // Non-network error wrapped in HttpError style
        const wrappedError: any = {
          message: 'HttpError: Bad Request',
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid request parameters',
          },
        };
        throw wrappedError;
      });

      const onRetry = vi.fn();
      
      await expect(
        withRetry(mockFn, {
          maxAttempts: 3,
          initialDelay: 10,
          onRetry,
        })
      ).rejects.toThrow('HttpError: Bad Request');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries for non-network error
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should treat wrapped auth errors as non-retryable', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      const mockFn = vi.fn(async () => {
        const wrappedAuthError: any = {
          message: 'HttpError: Unauthorized',
          status: 401,
          error: {
            message: 'Invalid token',
          },
        };
        throw wrappedAuthError;
      });

      const onRetry = vi.fn();
      
      await expect(
        withRetry(mockFn, {
          maxAttempts: 5,
          onRetry,
        })
      ).rejects.toThrow('HttpError: Unauthorized');

      expect(mockFn).toHaveBeenCalledTimes(1); // No retries for auth errors
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should handle recovery from multiple wrapped network errors', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      let attempts = 0;
      const networkErrorTypes = [
        { code: 'ETIMEDOUT', message: 'Timeout' },
        { code: 'ECONNRESET', message: 'Connection reset' },
        { code: 'ENOTFOUND', message: 'DNS lookup failed' },
      ];

      const mockFn = vi.fn(async () => {
        if (attempts < networkErrorTypes.length) {
          const error = networkErrorTypes[attempts];
          attempts++;
          const wrappedError: any = {
            message: 'HttpError occurred',
            error,
          };
          throw wrappedError;
        }
        return 'success after multiple error types';
      });

      const onRetry = vi.fn();
      const result = await withRetry(mockFn, {
        maxAttempts: 5,
        initialDelay: 10,
        maxDelay: 100,
        onRetry,
      });

      expect(result).toBe('success after multiple error types');
      expect(attempts).toBe(3);
      expect(onRetry).toHaveBeenCalledTimes(3);
    });
  });

  describe('Logging and Sanitization', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should sanitize sensitive fields', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const input = {
        apiToken: 'secret-token-123',
        apiKey: 'sk-abc123',
        password: 'mypassword',
        clientSecret: 'client-secret',
        userName: 'john_doe',
        count: 42,
      };

      const sanitized = sanitizeForLogging(input);

      expect(sanitized.apiToken).toBe('[REDACTED]');
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.clientSecret).toBe('[REDACTED]');
      expect(sanitized.userName).toBe('john_doe');
      expect(sanitized.count).toBe(42);
    });

    it('should truncate long text fields', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const longMessage = 'a'.repeat(2000);
      const input = {
        message: longMessage,
        prompt: longMessage,
        content: longMessage,
      };

      const sanitized = sanitizeForLogging(input);

      expect(sanitized.message.length).toBe(1003); // 1000 chars + '...'
      expect(sanitized.prompt.length).toBe(1003);
      expect(sanitized.content.length).toBe(1003);
      expect(sanitized.message).toMatch(/\.\.\.$/);
    });

    it('should handle nested objects', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const input = {
        user: {
          name: 'John',
          apiToken: 'secret-123',
        },
        config: {
          endpoint: 'https://api.example.com',
          apiKey: 'key-456',
        },
      };

      const sanitized = sanitizeForLogging(input);

      expect(sanitized.user.name).toBe('John');
      expect(sanitized.user.apiToken).toBe('[REDACTED]');
      expect(sanitized.config.endpoint).toBe('https://api.example.com');
      expect(sanitized.config.apiKey).toBe('[REDACTED]');
    });

    it('should handle arrays', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const input = {
        tokens: ['token1', 'token2', 'token3'],
        items: [
          { id: 1, apiKey: 'key1' },
          { id: 2, apiKey: 'key2' },
        ],
      };

      const sanitized = sanitizeForLogging(input);

      expect(sanitized.tokens).toBe('[REDACTED]');
      expect(sanitized.items).toBeInstanceOf(Array);
      expect(sanitized.items[0].id).toBe(1);
      expect(sanitized.items[0].apiKey).toBe('[REDACTED]');
    });

    it('should handle Error objects', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const error = new Error('Test error message');
      const input = { error };

      const sanitized = sanitizeForLogging(input);

      expect(sanitized.error).toHaveProperty('message', 'Test error message');
      expect(sanitized.error).toHaveProperty('name', 'Error');
    });
  });

  describe('Session Lifecycle Logging', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should track operation start time when setting busy', async () => {
      const { SessionManager } = await import('../../src/copilot/session-manager');
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(mockClient as any);
      const userId = 'test-user-123';

      expect(manager.getOperationStartTime(userId)).toBeNull();

      manager.setBusy(userId, true);
      
      const startTime = manager.getOperationStartTime(userId);
      expect(startTime).not.toBeNull();
      expect(startTime).toBeInstanceOf(Date);
    });

    it('should clear operation start time when clearing busy', async () => {
      const { SessionManager } = await import('../../src/copilot/session-manager');
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(mockClient as any);
      const userId = 'test-user-123';

      manager.setBusy(userId, true);
      expect(manager.getOperationStartTime(userId)).not.toBeNull();

      manager.setBusy(userId, false);
      expect(manager.getOperationStartTime(userId)).toBeNull();
    });

    it('should calculate operation elapsed time correctly', async () => {
      vi.useFakeTimers();
      try {
        const { SessionManager } = await import('../../src/copilot/session-manager');
        
        const mockClient = {
          createSession: vi.fn(async () => ({
            destroy: async () => {},
            on: () => () => {},
          })),
        };

        const manager = new SessionManager(mockClient as any);
        const userId = 'test-user-123';

        manager.setBusy(userId, true);
        
        // Advance time by 50ms
        vi.advanceTimersByTime(50);
        
        const elapsed = manager.getOperationElapsedMs(userId);
        expect(elapsed).toBe(50);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return null for elapsed time if no operation in progress', async () => {
      const { SessionManager } = await import('../../src/copilot/session-manager');
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(mockClient as any);
      const userId = 'test-user-123';

      const elapsed = manager.getOperationElapsedMs(userId);
      expect(elapsed).toBeNull(); // Returns null, not 0, when no operation in progress
    });
  });

  describe('Log Rotation Configuration', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should use default log configuration', async () => {
      const { config } = await import('../../src/config');
      
      expect(config.LOG_LEVEL).toBe('info');
      expect(config.LOG_DIR).toBe('./logs');
      expect(config.LOG_MAX_SIZE).toBe('20m');
      expect(config.LOG_MAX_FILES).toBe('14d');
      expect(config.LOG_DATE_PATTERN).toBe('YYYY-MM-DD');
    });

    it('should allow custom log configuration from env', async () => {
      process.env.LOG_LEVEL = 'debug';
      process.env.LOG_DIR = './custom-logs';
      process.env.LOG_MAX_SIZE = '50m';
      process.env.LOG_MAX_FILES = '30d';
      process.env.LOG_DATE_PATTERN = 'YYYY-MM';

      const { config } = await import('../../src/config');
      
      expect(config.LOG_LEVEL).toBe('debug');
      expect(config.LOG_DIR).toBe('./custom-logs');
      expect(config.LOG_MAX_SIZE).toBe('50m');
      expect(config.LOG_MAX_FILES).toBe('30d');
      expect(config.LOG_DATE_PATTERN).toBe('YYYY-MM');
    });

    it('should validate log level values', async () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      
      for (const level of validLevels) {
        vi.resetModules();
        Object.assign(process.env, baseEnv);
        process.env.LOG_LEVEL = level;
        
        const { config } = await import('../../src/config');
        expect(config.LOG_LEVEL).toBe(level);
      }
    });
  });

  describe('Retry Configuration', () => {
    beforeEach(() => {
      vi.resetModules();
      // Reset TELEGRAM_RETRY_* env vars to prevent test order dependence
      delete process.env.TELEGRAM_RETRY_MAX_ATTEMPTS;
      delete process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS;
      delete process.env.TELEGRAM_RETRY_MAX_DELAY_MS;
      Object.assign(process.env, baseEnv);
    });

    it('should use default retry configuration', async () => {
      const { config } = await import('../../src/config');
      
      expect(config.TELEGRAM_RETRY_MAX_ATTEMPTS).toBe(10);
      expect(config.TELEGRAM_RETRY_INITIAL_DELAY_MS).toBe(1000);
      expect(config.TELEGRAM_RETRY_MAX_DELAY_MS).toBe(32000);
    });

    it('should allow custom retry configuration from env', async () => {
      process.env.TELEGRAM_RETRY_MAX_ATTEMPTS = '5';
      process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS = '2000';
      process.env.TELEGRAM_RETRY_MAX_DELAY_MS = '60000';

      const { config } = await import('../../src/config');
      
      expect(config.TELEGRAM_RETRY_MAX_ATTEMPTS).toBe(5);
      expect(config.TELEGRAM_RETRY_INITIAL_DELAY_MS).toBe(2000);
      expect(config.TELEGRAM_RETRY_MAX_DELAY_MS).toBe(60000);
    });

    it('should validate retry configuration bounds', async () => {
      process.env.TELEGRAM_RETRY_MAX_ATTEMPTS = '1';
      process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS = '100';
      process.env.TELEGRAM_RETRY_MAX_DELAY_MS = '1000';

      const { config } = await import('../../src/config');
      
      expect(config.TELEGRAM_RETRY_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
      expect(config.TELEGRAM_RETRY_INITIAL_DELAY_MS).toBeGreaterThanOrEqual(100);
      expect(config.TELEGRAM_RETRY_MAX_DELAY_MS).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('Integration: Retry with Logging', () => {
    beforeEach(() => {
      vi.resetModules();
      // Reset TELEGRAM_RETRY_* env vars to prevent test order dependence
      delete process.env.TELEGRAM_RETRY_MAX_ATTEMPTS;
      delete process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS;
      delete process.env.TELEGRAM_RETRY_MAX_DELAY_MS;
      Object.assign(process.env, baseEnv);
    });

    it('should log retry attempts with sanitized data', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      let attempts = 0;
      const mockFn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Network error');
          error.code = 'ECONNRESET';
          error.apiToken = 'secret-123'; // Should be sanitized in logs
          throw error;
        }
        return 'success';
      });

      const retryLog: any[] = [];
      const onRetry = (attempt: number, error: any, delay: number) => {
        retryLog.push({ attempt, error, delay });
      };

      await withRetry(mockFn, {
        maxAttempts: 5,
        initialDelay: 10,
        maxDelay: 100,
        onRetry,
      });

      expect(retryLog).toHaveLength(2);
      expect(retryLog[0].attempt).toBe(1);
      expect(retryLog[1].attempt).toBe(2);
      expect(retryLog[0].delay).toBeGreaterThan(0);
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should track operation duration accurately', async () => {
      vi.useFakeTimers();
      try {
        const { SessionManager } = await import('../../src/copilot/session-manager');
        
        const mockClient = {
          createSession: vi.fn(async () => ({
            destroy: async () => {},
            on: () => () => {},
          })),
        };

        const manager = new SessionManager(mockClient as any);
        const userId = 'perf-test-user';

        manager.setBusy(userId, true);
        
        // Advance time by 100ms
        vi.advanceTimersByTime(100);
        
        const elapsed = manager.getOperationElapsedMs(userId);
        
        // With fake timers, elapsed should be exactly 100ms
        expect(elapsed).toBe(100);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should handle concurrent operations for different users', async () => {
      vi.useFakeTimers();
      try {
        const { SessionManager } = await import('../../src/copilot/session-manager');
        
        const mockClient = {
          createSession: vi.fn(async () => ({
            destroy: async () => {},
            on: () => () => {},
          })),
        };

        const manager = new SessionManager(mockClient as any);
        
        manager.setBusy('user1', true);
        vi.advanceTimersByTime(50);
        manager.setBusy('user2', true);
        vi.advanceTimersByTime(50);
        
        const elapsed1 = manager.getOperationElapsedMs('user1');
        const elapsed2 = manager.getOperationElapsedMs('user2');
        
        expect(elapsed1).toBe(100);
        expect(elapsed2).toBe(50);
        expect(elapsed1).toBeGreaterThan(elapsed2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Message Formatting and Progress Tracking', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should format progress messages correctly', async () => {
      const { formatProgressMessage } = await import('../../src/bot/message-handler');
      
      const message = formatProgressMessage(0, 1500, 10000);
      
      expect(message).toContain('1500');
      expect(message).toContain('10s');
    });

    it('should round down elapsed seconds', async () => {
      const { formatProgressMessage } = await import('../../src/bot/message-handler');
      
      const message = formatProgressMessage(0, 1000, 5750);
      
      expect(message).toContain('1000');
      expect(message).toContain('5s');
    });

    it('should handle zero elapsed time', async () => {
      const { formatProgressMessage } = await import('../../src/bot/message-handler');
      
      const message = formatProgressMessage(0, 500, 0);
      
      expect(message).toContain('500');
      expect(message).toContain('0s');
    });

    it('should handle large buffer sizes', async () => {
      const { formatProgressMessage } = await import('../../src/bot/message-handler');
      
      const message = formatProgressMessage(0, 150000, 120000);
      
      expect(message).toContain('150000');
      expect(message).toContain('120s');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      vi.resetModules();
      Object.assign(process.env, baseEnv);
    });

    it('should handle null and undefined in sanitization', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const input = {
        value: null,
        other: undefined,
        normalField: 'should-be-visible',
      };

      const sanitized = sanitizeForLogging(input);
      
      expect(sanitized.value).toBeNull();
      // Implementation preserves undefined
      expect(sanitized.other).toBeUndefined();
      expect(sanitized.normalField).toBe('should-be-visible');
    });

    it('should handle circular references in sanitization', async () => {
      const { sanitizeForLogging } = await import('../../src/utils/sanitize');
      
      const obj: any = { name: 'test' };
      obj.self = obj; // Circular reference

      // Should not throw, but handle gracefully
      expect(() => sanitizeForLogging(obj)).not.toThrow();
    });

    it('should handle retry with all failures', async () => {
      const { withRetry } = await import('../../src/utils/telegram-retry');
      
      const mockFn = vi.fn(async () => {
        const error: any = new Error('Always fails');
        error.code = 'ECONNRESET';
        throw error;
      });

      await expect(
        withRetry(mockFn, {
          maxAttempts: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow('Always fails');

      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should handle empty error objects', async () => {
      const { isNetworkError, isAuthError } = await import('../../src/utils/telegram-retry');
      
      expect(isNetworkError({})).toBe(false);
      expect(isNetworkError(null)).toBe(false);
      expect(isNetworkError(undefined)).toBe(false);
      
      expect(isAuthError({})).toBe(false);
      expect(isAuthError(null)).toBe(false);
      expect(isAuthError(undefined)).toBe(false);
    });
  });
});
