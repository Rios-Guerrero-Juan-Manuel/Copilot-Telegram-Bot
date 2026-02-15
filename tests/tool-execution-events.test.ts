import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPromptWithStreaming } from '../src/bot/message-handler';

describe('Tool Execution Events', () => {
  let eventSubscriber: ((event: any) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    eventSubscriber = null;
  });

  it('updates unified status message with active tool and completes cleanly', async () => {
    const mockCtx = {
      chat: { id: 5678 },
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
    const mockEditMessageText = vi.fn(async () => ({}));
    const mockBot = {
      api: {
        sendMessage: vi.fn(async () => ({ message_id: 200 })),
        editMessageText: mockEditMessageText,
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
      'Test prompt',
      mockBot,
      mockSessionManager,
      '1234',
      mockUserState
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await eventSubscriber?.({
      type: 'tool.execution_start',
      data: { toolCallId: 'tool-123', toolName: 'test_tool' },
    });
    await eventSubscriber?.({
      type: 'tool.execution_complete',
      data: { toolCallId: 'tool-123', toolName: 'test_tool', durationMs: 1500 },
    });
    await eventSubscriber?.({
      type: 'assistant.message_delta',
      data: { deltaContent: 'Resultado final' },
    });
    await eventSubscriber?.({ type: 'session.idle', data: {} });

    await promise;
    const serializedCalls = mockEditMessageText.mock.calls.map((call) => String(call[2]));
    expect(serializedCalls.some((msg) => msg.includes('⚙️ Ejecutando: test_tool'))).toBe(true);
    expect(mockEditMessageText).toHaveBeenCalledWith(
      '5678',
      100,
      expect.stringMatching(/✅ (Completed|Completado)/),
      { parse_mode: 'HTML' }
    );
  });
});
