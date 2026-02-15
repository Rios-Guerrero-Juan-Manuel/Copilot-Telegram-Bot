import { logger } from './logger.js';
import { config } from '../config.js';
import { HTTP_STATUS_UNAUTHORIZED, HTTP_STATUS_FORBIDDEN } from '../constants.js';
import type { NetworkError, AuthError, ErrorWithMessage } from '../types/errors.js';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

/**
 * Network error codes that should trigger retry logic
 */
const NETWORK_ERROR_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'EAI_AGAIN',
];

/**
 * Check if a value contains network error indicators.
 * 
 * @param obj - Object to check
 * @returns true if object contains network error code or message
 */
function hasNetworkErrorCode(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  
  const record = obj as Record<string, unknown>;
  
  if (record.code && typeof record.code === 'string' && NETWORK_ERROR_CODES.includes(record.code)) {
    return true;
  }
  
  if (record.errno) {
    const errno = String(record.errno);
    if (NETWORK_ERROR_CODES.includes(errno)) {
      return true;
    }
  }
  
  if (record.message && typeof record.message === 'string') {
    for (const code of NETWORK_ERROR_CODES) {
      if (record.message.includes(code)) {
        return true;
      }
    }
    if (record.message.includes('socket hang up')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Recursively checks for network errors in error chains with cycle protection.
 * 
 * @param error - The error object to check
 * @param visited - WeakSet to track visited objects and prevent cycles
 * @param depth - Current recursion depth (max 10 levels)
 * @returns true if network error found in chain
 */
function hasNetworkErrorRecursive(error: unknown, visited: WeakSet<object>, depth: number): boolean {
  if (typeof error !== 'object' || error === null || depth > 10) {
    return false;
  }
  
  if (visited.has(error)) {
    return false;
  }
  visited.add(error);
  
  if (hasNetworkErrorCode(error)) {
    return true;
  }
  
  const err = error as Record<string, unknown>;
  
  if (err.error && typeof err.error === 'object') {
    if (hasNetworkErrorRecursive(err.error, visited, depth + 1)) {
      return true;
    }
  }
  
  if (err.cause && typeof err.cause === 'object') {
    if (hasNetworkErrorRecursive(err.cause, visited, depth + 1)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Determines if an error is a network error that should be retried.
 * Checks top-level properties as well as nested error/cause objects recursively.
 * 
 * @param error - Error object to check
 * @returns true if the error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  
  const visited = new WeakSet<object>();
  return hasNetworkErrorRecursive(error, visited, 0);
}

/**
 * Determines if an error is an authentication/authorization error (should NOT retry).
 * 
 * @param error - Error object to check
 * @returns true if the error is an authentication/authorization error
 */
export function isAuthError(error: unknown): error is AuthError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const err = error as Record<string, unknown>;
  
  if (err.status === HTTP_STATUS_UNAUTHORIZED || err.status === HTTP_STATUS_FORBIDDEN) {
    return true;
  }

  const message = err.message;
  if (message && typeof message === 'string') {
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('invalid token') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('forbidden')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates exponential backoff delay with optional jitter.
 * 
 * @param attempt - Current attempt number (0-indexed)
 * @param initialDelay - Initial delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Calculated delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  initialDelay: number = config.TELEGRAM_RETRY_INITIAL_DELAY_MS,
  maxDelay: number = config.TELEGRAM_RETRY_MAX_DELAY_MS
): number {
  const delay = initialDelay * Math.pow(2, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Sleep utility for delays.
 * 
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return sleepTimeout(ms).then(() => undefined);
}

/**
 * Error diagnostic information extracted from error chains
 */
export interface ErrorDiagnostic {
  /** Primary error code (e.g., 'ETIMEDOUT', '401') */
  code?: string;
  /** Error source/type (e.g., 'HttpError', 'FetchError', 'Error') */
  source?: string;
  /** Full error chain for debugging */
  chain: string[];
}

/**
 * Extracts diagnostic information from nested error objects.
 * Handles grammY HttpError/FetchError wrapping patterns.
 * 
 * @param error - Error object to extract diagnostics from
 * @returns Diagnostic information including code, source, and error chain
 */
export function extractErrorDiagnostic(error: unknown): ErrorDiagnostic {
  const chain: string[] = [];
  let code: string | undefined;
  let source: string | undefined;
  
  const visited = new WeakSet<object>();
  let current = error;
  let depth = 0;
  const maxDepth = 10;
  
  while (current && depth < maxDepth) {
    if (typeof current === 'object' && current !== null) {
      if (visited.has(current)) break;
      visited.add(current);
    } else {
      break;
    }
    
    const obj = current as Record<string, unknown>;
    
    if (!source) {
      if (obj.constructor?.name && obj.constructor.name !== 'Object') {
        source = obj.constructor.name;
      } else if (typeof obj.name === 'string' && obj.name !== 'Error') {
        source = obj.name;
      }
    }
    
    if (obj.code && typeof obj.code === 'string' && !code) {
      code = obj.code;
    }
    if (obj.status && typeof obj.status === 'number' && !code) {
      code = String(obj.status);
    }
    if (obj.errno && !code) {
      code = String(obj.errno);
    }
    
    const desc: string[] = [];
    if (obj.constructor?.name && obj.constructor.name !== 'Object') {
      desc.push(obj.constructor.name);
    }
    if (obj.message && typeof obj.message === 'string') {
      const msg = obj.message.length > 80 
        ? obj.message.substring(0, 77) + '...' 
        : obj.message;
      desc.push(`"${msg}"`);
    }
    if (obj.code && typeof obj.code === 'string') {
      desc.push(`[${obj.code}]`);
    }
    
    if (desc.length > 0) {
      chain.push(desc.join(' '));
    }
    
    if (obj.error && typeof obj.error === 'object') {
      current = obj.error;
    } else if (obj.cause && typeof obj.cause === 'object') {
      current = obj.cause;
    } else {
      break;
    }
    
    depth++;
  }
  
  return { code, source, chain };
}

/**
 * Wraps a function with retry logic using exponential backoff.
 * 
 * @param fn - Function to execute with retry logic
 * @param options - Retry configuration options
 * @returns Result of the function execution
 * @throws Last error if all retry attempts are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: ErrorWithMessage, delay: number) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? config.TELEGRAM_RETRY_MAX_ATTEMPTS;
  const initialDelay = options?.initialDelay ?? config.TELEGRAM_RETRY_INITIAL_DELAY_MS;
  const maxDelay = options?.maxDelay ?? config.TELEGRAM_RETRY_MAX_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (isAuthError(error)) {
        logger.error('Authentication/authorization error - not retrying', {
          error: error.message,
          code: error.code,
          status: (error as AuthError).statusCode,
        });
        throw error;
      }

      if (!isNetworkError(error)) {
        const err = error as Partial<ErrorWithMessage>;
        logger.error('Non-network error - not retrying', {
          error: err.message ?? 'Unknown error',
          code: (err as Partial<NetworkError>).code,
        });
        throw error;
      }

      if (attempt === maxAttempts - 1) {
        break;
      }

      const delay = calculateBackoff(attempt, initialDelay, maxDelay);

      logger.warn('Network error detected - will retry', {
        attempt: attempt + 1,
        maxAttempts,
        errorCode: error.code,
        errorMessage: error.message,
        retryInMs: delay,
      });

      if (options?.onRetry) {
        options.onRetry(attempt + 1, error, delay);
      }

      await sleep(delay);
    }
  }

  const err = lastError as Partial<ErrorWithMessage & NetworkError>;
  logger.error('Max retries exhausted - giving up', {
    maxAttempts,
    lastError: err.message ?? 'Unknown error',
    lastErrorCode: err.code,
  });

  throw lastError;
}
