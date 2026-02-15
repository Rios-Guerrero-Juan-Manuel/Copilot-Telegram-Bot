import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { Bot } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123456',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '5',
  LOG_DIR: './test-logs',
};

describe('/logs command', () => {
  let testLogDir: string;
  let testLogFile: string;

  beforeEach(async () => {
    vi.resetModules();
    Object.assign(process.env, baseEnv);

    // Create test log directory and file
    testLogDir = path.resolve('./test-logs');
    testLogFile = path.join(testLogDir, 'combined.log');
    
    // Ensure directory exists
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }

    // Create test log content
    const logLines = [
      '2026-02-11 10:00:00 [info]: Test log line 1',
      '2026-02-11 10:01:00 [info]: Test log line 2',
      '2026-02-11 10:02:00 [error]: Test error line',
      '2026-02-11 10:03:00 [info]: Test log line 4',
      '2026-02-11 10:04:00 [info]: Test log line 5',
    ];
    
    await fs.promises.writeFile(testLogFile, logLines.join('\n'), 'utf-8');
  });

  afterEach(async () => {
    // Clean up test log files
    if (fs.existsSync(testLogFile)) {
      await fs.promises.unlink(testLogFile);
    }
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should deny access to non-owner users', async () => {
    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    const ctx = {
      from: { id: 999999, username: 'unauthorized' },
      match: '',
      reply: vi.fn(),
    } as any;

    // Mock the bot's command method to capture the handler
    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    // Re-register to capture handler
    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    // Execute the handler
    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("don't have permission"));
  });

  it('should allow owner to view logs with default 50 lines', async () => {
    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' }, // Matches TELEGRAM_CHAT_ID
      match: '',
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0];
    expect(replyCall[0]).toContain('Last'); // Now uses English locale
    expect(replyCall[0]).toContain('lines');
    expect(replyCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should accept custom line count parameter', async () => {
    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' },
      match: '3', // Request 3 lines
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0];
    expect(replyCall[0]).toContain('Last 3 lines'); // Now uses English locale
  });

  it('should format logs with HTML code tags', async () => {
    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' },
      match: '2',
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0];
    expect(replyCall[0]).toContain('<code>');
    expect(replyCall[0]).toContain('</code>');
    expect(replyCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should handle missing log file gracefully', async () => {
    // Delete the log file
    if (fs.existsSync(testLogFile)) {
      await fs.promises.unlink(testLogFile);
    }

    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' },
      match: '',
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Error reading'));
  });

  it('should return correct number of last lines', async () => {
    // Create a log file with 100 lines
    const manyLines = Array.from({ length: 100 }, (_, i) => 
      `2026-02-11 10:${String(i).padStart(2, '0')}:00 [info]: Log line ${i + 1}`
    );
    await fs.promises.writeFile(testLogFile, manyLines.join('\n'), 'utf-8');

    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' },
      match: '10', // Request last 10 lines
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0];
    const message = replyCall[0];
    
    // Should contain line 91 through 100
    expect(message).toContain('Log line 91');
    expect(message).toContain('Log line 100');
    expect(message).not.toContain('Log line 90');
  });

  it('should handle invalid line count parameter', async () => {
    const { registerInfoCommands } = await import('../src/bot/commands-info');
    
    const bot = new Bot('fake-token');
    const sessionManager = {} as any;
    const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
    const mcpRegistry = {} as any;
    const allowlistWizard = {} as any;

    const ctx = {
      from: { id: 123456, username: 'owner' },
      match: 'invalid', // Invalid number
      reply: vi.fn(),
    } as any;

    let logsHandler: any;
    const originalCommand = bot.command.bind(bot);
    bot.command = vi.fn((command: string, handler: any) => {
      if (command === 'logs') {
        logsHandler = handler;
      }
      return originalCommand(command, handler);
    }) as any;

    registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

    if (logsHandler) {
      await logsHandler(ctx);
    }

    // Should default to NaN which becomes 50 or handle gracefully
    expect(ctx.reply).toHaveBeenCalled();
  });

  // NEW TESTS FOR ESM COMPATIBILITY AND LOG ROTATION
  describe('ESM compatibility and log rotation', () => {
    it('should find and read rotated log file (combined-YYYY-MM-DD.log)', async () => {
      // Create a rotated log file with today's date
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const rotatedFileName = `combined-${year}-${month}-${day}.log`;
      const rotatedLogFile = path.join(testLogDir, rotatedFileName);

      const logLines = [
        '2026-02-12 10:00:00 [info]: Rotated log line 1',
        '2026-02-12 10:01:00 [info]: Rotated log line 2',
        '2026-02-12 10:02:00 [error]: Rotated error line',
      ];
      
      await fs.promises.writeFile(rotatedLogFile, logLines.join('\n'), 'utf-8');

      const { registerInfoCommands } = await import('../src/bot/commands-info');
      
      const bot = new Bot('fake-token');
      const sessionManager = {} as any;
      const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
      const mcpRegistry = {} as any;
      const allowlistWizard = {} as any;

      const ctx = {
        from: { id: 123456, username: 'owner' },
        match: '2',
        reply: vi.fn(),
      } as any;

      let logsHandler: any;
      const originalCommand = bot.command.bind(bot);
      bot.command = vi.fn((command: string, handler: any) => {
        if (command === 'logs') {
          logsHandler = handler;
        }
        return originalCommand(command, handler);
      }) as any;

      registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

      if (logsHandler) {
        await logsHandler(ctx);
      }

      expect(ctx.reply).toHaveBeenCalled();
      const replyCall = ctx.reply.mock.calls[0];
      expect(replyCall[0]).toContain('Rotated log line 2');
      expect(replyCall[0]).toContain('Rotated error line');

      // Cleanup
      await fs.promises.unlink(rotatedLogFile);
    });

    it('should prefer most recent rotated log file when multiple exist', async () => {
      // Create multiple rotated log files
      const files = [
        { name: 'combined-2026-02-10.log', content: 'Old log content' },
        { name: 'combined-2026-02-11.log', content: 'Older log content' },
        { name: 'combined-2026-02-12.log', content: 'Latest log content' },
      ];

      for (const file of files) {
        await fs.promises.writeFile(
          path.join(testLogDir, file.name),
          file.content,
          'utf-8'
        );
      }

      const { registerInfoCommands } = await import('../src/bot/commands-info');
      
      const bot = new Bot('fake-token');
      const sessionManager = {} as any;
      const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
      const mcpRegistry = {} as any;
      const allowlistWizard = {} as any;

      const ctx = {
        from: { id: 123456, username: 'owner' },
        match: '1',
        reply: vi.fn(),
      } as any;

      let logsHandler: any;
      const originalCommand = bot.command.bind(bot);
      bot.command = vi.fn((command: string, handler: any) => {
        if (command === 'logs') {
          logsHandler = handler;
        }
        return originalCommand(command, handler);
      }) as any;

      registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

      if (logsHandler) {
        await logsHandler(ctx);
      }

      expect(ctx.reply).toHaveBeenCalled();
      const replyCall = ctx.reply.mock.calls[0];
      // Should read the most recent file (2026-02-12)
      expect(replyCall[0]).toContain('Latest log content');
      expect(replyCall[0]).not.toContain('Old log content');

      // Cleanup
      for (const file of files) {
        await fs.promises.unlink(path.join(testLogDir, file.name));
      }
    });

    it('should fallback to combined.log if no rotated files exist', async () => {
      // Only create the static combined.log file
      const staticLogFile = path.join(testLogDir, 'combined.log');
      await fs.promises.writeFile(
        staticLogFile,
        'Static combined.log content',
        'utf-8'
      );

      const { registerInfoCommands } = await import('../src/bot/commands-info');
      
      const bot = new Bot('fake-token');
      const sessionManager = {} as any;
      const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
      const mcpRegistry = {} as any;
      const allowlistWizard = {} as any;

      const ctx = {
        from: { id: 123456, username: 'owner' },
        match: '1',
        reply: vi.fn(),
      } as any;

      let logsHandler: any;
      const originalCommand = bot.command.bind(bot);
      bot.command = vi.fn((command: string, handler: any) => {
        if (command === 'logs') {
          logsHandler = handler;
        }
        return originalCommand(command, handler);
      }) as any;

      registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

      if (logsHandler) {
        await logsHandler(ctx);
      }

      expect(ctx.reply).toHaveBeenCalled();
      const replyCall = ctx.reply.mock.calls[0];
      expect(replyCall[0]).toContain('Static combined.log content');

      // Cleanup
      await fs.promises.unlink(staticLogFile);
    });

    it('should use config.LOG_DIR instead of __dirname (ESM compatibility)', async () => {
      // This test verifies that the implementation doesn't use __dirname
      // We check this indirectly by ensuring it works with LOG_DIR from config
      
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const rotatedFileName = `combined-${year}-${month}-${day}.log`;
      const rotatedLogFile = path.join(testLogDir, rotatedFileName);

      await fs.promises.writeFile(
        rotatedLogFile,
        'ESM compatible log content',
        'utf-8'
      );

      const { registerInfoCommands } = await import('../src/bot/commands-info');
      
      const bot = new Bot('fake-token');
      const sessionManager = {} as any;
      const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
      const mcpRegistry = {} as any;
      const allowlistWizard = {} as any;

      const ctx = {
        from: { id: 123456, username: 'owner' },
        match: '1',
        reply: vi.fn(),
      } as any;

      let logsHandler: any;
      const originalCommand = bot.command.bind(bot);
      bot.command = vi.fn((command: string, handler: any) => {
        if (command === 'logs') {
          logsHandler = handler;
        }
        return originalCommand(command, handler);
      }) as any;

      registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

      if (logsHandler) {
        await logsHandler(ctx);
      }

      // If it works, it means it's using config.LOG_DIR correctly (ESM compatible)
      expect(ctx.reply).toHaveBeenCalled();
      const replyCall = ctx.reply.mock.calls[0];
      expect(replyCall[0]).toContain('ESM compatible log content');

      // Cleanup
      await fs.promises.unlink(rotatedLogFile);
    });

    it('should handle empty log directory gracefully', async () => {
      // Clear all log files
      const files = await fs.promises.readdir(testLogDir);
      for (const file of files) {
        await fs.promises.unlink(path.join(testLogDir, file));
      }

      const { registerInfoCommands } = await import('../src/bot/commands-info');
      
      const bot = new Bot('fake-token');
      const sessionManager = {} as any;
      const userState = { getOrCreate: vi.fn(() => ({ id: 'test', telegramId: '123456' })) } as any;
      const mcpRegistry = {} as any;
      const allowlistWizard = {} as any;

      const ctx = {
        from: { id: 123456, username: 'owner' },
        match: '',
        reply: vi.fn(),
      } as any;

      let logsHandler: any;
      const originalCommand = bot.command.bind(bot);
      bot.command = vi.fn((command: string, handler: any) => {
        if (command === 'logs') {
          logsHandler = handler;
        }
        return originalCommand(command, handler);
      }) as any;

      registerInfoCommands(bot, sessionManager, userState, mcpRegistry, allowlistWizard);

      if (logsHandler) {
        await logsHandler(ctx);
      }

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Error reading'));
    });
  });
});
