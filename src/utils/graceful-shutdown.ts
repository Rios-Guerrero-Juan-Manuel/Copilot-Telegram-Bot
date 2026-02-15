import { Bot } from 'grammy';
import { SessionManager } from '../copilot/session-manager.js';
import { DatabaseManager } from '../state/database.js';
import { logger } from './logger.js';
import { GRACEFUL_SHUTDOWN_TIMEOUT_MS } from '../constants.js';
import Database from 'better-sqlite3';
import { getErrorMessage } from '../types/errors.js';

/**
 * Interface for resources that need graceful shutdown
 */
export interface ShutdownResources {
  bot?: Bot;
  sessionManager?: SessionManager;
  db?: Database.Database;
}

/**
 * Performs graceful shutdown of application resources.
 * 
 * Ensures all resources are properly closed before process.exit:
 * 1. Stop bot (no new messages accepted)
 * 2. Close all active Copilot sessions
 * 3. Close database connections
 * 4. Flush logs
 * 
 * @param resources - Resources to shutdown
 * @param exitCode - Exit code to use (default: 0)
 * @returns Promise that resolves when shutdown is complete
 */
export async function gracefulShutdown(
  resources: ShutdownResources,
  exitCode: number = 0
): Promise<void> {
  logger.info('Starting graceful shutdown...', { exitCode });

  try {
    if (resources.bot) {
      logger.info('Stopping Telegram bot...');
      try {
        await resources.bot.stop();
        logger.info('Telegram bot stopped successfully');
      } catch (error: unknown) {
        logger.error('Error stopping Telegram bot', { error: getErrorMessage(error) });
      }
    }

    if (resources.sessionManager) {
      logger.info('Closing active Copilot sessions...');
      try {
        await resources.sessionManager.destroyAll();
        logger.info('Copilot sessions closed successfully');
      } catch (error: unknown) {
        logger.error('Error closing Copilot sessions', { error: getErrorMessage(error) });
      }
    }

    if (resources.db) {
      logger.info('Closing database connection...');
      try {
        resources.db.close();
        logger.info('Database connection closed successfully');
      } catch (error: unknown) {
        logger.error('Error closing database', { error: getErrorMessage(error) });
      }
    }

    logger.info('Flushing logs...');
    try {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          logger.info('Graceful shutdown complete');
          resolve();
        }, 100);
      });
    } catch (error: unknown) {
      logger.error('Error flushing logs', { error: getErrorMessage(error) });
    }

  } catch (error: unknown) {
    logger.error('Error during graceful shutdown', { error: getErrorMessage(error) });
  } finally {
    process.exit(exitCode);
  }
}

/**
 * Performs graceful shutdown with a safety timeout.
 * 
 * If shutdown takes longer than GRACEFUL_SHUTDOWN_TIMEOUT_MS (10s),
 * forces process.exit(1) to prevent the process from hanging.
 * 
 * @param resources - Resources to shutdown
 * @param exitCode - Exit code to use for successful shutdown (default: 0)
 * @returns Promise that resolves when shutdown is complete (or times out)
 */
export async function gracefulShutdownWithTimeout(
  resources: ShutdownResources,
  exitCode: number = 0
): Promise<void> {
  const shutdownPromise = gracefulShutdown(resources, exitCode);
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Graceful shutdown timeout exceeded'));
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  });

  try {
    await Promise.race([shutdownPromise, timeoutPromise]);
  } catch (error: unknown) {
    const err = getErrorMessage(error);
    if (err === 'Graceful shutdown timeout exceeded') {
      logger.error('Forced shutdown after timeout', { 
        timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
        exitCode: 1,
      });
      process.exit(1);
    } else {
      logger.error('Unexpected error during graceful shutdown', { 
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      });
      process.exit(1);
    }
  }
}
