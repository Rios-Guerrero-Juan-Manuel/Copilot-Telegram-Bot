import { Bot } from 'grammy';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { WizardManager } from './wizard-manager';
import { ToolBundle } from '../types';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { escapeHtml, escapeMarkdown } from '../utils/formatter';
import { sanitizeErrorForUser } from '../utils/error-sanitizer';
import { generateCallbackData } from './keyboard-utils';
import { ServerManagementService } from '../mcp/server-management';
import { i18n } from '../i18n/index.js';

/**
 * Registers MCP server management commands
 * @param bot - Grammy bot instance to register commands on
 * @param sessionManagerOrUserState - SessionManager or UserState depending on call signature
 * @param userStateOrMcpRegistry - UserState or McpRegistry depending on call signature
 * @param mcpRegistryOrWizardManager - McpRegistry or WizardManager depending on call signature
 * @param wizardManagerOrTools - Optional WizardManager or ToolBundle depending on call signature
 * @param tools - Optional ToolBundle with available Copilot tools
 */
export function registerMcpCommands(
  bot: Bot,
  sessionManagerOrUserState: SessionManager | UserState,
  userStateOrMcpRegistry: UserState | McpRegistry,
  mcpRegistryOrWizardManager: McpRegistry | WizardManager,
  wizardManagerOrTools?: WizardManager | ToolBundle,
  tools?: ToolBundle
) {
  /**
   * Type guard to check if a value is a SessionManager
   * @param value - Value to check
   * @returns True if value is a SessionManager
   */
  const hasSessionManager = (value: unknown): value is SessionManager =>
    !!value &&
    typeof value === 'object' &&
    'isBusy' in (value as Record<string, unknown>) &&
    'setBusy' in (value as Record<string, unknown>);

  const sessionManager = hasSessionManager(sessionManagerOrUserState)
    ? sessionManagerOrUserState
    : ({
        isBusy: () => false,
        setBusy: () => {},
        recreateActiveSession: async () => {},
      } as unknown as SessionManager);

  const userState = hasSessionManager(sessionManagerOrUserState)
    ? (userStateOrMcpRegistry as UserState)
    : (sessionManagerOrUserState as UserState);

  const mcpRegistry = hasSessionManager(sessionManagerOrUserState)
    ? (mcpRegistryOrWizardManager as McpRegistry)
    : (userStateOrMcpRegistry as McpRegistry);

  const wizardManager = hasSessionManager(sessionManagerOrUserState)
    ? (wizardManagerOrTools as WizardManager)
    : (mcpRegistryOrWizardManager as WizardManager);

  const resolvedTools = hasSessionManager(sessionManagerOrUserState)
    ? (tools ?? ({ 
        all: [], 
        askUser: { resolveResponse: () => false, hasPending: () => false, cancel: () => {} },
        userInputHandler: async () => ({ answer: '', wasFreeform: true })
      } as ToolBundle))
    : ((wizardManagerOrTools as ToolBundle) ?? ({ 
        all: [], 
        askUser: { resolveResponse: () => false, hasPending: () => false, cancel: () => {} },
        userInputHandler: async () => ({ answer: '', wasFreeform: true })
      } as ToolBundle));

  const commandHandlers = (((bot as any).commandHandlers ??= new Map()) as Map<string, Function>);
  
  /**
   * Registers a command handler with the bot and stores it in the command handlers map
   * @param name - Command name without the leading slash
   * @param handler - Command handler function
   */
  const registerCommand = (name: string, handler: any) => {
    bot.command(name, handler);
    commandHandlers.set(name, handler);
  };

  registerCommand('mcp', async (ctx: any) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const sub = args[0];

    /**
     * Recreates the active session with current settings
     * @throws {Error} If session recreation fails
     */
    const recreateSession = async () => {
      await sessionManager.recreateActiveSession(telegramId, {
        model: userState.getCurrentModel(user.id),
        tools: resolvedTools.all,
        mcpServers: mcpRegistry.getEnabled(),
        onUserInputRequest: resolvedTools.userInputHandler,
      });
    };

    if (!sub) {
      const list = mcpRegistry.list();
      const lines = list.map(
        (entry) =>
          `${entry.enabled ? '✅' : '❌'} ${entry.name} (${entry.type})`
      );
      await ctx.reply(lines.join('\n') || i18n.t(user.id, 'mcp.list.empty'), {
        reply_markup: {
          inline_keyboard: list.map((entry) => [
            {
              text: entry.enabled ? `Disable ${entry.name}` : `Enable ${entry.name}`,
              callback_data: generateCallbackData('mcp_toggle', `${entry.name}:${entry.enabled ? 'disable' : 'enable'}`),
            },
          ]),
        },
      });
      return;
    }

    if (sub === 'enable' || sub === 'disable') {
      const name = args.slice(1).join(' ');
      if (!name) {
        await ctx.reply(i18n.t(user.id, 'mcp.commands.usage.enable', { sub }));
        return;
      }
      if (sessionManager.isBusy(telegramId)) {
        await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
        return;
      }
      sessionManager.setBusy(telegramId, true);
      try {
        const ok = sub === 'enable' ? mcpRegistry.enable(name) : mcpRegistry.disable(name);
        if (!ok) {
          await ctx.reply(i18n.t(user.id, 'errors.mcpServerNotFound'));
          return;
        }
        await recreateSession();
        await ctx.reply(i18n.t(user.id, 'bot.mcpToggled', { action: sub, name: escapeHtml(name) }), { parse_mode: 'HTML' });
      } finally {
        sessionManager.setBusy(telegramId, false);
      }
      return;
    }

    if (sub === 'add') {
      const name = args[1];
      const type = args[2];
      const rest = args.slice(3);
      if (!name || !type || rest.length === 0) {
        await ctx.reply(i18n.t(user.id, 'mcp.commands.usage.add'));
        return;
      }
      if (type !== 'http' && type !== 'stdio') {
        await ctx.reply(i18n.t(user.id, 'mcp.commands.invalidType'));
        return;
      }
      if (sessionManager.isBusy(telegramId)) {
        await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
        return;
      }
      sessionManager.setBusy(telegramId, true);
      try {
        const service = new ServerManagementService(userState, user.id);
        
        let result;
        if (type === 'http') {
          result = service.addServer({
            name,
            type: 'http',
            url: rest[0],
          });
        } else {
          result = service.addServer({
            name,
            type: 'stdio',
            command: rest[0],
            args: rest.slice(1),
          });
        }
        
        if (!result.success) {
          // Check if it requires confirmation
          if (result.requiresConfirmation && result.dangerousFlags) {
            const warningMessage = 
              `⚠️ **SECURITY WARNING**\n\n` +
              `Dangerous arguments detected: ${result.dangerousFlags.map(escapeMarkdown).join(', ')}\n\n` +
              `Command: \`${escapeMarkdown(result.fullCommand || '')}\`\n\n` +
              `To add this server, use the interactive wizard with /mcp_add ` +
              `where you can review and confirm the risk explicitly.`;
            
            await ctx.reply(warningMessage, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply(
              i18n.t(user.id, 'bot.errorWithDetails', { error: escapeHtml(sanitizeErrorForUser(result.error)) }),
              { parse_mode: 'HTML' }
            );
          }
          return;
        }
        
        if (result.warnings && result.warnings.length > 0) {
          await ctx.reply(result.warnings.join('\n'), { parse_mode: 'HTML' });
        }
        
        mcpRegistry.load();
        mcpRegistry.load();
        
        await recreateSession();
        await ctx.reply(i18n.t(user.id, 'bot.mcpAdded', { name: escapeHtml(name) }), { parse_mode: 'HTML' });
      } finally {
        sessionManager.setBusy(telegramId, false);
      }
      return;
    }

    if (sub === 'remove') {
      const name = args.slice(1).join(' ');
      if (!name) {
        await ctx.reply(i18n.t(user.id, 'mcp.commands.usage.remove'));
        return;
      }
      if (sessionManager.isBusy(telegramId)) {
        await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
        return;
      }
      sessionManager.setBusy(telegramId, true);
      try {
        const removed = mcpRegistry.remove(name);
        await recreateSession();
        await ctx.reply(removed ? i18n.t(user.id, 'projects.remove.removed') : i18n.t(user.id, 'errors.mcpServerNotFound'));
      } finally {
        sessionManager.setBusy(telegramId, false);
      }
      return;
    }

    if (sub === 'refresh') {
      if (sessionManager.isBusy(telegramId)) {
        await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
        return;
      }
      sessionManager.setBusy(telegramId, true);
      try {
        await mcpRegistry.reloadFromFileAsync();
        await recreateSession();
        await ctx.reply(i18n.t(user.id, 'mcp.commands.configReloaded'));
      } finally {
        sessionManager.setBusy(telegramId, false);
      }
      return;
    }

    await ctx.reply(i18n.t(user.id, 'mcp.commands.commandNotRecognized'));
  });

  // MCP Server Wizard - Interactive server creation
  registerCommand('mcp_add', async (ctx: any) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);

    logger.info('Command received: /mcp_add', sanitizeForLogging({
      command: '/mcp_add',
      telegramId,
      username: ctx.from?.username,
    }));

    const result = wizardManager.startWizard(user.id);
    await ctx.reply(result.message, { parse_mode: 'HTML' });
  });

  // MCP List with pagination
  registerCommand('mcp_list', async (ctx: any) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const page = parseInt(args[0]) || 1;

    logger.info('Command received: /mcp_list', sanitizeForLogging({
      command: '/mcp_list',
      telegramId,
      page,
    }));

    const wizard = wizardManager.getWizard(user.id);
    const service = wizard.getService(); // Use public getter instead of type casting
    const allServers = service.listServers();

    const SERVERS_PER_PAGE = 5;
    const totalPages = Math.ceil(allServers.length / SERVERS_PER_PAGE);
    const start = (page - 1) * SERVERS_PER_PAGE;
    const end = start + SERVERS_PER_PAGE;
    const servers = allServers.slice(start, end);

    if (servers.length === 0 && page === 1) {
      await ctx.reply(i18n.t(user.id, 'mcp.list.emptyWithHelp'));
      return;
    }

    if (servers.length === 0) {
      await ctx.reply(i18n.t(user.id, 'bot.pageNotExist', { page: String(page), total: String(totalPages) }));
      return;
    }

    let message = `📋 <b>${i18n.t(user.id, 'mcp.list.title', { page: String(page), total: String(totalPages) })}</b>\n\n`;
    servers.forEach((server: any, idx: number) => {
      const globalIdx = start + idx + 1;
      const status = server.enabled ? '✅' : '❌';
      message += `${globalIdx}. ${status} <b>${escapeHtml(server.name)}</b> (${server.type})\n`;
    });

    if (totalPages > 1) {
      message += `\n${i18n.t(user.id, 'mcp.list.page', { page: String(page + 1) })}`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  // MCP Delete server
  registerCommand('mcp_delete', async (ctx: any) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const serverName = args.join(' ');

    if (!serverName) {
      await ctx.reply(i18n.t(user.id, 'errors.specifyServerName'));
      return;
    }

    logger.info('Command received: /mcp_delete', sanitizeForLogging({
      command: '/mcp_delete',
      telegramId,
      serverName,
    }));

    if (sessionManager.isBusy(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
      return;
    }

    sessionManager.setBusy(telegramId, true);
    try {
      const wizard = wizardManager.getWizard(user.id);
      const service = wizard.getService(); // Use public getter instead of type casting
      const result = service.removeServer(serverName);

      if (result.success) {
        // Recreate session with updated MCP servers
        mcpRegistry.load(); // Reload from database
        await sessionManager.recreateActiveSession(telegramId, {
          model: userState.getCurrentModel(user.id),
          tools: resolvedTools.all,
          mcpServers: mcpRegistry.getEnabled(),
        });
        
        await ctx.reply(i18n.t(user.id, 'bot.serverDeletedSuccess', { name: escapeHtml(serverName) }), {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(
          i18n.t(user.id, 'bot.errorWithDetails', { error: escapeHtml(sanitizeErrorForUser(result.error)) }),
          { parse_mode: 'HTML' }
        );
      }
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });
}
