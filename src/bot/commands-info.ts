import { Bot } from 'grammy';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { AllowlistSetupWizard } from './allowlist-setup';
import { needsAllowlistSetup, config } from '../config';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { formatElapsedTime } from '../utils/time';
import { escapeHtml } from '../utils/formatter';
import { splitMessage } from '../utils/message-splitter';
import { i18n } from '../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';



/**
 * Registers information and help commands
 * @param bot - Grammy bot instance to register commands on
 * @param sessionManager - Manages Copilot sessions for all users
 * @param userState - User state management for persisting preferences
 * @param mcpRegistry - Registry for managing MCP server configurations
 * @param allowlistWizard - Wizard for allowlist setup when required
 */
export function registerInfoCommands(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  allowlistWizard: AllowlistSetupWizard
) {
  bot.command('start', async (ctx) => {
    const telegramIdStr = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return; // Safety check
    
    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);

    logger.info('Command received: /start', sanitizeForLogging({
      command: '/start',
      telegramId: telegramIdNum,
      username: ctx.from?.username,
    }));

    // Check if allowlist setup is needed and user hasn't configured it yet (use Telegram ID)
    if (needsAllowlistSetup && allowlistWizard.needsSetup(telegramIdNum)) {
      logger.info('Starting allowlist setup wizard for user', {
        telegramId: telegramIdNum,
        userId: user.id,
      });
      await allowlistWizard.startSetup(ctx);
      return;
    }

    const cwd = userState.getCurrentCwd(user.id);
    const model = userState.getCurrentModel(user.id);

    const message = i18n.t(user.id, 'commands.start.welcome', {
      cwd: escapeHtml(cwd),
      model: escapeHtml(model)
    });

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    const title = i18n.t(user.id, 'commands.help.title');
    const commands = [
      i18n.t(user.id, 'commands.help.commands.start'),
      i18n.t(user.id, 'commands.help.commands.help'),
      i18n.t(user.id, 'commands.help.commands.status'),
      i18n.t(user.id, 'commands.help.commands.logs'),
      i18n.t(user.id, 'commands.help.commands.pwd'),
      i18n.t(user.id, 'commands.help.commands.ls'),
      i18n.t(user.id, 'commands.help.commands.cd'),
      i18n.t(user.id, 'commands.help.commands.projects'),
      i18n.t(user.id, 'commands.help.commands.addproject'),
      i18n.t(user.id, 'commands.help.commands.rmproject'),
      i18n.t(user.id, 'commands.help.commands.switch'),
      i18n.t(user.id, 'commands.help.commands.allowpath'),
      i18n.t(user.id, 'commands.help.commands.plan'),
      i18n.t(user.id, 'commands.help.commands.showplan'),
      i18n.t(user.id, 'commands.help.commands.editplan'),
      i18n.t(user.id, 'commands.help.commands.exportplan'),
      i18n.t(user.id, 'commands.help.commands.plans'),
      i18n.t(user.id, 'commands.help.commands.exitplan'),
      i18n.t(user.id, 'commands.help.commands.model'),
      i18n.t(user.id, 'commands.help.commands.mcp'),
      i18n.t(user.id, 'commands.help.commands.mcp_add_sub'),
      i18n.t(user.id, 'commands.help.commands.mcp_remove'),
      i18n.t(user.id, 'commands.help.commands.mcp_enable'),
      i18n.t(user.id, 'commands.help.commands.mcp_disable'),
      i18n.t(user.id, 'commands.help.commands.mcp_refresh'),
      i18n.t(user.id, 'commands.help.commands.mcp_add'),
      i18n.t(user.id, 'commands.help.commands.mcp_list'),
      i18n.t(user.id, 'commands.help.commands.mcp_delete'),
      i18n.t(user.id, 'commands.help.commands.language'),
      i18n.t(user.id, 'commands.help.commands.stop'),
      i18n.t(user.id, 'commands.help.commands.extend'),
      i18n.t(user.id, 'commands.help.commands.new_chat'),
      i18n.t(user.id, 'commands.help.commands.reset'),
    ];
    
    await ctx.reply([title, '', ...commands].join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('status', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const cwd = userState.getCurrentCwd(user.id);
    const model = userState.getCurrentModel(user.id);
    const mcpList = mcpRegistry.list();
    const enabled = mcpList.filter((entry) => entry.enabled).map((entry) => entry.name);

    // Check if busy
    const isBusy = sessionManager.isBusy(telegramId);
    const sessions = sessionManager.getSessionsWithTimestamps(telegramId);
    const activeSession = sessionManager.getActiveSession(telegramId);

    const lines: string[] = [i18n.t(user.id, 'commands.status.title'), ''];

    // Operation status
    if (isBusy) {
      const elapsedMs = sessionManager.getOperationElapsedMs(telegramId);
      const elapsedStr = elapsedMs ? formatElapsedTime(elapsedMs) : '0s';
      lines.push(i18n.t(user.id, 'commands.status.operationInProgress'));
      lines.push(i18n.t(user.id, 'commands.status.elapsedTime', { time: elapsedStr }));
    } else {
      lines.push(i18n.t(user.id, 'commands.status.noOperation'));
    }

    lines.push('');
    lines.push(i18n.t(user.id, 'commands.status.currentProject', { cwd: escapeHtml(cwd) }));
    lines.push(i18n.t(user.id, 'commands.status.model', { model: escapeHtml(model) }));
    
    const mcpText = enabled.length ? enabled.map(escapeHtml).join(', ') : i18n.t(user.id, 'commands.status.mcpNone');
    lines.push(i18n.t(user.id, 'commands.status.mcpServers', { servers: mcpText }));

    // Session information
    if (sessions.length > 0) {
      lines.push('');
      lines.push(i18n.t(user.id, 'commands.status.activeSessions', { count: String(sessions.length) }));
      for (const session of sessions) {
        const statusLabel = session.active 
          ? i18n.t(user.id, 'commands.status.sessionActive')
          : i18n.t(user.id, 'commands.status.sessionInactive');
        const elapsed = formatElapsedTime(Date.now() - session.createdAt.getTime());
        lines.push(i18n.t(user.id, 'commands.status.sessionInfo', {
          path: escapeHtml(session.path),
          status: statusLabel,
          time: elapsed
        }));
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.command('logs', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId || telegramId !== Number(config.TELEGRAM_CHAT_ID)) {
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.reply(i18n.t(user.id, 'commands.logs.noPermission'));
      return;
    }
    
    const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
    const requestedLines = Number.parseInt(ctx.match || '50', 10);
    const lines = Number.isFinite(requestedLines) && requestedLines > 0 ? requestedLines : 50;
    
    try {
      // ESM-compatible: Use config.LOG_DIR instead of __dirname
      const logFile = await getLatestLogFile();
      
      if (!logFile) {
        await ctx.reply(i18n.t(user.id, 'commands.logs.error'));
        return;
      }
      
      const lastLines = await readLastLines(logFile, lines);
      
      // Escape HTML to prevent formatting issues with < > characters
      const escapedLogs = escapeHtml(lastLines);
      const fullMessage = i18n.t(user.id, 'commands.logs.title', {
        lines: String(lines),
        content: escapedLogs
      });
      
      // Split message if it exceeds Telegram's limit
      const messages = splitMessage(fullMessage);
      for (const msg of messages) {
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
    } catch (error) {
      await ctx.reply(i18n.t(user.id, 'commands.logs.error'));
    }
  });
}

/**
 * Reads the last N lines from a log file
 * @param logFile - Path to the log file to read
 * @param lines - Number of lines to read (clamped between 1 and 500)
 * @returns Concatenated string of the last N lines
 */
async function readLastLines(logFile: string, lines: number): Promise<string> {
  const maxLines = Math.min(Math.max(lines, 1), 500);
  const tail: string[] = [];
  const stream = fs.createReadStream(logFile, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      tail.push(line);
      if (tail.length > maxLines) {
        tail.shift();
      }
    }
  } finally {
    rl.close();
  }

  return tail.join('\n');
}

/**
 * Finds the most recent log file in the log directory
 * @returns Path to the most recent log file, or null if none found
 */
async function getLatestLogFile(): Promise<string | null> {
  try {
    const logDir = path.resolve(config.LOG_DIR);
    
    // Check if log directory exists
    try {
      await fs.promises.access(logDir);
    } catch {
      return null;
    }
    
    const files = await fs.promises.readdir(logDir);
    
    // Find all rotated log files (combined-YYYY-MM-DD.log pattern)
    const rotatedFiles = files.filter(f => 
      /^combined-\d{4}-\d{2}-\d{2}\.log$/.test(f)
    );
    
    // If rotated files exist, return the most recent one
    if (rotatedFiles.length > 0) {
      // Sort by filename (YYYY-MM-DD format sorts chronologically)
      rotatedFiles.sort().reverse(); // Most recent first
      return path.join(logDir, rotatedFiles[0]);
    }
    
    // Fallback to static combined.log if it exists
    const staticLogFile = path.join(logDir, 'combined.log');
    try {
      await fs.promises.access(staticLogFile);
      return staticLogFile;
    } catch {
      return null;
    }
  } catch (error) {
    logger.error('Error finding log file', { error });
    return null;
  }
}
