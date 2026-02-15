import { Context, Bot } from 'grammy';
import { UserState } from '../state/user-state';
import { parsePaths, updateEnvFile } from '../utils/path-setup';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { sanitizeErrorForUser } from '../utils/error-sanitizer';
import { escapeHtml } from '../utils/formatter';
import { ALLOWLIST_SETUP_DELAY_MS, WIZARD_TIMEOUT_MS } from '../constants';
import { SessionManager } from '../copilot/session-manager';
import { gracefulShutdownWithTimeout } from '../utils/graceful-shutdown';
import Database from 'better-sqlite3';
import { i18n } from '../i18n/index.js';
import { config, setAllowedPaths } from '../config';
import { restartCurrentProcess } from '../utils/process-restart.js';

/**
 * Manages the interactive allowlist setup wizard
 */
export class AllowlistSetupWizard {
  private awaitingInput = new Map<number, boolean>();
  private lastActivity = new Map<number, number>();
  private cleanupTimers = new Map<number, NodeJS.Timeout>();

  private readonly WIZARD_TTL_MS = WIZARD_TIMEOUT_MS;

  /**
   * Creates a new allowlist setup wizard instance
   * @param {UserState} userState - User state management instance
   * @param {Bot} [bot] - Optional Telegram bot instance for graceful shutdown
   * @param {SessionManager} [sessionManager] - Optional session manager for graceful shutdown
   * @param {Database.Database} [db] - Optional database instance for graceful shutdown
   */
  constructor(
    private userState: UserState,
    private bot?: Bot,
    private sessionManager?: SessionManager,
    private db?: Database.Database
  ) {}

  /**
   * Checks if user needs to configure allowlist
   * @param {number} telegramId - The Telegram user ID (from ctx.from.id)
   * @returns {boolean} True if user needs allowlist setup
   */
  needsSetup(telegramId: number): boolean {
    return !this.userState.isAllowedPathsConfiguredByTelegramId(telegramId);
  }

  /**
   * Checks if user is currently in setup wizard
   * @param {number} telegramId - The Telegram user ID (from ctx.from.id)
   * @returns {boolean} True if user is in active setup wizard
   */
  isInSetup(telegramId: number): boolean {
    return this.awaitingInput.get(telegramId) === true;
  }

  /**
   * Starts the allowlist setup wizard
   * @param {Context} ctx - Telegram context
   * @returns {Promise<void>}
   */
  async startSetup(ctx: Context): Promise<void> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const telegramIdStr = String(telegramId);
    const user = this.userState.getOrCreate(telegramIdStr, ctx.from?.username);

    this.awaitingInput.set(telegramId, true);
    this.lastActivity.set(telegramId, Date.now());
    this.scheduleCleanup(telegramId);

    logger.info('Starting allowlist setup wizard', { telegramId });

