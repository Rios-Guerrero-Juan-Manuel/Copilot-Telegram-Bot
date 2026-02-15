/**
 * Tool handler parameter types
 * Replaces 'any' in tool handlers with specific types
 */

/**
 * AskUser tool parameters
 */
export interface AskUserParams {
  question: string;
  options?: string[];
}

/**
 * LogMessage tool parameters
 */
export interface LogMessageParams {
  message: string;
  level?: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * SendFile tool parameters
 */
export interface SendFileParams {
  filePath: string;
  caption?: string;
}
