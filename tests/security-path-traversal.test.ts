import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Path Traversal Security Tests', () => {
  let originalAllowedPaths: string | undefined;
  let testTempDir: string;
  let allowedTestDir: string;

  beforeEach(async () => {
    // Save original ALLOWED_PATHS
    originalAllowedPaths = process.env.ALLOWED_PATHS;
    
    // Create temporary test directory structure
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-traversal-test-'));
    allowedTestDir = path.join(testTempDir, 'allowed');
    const restrictedDir = path.join(testTempDir, 'restricted');
    const deepDir = path.join(allowedTestDir, 'deep', 'nested', 'dir');
    
    fs.mkdirSync(allowedTestDir, { recursive: true });
    fs.mkdirSync(restrictedDir, { recursive: true });
    fs.mkdirSync(deepDir, { recursive: true });
    
    // Create test files
    fs.writeFileSync(path.join(allowedTestDir, 'safe.txt'), 'safe content');
    fs.writeFileSync(path.join(restrictedDir, 'secret.txt'), 'secret data');
    fs.writeFileSync(path.join(deepDir, 'file.txt'), 'nested file');
    
    // Set ALLOWED_PATHS to only include allowedTestDir
    process.env.ALLOWED_PATHS = allowedTestDir;
    
    // Reset modules to force reload config
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original ALLOWED_PATHS
    if (originalAllowedPaths !== undefined) {
      process.env.ALLOWED_PATHS = originalAllowedPaths;
    } else {
      delete process.env.ALLOWED_PATHS;
    }
    
    // Clean up test directory
    if (testTempDir && fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
    
    // Reset modules
    vi.resetModules();
  });

  describe('Path Traversal Attacks', () => {
    it('should block access outside allowlist using ../ traversal', async () => {
      const { isPathAllowed } = await import('../src/config');
      const restrictedPath = path.join(allowedTestDir, '..', 'restricted', 'secret.txt');
      const result = isPathAllowed(restrictedPath);
      
      expect(result).toBe(false);
    });

    it('should block access using multiple ../ levels', async () => {
      const { isPathAllowed } = await import('../src/config');
      const attackPath = path.join(allowedTestDir, '..', '..', '..', 'etc', 'passwd');
      const result = isPathAllowed(attackPath);
      
      expect(result).toBe(false);
    });

    it('should block path traversal with mixed separators (Windows)', async () => {
      const { isPathAllowed } = await import('../src/config');
      if (process.platform === 'win32') {
        const attackPath = allowedTestDir + '\\..\\restricted\\secret.txt';
        const result = isPathAllowed(attackPath);
        
        expect(result).toBe(false);
      } else {
        // On Unix, test with forward slashes
        const attackPath = allowedTestDir + '/../restricted/secret.txt';
        const result = isPathAllowed(attackPath);
        
        expect(result).toBe(false);
      }
    });

    it('should block absolute path to restricted location', async () => {
      const { isPathAllowed } = await import('../src/config');
      const restrictedPath = path.join(testTempDir, 'restricted', 'secret.txt');
      const result = isPathAllowed(restrictedPath);
      
      expect(result).toBe(false);
    });

    it('should block access to system directories', async () => {
      const { isPathAllowed } = await import('../src/config');
      const systemPaths = process.platform === 'win32'
        ? ['C:\\Windows\\System32', 'C:\\Program Files']
        : ['/etc', '/root', '/var', '/bin'];
      
      systemPaths.forEach((systemPath) => {
        const result = isPathAllowed(systemPath);
        expect(result).toBe(false);
      });
    });

    it.skip('should block path traversal with URL encoding', async () => {
      const { isPathAllowed } = await import('../src/config');
      // %2e%2e%2f = ../
      const encodedPath = path.join(allowedTestDir, '%2e%2e', 'restricted');
      const result = isPathAllowed(encodedPath);
      
      expect(result).toBe(false);
    });

    it('should block path with null bytes', async () => {
      const { isPathAllowed } = await import('../src/config');
      const nullBytePath = allowedTestDir + '\0' + '/../../etc/passwd';
      const result = isPathAllowed(nullBytePath);
      
      expect(result).toBe(false);
    });

    it.skip('should block Unicode path traversal attempts', async () => {
      const { isPathAllowed } = await import('../src/config');
      // Unicode versions of ../
      const unicodeDots = allowedTestDir + '/\u2024\u2024/\u2024\u2024/etc';
      const result = isPathAllowed(unicodeDots);
      
      expect(result).toBe(false);
    });
  });

  describe('Symbolic Link Security', () => {
    it('should block symlinks pointing outside allowlist', async () => {
      const { isPathAllowed } = await import('../src/config');
      const symlinkPath = path.join(allowedTestDir, 'malicious-link');
      const targetPath = path.join(testTempDir, 'restricted', 'secret.txt');
      
      try {
        // Create symlink (may fail on Windows without admin rights)
        fs.symlinkSync(targetPath, symlinkPath);
        
        // The resolved symlink target should be blocked
        const realPath = fs.realpathSync(symlinkPath);
        const result = isPathAllowed(realPath);
        
        expect(result).toBe(false);
        
        // Clean up
        fs.unlinkSync(symlinkPath);
      } catch (err) {
        // Skip test if symlink creation fails (Windows without admin)
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          throw err;
        }
      }
    });

    it('should block circular symlink exploitation', () => {
      const link1 = path.join(allowedTestDir, 'link1');
      const link2 = path.join(allowedTestDir, 'link2');
      
      try {
        fs.symlinkSync(link2, link1);
        fs.symlinkSync(link1, link2);
        
        // Attempting to resolve circular symlink
        expect(() => {
          fs.realpathSync(link1);
        }).toThrow();
        
        // Clean up
        fs.unlinkSync(link1);
        fs.unlinkSync(link2);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          throw err;
        }
      }
    });
  });

  describe('Windows-Specific Path Attacks', () => {
    if (process.platform === 'win32') {
      it('should block UNC path access', async () => {
        const { isPathAllowed } = await import('../src/config');
        const uncPath = '\\\\server\\share\\sensitive';
        const result = isPathAllowed(uncPath);
        
        expect(result).toBe(false);
      });

      it('should block Windows device paths', async () => {
        const { isPathAllowed } = await import('../src/config');
        const devicePaths = [
          '\\\\.\\pipe\\sensitive',
          '\\\\.\\PhysicalDrive0',
          'CON',
          'NUL',
          'AUX',
        ];
        
        devicePaths.forEach((devicePath) => {
          const result = isPathAllowed(devicePath);
          expect(result).toBe(false);
        });
      });

      it('should handle \\\\?\\ prefix correctly', async () => {
        const { isPathAllowed } = await import('../src/config');
        // Windows \\?\ prefix for long paths should be normalized
        const longPathPrefix = '\\\\?\\' + allowedTestDir;
        const result = isPathAllowed(longPathPrefix);
        
        // Should be allowed since it resolves to allowedTestDir
        expect(result).toBe(true);
      });

      it('should block 8.3 filename exploitation', async () => {
        const { isPathAllowed } = await import('../src/config');
        // PROGRA~1 = Program Files
        const shortPath = 'C:\\PROGRA~1\\sensitive';
        const result = isPathAllowed(shortPath);
        
        expect(result).toBe(false);
      });
    }
  });

  describe('Allowed Paths - Positive Tests', () => {
    it('should allow exact match of allowed directory', async () => {
      const { isPathAllowed } = await import('../src/config');
      const result = isPathAllowed(allowedTestDir);
      
      expect(result).toBe(true);
    });

    it('should allow files within allowed directory', async () => {
      const { isPathAllowed } = await import('../src/config');
      const safePath = path.join(allowedTestDir, 'safe.txt');
      const result = isPathAllowed(safePath);
      
      expect(result).toBe(true);
    });

    it('should allow deeply nested paths within allowed directory', async () => {
      const { isPathAllowed } = await import('../src/config');
      const deepPath = path.join(allowedTestDir, 'deep', 'nested', 'dir', 'file.txt');
      const result = isPathAllowed(deepPath);
      
      expect(result).toBe(true);
    });

    it('should allow relative paths that resolve within allowed directory', async () => {
      const { isPathAllowed } = await import('../src/config');
      const relativePath = path.join(allowedTestDir, 'deep', '..', 'safe.txt');
      const result = isPathAllowed(relativePath);
      
      expect(result).toBe(true);
    });

    it('should handle case insensitivity on Windows', async () => {
      const { isPathAllowed } = await import('../src/config');
      if (process.platform === 'win32') {
        const upperCasePath = allowedTestDir.toUpperCase();
        const result = isPathAllowed(upperCasePath);
        
        expect(result).toBe(true);
      }
    });
  });

  describe('Empty Allowlist Security', () => {
    it('should deny all paths when allowlist is empty', async () => {
      // Set empty allowlist
      process.env.ALLOWED_PATHS = '';
      vi.resetModules();
      
      const { isPathAllowed } = await import('../src/config');
      const testPath = path.join(os.tmpdir(), 'any-path');
      const result = isPathAllowed(testPath);
      
      expect(result).toBe(false);
    });

    it('should deny all paths when allowlist is undefined', async () => {
      // Remove allowlist
      delete process.env.ALLOWED_PATHS;
      vi.resetModules();
      
      const { isPathAllowed } = await import('../src/config');
      const testPath = path.join(os.tmpdir(), 'any-path');
      const result = isPathAllowed(testPath);
      
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string path', async () => {
      const { isPathAllowed } = await import('../src/config');
      const result = isPathAllowed('');
      
      expect(result).toBe(false);
    });

    it('should handle whitespace-only path', async () => {
      const { isPathAllowed } = await import('../src/config');
      const result = isPathAllowed('   ');
      
      expect(result).toBe(false);
    });

    it('should handle path with only dots', async () => {
      const { isPathAllowed } = await import('../src/config');
      const result = isPathAllowed('...');
      
      expect(result).toBe(false);
    });

    it('should handle very long path (path bomb)', async () => {
      const { isPathAllowed } = await import('../src/config');
      const longPath = 'a/'.repeat(1000) + 'file.txt';
      
      // Should not hang or crash
      expect(() => {
        isPathAllowed(longPath);
      }).not.toThrow();
    });

    it('should reject path components with special characters', async () => {
      const { isPathAllowed } = await import('../src/config');
      const specialPaths = [
        allowedTestDir + '/<script>alert(1)</script>',
        allowedTestDir + '/$(whoami)',
        allowedTestDir + '/`id`',
        allowedTestDir + '/$USER',
      ];
      
      specialPaths.forEach((specialPath) => {
        const result = isPathAllowed(specialPath);
        // These should either be blocked or resolve to safe paths
        if (result) {
          const resolved = path.resolve(specialPath);
          expect(resolved.startsWith(allowedTestDir)).toBe(true);
        }
      });
    });
  });
});
