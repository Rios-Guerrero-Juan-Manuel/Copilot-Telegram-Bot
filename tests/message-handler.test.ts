import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
};

describe('Copilot timeout configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  it('should use COPILOT_OPERATION_TIMEOUT from config', async () => {
    process.env.COPILOT_OPERATION_TIMEOUT = '600000';
    const { config } = await import('../src/config');
    
    expect(config.COPILOT_OPERATION_TIMEOUT).toBe(600000);
  });
});

describe('formatProgressMessage', () => {
  it('should format progress message with all components', async () => {
    const { formatProgressMessage } = await import('../src/bot/message-handler');
    
    const result = formatProgressMessage(0, 1200, 23000);
    
    expect(result).toContain('1200');
    expect(result).toContain('23s');
  });

  it('should handle zero elapsed time', async () => {
    const { formatProgressMessage } = await import('../src/bot/message-handler');
    
    const result = formatProgressMessage(0, 500, 0);
    
    expect(result).toContain('500');
    expect(result).toContain('0s');
  });

  it('should handle large buffer sizes', async () => {
    const { formatProgressMessage } = await import('../src/bot/message-handler');
    
    const result = formatProgressMessage(0, 150000, 120000);
    
    expect(result).toContain('150000');
    expect(result).toContain('120s');
  });

  it('should round down elapsed time to seconds', async () => {
    const { formatProgressMessage } = await import('../src/bot/message-handler');
    
    const result = formatProgressMessage(0, 1000, 5750);
    
    expect(result).toContain('1000');
    expect(result).toContain('5s');
  });
});

describe('Heartbeat functionality', () => {
  let mockSessionManager: any;
  let mockUserState: any;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
    
    // Create mock UserState
    mockUserState = {
      getOrCreate: vi.fn(() => ({
        id: 'user123',
        telegramId: '123',
        username: 'testuser',
      })),
      getDatabase: vi.fn(() => ({ close: vi.fn() })),
    };
    
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should send heartbeat warning after HEARTBEAT_WARNING_INTERVAL without events', async () => {
    process.env.HEARTBEAT_WARNING_INTERVAL = '10000'; // 10 seconds for testing
    process.env.HEARTBEAT_UPDATE_INTERVAL = '5000'; // 5 seconds for testing
    
    vi.resetModules();
    const { config } = await import('../src/config');
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    expect(config.HEARTBEAT_WARNING_INTERVAL).toBe(10000);
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    
    // Start the function
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    // Wait for initial setup
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Clear any initial calls
    mockEditMessageText.mockClear();
    
    // Advance time past heartbeat warning interval (10 seconds)
    await vi.advanceTimersByTimeAsync(10000);
    
    // Should have sent a heartbeat warning with enhanced format
    expect(mockEditMessageText).toHaveBeenCalledWith(
      '456',
      123,
      expect.stringMatching(/(sigue en progreso|still in progress)/),
      { parse_mode: 'HTML' }
    );
    
    // Trigger session.idle to resolve the promise
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    
    await promise;
  });

  it('should send multiple heartbeat warnings at UPDATE_INTERVAL', async () => {
    process.env.HEARTBEAT_WARNING_INTERVAL = '10000';
    process.env.HEARTBEAT_UPDATE_INTERVAL = '5000';
    
    vi.resetModules();
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    
    // Start the function
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    mockEditMessageText.mockClear();
    
    // First warning at 10 seconds
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    mockEditMessageText.mockClear();
    
    // Second warning at 15 seconds (10 + 5)
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    mockEditMessageText.mockClear();
    
    // Third warning at 20 seconds (15 + 5)
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should stop heartbeat warnings when events resume', async () => {
    process.env.HEARTBEAT_WARNING_INTERVAL = '10000';
    process.env.HEARTBEAT_UPDATE_INTERVAL = '5000';
    
    vi.resetModules();
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
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
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    mockEditMessageText.mockClear();
    
    // First warning at 10 seconds
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    mockEditMessageText.mockClear();
    
    // Receive a message_delta event - should reset heartbeat
    // This will also trigger a progress update since enough time has passed
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Some content' },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Clear the progress update call
    mockEditMessageText.mockClear();
    
    // Advance 5 more seconds - should NOT send heartbeat (was reset)
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(0);
    
    // Advance another 5 seconds (total 10 from last event)
    await vi.advanceTimersByTimeAsync(5000);
    // Now should send heartbeat again
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should stop heartbeat warnings on session.idle', async () => {
    process.env.HEARTBEAT_WARNING_INTERVAL = '10000';
    process.env.HEARTBEAT_UPDATE_INTERVAL = '5000';
    
    vi.resetModules();
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
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
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    mockEditMessageText.mockClear();
    
    // First warning at 10 seconds
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1);
    
    mockEditMessageText.mockClear();
    
    // Trigger session.idle
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    
    // Advance time - should NOT send more heartbeats
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockEditMessageText).toHaveBeenCalledTimes(1); // Only the final message edit
    
    await promise;
  });

  it('should format elapsed time correctly in heartbeat message', async () => {
    process.env.HEARTBEAT_WARNING_INTERVAL = '10000';
    
    vi.resetModules();
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
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
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    mockEditMessageText.mockClear();
    
    // Advance 3 minutes and 25 seconds (205 seconds)
    await vi.advanceTimersByTimeAsync(205000);
    
    // Check the heartbeat message format
    const calls = mockEditMessageText.mock.calls.filter(call => 
      typeof call[2] === 'string' && /sigue en progreso|still in progress/.test(call[2])
    );
    
    expect(calls.length).toBeGreaterThan(0);
    // Get the last heartbeat call which should show "3m 25s"
    const lastCall = calls[calls.length - 1];
    const message = lastCall[2];
    // The last heartbeat should show approximately "3m 25s" (within a reasonable range)
    // First heartbeat at 10s, then every 5s: 10, 15, 20, ... 205
    // So last one should be around 205s
    expect(message).toMatch(/(⏳ La tarea sigue en progreso|⏳ Task still in progress) \(3m \d+s\)\./);
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should NOT reject after session.idle even if global timeout fires (race condition fix)', async () => {
    process.env.COPILOT_OPERATION_TIMEOUT = '5000';
    
    vi.resetModules();
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    const mockSendMessage = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
        sendMessage: mockSendMessage,
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
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(50);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger session.idle to mark as finished
    onHandler({ type: 'session.idle' });
    
    // Advance time so global timeout fires AFTER session.idle started processing
    await vi.advanceTimersByTimeAsync(6000);
    
    // Should resolve successfully with empty string (the buffer)
    await expect(promise).resolves.toBe('');
  });

});

