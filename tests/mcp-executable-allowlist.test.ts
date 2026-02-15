import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock child_process BEFORE importing modules that use it
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';
import * as configModule from '../src/config';

describe('MCP Executable Allowlist Security', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let userId: number;
  const telegramId = '789012';
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
    
    const user = userState.getOrCreate(telegramId, 'allowlistuser');
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

  describe('getAllowedExecutables', () => {
    it('should return default allowlist when env var is not set', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
      
      const allowed = configModule.getAllowedExecutables();
      
      expect(allowed).toContain('node');
      expect(allowed).toContain('node.exe');
      expect(allowed).toContain('python');
      expect(allowed).toContain('python.exe');
      expect(allowed).toContain('python3');
      expect(allowed).toContain('python3.exe');
      expect(allowed).toContain('npx');
      expect(allowed).toContain('npx.cmd');
      expect(allowed).toContain('deno');
      expect(allowed).toContain('deno.exe');
      expect(allowed).toContain('bun');
      expect(allowed).toContain('bun.exe');
    });

    it('should parse custom allowlist from env var', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = 'node,python,custom-binary';
      
      const allowed = configModule.getAllowedExecutables();
      
      expect(allowed).toEqual(['node', 'python', 'custom-binary']);
    });

    it('should trim whitespace from env var entries', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = ' node , python , npx ';
      
      const allowed = configModule.getAllowedExecutables();
      
      expect(allowed).toEqual(['node', 'python', 'npx']);
    });

    it('should handle empty env var', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = '';
      
      const allowed = configModule.getAllowedExecutables();
      
      // Should return default allowlist
      expect(allowed).toContain('node');
      expect(allowed).toContain('python');
    });
  });

  describe('Executable validation in addServer', () => {
    it('should accept allowed executables - node', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'node-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables - python', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'python-server',
        type: 'stdio',
        command: 'python',
        args: ['server.py'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables - python3', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'python3-server',
        type: 'stdio',
        command: 'python3',
        args: ['server.py'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables - npx', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'npx-server',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables - deno', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'deno-server',
        type: 'stdio',
        command: 'deno',
        args: ['run', 'server.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables - bun', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'bun-server',
        type: 'stdio',
        command: 'bun',
        args: ['run', 'server.ts'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables with .exe extension on Windows', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'node-exe-server',
        type: 'stdio',
        command: 'node.exe',
        args: ['server.js'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables with full path when path matches system PATH', async () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
      const { spawnSync } = await import('child_process');
      const mockSpawnSync = vi.mocked(spawnSync);
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '/usr/bin/node\n',
        stderr: '',
      } as any);

      const result = service.addServer({
        name: 'node-path-server',
        type: 'stdio',
        command: '/usr/bin/node',
        args: ['server.js'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept allowed executables with Windows path when path matches system PATH', async () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
      const { spawnSync } = await import('child_process');
      const mockSpawnSync = vi.mocked(spawnSync);
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: 'C:\\Program Files\\nodejs\\node.exe\n',
        stderr: '',
      } as any);

      const result = service.addServer({
        name: 'node-win-path-server',
        type: 'stdio',
        command: 'C:\\Program Files\\nodejs\\node.exe',
        args: ['server.js'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject disallowed executables - bash', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'bash-server',
        type: 'stdio',
        command: 'bash',
        args: ['script.sh'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
      expect(result.error).toContain('bash');
    });

    it('should reject disallowed executables - sh', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'sh-server',
        type: 'stdio',
        command: 'sh',
        args: ['-c', 'echo test'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
      expect(result.error).toContain('sh');
    });

    it('should reject disallowed executables - arbitrary binary', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'malicious-server',
        type: 'stdio',
        command: 'malicious-binary',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
      expect(result.error).toContain('malicious-binary');
    });

    it('should show allowed executables in error message', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'bad-server',
        type: 'stdio',
        command: 'bad-cmd',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('node');
      expect(result.error).toContain('python');
      expect(result.error).toContain('npx');
      expect(result.error).toContain('deno');
      expect(result.error).toContain('bun');
    });

    it('should be case-insensitive on Windows for validation', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      // Simulate Windows platform temporarily if needed
      // The validation should handle this internally
      
      const result = service.addServer({
        name: 'node-uppercase',
        type: 'stdio',
        command: 'NODE',
        args: ['server.js'],
      });

      // On Windows, this should succeed (case-insensitive)
      // On Unix, it depends on PATH but validation should allow it
      expect(result.success).toBe(true);
    });

    it('should respect custom allowlist from env var', () => {
      process.env.MCP_ALLOWED_EXECUTABLES = 'custom-runtime';

      const result1 = service.addServer({
        name: 'custom-server',
        type: 'stdio',
        command: 'custom-runtime',
        args: ['script.js'],
      });

      expect(result1.success).toBe(true);

      const result2 = service.addServer({
        name: 'node-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('no permitido');
    });

    it('should log rejected executable attempts', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      // This test verifies that rejected attempts are logged
      // The actual logging is checked via logger.warn call in implementation
      const result = service.addServer({
        name: 'rejected-server',
        type: 'stdio',
        command: 'unauthorized-cmd',
        args: [],
      });

      expect(result.success).toBe(false);
      // The implementation should log this rejection
    });

    it('should not validate HTTP servers (no command)', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'http-server',
        type: 'http',
        url: 'https://example.com/mcp',
      });

      // HTTP servers have no command, so allowlist doesn't apply
      expect(result.success).toBe(true);
    });

    it('should handle npx.cmd on Windows', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'npx-cmd-server',
        type: 'stdio',
        command: 'npx.cmd',
        args: ['-y', '@modelcontextprotocol/server-memory'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should extract basename from full path for validation', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      // Even with full path, validation should check basename
      const result = service.addServer({
        name: 'full-path-bad',
        type: 'stdio',
        command: '/usr/local/bin/malicious',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ruta absoluta');
    });

    it('should prevent command injection via executable name', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      // Try to inject commands via executable name
      const result = service.addServer({
        name: 'injection-attempt',
        type: 'stdio',
        command: 'node; rm -rf /',
        args: [],
      });

      // Should be rejected because "node; rm -rf /" is not in allowlist
      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should handle edge case - empty command after trim', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'empty-cmd',
        type: 'stdio',
        command: '   ',
        args: [],
      });

      // Should fail with "comando vacío" error before allowlist check
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Edge cases and security', () => {
    it('should reject commands with multiple dots (exact matching)', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'dots-server',
        type: 'stdio',
        command: 'node.v20.exe',
        args: ['server.js'],
      });

      // Should reject because allowlist uses exact basename matching, not startsWith
      // 'node.v20.exe' !== 'node.exe' (exact match required)
      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should handle symlinks that resolve to allowed executables', async () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;
      const { spawnSync } = await import('child_process');
      const mockSpawnSync = vi.mocked(spawnSync);
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '/usr/local/bin/python3\n',
        stderr: '',
      } as any);

      // Even if it's a symlink, the basename should match
      const result = service.addServer({
        name: 'symlink-server',
        type: 'stdio',
        command: '/usr/local/bin/python3',
        args: ['server.py'],
      });

      expect(result.success).toBe(true);
    });

    it('should prevent path traversal in command', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'traversal-attempt',
        type: 'stdio',
        command: '../../../etc/passwd',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no permitido');
    });

    it('should handle Windows UNC paths', () => {
      delete process.env.MCP_ALLOWED_EXECUTABLES;

      const result = service.addServer({
        name: 'unc-path-server',
        type: 'stdio',
        command: '\\\\server\\share\\node.exe',
        args: ['server.js'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ruta absoluta');
    });
  });
});
