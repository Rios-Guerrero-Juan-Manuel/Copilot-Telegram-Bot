/**
 * Cross-Platform Utilities
 * 
 * Provides platform-agnostic utilities for file operations, path handling,
 * and environment detection across Windows, Linux, and macOS.
 */

import os from 'os';
import path from 'path';

/**
 * Platform detection utilities
 */
export const Platform = {
  /**
   * Check if running on Windows.
   * 
   * @returns true if the current platform is Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32';
  },

  /**
   * Check if running on macOS.
   * 
   * @returns true if the current platform is macOS
   */
  isMacOS(): boolean {
    return process.platform === 'darwin';
  },

  /**
   * Check if running on Linux.
   * 
   * @returns true if the current platform is Linux
   */
  isLinux(): boolean {
    return process.platform === 'linux';
  },

  /**
   * Check if running on any Unix-like system (macOS or Linux).
   * 
   * @returns true if the current platform is macOS or Linux
   */
  isUnix(): boolean {
    return this.isMacOS() || this.isLinux();
  },

  /**
   * Get current platform name.
   * 
   * @returns Current platform identifier
   */
  current(): NodeJS.Platform {
    return process.platform;
  },

  /**
   * Get comprehensive platform information.
   * 
   * @returns Object containing platform type, release, architecture, EOL, path separator, and delimiter
   */
  info() {
    return {
      platform: process.platform,
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      eol: os.EOL,
      pathSep: path.sep,
      delimiter: path.delimiter,
    };
  },
};

/**
 * Path utilities
 */
export const PathUtils = {
  /**
   * Normalize path for current platform.
   * 
   * @param filepath - Path to normalize
   * @returns Normalized path
   */
  normalize(filepath: string): string {
    return path.normalize(filepath);
  },

  /**
   * Join paths using platform-appropriate separator.
   * 
   * @param paths - Path segments to join
   * @returns Joined path
   */
  join(...paths: string[]): string {
    return path.join(...paths);
  },

  /**
   * Resolve absolute path.
   * 
   * @param paths - Path segments to resolve
   * @returns Absolute path
   */
  resolve(...paths: string[]): string {
    return path.resolve(...paths);
  },

  /**
   * Get platform-specific path separator.
   * 
   * @returns Path separator ('/' on Unix, '\\' on Windows)
   */
  separator(): string {
    return path.sep;
  },

  /**
   * Convert Windows path to Unix path (for cross-platform compatibility).
   * 
   * @param filepath - Path to convert
   * @returns Unix-style path with forward slashes
   */
  toUnixPath(filepath: string): string {
    return filepath.split(path.sep).join('/');
  },

  /**
   * Convert Unix path to platform-specific path.
   * 
   * @param filepath - Unix-style path to convert
   * @returns Platform-specific path
   */
  fromUnixPath(filepath: string): string {
    return filepath.split('/').join(path.sep);
  },

  /**
   * Check if path is absolute.
   * 
   * @param filepath - Path to check
   * @returns true if the path is absolute
   */
  isAbsolute(filepath: string): boolean {
    return path.isAbsolute(filepath);
  },
};

/**
 * Environment variable utilities
 */
export const EnvUtils = {
  /**
   * Get home directory environment variable name.
   * 
   * @returns 'USERPROFILE' on Windows, 'HOME' on Unix
   */
  getHomeVarName(): string {
    return Platform.isWindows() ? 'USERPROFILE' : 'HOME';
  },

  /**
   * Get home directory path.
   * 
   * @returns Absolute path to user's home directory
   */
  getHomeDir(): string {
    return os.homedir();
  },

  /**
   * Get temp directory path.
   * 
   * @returns Absolute path to system temp directory
   */
  getTempDir(): string {
    return os.tmpdir();
  },

  /**
   * Get platform-specific line ending.
   * 
   * @returns '\r\n' on Windows, '\n' on Unix
   */
  getLineEnding(): string {
    return os.EOL;
  },

  /**
   * Get PATH environment variable name (case-sensitive on Unix).
   * 
   * @returns 'Path' on Windows, 'PATH' on Unix
   */
  getPathVarName(): string {
    return Platform.isWindows() ? 'Path' : 'PATH';
  },
};

