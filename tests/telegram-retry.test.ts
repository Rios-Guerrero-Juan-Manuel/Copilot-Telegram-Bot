import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  COPILOT_MCP_CONFIG_PATH: 'C:\\temp\\mcp-config.json',
  DB_PATH: ':memory:',
};

describe('telegram retry configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset TELEGRAM_RETRY_* env vars to prevent test order dependence
    delete process.env.TELEGRAM_RETRY_MAX_ATTEMPTS;
    delete process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS;
    delete process.env.TELEGRAM_RETRY_MAX_DELAY_MS;
    Object.assign(process.env, baseEnv);
  });

  it('should have default TELEGRAM_RETRY_MAX_ATTEMPTS of 10', async () => {
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_MAX_ATTEMPTS).toBe(10);
  });

  it('should have default TELEGRAM_RETRY_INITIAL_DELAY_MS of 1000', async () => {
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_INITIAL_DELAY_MS).toBe(1000);
  });

  it('should have default TELEGRAM_RETRY_MAX_DELAY_MS of 32000', async () => {
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_MAX_DELAY_MS).toBe(32000);
  });

  it('should allow custom TELEGRAM_RETRY_MAX_ATTEMPTS from env', async () => {
    process.env.TELEGRAM_RETRY_MAX_ATTEMPTS = '5';
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_MAX_ATTEMPTS).toBe(5);
  });

  it('should allow custom TELEGRAM_RETRY_INITIAL_DELAY_MS from env', async () => {
    process.env.TELEGRAM_RETRY_INITIAL_DELAY_MS = '2000';
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_INITIAL_DELAY_MS).toBe(2000);
  });

  it('should allow custom TELEGRAM_RETRY_MAX_DELAY_MS from env', async () => {
    process.env.TELEGRAM_RETRY_MAX_DELAY_MS = '60000';
    const { config } = await import('../src/config');
    expect(config.TELEGRAM_RETRY_MAX_DELAY_MS).toBe(60000);
  });
});

describe('exponential backoff calculation', () => {
  it('should calculate exponential backoff delays correctly', async () => {
    const { calculateBackoff } = await import('../src/utils/telegram-retry');
    const initialDelay = 1000;
    const maxDelay = 32000;

    expect(calculateBackoff(0, initialDelay, maxDelay)).toBe(1000); // 1s
    expect(calculateBackoff(1, initialDelay, maxDelay)).toBe(2000); // 2s
    expect(calculateBackoff(2, initialDelay, maxDelay)).toBe(4000); // 4s
    expect(calculateBackoff(3, initialDelay, maxDelay)).toBe(8000); // 8s
    expect(calculateBackoff(4, initialDelay, maxDelay)).toBe(16000); // 16s
    expect(calculateBackoff(5, initialDelay, maxDelay)).toBe(32000); // 32s (capped)
    expect(calculateBackoff(6, initialDelay, maxDelay)).toBe(32000); // 32s (capped)
  });
});

describe('network error detection', () => {
  it('should identify ECONNRESET as a network error', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error: any = new Error('Connection reset');
    error.code = 'ECONNRESET';

    expect(isNetworkError(error)).toBe(true);
  });

  it('should identify ETIMEDOUT as a network error', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error: any = new Error('Timeout');
    error.code = 'ETIMEDOUT';

    expect(isNetworkError(error)).toBe(true);
  });

  it('should identify socket hang up as a network error', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error = new Error('socket hang up');

    expect(isNetworkError(error)).toBe(true);
  });

  it('should NOT identify authorization errors as network errors', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error: any = new Error('Unauthorized');
    error.code = 401;

    expect(isNetworkError(error)).toBe(false);
  });

  it('should NOT identify authentication errors as network errors', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error = new Error('Invalid token');

    expect(isNetworkError(error)).toBe(false);
  });

  it('should NOT identify errors with "network" in message as network errors', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    const error = new Error('This is not a network error, just has the word network in it');

    expect(isNetworkError(error)).toBe(false);
  });
});

describe('wrapped network error detection', () => {
  it('should detect network error wrapped under .error property (grammY HttpError style)', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    // Simulate grammY HttpError wrapping a network error
    const wrappedError: any = {
      message: 'HttpError: 500 Internal Server Error',
      name: 'HttpError',
      error: {
        code: 'ETIMEDOUT',
        message: 'Connection timed out',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(true);
  });

  it('should detect network error wrapped under .cause property', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    // Standard Error cause chain
    const wrappedError: any = {
      message: 'Request failed',
      name: 'RequestError',
      cause: {
        code: 'ECONNRESET',
        message: 'socket hang up',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(true);
  });

  it('should detect network error deeply nested under error.cause', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    // Nested: HttpError -> error -> cause -> network error
    const deeplyWrappedError: any = {
      message: 'HttpError occurred',
      error: {
        message: 'Fetch failed',
        cause: {
          code: 'ENOTFOUND',
          message: 'DNS lookup failed',
        },
      },
    };

    expect(isNetworkError(deeplyWrappedError)).toBe(true);
  });

  it('should detect ECONNREFUSED nested under .error', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const wrappedError: any = {
      message: 'Connection failed',
      error: {
        code: 'ECONNREFUSED',
        message: 'Connection refused by server',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(true);
  });

  it('should detect EHOSTUNREACH nested under .cause', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const wrappedError: any = {
      message: 'Cannot reach host',
      cause: {
        code: 'EHOSTUNREACH',
        message: 'No route to host',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(true);
  });

  it('should detect "socket hang up" message nested under .error', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const wrappedError: any = {
      message: 'HTTP request failed',
      error: {
        message: 'socket hang up',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(true);
  });

  it('should handle deeply nested error chains (up to 10 levels)', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    // Build a 5-level deep error chain
    const deepError: any = {
      message: 'Level 0',
      error: {
        message: 'Level 1',
        cause: {
          message: 'Level 2',
          error: {
            message: 'Level 3',
            cause: {
              code: 'ETIMEDOUT',
              message: 'Level 4 - network error at depth 5',
            },
          },
        },
      },
    };

    expect(isNetworkError(deepError)).toBe(true);
  });

  it('should NOT identify wrapped non-network errors as network errors', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const wrappedError: any = {
      message: 'HttpError',
      error: {
        message: 'Invalid request',
        code: 'INVALID_REQUEST',
      },
    };

    expect(isNetworkError(wrappedError)).toBe(false);
  });

  it('should handle circular references without infinite loop', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const circularError: any = {
      message: 'Circular error',
      code: 'SOME_ERROR',
    };
    circularError.error = circularError; // Create cycle

    // Should not hang and should return false (no network error)
    expect(isNetworkError(circularError)).toBe(false);
  });

  it('should handle circular references with network error in chain', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    const networkErr: any = {
      code: 'ETIMEDOUT',
      message: 'Timeout',
    };
    const circularError: any = {
      message: 'Wrapper',
      error: networkErr,
    };
    networkErr.cause = circularError; // Create cycle after network error

    // Should detect network error despite cycle
    expect(isNetworkError(circularError)).toBe(true);
  });

  it('should respect max depth limit (10 levels)', async () => {
    const { isNetworkError } = await import('../src/utils/telegram-retry');
    
    // Build an 11-level deep chain with network error at level 11
    let current: any = { code: 'ETIMEDOUT', message: 'Network error at depth 11' };
    for (let i = 0; i < 11; i++) {
      current = { message: `Level ${i}`, error: current };
    }

    // Should NOT detect because it exceeds max depth of 10
    expect(isNetworkError(current)).toBe(false);
  });
});
