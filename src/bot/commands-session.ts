import { Bot, InputFile } from 'grammy';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { isPathAllowed } from '../config';
import { PLAN_MODE_SYSTEM_MESSAGE } from '../copilot/tools';
import { sendPromptWithStreaming } from './message-handler';
import { ToolBundle } from '../types';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { sanitizeErrorForUser } from '../utils/error-sanitizer';
import { generateCallbackData } from './keyboard-utils';
import { i18n } from '../i18n/index.js';
import { savePlanToDatabase } from '../utils/plan-utils';
import { DatabaseManager } from '../state/database';
import { createAllowPathRequest, isAdminUser } from './allowlist-admin';
import { escapeHtml } from '../utils/formatter';

/**
 * Registers session management commands
 * 
 * Provides commands for managing Copilot sessions and AI models:
 * - `/model` - Select AI model (Claude, GPT, Gemini variants)
 * - `/plan` - Enter plan mode for task planning with context preservation
 * - `/showplan` - Show current active plan
 * - `/exitplan` - Exit plan mode and return to normal mode
 * - `/new_chat` - Reset current session and clear all context
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling Copilot sessions
 * @param userState - User state manager for persisting preferences
 * @param mcpRegistry - MCP registry for loading enabled servers
 * @param tools - ToolBundle with available Copilot tools
 * @param db - Database manager for storing plans
 */
