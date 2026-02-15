/**
 * Wizard Utilities - Shared functions for interactive wizards
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { InlineKeyboard } from 'grammy';
import { isPathAllowed } from '../config';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/formatter';
import { generateCallbackData } from './keyboard-utils';
import { WIZARD_TIMEOUT_MS } from '../constants';
import { i18n } from '../i18n/index.js';

/**
 * Number of directories displayed per page in wizards
 */
export const DIRS_PER_PAGE = 8;

/**
 * Wizard timeout duration (5 minutes)
 */
export const WIZARD_TIMEOUT = WIZARD_TIMEOUT_MS;

/**
 * Result of directory reading operation
 */
export interface DirectoryReadResult {
  success: boolean;
  directories: string[];
  error?: string;
}

/**
 * Result of path validation
 */
export interface PathValidationResult {
  valid: boolean;
  newPath?: string;
  error?: string;
}

/**
 * Navigation keyboard configuration
 */
export interface NavigationKeyboardConfig {
  directories: string[];
  page: number;
  currentPath: string;
  callbackPrefix: string; // e.g., 'cd' or 'addproj'
  showConfirmButton?: boolean;
  confirmButtonText?: string;
  confirmButtonCallback?: string; // Custom callback prefix for confirm button (defaults to callbackPrefix_confirm)
}

/**
 * Reads directories from a path with error handling
 * @param {string} targetPath - Path to read directories from
 * @returns {Promise<DirectoryReadResult>} Result containing success status and directory list
 */
export async function readDirectories(targetPath: string): Promise<DirectoryReadResult> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    
    return {
      success: true,
      directories,
    };
  } catch (error: any) {
    logger.error('Failed to read directory', {
      path: targetPath,
      error: error.message,
    });
    return {
      success: false,
      directories: [],
      error: error.message,
    };
  }
}

/**
 * Validates and calculates new path from navigation target
 * @param {string} currentPath - Current directory path
 * @param {string} target - Navigation target (directory name, '..' for parent, or absolute path)
 * @param {number} userId - User ID for i18n
 * @returns {Promise<PathValidationResult>} Validation result with new path if valid
 */
export async function validateNavigationPath(
  currentPath: string,
  target: string,
  userId: number
): Promise<PathValidationResult> {
  try {
    let newPath: string;
    if (target === '..') {
      newPath = path.dirname(currentPath);
    } else if (path.isAbsolute(target)) {
      newPath = target;
    } else {
      newPath = path.join(currentPath, target);
    }

    newPath = path.resolve(newPath);

    if (!isPathAllowed(newPath)) {
      return {
        valid: false,
        error: i18n.t(userId, 'errors.pathNotAllowedByConfig'),
      };
    }

    try {
      const stats = await fs.stat(newPath);
      if (!stats.isDirectory()) {
        return {
          valid: false,
          error: i18n.t(userId, 'errors.invalidPathOrNotDirectory'),
        };
      }
    } catch {
      return {
        valid: false,
        error: '❌ El directorio no existe o no es accesible.',
      };
    }

    return {
      valid: true,
      newPath,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `❌ Error: ${escapeHtml(error.message)}`,
    };
  }
}

/**
 * Generates inline keyboard for directory navigation
 * @param {NavigationKeyboardConfig} config - Configuration for keyboard generation
 * @returns {InlineKeyboard} Formatted inline keyboard with navigation buttons
 */
export function generateNavigationKeyboard(config: NavigationKeyboardConfig): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const { directories, page, currentPath, callbackPrefix, showConfirmButton, confirmButtonText, confirmButtonCallback } = config;

  const totalPages = Math.ceil(directories.length / DIRS_PER_PAGE);
  const startIndex = page * DIRS_PER_PAGE;
  const endIndex = Math.min(startIndex + DIRS_PER_PAGE, directories.length);
  const visibleDirs = directories.slice(startIndex, endIndex);

  for (let i = 0; i < visibleDirs.length; i += 2) {
    const dir1 = visibleDirs[i];
    const dir2 = visibleDirs[i + 1];

    const truncateDir = (dirName: string) => 
      dirName.length > 20 ? dirName.substring(0, 18) + '..' : dirName;

    if (dir2) {
      keyboard.text(
        `📁 ${truncateDir(dir1)}`,
        generateCallbackData(`${callbackPrefix}_nav`, dir1)
      ).text(
        `📁 ${truncateDir(dir2)}`,
        generateCallbackData(`${callbackPrefix}_nav`, dir2)
      );
      keyboard.row();
    } else {
      keyboard.text(
        `📁 ${truncateDir(dir1)}`,
        generateCallbackData(`${callbackPrefix}_nav`, dir1)
      );
      keyboard.row();
    }
  }

  if (currentPath !== path.parse(currentPath).root) {
    keyboard.text('⬆️ Directorio superior', generateCallbackData(`${callbackPrefix}_nav`, '..'));
    keyboard.row();
  }

  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text('◀️ Anterior', generateCallbackData(`${callbackPrefix}_page`, String(page - 1)));
    }
    keyboard.text(`${page + 1}/${totalPages}`, `${callbackPrefix}_page_info`);
    if (page < totalPages - 1) {
      keyboard.text('▶️ Siguiente', generateCallbackData(`${callbackPrefix}_page`, String(page + 1)));
    }
    keyboard.row();
  }

  if (showConfirmButton) {
    const confirmCallback = confirmButtonCallback || `${callbackPrefix}_confirm`;
    keyboard.text(confirmButtonText || '✅ Confirmar', generateCallbackData(confirmCallback, 'ok'));
    keyboard.row();
  }
  keyboard.text('❌ Cancelar', generateCallbackData(`${callbackPrefix}_cancel`, 'cancel'));

  return keyboard;
}

