import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from 'grammy';
import { AllowlistSetupWizard } from '../src/bot/allowlist-setup';
import { UserState } from '../src/state/user-state';
import * as pathSetup from '../src/utils/path-setup';

describe('AllowlistSetupWizard - ID Consistency', () => {
  let wizard: AllowlistSetupWizard;
  let userState: UserState;
  let mockCtx: any;

  const TELEGRAM_ID = 123456789;
  const TELEGRAM_USERNAME = 'testuser';

  beforeEach(() => {
    // Use in-memory database for tests
    userState = new UserState({
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test/path',
      COPILOT_DEFAULT_MODEL: 'claude-sonnet-4',
    } as any);

    wizard = new AllowlistSetupWizard(userState);

    // Mock context
    mockCtx = {
      from: {
        id: TELEGRAM_ID,
        username: TELEGRAM_USERNAME,
      },
      reply: vi.fn().mockResolvedValue({}),
    };

    // Mock path-setup utilities
    vi.spyOn(pathSetup, 'parsePaths').mockReturnValue({
      valid: ['C:\\Users\\Test\\Projects'],
      invalid: [],
    });
    vi.spyOn(pathSetup, 'updateEnvFile').mockImplementation(() => {});
    
    // Mock process.exit to prevent actual exit
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  describe('ID Consistency Throughout Wizard Flow', () => {
    it('should use Telegram ID consistently in setup initiation', async () => {
      // Start setup - should use Telegram ID
      await wizard.startSetup(mockCtx);

      // Verify wizard recognizes setup with Telegram ID
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);
      
      // Should NOT recognize with different ID
      expect(wizard.isInSetup(999)).toBe(false);
    });

    it('should use Telegram ID consistently in needsSetup check', () => {
      // User not configured yet
      expect(wizard.needsSetup(TELEGRAM_ID)).toBe(true);

      // Create user with Telegram ID (simulating message-handler flow)
      const user = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      
      // Mark as configured using DB ID (current implementation)
      userState.markAllowedPathsConfigured(user.id);

      // needsSetup should check by Telegram ID, not DB ID
      expect(wizard.needsSetup(TELEGRAM_ID)).toBe(false);
    });

    it('should handle input with Telegram ID and not create duplicate users', async () => {
      // Start wizard
      await wizard.startSetup(mockCtx);

      // Simulate message-handler flow: create user first
      const user = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      const dbIdBeforeInput = user.id;

      // Handle input - should use Telegram ID, not create new user
      await wizard.handleInput(mockCtx, 'C:\\Users\\Test\\Projects', TELEGRAM_ID);

      // Verify user wasn't duplicated
      const userAfter = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      expect(userAfter.id).toBe(dbIdBeforeInput);

      // Verify user is marked as configured
      expect(userState.isAllowedPathsConfigured(userAfter.id)).toBe(true);
    });

    it('should complete full wizard flow without ID mismatches', async () => {
      // Simulate full flow as it happens in message-handler

      // 1. User sends /start, bot checks if setup needed
      const user = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      expect(wizard.needsSetup(TELEGRAM_ID)).toBe(true);

      // 2. Start wizard
      await wizard.startSetup(mockCtx);
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);

      // 3. User sends paths, message-handler checks wizard state with Telegram ID
      const isInWizard = wizard.isInSetup(TELEGRAM_ID);
      expect(isInWizard).toBe(true);

      // 4. Handle input with Telegram ID
      await wizard.handleInput(mockCtx, 'C:\\Users\\Test\\Projects', TELEGRAM_ID);

      // 5. Verify wizard completed
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(false);
      expect(userState.isAllowedPathsConfigured(user.id)).toBe(true);
    });

    it('should not recognize wizard state when different IDs are mixed', async () => {
      const DIFFERENT_ID = 987654321;

      // Start wizard with one ID
      await wizard.startSetup(mockCtx);
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);

      // Should not recognize with different ID
      expect(wizard.isInSetup(DIFFERENT_ID)).toBe(false);

      // Attempt to handle input with wrong ID should fail
      const handled = await wizard.handleInput(
        mockCtx, 
        'C:\\Users\\Test\\Projects', 
        DIFFERENT_ID
      );
      expect(handled).toBe(false);

      // Original ID should still be in wizard
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);
    });
  });

  describe('Integration with UserState', () => {
    it('should correctly map Telegram ID to DB operations', async () => {
      // Create user with Telegram ID
      const user1 = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      const dbId1 = user1.id;

      // Start wizard
      await wizard.startSetup(mockCtx);

      // Handle input
      await wizard.handleInput(mockCtx, 'C:\\Users\\Test\\Projects', TELEGRAM_ID);

      // Verify correct user was updated
      const user2 = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      expect(user2.id).toBe(dbId1); // Same DB ID
      expect(userState.isAllowedPathsConfigured(user2.id)).toBe(true);
    });

    it('should handle conversion between string and number Telegram IDs', () => {
      // Create with string (as message-handler does)
      const user1 = userState.getOrCreate(String(TELEGRAM_ID), TELEGRAM_USERNAME);
      
      // Check wizard state with number (as ctx.from.id provides)
      expect(wizard.needsSetup(TELEGRAM_ID)).toBe(true);
      
      // Mark as configured
      userState.markAllowedPathsConfigured(user1.id);
      
      // Should reflect in wizard check
      expect(wizard.needsSetup(TELEGRAM_ID)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing ctx.from.id gracefully', async () => {
      const ctxWithoutUser = { ...mockCtx, from: undefined };
      
      await wizard.startSetup(ctxWithoutUser);
      
      // Should not crash, wizard should not be activated
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(false);
    });

    it('should handle concurrent wizards for different users', async () => {
      const USER2_ID = 111222333;
      const mockCtx2 = {
        from: { id: USER2_ID, username: 'user2' },
        reply: vi.fn().mockResolvedValue({}),
      };

      // Start wizard for user 1
      await wizard.startSetup(mockCtx);
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);

      // Start wizard for user 2
      await wizard.startSetup(mockCtx2);
      expect(wizard.isInSetup(USER2_ID)).toBe(true);

      // Both should be in wizard
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(true);
      expect(wizard.isInSetup(USER2_ID)).toBe(true);

      // Complete user 1
      await wizard.handleInput(mockCtx, 'C:\\Test', TELEGRAM_ID);
      expect(wizard.isInSetup(TELEGRAM_ID)).toBe(false);
      expect(wizard.isInSetup(USER2_ID)).toBe(true);
    });
  });
});
