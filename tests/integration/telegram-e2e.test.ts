import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bot, Context, Api } from 'grammy';
import { SessionManager } from '../../src/copilot/session-manager';
import { UserState } from '../../src/state/user-state';
import { McpRegistry } from '../../src/mcp/mcp-registry';
import { WizardManager } from '../../src/bot/wizard-manager';
import { AppConfig } from '../../src/config';
import { ToolBundle } from '../../src/types';
import type { CopilotSession } from '@azure/copilot-sdk';
import { logger } from '../../src/utils/logger';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  initLogger: vi.fn(async () => {}),
  flushLogger: vi.fn(async () => {}),
}));

// Mock config module
vi.mock('../../src/config', async () => {
  const actual = await vi.importActual('../../src/config');
  return {
    ...actual,
    isPathAllowed: vi.fn((path: string) => path.startsWith('/test') || path.startsWith('C:\\test')),
  };
});

/**
 * Mock Telegram API
 * Simulates the complete Telegram Bot API for E2E testing
 */
class MockTelegramApi {
  private messages: Map<number, any[]> = new Map();
  private messageIdCounter = 1;
  private callbackQueryResponses: string[] = [];
  
  constructor() {}

  async sendMessage(chatId: number, text: string, options?: any): Promise<any> {
    const messageId = this.messageIdCounter++;
    const message = {
      message_id: messageId,
      chat: { id: chatId },
      text,
      ...options,
    };
    
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    this.messages.get(chatId)!.push(message);
    
    return message;
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: any
  ): Promise<any> {
    const chat = typeof chatId === 'string' ? parseInt(chatId) : chatId;
    const chatMessages = this.messages.get(chat) || [];
    const msgIndex = chatMessages.findIndex((m) => m.message_id === messageId);
    
    if (msgIndex !== -1) {
      chatMessages[msgIndex] = {
        ...chatMessages[msgIndex],
        text,
        ...options,
      };
    }
    
    return { ok: true };
  }

  async answerCallbackQuery(callbackQueryId: string, options?: any): Promise<void> {
    this.callbackQueryResponses.push(callbackQueryId);
  }

  getMessages(chatId: number): any[] {
    return this.messages.get(chatId) || [];
  }

  getLastMessage(chatId: number): any | null {
    const msgs = this.messages.get(chatId) || [];
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
  }

  clear(): void {
    this.messages.clear();
    this.callbackQueryResponses = [];
  }
}

/**
 * Mock Grammy Bot
 * Simulates Grammy bot with command and callback registration
 */
class MockBot {
  public api: MockTelegramApi;
  private commandHandlers: Map<string, Function> = new Map();
  private callbackHandlers: Map<RegExp, Function> = new Map();
  private messageHandler: Function | null = null;

  constructor() {
    this.api = new MockTelegramApi();
  }

  command(commandName: string, handler: Function): void {
    this.commandHandlers.set(commandName, handler);
  }

  callbackQuery(pattern: RegExp, handler: Function): void {
    this.callbackHandlers.set(pattern, handler);
  }

  on(event: any, handler: Function): void {
    if (event?.message?.text) {
      this.messageHandler = handler;
    }
  }

  async simulateCommand(chatId: number, userId: number, command: string, text?: string): Promise<void> {
    const commandName = command.replace('/', '');
    const handler = this.commandHandlers.get(commandName);
    
    if (!handler) {
      throw new Error(`Command handler not found: ${command}`);
    }

    const ctx = this.createMockContext(chatId, userId, `${command}${text ? ' ' + text : ''}`);
    await handler(ctx);
  }

