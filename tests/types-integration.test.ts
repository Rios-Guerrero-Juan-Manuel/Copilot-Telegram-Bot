/**
 * Integration test to verify type safety improvements work correctly
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForLogging } from '../src/utils/sanitize.js';
import { isNetworkError, isAuthError } from '../src/utils/telegram-retry.js';
import { isErrorWithMessage, toErrorWithMessage, getErrorMessage } from '../src/types/errors.js';

describe('Type Safety Integration Tests', () => {
  describe('Sanitization with strict types', () => {
    it('should sanitize simple objects', () => {
      const data = { user: 'test', count: 42 };
      const sanitized = sanitizeForLogging(data);
      expect(sanitized).toEqual(data);
    });

    it('should redact sensitive fields', () => {
      const data = { user: 'test', auth_token: 'secret123' };
      const sanitized = sanitizeForLogging(data);
      expect(sanitized).toEqual({ user: 'test', auth_token: '[REDACTED]' });
    });

    it('should handle errors properly', () => {
      const error = new Error('Test error');
      const sanitized = sanitizeForLogging(error);
      expect(sanitized).toHaveProperty('message', 'Test error');
      expect(sanitized).toHaveProperty('name');
    });

    it('should handle circular references', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      const sanitized = sanitizeForLogging(circular);
      expect(sanitized).toHaveProperty('name', 'test');
      expect(sanitized).toHaveProperty('self', '[Circular]');
    });

    it('should handle undefined and null', () => {
      expect(sanitizeForLogging(null)).toBe(null);
      expect(sanitizeForLogging(undefined)).toBe(undefined);
    });

    it('should handle functions gracefully', () => {
      const result = sanitizeForLogging(() => {});
      expect(typeof result).toBe('string');
    });
  });

  describe('Error type guards integration', () => {
    it('should identify network errors', () => {
      const networkErr = { message: 'Network failed', code: 'ECONNREFUSED' };
      expect(isNetworkError(networkErr)).toBe(true);
    });

    it('should identify auth errors', () => {
      const authErr = { message: 'Unauthorized', code: 401 };
      expect(isAuthError(authErr)).toBe(true);
    });

    it('should identify error with message', () => {
      const err = new Error('Test');
      expect(isErrorWithMessage(err)).toBe(true);
    });

    it('should convert unknown to error with message', () => {
      const result = toErrorWithMessage('string error');
      expect(result).toHaveProperty('message');
    });

    it('should extract error messages', () => {
      expect(getErrorMessage(new Error('Test'))).toBe('Test');
      expect(getErrorMessage('string error')).toContain('string error');
      expect(getErrorMessage(123)).toBe('123');
    });
  });

  describe('Logger metadata type safety', () => {
    it('should accept valid metadata', () => {
      const metadata = {
        userId: 123,
        action: 'login',
        timestamp: Date.now(),
        nested: {
          key: 'value',
        },
      };
      
      // Should work with sanitization
      const sanitized = sanitizeForLogging(metadata);
      expect(sanitized).toHaveProperty('userId', 123);
      expect(sanitized).toHaveProperty('action', 'login');
    });
  });

  describe('Type safety prevents runtime errors', () => {
    it('should handle edge cases safely', () => {
      const testCases = [
        null,
        undefined,
        '',
        0,
        false,
        {},
        [],
        new Error('test'),
        { nested: { deep: { value: 123 } } },
      ];

      for (const testCase of testCases) {
        expect(() => sanitizeForLogging(testCase)).not.toThrow();
      }
    });

    it('should handle very deep nesting', () => {
      const deep: any = { level: 1 };
      let current = deep;
      for (let i = 2; i <= 15; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const sanitized = sanitizeForLogging(deep);
      expect(sanitized).toBeDefined();
    });

    it('should handle large arrays', () => {
      const largeArray = Array(1000).fill('test');
      const sanitized = sanitizeForLogging(largeArray);
      expect(Array.isArray(sanitized)).toBe(true);
      expect(sanitized).toHaveLength(1000);
    });
  });
});
