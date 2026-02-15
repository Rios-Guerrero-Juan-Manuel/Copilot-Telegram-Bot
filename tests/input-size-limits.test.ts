import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
};

describe('Input Size Limits Configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should use default MAX_INPUT_SIZE_BYTES of 1MB when not set', async () => {
    const { config } = await import('../src/config');
    
    expect(config.MAX_INPUT_SIZE_BYTES).toBe(1_048_576); // 1MB
  });

  it('should use custom MAX_INPUT_SIZE_BYTES from env', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '2097152'; // 2MB
    const { config } = await import('../src/config');
    
    expect(config.MAX_INPUT_SIZE_BYTES).toBe(2_097_152);
  });

  it('should use default MAX_BUFFER_SIZE_BYTES of 5MB when not set', async () => {
    const { config } = await import('../src/config');
    
    expect(config.MAX_BUFFER_SIZE_BYTES).toBe(5_242_880); // 5MB
  });

  it('should use custom MAX_BUFFER_SIZE_BYTES from env', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10485760'; // 10MB
    const { config } = await import('../src/config');
    
    expect(config.MAX_BUFFER_SIZE_BYTES).toBe(10_485_760);
  });
});

describe('Message Size Validation', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should allow messages under the size limit', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024'; // 1KB for testing
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    
    const smallMessage = 'a'.repeat(500); // 500 bytes
    const result = await validateMessageSize(smallMessage, {} as any);
    
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(smallMessage);
    expect(result.warning).toBeUndefined();
  });

  it('should truncate messages over the size limit', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024'; // 1KB for testing
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    
    const largeMessage = 'a'.repeat(2048); // 2KB
    const result = await validateMessageSize(largeMessage, { reply: vi.fn() } as any);
    
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1024);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/⚠️ Mensaje demasiado grande/);
  });

  it('should handle multi-byte UTF-8 characters correctly', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024';
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    
    // Emoji are 4 bytes each
    const emojiMessage = '😀'.repeat(300); // 1200 bytes
    const result = await validateMessageSize(emojiMessage, { reply: vi.fn() } as any);
    
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(1024);
  });

  it('should send warning message to user when truncating', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024';
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn();
    const mockCtx = {
      reply: mockReply,
    };
    
    const largeMessage = 'a'.repeat(2048);
    await validateMessageSize(largeMessage, mockCtx as any);
    
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringMatching(/⚠️ Mensaje demasiado grande/)
    );
  });

  it('should include size information in warning message', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024'; // 1KB
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn();
    const mockCtx = { reply: mockReply };
    
    const largeMessage = 'a'.repeat(2048); // 2KB
    await validateMessageSize(largeMessage, mockCtx as any);
    
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringMatching(/2\.00KB/)
    );
    expect(mockReply).toHaveBeenCalledWith(
      expect.stringMatching(/1\.00KB/)
    );
  });

  it('should log truncation events', async () => {
    process.env.MAX_INPUT_SIZE_BYTES = '1024';
    vi.resetModules();
    
    const { validateMessageSize } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerWarnSpy = vi.spyOn(logger, 'warn');
    
    const mockCtx = { reply: vi.fn() };
    const largeMessage = 'a'.repeat(2048);
    await validateMessageSize(largeMessage, mockCtx as any);
    
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'Input message too large, truncating',
      expect.objectContaining({
        sizeBytes: 2048,
        maxBytes: 1024,
      })
    );
    
    loggerWarnSpy.mockRestore();
  });
});

describe('Buffer Size Validation (Streaming)', () => {
  const mockUserState = {
    getOrCreate: vi.fn(() => ({ id: 1, locale: 'en' })),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('should allow streaming buffer under size limit', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10240'; // 10KB for testing
    vi.resetModules();
    
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async () => ({ message_id: 123 }));
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
    const mockSessionManager: any = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test',
      mockBot as any,
      mockSessionManager,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Send a small message delta
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'a'.repeat(1000) }, // 1KB
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Should not have sent any buffer warning
    expect(mockBot.api.sendMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/Buffer de streaming muy grande/)
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should warn when streaming buffer exceeds size limit', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10240'; // 10KB for testing
    vi.resetModules();
    
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async () => ({ message_id: 123 }));
    const mockSendMessage = vi.fn(async () => ({}));
    const mockEditMessageText = vi.fn(async () => ({}));
    
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
    const mockSessionManager: any = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test',
      mockBot as any,
      mockSessionManager,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // Send a large message delta
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'a'.repeat(20000) }, // ~20KB > 10KB limit
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Should have sent buffer size warning
    expect(mockSendMessage).toHaveBeenCalledWith(
      '456',
      expect.stringMatching(/⚠️ Buffer de streaming muy grande/)
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should include buffer size in warning message', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10240';
    vi.resetModules();
    
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async () => ({ message_id: 123 }));
    const mockSendMessage = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: mockSendMessage,
      },
    };
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    const mockSessionManager: any = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test',
      mockBot as any,
      mockSessionManager,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'a'.repeat(20480) }, // 20KB
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Should show size in KB
    expect(mockSendMessage).toHaveBeenCalledWith(
      '456',
      expect.stringMatching(/20\.00KB/)
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should log buffer size warnings', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10240';
    vi.resetModules();
    
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerWarnSpy = vi.spyOn(logger, 'warn');
    
    const mockReply = vi.fn(async () => ({ message_id: 123 }));
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
    const mockSessionManager: any = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test',
      mockBot as any,
      mockSessionManager,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'a'.repeat(20000) },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      'Streaming buffer size exceeded limit',
      expect.objectContaining({
        bufferSize: 20000,
        maxBufferSize: 10240,
      })
    );
    
    loggerWarnSpy.mockRestore();
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should only warn once per buffer overflow', async () => {
    process.env.MAX_BUFFER_SIZE_BYTES = '10240';
    vi.resetModules();
    
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async () => ({ message_id: 123 }));
    const mockSendMessage = vi.fn(async () => ({}));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
    };
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: mockSendMessage,
      },
    };
    const mockCtx = {
      chat: { id: 456 },
      reply: mockReply,
    };
    const mockSessionManager: any = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      getOriginalTimeout: vi.fn(() => null),
      getTimeoutExtension: vi.fn(() => 0),
      extendTimeout: vi.fn(() => false),
    };
    
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'test',
      mockBot as any,
      mockSessionManager,
      'user123',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    const onHandler = mockSession.on.mock.calls[0][0];
    
    // First overflow
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'a'.repeat(20000) },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    mockSendMessage.mockClear();
    
    // Second overflow - should not send another warning
    onHandler({
      type: 'assistant.message_delta',
      data: { deltaContent: 'b'.repeat(500) },
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      '456',
      expect.stringMatching(/⚠️ Buffer de streaming muy grande/)
    );
    
    // Cleanup
    onHandler({ type: 'session.idle' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });
});