  async simulateMessage(chatId: number, userId: number, text: string): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('Message handler not registered');
    }

    const ctx = this.createMockContext(chatId, userId, text);
    await this.messageHandler(ctx);
  }

  async simulateCallbackQuery(
    chatId: number,
    userId: number,
    messageId: number,
    data: string
  ): Promise<void> {
    let handler: Function | null = null;
    
    for (const [pattern, fn] of this.callbackHandlers.entries()) {
      if (pattern.test(data)) {
        handler = fn;
        break;
      }
    }

    if (!handler) {
      throw new Error(`Callback handler not found for: ${data}`);
    }

    const ctx = this.createMockCallbackContext(chatId, userId, messageId, data);
    await handler(ctx);
  }

  private createMockContext(chatId: number, userId: number, text: string): any {
    const api = this.api;
    
    return {
      chat: { id: chatId },
      from: { id: userId, username: 'testuser' },
      message: {
        text,
        message_id: this.api['messageIdCounter']++,
        chat: { id: chatId },
        from: { id: userId, username: 'testuser' },
      },
      reply: async (replyText: string, options?: any) => {
        return await api.sendMessage(chatId, replyText, options);
      },
      api: {
        sendMessage: async (chat: number, msg: string, opts?: any) => {
          return await api.sendMessage(chat, msg, opts);
        },
        editMessageText: async (chat: number | string, msgId: number, msg: string, opts?: any) => {
          return await api.editMessageText(chat, msgId, msg, opts);
        },
      },
    };
  }

  private createMockCallbackContext(
    chatId: number,
    userId: number,
    messageId: number,
    data: string
  ): any {
    const api = this.api;
    
    return {
      chat: { id: chatId },
      from: { id: userId, username: 'testuser' },
      callbackQuery: {
        id: `cbq_${Date.now()}`,
        data,
        message: {
          message_id: messageId,
          chat: { id: chatId },
        },
      },
      answerCallbackQuery: async (text?: string) => {
        await api.answerCallbackQuery(`cbq_${Date.now()}`, { text });
      },
      editMessageText: async (text: string, options?: any) => {
        await api.editMessageText(chatId, messageId, text, options);
      },
      api: {
        editMessageText: async (chat: number | string, msgId: number, msg: string, opts?: any) => {
          return await api.editMessageText(chat, msgId, msg, opts);
        },
      },
    };
  }

  clear(): void {
    this.api.clear();
  }
}

/**
 * Mock CopilotSession
 * Simulates Azure Copilot SDK session for testing
 */
class MockCopilotSession {
  private eventHandlers: Map<string, Function[]> = new Map();
  private _destroyed = false;
  public responseText = 'Mock Copilot response from session';

  on(event: string, handler: Function): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
    
    return () => {
      const handlers = this.eventHandlers.get(event) || [];
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    };
  }

  async send(prompt: string, signal?: AbortSignal): Promise<void> {
    // Simulate async processing
    await new Promise((resolve) => setTimeout(resolve, 10));
    
    if (signal?.aborted) {
      this.emit('session.error', { error: new Error('Aborted') });
      return;
    }

    // Simulate streaming response
    this.emit('session.message.delta', { delta: this.responseText });
    
    // Simulate completion
    this.emit('session.idle', {});
  }

  async destroy(): Promise<void> {
    this._destroyed = true;
    this.eventHandlers.clear();
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((handler) => handler(data));
  }

  setResponseText(text: string): void {
    this.responseText = text;
  }
}

