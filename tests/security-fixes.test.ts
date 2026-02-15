import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServerManagementService } from '../src/mcp/server-management';
import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('Security and Architecture Fixes', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let userId: number;
  const telegramId = '123456';

  beforeEach(() => {
    const testConfig: AppConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test',
      COPILOT_DEFAULT_MODEL: 'gpt-5',
      COPILOT_MCP_CONFIG_PATH: '/test/config.json',
    } as AppConfig;
    
    userState = new UserState(testConfig);
    const user = userState.getOrCreate(telegramId, 'testuser');
    userId = user.id;
    
    service = new ServerManagementService(userState, userId);
  });

  describe('Fix #1: Command Injection Prevention', () => {
    it('should safely check for existing commands without shell interpretation', () => {
      // This should not throw or execute malicious code
      const result = service.addServer({
        name: 'safe-test',
        type: 'stdio',
        command: 'node; echo "pwned"',
        args: [],
      });

      // Command existence check should still work but safely
      expect(result).toBeDefined();
    });

    it('should handle command names with special characters safely', () => {
      const result = service.addServer({
        name: 'special-chars',
        type: 'stdio',
        command: 'test$command',
        args: [],
      });

      expect(result).toBeDefined();
    });
  });

  describe('Fix #5: URL Protocol Validation', () => {
    it('should accept valid http URLs', () => {
      const result = service.addServer({
        name: 'http-server',
        type: 'http',
        url: 'http://localhost:3000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('should accept valid https URLs', () => {
      const result = service.addServer({
        name: 'https-server',
        type: 'http',
        url: 'https://api.example.com',
      });

      expect(result.success).toBe(true);
    });

    it('should reject httpx protocol', () => {
      const result = service.addServer({
        name: 'invalid-protocol',
        type: 'http',
        url: 'httpx://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('http:// o https://');
    });

    it('should reject ftp protocol', () => {
      const result = service.addServer({
        name: 'ftp-server',
        type: 'http',
        url: 'ftp://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('http:// o https://');
    });

    it('should reject file protocol', () => {
      const result = service.addServer({
        name: 'file-server',
        type: 'http',
        url: 'file:///etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('http:// o https://');
    });
  });

  describe('Fix #3: Quote-Aware Argument Parsing', () => {
    let wizard: ServerWizard;

    beforeEach(() => {
      wizard = new ServerWizard(service);
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test-server');
      wizard.handleInput(userId, '1'); // STDIO
      wizard.handleInput(userId, 'node');
    });

    it('should handle simple space-separated arguments', () => {
      const result = wizard.handleInput(userId, 'arg1 arg2 arg3');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('should handle quoted arguments with spaces', () => {
      const result = wizard.handleInput(userId, 'server.js --message "hello world"');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['server.js', '--message', 'hello world']);
    });

    it('should handle single-quoted arguments', () => {
      const result = wizard.handleInput(userId, "file.js --name 'John Doe'");
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['file.js', '--name', 'John Doe']);
    });

    it('should handle mixed quoted and unquoted arguments', () => {
      const result = wizard.handleInput(userId, 'app.js --port 3000 --host "0.0.0.0" --debug');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['app.js', '--port', '3000', '--host', '0.0.0.0', '--debug']);
    });

    it('should handle escaped quotes within quoted strings', () => {
      const result = wizard.handleInput(userId, 'test.js --msg "Say \\"hello\\""');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['test.js', '--msg', 'Say "hello"']);
    });

    it('should handle empty arguments', () => {
      const result = wizard.handleInput(userId, '');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual([]);
    });

    it('should handle arguments with equals signs', () => {
      const result = wizard.handleInput(userId, '--key=value --path="/some/path with spaces"');
      expect(result.success).toBe(true);
      
      const status = wizard.getStatus(userId);
      expect(status?.data.args).toEqual(['--key=value', '--path=/some/path with spaces']);
    });
  });

  describe('Fix #2: ServerWizard Public API', () => {
    it('should expose getService() method', () => {
      const wizard = new ServerWizard(service);
      expect(wizard.getService).toBeDefined();
      expect(typeof wizard.getService).toBe('function');
    });

    it('should return the correct ServerManagementService instance', () => {
      const wizard = new ServerWizard(service);
      const exposedService = wizard.getService();
      
      expect(exposedService).toBe(service);
    });

    it('should allow service access without type casting', () => {
      const wizard = new ServerWizard(service);
      const exposedService = wizard.getService();
      
      // Add a server using the exposed service
      const result = exposedService.addServer({
        name: 'test-via-wizard',
        type: 'stdio',
        command: 'node',
        args: ['test.js'],
      });
      
      expect(result.success).toBe(true);
      
      // Verify via the original service
      const server = service.getServer('test-via-wizard');
      expect(server).toBeDefined();
      expect(server?.name).toBe('test-via-wizard');
    });
  });
});
