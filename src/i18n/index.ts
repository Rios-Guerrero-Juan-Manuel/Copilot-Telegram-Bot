import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LocaleKey, I18nConfig, Translations } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Internationalization manager for handling translations and user locales.
 */
class I18n {
  private translations: Map<LocaleKey, Translations> = new Map();
  private config: I18nConfig;
  private userLocales: Map<number, LocaleKey> = new Map();

  /**
   * Creates a new I18n instance and loads all translation files.
   * 
   * @param {I18nConfig} config - Configuration object with default and supported locales
   */
  constructor(config: I18nConfig) {
    this.config = config;
    this.loadTranslations();
  }

  /**
   * Loads translation files for all supported locales from the locales directory.
   * Logs errors for any failed loads but continues with other locales.
   * 
   * @private
   */
  private loadTranslations(): void {
    for (const locale of this.config.supportedLocales) {
      try {
        const filePath = join(__dirname, 'locales', `${locale}.json`);
        const content = readFileSync(filePath, 'utf-8');
        const translations = JSON.parse(content) as Translations;
        this.translations.set(locale, translations);
      } catch (error) {
        console.error(`Failed to load translations for locale: ${locale}`, error);
      }
    }
  }

  /**
   * Sets the preferred locale for a specific user.
   * 
   * @param {number} userId - The Telegram user ID
   * @param {LocaleKey} locale - The locale to set for this user
   * @throws {Error} If the locale is not in the supported locales list
   */
  setUserLocale(userId: number, locale: LocaleKey): void {
    if (!this.config.supportedLocales.includes(locale)) {
      throw new Error(`Unsupported locale: ${locale}`);
    }
    this.userLocales.set(userId, locale);
  }

  /**
   * Gets the preferred locale for a specific user.
   * 
   * @param {number} userId - The Telegram user ID
   * @returns {LocaleKey} The user's locale, or the default locale if not set
   */
  getUserLocale(userId: number): LocaleKey {
    return this.userLocales.get(userId) || this.config.defaultLocale;
  }

  /**
   * Translates a key to the user's locale with optional parameter substitution.
   * Supports nested keys using dot notation (e.g., 'commands.help.title').
   * Parameters in translation strings use {paramName} syntax.
   * 
   * @param {number} userId - The Telegram user ID
   * @param {string} key - The translation key, supports dot notation for nested keys
   * @param {Record<string, string | number>} [params] - Optional parameters to substitute in the translation
   * @returns {string} The translated string with parameters substituted, or the key if translation fails
   */
  t(userId: number, key: string, params?: Record<string, string | number>): string {
    const locale = this.getUserLocale(userId);
    const translations = this.translations.get(locale);
    
    if (!translations) {
      console.error(`Translations not found for locale: ${locale}`);
      return key;
    }

    const keys = key.split('.');
    let value: any = translations;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.error(`Translation key not found: ${key} for locale: ${locale}`);
        return key;
      }
    }

    if (typeof value !== 'string') {
      console.error(`Translation value is not a string: ${key}`);
      return key;
    }

    if (!params) {
      return value;
    }

    return Object.entries(params).reduce((text, [param, paramValue]) => {
      return text.replace(new RegExp(`\\{${param}\\}`, 'g'), String(paramValue));
    }, value);
  }

  /**
   * Gets the list of all available locales.
   * 
   * @returns {LocaleKey[]} Array of supported locale keys
   */
  getAvailableLocales(): LocaleKey[] {
    return this.config.supportedLocales;
  }

  /**
   * Gets the human-readable name for a locale.
   * 
   * @param {LocaleKey} locale - The locale key
   * @returns {string} The human-readable name (e.g., 'English' for 'en')
   */
  getLocaleName(locale: LocaleKey): string {
    const names: Record<LocaleKey, string> = {
      en: 'English',
      es: 'Español',
    };
    return names[locale] || locale;
  }
}

/**
 * Default i18n configuration from environment variables or fallback values.
 */
const defaultConfig: I18nConfig = {
  defaultLocale: (process.env.DEFAULT_LANGUAGE as LocaleKey) || 'en',
  supportedLocales: (process.env.SUPPORTED_LANGUAGES?.split(',') as LocaleKey[]) || ['en', 'es'],
};

/**
 * Global i18n instance configured with default settings.
 */
export const i18n = new I18n(defaultConfig);
export type { LocaleKey } from './types.js';
