import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServerWizard, WizardStep } from '../src/mcp/server-wizard';
import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { AppConfig } from '../src/config';

describe('ServerWizard', () => {
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

  describe('startWizard', () => {
    it('should start a new wizard session', () => {
      const result = wizard.startWizard(userId);
      
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/nombre|name/i);
      expect(result.step).toBe(WizardStep.NAME);
    });

    it('should not allow multiple concurrent wizards for same user', () => {
      wizard.startWizard(userId);
      const result = wizard.startWizard(userId);
      
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/en curso|in progress|already active/i);
    });

    it('should allow wizards for different users', () => {
      const user2 = userState.getOrCreate('654321', 'user2');
      
      const result1 = wizard.startWizard(userId);
      const result2 = wizard.startWizard(user2.id);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe('handleInput', () => {
    it('should progress through STDIO server creation', () => {
      // Start wizard
      wizard.startWizard(userId);
      
      // Step 1: Name
      let result = wizard.handleInput(userId, 'my-server');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.TYPE);
      expect(result.message).toMatch(/tipo|type/i);
      
      // Step 2: Type (STDIO)
      result = wizard.handleInput(userId, '1');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.COMMAND);
      expect(result.message).toMatch(/comando|command/i);
      
      // Step 3: Command
      result = wizard.handleInput(userId, 'node');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.ARGS);
      expect(result.message).toMatch(/argumentos|arguments/i);
      
      // Step 4: Args
      result = wizard.handleInput(userId, 'server.js --port 3000');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.ENV);
      expect(result.message).toMatch(/variables|environment/i);
      
      // Step 5: Env (skip)
      result = wizard.handleInput(userId, '-');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
      expect(result.message).toMatch(/confirma|confirm/i);
      
      // Step 6: Confirm
      result = wizard.handleInput(userId, 'si');
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      expect(result.message).toMatch(/creado|created/i);
      
      // Verify server was created
      const server = service.getServer('my-server');
      expect(server).toBeDefined();
      expect(server?.type).toBe('stdio');
    });

    it('should progress through HTTP server creation', () => {
      wizard.startWizard(userId);
      
      // Name
      wizard.handleInput(userId, 'my-http-server');
      
      // Type (HTTP)
      let result = wizard.handleInput(userId, '2');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.URL);
      expect(result.message).toContain('URL');
      
      // URL - use external URL to avoid SSRF protection
      result = wizard.handleInput(userId, 'https://example.com/mcp');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
      
      // Confirm
      result = wizard.handleInput(userId, 'yes');
      expect(result.success).toBe(true);
      expect(result.complete).toBe(true);
      
      const server = service.getServer('my-http-server');
      expect(server).toBeDefined();
      expect(server?.type).toBe('http');
    });

    it('should reject invalid server name', () => {
      wizard.startWizard(userId);
      
      const result = wizard.handleInput(userId, 'invalid name');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/nombre|name/i);
      expect(result.step).toBe(WizardStep.NAME);
    });

    it('should reject invalid type selection', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'valid-name');
      
      const result = wizard.handleInput(userId, '5');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/tipo|type/i);
      expect(result.step).toBe(WizardStep.TYPE);
    });

    it('should handle environment variables parsing', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'env-test');
      wizard.handleInput(userId, '1'); // STDIO
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, ''); // No args
      
      const result = wizard.handleInput(userId, 'NODE_ENV=production,DEBUG=true');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.CONFIRM);
    });

    it('should allow cancelling wizard', () => {
      wizard.startWizard(userId);
      
      const result = wizard.handleInput(userId, 'cancelar');
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(result.message).toMatch(/cancelado|cancelled/i);
      
      // Should be able to start new wizard
      const newWizard = wizard.startWizard(userId);
      expect(newWizard.success).toBe(true);
    });

    it('should return error for non-existent session', () => {
      const result = wizard.handleInput(999, 'test');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/sesi[oó]n|session/i);
    });
  });

  describe('cancelWizard', () => {
    it('should cancel active wizard', () => {
      wizard.startWizard(userId);
      
      const result = wizard.cancelWizard(userId);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/cancelado|cancelled/i);
      
      // Should be able to start new wizard
      const newWizard = wizard.startWizard(userId);
      expect(newWizard.success).toBe(true);
    });

    it('should return error if no active wizard', () => {
      const result = wizard.cancelWizard(userId);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/activa|active/i);
    });
  });

  describe('getStatus', () => {
    it('should return status of active wizard', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test-server');
      
      const status = wizard.getStatus(userId);
      expect(status).toBeDefined();
      expect(status?.step).toBe(WizardStep.TYPE);
      expect(status?.data.name).toBe('test-server');
    });

    it('should return undefined for non-existent wizard', () => {
      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
    });
  });

  describe('timeout handling', () => {
    it('should expire wizard after 5 minutes of inactivity', () => {
      // Use real time but manually manipulate the session
      wizard.startWizard(userId);
      
      // Manually set lastActivity to 6 minutes ago
      const session = (wizard as any).sessions.get(userId);
      if (session) {
        session.lastActivity = Date.now() - (6 * 60 * 1000);
      }
      
      // Try to continue wizard
      const result = wizard.handleInput(userId, 'test');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/expirado|expired/i);
    });

    it('should not expire wizard with recent activity', () => {
      wizard.startWizard(userId);
      
      // Manipulate session to be 4 minutes ago
      let session = (wizard as any).sessions.get(userId);
      if (session) {
        session.lastActivity = Date.now() - (4 * 60 * 1000);
      }
      
      // Add input (resets timer)
      wizard.handleInput(userId, 'test-server');
      
      // Session should have been updated with new lastActivity
      session = (wizard as any).sessions.get(userId);
      expect(session.lastActivity).toBeGreaterThan(Date.now() - (1 * 1000));
      
      // Should still be active
      const result = wizard.handleInput(userId, '1');
      expect(result.success).toBe(true);
    });
  });

  describe('data validation', () => {
    it('should validate command is not empty', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '1'); // STDIO
      
      const result = wizard.handleInput(userId, '   ');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/comando|command/i);
    });

    it('should validate URL format', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '2'); // HTTP
      
      const result = wizard.handleInput(userId, 'not-a-url');
      expect(result.success).toBe(false);
      expect(result.message).toContain('URL');
    });

    it('should accept empty args', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '1'); // STDIO
      wizard.handleInput(userId, 'node');
      
      const result = wizard.handleInput(userId, '');
      expect(result.success).toBe(true);
      expect(result.step).toBe(WizardStep.ENV);
    });

    it('should parse arguments correctly', () => {
      wizard.startWizard(userId);
      wizard.handleInput(userId, 'test');
      wizard.handleInput(userId, '1');
      wizard.handleInput(userId, 'node');
      wizard.handleInput(userId, 'server.js --port 3000 --host localhost');
      wizard.handleInput(userId, '-');
      wizard.handleInput(userId, 'si');
      
      const server = service.getServer('test');
      const config = server?.config as any;
      expect(config.args).toEqual(['server.js', '--port', '3000', '--host', 'localhost']);
    });
  });

  describe('restart after bot restart', () => {
    it('should clear all wizards on initialization', () => {
      wizard.startWizard(userId);
      const user2 = userState.getOrCreate('654321', 'user2');
      wizard.startWizard(user2.id);
      
      // Create new wizard instance (simulates bot restart)
      const newWizard = new ServerWizard(service);
      
      // Old sessions should not exist
      expect(newWizard.getStatus(userId)).toBeUndefined();
      expect(newWizard.getStatus(user2.id)).toBeUndefined();
      
      // Should be able to start new wizards
      expect(newWizard.startWizard(userId).success).toBe(true);
      expect(newWizard.startWizard(user2.id).success).toBe(true);
    });
  });
});
