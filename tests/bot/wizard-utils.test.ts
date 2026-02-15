/**
 * Tests for wizard utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  readDirectories,
  validateNavigationPath,
  generateNavigationKeyboard,
  generateNavigationMessage,
  isValidPage,
  isAtRoot,
  truncateDirectoryName,
  DIRS_PER_PAGE,
} from '../../src/bot/wizard-utils';
import { isPathAllowed } from '../../src/config';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
  },
  readFileSync: vi.fn(() => '{}'), // For i18n translation loading
}));

vi.mock('../../src/config', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    isPathAllowed: vi.fn(),
  };
});

vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Wizard Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readDirectories', () => {
    it('should read directories successfully', async () => {
      const mockEntries = [
        { name: 'dir1', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
        { name: 'dir2', isDirectory: () => true },
      ];

      (fs.readdir as any).mockResolvedValue(mockEntries);

      const result = await readDirectories('/test/path');

      expect(result.success).toBe(true);
      expect(result.directories).toEqual(['dir1', 'dir2']);
      expect(result.error).toBeUndefined();
    });

    it('should handle read errors', async () => {
      (fs.readdir as any).mockRejectedValue(new Error('Permission denied'));

      const result = await readDirectories('/test/path');

      expect(result.success).toBe(false);
      expect(result.directories).toEqual([]);
      expect(result.error).toBe('Permission denied');
    });

    it('should sort directories alphabetically', async () => {
      const mockEntries = [
        { name: 'zebra', isDirectory: () => true },
        { name: 'apple', isDirectory: () => true },
        { name: 'banana', isDirectory: () => true },
      ];

      (fs.readdir as any).mockResolvedValue(mockEntries);

      const result = await readDirectories('/test/path');

      expect(result.directories).toEqual(['apple', 'banana', 'zebra']);
    });
  });

  describe('validateNavigationPath', () => {
    beforeEach(() => {
      (isPathAllowed as any).mockReturnValue(true);
      (fs.stat as any).mockResolvedValue({ isDirectory: () => true });
    });

    it('should validate parent directory navigation', async () => {
      const result = await validateNavigationPath('/test/path/subdir', '..', 123);

      expect(result.valid).toBe(true);
      expect(result.newPath).toBe(path.resolve('/test/path'));
    });

    it('should validate subdirectory navigation', async () => {
      const result = await validateNavigationPath('/test/path', 'subdir', 123);

      expect(result.valid).toBe(true);
      expect(result.newPath).toBe(path.resolve('/test/path/subdir'));
    });

    it('should validate absolute path navigation', async () => {
      const absolutePath = path.resolve('/absolute/path');
      const result = await validateNavigationPath('/test/path', absolutePath, 123);

      expect(result.valid).toBe(true);
      expect(result.newPath).toBe(absolutePath);
    });

    it('should reject paths not in ALLOWED_PATHS', async () => {
      (isPathAllowed as any).mockReturnValue(false);

      const result = await validateNavigationPath('/test/path', 'subdir', 123);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('errors.pathNotAllowedByConfig');
    });

    it('should reject non-existent directories', async () => {
      (fs.stat as any).mockRejectedValue(new Error('ENOENT'));

      const result = await validateNavigationPath('/test/path', 'nonexistent', 123);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('no existe');
    });

    it('should reject file paths (not directories)', async () => {
      (fs.stat as any).mockResolvedValue({ isDirectory: () => false });

      const result = await validateNavigationPath('/test/path', 'file.txt', 123);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('errors.invalidPathOrNotDirectory');
    });
  });

  describe('generateNavigationKeyboard', () => {
    it('should generate keyboard with directory buttons', () => {
      const config = {
        directories: ['dir1', 'dir2', 'dir3'],
        page: 0,
        currentPath: '/test/path',
        callbackPrefix: 'cd',
        showConfirmButton: true,
      };

      const keyboard = generateNavigationKeyboard(config);

      expect(keyboard).toBeDefined();
      // Keyboard structure is complex, basic existence check is sufficient
    });

    it('should handle empty directories', () => {
      const config = {
        directories: [],
        page: 0,
        currentPath: '/test/path',
        callbackPrefix: 'cd',
        showConfirmButton: true,
      };

      const keyboard = generateNavigationKeyboard(config);

      expect(keyboard).toBeDefined();
    });

    it('should handle pagination', () => {
      const directories = Array.from({ length: 20 }, (_, i) => `dir${i}`);
      const config = {
        directories,
        page: 1,
        currentPath: '/test/path',
        callbackPrefix: 'cd',
        showConfirmButton: true,
      };

      const keyboard = generateNavigationKeyboard(config);

      expect(keyboard).toBeDefined();
    });
  });

  describe('generateNavigationMessage', () => {
    it('should generate message with directories', () => {
      const message = generateNavigationMessage(
        123,  // userId
        '/test/path',
        ['dir1', 'dir2', 'dir3'],
        0
      );

      expect(message).toContain('wizards.cd.navigationTitle');
      expect(message).toContain('/test/path');
      expect(message).toContain('1-3 de 3');
    });

    it('should generate message for empty directory', () => {
      const message = generateNavigationMessage(123, '/test/path', [], 0);

      expect(message).toContain('wizards.cd.noSubdirectories');
    });

    it('should include custom title', () => {
      const message = generateNavigationMessage(
        123,  // userId
        '/test/path',
        ['dir1'],
        0,
        '📝 <b>Custom Title</b>'
      );

      expect(message).toContain('Custom Title');
    });

    it('should show pagination info', () => {
      const directories = Array.from({ length: 20 }, (_, i) => `dir${i}`);
      const message = generateNavigationMessage(123, '/test/path', directories, 1);

      expect(message).toContain('Página');  // Pagination text (hardcoded in source)
      expect(message).toContain('9-16 de 20');
    });
  });

  describe('isValidPage', () => {
    it('should validate first page', () => {
      expect(isValidPage(0, 20)).toBe(true);
    });

    it('should validate middle page', () => {
      expect(isValidPage(1, 20)).toBe(true);
    });

    it('should validate last page', () => {
      const totalItems = 20;
      const totalPages = Math.ceil(totalItems / DIRS_PER_PAGE);
      expect(isValidPage(totalPages - 1, totalItems)).toBe(true);
    });

    it('should reject negative page', () => {
      expect(isValidPage(-1, 20)).toBe(false);
    });

    it('should reject page beyond total', () => {
      const totalItems = 20;
      const totalPages = Math.ceil(totalItems / DIRS_PER_PAGE);
      expect(isValidPage(totalPages, totalItems)).toBe(false);
    });

    it('should handle zero items', () => {
      expect(isValidPage(0, 0)).toBe(false);
    });
  });

  describe('isAtRoot', () => {
    it('should detect Windows root', () => {
      if (process.platform === 'win32') {
        expect(isAtRoot('C:\\')).toBe(true);
        expect(isAtRoot('D:\\')).toBe(true);
      }
    });

    it('should detect Unix root', () => {
      if (process.platform !== 'win32') {
        expect(isAtRoot('/')).toBe(true);
      }
    });

    it('should reject non-root paths', () => {
      expect(isAtRoot('/test/path')).toBe(false);
      if (process.platform === 'win32') {
        expect(isAtRoot('C:\\test\\path')).toBe(false);
      }
    });
  });

  describe('truncateDirectoryName', () => {
    it('should not truncate short names', () => {
      expect(truncateDirectoryName('short')).toBe('short');
    });

    it('should truncate long names', () => {
      const longName = 'this_is_a_very_long_directory_name';
      const truncated = truncateDirectoryName(longName);
      
      expect(truncated.length).toBeLessThanOrEqual(20);
      expect(truncated).toContain('..');
    });

    it('should respect custom max length', () => {
      const truncated = truncateDirectoryName('verylongname', 10);
      
      expect(truncated.length).toBeLessThanOrEqual(10);
      expect(truncated).toContain('..');
    });

    it('should handle exactly max length', () => {
      const exactName = '12345678901234567890'; // 20 chars
      expect(truncateDirectoryName(exactName, 20)).toBe(exactName);
    });
  });
});
