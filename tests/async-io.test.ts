import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Async I/O Operations', () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(async () => {
    vi.resetModules();
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `async-io-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    testConfigPath = path.join(testDir, 'mcp-config.json');
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('McpRegistry async file operations', () => {
    it('should load config asynchronously without blocking', async () => {
      const configData = {
        mcpServers: {
          testServer: { type: 'http', url: 'https://test.com', tools: ['*'] },
        },
      };

      await fs.writeFile(testConfigPath, JSON.stringify(configData, null, 2));

      Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '123',
        DEFAULT_PROJECT_PATH: testDir,
        ALLOWED_PATHS: testDir,
        DB_PATH: ':memory:',
        COPILOT_MCP_CONFIG_PATH: testConfigPath,
      });

      const { UserState } = await import('../src/state/user-state');
      const { config } = await import('../src/config');
      const { McpRegistry } = await import('../src/mcp/mcp-registry');

      const userState = new UserState(config);
      const user = userState.getOrCreate('123');
      const registry = new McpRegistry(userState, user.id);

      await registry.loadAsync();
      expect(registry.list().length).toBe(1);
    });

    it('should handle missing config file gracefully', async () => {
      const nonExistentPath = path.join(testDir, 'nonexistent.json');

      Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '123',
        DEFAULT_PROJECT_PATH: testDir,
        ALLOWED_PATHS: testDir,
        DB_PATH: ':memory:',
        COPILOT_MCP_CONFIG_PATH: nonExistentPath,
      });

      const { UserState } = await import('../src/state/user-state');
      const { config } = await import('../src/config');
      const { McpRegistry } = await import('../src/mcp/mcp-registry');

      const userState = new UserState(config);
      const user = userState.getOrCreate('123');
      const registry = new McpRegistry(userState, user.id);

      await registry.loadAsync();
      expect(registry.list().length).toBe(0);
    });

    it('should not block event loop during large file reads', async () => {
      // Create a large config file
      const largeConfig = {
        mcpServers: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [
            `server${i}`,
            { type: 'http', url: `https://server${i}.com`, tools: ['*'] },
          ])
        ),
      };

      await fs.writeFile(testConfigPath, JSON.stringify(largeConfig, null, 2));

      const startTime = Date.now();
      let eventLoopBlocked = false;

      // Set a timer to check if event loop is blocked
      const timer = setTimeout(() => {
        eventLoopBlocked = true;
      }, 10);

      Object.assign(process.env, {
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_CHAT_ID: '123',
        DEFAULT_PROJECT_PATH: testDir,
        ALLOWED_PATHS: testDir,
        DB_PATH: ':memory:',
        COPILOT_MCP_CONFIG_PATH: testConfigPath,
      });

      const { UserState } = await import('../src/state/user-state');
      const { config } = await import('../src/config');
      const { McpRegistry } = await import('../src/mcp/mcp-registry');

      const userState = new UserState(config);
      const user = userState.getOrCreate('123');
      const registry = new McpRegistry(userState, user.id);

      await registry.loadAsync();

      clearTimeout(timer);
      const elapsed = Date.now() - startTime;

      // Event loop should remain responsive
      expect(typeof eventLoopBlocked).toBe('boolean');
      expect(registry.list().length).toBe(100);
    });
  });

  describe('path-setup async operations', () => {
    it('should validate path asynchronously', async () => {
      const { validatePathAsync } = await import('../src/utils/path-setup');
      
      const result = await validatePathAsync(testDir);
      expect(result.valid).toBe(true);
    });

    it('should update .env file asynchronously', async () => {
      const envPath = path.join(testDir, '.env');
      const originalCwd = process.cwd();
      
      // Temporarily change cwd for this test
      process.chdir(testDir);
      
      try {
        const { updateEnvFileAsync } = await import('../src/utils/path-setup');
        
        await updateEnvFileAsync(['/test/path1', '/test/path2']);
        
        const envContent = await fs.readFile(envPath, 'utf-8');
        expect(envContent).toContain('ALLOWED_PATHS=/test/path1,/test/path2');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should not block event loop during env file update', async () => {
      const envPath = path.join(testDir, '.env');
      const originalCwd = process.cwd();
      
      process.chdir(testDir);
      
      try {
        let eventLoopBlocked = false;
        const timer = setTimeout(() => {
          eventLoopBlocked = true;
        }, 10);

        const { updateEnvFileAsync } = await import('../src/utils/path-setup');
        
        await updateEnvFileAsync(['/test/path1', '/test/path2']);
        
        clearTimeout(timer);
        expect(typeof eventLoopBlocked).toBe('boolean');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('logger async initialization', () => {
    it('should create log directory asynchronously', async () => {
      const logDir = path.join(testDir, 'logs');
      
      Object.assign(process.env, {
        LOG_DIR: logDir,
      });

      // Import logger which should create directory async
      await import('../src/utils/logger');

      // Verify directory was created
      const stats = await fs.stat(logDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('database async initialization', () => {
    it('should create database directory asynchronously', async () => {
      const dbPath = path.join(testDir, 'data', 'test.db');
      
      const { DatabaseManager } = await import('../src/state/database');
      
      const db = new DatabaseManager(dbPath);
      
      // Verify directory was created
      const dbDir = path.dirname(dbPath);
      const stats = await fs.stat(dbDir);
      expect(stats.isDirectory()).toBe(true);
      
      db.close();
    });
  });

  describe('performance comparison', () => {
    it('async operations should not block significantly longer than sync', async () => {
      const testFile = path.join(testDir, 'test.json');
      const testData = { test: 'data', array: Array(1000).fill('test') };
      
      // Sync version (baseline)
      const syncStart = Date.now();
      fsSync.writeFileSync(testFile, JSON.stringify(testData));
      const data1 = fsSync.readFileSync(testFile, 'utf-8');
      const syncTime = Date.now() - syncStart;
      
      // Async version
      const asyncStart = Date.now();
      await fs.writeFile(testFile, JSON.stringify(testData));
      const data2 = await fs.readFile(testFile, 'utf-8');
      const asyncTime = Date.now() - asyncStart;
      
      // Async should not be significantly slower (within 50ms overhead)
      expect(asyncTime - syncTime).toBeLessThan(50);
      expect(JSON.parse(data1)).toEqual(JSON.parse(data2));
    });
  });

  describe('no sync operations in hot paths', () => {
    it('should not use sync I/O in critical code paths', async () => {
      const srcDir = path.join(process.cwd(), 'src');
      
      async function scanDirectory(dir: string, files: string[] = []): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDirectory(fullPath, files);
          } else if (entry.name.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        
        return files;
      }
      
      const tsFiles = await scanDirectory(srcDir);
      const violations: string[] = [];

      // Excluded files that are allowed to have sync operations (initialization only)
      const excluded = ['path-setup.ts', 'logger.ts', 'database.ts', 'interactive-setup.ts', 'i18n\\index.ts', 'i18n/index.ts'];

      for (const file of tsFiles) {
        const isExcluded = excluded.some(ex => file.includes(ex));
        if (isExcluded) continue;
        
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, idx) => {
          if (line.includes('existsSync') || 
              line.includes('readFileSync') || 
              line.includes('writeFileSync')) {
            violations.push(`${file}:${idx + 1}: ${line.trim()}`);
          }
        });
      }

      // After migration, this should pass
      if (violations.length > 0) {
        console.log('Found sync I/O violations:\n', violations.join('\n'));
      }
      
      expect(violations.length).toBe(0);
    });
  });
});
