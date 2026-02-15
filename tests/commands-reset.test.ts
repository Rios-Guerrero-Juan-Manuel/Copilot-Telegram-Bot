import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Bot } from 'grammy';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '2',
};

describe('/new_chat command', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);
  });

  it('should reset active session and clear busy state', async () => {
    const { registerCommands } = await import('../src/bot/commands');
    const { SessionManager } = await import('../src/copilot/session-manager');
    const { UserState } = await import('../src/state/user-state');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');

    const mockSession = {
      destroy: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      on: () => () => {},
    };

    const client = {
      createSession: vi.fn(async () => mockSession),
    };

    const sessionManager = new SessionManager(client as any);
    const userState = new UserState();
    const user = userState.getOrCreate('123', 'testuser');
    const mcpRegistry = new McpRegistry(userState, user.id);
    
    const askUserCancel = vi.fn();
    const tools = {
      all: [],
      askUser: {
        resolveResponse: vi.fn(),
        hasPending: vi.fn(() => false),
        cancel: askUserCancel,
      },
    };

    const replyFn = vi.fn(async () => ({} as any));
    const bot = {
      command: vi.fn((cmd: string, handler: any) => {
        if (cmd === 'new_chat') {
          (bot as any)._newChatHandler = handler;
        }
      }),
      callbackQuery: vi.fn(() => {}),
      on: vi.fn(() => {}),
    } as any as Bot;

    registerCommands(bot, sessionManager, userState, mcpRegistry, tools);

    // Create an active session
    await sessionManager.switchProject('123', 'C:\\temp\\project', {
      model: 'gpt-5-mini',
      tools: [],
    });
    sessionManager.setBusy('123', true);

    // Simulate /new_chat command
    const ctx = {
      from: { id: 123, username: 'testuser' },
      reply: replyFn,
    };

    await (bot as any)._newChatHandler(ctx);

    // Note: abort() may or may not be called depending on session state
    // The important thing is destroy() is called
    
    // Verify session was destroyed
    expect(mockSession.destroy).toHaveBeenCalled();
    
    // Verify askUser was cancelled
    expect(askUserCancel).toHaveBeenCalled();
    
    // Verify busy state was cleared
    expect(sessionManager.isBusy('123')).toBe(false);
    
    // Verify success message
    expect(replyFn).toHaveBeenCalledWith(expect.stringMatching(/chat nuevo creado|new chat created|sesi[oó]n reiniciada|session reset/i));
    
    // Verify no active session
    expect(sessionManager.getActiveSession('123')).toBeUndefined();
  }, 10000);

  it('should respond when no active session exists', async () => {
    const { registerCommands } = await import('../src/bot/commands');
    const { SessionManager } = await import('../src/copilot/session-manager');
    const { UserState } = await import('../src/state/user-state');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');

    const client = {
      createSession: vi.fn(),
    };

    const sessionManager = new SessionManager(client as any);
    const userState = new UserState();
    const user = userState.getOrCreate('456', 'testuser');
    const mcpRegistry = new McpRegistry(userState, user.id);
    
    const tools = {
      all: [],
      askUser: {
        resolveResponse: vi.fn(),
        hasPending: vi.fn(() => false),
        cancel: vi.fn(),
      },
    };

    const replyFn = vi.fn(async () => ({} as any));
    const bot = {
      command: vi.fn((cmd: string, handler: any) => {
        if (cmd === 'new_chat') {
          (bot as any)._newChatHandler = handler;
        }
      }),
      callbackQuery: vi.fn(() => {}),
      on: vi.fn(() => {}),
    } as any as Bot;

    registerCommands(bot, sessionManager, userState, mcpRegistry, tools);

    // Simulate /new_chat command without active session
    const ctx = {
      from: { id: 456, username: 'testuser' },
      reply: replyFn,
    };

    await (bot as any)._newChatHandler(ctx);

    // Verify info message
    expect(replyFn).toHaveBeenCalledWith(expect.stringMatching(/no hay sesi[oó]n activa|no active session/i));
  });

  it('should clear busy state even on error', async () => {
    const { registerCommands } = await import('../src/bot/commands');
    const { SessionManager } = await import('../src/copilot/session-manager');
    const { UserState } = await import('../src/state/user-state');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');

    const mockSession = {
      destroy: vi.fn(async () => {
        throw new Error('Destroy failed');
      }),
      abort: vi.fn(async () => {
        throw new Error('Abort failed');
      }),
      on: () => () => {},
    };

    const client = {
      createSession: vi.fn(async () => mockSession),
    };

    const sessionManager = new SessionManager(client as any);
    const userState = new UserState();
    const user = userState.getOrCreate('789', 'testuser');
    const mcpRegistry = new McpRegistry(userState, user.id);
    
    const tools = {
      all: [],
      askUser: {
        resolveResponse: vi.fn(),
        hasPending: vi.fn(() => false),
        cancel: vi.fn(),
      },
    };

    const replyFn = vi.fn(async () => ({} as any));
    const bot = {
      command: vi.fn((cmd: string, handler: any) => {
        if (cmd === 'new_chat') {
          (bot as any)._newChatHandler = handler;
        }
      }),
      callbackQuery: vi.fn(() => {}),
      on: vi.fn(() => {}),
    } as any as Bot;

    registerCommands(bot, sessionManager, userState, mcpRegistry, tools);

    // Create an active session
    await sessionManager.switchProject('789', 'C:\\temp\\project', {
      model: 'gpt-5-mini',
      tools: [],
    });
    sessionManager.setBusy('789', true);

    // Simulate /new_chat command
    const ctx = {
      from: { id: 789, username: 'testuser' },
      reply: replyFn,
    };

    await (bot as any)._newChatHandler(ctx);

    // Verify busy state was cleared even though operations failed
    expect(sessionManager.isBusy('789')).toBe(false);
    
    // Verify error was reported
    expect(replyFn).toHaveBeenCalledWith(
      expect.stringMatching(/error.*reiniciar|error.*reset/i)
    );
  });

  it('should log reset action with user ID and project path', async () => {
    const { registerCommands } = await import('../src/bot/commands');
    const { SessionManager } = await import('../src/copilot/session-manager');
    const { UserState } = await import('../src/state/user-state');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');
    const { logger } = await import('../src/utils/logger');

    const mockSession = {
      destroy: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      on: () => () => {},
    };

    const client = {
      createSession: vi.fn(async () => mockSession),
    };

    const sessionManager = new SessionManager(client as any);
    const userState = new UserState();
    const user = userState.getOrCreate('999', 'testuser');
    const mcpRegistry = new McpRegistry(userState, user.id);
    
    const tools = {
      all: [],
      askUser: {
        resolveResponse: vi.fn(),
        hasPending: vi.fn(() => false),
        cancel: vi.fn(),
      },
    };

    const replyFn = vi.fn(async () => ({} as any));
    const bot = {
      command: vi.fn((cmd: string, handler: any) => {
        if (cmd === 'new_chat') {
          (bot as any)._newChatHandler = handler;
        }
      }),
      callbackQuery: vi.fn(() => {}),
      on: vi.fn(() => {}),
    } as any as Bot;

    const loggerInfoSpy = vi.spyOn(logger, 'info');

    registerCommands(bot, sessionManager, userState, mcpRegistry, tools);

    // Create an active session
    await sessionManager.switchProject('999', 'C:\\temp\\myproject', {
      model: 'gpt-5-mini',
      tools: [],
    });

    // Simulate /new_chat command
    const ctx = {
      from: { id: 999, username: 'testuser' },
      reply: replyFn,
    };

    await (bot as any)._newChatHandler(ctx);

    // Verify logging
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'Session reset requested',
      expect.objectContaining({
        telegramId: '999',
        projectPath: 'C:\\temp\\myproject',
      })
    );
  });
});
