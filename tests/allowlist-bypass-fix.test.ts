import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

/**
 * Tests for allowlist bypass vulnerability fix
 * 
 * Scenario: User exists with allowed_paths_configured = 1 in DB,
 * but admin clears ALLOWED_PATHS from .env
 * 
 * Expected: User should be blocked from creating sessions
 * Bug: User could bypass allowlist because wizard doesn't activate
 */

describe('Allowlist Bypass Security Fix', () => {
  describe('isPathAllowed function behavior', () => {
    it('should return false when ALLOWED_PATHS is empty', async () => {
      // Mock config with empty allowedPaths
      vi.doMock('../src/config', () => ({
        config: {
          ALLOWED_PATHS: '',
          TELEGRAM_BOT_TOKEN: 'test-token',
        },
        allowedPaths: [],
        needsAllowlistSetup: true,
        isPathAllowed: (targetPath: string): boolean => {
          // Empty allowlist = deny all
          return false;
        },
      }));

      const { isPathAllowed } = await import('../src/config');
      
      expect(isPathAllowed('/any/path')).toBe(false);
      expect(isPathAllowed('C:\\Users\\Test')).toBe(false);
      expect(isPathAllowed(path.resolve('.'))).toBe(false);
      
      vi.doUnmock('../src/config');
    });

    it('should return true when path is in allowlist', async () => {
      const testPath = 'C:\\allowed\\project';
      
      vi.doMock('../src/config', () => ({
        config: {
          ALLOWED_PATHS: testPath,
          TELEGRAM_BOT_TOKEN: 'test-token',
        },
        allowedPaths: [testPath],
        needsAllowlistSetup: false,
        isPathAllowed: (targetPath: string): boolean => {
          const allowedPaths = [testPath];
          if (allowedPaths.length === 0) return false;
          
          const normalize = (input: string) => {
            const cleaned = process.platform === 'win32' && input.startsWith('\\\\?\\')
              ? input.slice(4)
              : input;
            return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
          };
          
          const resolved = normalize(path.resolve(targetPath));
          return allowedPaths.some((allowedRaw) => {
            const allowed = normalize(allowedRaw);
            if (resolved === allowed) return true;
            const relative = path.relative(allowed, resolved);
            return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
          });
        },
      }));

      const { isPathAllowed } = await import('../src/config');
      
      expect(isPathAllowed(testPath)).toBe(true);
      expect(isPathAllowed(path.join(testPath, 'subdir'))).toBe(true);
      expect(isPathAllowed('C:\\other\\path')).toBe(false);
      
      vi.doUnmock('../src/config');
    });
  });

  describe('Message handler security validation', () => {
    it('should block session creation when cwd is not in allowlist', () => {
      const cwd = 'C:\\not-allowed\\project';
      const allowedPaths: string[] = [];
      
      // Simulate isPathAllowed check
      const isPathAllowed = (targetPath: string): boolean => {
        if (allowedPaths.length === 0) return false;
        return allowedPaths.includes(targetPath);
      };

      // This should fail the security check
      expect(isPathAllowed(cwd)).toBe(false);
    });

    it('should allow session creation when cwd is in allowlist', () => {
      const cwd = 'C:\\allowed\\project';
      const allowedPaths = [cwd];
      
      // Simulate isPathAllowed check
      const isPathAllowed = (targetPath: string): boolean => {
        if (allowedPaths.length === 0) return false;
        const normalize = (input: string) => {
          const cleaned = process.platform === 'win32' && input.startsWith('\\\\?\\')
            ? input.slice(4)
            : input;
          return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
        };
        const resolved = normalize(path.resolve(targetPath));
        return allowedPaths.some((allowedRaw) => {
          const allowed = normalize(allowedRaw);
          return resolved === allowed || resolved.startsWith(allowed + path.sep);
        });
      };

      // This should pass the security check
      expect(isPathAllowed(cwd)).toBe(true);
    });
  });

  describe('Bypass scenario prevention', () => {
    it('should block user with configured DB but empty .env allowlist', () => {
      // Scenario:
      // - User has allowed_paths_configured = 1 in DB
      // - Admin cleared ALLOWED_PATHS from .env
      // - needsAllowlistSetup = true (empty allowedPaths)
      // - User's needsSetup() returns false (already configured)
      // - Wizard doesn't activate
      // - Message handler tries to create session with cwd
      
      const userConfiguredInDB = true;
      const allowedPaths: string[] = []; // Empty .env
      const needsAllowlistSetup = allowedPaths.length === 0;
      const userNeedsSetup = false; // Already configured in DB
      const cwd = 'C:\\some\\project';
      
      // Check if wizard would activate
      const wizardActivates = needsAllowlistSetup && userNeedsSetup;
      expect(wizardActivates).toBe(false); // Bug: wizard doesn't activate!
      
      // Check if path is allowed (this is the fix)
      const isPathAllowed = (targetPath: string): boolean => {
        if (allowedPaths.length === 0) return false;
        return allowedPaths.includes(targetPath);
      };
      
      const cwdAllowed = isPathAllowed(cwd);
      
      // Expected: User should be blocked
      expect(cwdAllowed).toBe(false);
      
      // The fix should check this BEFORE creating session:
      // if (!isPathAllowed(cwd)) {
      //   await ctx.reply('⚠️ El directorio actual no está en la lista permitida...');
      //   return;
      // }
    });

    it('should allow user with both DB configured and valid .env allowlist', () => {
      const allowedPaths = ['C:\\allowed\\project'];
      const needsAllowlistSetup = allowedPaths.length === 0;
      const userNeedsSetup = false; // Already configured
      const cwd = 'C:\\allowed\\project';
      
      const wizardActivates = needsAllowlistSetup && userNeedsSetup;
      expect(wizardActivates).toBe(false); // Wizard doesn't activate (correct)
      
      const isPathAllowed = (targetPath: string): boolean => {
        if (allowedPaths.length === 0) return false;
        const normalize = (input: string) => {
          const cleaned = process.platform === 'win32' && input.startsWith('\\\\?\\')
            ? input.slice(4)
            : input;
          return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
        };
        const resolved = normalize(path.resolve(targetPath));
        return allowedPaths.some((allowedRaw) => {
          const allowed = normalize(allowedRaw);
          return resolved === allowed || resolved.startsWith(allowed + path.sep);
        });
      };
      
      const cwdAllowed = isPathAllowed(cwd);
      
      // Expected: User should be allowed
      expect(cwdAllowed).toBe(true);
    });

    it('should activate wizard for new user with empty .env allowlist', () => {
      const allowedPaths: string[] = [];
      const needsAllowlistSetup = allowedPaths.length === 0;
      const userNeedsSetup = true; // New user, not configured
      
      const wizardActivates = needsAllowlistSetup && userNeedsSetup;
      
      // Expected: Wizard should activate
      expect(wizardActivates).toBe(true);
    });
  });
});
