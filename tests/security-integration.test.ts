import { describe, it, expect, beforeEach } from 'vitest';
import { ServerManagementService } from '../src/mcp/server-management';
import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('Security Fixes Integration Tests', () => {
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

  it('should create complete STDIO server with quoted arguments safely', () => {
    // Start wizard
    wizard.startWizard(userId);
    
    // Server name
    wizard.handleInput(userId, 'secure-server');
    
    // Type (STDIO)
    wizard.handleInput(userId, '1');
    
    // Command (no injection)
    wizard.handleInput(userId, 'node');
    
    // Args with quotes
    const result = wizard.handleInput(userId, 'app.js --message "Hello World" --path "/usr/local/bin"');
    expect(result.success).toBe(true);
    
    // Verify args were parsed correctly
    const status = wizard.getStatus(userId);
    expect(status?.data.args).toEqual([
      'app.js',
      '--message',
      'Hello World',
      '--path',
      '/usr/local/bin'
    ]);
    
    // Skip env
    wizard.handleInput(userId, '-');
    
    // Confirm
    const confirmResult = wizard.handleInput(userId, 'si');
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.complete).toBe(true);
    
    // Verify server was created
    const server = service.getServer('secure-server');
    expect(server).toBeDefined();
    expect(server?.name).toBe('secure-server');
    expect(server?.type).toBe('stdio');
  });

  it('should create HTTP server with strict protocol validation', () => {
    // Start wizard
    wizard.startWizard(userId);
    
    // Server name
    wizard.handleInput(userId, 'http-server');
    
    // Type (HTTP)
    wizard.handleInput(userId, '2');
    
    // Valid HTTPS URL
    const result = wizard.handleInput(userId, 'https://api.example.com');
    expect(result.success).toBe(true);
    
    // Confirm
    const confirmResult = wizard.handleInput(userId, 'si');
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.complete).toBe(true);
    
    // Verify server was created
    const server = service.getServer('http-server');
    expect(server).toBeDefined();
    expect(server?.config.url).toBe('https://api.example.com');
  });

  it('should reject invalid protocols in wizard flow', () => {
    // Start wizard
    wizard.startWizard(userId);
    
    // Server name
    wizard.handleInput(userId, 'bad-server');
    
    // Type (HTTP)
    wizard.handleInput(userId, '2');
    
    // Invalid protocol - URL itself is valid, but protocol check happens on confirm
    wizard.handleInput(userId, 'ftp://files.example.com');
    
    // Try to confirm - this is where validation happens
    const result = wizard.handleInput(userId, 'si');
    expect(result.success).toBe(false);
    expect(result.message).toContain('http:// o https://');
    
    // Verify server was NOT created
    const server = service.getServer('bad-server');
    expect(server).toBeUndefined();
  });

  it('should handle complex argument parsing scenarios', () => {
    wizard.startWizard(userId);
    wizard.handleInput(userId, 'complex-args-server');
    wizard.handleInput(userId, '1'); // STDIO
    wizard.handleInput(userId, 'python');
    
    // Complex args with nested quotes and special characters
    wizard.handleInput(userId, 'script.py --config "path/with spaces/config.json" --name \'John O\\\'Brien\' --debug');
    
    const status = wizard.getStatus(userId);
    expect(status?.data.args).toEqual([
      'script.py',
      '--config',
      'path/with spaces/config.json',
      '--name',
      "John O'Brien",
      '--debug'
    ]);
  });

  it('should access service through public API without type casting', () => {
    // Create wizard
    const testWizard = new ServerWizard(service);
    
    // Get service through public API
    const exposedService = testWizard.getService();
    
    // Use the service to add a server
    const result = exposedService.addServer({
      name: 'via-public-api',
      type: 'stdio',
      command: 'node',
      args: ['test.js'],
    });
    
    expect(result.success).toBe(true);
    
    // Verify it's the same service instance
    const server = service.getServer('via-public-api');
    expect(server).toBeDefined();
    expect(server?.name).toBe('via-public-api');
  });

  it('should prevent command injection in validation', () => {
    // Try to add a server with malicious command containing shell metacharacters
    const result = service.addServer({
      name: 'injection-test',
      type: 'stdio',
      command: 'node; rm -rf /',
      args: [],
    });
    
    // SECURITY: Command with shell metacharacters (;) should be REJECTED
    // to prevent command injection attacks
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('caracteres no permitidos');
    
    // Verify server was NOT created
    const server = service.getServer('injection-test');
    expect(server).toBeUndefined();
  });

  it.skip('should handle all security scenarios in end-to-end flow', () => {
    // 1. Create STDIO server with quoted args
    wizard.startWizard(userId);
    wizard.handleInput(userId, 'e2e-stdio');
    wizard.handleInput(userId, '1');
    wizard.handleInput(userId, 'npm');
    wizard.handleInput(userId, 'run dev -- --port "8080"');
    wizard.handleInput(userId, 'NODE_ENV=production');
    wizard.handleInput(userId, 'si');
    
    let server = service.getServer('e2e-stdio');
    expect(server).toBeDefined();
    expect(server?.config.args).toContain('--port');
    expect(server?.config.args).toContain('8080');
    
    // 2. Create HTTP server with valid protocol
    wizard.startWizard(userId);
    wizard.handleInput(userId, 'e2e-http');
    wizard.handleInput(userId, '2');
    wizard.handleInput(userId, 'https://secure.example.com');
    wizard.handleInput(userId, 'si');
    
    server = service.getServer('e2e-http');
    expect(server).toBeDefined();
    expect(server?.config.url).toBe('https://secure.example.com');
    
    // 3. Verify both servers exist
    const allServers = service.listServers();
    expect(allServers.length).toBeGreaterThanOrEqual(2);
    expect(allServers.find(s => s.name === 'e2e-stdio')).toBeDefined();
    expect(allServers.find(s => s.name === 'e2e-http')).toBeDefined();
  });
});
