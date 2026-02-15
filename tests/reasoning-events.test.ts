import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPromptWithStreaming } from '../src/bot/message-handler';
import { logger } from '../src/utils/logger';

describe('Reasoning Events', () => {
  let eventSubscriber: ((event: any) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    eventSubscriber = null;
  });

  it('logs reasoning events without sending separate reasoning messages', async () => {
    const loggerDebugSpy = vi.spyOn(logger, 'debug');
    const mockCtx = {
      chat: { id: 789 },
      from: { username: 'testuser' },
      reply: vi.fn(async () => ({ message_id: 100 })),
    } as any;
    const mockSession = {
      on: vi.fn((callback: (event: any) => void) => {
        eventSubscriber = callback;
        return vi.fn();
      }),
      send: vi.fn(async () => {}),
    } as any;
    const mockBot = {
      api: {
        editMessageText: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({ message_id: 123 })),
        deleteMessage: vi.fn(async () => ({})),
      },
    } as any;
    const mockSessionManager = {
      clearTimeout: vi.fn(),
      getTimeoutExtension: vi.fn(() => 0),
    } as any;
    const mockUserState = {
      getOrCreate: vi.fn(() => ({ id: 1 })),
    } as any;

    const promise = sendPromptWithStreaming(
      mockCtx,
      mockSession,
      'test prompt',
      mockBot,
      mockSessionManager,
      'user123',
      mockUserState
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    eventSubscriber?.({ type: 'assistant.reasoning_delta', data: { deltaContent: 'Thinking...' } });
    eventSubscriber?.({ type: 'assistant.reasoning', data: { content: 'Full reasoning' } });
    eventSubscriber?.({ type: 'session.idle', data: {} });

    await expect(promise).resolves.toBe('');
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'SDK event: assistant.reasoning_delta',
      expect.objectContaining({ userId: 'user123' })
    );
    expect(loggerDebugSpy).toHaveBeenCalledWith(
      'SDK event: assistant.reasoning',
      expect.objectContaining({ userId: 'user123' })
    );
    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockBot.api.editMessageText).toHaveBeenCalledWith(
      '789',
      100,
      expect.stringMatching(/✅ (Completed|Completado)/),
      { parse_mode: 'HTML' }
    );
  });
});
