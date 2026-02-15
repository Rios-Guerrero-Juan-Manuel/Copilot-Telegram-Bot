import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AllowlistSetupWizard } from '../src/bot/allowlist-setup';
import { ServerWizard } from '../src/mcp/server-wizard';
import { ServerManagementService } from '../src/mcp/server-management';
import { UserState } from '../src/state/user-state';
import { WIZARD_TIMEOUT_MS } from '../src/constants';
import { logger } from '../src/utils/logger';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

describe('Wizard TTL Cleanup', () => {
  let userState: UserState;

  beforeEach(() => {
    vi.useFakeTimers();
    userState = new UserState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('AllowlistSetupWizard', () => {
    it('should cleanup wizard session after TTL expires', async () => {
      const wizard = new AllowlistSetupWizard(userState);
      const userId = 123456;

      // Create a mock context
      const mockCtx = {
        from: { id: userId, username: 'testuser' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      // Start setup
      await wizard.startSetup(mockCtx);
      expect(wizard.isInSetup(userId)).toBe(true);

      // Fast-forward time to just before TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS - 1000);
      expect(wizard.isInSetup(userId)).toBe(true);

      // Fast-forward past TTL
      vi.advanceTimersByTime(2000);
      expect(wizard.isInSetup(userId)).toBe(false);
    });

    it('should update lastActivity on input and extend TTL', async () => {
      const wizard = new AllowlistSetupWizard(userState);
      const userId = 123456;

      const mockCtx = {
        from: { id: userId, username: 'testuser' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      // Start setup
      await wizard.startSetup(mockCtx);
      expect(wizard.isInSetup(userId)).toBe(true);

      // Fast-forward to 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      // User provides input (invalid to keep wizard open)
      await wizard.handleInput(mockCtx, '', userId);

      // Fast-forward another 3 minutes (6 minutes total, but activity was at 3)
      vi.advanceTimersByTime(3 * 60 * 1000);
      
      // Should still be active because we updated lastActivity at 3 min mark
      // and TTL is 5 min from last activity
      expect(wizard.isInSetup(userId)).toBe(true);

      // Fast-forward past TTL from last activity
      vi.advanceTimersByTime(3 * 60 * 1000);
      expect(wizard.isInSetup(userId)).toBe(false);
    });

    it('should log cleanup event', async () => {
      const wizard = new AllowlistSetupWizard(userState);
      const userId = 123456;

      const mockCtx = {
        from: { id: userId, username: 'testuser' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      await wizard.startSetup(mockCtx);
      
      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Check that cleanup was logged
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Wizard session cleaned up'),
        expect.any(Object)
      );
    });

    it('should not cleanup if wizard completes normally', async () => {
      const wizard = new AllowlistSetupWizard(userState);
      const userId = 123456;

      const mockCtx = {
        from: { id: userId, username: 'testuser' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      await wizard.startSetup(mockCtx);
      
      // Cancel wizard manually
      wizard.cancelSetup(userId);
      expect(wizard.isInSetup(userId)).toBe(false);

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);
      
      // Should still be false (no errors)
      expect(wizard.isInSetup(userId)).toBe(false);
    });

    it('should handle multiple users independently', async () => {
      const wizard = new AllowlistSetupWizard(userState);
      const user1 = 111111;
      const user2 = 222222;

      const mockCtx1 = {
        from: { id: user1, username: 'user1' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      const mockCtx2 = {
        from: { id: user2, username: 'user2' },
        reply: vi.fn().mockResolvedValue({}),
      } as any;

      // Start both wizards
      await wizard.startSetup(mockCtx1);
      await wizard.startSetup(mockCtx2);

      expect(wizard.isInSetup(user1)).toBe(true);
      expect(wizard.isInSetup(user2)).toBe(true);

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Both should be cleaned up
      expect(wizard.isInSetup(user1)).toBe(false);
      expect(wizard.isInSetup(user2)).toBe(false);
    });
  });

  describe('ServerWizard', () => {
    let serverService: ServerManagementService;

    beforeEach(() => {
      const userId = 123456;
      serverService = new ServerManagementService(userState, userId);
    });

    it('should cleanup wizard session after TTL expires', () => {
      const wizard = new ServerWizard(serverService);
      const userId = 123456;

      // Start wizard
      const result = wizard.startWizard(userId);
      expect(result.success).toBe(true);
      expect(wizard.getStatus(userId)).toBeDefined();

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Should be cleaned up
      expect(wizard.getStatus(userId)).toBeUndefined();
    });

    it('should update lastActivity on input and extend TTL', () => {
      const wizard = new ServerWizard(serverService);
      const userId = 123456;

      wizard.startWizard(userId);

      // Fast-forward to 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      // User provides input
      wizard.handleInput(userId, 'test-server');

      // Fast-forward another 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      // Should still be active
      expect(wizard.getStatus(userId)).toBeDefined();

      // Fast-forward past TTL from last activity
      vi.advanceTimersByTime(3 * 60 * 1000);
      expect(wizard.getStatus(userId)).toBeUndefined();
    });

    it('should log cleanup event', () => {
      const wizard = new ServerWizard(serverService);
      const userId = 123456;

      wizard.startWizard(userId);

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Check that cleanup was logged
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Wizard session cleaned up'),
        expect.any(Object)
      );
    });

    it('should not cleanup if wizard completes normally', () => {
      const wizard = new ServerWizard(serverService);
      const userId = 123456;

      wizard.startWizard(userId);
      
      // Cancel wizard
      wizard.cancelWizard(userId);
      expect(wizard.getStatus(userId)).toBeUndefined();

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Should still be undefined (no errors)
      expect(wizard.getStatus(userId)).toBeUndefined();
    });

    it('should handle multiple users independently', () => {
      const wizard = new ServerWizard(serverService);
      const user1 = 111111;
      const user2 = 222222;

      // Start both wizards
      wizard.startWizard(user1);
      wizard.startWizard(user2);

      expect(wizard.getStatus(user1)).toBeDefined();
      expect(wizard.getStatus(user2)).toBeDefined();

      // Fast-forward past TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);

      // Both should be cleaned up
      expect(wizard.getStatus(user1)).toBeUndefined();
      expect(wizard.getStatus(user2)).toBeUndefined();
    });

    it('should use configurable TTL constant', () => {
      const wizard = new ServerWizard(serverService);
      const userId = 123456;

      wizard.startWizard(userId);

      // Just before TTL
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS - 1000);
      expect(wizard.getStatus(userId)).toBeDefined();

      // After TTL
      vi.advanceTimersByTime(2000);
      expect(wizard.getStatus(userId)).toBeUndefined();
    });
  });

  describe('TTL Configuration', () => {
    it('should use WIZARD_TIMEOUT_MS constant', () => {
      // Verify the constant exists and has expected value
      expect(WIZARD_TIMEOUT_MS).toBeDefined();
      expect(WIZARD_TIMEOUT_MS).toBe(5 * 60 * 1000); // 5 minutes
    });
  });
});
