/**
 * Interactive CD Wizard for directory navigation
 * 
 * This module provides a step-by-step interactive wizard for navigating
 * directories using inline keyboards, integrated with the /cd command.
 */

import * as path from 'path';
import { UserState } from '../state/user-state';
import { isPathAllowed } from '../config';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/formatter';
import {
  readDirectories,
  validateNavigationPath,
  generateNavigationKeyboard,
  generateNavigationMessage,
  isValidPage,
  DIRS_PER_PAGE,
  WIZARD_TIMEOUT,
} from './wizard-utils';
import { generateCallbackData } from './keyboard-utils';
import { i18n } from '../i18n/index.js';

/**
 * Wizard session state for a user
 */
interface CdWizardSession {
  userId: number;
  currentPath: string;
  page: number;
  directories: string[];
  lastActivity: number;
}

/**
 * Result of wizard operations
 */
export interface CdWizardResult {
  success: boolean;
  message: string;
  keyboard?: any;
  finalPath?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/**
 * Wizard status for external queries
 */
export interface CdWizardStatus {
  currentPath: string;
  page: number;
}



/**
 * CD Wizard - Interactive directory navigation
 */
export class CdWizard {
  private sessions = new Map<number, CdWizardSession>();
  private cleanupTimers = new Map<number, NodeJS.Timeout>();

  /**
   * Creates a new CD wizard instance
   * @param {UserState} userState - User state management instance
   */
  constructor(private userState: UserState) {}

  /**
   * Starts a new wizard session for directory navigation
   * @param {number} userId - Telegram user ID
   * @param {string} currentPath - Starting directory path
   * @returns {Promise<CdWizardResult>} Result containing success status, message, and keyboard
   * @throws {Error} If unexpected error occurs during wizard initialization
   */
  async startWizard(userId: number, currentPath: string): Promise<CdWizardResult> {
    try {
      if (this.sessions.has(userId)) {
        return {
          success: false,
          message: i18n.t(userId, 'wizards.cd.alreadyActive'),
        };
      }

      if (!isPathAllowed(currentPath)) {
        return {
          success: false,
          message: i18n.t(userId, 'errors.pathNotAllowedByConfig'),
        };
      }

      const readResult = await readDirectories(currentPath);
      if (!readResult.success) {
        return {
          success: false,
          message: i18n.t(userId, 'wizards.cd.errorReading', { error: escapeHtml(readResult.error || 'Error desconocido') }),
        };
      }

      const directories = readResult.directories;

      const session: CdWizardSession = {
        userId,
        currentPath,
        page: 0,
        directories,
        lastActivity: Date.now(),
      };

      this.sessions.set(userId, session);
      this.scheduleCleanup(userId);

      logger.info('CD wizard session started', {
        userId,
        path: currentPath,
        dirCount: directories.length,
      });

      const keyboard = generateNavigationKeyboard({
        directories: session.directories,
        page: session.page,
        currentPath: session.currentPath,
        callbackPrefix: 'cd',
        showConfirmButton: true,
        confirmButtonText: '✅ Confirmar',
      });
      const message = generateNavigationMessage(
        userId,
        session.currentPath,
        session.directories,
        session.page
      );

      return {
        success: true,
        message,
        keyboard,
      };
    } catch (error: any) {
      logger.error('Error starting CD wizard', {
        userId,
        path: currentPath,
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        message: i18n.t(userId, 'errors.generic'),
      };
    }
  }

  /**
   * Handles navigation to a subdirectory or parent directory
   * @param {number} userId - Telegram user ID
   * @param {string} target - Target directory name, '..' for parent, or absolute path
   * @returns {Promise<CdWizardResult>} Result containing updated navigation state
   * @throws {Error} If unexpected error occurs during navigation
   */
  async handleNavigation(userId: number, target: string): Promise<CdWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.cd.noActiveWizard'),
      };
    }

    this.updateActivity(userId);

    try {
      const validation = await validateNavigationPath(session.currentPath, target, userId);
      if (!validation.valid || !validation.newPath) {
        return {
          success: false,
          message: validation.error || i18n.t(userId, 'wizards.cd.errorValidating'),
        };
      }

      const newPath = validation.newPath;

      const readResult = await readDirectories(newPath);
      if (!readResult.success) {
        return {
          success: false,
          message: i18n.t(userId, 'wizards.cd.errorReading', { error: escapeHtml(readResult.error || 'Error desconocido') }),
        };
      }

      const directories = readResult.directories;

      session.currentPath = newPath;
      session.directories = directories;
      session.page = 0;

      logger.info('CD wizard navigated to directory', {
        userId,
        newPath,
        dirCount: directories.length,
      });

      const keyboard = generateNavigationKeyboard({
        directories: session.directories,
        page: session.page,
        currentPath: session.currentPath,
        callbackPrefix: 'cd',
        showConfirmButton: true,
        confirmButtonText: '✅ Confirmar',
      });
      const message = generateNavigationMessage(
        userId,
        session.currentPath,
        session.directories,
        session.page
      );

      return {
        success: true,
        message,
        keyboard,
      };
    } catch (error: any) {
      logger.error('Error during CD wizard navigation', {
        userId,
        target,
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        message: i18n.t(userId, 'errors.generic'),
      };
    }
  }