/**
 * Shell command utilities
 */
export const ShellUtils = {
  /**
   * Get shell script extension for current platform.
   * 
   * @returns '.bat' on Windows, '.sh' on Unix
   */
  getScriptExtension(): string {
    return Platform.isWindows() ? '.bat' : '.sh';
  },

  /**
   * Get executable extension for current platform.
   * 
   * @returns '.exe' on Windows, empty string on Unix
   */
  getExecutableExtension(): string {
    return Platform.isWindows() ? '.exe' : '';
  },

  /**
   * Get script name with appropriate extension.
   * 
   * @param baseName - Base name without extension
   * @returns Script name with platform-specific extension
   */
  getScriptName(baseName: string): string {
    return `${baseName}${this.getScriptExtension()}`;
  },

  /**
   * Get shell command prefix for current platform.
   * 
   * @returns 'cmd /c' on Windows, '/bin/bash' on Unix
   */
  getShellPrefix(): string {
    if (Platform.isWindows()) {
      return 'cmd /c';
    }
    return '/bin/bash';
  },

  /**
   * Get default shell for current platform.
   * 
   * @returns Default shell path (COMSPEC/cmd.exe on Windows, SHELL/bash on Unix)
   */
  getDefaultShell(): string {
    if (Platform.isWindows()) {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  },
};

/**
 * File system utilities with platform-specific handling
 */
export const FileUtils = {
  /**
   * Check if file/directory is hidden (platform-specific).
   * 
   * @param filepath - Path to check
   * @returns true if the file/directory is hidden
   */
  isHidden(filepath: string): boolean {
    const basename = path.basename(filepath);
    
    if (Platform.isUnix()) {
      return basename.startsWith('.');
    }
    
    // Windows: check dot prefix as common convention
    return basename.startsWith('.');
  },

  /**
   * Get platform-specific config directory.
   * 
   * @returns Config directory path (APPDATA on Windows, ~/Library/Application Support on macOS, ~/.config on Linux)
   */
  getConfigDir(): string {
    if (Platform.isWindows()) {
      return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    }
    if (Platform.isMacOS()) {
      return path.join(os.homedir(), 'Library', 'Application Support');
    }
    return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  },

  /**
   * Get platform-specific data directory.
   * 
   * @returns Data directory path (LOCALAPPDATA on Windows, ~/Library/Application Support on macOS, ~/.local/share on Linux)
   */
  getDataDir(): string {
    if (Platform.isWindows()) {
      return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    }
    if (Platform.isMacOS()) {
      return path.join(os.homedir(), 'Library', 'Application Support');
    }
    return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  },
};

/**
 * Process utilities
 */
export const ProcessUtils = {
  /**
   * Get number of CPU cores.
   * 
   * @returns Number of CPU cores available
   */
  getCPUCount(): number {
    return os.cpus().length;
  },

  /**
   * Get total memory in bytes.
   * 
   * @returns Total system memory in bytes
   */
  getTotalMemory(): number {
    return os.totalmem();
  },

  /**
   * Get free memory in bytes.
   * 
   * @returns Free system memory in bytes
   */
  getFreeMemory(): number {
    return os.freemem();
  },

  /**
   * Get system uptime in seconds.
   * 
   * @returns System uptime in seconds
   */
  getUptime(): number {
    return os.uptime();
  },

  /**
   * Get platform-specific process priority.
   * 
   * @returns Process priority value
   */
  getPriority(): number {
    return os.getPriority();
  },
};

/**
 * Export all utilities as a single object
 */
export const CrossPlatform = {
  Platform,
  PathUtils,
  EnvUtils,
  ShellUtils,
  FileUtils,
  ProcessUtils,
};

export default CrossPlatform;
