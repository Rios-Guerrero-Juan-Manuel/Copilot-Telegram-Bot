import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

describe('Config Allowlist Update', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('setAllowedPaths updates in-memory allowlist', () => {
    it('should update allowlist immediately when setAllowedPaths is called', async () => {
      // Setup initial environment with one allowed path
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\initial\\path';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Initial state: only C:\initial\path is allowed
      expect(isPathAllowed('C:\\initial\\path')).toBe(true);
      expect(isPathAllowed('C:\\new\\path')).toBe(false);

      // Update allowed paths to a new path
      setAllowedPaths(['C:\\new\\path']);

      // BUG: This should now return true immediately
      // Without fix: isPathAllowed still uses old allowedPaths
      expect(isPathAllowed('C:\\new\\path')).toBe(true);
      expect(isPathAllowed('C:\\initial\\path')).toBe(false);
    });

    it('should clear allowlist when setAllowedPaths is called with empty array', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\allowed\\path';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Initial state: path is allowed
      expect(isPathAllowed('C:\\allowed\\path')).toBe(true);

      // Clear allowlist
      setAllowedPaths([]);

      // Should now deny all paths (empty allowlist = deny all)
      expect(isPathAllowed('C:\\allowed\\path')).toBe(false);
      expect(isPathAllowed('C:\\any\\path')).toBe(false);
    });

    it('should handle multiple sequential updates', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\path1';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Initial state
      expect(isPathAllowed('C:\\path1')).toBe(true);
      expect(isPathAllowed('C:\\path2')).toBe(false);
      expect(isPathAllowed('C:\\path3')).toBe(false);

      // Update 1: Change to path2
      setAllowedPaths(['C:\\path2']);
      expect(isPathAllowed('C:\\path1')).toBe(false);
      expect(isPathAllowed('C:\\path2')).toBe(true);
      expect(isPathAllowed('C:\\path3')).toBe(false);

      // Update 2: Change to path3
      setAllowedPaths(['C:\\path3']);
      expect(isPathAllowed('C:\\path1')).toBe(false);
      expect(isPathAllowed('C:\\path2')).toBe(false);
      expect(isPathAllowed('C:\\path3')).toBe(true);

      // Update 3: Multiple paths
      setAllowedPaths(['C:\\path1', 'C:\\path2']);
      expect(isPathAllowed('C:\\path1')).toBe(true);
      expect(isPathAllowed('C:\\path2')).toBe(true);
      expect(isPathAllowed('C:\\path3')).toBe(false);
    });

    it('should handle paths with subdirectories correctly after update', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\old';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Initial: C:\old\subdir is allowed
      expect(isPathAllowed('C:\\old\\subdir\\file.txt')).toBe(true);

      // Update to new path
      setAllowedPaths(['C:\\new']);

      // Old subdirectories should now be denied
      expect(isPathAllowed('C:\\old\\subdir\\file.txt')).toBe(false);
      
      // New subdirectories should be allowed
      expect(isPathAllowed('C:\\new\\subdir\\file.txt')).toBe(true);
    });

    it('should resolve paths before updating allowlist', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\initial';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Set relative paths - should be resolved to absolute
      const relativePath = path.join('..', 'test');
      setAllowedPaths([relativePath]);

      const absolutePath = path.resolve(relativePath);
      
      // Should work with both relative and absolute (both resolve to same)
      expect(isPathAllowed(absolutePath)).toBe(true);
    });
  });

  describe('getAllowedPaths returns current allowlist', () => {
    it('should return updated paths after setAllowedPaths', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\initial';
      process.env.DB_PATH = ':memory:';

      const { getAllowedPaths, setAllowedPaths } = await import('../src/config');

      // Check if getAllowedPaths exists and returns initial value
      if (getAllowedPaths) {
        const initial = getAllowedPaths();
        expect(initial).toContain('C:\\initial');

        // Update paths
        setAllowedPaths(['C:\\new1', 'C:\\new2']);

        // Should return updated paths
        const updated = getAllowedPaths();
        expect(updated).toContain('C:\\new1');
        expect(updated).toContain('C:\\new2');
        expect(updated).not.toContain('C:\\initial');
      }
    });
  });

  describe('backward compatibility', () => {
    it('should maintain export of allowedPaths array', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\test';
      process.env.DB_PATH = ':memory:';

      const config = await import('../src/config');

      // allowedPaths should still be exported (for backward compatibility)
      expect(config.allowedPaths).toBeDefined();
      expect(Array.isArray(config.allowedPaths)).toBe(true);
    });

    it('should maintain needsAllowlistSetup flag behavior', async () => {
      // Test with empty allowlist
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = '';
      process.env.DB_PATH = ':memory:';

      vi.resetModules();
      const configEmpty = await import('../src/config');
      expect(configEmpty.needsAllowlistSetup).toBe(true);

      // Test with configured allowlist
      vi.resetModules();
      process.env.ALLOWED_PATHS = 'C:\\configured';
      const configSet = await import('../src/config');
      expect(configSet.needsAllowlistSetup).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings in path array', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\test';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Set paths with empty strings (should be filtered out)
      setAllowedPaths(['C:\\valid', '', '  ', 'C:\\also-valid']);

      expect(isPathAllowed('C:\\valid')).toBe(true);
      expect(isPathAllowed('C:\\also-valid')).toBe(true);
    });

    it('should handle paths that need trimming', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '123';
      process.env.ALLOWED_PATHS = 'C:\\test';
      process.env.DB_PATH = ':memory:';

      const { isPathAllowed, setAllowedPaths } = await import('../src/config');

      // Set paths with whitespace
      setAllowedPaths(['  C:\\path1  ', 'C:\\path2\t']);

      // Should work after trimming
      expect(isPathAllowed('C:\\path1')).toBe(true);
      expect(isPathAllowed('C:\\path2')).toBe(true);
    });
  });
});
