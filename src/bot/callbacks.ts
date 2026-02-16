import { Bot } from 'grammy';
import { promises as fs } from 'fs';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { ToolBundle } from '../types';
import { isPathAllowed } from '../config';
import { logger } from '../utils/logger';
import { isCallbackValid, extractCallbackParts } from './keyboard-utils';
import { escapeHtml } from '../utils/formatter';
import { CdWizard } from './wizard-cd';
import { AddProjectWizard } from './wizard-addproject';
import { i18n } from '../i18n/index.js';
import { getAvailableModelIds } from './model-catalog';
import {
  addAllowedPathAndRestart,
  consumeAllowPathRequest,
  isAdminUser,
} from './allowlist-admin';

/**
 * Registers all callback query handlers for inline keyboard interactions
 * 
 * Handles callbacks for:
 * - `ask_user_response` - User responses to AI questions
 * - `model` - Model selection
 * - `project_switch` - Quick project switching
 * - `mcp_toggle` - Enable/disable MCP servers
 * - `cd_nav`, `cd_page`, `cd_confirm`, `cd_cancel` - CD wizard navigation
 * - `addproj_*` - Add project wizard interactions
 * 
 * All callbacks include timestamp validation to prevent stale interactions.
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling state changes
 * @param userState - User state manager
 * @param mcpRegistry - MCP server registry
 * @param tools - ToolBundle with available Copilot tools
 * @param cdWizard - Optional CD wizard instance
 * @param addProjectWizard - Optional add project wizard instance
 */
