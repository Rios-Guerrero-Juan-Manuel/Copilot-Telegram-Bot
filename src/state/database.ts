import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { SqliteColumnInfo } from '../types/database.js';
import type { ErrorWithMessage } from '../types/errors.js';

export type PlanStatus =
  | 'draft'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export interface PlanRecord {
  id: number;
  user_id: number;
  project_path: string;
  title: string;
  content: string;
  status: PlanStatus;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

/**
 * Manager for the SQLite database used for persistent user state
 * 
 * Handles database initialization, migrations, and provides a wrapper
 * around better-sqlite3 for type-safe database operations.
 * 
 * Features:
 * - Automatic directory creation for database file
 * - WAL mode for better concurrency
 * - Schema migrations with proper error handling
 * 
 * @example
 * const dbManager = await DatabaseManager.create('./data/state.db');
 * const user = dbManager.getFirst('SELECT * FROM users WHERE id = ?', [userId]);
 */
export class DatabaseManager {
  readonly db: Database.Database;

  /**
   * Creates a new DatabaseManager instance asynchronously
   * 
   * @param dbPath - Path to the SQLite database file or ':memory:' for in-memory DB
   * @returns DatabaseManager instance
   */
  static async create(dbPath: string): Promise<DatabaseManager> {
    return new DatabaseManager(dbPath);
  }

  /**
   * Initializes the database connection and runs migrations
   * 
   * Creates the database directory if needed, enables WAL mode for better
   * concurrency, and runs schema migrations.
   * 
   * @param dbPath - Path to the SQLite database file or ':memory:' for in-memory DB
   */
  constructor(dbPath: string) {
    if (dbPath === ':memory:') {
      this.db = new Database(':memory:');
    } else {
      const resolvedPath = path.resolve(dbPath);
      const dir = path.dirname(resolvedPath);
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(resolvedPath);
    }
    this.db.pragma('foreign_keys = OFF');
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  /**
   * Runs database schema migrations
   * 
   * Creates tables and adds columns for schema changes.
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL UNIQUE,
        telegram_username TEXT,
        current_cwd TEXT,
        current_model TEXT,
        allowed_paths_configured INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, name),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, name),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        closed_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        project_path TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        approved_at TEXT,
        completed_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_plans_user_project ON plans(user_id, project_path);
      CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans(user_id, status);
    `);

    try {
      const cols = this.db.pragma('table_info(users)') as SqliteColumnInfo[];
      const hasAllowedPathsColumn = cols.some((col) => col.name === 'allowed_paths_configured');
      const hasLocaleColumn = cols.some((col) => col.name === 'locale');
      
      if (!hasAllowedPathsColumn) {
        this.db.exec(`
          ALTER TABLE users ADD COLUMN allowed_paths_configured INTEGER NOT NULL DEFAULT 0;
        `);
      }

      if (!hasLocaleColumn) {
        this.db.exec(`
          ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
        `);
      }
    } catch (error: unknown) {
      const err = error as Partial<ErrorWithMessage>;
      if (!err.message?.includes('duplicate column name')) {
        throw error;
      }
    }
  }

  /**
   * Executes a SQL query and returns results with columns and values
   * 
   * @param sql - SQL query to execute
   * @param params - Optional query parameters
   * @returns Array containing columns and values
   */
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }> {
    const statement = this.db.prepare(sql);
    const rows = ((!params || params.length === 0)
      ? statement.all()
      : statement.all(...(params as any[]))) as Record<string, unknown>[];
    const columns = statement.columns().map((col) => col.name);
    const values = rows.map((row) => columns.map((col) => row[col]));
    return [{ columns, values }];
  }

  /**
   * Runs a SQL statement (INSERT, UPDATE, DELETE)
   * 
   * @param sql - SQL statement to run
   * @param params - Optional statement parameters
   * @returns Result with changes count and last inserted row ID
   */
  run(sql: string, params?: unknown[]): Database.RunResult {
    if (!params || params.length === 0) {
      return this.db.prepare(sql).run();
    }
    return this.db.prepare(sql).run(...(params as any[]));
  }

  /**
   * Gets the first row from a query result
   * 
   * @param sql - SQL query
   * @param params - Optional query parameters
   * @returns First row as object or undefined if no results
   */
  getFirst(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
    if (!params || params.length === 0) {
      return this.db.prepare(sql).get() as Record<string, unknown> | undefined;
    }
    return this.db.prepare(sql).get(...(params as any[])) as Record<string, unknown> | undefined;
  }

  /**
   * Gets all rows from a query result
   * 
   * @param sql - SQL query
   * @param params - Optional query parameters
   * @returns Array of rows as objects
   */
  getAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
    if (!params || params.length === 0) {
      return this.db.prepare(sql).all() as Record<string, unknown>[];
    }
    return this.db.prepare(sql).all(...(params as any[])) as Record<string, unknown>[];
  }

  /**
   * Closes the database connection
   * 
   * Should be called during application shutdown to ensure clean closure.
   */
  close(): void {
    this.db.close();
  }

  // ==================== Plan Management Methods ====================

  /**
   * Saves a new plan to the database
   * 
   * @param userId - User ID
   * @param projectPath - Project path
   * @param title - Plan title
   * @param content - Plan content in markdown
   * @returns Inserted plan ID
   */
  savePlan(userId: number, projectPath: string, title: string, content: string): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO plans (user_id, project_path, title, content, status, created_at)
         VALUES (?, ?, ?, ?, 'draft', ?)`
      )
      .run(userId, projectPath, title, content, now);
    return Number(result.lastInsertRowid);
  }

  /**
   * Gets a plan by ID
   * 
   * @param planId - Plan ID
   * @returns Plan row or undefined if not found
   */
  getPlan(planId: number): PlanRecord | undefined {
    return this.db
      .prepare('SELECT * FROM plans WHERE id = ?')
      .get(planId) as PlanRecord | undefined;
  }

  /**
   * Gets the current active plan for a user and project
   * 
   * @param userId - User ID
   * @param projectPath - Project path
   * @returns Most recent plan that's not completed or cancelled, or undefined
   */
  getCurrentPlan(userId: number, projectPath: string): PlanRecord | undefined {
    return this.db
      .prepare(
        `SELECT * FROM plans 
         WHERE user_id = ? AND project_path = ? 
         AND status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(userId, projectPath) as PlanRecord | undefined;
  }

  /**
   * Updates the status of a plan
   * 
   * @param planId - Plan ID
   * @param status - New status
   */
  updatePlanStatus(planId: number, status: string): void {
    const now = new Date().toISOString();
    const updates: Record<string, string> = { updated_at: now };
    
    if (status === 'approved') {
      updates.approved_at = now;
    } else if (status === 'completed') {
      updates.completed_at = now;
    }

    const setClauses = ['status = ?', 'updated_at = ?'];
    const values: (string | number)[] = [status, now];

    if (updates.approved_at) {
      setClauses.push('approved_at = ?');
      values.push(updates.approved_at);
    }
    if (updates.completed_at) {
      setClauses.push('completed_at = ?');
      values.push(updates.completed_at);
    }

    values.push(planId);

    this.db
      .prepare(`UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  /**
   * Updates the content of a plan
   * 
   * @param planId - Plan ID
   * @param content - New content
   */
  updatePlanContent(planId: number, content: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE plans SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, now, planId);
    return result.changes > 0;
  }

  /**
   * Gets all plans for a user
   * 
   * @param userId - User ID
   * @param limit - Maximum number of plans to return (default: 10)
   * @returns Array of plan rows
   */
  getUserPlans(userId: number, limit: number = 10): PlanRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM plans 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
      )
      .all(userId, limit) as PlanRecord[];
  }

  /**
   * Deletes a plan
   * 
   * @param planId - Plan ID
   */
  deletePlan(planId: number): void {
    this.db.prepare('DELETE FROM plans WHERE id = ?').run(planId);
  }
}