    await ctx.reply(
      i18n.t(user.id, 'allowlistSetup.title') + '\n\n' +
      i18n.t(user.id, 'allowlistSetup.noDirectories') + '\n\n' +
      i18n.t(user.id, 'allowlistSetup.explanation') + '\n\n' +
      i18n.t(user.id, 'allowlistSetup.instructions') + '\n\n' +
      i18n.t(user.id, 'allowlistSetup.tip'),
      { parse_mode: 'HTML' }
    );
  }

  /**
   * Handles user input during setup wizard
   * @param {Context} ctx - Telegram context
   * @param {string} input - User input containing paths
   * @param {number} telegramId - The Telegram user ID (from ctx.from.id)
   * @returns {Promise<boolean>} True if input was handled by wizard
   * @throws {Error} If there's an error saving the allowlist configuration
   */
  async handleInput(ctx: Context, input: string, telegramId: number): Promise<boolean> {
    if (!this.isInSetup(telegramId)) return false;

    const telegramIdStr = String(telegramId);
    const user = this.userState.getOrCreate(telegramIdStr, ctx.from?.username);

    this.updateActivity(telegramId);

    logger.info('Processing allowlist input', sanitizeForLogging({
      telegramId,
      input,
    }));

    const { valid, invalid } = parsePaths(input);

    if (valid.length === 0) {
      await ctx.reply(
        i18n.t(user.id, 'allowlistSetup.noValidPaths') + '\n\n' +
        invalid.map(i => `• ${escapeHtml(i.path)}\n  <i>${escapeHtml(i.error)}</i>`).join('\n') +
        i18n.t(user.id, 'allowlistSetup.tryAgain'),
        { parse_mode: 'HTML' }
      );
      return true;
    }

    if (invalid.length > 0) {
      await ctx.reply(
        i18n.t(user.id, 'allowlistSetup.warningsTitle') + '\n\n' +
        invalid.map(i => `• ${escapeHtml(i.path)}\n  <i>${escapeHtml(i.error)}</i>`).join('\n'),
        { parse_mode: 'HTML' }
      );
    }

    try {
      updateEnvFile(valid);
      
      this.userState.getOrCreate(String(telegramId), ctx.from?.username);
      this.userState.markAllowedPathsConfiguredByTelegramId(telegramId);
      
      this.cleanupSession(telegramId);

      await ctx.reply(
        i18n.t(user.id, 'allowlistSetup.saved') + '\n\n' +
        '<b>' + i18n.t(user.id, 'allowlistSetup.pathsTitle') + '</b>\n' +
        valid.map(p => `• <code>${escapeHtml(p)}</code>`).join('\n') +
        '\n\n' +
        (config.ALLOWLIST_SETUP_AUTO_RESTART
          ? i18n.t(user.id, 'allowlistSetup.restarting')
          : i18n.t(user.id, 'allowlistSetup.appliedWithoutRestart')) + '\n\n' +
        i18n.t(user.id, 'allowlistSetup.editHint'),
        { parse_mode: 'HTML' }
      );

      logger.info('Allowlist configured successfully', { paths: valid, telegramId });

      // Trigger graceful shutdown after 2 seconds
      // This ensures:
      // 1. Telegram bot stops accepting new messages
      // 2. All active Copilot sessions are closed
      // 3. Database connection is properly closed
      // 4. Logs are flushed before exit
      // 5. Timeout safety (10s max) prevents process from hanging
      setTimeout(async () => {
        setAllowedPaths(valid);
        if (config.ALLOWLIST_SETUP_AUTO_RESTART) {
          const restarted = restartCurrentProcess();
          logger.info('Allowlist setup restart decision', {
            autoRestart: true,
            restartSpawned: restarted,
          });
          logger.info('Triggering graceful shutdown to apply new allowlist configuration');
          
          await gracefulShutdownWithTimeout({
            bot: this.bot,
            sessionManager: this.sessionManager,
            db: this.db,
          }, 0);
        } else {
          logger.info('Allowlist setup applied without restart (runtime allowlist updated)');
        }
      }, ALLOWLIST_SETUP_DELAY_MS);

      return true;
    } catch (error: any) {
      logger.error('Failed to save allowlist configuration', {
        error: error.message,
        telegramId,
      });

      const safeError = escapeHtml(sanitizeErrorForUser(error));
      await ctx.reply(
        i18n.t(user.id, 'allowlistSetup.saveError') + '\n\n' +
        `<code>${safeError}</code>\n\n` +
        i18n.t(user.id, 'allowlistSetup.manualEdit'),
        { parse_mode: 'HTML' }
      );

      this.cleanupSession(telegramId);
      return true;
    }
  }

  /**
   * Cancels setup wizard and cleans up session
   * @param {number} telegramId - The Telegram user ID (from ctx.from.id)
   * @returns {void}
   */
  cancelSetup(telegramId: number): void {
    this.cleanupSession(telegramId);
    logger.info('Allowlist setup wizard cancelled', { telegramId });
  }

  /**
   * Schedules automatic cleanup after TTL expires
   * @param {number} telegramId - The Telegram user ID
   * @returns {void}
   */
  private scheduleCleanup(telegramId: number): void {
    const existingTimer = this.cleanupTimers.get(telegramId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const lastTime = this.lastActivity.get(telegramId);
      if (!lastTime) return;

      const elapsed = Date.now() - lastTime;
      if (elapsed >= this.WIZARD_TTL_MS) {
        logger.info('Wizard session cleaned up due to TTL expiration', {
          telegramId,
          ttlMs: this.WIZARD_TTL_MS,
          elapsedMs: elapsed,
        });
        this.cleanupSession(telegramId);
      }
    }, this.WIZARD_TTL_MS);

    this.cleanupTimers.set(telegramId, timer);
  }

  /**
   * Updates last activity timestamp and reschedules cleanup
   * @param {number} telegramId - The Telegram user ID
   * @returns {void}
   */
  private updateActivity(telegramId: number): void {
    this.lastActivity.set(telegramId, Date.now());
    this.scheduleCleanup(telegramId);
  }

  /**
   * Cleans up session data and associated timers
   * @param {number} telegramId - The Telegram user ID
   * @returns {void}
   */
  private cleanupSession(telegramId: number): void {
    this.awaitingInput.delete(telegramId);
    this.lastActivity.delete(telegramId);
    
    const timer = this.cleanupTimers.get(telegramId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(telegramId);
    }
  }
}
