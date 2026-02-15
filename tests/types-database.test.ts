/**
 * Tests for database types
 */
import { describe, it, expect } from 'vitest';
import {
  SqliteColumnInfo,
  DatabaseRow,
} from '../src/types/database.js';

describe('Database Types', () => {
  describe('SqliteColumnInfo', () => {
    it('should represent SQLite column information', () => {
      const column: SqliteColumnInfo = {
        cid: 0,
        name: 'id',
        type: 'INTEGER',
        notnull: 1,
        dflt_value: null,
        pk: 1,
      };
      expect(column.name).toBe('id');
      expect(column.type).toBe('INTEGER');
      expect(column.pk).toBe(1);
    });

    it('should handle text columns', () => {
      const column: SqliteColumnInfo = {
        cid: 1,
        name: 'username',
        type: 'TEXT',
        notnull: 1,
        dflt_value: null,
        pk: 0,
      };
      expect(column.name).toBe('username');
      expect(column.type).toBe('TEXT');
    });

    it('should handle columns with default values', () => {
      const column: SqliteColumnInfo = {
        cid: 2,
        name: 'created_at',
        type: 'INTEGER',
        notnull: 0,
        dflt_value: 'CURRENT_TIMESTAMP',
        pk: 0,
      };
      expect(column.dflt_value).toBe('CURRENT_TIMESTAMP');
    });

    it('should handle nullable columns', () => {
      const column: SqliteColumnInfo = {
        cid: 3,
        name: 'optional_field',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      };
      expect(column.notnull).toBe(0);
    });
  });

  describe('DatabaseRow', () => {
    it('should accept string values', () => {
      const row: DatabaseRow = {
        name: 'John Doe',
        email: 'john@example.com',
      };
      expect(row.name).toBe('John Doe');
      expect(row.email).toBe('john@example.com');
    });

    it('should accept number values', () => {
      const row: DatabaseRow = {
        id: 123,
        age: 30,
        score: 95.5,
      };
      expect(row.id).toBe(123);
      expect(row.age).toBe(30);
      expect(row.score).toBe(95.5);
    });

    it('should accept boolean values', () => {
      const row: DatabaseRow = {
        is_active: true,
        is_verified: false,
      };
      expect(row.is_active).toBe(true);
      expect(row.is_verified).toBe(false);
    });

    it('should accept null values', () => {
      const row: DatabaseRow = {
        deleted_at: null,
        optional_field: null,
      };
      expect(row.deleted_at).toBe(null);
    });

    it('should accept undefined values', () => {
      const row: DatabaseRow = {
        unset_field: undefined,
      };
      expect(row.unset_field).toBe(undefined);
    });

    it('should accept mixed types', () => {
      const row: DatabaseRow = {
        id: 1,
        username: 'testuser',
        is_admin: true,
        last_login: null,
        metadata: undefined,
      };
      expect(Object.keys(row)).toHaveLength(5);
    });

    it('should represent a complete user row', () => {
      const userRow: DatabaseRow = {
        id: 12345,
        telegram_id: 67890,
        username: 'testuser',
        first_name: 'Test',
        last_name: 'User',
        is_active: true,
        created_at: 1234567890,
        updated_at: 1234567890,
        deleted_at: null,
      };
      expect(userRow.id).toBe(12345);
      expect(userRow.username).toBe('testuser');
      expect(userRow.is_active).toBe(true);
      expect(userRow.deleted_at).toBe(null);
    });
  });

  describe('Type Safety', () => {
    it('should enforce SqliteColumnInfo structure', () => {
      const column: SqliteColumnInfo = {
        cid: 0,
        name: 'test',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      };
      
      expect(column.cid).toBeDefined();
      expect(column.name).toBeDefined();
      expect(column.type).toBeDefined();
      expect(column.notnull).toBeDefined();
      expect(column.dflt_value).toBeDefined();
      expect(column.pk).toBeDefined();
    });

    it('should allow dynamic keys in DatabaseRow', () => {
      const row: DatabaseRow = {};
      row.dynamic_field = 'value';
      row.another_field = 123;
      
      expect(row.dynamic_field).toBe('value');
      expect(row.another_field).toBe(123);
    });
  });
});
