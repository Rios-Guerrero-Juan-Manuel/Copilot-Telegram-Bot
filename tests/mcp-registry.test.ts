import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('McpRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads servers from config file and toggles', async () => {
    const configPath = path.join(os.tmpdir(), `mcp-${Date.now()}.json`);
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            github: { type: 'http', url: 'https://example.com', tools: ['*'] },
          },
        },
        null,
        2
      )
    );

    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '123',
      DEFAULT_PROJECT_PATH: 'C:\\temp',
      ALLOWED_PATHS: 'C:\\temp',
      DB_PATH: ':memory:',
      COPILOT_MCP_CONFIG_PATH: configPath,
    });

    const { UserState } = await import('../src/state/user-state');
    const { config } = await import('../src/config');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');

    const userState = new UserState(config);
    const user = userState.getOrCreate('123');
    const registry = new McpRegistry(userState, user.id);
    await registry.loadAsync();

    expect(registry.list().length).toBe(1);
    registry.disable('github');
    expect(Object.keys(registry.getEnabled()).length).toBe(0);
  });

  it('public load() method reloads servers from database', async () => {
    const configPath = path.join(os.tmpdir(), `mcp-load-${Date.now()}.json`);
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            server1: {
              command: 'node',
              args: ['server1.js'],
            },
          },
        },
        null,
        2
      )
    );

    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '123',
      DEFAULT_PROJECT_PATH: 'C:\\temp',
      ALLOWED_PATHS: 'C:\\temp',
      DB_PATH: ':memory:',
      COPILOT_MCP_CONFIG_PATH: configPath,
    });

    const { UserState } = await import('../src/state/user-state');
    const { config } = await import('../src/config');
    const { McpRegistry } = await import('../src/mcp/mcp-registry');

    const userState = new UserState(config);
    const user = userState.getOrCreate('123');
    const registry = new McpRegistry(userState, user.id);
    await registry.loadAsync();

    // Initial state should have 1 server from constructor
    expect(registry.list().length).toBe(1);

    // Add a new server directly to DB (simulating external modification)
    userState.upsertMcpServer(
      user.id,
      'server2',
      'stdio',
      {
        command: 'node',
        args: ['server2.js'],
      },
      true
    );

    // Before calling load(), registry should still show only 1 server
    expect(registry.list().length).toBe(1);

    // Call load() to refresh from DB
    registry.load();

    // After calling load(), registry should show 2 servers
    expect(registry.list().length).toBe(2);

    const serverNames = registry.list().map((s) => s.name);
    expect(serverNames).toContain('server1');
    expect(serverNames).toContain('server2');
  });
});
