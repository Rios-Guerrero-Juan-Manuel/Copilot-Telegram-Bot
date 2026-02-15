import { type Context } from 'grammy';
import { ONE_SECOND_MS } from '../constants';
import { i18n } from '../i18n/index.js';

/**
 * Creates a rate limiting middleware for the Grammy bot
 * 
 * Prevents message spam by enforcing a minimum interval between consecutive
 * messages from the same user. Only applies to the configured allowed chat.
 * 
 * @param allowedChatId - The Telegram chat ID allowed to use the bot
 * @param minIntervalMs - Minimum milliseconds between messages (default: 1 second)
 * @returns Grammy middleware function for rate limiting
 */
export function createRateLimitMiddleware(
  allowedChatId: string,
  minIntervalMs = ONE_SECOND_MS
) {
  const lastMessageAtByUser = new Map<string, number>();

  return async (ctx: Context, next: () => Promise<void>) => {
    if (String(ctx.from?.id) !== allowedChatId) {
      return;
    }

    if (ctx.message) {
      const telegramId = String(ctx.from?.id ?? '');
      const now = Date.now();
      const lastMessageAt = lastMessageAtByUser.get(telegramId) ?? 0;

      if (now - lastMessageAt < minIntervalMs) {
        await ctx.reply(i18n.t(0, 'bot.rateLimitExceeded'));
        return;
      }

      lastMessageAtByUser.set(telegramId, now);
    }

    await next();
  };
}
