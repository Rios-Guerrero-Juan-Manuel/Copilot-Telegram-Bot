/**
 * Tests for sanitization types
 */
import { describe, it, expect } from 'vitest';
import {
  JsonPrimitive,
  JsonArray,
  JsonObject,
  JsonValue,
  ErrorObject,
  isJsonValue,
} from '../src/types/sanitize.js';

describe('Sanitization Types', () => {
  describe('JsonPrimitive', () => {
    it('should accept string values', () => {
      const value: JsonPrimitive = 'test';
      expect(value).toBe('test');
    });

    it('should accept number values', () => {
      const value: JsonPrimitive = 42;
      expect(value).toBe(42);
    });

    it('should accept boolean values', () => {
      const value: JsonPrimitive = true;
      expect(value).toBe(true);
    });

    it('should accept null', () => {
      const value: JsonPrimitive = null;
      expect(value).toBe(null);
    });
  });

  describe('JsonArray', () => {
    it('should accept arrays of primitives', () => {
      const arr: JsonArray = ['a', 1, true, null];
      expect(arr).toEqual(['a', 1, true, null]);
    });

    it('should accept arrays of objects', () => {
      const arr: JsonArray = [{ key: 'value' }, { number: 42 }];
      expect(arr).toHaveLength(2);
    });

    it('should accept nested arrays', () => {
      const arr: JsonArray = [1, [2, [3, 4]]];
      expect(arr).toHaveLength(2);
    });
  });

  describe('JsonObject', () => {
    it('should accept simple objects', () => {
      const obj: JsonObject = { key: 'value', count: 42 };
      expect(obj.key).toBe('value');
      expect(obj.count).toBe(42);
    });

    it('should accept nested objects', () => {
      const obj: JsonObject = {
        user: {
          name: 'Test',
          age: 30,
        },
      };
      expect(obj.user).toBeDefined();
    });

    it('should accept objects with arrays', () => {
      const obj: JsonObject = {
        items: [1, 2, 3],
        tags: ['a', 'b'],
      };
      expect(obj.items).toHaveLength(3);
    });
  });

  describe('ErrorObject', () => {
    it('should require name and message', () => {
      const errorObj: ErrorObject = {
        name: 'TestError',
        message: 'Test error message',
      };
      expect(errorObj.name).toBe('TestError');
      expect(errorObj.message).toBe('Test error message');
    });

    it('should accept optional stack', () => {
      const errorObj: ErrorObject = {
        name: 'TestError',
        message: 'Test error message',
        stack: 'Error stack trace',
      };
      expect(errorObj.stack).toBe('Error stack trace');
    });

    it('should accept additional custom properties', () => {
      const errorObj: ErrorObject = {
        name: 'CustomError',
        message: 'Custom error',
        code: 'ERR_CUSTOM',
        details: { info: 'additional' },
      };
      expect(errorObj.code).toBe('ERR_CUSTOM');
      expect(errorObj.details).toEqual({ info: 'additional' });
    });
  });

  describe('isJsonValue', () => {
    it('should return true for null', () => {
      expect(isJsonValue(null)).toBe(true);
    });

    it('should return true for strings', () => {
      expect(isJsonValue('test')).toBe(true);
    });

    it('should return true for numbers', () => {
      expect(isJsonValue(42)).toBe(true);
      expect(isJsonValue(3.14)).toBe(true);
    });

    it('should return true for booleans', () => {
      expect(isJsonValue(true)).toBe(true);
      expect(isJsonValue(false)).toBe(true);
    });

    it('should return true for arrays of primitives', () => {
      expect(isJsonValue([1, 2, 3])).toBe(true);
      expect(isJsonValue(['a', 'b'])).toBe(true);
      expect(isJsonValue([true, false])).toBe(true);
    });

    it('should return true for simple objects', () => {
      expect(isJsonValue({ key: 'value' })).toBe(true);
      expect(isJsonValue({ count: 42 })).toBe(true);
    });

    it('should return true for nested valid JSON', () => {
      const complex = {
        user: {
          name: 'Test',
          tags: ['a', 'b'],
          settings: {
            enabled: true,
            count: 5,
          },
        },
      };
      expect(isJsonValue(complex)).toBe(true);
    });

    it('should return false for undefined', () => {
      expect(isJsonValue(undefined)).toBe(false);
    });

    it('should return false for functions', () => {
      expect(isJsonValue(() => {})).toBe(false);
      expect(isJsonValue(function test() {})).toBe(false);
    });

    it('should return false for symbols', () => {
      expect(isJsonValue(Symbol('test'))).toBe(false);
    });

    it('should return false for objects with undefined values', () => {
      expect(isJsonValue({ key: undefined })).toBe(false);
    });

    it('should return false for arrays with invalid values', () => {
      expect(isJsonValue([1, 2, undefined])).toBe(false);
      expect(isJsonValue([1, () => {}, 3])).toBe(false);
    });

    it('should handle Date objects (returns true for empty-object semantics)', () => {
      expect(isJsonValue(new Date())).toBe(true);
    });
  });
});
