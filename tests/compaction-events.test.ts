import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
};

describe('Session Compaction Events', () => {
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
    
    // Create mock UserState
    mockUserState = {
      getOrCreate: vi.fn(() => ({
        id: 1,
        telegram_id: '456',
        username: 'testuser',
      })),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should log compaction_start event with structured data', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerInfoSpy = vi.spyOn(logger, 'info');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger compaction_start event
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify logging
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Session compaction started',
      expect.objectContaining({
        userId: '456',
        timestamp: expect.any(String),
      })
    );
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should log compaction_complete with metrics and calculate duration', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerInfoSpy = vi.spyOn(logger, 'info');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger compaction_start event
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    // Advance time by 2 seconds
    await vi.advanceTimersByTimeAsync(2000);
    
    // Trigger compaction_complete event
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { 
        success: true, 
        compactedTokens: 1500 
      } 
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify logging with duration
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Session compaction completed',
      expect.objectContaining({
        userId: '456',
        durationMs: expect.any(Number),
        success: true,
        compactedTokens: 1500,
      })
    );
    
    // Verify duration is approximately 2000ms (with some tolerance)
    const logCall = loggerInfoSpy.mock.calls.find(
      (call: any) => call[0] === 'Session compaction completed'
    );
    expect(logCall[1].durationMs).toBeGreaterThanOrEqual(1900);
    expect(logCall[1].durationMs).toBeLessThanOrEqual(2100);
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should send user notification if compaction takes longer than 5 seconds', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger compaction_start
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    // Advance time by 6 seconds (> 5 second threshold)
    await vi.advanceTimersByTimeAsync(6000);
    
    // Trigger compaction_complete
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { success: true } 
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify notification was sent
    expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
      123,
      '⚙️ Optimizando historial de conversación...',
      { parse_mode: 'HTML' }
    );
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should not send notification if compaction takes less than 5 seconds', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger compaction_start
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    // Advance time by 3 seconds (< 5 second threshold)
    await vi.advanceTimersByTimeAsync(3000);
    
    // Trigger compaction_complete
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { success: true } 
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify notification was NOT sent
    expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should handle compaction errors and log them', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerInfoSpy = vi.spyOn(logger, 'info');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // Trigger compaction_start
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    // Advance time
    await vi.advanceTimersByTimeAsync(1000);
    
    // Trigger compaction_complete with error
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { 
        success: false, 
        error: 'Compaction failed due to token limit' 
      } 
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Verify error was logged
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Session compaction completed',
      expect.objectContaining({
        userId: '456',
        success: false,
        error: 'Compaction failed due to token limit',
      })
    );
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });

  it('should reset compactionStartTime after compaction_complete', async () => {
    const { sendPromptWithStreaming } = await import('../src/bot/message-handler');
    const { logger } = await import('../src/utils/logger');
    
    const loggerInfoSpy = vi.spyOn(logger, 'info');
    
    const mockReply = vi.fn(async (text: string) => ({
      message_id: 123,
    }));
    
    const mockSession = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async () => {}),
      id: 'test-session-id',
    };
    
    const mockBot = {
      api: {
        sendMessage: vi.fn(),
        editMessageText: vi.fn(),
      },
    };
    
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456, username: 'testuser' },
      reply: mockReply,
    };
    
    // Start streaming
    const promise = sendPromptWithStreaming(
      mockCtx as any,
      mockSession as any,
      'Test message',
      mockBot as any,
      mockSessionManager,
      '456',
      mockUserState as any
    );
    
    await vi.advanceTimersByTimeAsync(100);
    
    // Get the event handler
    const eventHandler = mockSession.on.mock.calls[0][0];
    
    // First compaction cycle
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    await vi.advanceTimersByTimeAsync(2000);
    
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { success: true } 
    });
    
    // Clear previous spy calls
    loggerInfoSpy.mockClear();
    
    // Second compaction cycle - start immediately after first complete
    eventHandler({ type: 'session.compaction_start', data: {} });
    
    await vi.advanceTimersByTimeAsync(1500);
    
    // Trigger second compaction_complete
    await eventHandler({ 
      type: 'session.compaction_complete', 
      data: { success: true } 
    });
    
    await vi.advanceTimersByTimeAsync(100);
    
    // The duration for the second compaction should be ~1500ms, not accumulated
    const secondCompactionLog = loggerInfoSpy.mock.calls.find(
      (call: any) => call[0] === 'Session compaction completed'
    );
    
    expect(secondCompactionLog).toBeDefined();
    expect(secondCompactionLog[1].durationMs).toBeGreaterThanOrEqual(1400);
    expect(secondCompactionLog[1].durationMs).toBeLessThanOrEqual(1600);
    
    // Cleanup
    eventHandler({ type: 'session.idle', data: {} });
    await vi.advanceTimersByTimeAsync(100);
    await promise;
  });
});
