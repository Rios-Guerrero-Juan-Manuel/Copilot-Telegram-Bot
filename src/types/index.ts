import { Tool } from '@github/copilot-sdk';

/**
 * Tuple of all valid AI model identifiers
 * 
 * Includes Claude, GPT, and Gemini model variants supported by the application.
 */
export const MODEL_ID_VALUES = [
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-4',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-4.1',
  'gemini-3-pro-preview',
] as const;

/**
 * Type representing a valid AI model identifier
 * 
 * Derived from MODEL_ID_VALUES to ensure type safety.
 */
export type ModelId = (typeof MODEL_ID_VALUES)[number];

/**
 * Saved project information
 */
export interface ProjectInfo {
  name: string;
  path: string;
}

/**
 * Array of all valid model IDs for runtime checks
 */
export const MODEL_IDS: ModelId[] = [...MODEL_ID_VALUES];

/**
 * Bundle of Copilot tools for Telegram integration
 * 
 * Contains all registered tools and utility methods for managing
 * ask_user interactions.
 */
export interface ToolBundle {
  all: Tool<unknown>[];
  askUser: {
    resolveResponse: (answer: string, token?: string) => boolean;
    hasPending: () => boolean;
    cancel: () => void;
  };
  userInputHandler: (
    request: {
      question: string;
      choices?: string[];
      allowFreeform?: boolean;
    },
    invocation: { sessionId: string }
  ) => Promise<{ answer: string; wasFreeform: boolean }> | { answer: string; wasFreeform: boolean };
}

export * from './errors.js';
export * from './logger.js';
export * from './tools.js';
export * from './database.js';
export * from './sanitize.js';
