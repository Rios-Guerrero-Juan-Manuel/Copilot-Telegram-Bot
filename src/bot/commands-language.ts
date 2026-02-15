import { Context } from 'grammy';
import { UserState } from '../state/user-state.js';
import { i18n, LocaleKey } from '../i18n/index.js';
import { InlineKeyboard } from 'grammy';
import { safeLogger } from '../utils/safe-logger.js';

/**
 * Registers language selection commands and handlers
 * 
 * Provides the `/language` command for users to select their preferred language
 * and handles language switching callbacks.
 * 
 * @param bot - Grammy bot instance to register commands on
 * @param userState - User state manager for persisting language preferences
 */
export function registerLanguageCommands(bot: any, userState: UserState): void {
  bot.command('language', async (ctx: Context) => {
    try {
      const telegramId = String(ctx.from?.id);
      if (!telegramId) return;

      const user = userState.getOrCreate(telegramId, ctx.from?.username);
      const currentLocale = userState.getLocale(user.id) as LocaleKey;
      const availableLocales = i18n.getAvailableLocales();

      const keyboard = new InlineKeyboard();
      for (const locale of availableLocales) {
        const flag = locale === 'en' ? '🇬🇧' : '🇪🇸';
        const isCurrent = locale === currentLocale;
        const label = `${flag} ${i18n.getLocaleName(locale)}${isCurrent ? ' ✓' : ''}`;
        keyboard.text(label, `lang_${locale}`).row();
      }

      const message = i18n.t(user.id, 'commands.language.select');
      await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'HTML' });

      safeLogger.info('Language selection shown', {
        userId: user.id,
        currentLocale: String(currentLocale),
        availableLocales: availableLocales.join(','),
      });
    } catch (error) {
      safeLogger.error('Error in /language command', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      await ctx.reply(i18n.t(Number(ctx.from?.id ?? 0), 'errors.generic'));
    }
  });

  bot.callbackQuery(/^lang_(.+)$/, async (ctx: Context) => {
    try {
      const match = ctx.callbackQuery?.data?.match(/^lang_(.+)$/);
      if (!match) return;

      const newLocale = match[1] as LocaleKey;
      const telegramId = String(ctx.from?.id);
      if (!telegramId) return;

      const user = userState.getOrCreate(telegramId, ctx.from?.username);
      
      userState.setLocale(user.id, newLocale);
      i18n.setUserLocale(user.id, newLocale);

      const langName = i18n.getLocaleName(newLocale);
      const message = i18n.t(user.id, 'commands.language.changed', { lang: langName });

      await ctx.answerCallbackQuery();
      await ctx.editMessageText(message, { parse_mode: 'HTML' });

      safeLogger.info('Language changed', {
        userId: user.id,
        newLocale: String(newLocale),
      });
    } catch (error) {
      safeLogger.error('Error in language callback', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      await ctx.answerCallbackQuery(i18n.t(Number(ctx.from?.id ?? 0), 'callbacks.error'));
    }
  });
}
