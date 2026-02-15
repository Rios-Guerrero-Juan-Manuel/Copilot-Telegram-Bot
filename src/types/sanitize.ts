/**
 * Sanitization types
 * Replaces 'any' in sanitize operations with structured types
 */

/**
 * JSON-serializable primitive types
 */
export type JsonPrimitive = string | number | boolean | null | undefined;

/**
 * JSON-serializable array
 */
export type JsonArray = JsonValue[];

/**
 * JSON-serializable object
 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Any JSON-serializable value
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Plain object representation of an error
 */
export interface ErrorObject {
  name: string;
  message: string;
  stack?: string;
  [key: string]: JsonValue | undefined;
}

/**
 * Type guard for JsonValue
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }
  
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  
  if (type === 'object') {
    return Object.values(value as object).every(isJsonValue);
  }
  
  return false;
}
