/**
 * Interactive AddProject Wizard for adding projects step-by-step
 * 
 * This module provides a step-by-step interactive wizard for adding
 * projects using inline keyboards, integrated with the /addproject command.
 * 
 * Flow:
 * 1. Ask for project name (with validation)
 * 2. Navigate directories (reusing CdWizard-like logic)
 * 3. Show confirmation summary
 * 4. Save project or cancel
 */

import { promises as fs } from 'fs';
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
import { InlineKeyboard } from 'grammy';
import { generateCallbackData } from './keyboard-utils';
import { i18n } from '../i18n/index.js';

/**
 * Wizard session state for a user
 */
interface AddProjectWizardSession {
  userId: number;
  step: 'name' | 'navigate' | 'confirm';
  projectName?: string;
  currentPath: string;
  page: number;
  directories: string[];
  lastActivity: number;
}

/**
 * Result of wizard operations
 */
export interface AddProjectWizardResult {
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
export interface AddProjectWizardStatus {
  step: 'name' | 'navigate' | 'confirm';
  projectName?: string;
  currentPath: string;
  page: number;
}



const VALID_PROJECT_NAME_REGEX = /^[a-zA-Z0-9_\-. ]+$/;

/**
 * AddProject Wizard - Interactive project creation
 */
export class AddProjectWizard {
  private sessions = new Map<number, AddProjectWizardSession>();
  private cleanupTimers = new Map<number, NodeJS.Timeout>();

  /**
   * Creates a new AddProject wizard instance
   * @param {UserState} userState - User state management instance
   */
  constructor(private userState: UserState) {}

  /**
   * Starts a new wizard session for adding a project
   * @param {number} userId - Telegram user ID
   * @returns {Promise<AddProjectWizardResult>} Result containing success status, message, and keyboard
   * @throws {Error} If unexpected error occurs during wizard initialization
   */
  async startWizard(userId: number): Promise<AddProjectWizardResult> {
    try {
      if (this.sessions.has(userId)) {
        return {
          success: false,
          message: i18n.t(userId, 'wizards.addProject.alreadyActive'),
        };
      }

      const telegramId = String(userId);
      const user = this.userState.getOrCreate(telegramId);
      const currentPath = this.userState.getCurrentCwd(user.id);

      // SECURITY: Validate that currentPath is in ALLOWED_PATHS
      if (!isPathAllowed(currentPath)) {
        logger.warn('AddProject wizard rejected: currentCwd not in ALLOWED_PATHS', {
          userId,
          currentPath,
        });
        return {
          success: false,
          message: i18n.t(userId, 'wizards.addProject.pathNotAllowedStart'),
        };
      }

      const session: AddProjectWizardSession = {
        userId,
        step: 'name',
        currentPath,
        page: 0,
        directories: [],
        lastActivity: Date.now(),
      };

      this.sessions.set(userId, session);
      this.scheduleCleanup(userId);

      logger.info('AddProject wizard session started', {
        userId,
        startPath: currentPath,
      });

      const keyboard = this.generateNameInputKeyboard();
      const message = this.generateNameInputMessage();

      return {
        success: true,
        message,
        keyboard,
      };
    } catch (error: any) {
      logger.error('Error starting AddProject wizard', {
        userId,
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
   * Handles project name input and validation
   * @param {number} userId - Telegram user ID
   * @param {string} name - Project name to validate
   * @returns {Promise<AddProjectWizardResult>} Result containing validation status and next step
   */
  async handleNameInput(userId: number, name: string): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.noActiveWizard'),
      };
    }

    this.updateActivity(userId);

    if (!name || name.trim().length === 0) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.nameEmpty'),
      };
    }

