import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';
import { sanitizeForLogging } from './sanitize';

const logDir = path.resolve(config.LOG_DIR);
try {
  fsSync.mkdirSync(logDir, { recursive: true });
} catch {
  // Directory creation is retried asynchronously by initLogger
}
const logDirInitPromise = fs.mkdir(logDir, { recursive: true }).catch(() => undefined);
const isTestEnv = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

/**
 * Initializes the logger directory.
 * 
 * @returns Promise that resolves when directory is created
 */
export async function initLogger(): Promise<void> {
  await logDirInitPromise;
}

/**
 * Flushes pending log entries to disk.
 * 
 * @param timeoutMs - Maximum time to wait for flush in milliseconds
 * @returns Promise that resolves when flush is complete or times out
 */
export async function flushLogger(timeoutMs = 2000): Promise<void> {
  if (isTestEnv) {
    return;
  }

  if ((logger as unknown as { writableEnded?: boolean }).writableEnded) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const timeout = setTimeout(finish, timeoutMs);
    logger.once('finish', () => {
      clearTimeout(timeout);
      finish();
    });
    logger.end();
  });
}

/**
 * Custom log format function for Winston.
 * Sanitizes metadata and formats as: timestamp [level]: message {metadata}
 * 
 * @param info - Log info object from Winston
 * @returns Formatted log string
 */
const logFormat = format.printf(({ level, message, timestamp, ...meta }) => {
  const sanitizedMeta = sanitizeForLogging(meta);
  const extra = sanitizedMeta && typeof sanitizedMeta === 'object' && Object.keys(sanitizedMeta).length 
    ? ` ${JSON.stringify(sanitizedMeta)}` 
    : '';
  return `${timestamp} [${level}]: ${message}${extra}`;
});

export const logger = createLogger({
  level: config.LOG_LEVEL,
  format: format.combine(format.timestamp(), logFormat),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.timestamp(), logFormat),
    }),
    ...(!isTestEnv
      ? [
          new DailyRotateFile({
            filename: path.join(logDir, 'combined-%DATE%.log'),
            datePattern: config.LOG_DATE_PATTERN,
            maxSize: config.LOG_MAX_SIZE,
            maxFiles: config.LOG_MAX_FILES,
            format: format.combine(format.timestamp(), logFormat),
          }),
          new DailyRotateFile({
            filename: path.join(logDir, 'error-%DATE%.log'),
            datePattern: config.LOG_DATE_PATTERN,
            maxSize: config.LOG_MAX_SIZE,
            maxFiles: config.LOG_MAX_FILES,
            level: 'error',
            format: format.combine(format.timestamp(), logFormat),
          }),
        ]
      : []),
  ],
});
