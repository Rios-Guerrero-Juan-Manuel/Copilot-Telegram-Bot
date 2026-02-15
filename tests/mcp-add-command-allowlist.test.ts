import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Bot } from 'grammy';
import { SessionManager } from '../src/copilot/session-manager';
import { UserState } from '../src/state/user-state';
import { McpRegistry } from '../src/mcp/mcp-registry';
import { WizardManager } from '../src/bot/wizard-manager';
import { registerMcpCommands } from '../src/bot/commands-mcp';
import { AppConfig } from '../src/config';
import * as configModule from '../src/config';

/**
 * Tests for Task 1.2: /mcp add command must validate executable allowlist
 * 
 * CRITICAL SECURITY BUG (Issue #U1):
 * The /mcp add command bypasses security by calling mcpRegistry.add() directly
 * without validating the executable allowlist. This allows adding malicious executables.
 * 
 * FIX: The command must use ServerManagementService.addServer() which validates
 * the allowlist before adding any stdio server.
 */

describe('Task 1.2: /mcp add Command Allowlist Validation', () => {
  let bot: Bot;
  let sessionManager: SessionManager;
  let userState: UserState;
  let mcpRegistry: McpRegistry;
  let wizardManager: WizardManager;
  let originalEnv: string | undefined;

  // Mock context for Telegram bot
  const createMockContext = (text: string, userId = 123456) => {
    const replied: string[] = [];
    return {
      from: { id: userId, username: 'testuser' },
      message: { text },
      reply: vi.fn(async (text: string, options?: any) => {
        replied.push(text);
        return {} as any;
      }),
      _getReplies: () => replied,
    };
  };

  beforeEach(() => {
    // Save original env
    originalEnv = process.env.MCP_ALLOWED_EXECUTABLES;

    // Create test config
    const testConfig: AppConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test',
      COPILOT_DEFAULT_MODEL: 'gpt-5',
      COPILOT_MCP_CONFIG_PATH: '/test/config.json',
    } as AppConfig;

    // Initialize components
    userState = new UserState(testConfig);
    mcpRegistry = new McpRegistry(userState);
    
    // Mock SessionManager
    sessionManager = {
      isBusy: vi.fn(() => false),
      setBusy: vi.fn(),
      recreateActiveSession: vi.fn(async () => {}),
    } as any;

    // Mock WizardManager
    wizardManager = new WizardManager(userState);

    // Create bot instance
    bot = new Bot('fake-token');

    // Register commands
    registerMcpCommands(
      bot,
      sessionManager,
      userState,
      mcpRegistry,
      wizardManager,
      { all: [] } as any
    );
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.MCP_ALLOWED_EXECUTABLES = originalEnv;
    } else {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
    }
  });

  describe('Security: Executable Allowlist Validation', () => {
    it('should REJECT disallowed executable via /mcp add stdio', async () => {
      // Set strict allowlist (only node)
      process.env.MCP_ALLOWED_EXECUTABLES = 'node';

      const ctx = createMockContext('/mcp add malicious stdio bash script.sh');
      
      // Find and execute the command handler
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should reject with error message about disallowed executable
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => 
        r.includes('❌') && 
        (r.includes('no permitido') || r.includes('bash'))
      );

      expect(errorReply).toBeDefined();
      expect(errorReply).toContain('bash');
      
      // Server should NOT be added to registry
      const servers = mcpRegistry.list();
      const maliciousServer = servers.find((s) => s.name === 'malicious');
      expect(maliciousServer).toBeUndefined();
    });

    it('should ACCEPT allowed executable via /mcp add stdio', async () => {
      // Set allowlist to include node
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,python';

      const ctx = createMockContext('/mcp add myserver stdio node server.js');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should succeed with success message
      const replies = ctx._getReplies();
      const successReply = replies.find((r) => r.includes('✅'));
      expect(successReply).toBeDefined();
      expect(successReply).toContain('myserver');
      
      // Server should be added to registry
      const servers = mcpRegistry.list();
      const addedServer = servers.find((s) => s.name === 'myserver');
      expect(addedServer).toBeDefined();
      expect(addedServer?.type).toBe('stdio');
    });

    it('should REJECT sh executable (shell injection risk)', async () => {
      // Default allowlist (no sh)
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add shell-risk stdio sh -c "malicious"');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should reject
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => r.includes('❌'));

      expect(errorReply).toBeDefined();
      expect(errorReply?.toLowerCase()).toContain('no permitido');
      
      // Server should NOT be added
      const servers = mcpRegistry.list();
      const shellServer = servers.find((s) => s.name === 'shell-risk');
      expect(shellServer).toBeUndefined();
    });

    it('should REJECT bash executable (shell injection risk)', async () => {
      // Default allowlist (no bash)
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add bash-risk stdio bash script.sh');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should reject
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => r.includes('❌'));

      expect(errorReply).toBeDefined();
      
      // Server should NOT be added
      const servers = mcpRegistry.list();
      const bashServer = servers.find((s) => s.name === 'bash-risk');
      expect(bashServer).toBeUndefined();
    });

    it('should ACCEPT python from default allowlist', async () => {
      // Use default allowlist
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add pyserver stdio python server.py');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should succeed
      const replies = ctx._getReplies();
      const successOrInfoReply = replies.find((r) => r.includes('✅') || r.includes('⚠️'));
      expect(successOrInfoReply).toBeDefined();
      
      // Server should be added
      const servers = mcpRegistry.list();
      const pyServer = servers.find((s) => s.name === 'pyserver');
      expect(pyServer).toBeDefined();
    });

    it('should ACCEPT npx from default allowlist', async () => {
      // Use default allowlist
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add npxserver stdio npx -y @modelcontextprotocol/server-memory');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should succeed
      const replies = ctx._getReplies();
      const successOrInfoReply = replies.find((r) => r.includes('✅') || r.includes('⚠️'));
      expect(successOrInfoReply).toBeDefined();
      
      // Server should be added
      const servers = mcpRegistry.list();
      const npxServer = servers.find((s) => s.name === 'npxserver');
      expect(npxServer).toBeDefined();
    });

    it.skip('should NOT validate HTTP servers (no command to check)', async () => {
      // HTTP servers don't have executables, so allowlist doesn't apply
      process.env.MCP_ALLOWED_EXECUTABLES = 'node'; // Strict allowlist

      const ctx = createMockContext('/mcp add httpserver http http://localhost:3000');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should succeed (HTTP has no executable to validate)
      const replies = ctx._getReplies();
      const successOrInfoReply = replies.find((r) => r.includes('✅') || r.includes('⚠️'));
      expect(successOrInfoReply).toBeDefined();
      
      // Server should be added
      const servers = mcpRegistry.list();
      const httpServer = servers.find((s) => s.name === 'httpserver');
      expect(httpServer).toBeDefined();
      expect(httpServer?.type).toBe('http');
    });

    it('should show user-friendly error message with allowed executables list', async () => {
      // Set specific allowlist
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,python,npx';

      const ctx = createMockContext('/mcp add bad stdio unauthorized-exe');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Error message should list allowed executables
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => r.includes('❌'));

      expect(errorReply).toBeDefined();
      expect(errorReply).toContain('no permitido');
      expect(errorReply).toContain('node');
      expect(errorReply).toContain('python');
      expect(errorReply).toContain('npx');
    });
  });

  describe('Bypass Prevention', () => {
    it('should prevent bypassing allowlist with full path to disallowed executable', async () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add bypass stdio /usr/bin/malicious args');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should reject (basename validation)
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => r.includes('❌'));

      expect(errorReply).toBeDefined();
      
      // Server should NOT be added
      const servers = mcpRegistry.list();
      const bypassServer = servers.find((s) => s.name === 'bypass');
      expect(bypassServer).toBeUndefined();
    });

    it('should detect command injection attempts in executable name', async () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const ctx = createMockContext('/mcp add inject stdio "node; rm -rf /" server.js');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should reject due to dangerous characters
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => r.includes('❌'));

      expect(errorReply).toBeDefined();
      
      // Server should NOT be added
      const servers = mcpRegistry.list();
      const injectServer = servers.find((s) => s.name === 'inject');
      expect(injectServer).toBeUndefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing /mcp add http functionality', async () => {
      const ctx = createMockContext('/mcp add webserver http https://api.example.com');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should still work for HTTP
      const replies = ctx._getReplies();
      const successReply = replies.find((r) => r.includes('✅'));

      expect(successReply).toBeDefined();
    });

    it('should maintain existing error messages for invalid type', async () => {
      const ctx = createMockContext('/mcp add bad invalid arg');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should show invalid type error
      const replies = ctx._getReplies();
      const errorReply = replies.find((r) => /tipo inv[aá]lido|invalid type/i.test(r));

      expect(errorReply).toBeDefined();
    });

    it('should maintain existing usage message format', async () => {
      const ctx = createMockContext('/mcp add');
      
      const handler = (bot as any).commandHandlers?.get('mcp');
      if (!handler) {
        throw new Error('mcp command handler not registered');
      }

      await handler(ctx);

      // Should show usage message
      const replies = ctx._getReplies();
      const usageReply = replies.find((r) => /uso:|usage:/i.test(r));

      expect(usageReply).toBeDefined();
      expect(usageReply).toContain('/mcp add');
    });
  });
});
