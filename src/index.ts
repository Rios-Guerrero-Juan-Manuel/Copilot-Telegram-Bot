#!/usr/bin/env node

import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import type { LocaleKey } from './i18n/types';
import { runInteractiveSetup, shouldRunInteractiveSetup } from './utils/interactive-setup';
import { ONE_SECOND_MS, ONE_MINUTE_MS, STABILITY_PERIOD_MS } from './constants';

/**
 * Main entry point for the Telegram bot application
 * Initializes all services and starts the bot
 * @throws {Error} If critical initialization fails
 */
async function main() {
  if (process.env.SKIP_INTERACTIVE_SETUP !== 'true' && shouldRunInteractiveSetup()) {
    const setupCompleted = await runInteractiveSetup();
    if (setupCompleted) {
      console.log('🔄 Restarting with new configuration...\n');
    }
  }

  const configModule = await import('./config');
  const { config, needsAllowlistSetup } = configModule;
  const [
    { ResilientCopilotClient },
    { SessionManager },
    { McpRegistry },
    { createTools },
    { registerCommands },
    { registerCallbacks },
    { registerMessageHandler },
    { registerTimeoutCallbacks },
    { createRateLimitMiddleware },
    { UserState },
    { WizardManager },
    { AllowlistSetupWizard },
    { CdWizard },
    { AddProjectWizard },
    { flushLogger, initLogger, logger },
    { sanitizeErrorForUser },
    { escapeHtml },
    { i18n },
    { isNetworkError, isAuthError, calculateBackoff, sleep, extractErrorDiagnostic },
  ] = await Promise.all([
    import('./copilot/client-manager'),
    import('./copilot/session-manager'),
    import('./mcp/mcp-registry'),
    import('./copilot/tools'),
    import('./bot/commands-index'),
    import('./bot/callbacks'),
    import('./bot/message-handler'),
    import('./bot/timeout-confirmation'),
    import('./bot/rate-limit'),
    import('./state/user-state'),
    import('./bot/wizard-manager'),
    import('./bot/allowlist-setup'),
    import('./bot/wizard-cd'),
    import('./bot/wizard-addproject'),
    import('./utils/logger'),
    import('./utils/error-sanitizer'),
    import('./utils/formatter'),
    import('./i18n/index.js'),
    import('./utils/telegram-retry'),
  ]);
  
  await initLogger();
  logger.info('Starting Copilot Telegram Bot...');

  const exitWithFlush = async (code: number): Promise<never> => {
    try {
      await flushLogger();
    } finally {
      process.exit(code);
    }
  };

  const copilotClient = new ResilientCopilotClient();
  const client = await copilotClient.ensureClient();
  logger.info('Copilot CLI connected');

  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  const userState = new UserState(config);
  const primaryUser = userState.getOrCreate(config.TELEGRAM_CHAT_ID);
  const primaryTelegramId = Number(config.TELEGRAM_CHAT_ID);
  
  const primaryLocale = userState.getLocale(primaryUser.id) as LocaleKey;
  i18n.setUserLocale(primaryUser.id, primaryLocale);
  logger.info('i18n initialized', { userId: primaryUser.id, locale: primaryLocale });
  
  const sessionManager = new SessionManager(client);
  const mcpRegistry = new McpRegistry(userState, primaryUser.id);
  
  await mcpRegistry.loadAsync();
  
  const wizardManager = new WizardManager(userState);
  const allowlistWizard = new AllowlistSetupWizard(
    userState,
    bot,
    sessionManager,
    userState.getDatabase()
  );
  const cdWizard = new CdWizard(userState);
  const addProjectWizard = new AddProjectWizard(userState);
  const tools = createTools(bot, config.TELEGRAM_CHAT_ID);

  if (needsAllowlistSetup && allowlistWizard.needsSetup(primaryTelegramId)) {
    logger.warn('Allowlist not configured - will prompt user on first message', {
      telegramId: primaryTelegramId,
      userId: primaryUser.id,
    });
  }

  bot.use(createRateLimitMiddleware(config.TELEGRAM_CHAT_ID));

  bot.command('stop', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    const activePath = sessionManager.getActiveProjectPath(telegramId);
    
    if (!activePath) {
      await ctx.reply(i18n.t(user.id, 'bot.stop.noSession'));
      return;
    }

    if (!sessionManager.isBusy(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'bot.stop.noOperation'));
      return;
    }

    try {
      sessionManager.setPlanMode(telegramId, false);
      const cancelled = await sessionManager.cancelActiveSession(telegramId);
      sessionManager.abortInFlight(telegramId);
      sessionManager.clearAborter(telegramId);
      tools.askUser.cancel();
      await sessionManager.destroySession(telegramId, activePath);
      
      if (cancelled) {
        await ctx.reply(i18n.t(user.id, 'bot.stop.cancelled'));
      } else {
        await ctx.reply(i18n.t(user.id, 'bot.stop.stopped'));
      }
    } catch (error: any) {
      await ctx.reply(i18n.t(user.id, 'bot.stop.errorStopping', { error: sanitizeErrorForUser(error) }));
    } finally {
      sessionManager.setBusy(telegramId, false);
    }
  });

  bot.command('extend', async (ctx) => {
    const telegramId = String(ctx.from?.id ?? '');
    const user = userState.getOrCreate(telegramId, ctx.from?.username);
    
    if (!sessionManager.isBusy(telegramId)) {
      await ctx.reply(i18n.t(user.id, 'bot.extend.noOperation'));
      return;
    }

    try {
      const elapsed = sessionManager.getOperationElapsedMs(telegramId) || 0;
      const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS;
      
      if (projectedTotal > config.MAX_TIMEOUT_DURATION) {
        await ctx.reply(i18n.t(user.id, 'bot.extend.maxReached'));
        return;
      }

      const extensionMs = config.TIMEOUT_EXTENSION_MS;
      const success = sessionManager.extendTimeout(telegramId, extensionMs);
      
      if (!success) {
        await ctx.reply(i18n.t(user.id, 'bot.extend.errorExtending'));
        return;
      }

      const elapsedMs = sessionManager.getOperationElapsedMs(telegramId) ?? 0;
      const originalTimeout = sessionManager.getOriginalTimeout(telegramId) ?? 0;
      const totalExtension = sessionManager.getTimeoutExtension(telegramId);
      const newLimitMs = originalTimeout + totalExtension;
      
      const elapsedMin = Math.floor(elapsedMs / ONE_MINUTE_MS);
      const elapsedSec = Math.floor((elapsedMs % ONE_MINUTE_MS) / ONE_SECOND_MS);
      const extensionMin = Math.floor(extensionMs / ONE_MINUTE_MS);
      const newLimitMin = Math.floor(newLimitMs / ONE_MINUTE_MS);
      
      const elapsedStr = elapsedMin > 0 
        ? `${elapsedMin}m ${elapsedSec}s` 
        : `${elapsedSec}s`;
      
      await ctx.reply(
        i18n.t(user.id, 'bot.extend.extended', {
          minutes: extensionMin,
          elapsed: elapsedStr,
          limit: newLimitMin
        }),
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      logger.error('Error extending timeout', {
        telegramId,
        error: error.message,
      });
      await ctx.reply(i18n.t(user.id, 'bot.extend.errorExtendingFailed', { error: sanitizeErrorForUser(error) }));
    }
  });

  registerCommands(bot, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools, cdWizard, addProjectWizard);
  registerCallbacks(bot, sessionManager, userState, mcpRegistry, tools, cdWizard, addProjectWizard);
  registerTimeoutCallbacks(bot);
  registerMessageHandler(bot, sessionManager, userState, mcpRegistry, wizardManager, allowlistWizard, tools, addProjectWizard);

  bot.catch((err) => {
  logger.error('Bot error', { err });
    bot.api
      .sendMessage(config.TELEGRAM_CHAT_ID, i18n.t(0, 'bot.errorWithDetails', { error: sanitizeErrorForUser(err) }))
      .catch((error: any) => {
        logger.warn('Failed to send bot error notification to Telegram', {
          chatId: config.TELEGRAM_CHAT_ID,
          originalError: err.message,
          notificationError: error.message,
        });
      });
  });

  await bot.api.sendMessage(
    config.TELEGRAM_CHAT_ID,
    i18n.t(primaryUser.id, 'commands.start.welcome', {
      cwd: escapeHtml(userState.getCurrentCwd(primaryUser.id)),
      model: escapeHtml(config.COPILOT_DEFAULT_MODEL)
    }),
    { parse_mode: 'HTML' }
  );

  // IMPORTANT: grammY runner has built-in retry logic that retries for 15 hours by default.
  // We configure a shorter maxRetryTime (5 minutes) so that our custom retry logic
  // can take over with exponential backoff and better error handling.
  const runnerState = {
    runner: run(bot, {
      runner: {
        fetch: {
          allowed_updates: ['message', 'callback_query'],
        },
        maxRetryTime: 5 * 60,
      },
    }),
  };

  logger.info('Telegram bot started with concurrent processing');

  let runnerRetryAttempt = 0;
  let stabilityTimer: NodeJS.Timeout | null = null;

  const handleRunnerError = async (error: any) => {
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }

    while (true) {
      const diagnostic = extractErrorDiagnostic(error);
      
      logger.error('Telegram runner error', { 
        error: error.message,
        code: diagnostic.code || error.code,
        source: diagnostic.source,
        errorChain: diagnostic.chain,
        attempt: runnerRetryAttempt + 1,
      });

      if (isAuthError(error)) {
        logger.error('Authentication error - closing bot', {
          error: error.message,
          code: diagnostic.code,
          source: diagnostic.source,
        });
        await bot.api.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `❌ Authentication error: ${sanitizeErrorForUser(error)}\n\nCheck your Telegram token.`
        ).catch((notificationError: any) => {
          logger.warn('Failed to send auth error notification to Telegram', {
            chatId: config.TELEGRAM_CHAT_ID,
            error: notificationError.message,
          });
        });
        await exitWithFlush(1);
      }

      if (!isNetworkError(error)) {
        logger.error('Non-recoverable error - shutting down bot', {
          error: error.message,
          code: diagnostic.code,
          source: diagnostic.source,
          errorChain: diagnostic.chain,
        });
        await bot.api.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `❌ Error fatal: ${sanitizeErrorForUser(error)}`
        ).catch((notificationError: any) => {
          logger.warn('Failed to send fatal error notification to Telegram', {
            chatId: config.TELEGRAM_CHAT_ID,
            error: notificationError.message,
          });
        });
        await exitWithFlush(1);
      }

      const delay = calculateBackoff(runnerRetryAttempt);
      
      logger.warn('Error de red detectado - reintentando runner', {
        attempt: runnerRetryAttempt + 1,
        errorCode: diagnostic.code || error.code,
        errorSource: diagnostic.source,
        errorMessage: error.message,
        errorChain: diagnostic.chain,
        retryInMs: delay,
        nextRetryDelaySeconds: Math.round(delay / ONE_SECOND_MS),
      });

      if (runnerRetryAttempt % 5 === 0) {
        await bot.api.sendMessage(
          config.TELEGRAM_CHAT_ID,
          `⚠️ Error de conexión con Telegram (intento #${runnerRetryAttempt + 1})\n\n` +
          `Error: ${sanitizeErrorForUser(error)}\n` +
          `Reintentando en ${Math.round(delay / ONE_SECOND_MS)} segundos...\n\n` +
          `El bot seguirá reintentando automáticamente.`
        ).catch((notificationError: any) => {
          logger.debug('Failed to send retry notification to Telegram (expected during network issues)', {
            chatId: config.TELEGRAM_CHAT_ID,
            retryAttempt: runnerRetryAttempt + 1,
            error: notificationError.message,
          });
        });
      }

      await sleep(delay);
      runnerRetryAttempt++;

      try {
        logger.info('Restarting Telegram runner', {
          attempt: runnerRetryAttempt,
        });
        
        runnerState.runner = run(bot, {
          runner: {
            fetch: {
              allowed_updates: ['message', 'callback_query'],
            },
            maxRetryTime: 5 * 60,
          },
        });

        logger.info('Runner restarted successfully', {
          attempt: runnerRetryAttempt,
          totalRetries: runnerRetryAttempt,
        });
        
        if (runnerRetryAttempt > 0) {
          await bot.api.sendMessage(
            config.TELEGRAM_CHAT_ID,
            `✅ Conexión con Telegram restaurada exitosamente después de ${runnerRetryAttempt} ${runnerRetryAttempt === 1 ? 'intento' : 'intentos'}`
          ).catch((error: any) => {
            logger.warn('Failed to send recovery notification to Telegram', {
              chatId: config.TELEGRAM_CHAT_ID,
              retryAttempts: runnerRetryAttempt,
              error: error.message,
            });
          });
        }

        stabilityTimer = setTimeout(() => {
          logger.info('Runner stable during stability period - resetting retry counter');
          runnerRetryAttempt = 0;
          stabilityTimer = null;
        }, STABILITY_PERIOD_MS);

        attachRunnerErrorHandler();
        return;
      } catch (restartError: any) {
        const restartDiagnostic = extractErrorDiagnostic(restartError);
        logger.error('Error al reiniciar runner', {
          error: restartError.message,
          code: restartDiagnostic.code,
          source: restartDiagnostic.source,
        });
        error = restartError;
      }
    }
  };

  const attachRunnerErrorHandler = () => {
    const task = runnerState.runner.task();
    if (task) {
      task.catch((error: any) => {
        handleRunnerError(error);
      });
    }
  };

  attachRunnerErrorHandler();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }
    
    if (runnerState.runner.isRunning()) {
      await runnerState.runner.stop();
    }
    await sessionManager.destroyAll();
    await copilotClient.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (err) => {
  try {
    const { logger, flushLogger } = await import('./utils/logger');
    logger.error('Error fatal', { err });
    await flushLogger();
  } finally {
    process.exit(1);
  }
});
