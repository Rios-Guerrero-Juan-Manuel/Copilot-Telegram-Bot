import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { registerCallbacks } from '../src/bot/callbacks';
import type { SessionManager } from '../src/copilot/session-manager';
import type { UserState } from '../src/state/user-state';
import type { McpRegistry } from '../src/mcp/mcp-registry';
import type { ToolBundle } from '../src/types';
import { logger } from '../src/utils/logger';
import * as config from '../src/config';
import { promises as fs } from 'fs';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config
vi.mock('../src/config', async () => {
  const actual = await vi.importActual('../src/config');
  return {
    ...actual,
    isPathAllowed: vi.fn(),
  };
});

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...((actual as any).promises || {}),
      access: vi.fn(),
      stat: vi.fn(),
    },
    readFileSync: vi.fn(() => '{}'), // For i18n translation loading
  };
});

describe('Bot Callbacks', () => {
  let mockBot: any;
  let mockSessionManager: SessionManager;
  let mockUserState: UserState;
  let mockMcpRegistry: McpRegistry;
  let mockTools: ToolBundle;
  let callbackHandlers: Map<RegExp, Function>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock bot that stores callback handlers
    callbackHandlers = new Map();
    mockBot = {
      callbackQuery: vi.fn((pattern: RegExp, handler: Function) => {
        callbackHandlers.set(pattern, handler);
      }),
    } as any;

    // Setup mock session manager
    mockSessionManager = {
      isBusy: vi.fn(() => false),
      setBusy: vi.fn(),
      recreateActiveSession: vi.fn(async () => {}),
      switchProject: vi.fn(async () => {}),
    } as any;

    // Setup mock user state
    mockUserState = {
      getOrCreate: vi.fn((id: string, username?: string) => ({
        id,
        username: username || 'testuser',
        currentCwd: '/test/path',
        currentModel: 'claude-sonnet-4.5',
        projects: {},
        conversations: [],
      })),
      setCurrentModel: vi.fn(),
      setCurrentCwd: vi.fn(),
      getCurrentModel: vi.fn(() => 'claude-sonnet-4.5'),
      getProjectPath: vi.fn(() => '/test/project'),
    } as any;

    // Setup mock MCP registry
    mockMcpRegistry = {
      enable: vi.fn(() => true),
      disable: vi.fn(() => true),
      getEnabled: vi.fn(() => []),
    } as any;

    // Setup mock tools
    mockTools = {
      all: [],
      askUser: {
        hasPending: vi.fn(() => true),
        resolveResponse: vi.fn(() => true),
      },
    } as any;

    // Mock config.isPathAllowed
    vi.mocked(config.isPathAllowed).mockReturnValue(true);

    // Mock fs promises
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Register callbacks
    registerCallbacks(mockBot, mockSessionManager, mockUserState, mockMcpRegistry, mockTools);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to find and execute callback handler
  const executeCallback = async (callbackData: string, from?: any) => {
    const ctx = {
      match: null as any,
      from: from || { id: 123456, username: 'testuser' },
      answerCallbackQuery: vi.fn(async () => {}),
      editMessageText: vi.fn(async () => {}),
    };

    for (const [pattern, handler] of callbackHandlers.entries()) {
      const match = callbackData.match(pattern);
      if (match) {
        ctx.match = match;
        await handler(ctx);
        return ctx;
      }
    }

    throw new Error(`No handler found for callback: ${callbackData}`);
  };

  describe('Ask User Response Callback', () => {
    it('should resolve response with valid token', async () => {
      const timestamp = Date.now();
      const ctx = await executeCallback(`ask_user_response:valid_token:Yes:${timestamp}`);
      
      expect(mockTools.askUser.hasPending).toHaveBeenCalled();
      expect(mockTools.askUser.resolveResponse).toHaveBeenCalledWith('Yes', 'valid_token');
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.responseReceived');
    });

    it('should reject when no pending request', async () => {
      vi.mocked(mockTools.askUser.hasPending).mockReturnValue(false);

      const timestamp = Date.now();
      const ctx = await executeCallback(`ask_user_response:token:No:${timestamp}`);
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.requestExpired');
      expect(mockTools.askUser.resolveResponse).not.toHaveBeenCalled();
    });

    it('should reject with expired token', async () =>{
      vi.mocked(mockTools.askUser.resolveResponse).mockReturnValue(false);

      const timestamp = Date.now();
      const ctx = await executeCallback(`ask_user_response:expired_token:Yes:${timestamp}`);
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.requestExpired');
    });
  });

  describe('Model Change Callback', () => {
    it('should change model successfully with valid model', async () => {
      const ctx = await executeCallback('model:claude-opus-4.6');
      
      expect(mockSessionManager.isBusy).toHaveBeenCalledWith('123456');
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', true);
      expect(mockUserState.setCurrentModel).toHaveBeenCalledWith('123456', 'claude-opus-4.6');
      expect(mockSessionManager.recreateActiveSession).toHaveBeenCalledWith('123456', {
        model: 'claude-opus-4.6',
        tools: mockTools.all,
        mcpServers: [],
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.modelChanged');
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        'callbacks.modelChangedMessage',
        { parse_mode: 'HTML' }
      );
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });

    it('should reject invalid model', async () => {
      const ctx = await executeCallback('model:invalid-model');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.invalidModel');
      expect(mockSessionManager.recreateActiveSession).not.toHaveBeenCalled();
    });

    it('should reject when session is busy', async () => {
      vi.mocked(mockSessionManager.isBusy).mockReturnValue(true);

      const ctx = await executeCallback('model:claude-sonnet-4.5');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.operationInProgress');
      expect(mockSessionManager.recreateActiveSession).not.toHaveBeenCalled();
    });

    it('should log errors and answer callback on failure', async () => {
      const error = new Error('Recreation failed');
      vi.mocked(mockSessionManager.recreateActiveSession).mockRejectedValue(error);

      const ctx = await executeCallback('model:gpt-5');
      
      expect(logger.error).toHaveBeenCalledWith('Failed to change model in callback', {
        telegramId: '123456',
        model: 'gpt-5',
        error: 'Recreation failed',
        stack: expect.any(String),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.errorChangingModel');
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });

    it('should always clear busy state in finally block', async () => {
      vi.mocked(mockSessionManager.recreateActiveSession).mockRejectedValue(new Error('Test error'));

      await executeCallback('model:claude-sonnet-4.5');
      
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });
  });

  describe('Project Switch Callback', () => {
    it('should switch project successfully', async () => {
      const ctx = await executeCallback('project_switch:test-project');
      
      expect(mockUserState.getProjectPath).toHaveBeenCalledWith('123456', 'test-project');
      expect(config.isPathAllowed).toHaveBeenCalledWith('/test/project');
      expect(fs.access).toHaveBeenCalledWith('/test/project');
      expect(fs.stat).toHaveBeenCalledWith('/test/project');
      expect(mockSessionManager.switchProject).toHaveBeenCalledWith('123456', '/test/project', {
        model: 'claude-sonnet-4.5',
        tools: mockTools.all,
        mcpServers: [],
      });
      expect(mockUserState.setCurrentCwd).toHaveBeenCalledWith('123456', '/test/project');
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.projectSwitchedAck');
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        'projects.switch.switched',
        { parse_mode: 'HTML' }
      );
    });

    it('should reject non-existent project', async () => {
      vi.mocked(mockUserState.getProjectPath).mockReturnValue(null);

      const ctx = await executeCallback('project_switch:nonexistent');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('projects.switch.notFound');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });

    it('should reject path outside allowlist', async () => {
      vi.mocked(config.isPathAllowed).mockReturnValue(false);

      const ctx = await executeCallback('project_switch:forbidden-project');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('errors.pathNotAllowedByConfig');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });

    it('should reject non-accessible path', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Access denied'));

      const ctx = await executeCallback('project_switch:inaccessible');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('errors.invalidPathOrNotDirectory');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });

    it('should reject non-directory path', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => false,
      } as any);

      const ctx = await executeCallback('project_switch:file-path');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('errors.invalidPathOrNotDirectory');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });

    it('should reject when session is busy', async () => {
      vi.mocked(mockSessionManager.isBusy).mockReturnValue(true);

      const ctx = await executeCallback('project_switch:some-project');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.operationInProgress');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });

    it('should log errors and answer callback on switch failure', async () => {
      const error = new Error('Switch failed');
      vi.mocked(mockSessionManager.switchProject).mockRejectedValue(error);

      const ctx = await executeCallback('project_switch:error-project');
      
      expect(logger.error).toHaveBeenCalledWith('Failed to switch project in callback', {
        telegramId: '123456',
        projectName: 'error-project',
        path: '/test/project',
        error: 'Switch failed',
        stack: expect.any(String),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.errorChangingProject');
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });

    it('should always clear busy state in finally block', async () => {
      vi.mocked(mockSessionManager.switchProject).mockRejectedValue(new Error('Test error'));

      await executeCallback('project_switch:test-project');
      
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });

    it('should handle stat error', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('Stat failed'));

      const ctx = await executeCallback('project_switch:stat-error');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('errors.invalidPathOrNotDirectory');
      expect(mockSessionManager.switchProject).not.toHaveBeenCalled();
    });
  });

  describe('MCP Toggle Callback', () => {
    it('should enable MCP server successfully', async () => {
      const ctx = await executeCallback('mcp_toggle:test-server:enable');
      
      expect(mockMcpRegistry.enable).toHaveBeenCalledWith('test-server');
      expect(mockSessionManager.recreateActiveSession).toHaveBeenCalledWith('123456', {
        model: 'claude-sonnet-4.5',
        tools: mockTools.all,
        mcpServers: [],
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.mcpToggledAck');
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        'bot.mcpToggled',
        { parse_mode: 'HTML' }
      );
    });

    it('should disable MCP server successfully', async () => {
      const ctx = await executeCallback('mcp_toggle:test-server:disable');
      
      expect(mockMcpRegistry.disable).toHaveBeenCalledWith('test-server');
      expect(mockSessionManager.recreateActiveSession).toHaveBeenCalledWith('123456', {
        model: 'claude-sonnet-4.5',
        tools: mockTools.all,
        mcpServers: [],
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.mcpToggledAck');
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        'bot.mcpToggled',
        { parse_mode: 'HTML' }
      );
    });

    it('should handle non-existent MCP server', async () => {
      vi.mocked(mockMcpRegistry.enable).mockReturnValue(false);

      const ctx = await executeCallback('mcp_toggle:nonexistent:enable');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('errors.mcpServerNotFound');
      expect(mockSessionManager.recreateActiveSession).not.toHaveBeenCalled();
    });

    it('should reject when session is busy', async () => {
      vi.mocked(mockSessionManager.isBusy).mockReturnValue(true);

      const ctx = await executeCallback('mcp_toggle:some-server:enable');
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.operationInProgress');
      expect(mockMcpRegistry.enable).not.toHaveBeenCalled();
    });

    it('should log errors and answer callback on toggle failure', async () => {
      const error = new Error('Recreation failed');
      vi.mocked(mockSessionManager.recreateActiveSession).mockRejectedValue(error);

      const ctx = await executeCallback('mcp_toggle:error-server:enable');
      
      expect(logger.error).toHaveBeenCalledWith('Failed to toggle MCP server in callback', {
        telegramId: '123456',
        mcpName: 'error-server',
        action: 'enable',
        error: 'Recreation failed',
        stack: expect.any(String),
      });
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.errorUpdatingMCP');
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });

    it('should always clear busy state in finally block', async () => {
      vi.mocked(mockSessionManager.recreateActiveSession).mockRejectedValue(new Error('Test error'));

      await executeCallback('mcp_toggle:test-server:disable');
      
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('123456', false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing from.id gracefully', async () => {
      const ctx = await executeCallback('model:claude-sonnet-4.5', { id: undefined });
      
      expect(mockUserState.getOrCreate).toHaveBeenCalledWith('', undefined);
    });

    it('should handle missing from.username gracefully', async () => {
      const ctx = await executeCallback('model:claude-sonnet-4', { id: 999, username: undefined });
      
      expect(mockUserState.getOrCreate).toHaveBeenCalledWith('999', undefined);
    });

    it('should handle empty callback match groups', async () => {
      // Test with malformed callback that still matches pattern
      const ctx = {
        match: ['model:', ''],
        from: { id: 123456, username: 'test' },
        answerCallbackQuery: vi.fn(async () => {}),
        editMessageText: vi.fn(async () => {}),
      };

      const handler = Array.from(callbackHandlers.entries())[1][1]; // Get model handler
      await handler(ctx);
      
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('bot.invalidModel');
    });

    it('should handle null match gracefully in ask_user callback', async () => {
      const ctx = {
        match: null,
        callbackQuery: { data: undefined },
        from: { id: 123456 },
        answerCallbackQuery: vi.fn(async () => {}),
      };

      const handler = Array.from(callbackHandlers.entries())[0][1]; // Get ask_user handler
      await handler(ctx);
      
      // With null match and no callback data, should fail validation and expire
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('callbacks.requestExpired');
      expect(mockTools.askUser.resolveResponse).not.toHaveBeenCalled();
    });
  });

  describe('All Callbacks Registered', () => {
    it('should register all expected callback patterns', () => {
      // Should have at least the 4 core callbacks plus wizard callbacks
      expect(callbackHandlers.size).toBeGreaterThanOrEqual(4);
      
      const patterns = Array.from(callbackHandlers.keys()).map(p => p.source);
      // Check core callbacks are registered
      expect(patterns).toContain('^ask_user_response:(.+)$');
      expect(patterns).toContain('^model:(.+)$');
      expect(patterns).toContain('^project_switch:(.+)$');
      expect(patterns).toContain('^mcp_toggle:(.+?):(enable|disable)(?::(\\d+))?$');
    });
  });
});
