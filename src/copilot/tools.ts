import { defineTool, Tool, type ZodSchema } from '@github/copilot-sdk';
import { InputFile } from 'grammy';
import { z } from 'zod';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { Bot } from 'grammy';
import { config, isPathAllowed } from '../config.js';
import { MAX_TOOL_FILE_SIZE_BYTES } from '../constants.js';
import type { AskUserParams, LogMessageParams, SendFileParams } from '../types/tools.js';
import { escapeHtml } from '../utils/formatter.js';
import { i18n } from '../i18n/index.js';
import { generateCallbackData } from '../bot/keyboard-utils.js';

/**
 * User input request interface (from SDK)
 */
interface UserInputRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

/**
 * User input response interface (from SDK)
 */
interface UserInputResponse {
  answer: string;
  wasFreeform: boolean;
}

/**
 * User input handler type (from SDK)
 */
type UserInputHandler = (
  request: UserInputRequest,
  invocation: { sessionId: string }
) => Promise<UserInputResponse> | UserInputResponse;

/**
 * System message for plan mode
 * 
 * Instructs the AI to generate implementation plans before coding.
 * The AI must analyze requests, ask clarifying questions, create detailed
 * plans with numbered steps, and wait for user approval before implementing.
 */
export const PLAN_MODE_SYSTEM_MESSAGE = `
You are in PLAN MODE. Follow these rules strictly:

1. When the user asks you to implement something, DO NOT start coding immediately.
2. First, analyze the codebase and the request thoroughly.
3. If the request is ambiguous, use the ask_user tool for clarifying questions
   BEFORE generating the plan. You may ask multiple clarifying questions.
4. Once context is sufficient, generate a detailed implementation plan in markdown
   with numbered steps. Include: files to create/modify, key changes, potential risks.
5. Output the plan with these exact markers so it can be extracted:
   ---BEGIN PLAN---
   [full markdown plan]
   ---END PLAN---
6. IMPORTANT: Do NOT use ask_user for final plan approval options.
   After showing the plan, wait for the user's freeform text decision.
7. Interpret freeform decisions:
   - "implement/start/go" => proceed with implementation
   - "modify/change/adjust" => ask what to change and regenerate plan
   - "cancel/reject/stop" => stop and confirm cancellation
8. If user's decision is unclear, ask one concise follow-up question.
9. After implementation completes, use notify_telegram to confirm completion
   with a summary of what was done.
10. While in plan mode, user prompts may be prefixed with [[PLAN]].
     Treat those prompts as planning-only requests.
11. If a prompt is prefixed with [[PLAN_MODE_OFF]], stop plan behavior
     and respond in normal implementation mode.

IMPORTANT: When using ask_user, keep option texts SHORT (≤25 characters).
- Use ask_user only for clarifying questions, not final approval buttons
- Keep each question focused and concise
`;

/**
 * Sentinel value returned when ask_user is cancelled
 * 
 * Contains null bytes to ensure it cannot be confused with legitimate user input.
 */
export const ASK_USER_CANCELLED = '\u0000__ASK_USER_CANCELLED__\u0000';

/**
 * Creates an interactive tool for asking users questions via Telegram
 * 
 * **Best Practices for LLM Usage:**
 * - Keep option texts ≤25 characters to fit within Telegram's 64-byte callback_data limit
 * - Use symbols/emojis to save space (e.g., "✅ Yes" instead of "Approve and proceed")
 * - Prefer abbreviations when clear (e.g., "Modificar" not "Modificar el plan actual")
 * - Long options will be automatically truncated, which may reduce clarity
 * 
 * @param bot - Grammy bot instance
 * @param chatId - Telegram chat ID to send messages to
 * @returns Tool with methods to resolve responses, check pending state, and cancel
 */
