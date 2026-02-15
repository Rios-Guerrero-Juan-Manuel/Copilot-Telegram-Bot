import { promises as fs } from 'fs';
import * as path from 'path';
import { MCPServerConfig } from '@github/copilot-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { UserState } from '../state/user-state';

interface McpServerEntry {
  name: string;
  config: MCPServerConfig;
  enabled: boolean;
}

/**
 * Registry for managing Model Context Protocol (MCP) server configurations
 * 
 * Provides centralized management of MCP servers, supporting both stdio and
 * HTTP server types. Server configurations are persisted to the database and
 * can be loaded from a JSON configuration file.
 * 
 * @example
 * const registry = new McpRegistry(userState, userId);
 * await registry.loadAsync();
 * const enabled = registry.getEnabled();
 */
export class McpRegistry {
  private servers = new Map<string, McpServerEntry>();
  private configPath: string;

  constructor(private userState: UserState, private userId: number = 1) {
    this.configPath = config.COPILOT_MCP_CONFIG_PATH;
    this.loadFromDb();
  }

  /**
   * Load servers from database synchronously
   */
  private loadFromDb(): void {
    const stored = this.userState.listMcpServers(this.userId);
    stored.forEach((entry) => {
      this.servers.set(entry.name, {
        name: entry.name,
        config: entry.config as MCPServerConfig,
        enabled: entry.enabled,
      });
    });
  }

  /**
   * Reloads servers from database
   * 
   * Clears current servers and reloads from DB.
   */
  load(): void {
    this.servers.clear();
    this.loadFromDb();
  }

  /**
   * Load servers from file asynchronously
   * 
   * Populates registry from config file if database is empty.
   * 
   * @returns Promise that resolves when loading is complete
   */
  async loadAsync(): Promise<void> {
    if (this.servers.size > 0) {
      return;
    }

    const fromFile = await this.readConfigFileAsync();
    for (const [name, entry] of Object.entries(fromFile)) {
      this.servers.set(name, { name, config: entry, enabled: true });
      const type = 'command' in entry ? 'stdio' : 'http';
      this.userState.upsertMcpServer(this.userId, name, type, entry, true);
    }
  }

  /**
   * Reloads servers from the configuration file
   * 
   * Merges servers from the config file into the registry. Only adds
   * servers that don't already exist in the database.
   * 
   * @returns Promise that resolves when reloading is complete
   */
  async reloadFromFileAsync(): Promise<void> {
    const fromFile = await this.readConfigFileAsync();
    for (const [name, entry] of Object.entries(fromFile)) {
      if (!this.servers.has(name)) {
        this.servers.set(name, { name, config: entry, enabled: true });
        const type = 'command' in entry ? 'stdio' : 'http';
        this.userState.upsertMcpServer(
          this.userId,
          name,
          type,
          entry,
          true
        );
      }
    }
  }

  /**
   * Reads MCP server configuration from the JSON config file
   * 
   * @returns Record of server configurations keyed by server name
   */
  private async readConfigFileAsync(): Promise<Record<string, MCPServerConfig>> {
    try {
      await fs.access(this.configPath);
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
      return raw.mcpServers || {};
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {};
      }
      logger.error('Error cargando MCP config', { error });
      return {};
    }
  }

  /**
   * Gets all enabled MCP server configurations
   * 
   * @returns Record of enabled server configurations for use with Copilot SDK
   */
  getEnabled(): Record<string, MCPServerConfig> {
    const enabled: Record<string, MCPServerConfig> = {};
    for (const entry of this.servers.values()) {
      if (entry.enabled) {
        enabled[entry.name] = entry.config;
      }
    }
    return enabled;
  }

  /**
   * Lists all registered MCP servers with type and enabled status
   * 
   * @returns Array of server metadata (name, type, enabled)
   */
  list(): Array<{ name: string; type: string; enabled: boolean }> {
    return [...this.servers.values()].map((entry) => ({
      name: entry.name,
      type: 'command' in entry.config ? 'stdio' : 'http',
      enabled: entry.enabled,
    }));
  }

  /**
   * Enables an MCP server by name
   * 
   * @param name - Server name to enable
   * @returns true if server was enabled, false if server not found
   */
  enable(name: string): boolean {
    const entry = this.servers.get(name);
    if (!entry) return false;
    entry.enabled = true;
    this.userState.setMcpServerEnabled(this.userId, name, true);
    logger.info('MCP server enabled', {
      userId: this.userId,
      serverName: name,
    });
    return true;
  }

  /**
   * Disables an MCP server by name
   * 
   * @param name - Server name to disable
   * @returns true if server was disabled, false if server not found
   */
  disable(name: string): boolean {
    const entry = this.servers.get(name);
    if (!entry) return false;
    entry.enabled = false;
    this.userState.setMcpServerEnabled(this.userId, name, false);
    logger.info('MCP server disabled', {
      userId: this.userId,
      serverName: name,
    });
    return true;
  }

  /**
   * Adds a new MCP server to the registry
   * 
   * Persists the server configuration to the database.
   * 
   * @param name - Unique server name
   * @param configEntry - MCP server configuration (stdio or HTTP)
   */
  add(name: string, configEntry: MCPServerConfig): void {
    this.servers.set(name, { name, config: configEntry, enabled: true });
    const type = 'command' in configEntry ? 'stdio' : 'http';
    this.userState.upsertMcpServer(
      this.userId,
      name,
      type,
      configEntry,
      true
    );
    logger.info('MCP server added', {
      userId: this.userId,
      serverName: name,
      serverType: type,
    });
  }

  /**
   * Removes an MCP server from the registry
   * 
   * Deletes the server configuration from both memory and database.
   * 
   * @param name - Server name to remove
   * @returns true if server was removed, false if server not found
   */
  remove(name: string): boolean {
    const removed = this.servers.delete(name);
    if (removed) {
      this.userState.removeMcpServer(this.userId, name);
      logger.info('MCP server removed', {
        userId: this.userId,
        serverName: name,
      });
    }
    return removed;
  }
}
