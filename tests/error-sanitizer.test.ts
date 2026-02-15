import { describe, it, expect } from 'vitest';
import { sanitizeErrorForUser } from '../src/utils/error-sanitizer';

describe('sanitizeErrorForUser', () => {
  describe('Windows paths', () => {
    it('should remove absolute Windows paths', () => {
      const error = new Error('File not found: C:\\Users\\Admin\\project\\file.txt');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('C:\\Users\\Admin');
      expect(result).not.toContain('C:/Users/Admin');
      expect(result).toContain('File not found');
    });

    it('should remove Windows paths in error messages', () => {
      const message = 'Cannot read file D:\\Dev\\MyProject\\src\\index.ts';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('D:\\Dev\\MyProject');
      expect(result).toContain('Cannot read file');
    });

    it('should remove multiple Windows paths in same message', () => {
      const message = 'Copy from C:\\source\\file.txt to D:\\dest\\file.txt failed';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('C:\\source');
      expect(result).not.toContain('D:\\dest');
      expect(result).toContain('Copy from');
      expect(result).toContain('failed');
    });

    it('should handle Windows paths with forward slashes', () => {
      const message = 'Error in C:/Users/John/Documents/project/file.js';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('C:/Users/John');
      expect(result).toContain('Error in');
    });

    it('should handle UNC paths', () => {
      const message = 'Cannot access \\\\server\\share\\folder\\file.txt';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('\\\\server\\share');
      expect(result).toContain('Cannot access');
    });
  });

  describe('Unix paths', () => {
    it('should remove absolute Unix paths', () => {
      const error = new Error('File not found: /home/user/project/file.txt');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/home/user');
      expect(result).toContain('File not found');
    });

    it('should remove /Users paths (macOS)', () => {
      const message = 'Cannot read /Users/john/Documents/project/index.ts';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('/Users/john');
      expect(result).toContain('Cannot read');
    });

    it('should remove /root paths', () => {
      const message = 'Permission denied: /root/.config/app/settings.json';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('/root/.config');
      expect(result).toContain('Permission denied');
    });

    it('should remove /opt and /var paths', () => {
      const message = 'Error in /opt/myapp/bin/run.sh and /var/log/app.log';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('/opt/myapp');
      expect(result).not.toContain('/var/log');
      expect(result).toContain('Error in');
    });
  });

  describe('Stack traces', () => {
    it('should remove stack traces completely', () => {
      const error = new Error('Something went wrong');
      error.stack = `Error: Something went wrong
    at Object.<anonymous> (C:\\Users\\Admin\\project\\src\\index.ts:10:15)
    at Module._compile (internal/modules/cjs/loader.js:1138:30)
    at Object.Module._extensions..js (internal/modules/cjs/loader.js:1158:10)`;
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('C:\\Users\\Admin');
      expect(result).not.toContain('at Object.<anonymous>');
      expect(result).not.toContain('at Module._compile');
      expect(result).toContain('Something went wrong');
    });

    it('should remove Unix-style stack traces', () => {
      const error = new Error('Error occurred');
      error.stack = `Error: Error occurred
    at processFile (/home/user/app/src/processor.js:25:10)
    at /home/user/app/src/index.js:50:5`;
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/home/user');
      expect(result).not.toContain('at processFile');
      expect(result).toContain('Error occurred');
    });

    it('should handle multiline errors with stack traces', () => {
      const message = `Error: Failed to process
    at handler (/home/dev/project/handler.js:10:5)
    at async run (/home/dev/project/main.js:20:3)`;
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('/home/dev');
      expect(result).not.toContain('at handler');
      expect(result).toContain('Failed to process');
    });
  });

  describe('Environment variables', () => {
    it('should remove environment variable values from patterns', () => {
      const message = 'TOKEN=abc123def456 is invalid';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('abc123def456');
      expect(result).toContain('is invalid');
    });

    it('should remove API_KEY values', () => {
      const message = 'Error: API_KEY=sk_test_123456789 not authorized';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('sk_test_123456789');
      expect(result).toContain('not authorized');
    });

    it('should remove PASSWORD values', () => {
      const message = 'DB_PASSWORD=mysecret123 is incorrect';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('mysecret123');
      expect(result).toContain('is incorrect');
    });

    it('should handle multiple env vars in same message', () => {
      const message = 'Config error: API_KEY=key123, SECRET=secret456, TOKEN=token789';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('key123');
      expect(result).not.toContain('secret456');
      expect(result).not.toContain('token789');
      expect(result).toContain('Config error');
    });
  });

  describe('Credentials and tokens', () => {
    it('should remove GitHub tokens', () => {
      const message = 'Auth failed with token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('ghp_1234567890');
      expect(result).toContain('Auth failed');
    });

    it('should remove Bearer tokens', () => {
      const message = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(result).toContain('Authorization');
    });

    it('should remove Telegram bot tokens', () => {
      const message = 'Invalid token: 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('1234567890:ABCdefGHI');
      expect(result).toContain('Invalid token');
    });

    it('should remove API keys in various formats', () => {
      const message = 'Key sk-1234567890abcdef is invalid';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('sk-1234567890');
      expect(result).toContain('is invalid');
    });
  });

  describe('Nested errors', () => {
    it('should sanitize nested error messages', () => {
      const innerError = new Error('DB connection failed: /home/user/db/data.db not found');
      const outerError = new Error(`Failed to start: ${innerError.message}`);
      const result = sanitizeErrorForUser(outerError);
      expect(result).not.toContain('/home/user');
      expect(result).toContain('Failed to start');
      expect(result).toContain('DB connection failed');
    });

    it('should handle Error objects with cause', () => {
      const cause = new Error('File error: C:\\Users\\Admin\\file.txt');
      const error = new Error('Operation failed', { cause });
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('C:\\Users\\Admin');
      expect(result).toContain('Operation failed');
    });
  });

  describe('Input types', () => {
    it('should handle Error objects', () => {
      const error = new Error('Test error with /home/user/path');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/home/user');
      expect(result).toContain('Test error');
    });

    it('should handle string messages', () => {
      const message = 'Error in C:\\Users\\path\\file.txt';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('C:\\Users');
      expect(result).toContain('Error in');
    });

    it('should handle unknown error types', () => {
      const error = { toString: () => 'Custom error with /home/user/path' };
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/home/user');
      expect(result).toContain('Custom error');
    });

    it('should handle null/undefined gracefully', () => {
      expect(sanitizeErrorForUser(null as any)).toBe('An error occurred');
      expect(sanitizeErrorForUser(undefined as any)).toBe('An error occurred');
    });
  });

  describe('Preserving legitimate information', () => {
    it('should preserve error messages without sensitive data', () => {
      const message = 'Invalid input: expected number, got string';
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
    });

    it('should preserve relative paths', () => {
      const message = 'Cannot find module ./utils/helper.js';
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
    });

    it('should preserve error codes and status', () => {
      const message = 'HTTP Error 404: Not Found';
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
    });

    it('should preserve file names without full paths', () => {
      const message = 'Syntax error in config.json at line 15';
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
    });

    it('should preserve URLs', () => {
      const message = 'Failed to fetch https://api.example.com/data';
      const result = sanitizeErrorForUser(message);
      expect(result).toBe(message);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      const result = sanitizeErrorForUser('');
      expect(result).toBe('An error occurred');
    });

    it('should handle very long error messages', () => {
      const longPath = 'C:\\' + 'folder\\'.repeat(50) + 'file.txt';
      const message = `Error accessing ${longPath}`;
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('folder\\folder');
      expect(result).toContain('Error accessing');
    });

    it('should handle mixed Windows and Unix paths', () => {
      const message = 'Copy from /home/user/file.txt to C:\\Users\\Admin\\file.txt failed';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('/home/user');
      expect(result).not.toContain('C:\\Users\\Admin');
      expect(result).toContain('Copy from');
      expect(result).toContain('failed');
    });

    it('should handle paths in different parts of message', () => {
      const message = 'Error: C:\\path1\\file.txt not found, tried /home/user/path2/file.txt too';
      const result = sanitizeErrorForUser(message);
      expect(result).not.toContain('C:\\path1');
      expect(result).not.toContain('/home/user');
      expect(result).toContain('not found');
    });
  });

  describe('Real-world scenarios', () => {
    it('should sanitize ENOENT errors', () => {
      const error = new Error("ENOENT: no such file or directory, open 'C:\\Users\\Admin\\AppData\\Local\\Temp\\file.txt'");
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('C:\\Users\\Admin');
      expect(result).toContain('ENOENT');
      expect(result).toContain('no such file or directory');
    });

    it('should sanitize permission errors', () => {
      const error = new Error('EACCES: permission denied, access /root/.config/app/settings.json');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/root/.config');
      expect(result).toContain('EACCES');
      expect(result).toContain('permission denied');
    });

    it('should sanitize module not found errors', () => {
      const error = new Error("Cannot find module 'D:\\Projects\\MyApp\\node_modules\\somepackage\\index.js'");
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('D:\\Projects\\MyApp');
      expect(result).toContain('Cannot find module');
    });

    it('should sanitize spawn errors with command paths', () => {
      const error = new Error('spawn C:\\Program Files\\Git\\bin\\git.exe ENOENT');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('C:\\Program Files');
      expect(result).toContain('spawn');
      expect(result).toContain('ENOENT');
    });

    it('should sanitize database connection errors', () => {
      const error = new Error('Database connection failed: sqlite3.Database(/home/user/.config/bot/data.db)');
      const result = sanitizeErrorForUser(error);
      expect(result).not.toContain('/home/user/.config');
      expect(result).toContain('Database connection failed');
    });
  });
});
