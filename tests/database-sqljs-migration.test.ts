import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('DatabaseManager - sql.js Migration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should initialize in-memory database', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    expect(dbManager).toBeDefined();
    expect(dbManager.db).toBeDefined();
  });

  it('should create database file on disk', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const testDbPath = path.join(process.cwd(), 'data', 'test-sqljs.db');
    
    // Clean up if exists
    try {
      await fs.unlink(testDbPath);
    } catch {
      // Ignore if doesn't exist
    }

    const dbManager = await DatabaseManager.create(testDbPath);
    expect(dbManager).toBeDefined();
    
    // Verify file was created
    const stats = await fs.stat(testDbPath);
    expect(stats.isFile()).toBe(true);
    
    // Clean up
    await dbManager.close();
    await fs.unlink(testDbPath);
  });

  it('should create all required tables on migration', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    // Verify tables exist by querying sqlite_master
    const tables = dbManager.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values.map(row => row[0]) || [];
    
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('mcp_servers');
    expect(tableNames).toContain('sessions');
  });

  it('should execute INSERT and SELECT queries', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    // Insert a user
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['123', 'testuser', '/test', 'gpt-4', 0, now]
    );
    
    // Query the user
    const result = dbManager.exec('SELECT * FROM users WHERE telegram_id = ?', ['123']);
    expect(result).toHaveLength(1);
    expect(result[0].values).toHaveLength(1);
    expect(result[0].values[0][1]).toBe('123'); // telegram_id is second column (after id)
  });

  it('should get single row with getFirst helper', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['456', 'testuser2', '/test2', 'gpt-4', 1, now]
    );
    
    const user = dbManager.getFirst('SELECT * FROM users WHERE telegram_id = ?', ['456']);
    expect(user).toBeDefined();
    expect(user?.telegram_id).toBe('456');
    expect(user?.telegram_username).toBe('testuser2');
  });

  it('should get all rows with getAll helper', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['789', 'user1', '/test', 'gpt-4', 0, now]
    );
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['790', 'user2', '/test', 'gpt-4', 0, now]
    );
    
    const users = dbManager.getAll('SELECT * FROM users ORDER BY telegram_id');
    expect(users).toHaveLength(2);
    expect(users[0].telegram_id).toBe('789');
    expect(users[1].telegram_id).toBe('790');
  });

  it('should handle UPDATE queries', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['999', 'olduser', '/old', 'gpt-3', 0, now]
    );
    
    // Update
    const result = dbManager.run('UPDATE users SET current_model = ? WHERE telegram_id = ?', ['gpt-4', '999']);
    expect(result.changes).toBe(1);
    
    // Verify update
    const user = dbManager.getFirst('SELECT * FROM users WHERE telegram_id = ?', ['999']);
    expect(user?.current_model).toBe('gpt-4');
  });

  it('should handle DELETE queries', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['888', 'deleteuser', '/test', 'gpt-4', 0, now]
    );
    
    // Delete
    const result = dbManager.run('DELETE FROM users WHERE telegram_id = ?', ['888']);
    expect(result.changes).toBe(1);
    
    // Verify deletion
    const user = dbManager.getFirst('SELECT * FROM users WHERE telegram_id = ?', ['888']);
    expect(user).toBeUndefined();
  });

  it('should auto-save on modification when using file database', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const testDbPath = path.join(process.cwd(), 'data', 'test-autosave.db');
    
    // Clean up if exists
    try {
      await fs.unlink(testDbPath);
    } catch {
      // Ignore
    }

    const dbManager = await DatabaseManager.create(testDbPath);
    
    const now = new Date().toISOString();
    dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['777', 'autosave', '/test', 'gpt-4', 0, now]
    );
    
    // Close and reopen to verify persistence
    await dbManager.close();
    
    const dbManager2 = await DatabaseManager.create(testDbPath);
    const user = dbManager2.getFirst('SELECT * FROM users WHERE telegram_id = ?', ['777']);
    expect(user?.telegram_id).toBe('777');
    
    // Clean up
    await dbManager2.close();
    await fs.unlink(testDbPath);
  });

  it('should handle lastInsertRowid correctly', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    const result = dbManager.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['555', 'insertid', '/test', 'gpt-4', 0, now]
    );
    
    expect(result.lastInsertRowid).toBeGreaterThan(0);
    
    // Verify the id matches
    const user = dbManager.getFirst('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
    expect(user?.telegram_id).toBe('555');
  });

  it('should support UPSERT (INSERT OR REPLACE)', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    const userId = 1;
    
    // Insert initial project
    dbManager.run(
      `INSERT INTO projects (user_id, name, path, created_at) VALUES (?, ?, ?, ?)`,
      [userId, 'test-project', '/old/path', now]
    );
    
    // Upsert with new path
    dbManager.run(
      `INSERT OR REPLACE INTO projects (user_id, name, path, created_at) VALUES (?, ?, ?, ?)`,
      [userId, 'test-project', '/new/path', now]
    );
    
    const project = dbManager.getFirst(
      'SELECT * FROM projects WHERE user_id = ? AND name = ?',
      [userId, 'test-project']
    );
    expect(project?.path).toBe('/new/path');
  });

  it('should load existing database from file', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const testDbPath = path.join(process.cwd(), 'data', 'test-load.db');
    
    // Clean up if exists
    try {
      await fs.unlink(testDbPath);
    } catch {
      // Ignore
    }

    // Create and populate database
    const dbManager1 = await DatabaseManager.create(testDbPath);
    const now = new Date().toISOString();
    dbManager1.run(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['666', 'loadtest', '/test', 'gpt-4', 1, now]
    );
    await dbManager1.close();
    
    // Load existing database
    const dbManager2 = await DatabaseManager.create(testDbPath);
    const user = dbManager2.getFirst('SELECT * FROM users WHERE telegram_id = ?', ['666']);
    expect(user?.telegram_id).toBe('666');
    expect(user?.allowed_paths_configured).toBe(1);
    
    // Clean up
    await dbManager2.close();
    await fs.unlink(testDbPath);
  });

  it('should handle migration of allowed_paths_configured column', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    // Verify column exists
    const result = dbManager.exec("PRAGMA table_info(users)");
    const columns = result[0]?.values.map(row => row[1]) || [];
    expect(columns).toContain('allowed_paths_configured');
  });

  it('should support ON CONFLICT for mcp_servers upsert', async () => {
    const { DatabaseManager } = await import('../src/state/database');
    const dbManager = await DatabaseManager.create(':memory:');
    
    const now = new Date().toISOString();
    const userId = 1;
    
    // Insert initial server
    dbManager.run(
      `INSERT INTO mcp_servers (user_id, name, type, config_json, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, 'test-server', 'stdio', '{"cmd":"test"}', 1, now]
    );
    
    // Upsert with ON CONFLICT
    dbManager.run(
      `INSERT INTO mcp_servers (user_id, name, type, config_json, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET
         type = excluded.type,
         config_json = excluded.config_json,
         enabled = excluded.enabled`,
      [userId, 'test-server', 'sse', '{"url":"http://test"}', 0, now]
    );
    
    const server = dbManager.getFirst(
      'SELECT * FROM mcp_servers WHERE user_id = ? AND name = ?',
      [userId, 'test-server']
    );
    expect(server?.type).toBe('sse');
    expect(server?.enabled).toBe(0);
  });
});
