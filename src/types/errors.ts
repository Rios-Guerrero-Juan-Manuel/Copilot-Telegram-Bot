/**
 * Type-safe error handling types
 * Replaces 'any' types in catch blocks with proper error types
 */

/**
 * Standard error with message property
 */
export interface ErrorWithMessage {
  message: string;
}

/**
 * Network-related errors
 */
export interface NetworkError extends ErrorWithMessage {
  code?: string;
  errno?: number;
  syscall?: string;
}

/**
 * Telegram API errors
 */
export interface TelegramError extends ErrorWithMessage {
  response?: {
    error_code?: number;
    description?: string;
  };
}

/**
 * Authentication errors
 */
export interface AuthError extends ErrorWithMessage {
  code?: number;
  statusCode?: number;
}

/**
 * Type guard to check if value is an error with message
 */
export function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Type guard to check if value is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return (
    isErrorWithMessage(error) &&
    ('code' in error || 'errno' in error || 'syscall' in error)
  );
}

/**
 * Type guard to check if value is a Telegram error
 */
export function isTelegramError(error: unknown): error is TelegramError {
  return (
    isErrorWithMessage(error) &&
    'response' in error &&
    typeof (error as Record<string, unknown>).response === 'object'
  );
}

/**
 * Type guard to check if value is an auth error
 */
export function isAuthError(error: unknown): error is AuthError {
  return (
    isErrorWithMessage(error) &&
    ('code' in error || 'statusCode' in error)
  );
}

/**
 * Convert unknown error to ErrorWithMessage
 */
export function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
  if (isErrorWithMessage(maybeError)) return maybeError;

  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    // Fallback in case there's an error stringifying
    return new Error(String(maybeError));
  }
}

/**
 * Get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  return toErrorWithMessage(error).message;
}
