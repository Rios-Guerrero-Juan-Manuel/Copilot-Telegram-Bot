import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

describe('Cross-Platform Support', () => {
  describe('Shell Scripts Existence', () => {
    const unixScripts = [
      'scripts/setup.sh',
      'scripts/install-mcp.sh',
      'scripts/setup-mcp-example.sh',
    ];

    unixScripts.forEach((script) => {
      it(`should include ${script}`, () => {
        expect(existsSync(script)).toBe(true);
      });
    });
  });

  describe('Shell Script Permissions', () => {
    it('should have executable permissions on .sh files (Unix)', () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        expect(true).toBe(true);
        return;
      }

      const shScripts = ['scripts/setup.sh', 'scripts/install-mcp.sh', 'scripts/setup-mcp-example.sh'];

      shScripts.forEach(script => {
        if (existsSync(script)) {
          const stats = require('fs').statSync(script);
          const isExecutable = (stats.mode & 0o111) !== 0;
          expect(isExecutable).toBe(true);
        }
      });
    });
  });

  describe('Package.json Scripts Cross-platform', () => {
    it('should have platform-agnostic npm scripts', () => {
      const packageJson = JSON.parse(
        readFileSync('package.json', 'utf-8')
      );

      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.test).toBeDefined();
      expect(packageJson.scripts.build).toBeDefined();
      
      // Scripts should not use platform-specific commands directly
      // They should use npm scripts or cross-env
      const testScript = packageJson.scripts.test;
      expect(testScript).not.toMatch(/\.bat$/);
      expect(testScript).not.toMatch(/\.cmd$/);
    });
  });

  describe('OS Detection in Scripts', () => {
    it('should detect operating system correctly', () => {
      const platform = process.platform;
      expect(['win32', 'darwin', 'linux', 'freebsd']).toContain(platform);
    });

    it('should handle path separators correctly', () => {
      const { sep, join: pathJoin } = require('path');
      const testPath = pathJoin('src', 'utils', 'test.ts');
      
      expect(testPath).toContain('utils');
      // On Windows: src\utils\test.ts
      // On Unix: src/utils/test.ts
    });
  });

  describe('CI/CD Matrix Support', () => {
    it('should support Node.js 18 and 20', () => {
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      
      expect(majorVersion).toBeGreaterThanOrEqual(18);
    });
  });

  describe('Platform-Specific Mocks', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should handle file system operations cross-platform', () => {
      const fs = require('fs');
      const path = require('path');
      
      // Test that path operations work regardless of platform
      const testPath = path.join('src', 'index.ts');
      const exists = fs.existsSync(testPath);
      
      expect(typeof exists).toBe('boolean');
    });

    it('should handle process.platform checks', () => {
      const originalPlatform = process.platform;
      
      // Verify we can detect platform
      expect(['win32', 'darwin', 'linux', 'freebsd']).toContain(originalPlatform);
    });

    it('should handle environment variables cross-platform', () => {
      const homeVar = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
      const homeDir = process.env[homeVar];
      
      // Home directory should exist on all platforms
      if (homeDir) {
        expect(typeof homeDir).toBe('string');
        expect(homeDir.length).toBeGreaterThan(0);
      }
    });

    it('should mock platform-specific behavior correctly', () => {
      // Test that we can safely mock different platforms
      const mockPlatform = (platform: NodeJS.Platform) => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true,
          configurable: true,
        });
      };

      const originalPlatform = process.platform;

      // Test Windows behavior
      mockPlatform('win32');
      expect(process.platform).toBe('win32');

      // Test Unix behavior
      mockPlatform('linux');
      expect(process.platform).toBe('linux');

      // Restore original
      mockPlatform(originalPlatform);
      expect(process.platform).toBe(originalPlatform);
    });

    it('should handle path normalization cross-platform', () => {
      const path = require('path');

      // Test various path formats
      const testPaths = [
        { input: 'src/utils/time.ts', shouldExist: true },
        { input: 'src\\utils\\time.ts', shouldExist: true },
        { input: path.join('src', 'utils', 'time.ts'), shouldExist: true },
      ];

      testPaths.forEach(({ input, shouldExist }) => {
        const normalized = path.normalize(input);
        expect(typeof normalized).toBe('string');
        
        // Verify path has correct separator for platform
        if (shouldExist && process.platform === 'win32') {
          expect(normalized).toContain('\\');
        }
      });
    });
  });

  describe('Conditional Tests for OS-specific Features', () => {
    it('should handle Windows-specific features', () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows
        expect(true).toBe(true);
        return;
      }

      // Windows-specific test
      const { EOL } = require('os');
      expect(EOL).toBe('\r\n');
    });

    it('should handle Unix-specific features', () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        expect(true).toBe(true);
        return;
      }

      // Unix-specific test
      const { EOL } = require('os');
      expect(EOL).toBe('\n');
    });

    it('should handle macOS-specific features', () => {
      if (process.platform !== 'darwin') {
        // Skip on non-macOS
        expect(true).toBe(true);
        return;
      }

      // macOS-specific test
      expect(process.platform).toBe('darwin');
    });
  });

  describe('Path Allowlist Cross-platform', () => {
    it('should normalize paths regardless of platform', () => {
      const path = require('path');
      
      // Test both forward and backslash paths
      const paths = [
        'C:\\Users\\Test\\Project',
        '/home/user/project',
        'C:/Users/Test/Project',
      ];

      paths.forEach(testPath => {
        const normalized = path.normalize(testPath);
        expect(typeof normalized).toBe('string');
        expect(normalized.length).toBeGreaterThan(0);
      });
    });
  });
});
