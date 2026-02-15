import { Bot } from 'grammy';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { AllowlistSetupWizard } from './allowlist-setup';
import { config, isPathAllowed, needsAllowlistSetup } from '../config';
import { splitMessage } from '../utils/message-splitter';
import { ToolBundle } from '../types';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { generateCallbackData } from './keyboard-utils';
import { TELEGRAM_MAX_MESSAGE_LENGTH } from '../constants';
import { parseCommandArgs } from '../utils/parse-args';
import { escapeHtml } from '../utils/formatter';
import { CdWizard } from './wizard-cd';
import { i18n } from '../i18n/index.js';
import {
  addAllowedPathAndRestart,
  createAllowPathRequest,
  isAdminUser,
} from './allowlist-admin';

/**
 * Resolves a path relative to the current working directory
 * 
 * @param currentCwd - Current working directory
 * @param target - Target path (absolute or relative)
 * @returns Resolved absolute path
 */
export function resolvePath(currentCwd: string, target: string): string {
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(currentCwd, target);
}

/**
 * Registers filesystem navigation commands
 * 
 * Provides Unix-like commands for directory navigation:
 * - `/pwd` - Print current working directory
 * - `/ls` - List directory contents
 * - `/cd` - Change directory (supports wizard mode)
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling project switches
 * @param userState - User state manager for persisting current directory
 * @param mcpRegistry - MCP registry for loading enabled servers
 * @param allowlistWizard - Allowlist setup wizard instance
 * @param tools - ToolBundle with available Copilot tools
 * @param cdWizard - Optional wizard for interactive directory navigation
 */
export function registerNavigationCommands(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  allowlistWizard: AllowlistSetupWizard,
  tools: ToolBundle,
  cdWizard?: CdWizard
) {
  // Use provided CdWizard instance or create a new one (for backward compatibility)
  const wizard = cdWizard ?? new CdWizard(userState);

  bot.command('pwd', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const cwd = userState.getCurrentCwd(user.id);
    await ctx.reply(`📂 <code>${escapeHtml(cwd)}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('ls', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const cwd = userState.getCurrentCwd(user.id);
    
    try {
      await fs.access(cwd);
    } catch {
      await ctx.reply(i18n.t(user.id, 'errors.directoryNotExist'));
      return;
    }
    
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    const lines = entries.map((entry) =>
      entry.isDirectory() ? `📁 ${entry.name}` : `📄 ${entry.name}`
    );
    const text = lines.join('\n') || i18n.t(user.id, 'navigation.ls.emptyDirectory');
    const parts = splitMessage(text, TELEGRAM_MAX_MESSAGE_LENGTH);
    for (const part of parts) {
      await ctx.reply(part);
    }
  });

  bot.command('cd', async (ctx) => {
    const telegramIdStr = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return; // Safety check
    
    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
    const args = parseCommandArgs(ctx.message?.text ?? '');
    
    logger.info('Command received: /cd', sanitizeForLogging({
      command: '/cd',
      telegramId: telegramIdNum,
      args: args.join(' '),
    }));
    
    // Check if allowlist setup is required but not completed (use Telegram ID)
    if (needsAllowlistSetup && allowlistWizard.needsSetup(telegramIdNum)) {
      await ctx.reply(i18n.t(user.id, 'errors.setupRequired'));
      return;
    }
    
    // NO ARGUMENTS: Start interactive wizard
    if (args.length === 0) {
      const currentCwd = userState.getCurrentCwd(user.id);
      
      try {
        const result = await wizard.startWizard(telegramIdNum, currentCwd);
        
        if (result.success && result.keyboard) {
          await ctx.reply(result.message, {
            parse_mode: 'HTML',
            reply_markup: result.keyboard,
          });
        } else {
          await ctx.reply(result.message, { parse_mode: 'HTML' });
        }
      } catch (error: any) {
        logger.error('Failed to start CD wizard', {
          telegramId: telegramIdNum,
          error: error.message,
          stack: error.stack,
        });
        await ctx.reply(i18n.t(user.id, 'navigation.cd.errorStartingWizard', { error: escapeHtml(error.message) }), {
          parse_mode: 'HTML',
        });
      }
      return;
    }

    // WITH ARGUMENTS: Traditional path-based navigation
    const currentCwd = userState.getCurrentCwd(user.id);
    const targetPath = resolvePath(currentCwd, args.join(' '));
    if (!isPathAllowed(targetPath)) {
      if (isAdminUser(telegramIdNum)) {
        const token = createAllowPathRequest(targetPath, telegramIdNum, user.id);
        await ctx.reply(i18n.t(user.id, 'allowlistAdmin.promptAddPath', { path: escapeHtml(targetPath) }), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              {
                text: i18n.t(user.id, 'allowlistAdmin.buttonAddPath'),
                callback_data: generateCallbackData('allowpath_confirm', token),
              },
              {
                text: i18n.t(user.id, 'common.cancel'),
                callback_data: generateCallbackData('allowpath_cancel', token),
              },
            ]],
          },
        });
      } else {
        await ctx.reply(i18n.t(user.id, 'errors.pathNotAllowedByConfig'));
      }
      return;
    }
    
    try {
      await fs.access(targetPath);
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        await ctx.reply(i18n.t(user.id, 'errors.invalidPathOrNotDirectory'));
        return;
      }
    } catch {
      await ctx.reply(i18n.t(user.id, 'errors.invalidPathOrNotDirectory'));
      return;
    }

    if (sessionManager.isBusy(telegramIdStr)) {
      await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
      return;
    }
    
    // Check if user is in plan mode and notify
    const wasPlanModeActive = sessionManager.isPlanModeActive(telegramIdStr);
    
    sessionManager.setBusy(telegramIdStr, true);
    try {
      // Exit plan mode if active (plans are project-specific)
      if (wasPlanModeActive) {
        logger.info('Exiting plan mode due to project change', {
          telegramId: telegramIdNum,
          fromPath: currentCwd,
          toPath: targetPath,
        });
        await sessionManager.exitPlanMode(telegramIdStr);
      }
      
      await sessionManager.switchProject(telegramIdStr, targetPath, {
        model: userState.getCurrentModel(user.id),
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
        onUserInputRequest: tools.userInputHandler,
      });
      userState.setCurrentCwd(user.id, targetPath);
      logger.info('Directory changed successfully', {
        telegramId: telegramIdNum,
        newPath: targetPath,
      });
      
      let message = i18n.t(user.id, 'navigation.cd.changed', { path: escapeHtml(targetPath) });
      if (wasPlanModeActive) {
        message += i18n.t(user.id, 'navigation.cd.planModeDeactivated');
      }
      
      await ctx.reply(message, {
        parse_mode: 'HTML',
      });
    } finally {
      sessionManager.setBusy(telegramIdStr, false);
    }
  });

  bot.command('allowpath', async (ctx) => {
    const telegramIdNum = ctx.from?.id;
    const telegramIdStr = String(telegramIdNum ?? '');
    if (!telegramIdNum) return;

    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
    if (!isAdminUser(telegramIdNum)) {
      await ctx.reply(i18n.t(user.id, 'errors.notAuthorized'));
      return;
    }

    const args = parseCommandArgs(ctx.message?.text ?? '');
    if (args.length === 0) {
      await ctx.reply(i18n.t(user.id, 'allowlistAdmin.usage'));
      return;
    }

    const candidatePath = resolvePath(userState.getCurrentCwd(user.id), args.join(' '));
    const result = await addAllowedPathAndRestart(user.id, candidatePath, bot, sessionManager, userState);
    await ctx.reply(result.message, { parse_mode: 'HTML' });
  });
}