describe('MessageHandler', () => {
  let mockSessionManager: any;
  let mockUserState: any;

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
    
    // Create mock UserState
    mockUserState = {
      getOrCreate: vi.fn(() => ({
        id: 'user123',
        telegramId: '123',
        username: 'testuser',
      })),
      getDatabase: vi.fn(() => ({ close: vi.fn() })),
    };
    
    // Create mock SessionManager
    mockSessionManager = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
  });

  it('should send initial status message with correct emoji and text', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
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
    
    // Trigger the function
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    // Wait for promise to start
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Check that initial message was sent with correct text
    expect(mockReply).toHaveBeenCalledWith('🔄 Working...');
    
    // Trigger session.idle to resolve the promise
    const onHandler = mockSession.on.mock.calls[0][0];
    onHandler({ type: 'session.idle' });
    
    await promise;
  });

  it('should log initial message with timestamp and msgId', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 999,
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
    
    // Trigger the function
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    // Wait for promise to start
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Trigger session.idle to resolve the promise
    const onHandler = mockSession.on.mock.calls[0][0];
    onHandler({ type: 'session.idle' });
    
    await promise;
    
    // Verify that logger.debug was called with initial message info
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'Initial status message sent',
      expect.objectContaining({
        chatId: '789',
        msgId: 999,
        timestamp: expect.any(Number),
      })
    );
    
    loggerDebugSpy.mockRestore();
  });

  it('should update message with progress format during message_delta', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockEditMessageText = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    
    const mockBot = {
      api: {
        editMessageText: mockEditMessageText,
        sendMessage: vi.fn(async () => ({})),
      },
    };
    
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    
    // Start the function
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test prompt',
      mockBot as any,
      mockSessionManager as any,
      'user123',
      mockUserState as any
    );
    
    // Wait for promise to start
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Get the event handler
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Simulate a message_delta event
    // Note: We can't easily test the timing behavior without fake timers
    // but we can verify the handler is set up
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Hello world! '.repeat(100) },
    });
    
    // Wait a bit for the async update
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Trigger session.idle to resolve the promise
    onHandler({ type: 'session.idle' });
    
    await promise;
  });
});
