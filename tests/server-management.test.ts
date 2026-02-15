import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock child_process BEFORE importing modules that use it
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerManagementService', () => {
  let userState: UserState;
  let service: ServerManagementService;
  let userId: number;
  const telegramId = '123456';

  beforeEach(async () => {
    const { spawnSync } = await import('child_process');
    const mockSpawnSync = vi.mocked(spawnSync);
    
    // Mock spawnSync to simulate command exists (status: 0) by default
    // This prevents real shell execution in tests
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
  });

  describe('listServers', () => {
    it('should return empty array when no servers exist', () => {
      const servers = service.listServers();
      expect(servers).toEqual([]);
    });

    it('should return all servers with their details', () => {
      // Add test servers
      userState.upsertMcpServer(
        userId,
        'test-server',
        'stdio',
        { command: 'test', args: ['arg1'] },
        true
      );
      userState.upsertMcpServer(
        userId,
        'http-server',
        'http',
        { url: 'http://localhost:8080' },
        false
      );

      const servers = service.listServers();
      
      expect(servers).toHaveLength(2);
      
      // Find each server by name instead of assuming order
      const stServer = servers.find(s => s.name === 'test-server');
      const httpServer = servers.find(s => s.name === 'http-server');
      
      expect(stServer).toMatchObject({
        name: 'test-server',
        type: 'stdio',
        enabled: true,
      });
      expect(httpServer).toMatchObject({
        name: 'http-server',
        type: 'http',
        enabled: false,
      });
    });
  });

  describe('addServer', () => {
    it('should add STDIO server successfully', () => {
      const result = service.addServer({
        name: 'new-stdio',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'production' },
      });

      expect(result.success).toBe(true);
      expect(result.server).toBeDefined();
      expect(result.server?.name).toBe('new-stdio');
      expect(result.server?.type).toBe('stdio');

      const servers = service.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('new-stdio');
    });

    it('should add HTTP server successfully', () => {
      const result = service.addServer({
        name: 'new-http',
        type: 'http',
        url: 'https://example.com',
      });

      expect(result.success).toBe(true);
      expect(result.server).toBeDefined();
      expect(result.server?.name).toBe('new-http');
      expect(result.server?.type).toBe('http');
    });

    it('should reject duplicate server names', () => {
      service.addServer({
        name: 'duplicate',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      const result = service.addServer({
        name: 'duplicate',
        type: 'http',
        url: 'http://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ya existe');
    });

    it('should reject invalid server names', () => {
      const invalidNames = ['', 'test space', 'test/slash', 'test\\backslash'];
      
      invalidNames.forEach((name) => {
        const result = service.addServer({
          name,
          type: 'stdio',
          command: 'node',
          args: [],
        });
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    it('should reject STDIO server with empty command', () => {
      const result = service.addServer({
        name: 'test',
        type: 'stdio',
        command: '',
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/comando|command/i);
    });

    it('should reject HTTP server with invalid URL', () => {
      const result = service.addServer({
        name: 'test',
        type: 'http',
        url: 'not-a-url',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('URL');
    });

    it('should reject localhost/private URLs (SSRF protection)', () => {
      const result = service.addServer({
        name: 'local-http',
        type: 'http',
        url: 'http://localhost:3000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SSRF');
    });

    it('should warn about potentially missing STDIO commands but not block', async () => {
      const { spawnSync } = await import('child_process');
      const mockSpawnSync = vi.mocked(spawnSync);
      
      // Mock command not found (status: 1)
      mockSpawnSync.mockReturnValueOnce({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        pid: 12345,
        output: [null, Buffer.from(''), Buffer.from('')],
        signal: null,
      } as any);

      const result = service.addServer({
        name: 'test',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings?.[0]).toContain('comando');
      
      // Verify that spawnSync was called with proper arguments
      expect(mockSpawnSync).toHaveBeenCalledWith(
        process.platform === 'win32' ? 'where' : 'which',
        ['node'],
        { stdio: 'ignore' }
      );
    });
  });

  describe('removeServer', () => {
    it('should remove existing server', () => {
      service.addServer({
        name: 'to-remove',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      const result = service.removeServer('to-remove');
      expect(result.success).toBe(true);

      const servers = service.listServers();
      expect(servers).toHaveLength(0);
    });

    it('should return error for non-existent server', () => {
      const result = service.removeServer('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no existe');
    });
  });

  describe('getServer', () => {
    it('should return server details', () => {
      service.addServer({
        name: 'test',
        type: 'stdio',
        command: 'node',
        args: ['test.js'],
      });

      const server = service.getServer('test');
      expect(server).toBeDefined();
      expect(server?.name).toBe('test');
      expect(server?.type).toBe('stdio');
    });

    it('should return undefined for non-existent server', () => {
      const server = service.getServer('nonexistent');
      expect(server).toBeUndefined();
    });
  });

  describe('enableServer', () => {
    it('should enable disabled server', () => {
      service.addServer({
        name: 'test',
        type: 'stdio',
        command: 'node',
        args: [],
      });
      service.setEnabled('test', false);

      const result = service.enableServer('test');
      expect(result.success).toBe(true);

      const server = service.getServer('test');
      expect(server?.enabled).toBe(true);
    });

    it('should return error for non-existent server', () => {
      const result = service.enableServer('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no existe');
    });
  });

  describe('disableServer', () => {
    it('should disable enabled server', () => {
      service.addServer({
        name: 'test',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      const result = service.disableServer('test');
      expect(result.success).toBe(true);

      const server = service.getServer('test');
      expect(server?.enabled).toBe(false);
    });

    it('should return error for non-existent server', () => {
      const result = service.disableServer('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no existe');
    });
  });

  describe('setEnabled', () => {
    it('should toggle server enabled state', () => {
      service.addServer({
        name: 'test',
        type: 'stdio',
        command: 'node',
        args: [],
      });

      service.setEnabled('test', false);
      let server = service.getServer('test');
      expect(server?.enabled).toBe(false);

      service.setEnabled('test', true);
      server = service.getServer('test');
      expect(server?.enabled).toBe(true);
    });
  });

  describe('validateServerName', () => {
    it('should accept valid names', () => {
      const validNames = ['test', 'test-server', 'test_server', 'test123'];
      
      validNames.forEach((name) => {
        const result = service.addServer({
          name,
          type: 'stdio',
          command: 'node',
          args: [],
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject names with spaces', () => {
      const result = service.addServer({
        name: 'test name',
        type: 'stdio',
        command: 'node',
        args: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject names with special characters', () => {
      const result = service.addServer({
        name: 'test@server',
        type: 'stdio',
        command: 'node',
        args: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateExecutable - Security Issue #C3', () => {
    describe('Absolute path validation against system PATH', () => {
      it('should reject absolute paths not in system PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock 'which' or 'where' command to return error (not found)
        mockSpawnSync.mockReturnValueOnce({
          status: 1, // Command failed - not found in PATH
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from(''), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'malicious-absolute-path',
          type: 'stdio',
          command: '/tmp/malicious/node',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ruta absoluta');
        expect(result.error).toContain('PATH');
      });

      it('should accept absolute paths that exist in system PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock 'which' or 'where' command to return success (found in PATH)
        mockSpawnSync.mockReturnValueOnce({
          status: 0, // Command succeeded - found in PATH
          stdout: Buffer.from('/usr/bin/node\n'),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('/usr/bin/node\n'), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'valid-absolute-path',
          type: 'stdio',
          command: '/usr/bin/node',
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should reject Windows absolute paths not in PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock 'where' command to return error (not found)
        mockSpawnSync.mockReturnValueOnce({
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from('INFO: Could not find files for the given pattern(s).'),
          pid: 12345,
          output: [null, Buffer.from(''), Buffer.from('INFO: Could not find files for the given pattern(s).')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'malicious-windows-path',
          type: 'stdio',
          command: 'C:\\temp\\malicious\\node.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ruta absoluta');
      });

      it('should accept Windows absolute paths in system PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock 'where' command to return success
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'valid-windows-path',
          type: 'stdio',
          command: 'C:\\Program Files\\nodejs\\node.exe',
          args: [],
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Exact basename matching (no startsWith bypass)', () => {
      it('should reject executable with malicious prefix like "node.evil.exe"', () => {
        const result = service.addServer({
          name: 'test-evil-prefix',
          type: 'stdio',
          command: 'node.evil.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });

      it('should reject executable like "nodejs-malicious"', () => {
        const result = service.addServer({
          name: 'test-malicious-suffix',
          type: 'stdio',
          command: 'nodejs-malicious',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });

      it('should reject "python.backdoor.exe"', () => {
        const result = service.addServer({
          name: 'test-python-backdoor',
          type: 'stdio',
          command: 'python.backdoor.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });

      it('should accept exact match "node"', () => {
        const result = service.addServer({
          name: 'test-node',
          type: 'stdio',
          command: 'node',
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should accept exact match "node.exe"', () => {
        const result = service.addServer({
          name: 'test-node-exe',
          type: 'stdio',
          command: 'node.exe',
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should accept exact match "python"', () => {
        const result = service.addServer({
          name: 'test-python',
          type: 'stdio',
          command: 'python',
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should accept exact match "python3.exe"', () => {
        const result = service.addServer({
          name: 'test-python3-exe',
          type: 'stdio',
          command: 'python3.exe',
          args: [],
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Exact extension validation', () => {
      it('should reject double extension like "node.exe.malicious"', () => {
        const result = service.addServer({
          name: 'test-double-ext',
          type: 'stdio',
          command: 'node.exe.malicious',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });

      it('should reject invalid extension like "node.bat.exe"', () => {
        const result = service.addServer({
          name: 'test-invalid-ext',
          type: 'stdio',
          command: 'node.bat.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no permitido');
      });

      it('should accept valid .exe extension', () => {
        const result = service.addServer({
          name: 'test-valid-exe',
          type: 'stdio',
          command: 'python.exe',
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should accept valid .cmd extension', () => {
        const result = service.addServer({
          name: 'test-valid-cmd',
          type: 'stdio',
          command: 'npx.cmd',
          args: [],
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Combined security tests', () => {
      it('should reject absolute path with malicious basename', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock command not found
        mockSpawnSync.mockReturnValueOnce({
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from(''), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'test-combo-attack',
          type: 'stdio',
          command: '/home/user/bin/python.backdoor.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        // Should fail for either absolute path validation or basename validation
        expect(result.error).toBeDefined();
      });

      it('should accept valid basename in system PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Mock command found in PATH
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('/usr/bin/python3\n'),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('/usr/bin/python3\n'), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'test-valid-combo',
          type: 'stdio',
          command: 'python3',
          args: [],
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Error messages', () => {
      it('should provide clear error for absolute path not in PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        mockSpawnSync.mockReturnValueOnce({
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from(''), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'test-error-msg',
          type: 'stdio',
          command: '/tmp/malicious/node',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/ruta absoluta/i);
        expect(result.error).toMatch(/PATH/i);
      });

      it('should provide clear error for invalid basename', () => {
        const result = service.addServer({
          name: 'test-basename-error',
          type: 'stdio',
          command: 'node.evil.exe',
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/no permitido/i);
        expect(result.error).toContain('node.evil.exe');
      });
    });

    describe('CRITICAL: Absolute path bypass vulnerability (Issue #1)', () => {
      it('should reject C:\\Malicious\\node.exe even though node.exe exists in PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Simulate Windows: where node.exe returns the LEGITIMATE system path
        // NOT the malicious path provided by user
        mockSpawnSync.mockReturnValueOnce({
          status: 0, // Command succeeds - node.exe exists in PATH
          stdout: Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'), // DIFFERENT path!
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'), Buffer.from('')],
          signal: null,
        } as any);

        // User provides malicious path
        const result = service.addServer({
          name: 'bypass-attack',
          type: 'stdio',
          command: 'C:\\Malicious\\node.exe', // Malicious path
          args: [],
        });

        // CRITICAL: Must reject because C:\Malicious\node.exe !== C:\Program Files\nodejs\node.exe
        expect(result.success).toBe(false);
        expect(result.error).toContain('ruta absoluta');
        expect(result.error).toContain('PATH');
      });

      it('should reject /tmp/malicious/python even though python exists in PATH', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // Simulate Linux: which python returns the LEGITIMATE system path
        mockSpawnSync.mockReturnValueOnce({
          status: 0, // Command succeeds - python exists in PATH
          stdout: Buffer.from('/usr/bin/python\n'), // DIFFERENT path!
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('/usr/bin/python\n'), Buffer.from('')],
          signal: null,
        } as any);

        // User provides malicious path with same basename
        const result = service.addServer({
          name: 'bypass-attack-linux',
          type: 'stdio',
          command: '/tmp/malicious/python', // Malicious path
          args: [],
        });

        // CRITICAL: Must reject because /tmp/malicious/python !== /usr/bin/python
        expect(result.success).toBe(false);
        expect(result.error).toContain('ruta absoluta');
        expect(result.error).toContain('PATH');
      });

      it('should accept C:\\Program Files\\nodejs\\node.exe when it matches PATH exactly', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // where node.exe returns the SAME path as provided
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('C:\\Program Files\\nodejs\\node.exe\n'), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'valid-exact-match',
          type: 'stdio',
          command: 'C:\\Program Files\\nodejs\\node.exe', // EXACT match
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should accept /usr/bin/python when it matches PATH exactly', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // which python returns the SAME path as provided
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('/usr/bin/python\n'),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from('/usr/bin/python\n'), Buffer.from('')],
          signal: null,
        } as any);

        const result = service.addServer({
          name: 'valid-exact-match-linux',
          type: 'stdio',
          command: '/usr/bin/python', // EXACT match
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should handle multiple paths from where/which command', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // where python may return multiple paths on Windows
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(
            'C:\\Python39\\python.exe\n' +
            'C:\\Python310\\python.exe\n' +
            'C:\\Program Files\\Python\\python.exe\n'
          ),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from(
            'C:\\Python39\\python.exe\n' +
            'C:\\Python310\\python.exe\n' +
            'C:\\Program Files\\Python\\python.exe\n'
          ), Buffer.from('')],
          signal: null,
        } as any);

        // Should accept if it matches ANY of the system paths
        const result = service.addServer({
          name: 'multi-path-match',
          type: 'stdio',
          command: 'C:\\Python310\\python.exe', // Matches second entry
          args: [],
        });

        expect(result.success).toBe(true);
      });

      it('should reject path not in multiple results from where/which', async () => {
        const { spawnSync } = await import('child_process');
        const mockSpawnSync = vi.mocked(spawnSync);
        
        // where python returns multiple paths, but NOT the malicious one
        mockSpawnSync.mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from(
            'C:\\Python39\\python.exe\n' +
            'C:\\Program Files\\Python\\python.exe\n'
          ),
          stderr: Buffer.from(''),
          pid: 12345,
          output: [null, Buffer.from(
            'C:\\Python39\\python.exe\n' +
            'C:\\Program Files\\Python\\python.exe\n'
          ), Buffer.from('')],
          signal: null,
        } as any);

        // User provides path that's NOT in the list
        const result = service.addServer({
          name: 'multi-path-attack',
          type: 'stdio',
          command: 'C:\\Malicious\\python.exe', // NOT in the list
          args: [],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ruta absoluta');
        expect(result.error).toContain('PATH');
      });
    });
  });
});
