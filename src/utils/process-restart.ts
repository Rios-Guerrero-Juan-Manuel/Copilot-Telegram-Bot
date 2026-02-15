import { spawn } from 'child_process';
import { logger } from './logger.js';

/**
 * Attempts to restart current Node.js process in background.
 * Returns true when spawn succeeds, false otherwise.
 */
export function restartCurrentProcess(): boolean {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return false;
  }

  try {
    const args = process.argv.slice(1);
    if (args.length === 0) {
      logger.warn('Cannot restart process: no startup arguments available');
      return false;
    }

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();
    logger.info('Background restart process spawned successfully');
    return true;
  } catch (error: any) {
    logger.error('Failed to spawn restart process', {
      error: error?.message || String(error),
    });
    return false;
  }
}