  /**
   * Handles page change for directory list pagination
   * @param {number} userId - Telegram user ID
   * @param {number} page - Target page number (zero-based)
   * @returns {Promise<CdWizardResult>} Result containing updated page view
   */
  async handlePageChange(userId: number, page: number): Promise<CdWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.cd.noActiveWizard'),
      };
    }

    this.updateActivity(userId);

    if (!isValidPage(page, session.directories.length)) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.cd.invalidPage'),
      };
    }

    session.page = page;

    const keyboard = generateNavigationKeyboard({
      directories: session.directories,
      page: session.page,
      currentPath: session.currentPath,
      callbackPrefix: 'cd',
      showConfirmButton: true,
      confirmButtonText: '✅ Confirmar',
    });
    const message = generateNavigationMessage(
      userId,
      session.currentPath,
      session.directories,
      session.page
    );

    return {
      success: true,
      message,
      keyboard,
    };
  }

  /**
   * Handles wizard confirmation and selects the current directory as final choice
   * @param {number} userId - Telegram user ID
   * @returns {Promise<CdWizardResult>} Result containing selected path and confirmation status
   */
  async handleConfirm(userId: number): Promise<CdWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.cd.noActiveWizard'),
      };
    }

    const finalPath = session.currentPath;

    this.cleanupSession(userId);

    logger.info('CD wizard confirmed', {
      userId,
      path: finalPath,
    });

    return {
      success: true,
      message: i18n.t(userId, 'wizards.cd.directorySelected', { path: escapeHtml(finalPath) }),
      finalPath,
      confirmed: true,
    };
  }

  /**
   * Handles wizard cancellation and cleanup
   * @param {number} userId - Telegram user ID
   * @returns {Promise<CdWizardResult>} Result indicating cancellation
   */
  async handleCancel(userId: number): Promise<CdWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.cd.noActiveWizard'),
      };
    }

    this.cleanupSession(userId);

    logger.info('CD wizard cancelled', { userId });

    return {
      success: true,
      message: i18n.t(userId, 'wizards.cd.cancelled'),
      cancelled: true,
    };
  }

  /**
   * Gets the current status of an active wizard session
   * @param {number} userId - Telegram user ID
   * @returns {CdWizardStatus | undefined} Current wizard status or undefined if no active session
   */
  getStatus(userId: number): CdWizardStatus | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;

    return {
      currentPath: session.currentPath,
      page: session.page,
    };
  }

  /**
   * Checks if user has an active wizard session
   * @param {number} userId - Telegram user ID
   * @returns {boolean} True if user has active wizard session
   */
  hasActiveWizard(userId: number): boolean {
    return this.sessions.has(userId);
  }

  /**
   * Updates the last activity timestamp for a user's session
   * @param {number} userId - Telegram user ID
   * @returns {void}
   */
  private updateActivity(userId: number): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Schedules automatic cleanup for expired session
   * @param {number} userId - Telegram user ID
   * @returns {void}
   */
  private scheduleCleanup(userId: number): void {
    const existingTimer = this.cleanupTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      const session = this.sessions.get(userId);
      if (session) {
        const age = Date.now() - session.lastActivity;
        if (age >= WIZARD_TIMEOUT) {
          logger.info('CD wizard session expired', { userId });
          this.cleanupSession(userId);
        } else {
          this.scheduleCleanup(userId);
        }
      }
    }, WIZARD_TIMEOUT);

    this.cleanupTimers.set(userId, timer);
  }

  /**
   * Cleans up wizard session and associated timers
   * @param {number} userId - Telegram user ID
   * @returns {void}
   */
  private cleanupSession(userId: number): void {
    this.sessions.delete(userId);

    const timer = this.cleanupTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(userId);
    }
  }

  /**
   * Clears all wizard sessions and timers, typically called on bot restart
   * @returns {void}
   */
  clearAll(): void {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.sessions.clear();
    this.cleanupTimers.clear();
  }
}
