import { beforeEach, describe, expect, it, vi } from 'vitest';

const isPathAllowedMock = vi.fn(() => false);
const isAdminUserMock = vi.fn(() => false);
const createAllowPathRequestMock = vi.fn(() => 'token123');

vi.mock('../src/config', () => ({
  config: {
    LOG_DIR: './logs',
    LOG_LEVEL: 'info',
    LOG_MAX_SIZE: '20m',
    LOG_MAX_FILES: '14d',
    LOG_DATE_PATTERN: 'YYYY-MM-DD',
    TELEGRAM_CHAT_ID: '123',
  },
  isPathAllowed: (...args: unknown[]) => isPathAllowedMock(...args),
}));

vi.mock('../src/bot/allowlist-admin', () => ({
  isAdminUser: (...args: unknown[]) => isAdminUserMock(...args),
  createAllowPathRequest: (...args: unknown[]) => createAllowPathRequestMock(...args),
}));

describe('commands-session /plan allowpath prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function registerWithMocks() {
    const handlers = new Map<string, any>();
    const bot = {
      command: vi.fn((name: string, handler: any) => handlers.set(name, handler)),
      on: vi.fn(),
    } as any;

    const sessionManager = {
      isBusy: vi.fn(() => false),
    } as any;

    const userState = {
      getOrCreate: vi.fn(() => ({ id: 1 })),
      getCurrentCwd: vi.fn(() => 'D:\\Juanma\\MCP Copilot Telegram'),
      getCurrentModel: vi.fn(() => 'claude-sonnet-4.5'),
    } as any;

    const mcpRegistry = { getEnabled: vi.fn(() => []) } as any;
    const tools = {
      all: [],
      userInputHandler: vi.fn(),
      askUser: { cancel: vi.fn() },
    } as any;
    const db = {} as any;

    return { bot, handlers, sessionManager, userState, mcpRegistry, tools, db };
  }

  it('should show admin Yes/No buttons when /plan cwd is blocked', async () => {
    isPathAllowedMock.mockReturnValue(false);
    isAdminUserMock.mockReturnValue(true);

    const { registerSessionCommands } = await import('../src/bot/commands-session');
    const { bot, handlers, sessionManager, userState, mcpRegistry, tools, db } = registerWithMocks();
    registerSessionCommands(bot, sessionManager, userState, mcpRegistry, tools, db);

    const reply = vi.fn().mockResolvedValue({});
    await handlers.get('plan')({
      from: { id: 123, username: 'admin' },
      message: { text: '/plan revisar estado' },
      reply,
    });

    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1][1]?.reply_markup?.inline_keyboard?.[0]).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/Sí|Yes/i) }),
      expect.objectContaining({ text: expect.stringMatching(/No/i) }),
    ]);
    expect(createAllowPathRequestMock).toHaveBeenCalled();
  });

  it('should not show admin buttons for non-admin user', async () => {
    isPathAllowedMock.mockReturnValue(false);
    isAdminUserMock.mockReturnValue(false);

    const { registerSessionCommands } = await import('../src/bot/commands-session');
    const { bot, handlers, sessionManager, userState, mcpRegistry, tools, db } = registerWithMocks();
    registerSessionCommands(bot, sessionManager, userState, mcpRegistry, tools, db);

    const reply = vi.fn().mockResolvedValue({});
    await handlers.get('plan')({
      from: { id: 456, username: 'user' },
      message: { text: '/plan revisar estado' },
      reply,
    });

    expect(reply).toHaveBeenCalledTimes(1);
    expect(createAllowPathRequestMock).not.toHaveBeenCalled();
  });
});
