/**
 * Tests for wizard full command parsing (Issue #2)
 * Verifies that processCommand can handle full command strings with arguments
 * and that processArgs correctly combines them with user-provided args
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerWizard - Full Command Parsing (Issue #2)', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let wizard: ServerWizard;
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
    wizard = new ServerWizard(service);
  });

  describe('Command with arguments in command step', () => {
    it('should extract command and args from full command string', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'full-cmd-test');
      wizard.handleInput(userId, '1'); // STDIO
      
      // Provide full command with args
      wizard.handleInput(userId, 'node server.js --port 3000');
      
      // Skip additional args
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('full-cmd-test');
      const config = server?.config as any;
      
      // Command should be just 'node'
      expect(config.command).toBe('node');
      // Args should be the rest
      expect(config.args).toEqual(['server.js', '--port', '3000']);
    });

    it('should handle quoted arguments in command', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'quoted-cmd');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'node "my server.js" --name "My App"');
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('quoted-cmd');
      const config = server?.config as any;
      
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['my server.js', '--name', 'My App']);
    });

    it('should handle Windows paths in command', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'windows-cmd');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'npx -y @modelcontextprotocol/server C:\\Users\\Admin\\Documents');
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('windows-cmd');
      const config = server?.config as any;
      
      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['-y', '@modelcontextprotocol/server', 'C:\\Users\\Admin\\Documents']);
    });

    it('should handle command with just executable (backward compatibility)', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'simple-cmd');
      wizard.handleInput(userId, '1');
      
      // Just command, no args
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, 'server.js --port 3000');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('simple-cmd');
      const config = server?.config as any;
      
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['server.js', '--port', '3000']);
    });
  });

  describe('Combining command args with user args', () => {
    it('should combine initial args from command with user-provided args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'combined-args');
      wizard.handleInput(userId, '1');
      
      // Command has initial args
      wizard.handleInput(userId, 'npx -y @modelcontextprotocol/server');
      
      // User adds more args
      wizard.handleInput(userId, 'C:\\Data --verbose');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('combined-args');
      const config = server?.config as any;
      
      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['-y', '@modelcontextprotocol/server', 'C:\\Data', '--verbose']);
    });

    it('should preserve initial args if user provides empty args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'preserve-initial');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'node server.js --port 3000');
      
      // User doesn't add args
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('preserve-initial');
      const config = server?.config as any;
      
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['server.js', '--port', '3000']);
    });

    it('should allow user to override/extend with complex args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'complex-override');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'python script.py');
      wizard.handleInput(userId, '--input "data file.csv" --output results.json');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('complex-override');
      const config = server?.config as any;
      
      expect(config.command).toBe('python');
      expect(config.args).toEqual(['script.py', '--input', 'data file.csv', '--output', 'results.json']);
    });

    it('should handle when command has no initial args and user adds args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'no-initial-args');
      wizard.handleInput(userId, '1');
      
      // Just executable
      wizard.handleInput(userId, 'python');
      
      // User adds args later
      wizard.handleInput(userId, 'server.py --host 0.0.0.0');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('no-initial-args');
      const config = server?.config as any;
      
      expect(config.command).toBe('python');
      expect(config.args).toEqual(['server.py', '--host', '0.0.0.0']);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical npx server invocation', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'npx-filesystem');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'npx -y @modelcontextprotocol/server-filesystem C:\\Users\\Admin\\Documents');
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('npx-filesystem');
      const config = server?.config as any;
      
      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\Admin\\Documents']);
    });

    it('should handle node with require flag', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'node-require');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'node -r dotenv/config server.js');
      wizard.handleInput(userId, '--port 8080');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('node-require');
      const config = server?.config as any;
      
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['-r', 'dotenv/config', 'server.js', '--port', '8080']);
    });

    it('should handle Python with module flag', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'python-module');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'python -m mcp_server.main');
      wizard.handleInput(userId, '--config config.json');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('python-module');
      const config = server?.config as any;
      
      expect(config.command).toBe('python');
      expect(config.args).toEqual(['-m', 'mcp_server.main', '--config', 'config.json']);
    });

    it('should handle command with quoted executable path', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'quoted-exe');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, '"C:\\Program Files\\nodejs\\node.exe" server.js');
      wizard.handleInput(userId, '--prod');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('quoted-exe');
      const config = server?.config as any;
      
      expect(config.command).toBe('C:\\Program Files\\nodejs\\node.exe');
      expect(config.args).toEqual(['server.js', '--prod']);
    });
  });

  describe('Edge cases and validation', () => {
    it('should reject empty command string', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '1');
      
      const result = wizard.handleInput(userId, '   ');
      
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/comando|command/i);
      expect(result.step).toBe(WizardStep.COMMAND);
    });

    it('should handle command with only spaces between tokens', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'spaces-test');
      wizard.handleInput(userId, '1');
      
      wizard.handleInput(userId, 'node    server.js    --port    3000');
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('spaces-test');
      const config = server?.config as any;
      
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['server.js', '--port', '3000']);
    });
  });
});
