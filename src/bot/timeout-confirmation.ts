import { Bot } from 'grammy';
import { config } from '../config';
import { logger } from '../utils/logger';
import { generateCallbackData, isCallbackValid } from './keyboard-utils';
import { ONE_SECOND_MS, ONE_MINUTE_MS } from '../constants';
import { i18n } from '../i18n/index.js';

/**
 * Maps user IDs to their pending timeout confirmation resolvers
 */
const pendingTimeoutConfirmations = new Map<
  string,
  {
    resolve: (value: boolean) => void;
    timeoutId: NodeJS.Timeout;
  }
>();

/**
 * Asks the user if they want to extend the timeout
 * 
 * Sends an inline keyboard with Yes/No buttons and waits for user response.
 * 
 * @param userId - The user ID
 * @param chatId - The chat ID
 * @param startTime - When the operation started (timestamp in ms)
 * @param bot - The Telegram bot instance
 * @returns Promise that resolves to true if user wants to extend, false otherwise
 */
export async function askTimeoutExtension(
  userId: string,
  chatId: string,
  startTime: number,
  bot: Bot
): Promise<boolean> {
  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / ONE_MINUTE_MS);
  const seconds = Math.floor((elapsed % ONE_MINUTE_MS) / ONE_SECOND_MS);

  const extensionMinutes = Math.floor(config.TIMEOUT_EXTENSION_MS / ONE_MINUTE_MS);
  
  const userIdNum = Number(userId);

  const question = `⏰ La tarea lleva ${minutes}m ${seconds}s. ¿Quieres extender el tiempo +${extensionMinutes}min más?`;

  logger.info('Asking user for timeout extension', {
    userId,
    chatId,
    elapsedMs: elapsed,
  });

  try {
    await bot.api.sendMessage(chatId, question, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: i18n.t(userIdNum, 'session.timeout.yesExtend'),
              callback_data: generateCallbackData('timeout_extend', userId),
            },
            {
              text: i18n.t(userIdNum, 'session.timeout.noCancel'),
              callback_data: generateCallbackData('timeout_cancel', userId),
            },
          ],
        ],
      },
    });

    const response = await new Promise<'extend' | 'cancel'>((resolve) => {
      const existing = pendingTimeoutConfirmations.get(userId);
      if (existing) {
        clearTimeout(existing.timeoutId);
        existing.resolve(false);
      }

      const timeoutId = setTimeout(() => {
        pendingTimeoutConfirmations.delete(userId);
        logger.info('User timeout confirmation expired', {
          userId,
          chatId,
        });
        resolve('cancel');
      }, config.TIMEOUT_CONFIRMATION_TIME);

      pendingTimeoutConfirmations.set(userId, {
        resolve: (shouldExtend: boolean) => {
          resolve(shouldExtend ? 'extend' : 'cancel');
        },
        timeoutId,
      });
    });

    logger.info('User response to timeout extension', {
      userId,
      chatId,
      response,
    });

    return response === 'extend';
  } catch (error: any) {
    logger.warn('Failed to get user response for timeout extension', {
      userId,
      chatId,
      error: error.message,
    });

    return false;
  }
}

/**
 * Resolves a pending timeout confirmation
 * 
 * Called by the callback handler when user clicks a button.
 * 
 * @param userId - The user ID
 * @param response - Either 'extend' or 'cancel'
 * @returns true if a pending confirmation was resolved, false otherwise
 */
export function resolveTimeoutResponse(
  userId: string,
  response: 'extend' | 'cancel'
): boolean {
  const pending = pendingTimeoutConfirmations.get(userId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeoutId);
  pendingTimeoutConfirmations.delete(userId);
  pending.resolve(response === 'extend');

  return true;
}

/**
 * Registers callback handlers for timeout confirmation buttons
 * 
 * Should be called during bot initialization to handle timeout_extend and timeout_cancel callbacks.
 * 
 * @param bot - The Telegram bot instance
 */
export function registerTimeoutCallbacks(bot: Bot): void {
  bot.callbackQuery(/^timeout_(extend|cancel):(.+)$/, async (ctx) => {
    const callbackData = ctx.callbackQuery?.data ?? '';
    
    if (!isCallbackValid(callbackData)) {
      await ctx.answerCallbackQuery(i18n.t(0, 'callbacks.requestExpired'));
      return;
    }
    
    const action = ctx.match?.[1] ?? '';
    const userId = ctx.match?.[2]?.split(':')[0] ?? ''; 
    
    if (!action || !userId) {
      await ctx.answerCallbackQuery(i18n.t(Number(userId), 'session.timeout.invalidRequest'));
      return;
    }

    const resolved = resolveTimeoutResponse(
      userId,
      action as 'extend' | 'cancel'
    );

    if (resolved) {
      const userIdNum = Number(userId);
      const message =
        action === 'extend'
          ? i18n.t(userIdNum, 'session.timeout.extending')
          : i18n.t(userIdNum, 'session.timeout.cancelling');
      await ctx.answerCallbackQuery(message);
    } else {
      await ctx.answerCallbackQuery(i18n.t(Number(userId), 'callbacks.requestExpired'));
    }
  });
}

/**
 * Checks if a user has a pending timeout confirmation
 * 
 * @param userId - The user ID
 * @returns true if there's a pending confirmation, false otherwise
 */
export function hasPendingTimeoutConfirmation(userId: string): boolean {
  return pendingTimeoutConfirmations.has(userId);
}

/**
 * Cancels a pending timeout confirmation
 * 
 * Clears the timeout and resolves the promise with false.
 * 
 * @param userId - The user ID
 */
export function cancelTimeoutConfirmation(userId: string): void {
  const pending = pendingTimeoutConfirmations.get(userId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingTimeoutConfirmations.delete(userId);
    pending.resolve(false);
  }
}
