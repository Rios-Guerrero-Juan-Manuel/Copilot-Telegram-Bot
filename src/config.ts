import 'dotenv/config';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';
import { MODEL_ID_VALUES, ModelId } from './types';
import {
  DEFAULT_TELEGRAM_UPDATE_INTERVAL_MS,
  DEFAULT_ASK_USER_TIMEOUT_MS,
  DEFAULT_COPILOT_OPERATION_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_WARNING_INTERVAL_MS,
  DEFAULT_HEARTBEAT_UPDATE_INTERVAL_MS,
  DEFAULT_TIMEOUT_EXTENSION_MS,
  DEFAULT_MAX_TIMEOUT_DURATION_MS,
  DEFAULT_TIMEOUT_CONFIRMATION_TIME_MS,
  DEFAULT_TELEGRAM_RETRY_MAX_ATTEMPTS,
  DEFAULT_TELEGRAM_RETRY_INITIAL_DELAY_MS,
  DEFAULT_TELEGRAM_RETRY_MAX_DELAY_MS,
  DEFAULT_STALE_PERIOD_THRESHOLD_MS,
  DEFAULT_INPUT_SIZE_BYTES,
  DEFAULT_BUFFER_SIZE_BYTES,
  DEFAULT_KEYBOARD_TTL_MS,
  MIN_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
  MIN_TIMEOUT_EXTENSION_MS,
  MAX_TIMEOUT_EXTENSION_MS,
  MIN_MAX_TIMEOUT_DURATION_MS,
  MAX_MAX_TIMEOUT_DURATION_MS,
  MIN_TIMEOUT_CONFIRMATION_MS,
  MAX_TIMEOUT_CONFIRMATION_MS,
  MIN_RETRY_ATTEMPTS,
  MAX_RETRY_ATTEMPTS,
  MIN_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  MIN_TIMEOUT_MS as MIN_RETRY_DELAY_LOWER,
  MAX_RETRY_DELAY_LIMIT_MS,
  MIN_STALE_PERIOD_MS,
  MAX_STALE_PERIOD_MS,
  MIN_INPUT_SIZE_BYTES,
  MAX_INPUT_SIZE_BYTES,
  MIN_BUFFER_SIZE_BYTES,
  MAX_BUFFER_SIZE_BYTES,
  MIN_KEYBOARD_TTL_MS,
  MAX_KEYBOARD_TTL_MS,
} from './constants';

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN es obligatorio'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'TELEGRAM_CHAT_ID es obligatorio'),

  COPILOT_CLI_PATH: z.string().default('copilot'),
  COPILOT_DEFAULT_MODEL: z
    .enum([MODEL_ID_VALUES[0], ...MODEL_ID_VALUES.slice(1)])
    .default('claude-sonnet-4.5'),

  DEFAULT_PROJECT_PATH: z.string().default(os.homedir()),
  ALLOWED_PATHS: z.string().default(''),
  ALLOWLIST_SETUP_AUTO_RESTART: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return true;
      if (typeof val === 'boolean') return val;
      return String(val).toLowerCase() === 'true';
    },
    z.boolean()
  ),
  ALLOWLIST_ADMIN_AUTO_RESTART: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return false;
      if (typeof val === 'boolean') return val;
      return String(val).toLowerCase() === 'true';
    },
    z.boolean()
  ),

  COPILOT_MCP_CONFIG_PATH: z
    .string()
    .default(path.join(os.homedir(), '.copilot', 'mcp-config.json')),

  DB_PATH: z.string().default('./data/state.db'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_DIR: z.string().default('./logs'),
  LOG_MAX_SIZE: z.string().default('20m'),
  LOG_MAX_FILES: z.string().default('14d'),
  LOG_DATE_PATTERN: z.string().default('YYYY-MM-DD'),

  TELEGRAM_UPDATE_INTERVAL: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TELEGRAM_UPDATE_INTERVAL_MS;
      return Number(val);
    },
    z.number()
  ),
  ASK_USER_TIMEOUT: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_ASK_USER_TIMEOUT_MS;
      return Number(val);
    },
    z.number()
  ),
  MAX_SESSIONS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return 5;
      return Number(val);
    },
    z.number()
  ),
  COPILOT_OPERATION_TIMEOUT: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_COPILOT_OPERATION_TIMEOUT_MS;
      return Number(val);
    },
    z.number().min(MIN_TIMEOUT_MS).max(MAX_OPERATION_TIMEOUT_MS)
  ),
  HEARTBEAT_WARNING_INTERVAL: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_HEARTBEAT_WARNING_INTERVAL_MS;
      return Number(val);
    },
    z.number()
  ),
  HEARTBEAT_UPDATE_INTERVAL: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_HEARTBEAT_UPDATE_INTERVAL_MS;
      return Number(val);
    },
    z.number()
  ),
  TIMEOUT_EXTENSION_MS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TIMEOUT_EXTENSION_MS;
      return Number(val);
    },
    z.number().min(MIN_TIMEOUT_EXTENSION_MS).max(MAX_TIMEOUT_EXTENSION_MS)
  ),
  MAX_TIMEOUT_DURATION: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_MAX_TIMEOUT_DURATION_MS;
      return Number(val);
    },
    z.number().min(MIN_MAX_TIMEOUT_DURATION_MS).max(MAX_MAX_TIMEOUT_DURATION_MS)
  ),
  TIMEOUT_CONFIRMATION_TIME: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TIMEOUT_CONFIRMATION_TIME_MS;
      return Number(val);
    },
    z.number().min(MIN_TIMEOUT_CONFIRMATION_MS).max(MAX_TIMEOUT_CONFIRMATION_MS)
  ),
  TELEGRAM_RETRY_MAX_ATTEMPTS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TELEGRAM_RETRY_MAX_ATTEMPTS;
      return Number(val);
    },
    z.number().min(MIN_RETRY_ATTEMPTS).max(MAX_RETRY_ATTEMPTS)
  ),
  TELEGRAM_RETRY_INITIAL_DELAY_MS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TELEGRAM_RETRY_INITIAL_DELAY_MS;
      return Number(val);
    },
    z.number().min(MIN_RETRY_DELAY_MS).max(MAX_RETRY_DELAY_MS)
  ),
  TELEGRAM_RETRY_MAX_DELAY_MS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_TELEGRAM_RETRY_MAX_DELAY_MS;
      return Number(val);
    },
    z.number().min(MIN_TIMEOUT_MS).max(MAX_RETRY_DELAY_LIMIT_MS)
  ),
  STALE_PERIOD_THRESHOLD_MS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_STALE_PERIOD_THRESHOLD_MS;
      return Number(val);
    },
    z.number().min(MIN_STALE_PERIOD_MS).max(MAX_STALE_PERIOD_MS)
  ),
  MAX_INPUT_SIZE_BYTES: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_INPUT_SIZE_BYTES;
      return Number(val);
    },
    z.number().min(MIN_INPUT_SIZE_BYTES).max(MAX_INPUT_SIZE_BYTES)
  ),
  MAX_BUFFER_SIZE_BYTES: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_BUFFER_SIZE_BYTES;
      return Number(val);
    },
    z.number().min(MIN_BUFFER_SIZE_BYTES).max(MAX_BUFFER_SIZE_BYTES)
  ),
  KEYBOARD_TTL_MS: z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return DEFAULT_KEYBOARD_TTL_MS;
      return Number(val);
    },
    z.number().min(MIN_KEYBOARD_TTL_MS).max(MAX_KEYBOARD_TTL_MS)
  ),
});