    if (!VALID_PROJECT_NAME_REGEX.test(name)) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.invalidCharacters'),
      };
    }

    const telegramId = String(userId);
    const user = this.userState.getOrCreate(telegramId);
    const existingPath = this.userState.getProjectPath(user.id, name);
    
    if (existingPath) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.nameAlreadyExists', { name: escapeHtml(name) }),
      };
    }

    session.projectName = name;
    session.step = 'navigate';

    logger.info('AddProject wizard - name validated and accepted', {
      userId,
      projectName: name,
    });

    const readResult = await readDirectories(session.currentPath);
    if (!readResult.success) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.errorReading', { error: escapeHtml(readResult.error || 'Error desconocido') }),
      };
    }

    session.directories = readResult.directories;

    const keyboard = this.generateNavigationKeyboard(session);
    const message = this.generateNavigationMessage(session);

    return {
      success: true,
      message,
      keyboard,
    };
  }

  /**
   * Handles navigation to a subdirectory or parent directory
   * @param {number} userId - Telegram user ID
   * @param {string} target - Target directory name, '..' for parent, or absolute path
   * @returns {Promise<AddProjectWizardResult>} Result containing updated navigation state
   * @throws {Error} If unexpected error occurs during navigation
   */
  async handleNavigation(userId: number, target: string): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.noActiveWizard'),
      };
    }

    this.updateActivity(userId);

    try {
      const validation = await validateNavigationPath(session.currentPath, target, userId);
      if (!validation.valid || !validation.newPath) {
        return {
          success: false,
          message: validation.error || i18n.t(userId, 'wizards.addProject.errorValidating'),
        };
      }

      const newPath = validation.newPath;

      const readResult = await readDirectories(newPath);
      if (!readResult.success) {
        return {
          success: false,
          message: i18n.t(userId, 'wizards.addProject.errorReading', { error: escapeHtml(readResult.error || 'Error desconocido') }),
        };
      }

      const directories = readResult.directories;

      session.currentPath = newPath;
      session.directories = directories;
      session.page = 0;

      logger.info('AddProject wizard navigated to directory', {
        userId,
        newPath,
        dirCount: directories.length,
      });

      const keyboard = this.generateNavigationKeyboard(session);
      const message = this.generateNavigationMessage(session);

      return {
        success: true,
        message,
        keyboard,
      };
    } catch (error: any) {
      logger.error('Error during AddProject wizard navigation', {
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
   * @returns {Promise<AddProjectWizardResult>} Result containing updated page view
   */
  async handlePageChange(userId: number, page: number): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.noActiveWizard'),
      };
    }

    this.updateActivity(userId);

    if (!isValidPage(page, session.directories.length)) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.invalidPage'),
      };
    }

    session.page = page;

    const keyboard = this.generateNavigationKeyboard(session);
    const message = this.generateNavigationMessage(session);

    return {
      success: true,
      message,
      keyboard,
    };
  }

  /**
   * Shows confirmation step with project summary
   * @param {number} userId - Telegram user ID
   * @returns {Promise<AddProjectWizardResult>} Result containing confirmation message and keyboard
   */
  async handleShowConfirmation(userId: number): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: 'No hay wizard activo.',
      };
    }

    this.updateActivity(userId);

    session.step = 'confirm';

    const keyboard = this.generateConfirmationKeyboard();
    const message = this.generateConfirmationMessage(session);

    return {
      success: true,
      message,
      keyboard,
    };
  }

  /**
   * Handles wizard confirmation and saves the project
   * @param {number} userId - Telegram user ID
   * @returns {Promise<AddProjectWizardResult>} Result containing saved project details
   */
  async handleConfirm(userId: number): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.noActiveWizard'),
      };
    }

    if (!session.projectName) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.errorMissingName'),
      };
    }

    const finalPath = session.currentPath;
    const projectName = session.projectName;

    // SECURITY: Re-validate that finalPath is in ALLOWED_PATHS before saving
    if (!isPathAllowed(finalPath)) {
      logger.warn('AddProject wizard confirmation rejected: path not in ALLOWED_PATHS', {
        userId,
        projectName,
        finalPath,
      });
      
      this.cleanupSession(userId);
      
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.pathNotAllowedConfirm'),
      };
    }

    const telegramId = String(userId);
    const user = this.userState.getOrCreate(telegramId);
    this.userState.addProject(user.id, projectName, finalPath);

    this.cleanupSession(userId);

    logger.info('AddProject wizard confirmed', {
      userId,
      projectName,
      path: finalPath,
    });

    return {
      success: true,
      message: i18n.t(userId, 'wizards.addProject.projectSaved', { name: escapeHtml(projectName), path: escapeHtml(finalPath) }),
      finalPath,
      confirmed: true,
    };
  }

  /**
   * Handles wizard cancellation and cleanup
   * @param {number} userId - Telegram user ID
   * @returns {Promise<AddProjectWizardResult>} Result indicating cancellation
   */
  async handleCancel(userId: number): Promise<AddProjectWizardResult> {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        success: false,
        message: i18n.t(userId, 'wizards.addProject.noActiveWizard'),
      };
    }

    const projectName = session.projectName;

    this.cleanupSession(userId);

    logger.info('AddProject wizard cancelled', {
      userId,
      projectName,
    });

    return {
      success: true,
      message: i18n.t(userId, 'wizards.addProject.cancelled'),
      cancelled: true,
    };
  }

  /**
   * Gets the current status of an active wizard session
   * @param {number} userId - Telegram user ID
   * @returns {AddProjectWizardStatus | undefined} Current wizard status or undefined if no active session
   */
  getStatus(userId: number): AddProjectWizardStatus | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;

    return {
      step: session.step,
      projectName: session.projectName,
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
   * Generates inline keyboard for name input step
   * @returns {InlineKeyboard} Keyboard with cancel button
   */
  private generateNameInputKeyboard(): any {
    const keyboard = new InlineKeyboard();
    keyboard.text('❌ Cancelar', generateCallbackData('addproj_cancel', 'cancel'));
    return keyboard;
  }

  /**
   * Generates message for name input step
   * @returns {string} Localized prompt message for project name
   */
  private generateNameInputMessage(): string {
    return i18n.t(0, 'wizards.addProject.step1Title');
  }

  /**
   * Generates inline keyboard for directory navigation step
   * @param {AddProjectWizardSession} session - Current wizard session
   * @returns {InlineKeyboard} Navigation keyboard with directories and controls
   */
  private generateNavigationKeyboard(session: AddProjectWizardSession): any {
    return generateNavigationKeyboard({
      directories: session.directories,
      page: session.page,
      currentPath: session.currentPath,
      callbackPrefix: 'addproj',
      showConfirmButton: true,
      confirmButtonText: '✅ Seleccionar esta ruta',
      confirmButtonCallback: 'addproj_confirmdir', // Use intermediate callback to show confirmation step
    });
  }

  /**
   * Generates message for directory navigation step
   * @param {AddProjectWizardSession} session - Current wizard session
   * @returns {string} Formatted message with current path and directory list
   */
  private generateNavigationMessage(session: AddProjectWizardSession): string {
    const { projectName, currentPath, directories, page, userId } = session;

    const title = i18n.t(userId, 'wizards.addProject.step2Title', { name: escapeHtml(projectName || 'N/A') });
    
    return generateNavigationMessage(
      userId,
      currentPath,
      directories,
      page,
      title
    );
  }

  /**
   * Generates inline keyboard for confirmation step
   * @returns {InlineKeyboard} Keyboard with confirm and cancel buttons
   */
  private generateConfirmationKeyboard(): any {
    const keyboard = new InlineKeyboard();
    keyboard.text('✅ Confirmar', generateCallbackData('addproj_confirm', 'ok'));
    keyboard.text('❌ Cancelar', generateCallbackData('addproj_cancel', 'cancel'));
    return keyboard;
  }

  /**
   * Generates message for confirmation step with project summary
   * @param {AddProjectWizardSession} session - Current wizard session
   * @returns {string} Formatted summary message for confirmation
   */
  private generateConfirmationMessage(session: AddProjectWizardSession): string {
    const { projectName, currentPath, userId } = session;

    return i18n.t(userId, 'wizards.addProject.step3Title', { 
      name: escapeHtml(projectName || 'N/A'),
      path: escapeHtml(currentPath)
    });
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
          logger.info('AddProject wizard session expired', { userId });
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