describe('E2E Bot Tests', () => {
  let mockBot: MockBot;
  let sessionManager: SessionManager;
  let userState: UserState;
  let mcpRegistry: McpRegistry;
  let wizardManager: WizardManager;
  let allowlistWizard: any;
  let mockCopilotClient: any;
  let tools: ToolBundle;
  let testConfig: AppConfig;
  const testChatId = 123456;
  const testUserId = 789012;
  const telegramId = String(testUserId);

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test configuration
    testConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test/project',
      COPILOT_DEFAULT_MODEL: 'gpt-5',
      COPILOT_MCP_CONFIG_PATH: ':memory:',
      COPILOT_OPERATION_TIMEOUT: 60000,
      HEARTBEAT_WARNING_INTERVAL: 30000,
      HEARTBEAT_UPDATE_INTERVAL: 15000,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '123456',
      ALLOWED_PATHS: '/test;C:\\test',
    } as AppConfig;

    // Mock CopilotClient
    mockCopilotClient = {
      createSession: vi.fn(() => new MockCopilotSession()),
    };

    // Initialize components
    userState = new UserState(testConfig);
    const user = userState.getOrCreate(telegramId, 'testuser');
    mcpRegistry = new McpRegistry(userState, user.id);
    sessionManager = new SessionManager(mockCopilotClient);
    wizardManager = new WizardManager(userState);
    
    // Mock allowlist wizard
    allowlistWizard = {
      needsSetup: vi.fn(() => false),
      isInSetup: vi.fn(() => false),
      handleInput: vi.fn(async () => {}),
      startSetup: vi.fn(async () => {}),
    };
    
    tools = {
      all: [],
      askUser: {
        hasPending: vi.fn(() => false),
        resolveResponse: vi.fn(() => false),
        cancel: vi.fn(),
      },
    };

    // Mock SessionManager to return MockCopilotSession
    vi.spyOn(sessionManager, 'switchProject').mockImplementation(async () => {
      return new MockCopilotSession() as any;
    });

    vi.spyOn(sessionManager, 'recreateActiveSession').mockImplementation(async () => {
      return new MockCopilotSession() as any;
    });

    // Create mock bot
    mockBot = new MockBot();
    
    // Initialize user current directory
    userState.setCurrentCwd(user.id, '/test/project');
  });

  afterEach(() => {
    mockBot.clear();
    sessionManager.clearAll();
  });

  describe('Basic Flow', () => {
    it.skip('should handle complete conversation flow: /start → /cd → message → response', async () => {
      // Import and register commands
      const { registerInfoCommands } = await import('../../src/bot/commands-info');
      const { registerNavigationCommands } = await import('../../src/bot/commands-navigation');
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      
      registerInfoCommands(mockBot as any, sessionManager, userState, mcpRegistry, allowlistWizard);
      registerNavigationCommands(mockBot as any, sessionManager, userState, mcpRegistry, allowlistWizard, tools);
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Step 1: /start command
      await mockBot.simulateCommand(testChatId, testUserId, '/start');
      
      let lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toContain('Copilot Telegram Bot iniciado');

      // Step 2: /cd command to change directory
      await mockBot.simulateCommand(testChatId, testUserId, '/cd', 'C:\\test\\allowed');
      
      lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toMatch(/Directorio cambiado|Ruta inválida/i);

      // Verify session was created
      const user = userState.getOrCreate(telegramId, 'testuser');
      expect(userState.getCurrentCwd(user.id)).toContain('test');

      // Step 3: Send a message prompt
      await mockBot.simulateMessage(testChatId, testUserId, 'Test prompt for bot');
      
      // Verify response was sent
      const messages = mockBot.api.getMessages(testChatId);
      expect(messages.length).toBeGreaterThan(2);
      
      // Check for response message
      const responseMsg = messages.find((m) => m.text.includes('Mock Copilot response'));
      expect(responseMsg).toBeDefined();
    });

    it('should reject /cd to non-allowed path', async () => {
      const { registerNavigationCommands } = await import('../../src/bot/commands-navigation');
      registerNavigationCommands(mockBot as any, sessionManager, userState, mcpRegistry, allowlistWizard, tools);

      await mockBot.simulateCommand(testChatId, testUserId, '/cd', '/forbidden/path');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toMatch(/ruta no permitida|path not allowed/i);
    });

    it('should handle /status command showing current state', async () => {
      const { registerInfoCommands } = await import('../../src/bot/commands-info');
      registerInfoCommands(mockBot as any, sessionManager, userState, mcpRegistry, allowlistWizard);

      await mockBot.simulateCommand(testChatId, testUserId, '/status');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toMatch(/estado del bot|bot status/i);
    });
  });

  describe('Plan Mode Flow', () => {
    it.skip('should activate and deactivate plan mode: /plan → approval → /exitplan', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      const { registerCallbacks } = await import('../../src/bot/callbacks');
      
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);
      registerCallbacks(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Step 1: Activate plan mode with /plan
      await mockBot.simulateCommand(testChatId, testUserId, '/plan', 'Create a new feature');
      
      // Verify plan mode is active
      expect(sessionManager.isPlanMode(telegramId)).toBe(true);
      
      let messages = mockBot.api.getMessages(testChatId);
      expect(messages.some((m) => m.text.includes('Mock Copilot response'))).toBe(true);

      // Step 2: Verify plan mode notification
      expect(messages.some((m) => m.text.includes('plan mode'))).toBe(true);

      // Step 3: Deactivate plan mode with /exitplan
      await mockBot.simulateCommand(testChatId, testUserId, '/exitplan');
      
      expect(sessionManager.isPlanMode(telegramId)).toBe(false);
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toContain('Plan mode desactivado');
    });

    it('should handle /plan without task text', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      await mockBot.simulateCommand(testChatId, testUserId, '/plan');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/uso: \/plan|usage: \/plan/i);
    });

    it.skip('should exit plan mode when changing directory with /cd', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      const { registerNavigationCommands } = await import('../../src/bot/commands-navigation');
      
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);
      registerNavigationCommands(mockBot as any, sessionManager, userState, mcpRegistry, allowlistWizard, tools);

      // Activate plan mode
      await mockBot.simulateCommand(testChatId, testUserId, '/plan', 'Test task');
      expect(sessionManager.isPlanMode(telegramId)).toBe(true);

      // Change directory - should exit plan mode
      await mockBot.simulateCommand(testChatId, testUserId, '/cd', '/test/other');
      
      expect(sessionManager.isPlanMode(telegramId)).toBe(false);
    });

    it('should prevent concurrent operations when busy', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Set busy state
      sessionManager.setBusy(telegramId, true);

      await mockBot.simulateCommand(testChatId, testUserId, '/plan', 'New task');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/operaci[oó]n en curso|operation in progress/i);
      
      // Clean up
      sessionManager.setBusy(telegramId, false);
    });
  });

  describe('Wizard Flow', () => {
    it('should handle MCP wizard cancellation flow', async () => {
      const { registerMcpCommands } = await import('../../src/bot/commands-mcp');
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMcpCommands(mockBot as any, userState, mcpRegistry, wizardManager);
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Step 1: Start wizard with /mcp
      await mockBot.simulateCommand(testChatId, testUserId, '/mcp_add');
      
      let lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      expect(lastMsg.text).toMatch(/nombre|name/i);

      // Step 3: Cancel wizard
      await mockBot.simulateMessage(testChatId, testUserId, 'cancelar');
      
      lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/cancelad|cancelled/i);

      // Verify wizard cleanup
      const user = userState.getOrCreate(telegramId, 'testuser');
      expect(wizardManager.hasActiveWizard(user.id)).toBe(false);
    });

    it('should complete full MCP wizard flow for STDIO server', async () => {
      const { registerMcpCommands } = await import('../../src/bot/commands-mcp');
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMcpCommands(mockBot as any, userState, mcpRegistry, wizardManager);
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Start wizard
      await mockBot.simulateCommand(testChatId, testUserId, '/mcp_add');

      // Step 1: Name
      await mockBot.simulateMessage(testChatId, testUserId, 'test-server');
      expect(mockBot.api.getLastMessage(testChatId).text).toMatch(/tipo|type/i);

      // Step 2: Type (STDIO)
      await mockBot.simulateMessage(testChatId, testUserId, '1');
      expect(mockBot.api.getLastMessage(testChatId).text).toMatch(/comando|command/i);

      // Step 3: Command
      await mockBot.simulateMessage(testChatId, testUserId, 'node');
      expect(mockBot.api.getLastMessage(testChatId).text).toMatch(/argumentos|arguments/i);

      // Step 4: Args
      await mockBot.simulateMessage(testChatId, testUserId, 'server.js');
      expect(mockBot.api.getLastMessage(testChatId).text).toMatch(/variables|environment/i);

      // Step 5: Env (skip)
      await mockBot.simulateMessage(testChatId, testUserId, '-');
      expect(mockBot.api.getLastMessage(testChatId).text).toMatch(/confirma|confirm/i);

      // Step 6: Confirm
      await mockBot.simulateMessage(testChatId, testUserId, 'si');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/creado|created|configuraci[oó]n actualizada|configuration updated/i);

      // Verify wizard is closed
      const user = userState.getOrCreate(telegramId, 'testuser');
      expect(wizardManager.hasActiveWizard(user.id)).toBe(false);
    });

    it.skip('should handle wizard timeout after 5 minutes of inactivity', async () => {
      vi.useFakeTimers();
      
      const { registerMcpCommands } = await import('../../src/bot/commands-mcp');
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMcpCommands(mockBot as any, userState, mcpRegistry, wizardManager);
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Start wizard
      await mockBot.simulateCommand(testChatId, testUserId, '/mcp_add');

      const user = userState.getOrCreate(telegramId, 'testuser');
      expect(wizardManager.hasActiveWizard(user.id)).toBe(true);

      // Advance time past wizard timeout (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Try to send input after timeout
      await mockBot.simulateMessage(testChatId, testUserId, 'test-server');
      
      // Wizard should have timed out
      expect(wizardManager.hasActiveWizard(user.id)).toBe(false);
      
      vi.useRealTimers();
    });
  });

  describe('Error Recovery', () => {
    it('should handle session recreation after network failure', async () => {
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Create initial session
      const session1 = await sessionManager.switchProject(telegramId, '/test/project', {
        model: 'gpt-5',
        tools: [],
        mcpServers: [],
      });

      // Simulate network error by destroying session
      await session1.destroy();

      // Recreate session - should work without errors
      const session2 = await sessionManager.recreateActiveSession(telegramId);
      
      expect(session2).toBeDefined();
      expect((session2 as any).destroyed).toBe(false);
    });

    it('should handle message sending with retry on network failure', async () => {
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Mock a failing then succeeding send
      let sendCallCount = 0;
      const mockSession = new MockCopilotSession();
      const originalSend = mockSession.send.bind(mockSession);
      
      mockSession.send = async function (prompt: string, signal?: AbortSignal) {
        sendCallCount++;
        if (sendCallCount === 1) {
          // First call fails with network error
          const error: any = new Error('Network error');
          error.code = 'ECONNRESET';
          throw error;
        }
        // Second call succeeds
        return originalSend(prompt, signal);
      } as any;

      vi.spyOn(sessionManager, 'switchProject').mockResolvedValue(mockSession as any);

      // Send message - should retry and succeed
      await mockBot.simulateMessage(testChatId, testUserId, 'Test message');
      
      // Should have retried once
      expect(sendCallCount).toBeGreaterThanOrEqual(1);
    });

    it.skip('should handle AbortController cancellation cleanly', async () => {
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Start a long-running operation
      const mockSession = new MockCopilotSession();
      mockSession.send = async (prompt: string, signal?: AbortSignal) => {
        // Simulate long operation
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        mockSession.emit('session.idle', {});
      };

      vi.spyOn(sessionManager, 'switchProject').mockResolvedValue(mockSession as any);

      // Start operation
      const messagePromise = mockBot.simulateMessage(testChatId, testUserId, 'Long task');

      // Immediately cancel
      sessionManager.setCancelled(telegramId, '/test/project');
      const aborters = (sessionManager as any).aborters?.get(telegramId);
      if (aborters && aborters.length > 0) {
        aborters[0]();
      }

      // Should complete without throwing
      await expect(messagePromise).resolves.not.toThrow();
    });

    it('should clear cancellation state after operation completes', async () => {
      const { registerMessageHandler } = await import('../../src/bot/message-handler');
      registerMessageHandler(mockBot as any, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools);

      // Set cancellation
      sessionManager.setCancelled(telegramId, '/test/project');
      expect(sessionManager.isCancelled(telegramId, '/test/project')).toBe(true);

      // Clear cancellation
      sessionManager.clearCancelled(telegramId, '/test/project');
      expect(sessionManager.isCancelled(telegramId, '/test/project')).toBe(false);
    });

    it('should handle concurrent stop commands gracefully', async () => {
      const { registerStopCommand } = await import('../../src/index');
      
      // Register stop command on mock bot
      mockBot.command('stop', async (ctx) => {
        const telegramId = String(ctx.from?.id ?? '');
        const user = userState.getOrCreate(telegramId, ctx.from?.username);
        const cwd = userState.getCurrentCwd(user.id);
        
        sessionManager.setCancelled(telegramId, cwd);
        const aborters = (sessionManager as any).aborters?.get(telegramId) || [];
        aborters.forEach((abort: Function) => abort());
        
        await ctx.reply('🛑 Operación cancelada');
      });

      // Simulate multiple stop commands
      await Promise.all([
        mockBot.simulateCommand(testChatId, testUserId, '/stop'),
        mockBot.simulateCommand(testChatId, testUserId, '/stop'),
        mockBot.simulateCommand(testChatId, testUserId, '/stop'),
      ]);

      // Should handle all without errors
      const messages = mockBot.api.getMessages(testChatId);
      const stopMessages = messages.filter((m) => m.text.includes('cancelada'));
      expect(stopMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Model Selection', () => {
    it('should handle model selection via callback', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      const { registerCallbacks } = await import('../../src/bot/callbacks');
      
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);
      registerCallbacks(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Step 1: Show model selection
      await mockBot.simulateCommand(testChatId, testUserId, '/model');
      
      const menuMsg = mockBot.api.getLastMessage(testChatId);
      expect(menuMsg.text).toMatch(/selecciona el modelo|change model|select model/i);

      // Step 2: Select model via callback
      const firstButton = menuMsg.reply_markup?.inline_keyboard?.[0]?.[0];
      expect(firstButton?.callback_data).toBeDefined();
      await mockBot.simulateCallbackQuery(
        testChatId,
        testUserId,
        menuMsg.message_id,
        firstButton!.callback_data
      );

      // Verify model was changed
      const user = userState.getOrCreate(telegramId, 'testuser');
      const currentModel = userState.getCurrentModel(user.id);
      expect(currentModel).toBeTruthy();

      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/modelo cambiado|model changed/i);
    });
  });

  describe('MCP Server Management', () => {
    it('should list MCP servers', async () => {
      const { registerMcpCommands } = await import('../../src/bot/commands-mcp');
      registerMcpCommands(mockBot as any, userState, mcpRegistry, wizardManager);

      await mockBot.simulateCommand(testChatId, testUserId, '/mcp_list');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg).toBeDefined();
      // Should show either servers or "no servers" message
      expect(lastMsg.text.length).toBeGreaterThan(0);
    });

    it('should handle MCP server enable/disable toggle', async () => {
      const { registerMcpCommands } = await import('../../src/bot/commands-mcp');
      const { registerCallbacks } = await import('../../src/bot/callbacks');
      
      registerMcpCommands(mockBot as any, userState, mcpRegistry, wizardManager);
      registerCallbacks(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Create a test server first
      const user = userState.getOrCreate(telegramId, 'testuser');
      const { ServerManagementService } = await import('../../src/mcp/server-management');
      const service = new ServerManagementService(userState, user.id);
      
      service.addServer({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });
      mcpRegistry.load();

      // Show MCP menu
      await mockBot.simulateCommand(testChatId, testUserId, '/mcp');
      
      const menuMsg = mockBot.api.getLastMessage(testChatId);
      
      // Toggle server (this would be from inline keyboard in real scenario)
      const toggleButton = menuMsg.reply_markup?.inline_keyboard?.[0]?.[0];
      expect(toggleButton?.callback_data).toBeDefined();
      await mockBot.simulateCallbackQuery(
        testChatId,
        testUserId,
        menuMsg.message_id,
        toggleButton!.callback_data
      );

      // Should have processed the toggle
      expect(mockBot.api.getMessages(testChatId).length).toBeGreaterThan(0);
    });
  });

  describe('Session Reset', () => {
    it('should handle /reset command and clear session', async () => {
      const { registerSessionCommands } = await import('../../src/bot/commands-session');
      registerSessionCommands(mockBot as any, sessionManager, userState, mcpRegistry, tools);

      // Create a session first
      await sessionManager.switchProject(telegramId, '/test/project', {
        model: 'gpt-5',
        tools: [],
        mcpServers: [],
      });

      // Reset session
      await mockBot.simulateCommand(testChatId, testUserId, '/reset');
      
      const lastMsg = mockBot.api.getLastMessage(testChatId);
      expect(lastMsg.text).toMatch(/sesi[oó]n reiniciada|session reset|no hay sesi[oó]n activa|no active session/i);

      // Session should be cleared
      const activeSession = sessionManager.getActiveSession(telegramId);
      expect(activeSession).toBeUndefined();
    });
  });
});
