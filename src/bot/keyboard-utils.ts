/**
 * This module provides utilities for creating inline keyboards with expiration
 * and validating callback data timestamps to prevent stale interactions.
 */

import { config } from '../config';
import { TELEGRAM_MAX_CALLBACK_DATA_LENGTH } from '../constants';
import { logger } from '../utils/logger';

/**
 * Keyboard Time-To-Live in milliseconds
 * Loaded from central configuration
 */
export const KEYBOARD_TTL_MS = config.KEYBOARD_TTL_MS;

/**
 * Calculates the byte length of a string in UTF-8 encoding
 * 
 * @param str - The string to measure
 * @returns The byte length of the string
 */
function getByteLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Truncates data to fit within Telegram's callback_data limit
 * 
 * Ensures the complete callback string (action:data:timestamp) fits within 64 bytes.
 * 
 * @param action - The action identifier
 * @param data - The data payload to potentially truncate
 * @returns Truncated data that will fit within the limit
 */
function truncateCallbackData(action: string, data: string): string {
  const timestamp = '1234567890123'; 
  const separators = '::'; 
  
  const overhead = getByteLength(action + separators + timestamp);
  const availableForData = TELEGRAM_MAX_CALLBACK_DATA_LENGTH - overhead;
  
  if (getByteLength(data) <= availableForData) {
    return data;
  }
  
  let truncated = data;
  while (getByteLength(truncated) > availableForData && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  
  logger.warn('Callback data truncated to fit Telegram limit', {
    action,
    originalLength: data.length,
    originalBytes: getByteLength(data),
    truncatedLength: truncated.length,
    truncatedBytes: getByteLength(truncated),
    limit: TELEGRAM_MAX_CALLBACK_DATA_LENGTH,
  });
  
  return truncated;
}

/**
 * Generates callback_data with embedded timestamp
 * 
 * Format: action:data:timestamp
 * Automatically truncates data to fit within Telegram's 64-byte limit.
 * 
 * @param action - The action identifier (e.g., 'model', 'project_switch')
 * @param data - The data payload (may contain colons, will be truncated if too long)
 * @returns Callback data string with timestamp appended, guaranteed to fit in 64 bytes
 */
export function generateCallbackData(action: string, data: string): string {
  const timestamp = Date.now();
  const truncatedData = truncateCallbackData(action, data);
  const callbackData = `${action}:${truncatedData}:${timestamp}`;
  
  const finalLength = getByteLength(callbackData);
  if (finalLength > TELEGRAM_MAX_CALLBACK_DATA_LENGTH) {
    logger.error('Callback data still exceeds limit after truncation', {
      action,
      data: truncatedData,
      length: finalLength,
      limit: TELEGRAM_MAX_CALLBACK_DATA_LENGTH,
    });
    return callbackData.slice(0, TELEGRAM_MAX_CALLBACK_DATA_LENGTH);
  }
  
  return callbackData;
}

/**
 * Validates callback data timestamp
 * 
 * Checks if the callback was created within the TTL window.
 * 
 * @param callbackData - The callback_data string with timestamp
 * @returns true if callback is still valid, false if expired
 */
export function isCallbackValid(callbackData: string): boolean {
  const parts = callbackData.split(':');
  
  if (parts.length < 2) {
    return false;
  }
  
  const timestampStr = parts[parts.length - 1];
  const timestamp = parseInt(timestampStr);
  
  if (isNaN(timestamp) || timestamp <= 0) {
    return false;
  }
  
  const age = Date.now() - timestamp;
  return age >= 0 && age < KEYBOARD_TTL_MS;
}

/**
 * Extracts action and data from callback data (removing timestamp)
 * 
 * @param callbackData - The callback_data string with timestamp
 * @returns Object with action and data (data may contain colons)
 */
export function extractCallbackParts(callbackData: string): { action: string; data: string } {
  const parts = callbackData.split(':');
  
  const partsWithoutTimestamp = parts.slice(0, -1);
  
  const action = partsWithoutTimestamp[0] || '';
  
  const data = partsWithoutTimestamp.slice(1).join(':');
  
  return { action, data };
}
