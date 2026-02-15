import { Bot } from 'grammy';
import { promises as fs } from 'fs';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { AllowlistSetupWizard } from './allowlist-setup';
import { AddProjectWizard } from './wizard-addproject';
import { isPathAllowed, needsAllowlistSetup } from '../config';
import { ToolBundle } from '../types';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/formatter';
import { resolvePath } from './commands-navigation';
import { parseCommandArgs } from '../utils/parse-args';
import { i18n } from '../i18n/index.js';

/**
 * Registers project management commands
 * 
 * Provides commands for managing saved project directories:
 * - `/projects` - List all saved projects
 * - `/addproject` - Add a new project (supports wizard mode)
 * - `/rmproject` - Remove a project by name
 * - `/switch` - Switch to a saved project directory
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling project switches
 * @param userState - User state manager for persisting project data
 * @param mcpRegistry - MCP registry for loading enabled servers
 * @param allowlistWizard - Allowlist setup wizard instance
 * @param tools - ToolBundle with available Copilot tools
 * @param addProjectWizard - Optional wizard for interactive project creation
 */
export function registerProjectCommands(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  allowlistWizard: AllowlistSetupWizard,
  tools: ToolBundle,
  addProjectWizard?: AddProjectWizard
) {
  bot.command('projects', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const projects = userState.listProjects(user.id);
    if (projects.length === 0) {
      await ctx.reply(i18n.t(user.id, 'projects.list.noProjects'));
      return;
    }
    const message = projects
      .map((project) => `• <b>${escapeHtml(project.name)}</b> — <code>${escapeHtml(project.path)}</code>`)
      .join('\n');
    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  bot.command('addproject', async (ctx) => {
    const telegramIdStr = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return; // Safety check
    
    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
    const args = parseCommandArgs(ctx.message?.text ?? '');
    
    // Check if allowlist setup is required but not completed (use Telegram ID)
    if (needsAllowlistSetup && allowlistWizard.needsSetup(telegramIdNum)) {
      await ctx.reply(i18n.t(user.id, 'errors.setupRequired'));
      return;
    }
    
    // If no args provided and wizard is available, start wizard mode
    if (args.length === 0 && addProjectWizard) {
      const result = await addProjectWizard.startWizard(telegramIdNum);
      await ctx.reply(result.message, {
        parse_mode: 'HTML',
        reply_markup: result.keyboard,
      });
      return;
    }
    
    // Traditional mode: require both name and path
    if (args.length < 2) {
      await ctx.reply(i18n.t(user.id, 'projects.add.usage'));
      return;
    }

    const name = args[0];
    const currentCwd = userState.getCurrentCwd(user.id);
    const targetPath = resolvePath(currentCwd, args.slice(1).join(' '));
    if (!isPathAllowed(targetPath)) {
      await ctx.reply(i18n.t(user.id, 'errors.pathNotAllowedByConfig'));
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
    
    userState.addProject(user.id, name, targetPath);
    await ctx.reply(i18n.t(user.id, 'projects.add.saved', { name: escapeHtml(name) }), { parse_mode: 'HTML' });
  });

  bot.command('rmproject', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const args = parseCommandArgs(ctx.message?.text ?? '');
    if (args.length < 1) {
      await ctx.reply(i18n.t(user.id, 'projects.remove.usage'));
      return;
    }
    const removed = userState.removeProject(user.id, args[0]);
    await ctx.reply(removed ? i18n.t(user.id, 'projects.remove.removed') : i18n.t(user.id, 'projects.remove.notFoundShort'));
  });

  bot.command('switch', async (ctx) => {
    const telegramIdStr = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return; // Safety check
    
    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
    const args = parseCommandArgs(ctx.message?.text ?? '');
    
    // Check if allowlist setup is required but not completed (use Telegram ID)
    if (needsAllowlistSetup && allowlistWizard.needsSetup(telegramIdNum)) {
      await ctx.reply(i18n.t(user.id, 'errors.setupRequired'));
      return;
    }
    
    if (args.length < 1) {
      await ctx.reply(i18n.t(user.id, 'projects.switch.usage'));
      return;
    }
    const projectPath = userState.getProjectPath(user.id, args[0]);
    if (!projectPath) {
      await ctx.reply(i18n.t(user.id, 'projects.switch.notFound'));
      return;
    }
    if (!isPathAllowed(projectPath)) {
      await ctx.reply(i18n.t(user.id, 'errors.pathNotAllowedByConfig'));
      return;
    }
    
    try {
      await fs.access(projectPath);
      const stats = await fs.stat(projectPath);
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
    
    // Check if user is in plan mode and notify (plans are project-specific)
    const wasPlanModeActive = sessionManager.isPlanModeActive(telegramIdStr);
    
    sessionManager.setBusy(telegramIdStr, true);
    try {
      // Exit plan mode if active (plans are project-specific)
      if (wasPlanModeActive) {
        const currentCwd = userState.getCurrentCwd(user.id);
        logger.info('Exiting plan mode due to project switch', {
          telegramId: telegramIdNum,
          fromPath: currentCwd,
          toPath: projectPath,
        });
        await sessionManager.exitPlanMode(telegramIdStr);
      }
      
      await sessionManager.switchProject(telegramIdStr, projectPath, {
        model: userState.getCurrentModel(user.id),
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
        onUserInputRequest: tools.userInputHandler,
      });
      userState.setCurrentCwd(user.id, projectPath);
      logger.info('Project switched successfully', {
        telegramId: telegramIdNum,
        newPath: projectPath,
      });
      
      let message = i18n.t(user.id, 'projects.switch.switched', { path: escapeHtml(projectPath) });
      if (wasPlanModeActive) {
        message += i18n.t(user.id, 'projects.switch.planModeDeactivated');
      }
      
      await ctx.reply(message, {
        parse_mode: 'HTML',
      });
    } finally {
      sessionManager.setBusy(telegramIdStr, false);
    }
  });
}
