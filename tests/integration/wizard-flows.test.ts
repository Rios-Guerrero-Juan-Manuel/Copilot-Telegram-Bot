/**
 * End-to-End Integration Tests for Wizard Flows - SIMPLIFIED VERSION
 * 
 * Tests complete wizard flows for /cd and /addproject commands.
 * Focus on core scenarios that must work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { UserState } from '../../src/state/user-state';
import { CdWizard } from '../../src/bot/wizard-cd';
import { AddProjectWizard } from '../../src/bot/wizard-addproject';
import { WIZARD_TIMEOUT_MS } from '../../src/constants';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  initLogger: vi.fn(async () => {}),
  flushLogger: vi.fn(async () => {}),
}));

// Mock config module
vi.mock('../../src/config', async () => {
  const actual = await vi.importActual('../../src/config');
  return {
    ...actual,
    isPathAllowed: vi.fn((testPath: string) => {
      // Allow any test path variations
      const normalizedPath = testPath.replace(/\\/g, '/').toLowerCase();
      return normalizedPath.includes('/test') || 
             normalizedPath.includes('test') ||
             normalizedPath.includes('project');
    }),
  };
});

// Mock filesystem
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      readdir: vi.fn(async (dirPath: string, options?: any) => {
        const entries = [];
        if (dirPath.includes('/test') || dirPath.includes('C:\\test')) {
          entries.push(
            { name: 'project1', isDirectory: () => true },
            { name: 'project2', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false }
          );
        } else if (dirPath.includes('project1')) {
          entries.push({ name: 'src', isDirectory: () => true });
        }
        return options?.withFileTypes ? entries : entries.map(e => e.name);
      }),
      stat: vi.fn(async (p: string) => ({
        isDirectory: () => !p.includes('.txt'),
        isFile: () => p.includes('.txt'),
      })),
      access: vi.fn(async () => {}),
    },
    readFileSync: vi.fn(() => '{}'), // For i18n translation loading
  };
});

describe('Wizard Flows E2E - Core Scenarios', () => {
  let userState: UserState;
  let cdWizard: CdWizard;
  let addProjectWizard: AddProjectWizard;
  let testUserId: number;
  let testTelegramId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    
    testUserId = 123456;
    testTelegramId = String(testUserId);
    
    const testConfig = {
      DB_PATH: ':memory:',
      DEFAULT_PROJECT_PATH: '/test',
      COPILOT_DEFAULT_MODEL: 'claude-sonnet-4',
      ALLOWED_PATHS: ['/test'],
    };
    
    userState = new UserState(testConfig as any);
    userState.getOrCreate(testTelegramId, 'testuser');
    
    cdWizard = new CdWizard(userState);
    addProjectWizard = new AddProjectWizard(userState);
  });

  afterEach(async () => {
    cdWizard.clearAll();
    addProjectWizard.clearAll();
    // UserState doesn't have close method for in-memory DB
  });

  describe('Scenario 1: CD Wizard Flow', () => {
    it('should start, navigate, and confirm', async () => {
      // Start
      const start = await cdWizard.startWizard(testUserId, '/test');
      expect(start.success).toBe(true);
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(true);

      // Navigate
      const nav = await cdWizard.handleNavigation(testUserId, 'project1');
      if (!nav.success) {
        console.log('Navigation failed:', nav.message);
      }
      expect(nav.success).toBe(true);

      // Confirm
      const confirm = await cdWizard.handleConfirm(testUserId);
      expect(confirm.success).toBe(true);
      expect(confirm.confirmed).toBe(true);
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(false);
    });

    it('should cancel wizard', async () => {
      await cdWizard.startWizard(testUserId, '/test');
      
      const cancel = await cdWizard.handleCancel(testUserId);
      expect(cancel.success).toBe(true);
      expect(cancel.cancelled).toBe(true);
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(false);
    });

    it('should prevent duplicate active wizards', async () => {
      const first = await cdWizard.startWizard(testUserId, '/test');
      expect(first.success).toBe(true);
      
      const second = await cdWizard.startWizard(testUserId, '/test/project1');
      expect(second.success).toBe(false);
      expect(second.message).toMatch(/curso|activo|already.?active|already.?in.?progress|alreadyActive/i);
    });
  });

  describe('Scenario 2: AddProject Wizard Flow', () => {
    it('should complete project addition flow', async () => {
      // Start
      const start = await addProjectWizard.startWizard(testUserId);
      expect(start.success).toBe(true);
      expect(addProjectWizard.hasActiveWizard(testUserId)).toBe(true);

      // Provide name
      const name = await addProjectWizard.handleNameInput(testUserId, 'TestProject');
      expect(name.success).toBe(true);

      // Navigate (optional)
      await addProjectWizard.handleNavigation(testUserId, 'project1');

      // Show confirmation
      const showConfirm = await addProjectWizard.handleShowConfirmation(testUserId);
      expect(showConfirm.success).toBe(true);

      // Confirm and save
      const confirm = await addProjectWizard.handleConfirm(testUserId);
      expect(confirm.success).toBe(true);
      expect(confirm.confirmed).toBe(true);
      
      // Verify project saved
      const user = userState.getOrCreate(testTelegramId, 'testuser');
      const projects = userState.listProjects(user.id);
      expect(projects.some(p => p.name === 'TestProject')).toBe(true);
      
      expect(addProjectWizard.hasActiveWizard(testUserId)).toBe(false);
    });

    it('should validate project name', async () => {
      await addProjectWizard.startWizard(testUserId);
      
      // Empty name
      const empty = await addProjectWizard.handleNameInput(testUserId, '');
      expect(empty.success).toBe(false);
      
      // Valid name
      const valid = await addProjectWizard.handleNameInput(testUserId, 'ValidProject');
      expect(valid.success).toBe(true);
    });

    it('should cancel wizard', async () => {
      await addProjectWizard.startWizard(testUserId);
      await addProjectWizard.handleNameInput(testUserId, 'TestCancel');
      
      const cancel = await addProjectWizard.handleCancel(testUserId);
      expect(cancel.success).toBe(true);
      expect(cancel.cancelled).toBe(true);
      
      // Project should not be saved
      const user = userState.getOrCreate(testTelegramId, 'testuser');
      const projects = userState.listProjects(user.id);
      expect(projects.some(p => p.name === 'TestCancel')).toBe(false);
    });
  });

  describe('Scenario 3: Sequential Wizard Usage', () => {
    it('should allow using cd wizard then addproject wizard', async () => {
      // Use cd wizard
      await cdWizard.startWizard(testUserId, '/test');
      await cdWizard.handleConfirm(testUserId);
      
      // Then use addproject wizard
      await addProjectWizard.startWizard(testUserId);
      const name = await addProjectWizard.handleNameInput(testUserId, 'SequentialProject');
      expect(name.success).toBe(true);
    });
  });

  describe('Scenario 4: Activity Tracking', () => {
    it('should track wizard activity', async () => {
      await cdWizard.startWizard(testUserId, '/test');
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(true);
      
      // Interact
      await cdWizard.handleNavigation(testUserId, 'project1');
      
      // Wizard should still be active
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(true);
    });
  });

  describe('Scenario 5: Traditional Mode Coexistence', () => {
    it('should support traditional cd without wizard', () => {
      // Direct manipulation without wizard
      const user = userState.getOrCreate(testTelegramId, 'testuser');
      userState.setCurrentCwd(user.id, '/test/project1');
      
      const cwd = userState.getCurrentCwd(user.id);
      expect(cwd).toBe('/test/project1');
      
      // No wizard active
      expect(cdWizard.hasActiveWizard(testUserId)).toBe(false);
    });

    it('should support traditional addproject without wizard', () => {
      const user = userState.getOrCreate(testTelegramId, 'testuser');
      userState.addProject(user.id, 'TraditionalProject', '/test/project1');
      
      const projects = userState.listProjects(user.id);
      expect(projects.some(p => p.name === 'TraditionalProject')).toBe(true);
      
      // No wizard active
      expect(addProjectWizard.hasActiveWizard(testUserId)).toBe(false);
    });
  });
});
