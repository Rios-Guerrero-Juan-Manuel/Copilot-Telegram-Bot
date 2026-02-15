/**
 * Error sanitizer for user-facing error messages
 * Removes system paths, credentials, and sensitive information
 */

/**
 * Sanitize an error message or Error object for display to users
 * Removes:
 * - Absolute file paths (Windows and Unix)
 * - User home directories
 * - Stack traces
 * - Environment variable values
 * - Credentials and tokens
 * 
 * @param error - Error object, string message, or unknown error
 * @returns Sanitized error message safe for users
 */
export function sanitizeErrorForUser(error: unknown): string {
  if (error === null || error === undefined) {
    return 'An error occurred';
  }

  let message: string;
  if (error instanceof Error) {
    message = error.message || 'An error occurred';
  } else if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object' && 'toString' in error && typeof error.toString === 'function') {
    message = error.toString();
  } else {
    message = String(error);
  }

  if (!message || message.trim().length === 0) {
    return 'An error occurred';
  }

  message = removeStackTraces(message);
  message = removeAbsolutePaths(message);
  message = removeEnvironmentVariables(message);
  message = removeCredentials(message);

  return message.trim() || 'An error occurred';
}

/**
 * Remove stack trace lines from error messages.
 * Filters out lines starting with "at " or "at async ".
 * 
 * @param message - Error message to clean
 * @returns Message without stack trace lines
 */
function removeStackTraces(message: string): string {
  const lines = message.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('at ') && !trimmed.startsWith('at async ');
  });
  
  return filteredLines.join('\n');
}

/**
 * Remove absolute file paths from message.
 * Handles Windows (C:\, UNC) and Unix (/home, /Users, etc.) paths.
 * 
 * @param message - Message to sanitize
 * @returns Message with paths replaced by [PATH]
 */
function removeAbsolutePaths(message: string): string {
  message = message.replace(/(?<![A-Za-z0-9])[A-Z]:\\(?:[^\\:\s"'<>|?*]+\\)*[^\\:\s"'<>|?*]*/gi, '[PATH]');
  message = message.replace(/(?<![A-Za-z0-9])[A-Z]:\/(?:[^\/:\s"'<>|?*]+\/)*[^\/:\s"'<>|?*]*/gi, '[PATH]');
  message = message.replace(/\\\\[^\\\s"'<>|?*]+\\[^\\\s"'<>|?*]+(?:\\[^\\\s"'<>|?*]+)*/g, '[PATH]');
  message = message.replace(/\/(?:home|Users|root|opt|var|usr\/local|tmp|mnt|media)\/[^\s"'<>|?*]*/g, '[PATH]');
  
  return message;
}

/**
 * Remove environment variable assignments from messages.
 * Replaces VAR_NAME=value patterns with VAR_NAME=[REDACTED].
 * 
 * @param message - Message to sanitize
 * @returns Message with environment variable values redacted
 */
function removeEnvironmentVariables(message: string): string {
  message = message.replace(/\b[A-Z_][A-Z0-9_]*=([^\s,;)"']+)/g, (match, value) => {
    const varName = match.substring(0, match.indexOf('='));
    return `${varName}=[REDACTED]`;
  });
  
  return message;
}

/**
 * Remove credentials, tokens, and API keys from messages.
 * Detects GitHub tokens, Telegram bot tokens, JWT tokens, Bearer tokens, and generic secrets.
 * 
 * @param message - Message to sanitize
 * @returns Message with credentials replaced by [TOKEN] or [KEY]
 */
function removeCredentials(message: string): string {
  message = message.replace(/\bgh[a-z]_[a-zA-Z0-9]{36,}\b/g, '[TOKEN]');
  message = message.replace(/\b\d{8,12}:[a-zA-Z0-9_-]{20,}\b/g, '[TOKEN]');
  message = message.replace(/\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[TOKEN]');
  message = message.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer [TOKEN]');
  message = message.replace(/\b[sp]k[-_][a-zA-Z0-9]{10,}\b/g, '[KEY]');
  
  // Only redact long strings with mixed case or very long strings (likely secrets)
  message = message.replace(/\b[a-zA-Z0-9_-]{40,}\b/g, (match) => {
    if ((/[a-z]/.test(match) && /[A-Z]/.test(match)) || match.length >= 60) {
      return '[TOKEN]';
    }
    return match;
  });
  
  return message;
}