/**
 * Application configuration type derived from the Zod schema
 */
export type AppConfig = z.infer<typeof configSchema>;

/**
 * Loads and validates application configuration from environment variables
 * @returns Validated configuration object
 * @throws {Error} If required environment variables are missing or invalid
 */
function loadConfig(): AppConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuration error. Check your .env file:\n${errors}\n\n` +
        'Copy .env.example to .env and fill in the required values.'
    );
  }
  return result.data;
}

/**
 * Global application configuration object loaded from environment variables
 */
let config: AppConfig;

try {
  config = loadConfig();
} catch (error) {
  if (process.env.SKIP_INTERACTIVE_SETUP !== 'true') {
    throw error;
  }
  throw error;
}

export { config };

/**
 * Gets the list of allowed paths from environment configuration
 * @returns Array of resolved absolute paths that are allowed for access
 */
export function getAllowedPaths(): string[] {
  return (process.env.ALLOWED_PATHS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

/**
 * Array of allowed filesystem paths resolved at startup
 */
export const allowedPaths = getAllowedPaths();

/**
 * Flag indicating whether the allowlist setup wizard needs to run
 */
export const needsAllowlistSetup = allowedPaths.length === 0;

if (needsAllowlistSetup) {
  console.warn(
    '⚠️  SECURITY: ALLOWED_PATHS is empty. The bot will request configuration on first startup.'
  );
}

/**
 * Checks if a given path is within the allowed paths
 * Resolves symlinks and normalizes paths to prevent bypass attacks
 * @param targetPath - Path to check
 * @returns true if the path is allowed, false otherwise
 */
export function isPathAllowed(targetPath: string): boolean {
  const currentAllowedPaths = getAllowedPaths();
  
  if (currentAllowedPaths.length === 0) {
    return false;
  }
  
  const normalize = (input: string) => {
    const cleaned =
      process.platform === 'win32' && input.startsWith('\\\\?\\')
        ? input.slice(4)
        : input;
    return process.platform === 'win32' ? cleaned.toLowerCase() : cleaned;
  };
  
  // SECURITY FIX: Resolve symlinks to prevent bypass
  let realPath: string;
  try {
    realPath = fs.realpathSync(targetPath);
  } catch {
    realPath = path.resolve(targetPath);
  }
  
  const resolved = normalize(realPath);
  return currentAllowedPaths.some((allowedRaw) => {
    const allowed = normalize(allowedRaw);
    if (resolved === allowed) return true;
    const relative = path.relative(allowed, resolved);
    return (
      relative !== '' &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative)
    );
  });
}

const DEFAULT_ALLOWED_EXECUTABLES = [
  'node',
  'node.exe',
  'python',
  'python.exe',
  'python3',
  'python3.exe',
  'npx',
  'npx.cmd',
  'deno',
  'deno.exe',
  'bun',
  'bun.exe',
];

/**
 * Gets the list of allowed executables for MCP servers
 * @returns Array of executable names that are allowed to run as MCP servers
 */
export function getAllowedExecutables(): string[] {
  const envValue = process.env.MCP_ALLOWED_EXECUTABLES;
  
  if (!envValue || envValue.trim() === '') {
    return DEFAULT_ALLOWED_EXECUTABLES;
  }
  
  return envValue.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Sets the allowed paths in environment configuration
 * @param paths - Array of absolute paths to allow
 */
export function setAllowedPaths(paths: string[]): void {
  process.env.ALLOWED_PATHS = paths.join(',');
}
