/**
 * Robust environment variable parser that supports:
 * - Values with commas inside quotes
 * - Single and double quotes
 * - Escape sequences
 * - Complex real-world scenarios
 * 
 * @module env-parser
 */
import { sanitizeErrorForUser } from '../utils/error-sanitizer';
import { escapeHtml } from '../utils/formatter';
import { i18n } from '../i18n/index.js';

/**
 * Parse environment variables from a string format: KEY=VALUE,KEY2=VALUE2
 * 
 * Supports:
 * - Simple format: KEY=value,KEY2=value2
 * - Quoted values: KEY="value,with,commas"
 * - Single quotes: KEY='value,with,commas'
 * - Escape sequences: KEY=value\,with\,escaped
 * - Mixed: KEY="quoted",KEY2=unquoted,KEY3='single'
 * 
 * @param input - The input string containing environment variables
 * @returns Object with parsed environment variables
 * @throws Error if the input format is invalid
 */
export function parseEnvVariables(input: string): Record<string, string> {
  if (!input || input.trim() === '' || input.trim() === '-') {
    return {};
  }

  const result: Record<string, string> = {};
  const trimmedInput = input.trim();
  
  let i = 0;
  let currentKey = '';
  let currentValue = '';
  let inKey = true;
  let inQuote: '"' | "'" | null = null;
  let escaped = false;
  let valueWasQuoted = false;

  while (i < trimmedInput.length) {
    const char = trimmedInput[i];
    const nextChar = i + 1 < trimmedInput.length ? trimmedInput[i + 1] : null;

    if (char === '\\' && !escaped) {
      escaped = true;
      i++;
      continue;
    }

    if (!escaped && (char === '"' || char === "'")) {
      if (!inQuote) {
        if (inKey) {
          throw new Error('Invalid format: quotes not allowed in keys');
        }
        inQuote = char;
        valueWasQuoted = true;
      } else if (inQuote === char) {
        inQuote = null;
      } else {
        currentValue += char;
      }
      i++;
      continue;
    }

    if (!escaped && !inQuote && char === '=' && inKey) {
      if (currentKey.trim() === '') {
        throw new Error('Invalid format: empty key before equals sign');
      }
      inKey = false;
      i++;
      continue;
    }

    if (!escaped && !inQuote && char === ',') {
      if (currentKey.trim() !== '') {
        if (inKey) {
          throw new Error(`Invalid format: missing value for key "${escapeHtml(currentKey.trim())}"`);
        }
        
        const trimmedValue = currentValue.trim();
        if (trimmedValue === '' && !valueWasQuoted) {
          throw new Error(`Invalid format: empty value for key "${escapeHtml(currentKey.trim())}"`);
        }
        
        result[currentKey.trim()] = trimmedValue;
      }
      
      currentKey = '';
      currentValue = '';
      inKey = true;
      valueWasQuoted = false;
      i++;
      continue;
    }

    if (escaped) {
      if (inKey) {
        currentKey += char;
      } else {
        currentValue += char;
      }
      escaped = false;
    } else {
      if (inKey) {
        currentKey += char;
      } else {
        currentValue += char;
      }
    }

    i++;
  }

  if (inQuote) {
    throw new Error(`Unclosed quote: ${inQuote} quote was not closed`);
  }

  if (escaped) {
    throw new Error('Invalid format: escape character at end of string');
  }

  if (currentKey.trim() !== '') {
    if (inKey) {
      throw new Error(`Invalid format: missing value for key "${escapeHtml(currentKey.trim())}"`);
    }
    
    const trimmedValue = currentValue.trim();
    if (trimmedValue === '' && !valueWasQuoted) {
      throw new Error(`Invalid format: empty value for key "${escapeHtml(currentKey.trim())}"`);
    }
    
    result[currentKey.trim()] = trimmedValue;
  }

  return result;
}

/**
 * Validate environment variable key
 * Keys should follow standard conventions: alphanumeric, underscore, uppercase
 * 
 * @param key - The key to validate
 * @returns true if valid, false otherwise
 */
export function isValidEnvKey(key: string): boolean {
  // Allow alphanumeric, underscore, and must start with letter or underscore
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

/**
 * Format error message for user display
 * 
 * @param error - The error that occurred
 * @returns User-friendly error message
 */
export function formatParseError(error: unknown): string {
  if (error instanceof Error) {
    return i18n.t(0, 'envParser.errorParsing', { error: escapeHtml(sanitizeErrorForUser(error)) });
  }
  return i18n.t(0, 'envParser.unknownError');
}
