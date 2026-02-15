/**
 * Tests for type-safe error handling
 */
import { describe, it, expect } from 'vitest';
import {
  ErrorWithMessage,
  NetworkError,
  TelegramError,
  AuthError,
  isErrorWithMessage,
  isNetworkError,
  isTelegramError,
  isAuthError,
  toErrorWithMessage,
  getErrorMessage,
} from '../src/types/errors.js';

describe('Error Type Guards', () => {
  describe('isErrorWithMessage', () => {
    it('should return true for Error instances', () => {
      const error = new Error('Test error');
      expect(isErrorWithMessage(error)).toBe(true);
    });

    it('should return true for objects with message property', () => {
      const error = { message: 'Test error' };
      expect(isErrorWithMessage(error)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isErrorWithMessage(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isErrorWithMessage(undefined)).toBe(false);
    });

    it('should return false for primitives', () => {
      expect(isErrorWithMessage('error')).toBe(false);
      expect(isErrorWithMessage(123)).toBe(false);
      expect(isErrorWithMessage(true)).toBe(false);
    });

    it('should return false for objects without message', () => {
      expect(isErrorWithMessage({})).toBe(false);
      expect(isErrorWithMessage({ error: 'test' })).toBe(false);
    });

    it('should return false if message is not a string', () => {
      expect(isErrorWithMessage({ message: 123 })).toBe(false);
      expect(isErrorWithMessage({ message: null })).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('should return true for network errors with code', () => {
      const error: NetworkError = { message: 'Network error', code: 'ECONNREFUSED' };
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return true for network errors with errno', () => {
      const error: NetworkError = { message: 'Network error', errno: -111 };
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return true for network errors with syscall', () => {
      const error: NetworkError = { message: 'Network error', syscall: 'connect' };
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isNetworkError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isNetworkError('error')).toBe(false);
      expect(isNetworkError(null)).toBe(false);
    });
  });

  describe('isTelegramError', () => {
    it('should return true for Telegram API errors', () => {
      const error: TelegramError = {
        message: 'Telegram error',
        response: { error_code: 400, description: 'Bad Request' },
      };
      expect(isTelegramError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isTelegramError(error)).toBe(false);
    });

    it('should return false for network errors', () => {
      const error: NetworkError = { message: 'Network error', code: 'ECONNREFUSED' };
      expect(isTelegramError(error)).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should return true for auth errors with code', () => {
      const error: AuthError = { message: 'Auth error', code: 401 };
      expect(isAuthError(error)).toBe(true);
    });

    it('should return true for auth errors with statusCode', () => {
      const error: AuthError = { message: 'Auth error', statusCode: 403 };
      expect(isAuthError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isAuthError(error)).toBe(false);
    });
  });
});

describe('Error Conversion Functions', () => {
  describe('toErrorWithMessage', () => {
    it('should return Error instances as-is', () => {
      const error = new Error('Test error');
      const result = toErrorWithMessage(error);
      expect(result).toBe(error);
      expect(result.message).toBe('Test error');
    });

    it('should convert objects with message to ErrorWithMessage', () => {
      const error = { message: 'Test error' };
      const result = toErrorWithMessage(error);
      expect(result.message).toBe('Test error');
    });

    it('should convert strings to Error', () => {
      const result = toErrorWithMessage('Test error');
      expect(result.message).toBe('"Test error"');
    });

    it('should convert numbers to Error', () => {
      const result = toErrorWithMessage(123);
      expect(result.message).toBe('123');
    });

    it('should convert null to Error', () => {
      const result = toErrorWithMessage(null);
      expect(result.message).toBe('null');
    });

    it('should convert undefined to Error', () => {
      const result = toErrorWithMessage(undefined);
      expect(result.message).toBe('');
    });

    it('should convert objects to JSON string Error', () => {
      const result = toErrorWithMessage({ code: 'ERR', details: 'info' });
      expect(result.message).toContain('code');
      expect(result.message).toContain('ERR');
    });

    it('should handle circular references gracefully', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      const result = toErrorWithMessage(circular);
      expect(result.message).toBeTruthy();
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error', () => {
      const error = new Error('Test message');
      expect(getErrorMessage(error)).toBe('Test message');
    });

    it('should extract message from error-like object', () => {
      const error = { message: 'Test message' };
      expect(getErrorMessage(error)).toBe('Test message');
    });

    it('should convert string to message', () => {
      const message = getErrorMessage('Test error');
      expect(message).toBe('"Test error"');
    });

    it('should convert unknown types to message', () => {
      expect(getErrorMessage(123)).toBe('123');
      expect(getErrorMessage(true)).toBe('true');
      expect(getErrorMessage(null)).toBe('null');
    });
  });
});

describe('Type Safety with TypeScript', () => {
  it('should enforce ErrorWithMessage structure', () => {
    const error: ErrorWithMessage = { message: 'test' };
    expect(error.message).toBe('test');
  });

  it('should enforce NetworkError structure', () => {
    const error: NetworkError = { message: 'test', code: 'ECONNREFUSED' };
    expect(error.code).toBe('ECONNREFUSED');
  });

  it('should enforce TelegramError structure', () => {
    const error: TelegramError = {
      message: 'test',
      response: { error_code: 400 },
    };
    expect(error.response?.error_code).toBe(400);
  });

  it('should enforce AuthError structure', () => {
    const error: AuthError = { message: 'test', code: 401 };
    expect(error.code).toBe(401);
  });
});