export function registerSessionCommands(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  tools: ToolBundle,
  db: DatabaseManager
) {
  bot.command('model', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    await ctx.reply(i18n.t(user.id, 'commands.help.commands.model'), {
      reply_markup: {
        inline_keyboard: [
          // Claude models
          [{ text: '🟣 Claude Sonnet 4.5', callback_data: generateCallbackData('model', 'claude-sonnet-4.5') }],
          [{ text: '🟣 Claude Haiku 4.5 (fast)', callback_data: generateCallbackData('model', 'claude-haiku-4.5') }],
          [{ text: '🟣 Claude Opus 4.6 (premium)', callback_data: generateCallbackData('model', 'claude-opus-4.6') }],
          [{ text: '🟣 Claude Opus 4.5 (premium)', callback_data: generateCallbackData('model', 'claude-opus-4.5') }],
          [{ text: '🟣 Claude Sonnet 4', callback_data: generateCallbackData('model', 'claude-sonnet-4') }],
          // GPT-5 family
          [{ text: '🟢 GPT-5', callback_data: generateCallbackData('model', 'gpt-5') }],
          [{ text: '🟢 GPT-5 mini (fast)', callback_data: generateCallbackData('model', 'gpt-5-mini') }],
          [{ text: '🟢 GPT-5.1', callback_data: generateCallbackData('model', 'gpt-5.1') }],
          [{ text: '🟢 GPT-5.1-Codex', callback_data: generateCallbackData('model', 'gpt-5.1-codex') }],
          [{ text: '🟢 GPT-5.1-Codex-Mini (fast)', callback_data: generateCallbackData('model', 'gpt-5.1-codex-mini') }],
          [{ text: '🟢 GPT-5.1-Codex-Max', callback_data: generateCallbackData('model', 'gpt-5.1-codex-max') }],
          [{ text: '🟢 GPT-5.2', callback_data: generateCallbackData('model', 'gpt-5.2') }],
          [{ text: '🟢 GPT-5.2-Codex', callback_data: generateCallbackData('model', 'gpt-5.2-codex') }],
          [{ text: '🟢 GPT-4.1 (fast)', callback_data: generateCallbackData('model', 'gpt-4.1') }],
          // Other models
          [{ text: '🔵 Gemini 3 Pro (Preview)', callback_data: generateCallbackData('model', 'gemini-3-pro-preview') }],
        ],
      },
    });
  });

  bot.command('plan', async (ctx) => {
    const task = ctx.message?.text?.split(' ').slice(1).join(' ').trim() ?? '';
    const telegramId = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return;
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    if (!task) {
      await ctx.reply(i18n.t(user.id, 'messageHandler.planModeUsage'));
      return;
    }
    
    logger.info('Command received: /plan', sanitizeForLogging({
      command: '/plan',
      telegramId,
      task,
    }));
    
    if (sessionManager.isBusy(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'messageHandler.operationInProgress'));
      return;
    }
    const cwd = userState.getCurrentCwd(user.id);
    const model = userState.getCurrentModel(user.id);
    
    // CRITICAL SECURITY: Validate cwd is in allowlist BEFORE creating session
    if (!isPathAllowed(cwd)) {
      logger.warn('Blocked /plan command - cwd not in allowlist', {
        telegramId,
        userId: user.id,
        cwd,
      });
      await ctx.reply(i18n.t(user.id, 'errors.pathNotAllowedDetailed'), { parse_mode: 'HTML' });
      if (isAdminUser(telegramIdNum)) {
        const token = createAllowPathRequest(cwd, telegramIdNum, user.id);
        await ctx.reply(i18n.t(user.id, 'allowlistAdmin.promptAddPath', { path: escapeHtml(cwd) }), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              {
                text: i18n.t(user.id, 'common.yes'),
                callback_data: generateCallbackData('allowpath_confirm', token),
              },
              {
                text: i18n.t(user.id, 'common.no'),
                callback_data: generateCallbackData('allowpath_cancel', token),
              },
            ]],
          },
        });
      }
      return;
    }
    
    // Clear any previous cancellation flags
    sessionManager.clearCancelled(telegramId, cwd);
    
    sessionManager.setBusy(telegramId, true);
    try {
      const controller = new AbortController();
      sessionManager.registerAborter(telegramId, () => controller.abort());
      const session = await sessionManager.switchProject(telegramId, cwd, {
        model,
        tools: tools.all,
        mcpServers: mcpRegistry.getEnabled(),
        systemMessage: { content: PLAN_MODE_SYSTEM_MESSAGE },
        onUserInputRequest: tools.userInputHandler,
      });
      const planBuffer = await sendPromptWithStreaming(
        ctx,
        session,
        `[[PLAN]]\n${task}`,
        bot,
        sessionManager,
        telegramId,
        userState,
        controller.signal
      );
      
      // Save plan to database
      const planId = savePlanToDatabase(db, user.id, cwd, planBuffer);
      if (planId) {
        sessionManager.setCurrentPlanId(telegramId, planId);
        logger.info('Plan saved and linked to session', {
          telegramId,
          userId: user.id,
          planId,
          projectPath: cwd,
        });
      }
      
      // Activate plan mode after successful plan generation
      // This preserves context for follow-up implementation questions
      if (!sessionManager.isCancelled(telegramId, cwd)) {
        sessionManager.setPlanMode(telegramId, true, planId || undefined);
        logger.info('Plan mode activated for user', {
          telegramId,
          projectPath: cwd,
        });
        
        // Notify user they're in plan mode and how to exit
        await ctx.reply(
          i18n.t(user.id, 'plan.activated'),
          { parse_mode: 'HTML' }
        ).catch((error: any) => {
          logger.warn('Failed to send plan mode activation message to user', {
            chatId: ctx.chat?.id,
            userId: telegramId,
            error: error.message,
          });
        });
      }
    } catch (error: any) {
      logger.error('Error during plan mode', {
        telegramId,
        error: error.message,
      });
      
      // Don't send message if cancelled - /stop already sent feedback
      if (!sessionManager.isCancelled(telegramId, cwd)) {
        const user = userState.getOrCreate(telegramId, ctx.from?.username);
        await ctx.reply(i18n.t(user.id, 'messageHandler.planError', { error: sanitizeErrorForUser(error) })).catch((telegramError: any) => {
          logger.warn('Failed to send plan mode error message to user', {
            chatId: ctx.chat?.id,
            userId: telegramId,
            error: telegramError.message,
          });
        });
      }
    } finally {
      sessionManager.clearAborter(telegramId);
      sessionManager.clearCancelled(telegramId, cwd);
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.command('showplan', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    logger.info('Command received: /showplan', sanitizeForLogging({
      command: '/showplan',
      telegramId,
    }));
    
    // Get current plan ID from session manager
    const planId = sessionManager.getCurrentPlanId(telegramId);
    
    if (!planId) {
      await ctx.reply(i18n.t(user.id, 'commands.plans.showplan.noPlanActive'), { parse_mode: 'HTML' });
      return;
    }
    
    try {
      const plan = db.getPlan(planId);
      
      if (!plan) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.showplan.notFound'), { parse_mode: 'HTML' });
        sessionManager.clearCurrentPlanId(telegramId);
        return;
      }
      
      // Format plan for display
      const statusEmoji = {
        draft: '📝',
        approved: '✅',
        in_progress: '🔄',
        completed: '✔️',
        cancelled: '❌',
        interrupted: '⚠️',
      }[plan.status] || '📄';
      
      const locale = userState.getLocale(user.id) === 'es' ? 'es-ES' : 'en-US';
      const createdDate = new Date(plan.created_at).toLocaleString(locale);
      const statusLabel = i18n.t(user.id, `commands.plans.statusLabels.${plan.status}`);
      
      let planMessage = `${statusEmoji} <b>${plan.title}</b>\n\n`;
      planMessage += `${i18n.t(user.id, 'commands.plans.showplan.created')} ${createdDate}\n`;
      planMessage += `${i18n.t(user.id, 'commands.plans.showplan.status')} ${statusLabel}\n`;
      planMessage += `${i18n.t(user.id, 'commands.plans.showplan.project')} <code>${plan.project_path}</code>\n\n`;
      planMessage += `─────────────────────\n\n`;
      planMessage += plan.content;
      
      // Split message if too long
      const maxLength = 4000;
      if (planMessage.length > maxLength) {
        // Send first part
        await ctx.reply(planMessage.substring(0, maxLength), { parse_mode: 'HTML' });
        
        // Send remaining parts
        let remaining = planMessage.substring(maxLength);
        while (remaining.length > 0) {
          const chunk = remaining.substring(0, maxLength);
          await ctx.reply(chunk, { parse_mode: 'HTML' });
          remaining = remaining.substring(maxLength);
        }
      } else {
        await ctx.reply(planMessage, { parse_mode: 'HTML' });
      }
      
      logger.info('Plan displayed to user', {
        telegramId,
        userId: user.id,
        planId,
        title: plan.title,
      });
    } catch (error: any) {
      logger.error('Error displaying plan', {
        telegramId,
        planId,
        error: error.message,
      });
      
      await ctx.reply(
        i18n.t(user.id, 'commands.plans.showplan.errorDisplaying', { error: sanitizeErrorForUser(error) }),
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('exitplan', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    logger.info('Command received: /exitplan', sanitizeForLogging({
      command: '/exitplan',
      telegramId,
    }));
    
    if (!sessionManager.isPlanModeActive(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'errors.notInPlanMode'));
      return;
    }
    
    if (sessionManager.isBusy(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'errors.operationInProgress'));
      return;
    }
    
    sessionManager.setBusy(telegramId, true);
    try {
      const hadPlanId = !!sessionManager.getCurrentPlanId(telegramId);
      await sessionManager.exitPlanMode(telegramId);
      
      let message = i18n.t(user.id, 'commands.plans.exitplan.exited');
      if (hadPlanId) {
        message += i18n.t(user.id, 'commands.plans.exitplan.exitedWithSaved');
      }
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error: any) {
      logger.error('Error exiting plan mode', {
        telegramId,
        error: error.message,
      });
      
      const user = userState.getOrCreate(telegramId, ctx.from?.username);
      await ctx.reply(i18n.t(user.id, 'messageHandler.exitPlanError', { error: sanitizeErrorForUser(error) })).catch((telegramError: any) => {
        logger.warn('Failed to send exit plan mode error message to user', {
          chatId: ctx.chat?.id,
          userId: telegramId,
          error: telegramError.message,
        });
      });
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.command('exportplan', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    logger.info('Command received: /exportplan', sanitizeForLogging({
      command: '/exportplan',
      telegramId,
    }));
    
    // Get plan ID from command argument or current session
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const planId = args.length > 0 ? parseInt(args[0], 10) : sessionManager.getCurrentPlanId(telegramId);
    
    if (!planId || isNaN(planId)) {
      await ctx.reply(i18n.t(user.id, 'commands.plans.exportplan.noPlan'), { parse_mode: 'HTML' });
      return;
    }
    
    try {
      const plan = db.getPlan(planId);
      
      if (!plan) {
        await ctx.reply(
          i18n.t(user.id, 'commands.plans.exportplan.notFound', { planId: planId.toString() }),
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Verify plan belongs to this user
      if (plan.user_id !== user.id) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.exportplan.accessDenied'), { parse_mode: 'HTML' });
        return;
      }
      
      // Generate filename
      const timestamp = new Date(plan.created_at).toISOString().replace(/[:.]/g, '-').split('T')[0];
      const sanitizedTitle = plan.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      const filename = `plan-${sanitizedTitle}-${timestamp}.md`;
      
      // Create file content with localized metadata
      const locale = userState.getLocale(user.id) === 'es' ? 'es-ES' : 'en-US';
      const statusLabel = i18n.t(user.id, `commands.plans.statusLabels.${plan.status}`);
      const statusWord = userState.getLocale(user.id) === 'es' ? 'Estado' : 'Status';
      const createdWord = userState.getLocale(user.id) === 'es' ? 'Creado' : 'Created';
      const projectWord = userState.getLocale(user.id) === 'es' ? 'Proyecto' : 'Project';
      
      const fileContent = `# ${plan.title}\n\n` +
        `**${statusWord}**: ${statusLabel}\n` +
        `**${createdWord}**: ${new Date(plan.created_at).toLocaleString(locale)}\n` +
        `**${projectWord}**: ${plan.project_path}\n\n` +
        `---\n\n` +
        plan.content;
      
      // Send as document
      await ctx.replyWithDocument(
        new InputFile(Buffer.from(fileContent, 'utf-8'), filename),
        { caption: i18n.t(user.id, 'commands.plans.exportplan.caption', { title: plan.title }) }
      );
      
      logger.info('Plan exported successfully', {
        telegramId,
        userId: user.id,
        planId,
        filename,
      });
    } catch (error: any) {
      logger.error('Error exporting plan', {
        telegramId,
        planId,
        error: error.message,
      });
      
      await ctx.reply(
        i18n.t(user.id, 'commands.plans.exportplan.error', { error: sanitizeErrorForUser(error) }),
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('editplan', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    logger.info('Command received: /editplan', sanitizeForLogging({
      command: '/editplan',
      telegramId,
    }));
    
    // Get plan ID from command argument or current session
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const planId = args.length > 0 ? parseInt(args[0], 10) : sessionManager.getCurrentPlanId(telegramId);
    
    if (!planId || isNaN(planId)) {
      await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.noPlan'), { parse_mode: 'HTML' });
      return;
    }
    
    try {
      const plan = db.getPlan(planId);
      
      if (!plan) {
        await ctx.reply(
          i18n.t(user.id, 'commands.plans.editplan.notFound', { planId: planId.toString() }),
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Verify plan belongs to this user
      if (plan.user_id !== user.id) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.accessDenied'), { parse_mode: 'HTML' });
        return;
      }
      
      // Generate filename
      const sanitizedTitle = plan.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      const filename = `plan-${sanitizedTitle}-${planId}.md`;
      
      // Create file content (just the editable content, not metadata)
      const fileContent = plan.content;
      
      // Send as document with instructions
      await ctx.replyWithDocument(
        new InputFile(Buffer.from(fileContent, 'utf-8'), filename),
        {
          caption: i18n.t(user.id, 'commands.plans.editplan.instructions', { title: plan.title }),
          parse_mode: 'HTML',
        }
      );
      
      // Store edit state in user state (we'll use a simple flag with planId)
      userState.setEditingPlanId(user.id, planId);
      
      logger.info('Plan sent for editing', {
        telegramId,
        userId: user.id,
        planId,
        filename,
      });
    } catch (error: any) {
      logger.error('Error preparing plan for edit', {
        telegramId,
        planId,
        error: error.message,
      });
      
      await ctx.reply(
        i18n.t(user.id, 'commands.plans.editplan.errorPreparing', { error: sanitizeErrorForUser(error) }),
        { parse_mode: 'HTML' }
      );
    }
  });

  // Handler for receiving edited plan documents
  bot.on('message:document', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    // Check if user is editing a plan
    const editingPlanId = userState.getEditingPlanId(user.id);
    
    if (!editingPlanId) {
      // Not editing a plan, ignore this document
      return;
    }
    
    const document = ctx.message.document;
    
    // Validate file is a markdown file
    if (!document.file_name?.endsWith('.md')) {
      await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.invalidFormat'), { parse_mode: 'HTML' });
      return;
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (document.file_size && document.file_size > maxSize) {
      await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.fileTooLarge'), { parse_mode: 'HTML' });
      return;
    }
    
    try {
      // Download the file
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      
      // Fetch file content
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      
      const fileContent = await response.text();
      
      // Validate content is not empty
      if (!fileContent.trim()) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.emptyFile'), { parse_mode: 'HTML' });
        return;
      }
      
      // Update plan in database
      const updated = db.updatePlanContent(editingPlanId, fileContent);
      
      if (!updated) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.updateError'), { parse_mode: 'HTML' });
        userState.clearEditingPlanId(user.id);
        return;
      }
      
      // Clear editing state
      userState.clearEditingPlanId(user.id);
      
      await ctx.reply(i18n.t(user.id, 'commands.plans.editplan.updated'), { parse_mode: 'HTML' });
      
      logger.info('Plan updated via file upload', {
        telegramId,
        userId: user.id,
        planId: editingPlanId,
        fileName: document.file_name,
        fileSize: document.file_size,
      });
    } catch (error: any) {
      logger.error('Error updating plan from file', {
        telegramId,
        planId: editingPlanId,
        error: error.message,
      });
      
      await ctx.reply(
        i18n.t(user.id, 'commands.plans.editplan.errorProcessing', { error: sanitizeErrorForUser(error) }),
        { parse_mode: 'HTML' }
      );
    }
  });

  bot.command('plans', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    logger.info('Command received: /plans', sanitizeForLogging({
      command: '/plans',
      telegramId,
    }));
    
    try {
      const plans = db.getUserPlans(user.id, 20);
      
      if (!plans || plans.length === 0) {
        await ctx.reply(i18n.t(user.id, 'commands.plans.plans.noPlans'), { parse_mode: 'HTML' });
        return;
      }
      
      // Build message with plan list
      let message = i18n.t(user.id, 'commands.plans.plans.title', { count: plans.length.toString() }) + '\n\n';
      
      const statusEmoji: Record<string, string> = {
        draft: '📝',
        approved: '✅',
        in_progress: '🔄',
        completed: '✔️',
        cancelled: '❌',
        interrupted: '⚠️',
      };
      
      const locale = userState.getLocale(user.id) === 'es' ? 'es-ES' : 'en-US';
      
      for (const plan of plans) {
        const emoji = statusEmoji[plan.status] || '📄';
        const date = new Date(plan.created_at).toLocaleDateString(locale);
        const currentPlanId = sessionManager.getCurrentPlanId(telegramId);
        const isActive = plan.id === currentPlanId ? ' 🔵' : '';
        const statusLabel = i18n.t(user.id, `commands.plans.statusLabels.${plan.status}`);
        
        message += `${emoji} <b>${plan.title}</b>${isActive}\n`;
        message += `   ID: ${plan.id} | ${statusLabel} | ${date}\n`;
        message += `   📁 ${plan.project_path}\n\n`;
      }
      
      message += i18n.t(user.id, 'commands.plans.plans.hint');
      
      await ctx.reply(message, { parse_mode: 'HTML' });
      
      logger.info('Plans list displayed', {
        telegramId,
        userId: user.id,
        plansCount: plans.length,
      });
    } catch (error: any) {
      logger.error('Error listing plans', {
        telegramId,
        error: error.message,
      });
      
      await ctx.reply(
        i18n.t(user.id, 'commands.plans.plans.error', { error: sanitizeErrorForUser(error) }),
        { parse_mode: 'HTML' }
      );
    }
  });

  const handleNewChat = async (ctx: any) => {
    const telegramId = String(ctx.from?.id ?? '');
    const activePath = sessionManager.getActiveProjectPath(telegramId);
    
    const user = userState.getOrCreate(telegramId, ctx.from?.username);

    // Safety check: verify there's an active session
    if (!activePath) {
      await ctx.reply(i18n.t(user.id, 'errors.noActiveSession'));
      return;
    }

    // Log the reset action
    logger.info('Session reset requested', {
      telegramId,
      projectPath: activePath,
    });

    try {
      // Abort any in-flight operations FIRST (critical for cleanup)
      // This must happen regardless of plan mode state
      sessionManager.abortInFlight(telegramId);
      sessionManager.clearAborter(telegramId);

      // Cancel active session
      await sessionManager.cancelActiveSession(telegramId);

      // Clear any pending ask_user responses
      tools.askUser.cancel();

      // Exit plan mode if active
      if (sessionManager.isPlanModeActive(telegramId)) {
        logger.info('Exiting plan mode during reset', {
          telegramId,
          projectPath: activePath,
        });
        await sessionManager.exitPlanMode(telegramId);
      }
      await sessionManager.destroySession(telegramId, activePath);

      // Clear busy state
      sessionManager.setBusy(telegramId, false);

      // Send confirmation
      await ctx.reply(i18n.t(user.id, 'errors.sessionReset'));
    } catch (error: any) {
      // Best effort: clear busy state even on error
      sessionManager.setBusy(telegramId, false);

      // Report error to user (with error handling)
      await ctx.reply(i18n.t(user.id, 'messageHandler.resetError', { error: sanitizeErrorForUser(error) })).catch((telegramError: any) => {
        logger.warn('Failed to send reset error message to user', {
          chatId: ctx.chat?.id,
          userId: telegramId,
          error: telegramError.message,
        });
      });
      
      logger.error('Error during session reset', {
        telegramId,
        projectPath: activePath,
        error: error.message,
      });
    }
  };

  bot.command('new_chat', handleNewChat);
  bot.command('reset', handleNewChat);
}
