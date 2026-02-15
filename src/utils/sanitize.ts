/**
 * Sanitization utility for logging
 * Redacts sensitive data and truncates long text fields
 */

import { MAX_SANITIZE_TEXT_LENGTH, MAX_SANITIZE_DEPTH } from '../constants.js';
import type { JsonValue, ErrorObject } from '../types/sanitize.js';

/**
 * Regex patterns for identifying sensitive field names.
 * Matches tokens, keys, passwords, and secrets.
 */
const SENSITIVE_FIELD_PATTERNS = [
  /(auth|api|access|bearer|refresh|copilot)[_-]?token/i,
  /^tokens?$/i,
  /^(api[_-]?key|secret[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key)$/i,
  /password/i,
  /secret/i,
];

/**
 * Regex patterns for identifying text fields that should be truncated.
 */
const TEXT_FIELD_PATTERNS = [
  /message/i,
  /prompt/i,
  /content/i,
  /usermessage/i,
  /task/i,
];

const MAX_TEXT_LENGTH = MAX_SANITIZE_TEXT_LENGTH;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = MAX_SANITIZE_DEPTH;

/**
 * Check if a field name contains sensitive keywords that should be redacted.
 * 
 * @param fieldName - The name of the field to check
 * @returns true if the field name matches sensitive patterns
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Check if a field name is a text field that should be truncated.
 * 
 * @param fieldName - The name of the field to check
 * @returns true if the field name matches text field patterns
 */
function isTextField(fieldName: string): boolean {
  return TEXT_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Truncate text if it exceeds max length, appending ellipsis.
 * 
 * @param text - The text to truncate
 * @returns The original text if within limit, or truncated text with '...' appended
 */
function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return text.substring(0, MAX_TEXT_LENGTH) + '...';
}

/**
 * Transform Error object to plain object with all properties.
 * Extracts name, message, stack, and any custom properties from the Error instance.
 * 
 * @param error - The Error object to convert
 * @returns Plain object representation with all error properties
 */
function errorToPlainObject(error: Error): ErrorObject {
  const plainObject: ErrorObject = {
    name: error.name,
    message: error.message,
  };
  
  if (error.stack) {
    plainObject.stack = error.stack;
  }
  
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key !== 'name' && key !== 'message' && key !== 'stack') {
      const value = (error as unknown as Record<string, unknown>)[key];
      if (value !== undefined && typeof value !== 'function') {
        plainObject[key] = value as JsonValue;
      }
    }
  }
  
  return plainObject;
}

/**
 * Sanitize a value for logging.
 * Redacts sensitive fields, truncates text, handles circular references.
 * 
 * @param value - The value to sanitize
 * @param fieldName - Optional field name for context-aware sanitization
 * @param seen - Set to track circular references
 * @param depth - Current recursion depth
 * @returns Sanitized value safe for logging
 */
export function sanitizeForLogging(
  value: unknown,
  fieldName?: string,
  seen = new WeakSet<object>(),
  depth = 0
): JsonValue {
  if (depth >= MAX_DEPTH) {
    return '[Max Depth Reached]';
  }

  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    if (fieldName && isSensitiveField(fieldName)) {
      return REDACTED;
    }
    if (fieldName && isTextField(fieldName)) {
      return truncateText(value);
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Error) {
    const plainError = errorToPlainObject(value);
    return sanitizeForLogging(plainError, fieldName, seen, depth + 1);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    
    return value.map((item) => sanitizeForLogging(item, undefined, seen, depth + 1));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const sanitized: Record<string, JsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveField(key)) {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = sanitizeForLogging(val, key, seen, depth + 1);
      }
    }
    return sanitized;
  }

  return String(value);
}
