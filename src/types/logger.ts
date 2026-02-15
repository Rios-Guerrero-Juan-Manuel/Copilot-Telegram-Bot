/**
 * Logger metadata types
 * Replaces 'any' metadata with structured types
 */

/**
 * Base logger metadata structure
 */
export interface LogMetadata {
  [key: string]: LogMetadataValue;
}

/**
 * Allowed values in log metadata
 */
export type LogMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogMetadataValue[]
  | { [key: string]: LogMetadataValue };

/**
 * Error-specific metadata
 */
export interface ErrorLogMetadata {
  error?: string;
  stack?: string;
  code?: string | number;
  [key: string]: LogMetadataValue;
}

/**
 * Network-specific metadata
 */
export interface NetworkLogMetadata extends LogMetadata {
  url?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
}

/**
 * User action metadata
 */
export interface UserActionLogMetadata extends LogMetadata {
  userId?: number;
  username?: string;
  action?: string;
  timestamp?: number;
}
