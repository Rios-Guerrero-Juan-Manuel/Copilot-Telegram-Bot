/**
 * Safe logger wrapper that automatically sanitizes metadata
 * 
 * This wrapper ensures all metadata is sanitized before logging,
 * preventing accidental leakage of sensitive data.
 * 
 * Usage:
 *   import { safeLogger } from './utils/safe-logger';
 *   
 *   safeLogger.info('User login', { 
 *     userId: '123', 
 *     token: 'secret'  // Automatically redacted
 *   });
 */

import { logger } from './logger.js';
import { sanitizeForLogging } from './sanitize.js';
import type { LogMetadata } from '../types/logger.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Safe logger that automatically sanitizes metadata
 */
export const safeLogger = {
  /**
   * Log an error message with optional metadata.
   * 
   * @param message - Error message
   * @param metadata - Optional metadata (automatically sanitized)
   */
  error(message: string, metadata?: LogMetadata): void {
    logger.error(message, metadata ? sanitizeForLogging(metadata) : undefined);
  },

  /**
   * Log a warning message with optional metadata.
   * 
   * @param message - Warning message
   * @param metadata - Optional metadata (automatically sanitized)
   */
  warn(message: string, metadata?: LogMetadata): void {
    logger.warn(message, metadata ? sanitizeForLogging(metadata) : undefined);
  },

  /**
   * Log an info message with optional metadata.
   * 
   * @param message - Info message
   * @param metadata - Optional metadata (automatically sanitized)
   */
  info(message: string, metadata?: LogMetadata): void {
    logger.info(message, metadata ? sanitizeForLogging(metadata) : undefined);
  },

  /**
   * Log a debug message with optional metadata.
   * 
   * @param message - Debug message
   * @param metadata - Optional metadata (automatically sanitized)
   */
  debug(message: string, metadata?: LogMetadata): void {
    logger.debug(message, metadata ? sanitizeForLogging(metadata) : undefined);
  },

  /**
   * Generic log method that accepts a level parameter.
   * 
   * @param level - Log level ('error', 'warn', 'info', 'debug')
   * @param message - Log message
   * @param metadata - Optional metadata (automatically sanitized)
   */
  log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    logger.log(level, message, metadata ? sanitizeForLogging(metadata) : undefined);
  },
};
