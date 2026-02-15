/**
 * Tests for parseArgs Windows path handling
 * Verifies that backslashes in Windows paths are preserved correctly
 * and that escape sequences still work for quotes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerWizard - parseArgs Windows Paths', () => {
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

  describe('Windows paths without double escaping', () => {
    it('should preserve Windows paths with single backslashes', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'windows-test');
      wizard.handleInput(userId, '1'); // STDIO
      wizard.handleInput(userId, 'node');
      
      // Windows path with single backslashes
      wizard.handleInput(userId, 'C:\\Users\\Admin\\server.js --port 3000');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('windows-test');
      const config = server?.config as any;
      
      // Path should be preserved with backslashes
      expect(config.args).toEqual(['C:\\Users\\Admin\\server.js', '--port', '3000']);
      expect(config.args[0]).toBe('C:\\Users\\Admin\\server.js');
    });

    it('should handle multiple Windows paths in arguments', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'multi-path');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // Paths with spaces need quotes
      wizard.handleInput(userId, '"C:\\Program Files\\node\\node.exe" D:\\Projects\\server.js');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('multi-path');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['C:\\Program Files\\node\\node.exe', 'D:\\Projects\\server.js']);
    });

    it('should handle UNC paths (double backslash preserved)', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'unc-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // UNC path: \\ at start becomes \ after first escape
      // Input: \\server\share\file.js
      // Expected result: \server\share\file.js (first \\ escapes to \)
      wizard.handleInput(userId, '\\\\server\\share\\file.js');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('unc-test');
      const config = server?.config as any;
      
      // The first \\ is an escape sequence resulting in single \
      expect(config.args).toEqual(['\\server\\share\\file.js']);
    });

    it('should handle paths with trailing backslash', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'trailing-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, 'C:\\Projects\\ --config');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('trailing-test');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['C:\\Projects\\', '--config']);
    });
  });

  describe('Valid escape sequences still work', () => {
    it('should escape double quotes inside double-quoted strings', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'escape-quote-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // Double-quoted string with escaped quote
      wizard.handleInput(userId, '"Hello \\"World\\""');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('escape-quote-test');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['Hello "World"']);
    });

    it('should escape single quotes inside single-quoted strings', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'escape-single-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, "'It\\'s working'");
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('escape-single-test');
      const config = server?.config as any;
      
      expect(config.args).toEqual(["It's working"]);
    });

    it('should escape backslashes when doubled', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'escape-backslash-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // Double backslash should result in single backslash
      wizard.handleInput(userId, 'path\\\\with\\\\escaped');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('escape-backslash-test');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['path\\with\\escaped']);
    });

    it('should handle mix of Windows paths and escaped quotes', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'mixed-test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, 'C:\\Server\\app.js --name "My \\"App\\""');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('mixed-test');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['C:\\Server\\app.js', '--name', 'My "App"']);
    });
  });

  describe('Edge cases', () => {
    it('should handle quoted path ending with backslash - ISSUE #1', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'quoted-trailing-backslash');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // Critical test case: "C:\\Folder\\" should preserve trailing backslash and close quote
      wizard.handleInput(userId, '"C:\\\\Folder\\\\"');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('quoted-trailing-backslash');
      const config = server?.config as any;
      
      // Should result in C:\Folder\ (backslash preserved, quote closed)
      expect(config.args).toEqual(['C:\\Folder\\']);
    });

    it('should handle multiple quoted paths ending with backslash', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'multi-trailing');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, '"C:\\\\Folder\\\\" "D:\\\\Data\\\\"');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('multi-trailing');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['C:\\Folder\\', 'D:\\Data\\']);
    });

    it('should handle backslash at end of input', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'end-backslash');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, 'server.js \\');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('end-backslash');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['server.js', '\\']);
    });

    it('should handle backslash before space (not escapable)', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'backslash-space');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      // Backslash before space is literal, space acts as separator
      wizard.handleInput(userId, 'path\\ file');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('backslash-space');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['path\\', 'file']);
    });

    it('should preserve backslash before regular characters', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'backslash-regular');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, '\\n \\t \\r \\a \\b');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('backslash-regular');
      const config = server?.config as any;
      
      // Backslashes should be preserved as they don't precede escapable chars
      expect(config.args).toEqual(['\\n', '\\t', '\\r', '\\a', '\\b']);
    });

    it('should handle quoted Windows paths', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'quoted-path');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, '"C:\\Program Files\\App\\server.js"');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('quoted-path');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['C:\\Program Files\\App\\server.js']);
    });
  });

  describe('Existing functionality preserved', () => {
    it('should still handle simple space-separated args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'simple-args');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, 'server.js --port 3000 --host localhost');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('simple-args');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['server.js', '--port', '3000', '--host', 'localhost']);
    });

    it('should handle quoted arguments with spaces', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'quoted-args');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, '"hello world" test "foo bar"');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('quoted-args');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['hello world', 'test', 'foo bar']);
    });

    it('should handle mixed single and double quotes', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'mixed-quotes');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, `"double" 'single' test`);
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('mixed-quotes');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['double', 'single', 'test']);
    });

    it('should handle empty args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'no-args');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, '');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('no-args');
      const config = server?.config as any;
      
      expect(config.args).toEqual([]);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical Windows npx command', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'npx-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'npx');
      
      wizard.handleInput(userId, '-y @modelcontextprotocol/server-filesystem C:\\Users\\Admin\\Documents');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('npx-server');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\Admin\\Documents']);
    });

    it('should handle Python script with Windows path', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'python-server');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'python');
      
      wizard.handleInput(userId, 'D:\\Scripts\\mcp\\server.py --data C:\\Data\\folder');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('python-server');
      const config = server?.config as any;
      
      expect(config.args).toEqual(['D:\\Scripts\\mcp\\server.py', '--data', 'C:\\Data\\folder']);
    });

    it('should handle node with multiple path arguments', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'node-paths');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      
      wizard.handleInput(userId, 'C:\\App\\index.js --input C:\\Input\\data.json --output C:\\Output\\result.json');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('node-paths');
      const config = server?.config as any;
      
      expect(config.args).toEqual([
        'C:\\App\\index.js',
        '--input',
        'C:\\Input\\data.json',
        '--output',
        'C:\\Output\\result.json'
      ]);
    });
  });
});
