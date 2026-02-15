/**
 * Tests for AddProjectWizard - Interactive wizard for /addproject command
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AddProjectWizard } from '../../src/bot/wizard-addproject';
import { UserState } from '../../src/state/user-state';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
  readFileSync: vi.fn(() => '{}'), // For i18n translation loading
}));

// Mock config module
vi.mock('../../src/config', () => ({
  isPathAllowed: vi.fn(() => true),
  config: {
    DEFAULT_PROJECT_PATH: 'C:\\test',
    DB_PATH: ':memory:',
    COPILOT_DEFAULT_MODEL: 'claude-sonnet-4',
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456789',
  },
  needsAllowlistSetup: false,
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('AddProjectWizard', () => {
  let wizard: AddProjectWizard;
  let userState: UserState;
  const userId = 123456789;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset isPathAllowed to default behavior (return true)
    const { isPathAllowed } = await import('../../src/config');
    (isPathAllowed as any).mockReturnValue(true);
    
    userState = new UserState();
    wizard = new AddProjectWizard(userState);
  });

  afterEach(() => {
    wizard.clearAll();
  });

  describe('Step 1: Name Input', () => {
    it('should start wizard asking for project name', async () => {
      const result = await wizard.startWizard(userId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('wizards.addProject.step1Title');
      expect(result.keyboard).toBeDefined();
      expect(wizard.hasActiveWizard(userId)).toBe(true);
    });

    it('should prevent starting multiple wizards for same user', async () => {
      await wizard.startWizard(userId);
      const result = await wizard.startWizard(userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.alreadyActive');
    });

    it('should accept valid project name', async () => {
      // Mock filesystem for handleNameInput
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockResolvedValue([
        { name: 'folder1', isDirectory: () => true },
      ]);

      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, 'MyProject');

      expect(result.success).toBe(true);
      expect(result.message).toContain('directorio');
      expect(result.keyboard).toBeDefined();
    });

    it('should reject empty project name', async () => {
      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, '');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.nameEmpty');
    });

    it('should reject project name with special characters', async () => {
      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, 'My/Project');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.invalidCharacters');
    });

    it('should reject duplicate project name', async () => {
      const user = userState.getOrCreate('123456789');
      userState.addProject(user.id, 'ExistingProject', 'C:\\test');

      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, 'ExistingProject');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.nameAlreadyExists');
    });
  });

  describe('Step 2: Directory Navigation', () => {
    beforeEach(() => {
      // Mock filesystem for directory navigation
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath === 'C:\\test') {
          return Promise.resolve([
            { name: 'folder1', isDirectory: () => true },
            { name: 'folder2', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false },
          ]);
        }
        if (dirPath === 'C:\\test\\folder1') {
          return Promise.resolve([
            { name: 'subfolder', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([]);
      });

      const mockStat = fs.promises.stat as any;
      mockStat.mockImplementation(() =>
        Promise.resolve({
          isDirectory: () => true,
        })
      );

      const mockAccess = fs.promises.access as any;
      mockAccess.mockResolvedValue(undefined);
    });

    it('should show directories after name input', async () => {
      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, 'NewProject');

      expect(result.success).toBe(true);
      expect(result.keyboard).toBeDefined();
      // Message contains step2Title key and directory count
      expect(result.message).toContain('wizards.addProject.step2Title');
      expect(result.message).toContain('2');
      expect(result.message).not.toContain('file.txt');
    });

    it('should navigate into subdirectory', async () => {
      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'NewProject');
      const result = await wizard.handleNavigation(userId, 'folder1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('folder1');
      // Message contains step2Title key
      expect(result.message).toContain('wizards.addProject.step2Title');
    });

    it('should navigate to parent directory', async () => {
      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'NewProject');
      await wizard.handleNavigation(userId, 'folder1');
      const result = await wizard.handleNavigation(userId, '..');

      expect(result.success).toBe(true);
      expect(result.message).toContain('C:\\test');
    });

    it('should reject navigation to disallowed path', async () => {
      const { isPathAllowed } = await import('../../src/config');
      
      // Mock to return false only when path contains 'folder1'
      (isPathAllowed as any).mockImplementation((checkPath: string) => {
        return !checkPath.includes('folder1');
      });

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'NewProject');
      const result = await wizard.handleNavigation(userId, 'folder1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no permitida|not allowed|pathNotAllowedByConfig/i);
    });

    it('should handle pagination with many directories', async () => {
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockImplementation(() => {
        const dirs = [];
        for (let i = 0; i < 20; i++) {
          dirs.push({ name: `folder${i}`, isDirectory: () => true });
        }
        return Promise.resolve(dirs);
      });

      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, 'NewProject');

      expect(result.success).toBe(true);
      expect(result.message).toContain('1-8 de 20'); // First page shows 8 items
    });

    it('should navigate to next page', async () => {
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockImplementation(() => {
        const dirs = [];
        for (let i = 0; i < 20; i++) {
          dirs.push({ name: `folder${i}`, isDirectory: () => true });
        }
        return Promise.resolve(dirs);
      });

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'NewProject');
      const result = await wizard.handlePageChange(userId, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('9-16 de 20'); // Second page
    });
  });

  describe('Step 3: Confirmation', () => {
    beforeEach(() => {
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockResolvedValue([
        { name: 'folder1', isDirectory: () => true },
      ]);

      const mockStat = fs.promises.stat as any;
      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });

      const mockAccess = fs.promises.access as any;
      mockAccess.mockResolvedValue(undefined);
    });

    it('should show confirmation step', async () => {
      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'MyProject');
      const result = await wizard.handleShowConfirmation(userId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('wizards.addProject.step3Title');
      // Note: Without real translations, params (MyProject, path) aren't substituted
      expect(result.keyboard).toBeDefined();
    });

    it('should save project on confirmation', async () => {
      const user = userState.getOrCreate('123456789');

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'MyProject');
      const result = await wizard.handleConfirm(userId);

      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(wizard.hasActiveWizard(userId)).toBe(false);

      const projects = userState.listProjects(user.id);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('MyProject');
      expect(projects[0].path).toBe('C:\\test');
    });

    it('should cancel wizard without saving', async () => {
      const user = userState.getOrCreate('123456789');

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'MyProject');
      const result = await wizard.handleCancel(userId);

      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(wizard.hasActiveWizard(userId)).toBe(false);

      const projects = userState.listProjects(user.id);
      expect(projects).toHaveLength(0);
    });
  });

  describe('Security Validations', () => {
    it('should escape HTML in error messages', async () => {
      await wizard.startWizard(userId);
      const result = await wizard.handleNameInput(userId, '<script>alert("xss")</script>');

      expect(result.success).toBe(false);
      expect(result.message).not.toContain('<script>');
    });

    it('should validate path on every navigation', async () => {
      const { isPathAllowed } = await import('../../src/config');
      let callCount = 0;
      (isPathAllowed as any).mockImplementation(() => {
        callCount++;
        return true;
      });

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'Test');
      await wizard.handleNavigation(userId, 'folder1');

      expect(callCount).toBeGreaterThan(0);
    });

    it('should reject path traversal attempts', async () => {
      const { isPathAllowed } = await import('../../src/config');
      
      // Mock that the path traversal resolves to a disallowed path
      (isPathAllowed as any).mockImplementation((checkPath: string) => {
        // Reject if the path goes outside the allowed directories
        return !checkPath.includes('etc');
      });

      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'Test');
      const result = await wizard.handleNavigation(userId, '../../../etc/passwd');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no permitida|not allowed|pathNotAllowedByConfig/i);
    });

    // CRITICAL SECURITY TESTS - ALLOWED_PATHS Bypass Prevention
    it('should reject startWizard when currentCwd is not in ALLOWED_PATHS', async () => {
      const { isPathAllowed } = await import('../../src/config');
      
      // Mock isPathAllowed to reject the current user's CWD
      (isPathAllowed as any).mockReturnValueOnce(false);

      const result = await wizard.startWizard(userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.pathNotAllowedStart');
      expect(wizard.hasActiveWizard(userId)).toBe(false);
    });

    it('should reject handleConfirm when session path is not in ALLOWED_PATHS', async () => {
      const { isPathAllowed } = await import('../../src/config');
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockResolvedValue([
        { name: 'folder1', isDirectory: () => true },
      ]);

      // Allow path during setup but deny during confirmation
      (isPathAllowed as any).mockReturnValue(true);
      
      await wizard.startWizard(userId);
      await wizard.handleNameInput(userId, 'MyProject');

      // Now deny the path at confirmation time
      (isPathAllowed as any).mockReturnValueOnce(false);
      
      const result = await wizard.handleConfirm(userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.pathNotAllowedConfirm');
      expect(wizard.hasActiveWizard(userId)).toBe(false);

      // Verify project was NOT saved
      const user = userState.getOrCreate('123456789');
      const projects = userState.listProjects(user.id);
      expect(projects).toHaveLength(0);
    });

    it('should validate path in both startWizard and handleConfirm', async () => {
      const { isPathAllowed } = await import('../../src/config');
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockResolvedValue([
        { name: 'folder1', isDirectory: () => true },
      ]);

      let validateCount = 0;
      (isPathAllowed as any).mockImplementation(() => {
        validateCount++;
        return true;
      });

      await wizard.startWizard(userId);
      const startValidations = validateCount;
      expect(startValidations).toBeGreaterThan(0);

      await wizard.handleNameInput(userId, 'MyProject');
      await wizard.handleConfirm(userId);

      // Confirm should also validate the path
      expect(validateCount).toBeGreaterThan(startValidations);
    });
  });

  describe('Wizard Lifecycle', () => {
    it('should timeout after 5 minutes', async () => {
      vi.useFakeTimers();

      await wizard.startWizard(userId);
      expect(wizard.hasActiveWizard(userId)).toBe(true);

      // Fast-forward 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(wizard.hasActiveWizard(userId)).toBe(false);

      vi.useRealTimers();
    });

    it('should clear all sessions on shutdown', async () => {
      await wizard.startWizard(userId);
      await wizard.startWizard(userId + 1);

      expect(wizard.hasActiveWizard(userId)).toBe(true);
      expect(wizard.hasActiveWizard(userId + 1)).toBe(true);

      wizard.clearAll();

      expect(wizard.hasActiveWizard(userId)).toBe(false);
      expect(wizard.hasActiveWizard(userId + 1)).toBe(false);
    });

    it('should handle no active wizard gracefully', async () => {
      const result = await wizard.handleNameInput(userId, 'Test');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wizards.addProject.noActiveWizard');
    });
  });

  describe('Full Flow Integration', () => {
    beforeEach(() => {
      const mockReaddir = fs.promises.readdir as any;
      mockReaddir.mockImplementation((dirPath: string) => {
        if (dirPath.endsWith('folder1')) {
          return Promise.resolve([
            { name: 'subfolder', isDirectory: () => true },
          ]);
        }
        return Promise.resolve([
          { name: 'folder1', isDirectory: () => true },
          { name: 'folder2', isDirectory: () => true },
        ]);
      });

      const mockStat = fs.promises.stat as any;
      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });

      const mockAccess = fs.promises.access as any;
      mockAccess.mockResolvedValue(undefined);
    });

    it('should complete full wizard flow', async () => {
      const user = userState.getOrCreate('123456789');

      // Step 1: Start wizard
      const start = await wizard.startWizard(userId);
      expect(start.success).toBe(true);

      // Step 2: Enter name
      const name = await wizard.handleNameInput(userId, 'MyProject');
      expect(name.success).toBe(true);

      // Step 3: Navigate to folder
      const nav = await wizard.handleNavigation(userId, 'folder1');
      expect(nav.success).toBe(true);

      // Step 4: Show confirmation
      const confirm = await wizard.handleShowConfirmation(userId);
      expect(confirm.success).toBe(true);
      expect(confirm.message).toContain('wizards.addProject.step3Title');
      // Note: Without real translations, params aren't substituted

      // Step 5: Confirm
      const final = await wizard.handleConfirm(userId);
      expect(final.success).toBe(true);
      expect(final.confirmed).toBe(true);

      // Verify project was saved
      const projects = userState.listProjects(user.id);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('MyProject');
      expect(projects[0].path).toContain('folder1');
    });

    it('should generate correct callback for confirm button in navigation step', async () => {
      await wizard.startWizard(userId);
      const nameResult = await wizard.handleNameInput(userId, 'TestProject');
      
      expect(nameResult.success).toBe(true);
      expect(nameResult.keyboard).toBeDefined();
      
      // Verify that the keyboard contains the correct callback prefix
      const keyboardJSON = JSON.stringify(nameResult.keyboard);
      expect(keyboardJSON).toContain('addproj_confirmdir');
      expect(keyboardJSON).not.toContain('"addproj_confirm:ok"'); // Should not be direct save callback
    });

    it('should use different callbacks for navigation confirm vs final confirm', async () => {
      // Step 1: Start and enter name
      await wizard.startWizard(userId);
      const navStep = await wizard.handleNameInput(userId, 'TestProject');
      
      // Navigation step should use addproj_confirmdir
      const navKeyboard = JSON.stringify(navStep.keyboard);
      expect(navKeyboard).toContain('addproj_confirmdir');
      
      // Step 2: Show confirmation
      const confirmStep = await wizard.handleShowConfirmation(userId);
      
      // Final confirmation step should use addproj_confirm
      const confirmKeyboard = JSON.stringify(confirmStep.keyboard);
      expect(confirmKeyboard).toContain('addproj_confirm:ok');
      expect(confirmKeyboard).not.toContain('addproj_confirmdir');
    });
  });
});
