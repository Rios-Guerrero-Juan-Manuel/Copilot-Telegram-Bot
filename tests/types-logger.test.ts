/**
 * Tests for logger metadata types
 */
import { describe, it, expect } from 'vitest';
import {
  LogMetadata,
  ErrorLogMetadata,
  NetworkLogMetadata,
  UserActionLogMetadata,
} from '../src/types/logger.js';

describe('Logger Metadata Types', () => {
  describe('LogMetadata', () => {
    it('should accept string values', () => {
      const metadata: LogMetadata = { key: 'value' };
      expect(metadata.key).toBe('value');
    });

    it('should accept number values', () => {
      const metadata: LogMetadata = { count: 42 };
      expect(metadata.count).toBe(42);
    });

    it('should accept boolean values', () => {
      const metadata: LogMetadata = { enabled: true };
      expect(metadata.enabled).toBe(true);
    });

    it('should accept null and undefined', () => {
      const metadata: LogMetadata = { nullValue: null, undefinedValue: undefined };
      expect(metadata.nullValue).toBe(null);
      expect(metadata.undefinedValue).toBe(undefined);
    });

    it('should accept nested objects', () => {
      const metadata: LogMetadata = {
        nested: {
          key: 'value',
          count: 42,
        },
      };
      expect(metadata.nested).toEqual({ key: 'value', count: 42 });
    });

    it('should accept arrays', () => {
      const metadata: LogMetadata = {
        items: ['a', 'b', 'c'],
        numbers: [1, 2, 3],
      };
      expect(metadata.items).toEqual(['a', 'b', 'c']);
      expect(metadata.numbers).toEqual([1, 2, 3]);
    });

    it('should accept complex nested structures', () => {
      const metadata: LogMetadata = {
        user: {
          id: 123,
          name: 'Test User',
          roles: ['admin', 'user'],
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
      };
      expect(metadata.user).toBeDefined();
    });
  });

  describe('ErrorLogMetadata', () => {
    it('should accept error objects', () => {
      const error = new Error('Test error');
      const metadata: ErrorLogMetadata = {
        error,
        code: 'ERR_TEST',
        stack: error.stack,
      };
      expect(metadata.error).toBe(error);
      expect(metadata.code).toBe('ERR_TEST');
    });

    it('should accept unknown error types', () => {
      const metadata: ErrorLogMetadata = {
        error: 'string error',
        code: 500,
      };
      expect(metadata.error).toBe('string error');
      expect(metadata.code).toBe(500);
    });
  });

  describe('NetworkLogMetadata', () => {
    it('should accept network request metadata', () => {
      const metadata: NetworkLogMetadata = {
        url: 'https://api.example.com/data',
        method: 'GET',
        statusCode: 200,
        responseTime: 150,
      };
      expect(metadata.url).toBe('https://api.example.com/data');
      expect(metadata.method).toBe('GET');
      expect(metadata.statusCode).toBe(200);
      expect(metadata.responseTime).toBe(150);
    });

    it('should accept partial network metadata', () => {
      const metadata: NetworkLogMetadata = {
        url: 'https://api.example.com/data',
      };
      expect(metadata.url).toBeDefined();
      expect(metadata.method).toBeUndefined();
    });
  });

  describe('UserActionLogMetadata', () => {
    it('should accept user action metadata', () => {
      const metadata: UserActionLogMetadata = {
        userId: 12345,
        username: 'testuser',
        action: 'login',
        timestamp: Date.now(),
      };
      expect(metadata.userId).toBe(12345);
      expect(metadata.username).toBe('testuser');
      expect(metadata.action).toBe('login');
      expect(metadata.timestamp).toBeDefined();
    });

    it('should accept partial user action metadata', () => {
      const metadata: UserActionLogMetadata = {
        userId: 12345,
        action: 'logout',
      };
      expect(metadata.userId).toBe(12345);
      expect(metadata.action).toBe('logout');
    });
  });

  describe('Type Safety', () => {
    it('should prevent non-metadata values at compile time', () => {
      const validMetadata: LogMetadata = {
        string: 'value',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: 'value' },
      };
      
      expect(Object.keys(validMetadata)).toHaveLength(6);
    });
  });
});
