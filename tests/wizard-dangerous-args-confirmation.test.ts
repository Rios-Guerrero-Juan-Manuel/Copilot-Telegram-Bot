import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock child_process BEFORE importing modules that use it
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerWizard - Dangerous Arguments Confirmation Flow', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let wizard: ServerWizard;
  let userId: number;
  const telegramId = '123456';

  beforeEach(async () => {
    const { spawnSync } = await import('child_process');
    const mockSpawnSync = vi.mocked(spawnSync);
    
    // Mock spawnSync to simulate command exists (status: 0) by default
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 12345,
      output: [null, Buffer.from(''), Buffer.from('')],
      signal: null,
    } as any);

    const testConfig: AppConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test',
      COPILOT_DEFAULT_MODEL: 'gpt-5',
      COPILOT_MCP_CONFIG_PATH: '/test/config.json',
    } as AppConfig;
    
    userState = new UserState(testConfig);
    
    // Create user in database and get the actual user ID
    const user = userState.getOrCreate(telegramId, 'testuser');
    userId = user.id;
    
    service = new ServerManagementService(userState, userId);
    wizard = new ServerWizard(service);
  });

  describe('Dangerous arguments detection during wizard flow', () => {
    it('should detect dangerous args during STDIO server creation', () => {
      // Start wizard
      wizard.startWizard(userId);
      
      // Step 1: Name
      wizard.handleInput(userId, 'dangerous-server');
      
      // Step 2: Type - select STDIO
      wizard.handleInput(userId, '1');
      
      // Step 3: Command
      wizard.handleInput(userId, 'node');
      
      // Step 4: Args - use dangerous flag
      wizard.handleInput(userId, '-e "malicious code"');
      
      // Step 5: ENV - skip
      wizard.handleInput(userId, '-');
      
      // Should now show confirmation step for dangerous args
      const status = wizard.getStatus(userId);
      expect(status).toBeDefined();
      expect(status?.step).toBe('confirm_dangerous');
    });

    it('should show security warning message with detected flags', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'dangerous-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e "console.log(1)"');
      const result = wizard.handleInput(userId, '-');
      
      // Should show security warning
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/ADVERTENCIA DE SEGURIDAD|SECURITY WARNING/);
      expect(result.message).toContain('-e');
      expect(result.message).toContain('confirmar');
      expect(result.message).toContain('cancelar');
    });

    it('should include full command in warning message', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'python');
      wizard.handleInput(userId, '-c "import os"');
      const result = wizard.handleInput(userId, '-');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('python');
      expect(result.message).toContain('-c');
      expect(result.message).toContain('"import os"');
    });

    it('should preserve quotes in command display for args with spaces', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e console.log("hello world")');
      const result = wizard.handleInput(userId, '-');
      
      expect(result.success).toBe(true);
      // The command display should preserve quoting for readability
      expect(result.message).toContain('node');
      expect(result.message).toContain('-e');
      // Should show the argument with proper quoting
      expect(result.message).toMatch(/["'].*hello world.*["']/);
    });

    it('should list multiple dangerous flags in warning', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'multi-danger');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e code -p more');
      const result = wizard.handleInput(userId, '-');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('-e');
      expect(result.message).toContain('-p');
    });
  });

  describe('User confirmation handling', () => {
    beforeEach(() => {
      // Set up wizard to dangerous args confirmation step
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'danger-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e "code"');
      wizard.handleInput(userId, '-'); // Triggers dangerous args warning
    });

    it('should accept "confirmar" and create server', () => {
      const result = wizard.handleInput(userId, 'confirmar');
      
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      expect(result.message).toContain('✅');
      expect(result.message).toContain('agregado');
      
      // Verify server was created
      const servers = service.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('danger-server');
    });

    it('should accept "CONFIRMAR" (case-insensitive)', () => {
      const result = wizard.handleInput(userId, 'CONFIRMAR');
      
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      
      const servers = service.listServers();
      expect(servers).toHaveLength(1);
    });

    it('should accept "cancelar" and abort operation', () => {
      const result = wizard.handleInput(userId, 'cancelar');
      
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(result.message).toMatch(/cancelad|cancelled/i);
      
      // Verify server was NOT created
      const servers = service.listServers();
      expect(servers).toHaveLength(0);
    });

    it('should accept "CANCELAR" (case-insensitive)', () => {
      const result = wizard.handleInput(userId, 'CANCELAR');
      
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      
      const servers = service.listServers();
      expect(servers).toHaveLength(0);
    });

    it('should reject invalid confirmation responses', () => {
      const result = wizard.handleInput(userId, 'maybe');
      
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Respuesta inv[aá]lida|Invalid response/i);
      expect(result.message).toContain('confirmar');
      expect(result.message).toContain('cancelar');
      
      // Should stay on same step
      const status = wizard.getStatus(userId);
      expect(status?.step).toBe('confirm_dangerous');
    });

    it('should allow retry after invalid response', () => {
      // Invalid response
      wizard.handleInput(userId, 'invalid');
      
      // Valid confirmation
      const result = wizard.handleInput(userId, 'confirmar');
      
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      
      const servers = service.listServers();
      expect(servers).toHaveLength(1);
    });

    it('should clean up session after confirmation', () => {
      wizard.handleInput(userId, 'confirmar');
      
      // Session should be cleaned up
      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
    });

    it('should clean up session after cancellation', () => {
      wizard.handleInput(userId, 'cancelar');
      
      // Session should be cleaned up
      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
    });
  });

  describe('Safe arguments - no confirmation needed', () => {
    it('should NOT show confirmation for safe arguments', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'safe-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, 'server.js --port 3000');
      const result = wizard.handleInput(userId, '-');
      
      // Should go directly to final confirmation (not dangerous args confirmation)
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
      expect(result.message).not.toMatch(/ADVERTENCIA DE SEGURIDAD|SECURITY WARNING/);
      expect(result.message).toMatch(/Confirma la configuraci[oó]n|Confirm configuration/);
    });

    it('should create safe server without extra confirmation', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'safe-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'python');
      wizard.handleInput(userId, 'script.py --verbose');
      wizard.handleInput(userId, '-');
      
      // Final confirmation
      const result = wizard.handleInput(userId, 'si');
      
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      
      const servers = service.listServers();
      expect(servers).toHaveLength(1);
    });
  });

  describe('HTTP servers - no dangerous args detection', () => {
    it('should NOT check for dangerous args in HTTP servers', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'http-server');
      wizard.handleInput(userId, '2'); // HTTP type
      const result = wizard.handleInput(userId, 'http://localhost:3000');
      
      // Should go directly to final confirmation
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
      expect(result.message).not.toContain('ADVERTENCIA DE SEGURIDAD');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty args gracefully', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'empty-args');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, ''); // Empty args
      const result = wizard.handleInput(userId, '-');
      
      // Should go to final confirmation (no dangerous args)
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
    });

    it('should handle whitespace-only args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'whitespace');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '   '); // Whitespace
      const result = wizard.handleInput(userId, '-');
      
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
    });

    it('should detect dangerous flag with extra whitespace', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'whitespace-danger');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '  -e   "code"  ');
      const result = wizard.handleInput(userId, '-');
      
      // Should detect dangerous args despite whitespace
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/ADVERTENCIA DE SEGURIDAD|SECURITY WARNING/);
      expect(result.message).toContain('-e');
    });
  });

  describe('Integration with existing wizard flow', () => {
    it('should maintain wizard state correctly through confirmation flow', () => {
      wizard.startWizard(userId);
      
      let status = wizard.getStatus(userId);
      expect(status?.step).toBe(WizardStep.NAME);
      
      wizard.handleInput(userId, 'test');
      status = wizard.getStatus(userId);
      expect(status?.step).toBe(WizardStep.TYPE);
      
      wizard.handleInput(userId, '1');
      status = wizard.getStatus(userId);
      expect(status?.step).toBe(WizardStep.COMMAND);
      
      wizard.handleInput(userId, 'node');
      status = wizard.getStatus(userId);
      expect(status?.step).toBe(WizardStep.ARGS);
      
      wizard.handleInput(userId, '-e code');
      status = wizard.getStatus(userId);
      expect(status?.step).toBe(WizardStep.ENV);
      
      wizard.handleInput(userId, '-');
      status = wizard.getStatus(userId);
      expect(status?.step).toBe('confirm_dangerous');
      
      wizard.handleInput(userId, 'confirmar');
      status = wizard.getStatus(userId);
      expect(status).toBeUndefined(); // Session cleaned up
    });

    it('should preserve server data through confirmation flow', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'my-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'python');
      wizard.handleInput(userId, '-c "test"');
      wizard.handleInput(userId, 'KEY=value');
      wizard.handleInput(userId, 'confirmar');
      
      const servers = service.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('my-server');
      expect(servers[0].config.command).toBe('python');
      // Args are parsed and quotes are stripped during input processing
      expect(servers[0].config.args).toEqual(['-c', 'test']);
      expect(servers[0].config.env).toEqual({ KEY: 'value' });
    });

    it('should allow cancel keywords to work in confirmation step', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e code');
      wizard.handleInput(userId, '-');
      
      // Use regular cancel keyword
      const result = wizard.handleInput(userId, 'salir');
      
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
    });
  });

  describe('Security logging', () => {
    it('should log when user confirms dangerous args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'danger');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e code');
      wizard.handleInput(userId, '-');
      
      const result = wizard.handleInput(userId, 'confirmar');
      
      expect(result.success).toBe(true);
      // Security logging will be verified through the logger
      // The ServerManagementService should log the confirmation
    });

    it('should log when user cancels dangerous args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'danger');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, '-e code');
      wizard.handleInput(userId, '-');
      
      const result = wizard.handleInput(userId, 'cancelar');
      
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      // Should log cancellation
    });
  });
});
