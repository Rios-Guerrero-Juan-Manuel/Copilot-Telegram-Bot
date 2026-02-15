import { AppConfig, config as defaultConfig } from '../config';
import { DatabaseManager } from './database';
import { MODEL_ID_VALUES, ProjectInfo } from '../types';
import Database from 'better-sqlite3';

interface UserRow {
  id: number;
  telegram_id: string;
  telegram_username: string | null;
  current_cwd: string | null;
  current_model: string | null;
  allowed_paths_configured: number;
  locale: string;
}

interface McpServerRow {
  name: string;
  type: string;
  config_json: string;
  enabled: number;
}

/**
 * Manages user state and preferences in the database
 */
export class UserState {
  private db;
  private dbManager: DatabaseManager;
  private config: AppConfig;
  private editingPlanIds: Map<number, number> = new Map(); // userId -> planId

  constructor(configOverrides?: AppConfig) {
    this.config = configOverrides ?? defaultConfig;
    const database = new DatabaseManager(this.config.DB_PATH);
    this.dbManager = database;
    this.db = database.db;
  }

  /**
   * Gets an existing user or creates a new one
   * 
   * @param telegramId - Telegram user ID
   * @param telegramUsername - Optional Telegram username
   * @returns User row from database
   */
  getOrCreate(telegramId: string, telegramUsername?: string): UserRow {
    const existing = this.db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegramId) as UserRow | undefined;
    if (existing) return existing;