/**
 * Generates formatted message for directory navigation
 * @param {number} userId - Telegram user ID for localization
 * @param {string} currentPath - Current directory path
 * @param {string[]} directories - List of subdirectories
 * @param {number} page - Current page number (zero-based)
 * @param {string} [title] - Optional custom title for the message
 * @returns {string} Formatted HTML message with path and directory information
 */
export function generateNavigationMessage(
  userId: number,
  currentPath: string,
  directories: string[],
  page: number,
  title?: string
): string {
  const totalPages = Math.ceil(directories.length / DIRS_PER_PAGE);
  
  let message = title ? `${title}\n\n` : `${i18n.t(userId, 'wizards.cd.navigationTitle')}\n\n`;
  message += `📍 Ruta actual:\n<code>${escapeHtml(currentPath)}</code>\n\n`;

  if (directories.length === 0) {
    message += `${i18n.t(userId, 'wizards.cd.noSubdirectories')}\n\n`;
  } else {
    const startIndex = page * DIRS_PER_PAGE;
    const endIndex = Math.min(startIndex + DIRS_PER_PAGE, directories.length);
    message += `📁 Subdirectorios (${startIndex + 1}-${endIndex} de ${directories.length}):\n`;

    if (totalPages > 1) {
      message += `📄 Página ${page + 1} de ${totalPages}\n`;
    }
    message += '\n';
  }

  message += '<i>Selecciona un directorio para navegar o confirma la ruta actual.</i>';

  return message;
}

/**
 * Validates if a page number is within valid range
 * @param {number} page - Page number to validate (zero-based)
 * @param {number} totalItems - Total number of items being paginated
 * @returns {boolean} True if page is valid
 */
export function isValidPage(page: number, totalItems: number): boolean {
  const totalPages = Math.ceil(totalItems / DIRS_PER_PAGE);
  return page >= 0 && page < totalPages;
}

/**
 * Schedules automatic cleanup for an expired wizard session
 * @param {number} userId - Telegram user ID
 * @param {() => number | undefined} getSessionActivity - Function that returns last activity timestamp
 * @param {() => void} cleanupCallback - Callback to execute on cleanup
 * @returns {NodeJS.Timeout} Timer handle for the scheduled cleanup
 */
export function scheduleWizardCleanup(
  userId: number,
  getSessionActivity: () => number | undefined,
  cleanupCallback: () => void
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    const lastActivity = getSessionActivity();
    if (lastActivity !== undefined) {
      const age = Date.now() - lastActivity;
      if (age >= WIZARD_TIMEOUT) {
        logger.info('Wizard session expired', { userId });
        cleanupCallback();
      }
    }
  }, WIZARD_TIMEOUT);

  return timer;
}

/**
 * Checks if a path is at filesystem root
 * @param {string} targetPath - Path to check
 * @returns {boolean} True if path is at root level
 */
export function isAtRoot(targetPath: string): boolean {
  return targetPath === path.parse(targetPath).root;
}

/**
 * Truncates directory name if it exceeds maximum length
 * @param {string} dirName - Directory name to truncate
 * @param {number} [maxLength=20] - Maximum allowed length
 * @returns {string} Truncated directory name with ellipsis if needed
 */
export function truncateDirectoryName(dirName: string, maxLength: number = 20): string {
  if (dirName.length > maxLength) {
    return dirName.substring(0, maxLength - 2) + '..';
  }
  return dirName;
}
