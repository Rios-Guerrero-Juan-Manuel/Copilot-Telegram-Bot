import { describe, it, expect, beforeEach } from 'vitest';
import {
  Platform,
  PathUtils,
  EnvUtils,
  ShellUtils,
  FileUtils,
  ProcessUtils,
  CrossPlatform,
} from '../src/utils/cross-platform';

describe('Cross-Platform Utilities', () => {
  describe('Platform Detection', () => {
    it('should detect exactly one platform as current', () => {
      const platforms = [
        Platform.isWindows(),
        Platform.isMacOS(),
        Platform.isLinux(),
      ];
      
      // Exactly one should be true
      const trueCount = platforms.filter(Boolean).length;
      expect(trueCount).toBe(1);
    });

    it('should correctly identify Unix platforms', () => {
      const isUnix = Platform.isUnix();
      const isMacOrLinux = Platform.isMacOS() || Platform.isLinux();
      
      expect(isUnix).toBe(isMacOrLinux);
    });

    it('should return valid platform info', () => {
      const info = Platform.info();
      
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('release');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('eol');
      expect(info).toHaveProperty('pathSep');
      expect(info).toHaveProperty('delimiter');
    });

    it('should return current platform', () => {
      const current = Platform.current();
      expect(['win32', 'darwin', 'linux', 'freebsd']).toContain(current);
    });
  });

  describe('Path Utilities', () => {
    it('should normalize paths', () => {
      const testPath = 'src/utils/../utils/time.ts';
      const normalized = PathUtils.normalize(testPath);
      
      expect(normalized).not.toContain('..');
      expect(normalized).toContain('utils');
      expect(normalized).toContain('time.ts');
    });

    it('should join paths with correct separator', () => {
      const joined = PathUtils.join('src', 'utils', 'time.ts');
      
      expect(joined).toContain('src');
      expect(joined).toContain('utils');
      expect(joined).toContain('time.ts');
      
      // Should use platform separator
      const sep = PathUtils.separator();
      if (Platform.isWindows()) {
        expect(joined).toContain('\\');
      } else {
        expect(joined).toContain('/');
      }
    });

    it('should resolve absolute paths', () => {
      const resolved = PathUtils.resolve('src', 'utils');
      expect(PathUtils.isAbsolute(resolved)).toBe(true);
    });

    it('should convert between Unix and platform paths', () => {
      const unixPath = 'src/utils/time.ts';
      const platformPath = PathUtils.fromUnixPath(unixPath);
      const backToUnix = PathUtils.toUnixPath(platformPath);
      
      expect(backToUnix).toBe(unixPath);
    });

    it('should get correct path separator', () => {
      const sep = PathUtils.separator();
      
      if (Platform.isWindows()) {
        expect(sep).toBe('\\');
      } else {
        expect(sep).toBe('/');
      }
    });

    it('should detect absolute paths', () => {
      const absolutePath = PathUtils.resolve('.');
      const relativePath = 'src/utils/time.ts';
      
      expect(PathUtils.isAbsolute(absolutePath)).toBe(true);
      expect(PathUtils.isAbsolute(relativePath)).toBe(false);
    });
  });

  describe('Environment Utilities', () => {
    it('should get correct home variable name', () => {
      const homeVar = EnvUtils.getHomeVarName();
      
      if (Platform.isWindows()) {
        expect(homeVar).toBe('USERPROFILE');
      } else {
        expect(homeVar).toBe('HOME');
      }
    });

    it('should get home directory', () => {
      const homeDir = EnvUtils.getHomeDir();
      
      expect(typeof homeDir).toBe('string');
      expect(homeDir.length).toBeGreaterThan(0);
    });

    it('should get temp directory', () => {
      const tempDir = EnvUtils.getTempDir();
      
      expect(typeof tempDir).toBe('string');
      expect(tempDir.length).toBeGreaterThan(0);
    });

    it('should get correct line ending', () => {
      const eol = EnvUtils.getLineEnding();
      
      if (Platform.isWindows()) {
        expect(eol).toBe('\r\n');
      } else {
        expect(eol).toBe('\n');
      }
    });

    it('should get correct PATH variable name', () => {
      const pathVar = EnvUtils.getPathVarName();
      
      if (Platform.isWindows()) {
        expect(pathVar).toBe('Path');
      } else {
        expect(pathVar).toBe('PATH');
      }
    });
  });

  describe('Shell Utilities', () => {
    it('should get correct script extension', () => {
      const ext = ShellUtils.getScriptExtension();
      
      if (Platform.isWindows()) {
        expect(ext).toBe('.bat');
      } else {
        expect(ext).toBe('.sh');
      }
    });

    it('should get correct executable extension', () => {
      const ext = ShellUtils.getExecutableExtension();
      
      if (Platform.isWindows()) {
        expect(ext).toBe('.exe');
      } else {
        expect(ext).toBe('');
      }
    });

    it('should generate script name with extension', () => {
      const scriptName = ShellUtils.getScriptName('build');
      
      if (Platform.isWindows()) {
        expect(scriptName).toBe('build.bat');
      } else {
        expect(scriptName).toBe('build.sh');
      }
    });

    it('should get shell prefix', () => {
      const prefix = ShellUtils.getShellPrefix();
      
      expect(typeof prefix).toBe('string');
      expect(prefix.length).toBeGreaterThan(0);
    });

    it('should get default shell', () => {
      const shell = ShellUtils.getDefaultShell();
      
      expect(typeof shell).toBe('string');
      expect(shell.length).toBeGreaterThan(0);
    });
  });

  describe('File Utilities', () => {
    it('should detect hidden files', () => {
      const hiddenFile = '.gitignore';
      const normalFile = 'package.json';
      
      expect(FileUtils.isHidden(hiddenFile)).toBe(true);
      expect(FileUtils.isHidden(normalFile)).toBe(false);
    });

    it('should get config directory', () => {
      const configDir = FileUtils.getConfigDir();
      
      expect(typeof configDir).toBe('string');
      expect(configDir.length).toBeGreaterThan(0);
      expect(PathUtils.isAbsolute(configDir)).toBe(true);
    });

    it('should get data directory', () => {
      const dataDir = FileUtils.getDataDir();
      
      expect(typeof dataDir).toBe('string');
      expect(dataDir.length).toBeGreaterThan(0);
      expect(PathUtils.isAbsolute(dataDir)).toBe(true);
    });
  });

  describe('Process Utilities', () => {
    it('should get CPU count', () => {
      const cpuCount = ProcessUtils.getCPUCount();
      
      expect(cpuCount).toBeGreaterThan(0);
      expect(Number.isInteger(cpuCount)).toBe(true);
    });

    it('should get memory information', () => {
      const totalMem = ProcessUtils.getTotalMemory();
      const freeMem = ProcessUtils.getFreeMemory();
      
      expect(totalMem).toBeGreaterThan(0);
      expect(freeMem).toBeGreaterThan(0);
      expect(freeMem).toBeLessThanOrEqual(totalMem);
    });

    it('should get system uptime', () => {
      const uptime = ProcessUtils.getUptime();
      
      expect(uptime).toBeGreaterThan(0);
    });

    it('should get process priority', () => {
      const priority = ProcessUtils.getPriority();
      
      expect(typeof priority).toBe('number');
    });
  });

  describe('CrossPlatform Export', () => {
    it('should export all utilities', () => {
      expect(CrossPlatform).toHaveProperty('Platform');
      expect(CrossPlatform).toHaveProperty('PathUtils');
      expect(CrossPlatform).toHaveProperty('EnvUtils');
      expect(CrossPlatform).toHaveProperty('ShellUtils');
      expect(CrossPlatform).toHaveProperty('FileUtils');
      expect(CrossPlatform).toHaveProperty('ProcessUtils');
    });

    it('should have working utilities in exported object', () => {
      expect(typeof CrossPlatform.Platform.isWindows()).toBe('boolean');
      expect(typeof CrossPlatform.PathUtils.separator()).toBe('string');
      expect(typeof CrossPlatform.EnvUtils.getHomeDir()).toBe('string');
      expect(typeof CrossPlatform.ShellUtils.getScriptExtension()).toBe('string');
      expect(typeof CrossPlatform.FileUtils.getConfigDir()).toBe('string');
      expect(typeof CrossPlatform.ProcessUtils.getCPUCount()).toBe('number');
    });
  });

  describe('Platform-Specific Conditional Tests', () => {
    it('should run Windows-specific tests only on Windows', () => {
      if (!Platform.isWindows()) {
        // Skip on non-Windows
        expect(true).toBe(true);
        return;
      }

      // Windows-specific assertions
      expect(PathUtils.separator()).toBe('\\');
      expect(ShellUtils.getScriptExtension()).toBe('.bat');
      expect(ShellUtils.getExecutableExtension()).toBe('.exe');
      expect(EnvUtils.getLineEnding()).toBe('\r\n');
    });

    it('should run macOS-specific tests only on macOS', () => {
      if (!Platform.isMacOS()) {
        // Skip on non-macOS
        expect(true).toBe(true);
        return;
      }

      // macOS-specific assertions
      expect(PathUtils.separator()).toBe('/');
      expect(ShellUtils.getScriptExtension()).toBe('.sh');
      expect(ShellUtils.getExecutableExtension()).toBe('');
      expect(EnvUtils.getLineEnding()).toBe('\n');
      expect(Platform.current()).toBe('darwin');
    });

    it('should run Linux-specific tests only on Linux', () => {
      if (!Platform.isLinux()) {
        // Skip on non-Linux
        expect(true).toBe(true);
        return;
      }

      // Linux-specific assertions
      expect(PathUtils.separator()).toBe('/');
      expect(ShellUtils.getScriptExtension()).toBe('.sh');
      expect(ShellUtils.getExecutableExtension()).toBe('');
      expect(EnvUtils.getLineEnding()).toBe('\n');
      expect(Platform.current()).toBe('linux');
    });

    it('should run Unix-specific tests on Unix platforms', () => {
      if (!Platform.isUnix()) {
        // Skip on Windows
        expect(true).toBe(true);
        return;
      }

      // Unix (macOS or Linux) assertions
      expect(PathUtils.separator()).toBe('/');
      expect(ShellUtils.getScriptExtension()).toBe('.sh');
      expect(['darwin', 'linux', 'freebsd']).toContain(Platform.current());
    });
  });
});
