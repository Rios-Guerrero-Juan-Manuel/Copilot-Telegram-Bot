import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserState } from '../src/state/user-state';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
};

describe('SDK Event Logging', () => {
  let mockSessionManager: any;
  let mockUserState: any;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
    
    // Create mock SessionManager
    mockSessionManager = {
      startTimeout: vi.fn((userId: string, timeoutMs: number, callback: () => void) => {
        setTimeout(callback, timeoutMs);
      }),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    mockUserState = new UserState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should log assistant.message_delta events with structured data', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,      mockSessionManager as any,      'user123',      mockUserState as any    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger message_delta event
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Hello world!' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify that the message_delta event was logged
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'SDK event: assistant.message_delta',
      expect.objectContaining({
        event: 'assistant.message_delta',
        chatId: '456',
        deltaSize: 12, // "Hello world!" is 12 characters
        bufferSize: 12,
        elapsedMs: expect.any(Number),
        timeSinceLastEventMs: expect.any(Number),
      })
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    
    loggerDebugSpy.mockRestore();
  });

  it('should log session.idle events with final buffer size', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 789 },
      reply: mockReply,
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,      mockSessionManager as any,      'user123',      mockUserState as any    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Add some content to the buffer
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Test content' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Trigger session.idle
    onHandler({ type: 'session.idle' });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify that session.idle was logged with buffer size
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'SDK event: session.idle',
      expect.objectContaining({
        event: 'session.idle',
        chatId: '789',
        bufferSize: 12, // "Test content" is 12 characters
        elapsedMs: expect.any(Number),
        elapsedSeconds: expect.any(Number),
      })
    );
    
    await promise;
    
    loggerDebugSpy.mockRestore();
  });

  it('should log session.error events with error message', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 999 },
      reply: mockReply,
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,      mockSessionManager as any,      'user123',      mockUserState as any    ).catch(() => {}); // Catch the rejection since session.error rejects
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger session.error
    onHandler({
      type: 'session.error',
      data: { message: 'Test error occurred' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify that session.error was logged at ERROR level (not debug)
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'SDK event: session.error',
      expect.objectContaining({
        event: 'session.error',
        chatId: '999',
        errorMessage: 'Test error occurred',
        elapsedMs: expect.any(Number),
        elapsedSeconds: expect.any(Number),
      })
    );
    
    await promise;
    
    loggerDebugSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  it('should log unknown event types for visibility', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 555 },
      reply: mockReply,
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,      mockSessionManager as any,      'user123',      mockUserState as any    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger an unknown event type
    onHandler({
      type: 'unknown.event.type' as any,
      data: { someData: 'test data' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify that unknown event was logged
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'SDK event: unknown event type',
      expect.objectContaining({
        event: 'unknown.event.type',
        chatId: '555',
        elapsedMs: expect.any(Number),
        eventData: expect.any(String), // JSON stringified data
      })
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    
    loggerDebugSpy.mockRestore();
  });

  it('should log stale period warning when no events for >2 minutes', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    const { config } = await import('../src/config');
    
    const loggerWarnSpy = vi.spyOn(logger, 'warn');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 888 },
      reply: mockReply,
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,      mockSessionManager as any,      'user123',      mockUserState as any    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Advance time beyond configured stale threshold
    const staleThresholdMs = config.STALE_PERIOD_THRESHOLD_MS;
    await vi.advanceTimersByTimeAsync(staleThresholdMs + 1000);
    
    // Trigger an event after the stale period
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Late response' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify that stale warning was logged
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'Stale period detected - no events received',
      expect.objectContaining({
        event: 'assistant.message_delta',
        chatId: '888',
        stalePeriodMs: expect.any(Number),
        elapsedMs: expect.any(Number),
      })
    );
    
    // Verify the stale period is above the configured threshold
    const warnCall = loggerWarnSpy.mock.calls.find(
      call => call[0] === 'Stale period detected - no events received'
    );
    expect(warnCall?.[1].stalePeriodMs).toBeGreaterThan(staleThresholdMs);
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    
    loggerWarnSpy.mockRestore();
  });
});