export function createAskUserTool(bot: Bot, chatId: string) {
  let pendingResolve: ((value: string) => void) | null = null;
  let pendingReject: ((reason?: unknown) => void) | null = null;
  let pendingToken: string | null = null;
  let pendingTimeoutId: NodeJS.Timeout | null = null;

  function clearPendingTimeout(): void {
    if (pendingTimeoutId) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
  }

  const tool = defineTool('ask_telegram_user', {
    description:
      'Ask the user a question via Telegram and wait for their response.',
    parameters: z.object({
      question: z.string().describe('The question to ask the user'),
      options: z
        .array(z.string())
        .optional()
        .describe('Optional list of choices to present as inline buttons'),
    }) as unknown as ZodSchema<AskUserParams>,
    handler: async ({ question, options }: AskUserParams) => {
      // Cancel previous pending request if exists
      if (pendingResolve) {
        clearPendingTimeout();
        pendingResolve(ASK_USER_CANCELLED);
        pendingResolve = null;
        pendingReject = null;
        pendingToken = null;
      }
      
      const token = Math.random().toString(36).slice(2, 8);
      const keyboard = options?.map((opt: string) => [
        {
          text: opt,
          callback_data: generateCallbackData('ask_user_response', `${token}:${opt}`),
        },
      ]);

      // Create promise that waits indefinitely for user response
      const responsePromise = new Promise<string>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
        pendingToken = token;
        pendingTimeoutId = setTimeout(() => {
          pendingResolve = null;
          pendingReject = null;
          pendingToken = null;
          pendingTimeoutId = null;
          reject(new Error('Timeout: no se recibió respuesta del usuario'));
        }, config.ASK_USER_TIMEOUT);
      });

      try {
        await bot.api.sendMessage(chatId, escapeHtml(question), {
          parse_mode: 'HTML',
          reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
        });
      } catch (error) {
        clearPendingTimeout();
        pendingResolve = null;
        pendingReject = null;
        pendingToken = null;
        throw error;
      }

      const response = await responsePromise;

      if (response === ASK_USER_CANCELLED) {
        return { cancelled: true };
      }
      return { userResponse: response };
    },
  });

  /**
   * Resolves a pending ask_user request with the user's answer
   * 
   * @param answer - User's response text
   * @param token - Optional token to verify response matches request
   * @returns true if response was resolved, false if no pending request or token mismatch
   */
  function resolveResponse(answer: string, token?: string): boolean {
    if (pendingResolve && (!pendingToken || !token || pendingToken === token)) {
      clearPendingTimeout();
      pendingResolve(answer);
      pendingResolve = null;
      pendingReject = null;
      pendingToken = null;
      return true;
    }
    return false;
  }

  /**
   * Checks if there is a pending ask_user request
   * 
   * @returns true if a request is waiting for response, false otherwise
   */
  function hasPending(): boolean {
    return pendingResolve !== null;
  }

  /**
   * Cancels the pending ask_user request
   */
  function cancel(): void {
    if (pendingResolve) {
      clearPendingTimeout();
      pendingResolve(ASK_USER_CANCELLED);
      pendingResolve = null;
      pendingReject = null;
      pendingToken = null;
    }
  }

  return { tool, resolveResponse, hasPending, cancel };
}

/**
 * Creates a tool for sending notifications to users via Telegram
 * @param bot - Grammy bot instance
 * @param chatId - Telegram chat ID to send messages to
 * @returns Tool for sending notifications with different severity levels
 */
export function createNotifyTool(bot: Bot, chatId: string) {
  return defineTool('notify_telegram', {
    description:
      'Send a notification to the user via Telegram (info, warning, error).',
    parameters: z.object({
      message: z.string().describe('Notification message'),
      level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
    }) as unknown as ZodSchema<LogMessageParams>,
    handler: async ({ message, level }: LogMessageParams) => {
      const emoji =
        level === 'warn' ? '⚠️' : level === 'error' ? '❌' : 'ℹ️';
      await bot.api.sendMessage(chatId, `${emoji} ${escapeHtml(message)}`, {
        parse_mode: 'HTML',
      });
      return { notified: true };
    },
  });
}

/**
 * Creates a tool for sending files to users via Telegram
 * 
 * @param bot - Grammy bot instance
 * @param chatId - Telegram chat ID to send files to
 * @returns Tool for sending files up to 50MB with optional captions
 */