export function registerCallbacks(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  tools: ToolBundle,
  cdWizard?: CdWizard,
  addProjectWizard?: AddProjectWizard
) {
  bot.callbackQuery(/^ask_user_response:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    // Validate timestamp
    if (!isCallbackValid(callbackData)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.requestExpired'));
      return;
    }
    
    if (!tools.askUser.hasPending()) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.requestExpired'));
      return;
    }
    
    // Extract data without timestamp: "token:answer"
    const { data } = extractCallbackParts(callbackData);
    const parts = data.split(':');
    const token = parts[0] ?? '';
    const answer = parts.slice(1).join(':'); // Rejoin in case answer contains colons
    
    const resolved = tools.askUser.resolveResponse(answer, token);
    
    if (resolved) {
      // Remove inline keyboard and update message to show selected option
      try {
        const originalText = ctx.callbackQuery?.message?.text || '';
        const confirmationText = `${originalText}\n\n✅ ${i18n.t(user.id, 'callbacks.optionSelected')}: <b>${escapeHtml(answer)}</b>`;
        
        await ctx.editMessageText(confirmationText, {
          parse_mode: 'HTML',
          reply_markup: undefined, // Remove buttons
        });
      } catch (error) {
        // If edit fails (message too old), just answer callback
        logger.debug('Could not edit message to remove buttons', { error });
      }
      
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.responseReceived'));
    } else {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.requestExpired'));
    }
  });

  bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const hasTimestamp = /:\d+$/.test(callbackData);
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    // Validate timestamp when present
    if (hasTimestamp && !isCallbackValid(callbackData)) {
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredModel'));
      await ctx.answerCallbackQuery();
      return;
    }
    
    const model = hasTimestamp
      ? extractCallbackParts(callbackData).data
      : (ctx.match?.[1] ?? '');
    
    const availableModels = await getAvailableModelIds(sessionManager);
    if (!availableModels.includes(model)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.invalidModel'));
      return;
    }
    if (sessionManager.isBusy(telegramId)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.operationInProgress'));
      return;
    }
    sessionManager.setBusy(telegramId, true);
    userState.setCurrentModel(user.id, model);

    try {
      await sessionManager.recreateActiveSession(telegramId, {
        model,
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.modelChanged', { model }));
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.modelChangedMessage', { model: escapeHtml(model) }), {
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      logger.error('Failed to change model in callback', {
        telegramId,
        model,
        error: error.message,
        stack: error.stack,
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorChangingModel'));
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.callbackQuery(/^project_switch:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const hasTimestamp = /:\d+$/.test(callbackData);
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    // Validate timestamp when present
    if (hasTimestamp && !isCallbackValid(callbackData)) {
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredSwitch'));
      await ctx.answerCallbackQuery();
      return;
    }
    
    const name = hasTimestamp
      ? extractCallbackParts(callbackData).data
      : (ctx.match?.[1] ?? '');
    
    const path = userState.getProjectPath(user.id, name);
    if (!path) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'projects.switch.notFound'));
      return;
    }
    if (!isPathAllowed(path)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'errors.pathNotAllowedByConfig'));
      return;
    }
    
    try {
      await fs.access(path);
      const stats = await fs.stat(path);
      if (!stats.isDirectory()) {
        await ctx.answerCallbackQuery(i18n.t(user.id, 'errors.invalidPathOrNotDirectory'));
        return;
      }
    } catch {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'errors.invalidPathOrNotDirectory'));
      return;
    }
    if (sessionManager.isBusy(telegramId)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.operationInProgress'));
      return;
    }
    sessionManager.setBusy(telegramId, true);
    try {
      await sessionManager.switchProject(telegramId, path, {
        model: userState.getCurrentModel(user.id),
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
        onUserInputRequest: tools.userInputHandler,
      });
      userState.setCurrentCwd(user.id, path);
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.projectSwitchedAck', { name }));
      await ctx.editMessageText(i18n.t(user.id, 'projects.switch.switched', { path: escapeHtml(path) }), {
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      logger.error('Failed to switch project in callback', {
        telegramId,
        projectName: name,
        path,
        error: error.message,
        stack: error.stack,
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorChangingProject'));
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.callbackQuery(/^mcp_toggle:(.+?):(enable|disable)(?::(\d+))?$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const hasTimestamp = /:\d+$/.test(callbackData);
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    // Validate timestamp when present
    if (hasTimestamp && !isCallbackValid(callbackData)) {
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredMcp'));
      await ctx.answerCallbackQuery();
      return;
    }
    
    const name = hasTimestamp
      ? (extractCallbackParts(callbackData).data.split(':')[0] ?? '')
      : (ctx.match?.[1] ?? '');
    const action = hasTimestamp
      ? (extractCallbackParts(callbackData).data.split(':')[1] ?? '')
      : (ctx.match?.[2] ?? '');
    
    if (sessionManager.isBusy(telegramId)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.operationInProgress'));
      return;
    }
    sessionManager.setBusy(telegramId, true);

    try {
      const ok = action === 'enable' ? mcpRegistry.enable(name) : mcpRegistry.disable(name);
      if (!ok) {
        await ctx.answerCallbackQuery(i18n.t(user.id, 'errors.mcpServerNotFound'));
        return;
      }
      await sessionManager.recreateActiveSession(telegramId, {
        model: userState.getCurrentModel(user.id),
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.mcpToggledAck', { action, name }));
      await ctx.editMessageText(i18n.t(user.id, 'bot.mcpToggled', { action, name: escapeHtml(name) }), {
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      logger.error('Failed to toggle MCP server in callback', {
        telegramId,
        mcpName: name,
        action,
        error: error.message,
        stack: error.stack,
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUpdatingMCP'));
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.callbackQuery(/^allowpath_(confirm|cancel):(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return;

    const telegramId = String(telegramIdNum);
    const user = userState.getOrCreate(telegramId, ctx.from?.username);

    if (!isCallbackValid(callbackData)) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.requestExpired'));
      return;
    }

    const { action, data: token } = extractCallbackParts(callbackData);
    const request = consumeAllowPathRequest(token);
    if (!request) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.requestExpired'));
      return;
    }

    if (!isAdminUser(telegramIdNum) || request.telegramId !== telegramIdNum) {
      await ctx.answerCallbackQuery(i18n.t(user.id, 'errors.notAuthorized'));
      return;
    }

    if (action === 'allowpath_cancel') {
      await ctx.editMessageText(i18n.t(user.id, 'allowlistAdmin.cancelled'), { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.cancelled'));
      return;
    }

    const result = await addAllowedPathAndRestart(
      user.id,
      request.path,
      bot,
      sessionManager,
      userState
    );

    await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
    await ctx.answerCallbackQuery(result.ok ? i18n.t(user.id, 'callbacks.responseReceived') : i18n.t(user.id, 'callbacks.error'));
  });

  // ============================================================================
  // CD WIZARD CALLBACKS
  // ============================================================================
  
  // Use provided CdWizard instance or create a new one (for backward compatibility)
  const wizard = cdWizard ?? new CdWizard(userState);

  bot.callbackQuery(/^cd_nav:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramIdNum = ctx.from?.id;
    
    if (!telegramIdNum) {
      const user = userState.getOrCreate('0');
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
      return;
    }

    const telegramId = String(telegramIdNum);
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    if (!isCallbackValid(callbackData)) {
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredCd'));
      await ctx.answerCallbackQuery();
      return;
    }

    const { data: targetDir } = extractCallbackParts(callbackData);

    try {
      const result = await wizard.handleNavigation(telegramIdNum, targetDir);

      if (result.success && result.keyboard) {
        await ctx.editMessageText(result.message, {
          parse_mode: 'HTML',
          reply_markup: result.keyboard,
        });
        await ctx.answerCallbackQuery();
      } else {
        await ctx.answerCallbackQuery(result.message);
        if (!result.success) {
          await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
        }
      }
    } catch (error: any) {
      logger.error('Error in CD wizard navigation callback', {
        telegramId: telegramIdNum,
        targetDir,
        error: error.message,
        stack: error.stack,
      });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorNavigating'));
    }
  });

  bot.callbackQuery(/^cd_page:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramId = ctx.from?.id;
    
    if (!telegramId) {
      const user = userState.getOrCreate('0');
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
      return;
    }

    // Validate timestamp
    if (!isCallbackValid(callbackData)) {
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredCd'));
      await ctx.answerCallbackQuery();
      return;
    }

    const { data: pageStr } = extractCallbackParts(callbackData);
    const page = parseInt(pageStr);

    if (isNaN(page)) {
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.answerCallbackQuery(i18n.t(user.id, 'wizards.cd.invalidPage'));
      return;
    }

    try {
      const result = await wizard.handlePageChange(telegramId, page);

      if (result.success && result.keyboard) {
        await ctx.editMessageText(result.message, {
          parse_mode: 'HTML',
          reply_markup: result.keyboard,
        });
        await ctx.answerCallbackQuery();
      } else {
        await ctx.answerCallbackQuery(result.message);
      }
    } catch (error: any) {
      logger.error('Error in CD wizard page change callback', {
        telegramId,
        page,
        error: error.message,
        stack: error.stack,
      });
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorChangingPage'));
    }
  });

  // Non-interactive button that just shows current page
  bot.callbackQuery('cd_page_info', async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cd_confirm:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramId = ctx.from?.id;
    const telegramIdStr = String(telegramId ?? '');
    
    if (!telegramId) {
      const user = userState.getOrCreate('0');
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
      return;
    }

    // Validate timestamp
    if (!isCallbackValid(callbackData)) {
      const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredCd'));
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      const result = await wizard.handleConfirm(telegramId);

      if (result.success && result.confirmed && result.finalPath) {
        // Apply the directory change
        const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
        
        if (sessionManager.isBusy(telegramIdStr)) {
          await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.operationInProgress'));
          return;
        }

        const wasPlanModeActive = sessionManager.isPlanModeActive(telegramIdStr);
        
        sessionManager.setBusy(telegramIdStr, true);
        try {
          if (wasPlanModeActive) {
            logger.info('Exiting plan mode due to wizard directory change', {
              telegramId,
              newPath: result.finalPath,
            });
            await sessionManager.exitPlanMode(telegramIdStr);
          }

          await sessionManager.switchProject(telegramIdStr, result.finalPath, {
            model: userState.getCurrentModel(user.id),
            tools: tools.all,
            mcpServers: mcpRegistry.getEnabled(),
            onUserInputRequest: tools.userInputHandler,
          });
          
          userState.setCurrentCwd(user.id, result.finalPath);

          let message = i18n.t(user.id, 'navigation.cd.changed', { path: escapeHtml(result.finalPath) });
          if (wasPlanModeActive) {
            message += i18n.t(user.id, 'navigation.cd.planModeDeactivated');
          }

          await ctx.editMessageText(message, { parse_mode: 'HTML' });
          await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.directoryChanged'));
        } finally {
          sessionManager.setBusy(telegramIdStr, false);
        }
      } else {
        await ctx.answerCallbackQuery(result.message);
        await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
      }
    } catch (error: any) {
      logger.error('Error in CD wizard confirm callback', {
        telegramId,
        error: error.message,
        stack: error.stack,
      });
      const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorConfirming'));
    }
  });

  bot.callbackQuery(/^cd_cancel:(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
    const telegramId = ctx.from?.id;
    
    if (!telegramId) {
      const user = userState.getOrCreate('0');
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
      return;
    }

    // Validate timestamp
    if (!isCallbackValid(callbackData)) {
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredCd'));
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      const result = await wizard.handleCancel(telegramId);
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);

      await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
      await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.cancelled'));
    } catch (error: any) {
      logger.error('Error in CD wizard cancel callback', {
        telegramId,
        error: error.message,
        stack: error.stack,
      });
      const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
      await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorCancelling'));
    }
  });

  // ============================================================================
  // ADDPROJECT WIZARD CALLBACKS
  // ============================================================================

  if (addProjectWizard) {
    bot.callbackQuery(/^addproj_nav:(.+)$/, async (ctx) => {
      const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
      const telegramId = ctx.from?.id;
      
      if (!telegramId) {
        const user = userState.getOrCreate('0');
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
        return;
      }

      // Validate timestamp
      if (!isCallbackValid(callbackData)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredAddProject'));
        await ctx.answerCallbackQuery();
        return;
      }

      const { data: targetDir } = extractCallbackParts(callbackData);

      try {
        const result = await addProjectWizard.handleNavigation(telegramId, targetDir);

        if (result.success && result.keyboard) {
          await ctx.editMessageText(result.message, {
            parse_mode: 'HTML',
            reply_markup: result.keyboard,
          });
          await ctx.answerCallbackQuery();
        } else {
          await ctx.answerCallbackQuery(result.message);
          if (!result.success) {
            await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
          }
        }
      } catch (error: any) {
        logger.error('Error in AddProject wizard navigation callback', {
          telegramId,
          targetDir,
          error: error.message,
          stack: error.stack,
        });
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorNavigating'));
      }
    });

    bot.callbackQuery(/^addproj_page:(.+)$/, async (ctx) => {
      const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
      const telegramId = ctx.from?.id;
      
      if (!telegramId) {
        const user = userState.getOrCreate('0');
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
        return;
      }

      // Validate timestamp
      if (!isCallbackValid(callbackData)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredAddProject'));
        await ctx.answerCallbackQuery();
        return;
      }

      const { data: pageStr } = extractCallbackParts(callbackData);
      const page = parseInt(pageStr);

      if (isNaN(page)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'wizards.addProject.invalidPage'));
        return;
      }

      try {
        const result = await addProjectWizard.handlePageChange(telegramId, page);

        if (result.success && result.keyboard) {
          await ctx.editMessageText(result.message, {
            parse_mode: 'HTML',
            reply_markup: result.keyboard,
          });
          await ctx.answerCallbackQuery();
        } else {
          await ctx.answerCallbackQuery(result.message);
        }
      } catch (error: any) {
        logger.error('Error in AddProject wizard page change callback', {
          telegramId,
          page,
          error: error.message,
          stack: error.stack,
        });
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorChangingPage'));
      }
    });

    bot.callbackQuery('addproj_page_info', async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^addproj_confirmdir:(.+)$/, async (ctx) => {
      const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
      const telegramId = ctx.from?.id;
      
      if (!telegramId) {
        const user = userState.getOrCreate('0');
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
        return;
      }

      // Validate timestamp
      if (!isCallbackValid(callbackData)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredAddProject'));
        await ctx.answerCallbackQuery();
        return;
      }

      try {
        const result = await addProjectWizard.handleShowConfirmation(telegramId);
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);

        if (result.success && result.keyboard) {
          await ctx.editMessageText(result.message, {
            parse_mode: 'HTML',
            reply_markup: result.keyboard,
          });
          await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.confirmation'));
        } else {
          await ctx.answerCallbackQuery(result.message);
          if (!result.success) {
            await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
          }
        }
      } catch (error: any) {
        logger.error('Error in AddProject wizard show confirmation callback', {
          telegramId,
          error: error.message,
          stack: error.stack,
        });
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorShowingConfirmation'));
      }
    });

    bot.callbackQuery(/^addproj_confirm:(.+)$/, async (ctx) => {
      const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
      const telegramId = ctx.from?.id;
      
      if (!telegramId) {
        const user = userState.getOrCreate('0');
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
        return;
      }

      // Validate timestamp
      if (!isCallbackValid(callbackData)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredAddProject'));
        await ctx.answerCallbackQuery();
        return;
      }

      try {
        const result = await addProjectWizard.handleConfirm(telegramId);
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);

        if (result.success && result.confirmed) {
          await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
          await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.projectSaved'));
        } else {
          await ctx.answerCallbackQuery(result.message);
          await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
        }
      } catch (error: any) {
        logger.error('Error in AddProject wizard confirm callback', {
          telegramId,
          error: error.message,
          stack: error.stack,
        });
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorSavingProject'));
      }
    });

    bot.callbackQuery(/^addproj_cancel:(.+)$/, async (ctx) => {
      const callbackData = ctx.callbackQuery?.data ?? ctx.match?.[0] ?? '';
      const telegramId = ctx.from?.id;
      
      if (!telegramId) {
        const user = userState.getOrCreate('0');
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorUserNotIdentified'));
        return;
      }

      // Validate timestamp
      if (!isCallbackValid(callbackData)) {
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.editMessageText(i18n.t(user.id, 'callbacks.optionExpiredAddProject'));
        await ctx.answerCallbackQuery();
        return;
      }

      try {
        const result = await addProjectWizard.handleCancel(telegramId);
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);

        await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
        await ctx.answerCallbackQuery(i18n.t(user.id, 'callbacks.cancelled'));
      } catch (error: any) {
        logger.error('Error in AddProject wizard cancel callback', {
          telegramId,
          error: error.message,
          stack: error.stack,
        });
        const user = userState.getOrCreate(String(telegramId), ctx.from?.username);
        await ctx.answerCallbackQuery(i18n.t(user.id, 'bot.errorCancelling'));
      }
    });
  }
}