    const now = new Date().toISOString();
    const defaultLocale = process.env.DEFAULT_LANGUAGE || 'en';
    const insert = this.db.prepare(
      `INSERT INTO users (telegram_id, telegram_username, current_cwd, current_model, allowed_paths_configured, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = insert.run(
      telegramId,
      telegramUsername ?? null,
      this.config.DEFAULT_PROJECT_PATH,
      this.config.COPILOT_DEFAULT_MODEL,
      0, // allowed_paths_configured defaults to 0 (not configured)
      defaultLocale,
      now
    );
    return {
      id: Number(result.lastInsertRowid),
      telegram_id: telegramId,
      telegram_username: telegramUsername ?? null,
      current_cwd: this.config.DEFAULT_PROJECT_PATH,
      current_model: this.config.COPILOT_DEFAULT_MODEL,
      allowed_paths_configured: 0,
      locale: defaultLocale,
    };
  }

  /**
   * Gets the current working directory for a user
   * 
   * @param userId - User ID
   * @returns Current working directory path
   */
  getCurrentCwd(userId: number): string {
    const row = this.db
      .prepare('SELECT current_cwd FROM users WHERE id = ?')
      .get(userId) as { current_cwd: string | null } | undefined;
    return row?.current_cwd ?? this.config.DEFAULT_PROJECT_PATH;
  }

  /**
   * Sets the current working directory for a user
   * 
   * @param userId - User ID
   * @param cwd - New working directory path
   */
  setCurrentCwd(userId: number, cwd: string): void {
    this.db
      .prepare('UPDATE users SET current_cwd = ? WHERE id = ?')
      .run(cwd, userId);
  }

  /**
   * Gets the current model preference for a user
   * 
   * @param userId - User ID
   * @returns Model ID
   */
  getCurrentModel(userId: number): string {
    const row = this.db
      .prepare('SELECT current_model FROM users WHERE id = ?')
      .get(userId) as { current_model: string | null } | undefined;
    const model = row?.current_model ?? this.config.COPILOT_DEFAULT_MODEL;
    return MODEL_ID_VALUES.includes(model as (typeof MODEL_ID_VALUES)[number])
      ? model
      : this.config.COPILOT_DEFAULT_MODEL;
  }

  /**
   * Sets the current model preference for a user
   * 
   * @param userId - User ID
   * @param model - Model ID
   */
  setCurrentModel(userId: number, model: string): void {
    const nextModel = MODEL_ID_VALUES.includes(model as (typeof MODEL_ID_VALUES)[number])
      ? model
      : this.config.COPILOT_DEFAULT_MODEL;
    this.db
      .prepare('UPDATE users SET current_model = ? WHERE id = ?')
      .run(nextModel, userId);
  }

  /**
   * Adds or updates a project for a user
   * 
   * @param userId - User ID
   * @param name - Project name
   * @param projectPath - Absolute path to project directory
   */
  addProject(userId: number, name: string, projectPath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projects (user_id, name, path, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(userId, name, projectPath, now);
  }

  /**
   * Removes a saved project for a user
   * 
   * @param userId - User's ID
   * @param name - Project name to remove
   * @returns true if project was removed, false if not found
   */
  removeProject(userId: number, name: string): boolean {
    const result = this.db
      .prepare('DELETE FROM projects WHERE user_id = ? AND name = ?')
      .run(userId, name);
    return result.changes > 0;
  }

  /**
   * Lists all saved projects for a user
   * 
   * @param userId - User's ID
   * @returns Array of project info (name and path)
   */
  listProjects(userId: number): ProjectInfo[] {
    const rows = this.db
      .prepare('SELECT name, path FROM projects WHERE user_id = ? ORDER BY name')
      .all(userId) as Array<{ name: string; path: string }>;
    return rows.map((row) => ({ name: row.name, path: row.path }));
  }

  /**
   * Gets the filesystem path for a saved project
   * 
   * @param userId - User's ID
   * @param name - Project name
   * @returns Project path if found, null otherwise
   */
  getProjectPath(userId: number, name: string): string | null {
    const row = this.db
      .prepare('SELECT path FROM projects WHERE user_id = ? AND name = ?')
      .get(userId, name) as { path: string } | undefined;
    return row?.path ?? null;
  }

  /**
   * Lists all MCP server configurations for a user
   * 
   * @param userId - User's ID
   * @returns Array of MCP server configurations with name, type, config, and enabled status
   */
  listMcpServers(userId: number): Array<{
    name: string;
    type: string;
    config: any;
    enabled: boolean;
  }> {
    const rows = this.db
      .prepare(
        'SELECT name, type, config_json, enabled FROM mcp_servers WHERE user_id = ? ORDER BY name'
      )
      .all(userId) as McpServerRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      config: JSON.parse(row.config_json),
      enabled: row.enabled === 1,
    }));
  }

  /**
   * Creates or updates an MCP server configuration
   * 
   * If a server with the same name exists, updates it. Otherwise creates a new one.
   * 
   * @param userId - User's ID
   * @param name - Server name
   * @param type - Server type ('stdio' or 'http')
   * @param config - MCP server configuration object
   * @param enabled - Whether the server is enabled
   */
  upsertMcpServer(
    userId: number,
    name: string,
    type: string,
    config: any,
    enabled: boolean
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mcp_servers (user_id, name, type, config_json, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, name) DO UPDATE SET
           type = excluded.type,
           config_json = excluded.config_json,
           enabled = excluded.enabled`
      )
      .run(userId, name, type, JSON.stringify(config), enabled ? 1 : 0, now);
  }

  /**
   * Enables or disables an MCP server
   * 
   * @param userId - User's ID
   * @param name - Server name
   * @param enabled - true to enable, false to disable
   */
  setMcpServerEnabled(userId: number, name: string, enabled: boolean): void {
    this.db
      .prepare(
        'UPDATE mcp_servers SET enabled = ? WHERE user_id = ? AND name = ?'
      )
      .run(enabled ? 1 : 0, userId, name);
  }

  /**
   * Removes an MCP server configuration
   * 
   * @param userId - User's ID
   * @param name - Server name to remove
   * @returns true if server was removed, false if not found
   */
  removeMcpServer(userId: number, name: string): boolean {
    const result = this.db
      .prepare('DELETE FROM mcp_servers WHERE user_id = ? AND name = ?')
      .run(userId, name);
    return result.changes > 0;
  }

  /**
   * Checks if allowed paths have been configured for a user
   * 
   * @param userId - User's ID
   * @returns true if paths are configured, false otherwise
   */
  isAllowedPathsConfigured(userId: number): boolean {
    const row = this.db
      .prepare('SELECT allowed_paths_configured FROM users WHERE id = ?')
      .get(userId) as { allowed_paths_configured: number } | undefined;
    return row?.allowed_paths_configured === 1;
  }

  /**
   * Checks if allowed paths are configured by Telegram ID
   * 
   * @param telegramId - Telegram user ID
   * @returns true if paths are configured, false otherwise
   */
  isAllowedPathsConfiguredByTelegramId(telegramId: number): boolean {
    const row = this.db
      .prepare('SELECT allowed_paths_configured FROM users WHERE telegram_id = ?')
      .get(String(telegramId)) as { allowed_paths_configured: number } | undefined;
    return row?.allowed_paths_configured === 1;
  }

  /**
   * Marks allowed paths as configured for a user
   * 
   * @param userId - User's ID
   */
  markAllowedPathsConfigured(userId: number): void {
    this.db
      .prepare('UPDATE users SET allowed_paths_configured = 1 WHERE id = ?')
      .run(userId);
  }

  /**
   * Marks allowed paths as configured by Telegram ID
   * 
   * @param telegramId - Telegram user ID
   */
  markAllowedPathsConfiguredByTelegramId(telegramId: number): void {
    this.db
      .prepare('UPDATE users SET allowed_paths_configured = 1 WHERE telegram_id = ?')
      .run(String(telegramId));
  }

  /**
   * Gets the locale preference for a user
   * 
   * @param userId - User ID
   * @returns Locale code (e.g., 'en', 'es')
   */
  getLocale(userId: number): string {
    const row = this.db
      .prepare('SELECT locale FROM users WHERE id = ?')
      .get(userId) as { locale: string } | undefined;
    return row?.locale || process.env.DEFAULT_LANGUAGE || 'en';
  }

  /**
   * Sets the locale preference for a user
   * 
   * @param userId - User ID
   * @param locale - Locale code (e.g., 'en', 'es')
   */
  setLocale(userId: number, locale: string): void {
    this.db
      .prepare('UPDATE users SET locale = ? WHERE id = ?')
      .run(locale, userId);
  }

  /**
   * Gets the database instance for graceful shutdown
   * 
   * @returns The better-sqlite3 database instance
   * @internal Used by graceful shutdown to close database connection
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Gets the database manager instance
   */
  getDatabaseManager(): DatabaseManager {
    return this.dbManager;
  }

  /**
   * Sets the plan ID that a user is currently editing
   * 
   * @param userId - User ID
   * @param planId - Plan ID being edited
   */
  setEditingPlanId(userId: number, planId: number): void {
    this.editingPlanIds.set(userId, planId);
  }

  /**
   * Gets the plan ID that a user is currently editing
   * 
   * @param userId - User ID
   * @returns Plan ID being edited, or null if not editing
   */
  getEditingPlanId(userId: number): number | null {
    return this.editingPlanIds.get(userId) ?? null;
  }

  /**
   * Clears the editing state for a user
   * 
   * @param userId - User ID
   */
  clearEditingPlanId(userId: number): void {
    this.editingPlanIds.delete(userId);
  }
}