export function createSendFileTool(bot: Bot, chatId: string) {
  return defineTool('send_telegram_file', {
    description:
      'Send a file to the user via Telegram. Files up to 50MB are supported.',
    parameters: z.object({
      filePath: z.string().describe('Absolute path to the file to send'),
      caption: z.string().optional().describe('Optional caption for the file'),
    }) as unknown as ZodSchema<SendFileParams>,
    handler: async ({ filePath, caption }: SendFileParams) => {
      const resolvedPath = path.resolve(filePath);

      if (!isPathAllowed(resolvedPath)) {
        return { error: `File path not allowed: ${resolvedPath}` };
      }

      try {
        await fs.access(resolvedPath);
      } catch {
        return { error: `File not found: ${resolvedPath}` };
      }

      const stats = await fs.stat(resolvedPath);
      if (stats.size > MAX_TOOL_FILE_SIZE_BYTES) {
        return { error: 'File exceeds Telegram 50MB limit' };
      }

      await bot.api.sendDocument(chatId, new InputFile(resolvedPath), {
        caption: caption || path.basename(resolvedPath),
      });

      return {
        success: true,
        fileName: path.basename(resolvedPath),
        size: stats.size,
      };
    },
  });
}

/**
 * Creates a handler for SDK user input requests
 * 
 * This wrapper converts between the SDK's UserInputRequest format and our
 * Telegram implementation, maintaining all existing functionality (timeout,
 * tokens, callbacks).
 * 
 * @param askUserTool - The Telegram ask user tool instance
 * @returns UserInputHandler compatible with the SDK
 */
export function createUserInputHandler(
  askUserTool: ReturnType<typeof createAskUserTool>
): UserInputHandler {
  return async (
    request: UserInputRequest,
    invocation: { sessionId: string }
  ): Promise<UserInputResponse> => {
    console.log('[createUserInputHandler] Handler called', {
      question: request.question?.substring(0, 100),
      hasChoices: !!request.choices,
      choicesCount: request.choices?.length,
      allowFreeform: request.allowFreeform,
      sessionId: invocation.sessionId,
    });

    try {
      console.log('[createUserInputHandler] Calling askUserTool.tool.handler (no timeout)');
      
      // Call handler WITHOUT timeout - wait indefinitely for user response
      const result = await askUserTool.tool.handler(
        {
          question: request.question,
          options: request.choices,
        } as AskUserParams,
        {
          sessionId: invocation.sessionId,
          toolCallId: '',
          toolName: 'ask_user',
          arguments: request,
        }
      );

      console.log('[createUserInputHandler] Received result from askUserTool', {
        resultType: typeof result,
        hasUserResponse: typeof result === 'object' && result !== null && 'userResponse' in result,
        hasCancelled: typeof result === 'object' && result !== null && 'cancelled' in result,
      });

      // Handle cancellation
      if (typeof result === 'object' && result !== null && 'cancelled' in result && result.cancelled) {
        console.log('[createUserInputHandler] User cancelled');
        throw new Error('User cancelled the input request');
      }

      // Extract userResponse from result
      const userResponse = typeof result === 'object' && result !== null && 'userResponse' in result
        ? (result as { userResponse: string }).userResponse
        : String(result);

      // Determine if response was freeform
      const wasFreeform =
        !request.choices ||
        request.choices.length === 0 ||
        (request.allowFreeform !== false &&
          !request.choices.includes(userResponse));

      console.log('[createUserInputHandler] Returning response to SDK', {
        answer: userResponse.substring(0, 50),
        wasFreeform,
      });

      return {
        answer: userResponse,
        wasFreeform,
      };
    } catch (error) {
      console.error('[createUserInputHandler] Error in handler:', error);
      // Propagate error to SDK/CLI/LLM
      throw error;
    }
  };
}

/**
 * Creates all Copilot tools for Telegram integration
 * 
 * @param bot - Grammy bot instance
 * @param chatId - Telegram chat ID to send messages to
 * @returns Object containing all tools and their individual instances
 */
export function createTools(bot: Bot, chatId: string) {
  const askUser = createAskUserTool(bot, chatId);
  const sendFile = createSendFileTool(bot, chatId);
  const notify = createNotifyTool(bot, chatId);

  // Create SDK-compatible handler
  const userInputHandler = createUserInputHandler(askUser);

  return {
    all: [sendFile, notify] as Tool<unknown>[],
    askUser,
    notify,
    sendFile,
    userInputHandler,
  };
}
