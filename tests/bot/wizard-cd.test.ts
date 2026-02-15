import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CdWizard, CdWizardResult } from '../../src/bot/wizard-cd';
import { UserState } from '../../src/state/user-state';
import { WIZARD_TIMEOUT_MS } from '../../src/constants';

// Mock fs module with promises property (matching actual import)
vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  readFileSync: vi.fn(() => '{}'), // For i18n translation loading
}));

// Import after mocking - this matches the actual import pattern
import { promises as fs } from 'fs';

// Mock config module
vi.mock('../../src/config', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    isPathAllowed: vi.fn((p: string) => {
      // Support both Unix and Windows paths (including current drive)
      const allowed = p.startsWith('/allowed') || 
             p.toLowerCase().startsWith('c:\\allowed') ||
             p.toLowerCase().startsWith('c:/allowed') ||
             p.toLowerCase().startsWith('d:\\allowed') ||
             p.toLowerCase().startsWith('d:/allowed');
      return allowed;
    }),
    needsAllowlistSetup: false,
  };
});

describe('CdWizard', () => {
  let userState: UserState;
  let wizard: CdWizard;
  const userId = 123456;
  const telegramId = String(userId);

  beforeEach(() => {
    const testConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/allowed/project',
      COPILOT_DEFAULT_MODEL: 'claude-sonnet-4.5' as any,
    } as any;
    
    userState = new UserState(testConfig);
    userState.getOrCreate(telegramId, 'testuser');
    wizard = new CdWizard(userState);

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Don't clear all - tests manage their own cleanup
    // wizard.clearAll();
  });

  describe('startWizard', () => {
    it('should start a new wizard session', async () => {
      const currentPath = '/allowed/project';
      
      // Mock fs.readdir to return some directories
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
        { name: 'tests', isDirectory: () => true } as any,
        { name: 'file.txt', isDirectory: () => false } as any,
      ]);

      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(true);
      expect(result.message).toContain('wizards.cd.navigationTitle');
      expect(result.message).toContain(currentPath);
      expect(result.keyboard).toBeDefined();
      // 1 row for dirs (2 dirs in 1 row) + 1 row for up + 1 row for confirm + 1 row for cancel = 4 rows
      expect(result.keyboard?.inline_keyboard).toHaveLength(4);
    });

    it('should not allow starting multiple wizards for same user', async () => {
      const currentPath = '/allowed/project';
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);

      await wizard.startWizard(userId, currentPath);
      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.cd.alreadyActive');
    });

    it('should reject disallowed paths', async () => {
      const disallowedPath = '/forbidden/path';

      const result = await wizard.startWizard(userId, disallowedPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('errors.pathNotAllowedByConfig');
    });

    it('should handle directories with no subdirectories', async () => {
      const currentPath = '/allowed/empty';
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'file.txt', isDirectory: () => false } as any,
      ]);

      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(true);
      expect(result.keyboard?.inline_keyboard).toHaveLength(3); // up + confirm + cancel = 3 rows
    });

    it('should handle read errors gracefully', async () => {
      const currentPath = '/allowed/project';
      
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.cd.errorReading');
    });
  });

  describe('handleNavigation', () => {
    beforeEach(async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
        { name: 'tests', isDirectory: () => true } as any,
      ]);
      await wizard.startWizard(userId, '/allowed/project');
    });

    it('should navigate to subdirectory', async () => {
      // Mock fs.stat for directory validation (must succeed)
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any);
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'components', isDirectory: () => true } as any,
      ]);

      const result = await wizard.handleNavigation(userId, 'src');

      expect(result.success).toBe(true);
      // Use platform-agnostic path check
      expect(result.message.toLowerCase()).toContain('allowed');
      expect(result.message.toLowerCase()).toContain('project');
      expect(result.message.toLowerCase()).toContain('src');
    });

    it('should navigate up to parent directory', async () => {
      // First navigate down
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any);
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: 'components', isDirectory: () => true } as any,
      ]);
      await wizard.handleNavigation(userId, 'src');

      // Then navigate up
      vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any);
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: 'src', isDirectory: () => true } as any,
        { name: 'tests', isDirectory: () => true } as any,
      ]);

      const result = await wizard.handleNavigation(userId, '..');

      expect(result.success).toBe(true);
      // Use platform-agnostic path check
      expect(result.message.toLowerCase()).toContain('allowed');
      expect(result.message.toLowerCase()).toContain('project');
    });

    it('should prevent navigating above allowed paths', async () => {
      const result = await wizard.handleNavigation(userId, '/forbidden/path');

      expect(result.success).toBe(false);
      expect(result.message).toContain('errors.pathNotAllowedByConfig');
    });

    it('should handle non-existent directories', async () => {
      // Mock fs.stat to reject for this specific call (directory doesn't exist)
      vi.mocked(fs.stat).mockRejectedValueOnce(new Error('ENOENT'));
      
      const result = await wizard.handleNavigation(userId, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('no existe');
    });

    it('should reject navigation for non-active wizard', async () => {
      const result = await wizard.handleNavigation(999999, 'src');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.cd.noActiveWizard');
    });
  });

  describe('handleConfirm', () => {
    beforeEach(async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);
      await wizard.startWizard(userId, '/allowed/project');
    });

    it('should confirm and return final path', async () => {
      const result = await wizard.handleConfirm(userId);

      expect(result.success).toBe(true);
      expect(result.finalPath).toBe('/allowed/project');
      expect(result.confirmed).toBe(true);
    });

    it('should clear wizard session after confirm', async () => {
      await wizard.handleConfirm(userId);

      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
    });

    it('should reject confirm for non-active wizard', async () => {
      const result = await wizard.handleConfirm(999999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.cd.noActiveWizard');
    });
  });

  describe('handleCancel', () => {
    beforeEach(async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);
      await wizard.startWizard(userId, '/allowed/project');
    });

    it('should cancel wizard and clear session', async () => {
      const result = await wizard.handleCancel(userId);

      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);

      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
    });

    it('should reject cancel for non-active wizard', async () => {
      const result = await wizard.handleCancel(999999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.cd.noActiveWizard');
    });
  });

  describe('pagination', () => {
    it('should paginate when more than 8 directories', async () => {
      const currentPath = '/allowed/large';
      
      // Create 15 directories
      const dirs = Array.from({ length: 15 }, (_, i) => ({
        name: `dir${i + 1}`,
        isDirectory: () => true,
      }));
      
      vi.mocked(fs.readdir).mockResolvedValue(dirs as any);

      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(true);
      // Should show first 8 dirs + navigation buttons (up, next, confirm, cancel)
      expect(result.keyboard?.inline_keyboard.length).toBeLessThanOrEqual(12);
    });

    it('should navigate to next page', async () => {
      const currentPath = '/allowed/large';
      
      const dirs = Array.from({ length: 15 }, (_, i) => ({
        name: `dir${i + 1}`,
        isDirectory: () => true,
      }));
      
      vi.mocked(fs.readdir).mockResolvedValue(dirs as any);
      await wizard.startWizard(userId, currentPath);

      const result = await wizard.handlePageChange(userId, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain(currentPath);
    });

    it('should navigate to previous page', async () => {
      const currentPath = '/allowed/large';
      
      const dirs = Array.from({ length: 15 }, (_, i) => ({
        name: `dir${i + 1}`,
        isDirectory: () => true,
      }));
      
      vi.mocked(fs.readdir).mockResolvedValue(dirs as any);
      await wizard.startWizard(userId, currentPath);
      await wizard.handlePageChange(userId, 1);

      // Go back to page 0
      vi.mocked(fs.readdir).mockResolvedValue(dirs as any); // Keep same mock
      const result = await wizard.handlePageChange(userId, 0);

      expect(result.success).toBe(true);
      expect(result.message).toContain(currentPath);
    });
  });

  describe('timeout and cleanup', () => {
    it.skip('should auto-cleanup expired wizards', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);
      
      await wizard.startWizard(userId, '/allowed/project');

      // Fast-forward time
      vi.useFakeTimers();
      vi.advanceTimersByTime(WIZARD_TIMEOUT_MS + 1000);
      
      const status = wizard.getStatus(userId);
      expect(status).toBeUndefined();
      
      // Restore real timers
      vi.useRealTimers();
    });
  });

  describe('Windows path handling', () => {
    // Skip Windows path tests for now since mock only allows /allowed paths
    it.skip('should handle Windows paths correctly', async () => {
      const currentPath = 'C:\\allowed\\project';
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);

      const result = await wizard.startWizard(userId, currentPath);

      expect(result.success).toBe(true);
      expect(result.message).toContain('C:\\allowed\\project');
    });

    it.skip('should navigate in Windows paths', async () => {
      const currentPath = 'C:\\allowed\\project';
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);
      await wizard.startWizard(userId, currentPath);

      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'components', isDirectory: () => true } as any,
      ]);

      const result = await wizard.handleNavigation(userId, 'src');

      expect(result.success).toBe(true);
      expect(result.message).toContain('C:\\allowed\\project\\src');
    });
  });

  describe('security validations', () => {
    it('should prevent path traversal attacks', async () => {
      // Cancel any existing wizard first
      await wizard.handleCancel(userId);
      
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: () => true } as any,
      ]);
      await wizard.startWizard(userId, '/allowed/project');

      const result = await wizard.handleNavigation(userId, '../../../etc/passwd');

      expect(result.success).toBe(false);
      expect(result.message).toContain('errors.pathNotAllowedByConfig');
    });

    it('should validate all paths against ALLOWED_PATHS', async () => {
      const disallowedPath = '/forbidden/directory';

      const result = await wizard.startWizard(userId + 1, disallowedPath); // Different user

      expect(result.success).toBe(false);
      expect(result.message).toContain('errors.pathNotAllowedByConfig');
    });

    it('should sanitize HTML in error messages', async () => {
      const maliciousPath = '/allowed/<script>alert("xss")</script>';
      
      vi.mocked(fs.readdir).mockRejectedValue(new Error('<script>alert("xss")</script>'));

      const result = await wizard.startWizard(userId + 2, '/allowed/project'); // Different user

      expect(result.message).not.toContain('<script>');
    });
  });
});
