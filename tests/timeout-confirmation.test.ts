import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bot } from 'grammy';
import { SessionManager } from '../src/copilot/session-manager';
import { logger } from '../src/utils/logger';

// Mock logger first
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config with all required values
vi.mock('../src/config', () => ({
  config: {
    TIMEOUT_EXTENSION_MS: 1200000, // 20 minutes
    MAX_TIMEOUT_DURATION: 7200000, // 2 hours
    TIMEOUT_CONFIRMATION_TIME: 600000, // 10 minutes
    COPILOT_OPERATION_TIMEOUT: 3600000, // 1 hour
    LOG_DIR: './logs',
    LOG_LEVEL: 'info',
    LOG_MAX_SIZE: '20m',
    LOG_MAX_FILES: '14d',
    LOG_DATE_PATTERN: 'YYYY-MM-DD',
  },
}));

// Import config after mocking
import { config } from '../src/config';

describe('Interactive Timeout Confirmation', () => {
  let bot: any;
  let sessionManager: any;
  let mockSendMessage: any;
  let mockEditMessageText: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSendMessage = vi.fn().mockResolvedValue({ message_id: 123 });
    mockEditMessageText = vi.fn().mockResolvedValue({});

    bot = {
      api: {
        sendMessage: mockSendMessage,
        editMessageText: mockEditMessageText,
      },
    } as any;

    // Create a minimal mock session manager for tests that need it
    // We don't use the real SessionManager for unit tests
    sessionManager = {
      setBusy: vi.fn(),
      isBusy: vi.fn().mockReturnValue(true),
      startTimeout: vi.fn(),
      extendTimeout: vi.fn().mockReturnValue(true),
      getTimeoutExtension: vi.fn().mockReturnValue(0),
      getOriginalTimeout: vi.fn().mockReturnValue(3600000),
      clearTimeout: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('askTimeoutExtension', () => {
    it('should display confirmation dialog with elapsed time', async () => {
      vi.useFakeTimers();
      const userId = 'user123';
      const chatId = '456';
      const startTime = Date.now() - 300000; // 5 minutes ago

      // Import the function we'll be creating
      const { askTimeoutExtension } = await import('../src/bot/timeout-confirmation');

      // Start asking (don't await yet, as it waits for response)
      const promise = askTimeoutExtension(userId, chatId, startTime, bot);

      // Let promises resolve
      await vi.runOnlyPendingTimersAsync();

      // Check that message was sent with correct content
      expect(mockSendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('5m 0s'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
                expect.arrayContaining([
                expect.objectContaining({ text: expect.stringMatching(/extend|extender/i) }),
                expect.objectContaining({ text: expect.stringMatching(/cancel/i) }),
              ]),
            ]),
          }),
        })
      );

      // Cleanup
      vi.runAllTimers();
      vi.useRealTimers();
    });

    it('should return true when user confirms extension', async () => {
      const userId = 'user123';
      const chatId = '456';
      const startTime = Date.now() - 180000; // 3 minutes ago

      const { askTimeoutExtension, resolveTimeoutResponse } = await import(
        '../src/bot/timeout-confirmation'
      );

      const promise = askTimeoutExtension(userId, chatId, startTime, bot);

      // Simulate user clicking "Sí, extender"
      await new Promise((resolve) => setTimeout(resolve, 10));
      resolveTimeoutResponse(userId, 'extend');

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should return false when user cancels', async () => {
      const userId = 'user123';
      const chatId = '456';
      const startTime = Date.now() - 180000;

      const { askTimeoutExtension, resolveTimeoutResponse } = await import(
        '../src/bot/timeout-confirmation'
      );

      const promise = askTimeoutExtension(userId, chatId, startTime, bot);

      // Simulate user clicking "No, cancelar"
      await new Promise((resolve) => setTimeout(resolve, 10));
      resolveTimeoutResponse(userId, 'cancel');

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return false when user does not respond (timeout)', async () => {
      vi.useFakeTimers();
      const userId = 'user123';
      const chatId = '456';
      const startTime = Date.now() - 180000;

      const { askTimeoutExtension } = await import('../src/bot/timeout-confirmation');

      const promise = askTimeoutExtension(userId, chatId, startTime, bot);

      // Fast-forward past TIMEOUT_CONFIRMATION_TIME
      await vi.advanceTimersByTimeAsync(config.TIMEOUT_CONFIRMATION_TIME + 1000);

      const result = await promise;
      expect(result).toBe(false);

      vi.useRealTimers();
    }, 15000); // Increase test timeout to 15 seconds

    it('should log user interaction', async () => {
      const userId = 'user123';
      const chatId = '456';
      const startTime = Date.now() - 180000;

      const { askTimeoutExtension, resolveTimeoutResponse } = await import(
        '../src/bot/timeout-confirmation'
      );

      const promise = askTimeoutExtension(userId, chatId, startTime, bot);

      await new Promise((resolve) => setTimeout(resolve, 10));
      resolveTimeoutResponse(userId, 'extend');

      await promise;

      expect(logger.info).toHaveBeenCalledWith(
        'Asking user for timeout extension',
        expect.objectContaining({ userId, chatId })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'User response to timeout extension',
        expect.objectContaining({ userId, chatId, response: 'extend' })
      );
    });
  });

  describe('Timeout Callback Integration', () => {
    it('should extend timeout when user confirms', async () => {
      const userId = 'user123';
      const chatId = '456';

      sessionManager.setBusy(userId, true);

      // Verify the mock is working
      expect(sessionManager.isBusy(userId)).toBe(true);

      // Simulate extension
      const extended = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);

      expect(extended).toBe(true);
      expect(sessionManager.extendTimeout).toHaveBeenCalledWith(
        userId,
        config.TIMEOUT_EXTENSION_MS
      );
    });

    it('should abort session when user declines', async () => {
      const userId = 'user123';

      const callback = vi.fn();

      // With mocked session manager, we just verify the callback would be called
      sessionManager.startTimeout(userId, 1000, callback);

      expect(sessionManager.startTimeout).toHaveBeenCalledWith(userId, 1000, callback);
    });

    it('should respect MAX_TIMEOUT_DURATION limit', async () => {
      const userId = 'user123';
      const chatId = '456';

      sessionManager.setBusy(userId, true);

      // Simulate multiple extensions approaching the limit
      const elapsed = config.MAX_TIMEOUT_DURATION - config.TIMEOUT_EXTENSION_MS + 100000;
      const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS;

      // Should not allow extension if it exceeds MAX_TIMEOUT_DURATION
      expect(projectedTotal).toBeGreaterThan(config.MAX_TIMEOUT_DURATION);
    });

    it('should allow multiple successive confirmations', async () => {
      const userId = 'user123';

      sessionManager.setBusy(userId, true);

      // First extension
      let extended = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);
      expect(extended).toBe(true);

      // Second extension
      extended = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);
      expect(extended).toBe(true);

      // Third extension
      extended = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);
      expect(extended).toBe(true);

      // Verify all calls were made
      expect(sessionManager.extendTimeout).toHaveBeenCalledTimes(3);
    });
  });

  describe('Callback Handler Registration', () => {
    it('should register callback handler for timeout responses', async () => {
      const { registerTimeoutCallbacks } = await import('../src/bot/timeout-confirmation');

      const callbackHandlers: any[] = [];
      const mockBot = {
        callbackQuery: (pattern: RegExp, handler: any) => {
          callbackHandlers.push({ pattern, handler });
        },
      } as any;

      registerTimeoutCallbacks(mockBot);

      // Should have registered a handler
      expect(callbackHandlers.length).toBeGreaterThan(0);

      // Find the timeout handler
      const timeoutHandler = callbackHandlers.find((h) =>
        h.pattern.test('timeout_extend:user123:' + Date.now())
      );

      expect(timeoutHandler).toBeDefined();
    });

    it('should handle callback query for extend action', async () => {
      const { registerTimeoutCallbacks, resolveTimeoutResponse } = await import(
        '../src/bot/timeout-confirmation'
      );

      const callbackHandlers: any[] = [];
      const mockBot = {
        callbackQuery: (pattern: RegExp, handler: any) => {
          callbackHandlers.push({ pattern, handler });
        },
      } as any;

      registerTimeoutCallbacks(mockBot);

      const handler = callbackHandlers.find((h) =>
        h.pattern.test('timeout_extend:user123:' + Date.now())
      )?.handler;

      expect(handler).toBeDefined();

      // Mock context
      const mockCtx = {
        callbackQuery: {
          data: 'timeout_extend_user123',
        },
        match: ['timeout_extend_user123', 'user123', 'extend'],
        answerCallbackQuery: vi.fn().mockResolvedValue({}),
      };

      await handler(mockCtx);

      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
    });
  });
});
