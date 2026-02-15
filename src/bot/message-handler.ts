import { Bot, Context } from 'grammy';
import { CopilotSession } from '@github/copilot-sdk';
import { config, isPathAllowed } from '../config';
import { splitMessage } from '../utils/message-splitter';
import { formatForTelegram, escapeHtml } from '../utils/formatter';
import { SessionManager } from '../copilot/session-manager';
import { UserState } from '../state/user-state';
import { McpRegistry } from '../mcp/mcp-registry';
import { WizardManager } from './wizard-manager';
import { AllowlistSetupWizard } from './allowlist-setup';
import { ToolBundle } from '../types';
import { logger } from '../utils/logger';
import { sanitizeForLogging } from '../utils/sanitize';
import { sanitizeErrorForUser } from '../utils/error-sanitizer';
import { askTimeoutExtension } from './timeout-confirmation';
import { needsAllowlistSetup } from '../config';
import { formatElapsedTime } from '../utils/time';
import { AtomicLock } from '../utils/atomic-lock';
import { i18n } from '../i18n/index.js';
import { createAllowPathRequest, isAdminUser } from './allowlist-admin';
import { generateCallbackData } from './keyboard-utils';
import {
  ONE_SECOND_MS,
  ONE_MINUTE_MS,
  BYTES_PER_KB,
  AUTO_EXTENSION_CHECK_INTERVAL_MS,
  ACTIVITY_WINDOW_MS,
  AUTO_EXTENSION_THRESHOLD,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  MAX_EVENT_DATA_PREVIEW_LENGTH,
} from '../constants';


/**
 * Atomic lock instance for timeout extension operations.
 * Prevents race conditions between auto-extend and manual confirmation.
 * 
 * Using AtomicLock ensures tryAcquire() is atomic - no race condition
 * between checking if lock exists and setting it.
 */
const timeoutExtensionLock = new AtomicLock();

/**
 * Attempts to acquire a lock for timeout extension operation
 * 
 * Returns true if lock acquired, false if already locked.
 * INVARIANT: Each successful acquire MUST be paired with exactly one release()
 * 
 * @param userId - The user ID to lock
 * @param operationType - 'auto' or 'manual' for logging purposes
 * @returns true if lock was acquired, false if already locked
 */
function acquireExtensionLock(userId: string, operationType: 'auto' | 'manual'): boolean {
  const acquired = timeoutExtensionLock.tryAcquire(userId);
  
  if (!acquired) {
    logger.debug('Extension lock already held, skipping operation', {
      userId,
      operationType,
      lockStatus: 'already_locked',
    });
    return false;
  }
  
  logger.debug('Extension lock acquired', {
    userId,
    operationType,
    lockStatus: 'acquired',
  });
  return true;
}

/**
 * Releases a lock for timeout extension operation
 * 
 * MUST be called in a finally block to ensure lock is always released.
 * 
 * @param userId - The user ID to unlock
 * @param operationType - 'auto' or 'manual' for logging purposes
 */
function releaseExtensionLock(userId: string, operationType: 'auto' | 'manual'): void {
  timeoutExtensionLock.release(userId);
  logger.debug('Extension lock released', {
    userId,
    operationType,
    lockStatus: 'released',
  });
}

// ============================================================================
// STREAMING HELPER FUNCTIONS
// ============================================================================

/**
 * Formats a progress message showing current status, buffer size, and elapsed time
 * 
 * @param bufferSize - The current size of the buffer in characters
 * @param elapsedMs - The elapsed time in milliseconds
 * @param remainingMs - Optional remaining time in milliseconds
 * @returns Formatted progress message: "🔄 Trabajando... (~X caracteres, Ys) | Zm restantes"
 */
export function formatProgressMessage(
  userId: number,
  bufferSize: number,
  elapsedMs: number,
  remainingMsOrActiveToolName?: number | string,
  activeToolNameArg?: string
): string {
  const remainingMs = typeof remainingMsOrActiveToolName === 'number'
    ? remainingMsOrActiveToolName
    : undefined;
  const activeToolName = typeof remainingMsOrActiveToolName === 'string'
    ? remainingMsOrActiveToolName
    : activeToolNameArg;
  const seconds = Math.floor(elapsedMs / ONE_SECOND_MS);
  let message = i18n.t(userId, 'messageHandler.progressMessage', {
    bufferSize,
    seconds,
  });
  if (typeof remainingMs === 'number' && remainingMs > 0) {
    message = i18n.t(userId, 'messageHandler.progressMessageWithRemaining', {
      bufferSize,
      seconds,
      remainingMinutes: Math.floor(remainingMs / ONE_MINUTE_MS),
    });
  }
  if (activeToolName) {
    message += `\n⚙️ Ejecutando: ${escapeHtml(activeToolName)}`;
  }
  return message;
}



// ============================================================================
// HEARTBEAT FUNCTIONS
// ============================================================================

/** Context for heartbeat operations */
interface HeartbeatContext {
  userId: number;
  chatId: string;
  msgId: number;
  startTime: number;
  timeoutMs: number;
  autoExtensionCount: number;
  manualExtensionCount: number;
  totalManualExtensionMs: number;
}

/**
 * Sends a heartbeat warning to the user
 * 
 * @param bot - Grammy bot instance
 * @param ctx - Heartbeat context containing chat info, timing, and extension counts
 */
function sendHeartbeatWarning(
  bot: Bot,
  ctx: HeartbeatContext
): void {
  const elapsed = Date.now() - ctx.startTime;
  const formattedTime = formatElapsedTime(elapsed);
  
  // Calculate remaining time from ACTUAL timeout schedule
  const baseTimeout = ctx.timeoutMs;
  const totalExtensionMs = (ctx.autoExtensionCount * config.TIMEOUT_EXTENSION_MS) + ctx.totalManualExtensionMs;
  const effectiveTimeout = baseTimeout + totalExtensionMs;
  const remaining = effectiveTimeout - elapsed;
  const remainingMinutes = Math.max(0, Math.floor(remaining / ONE_MINUTE_MS));
  
  // Count total extensions
  const totalExtensions = ctx.autoExtensionCount + ctx.manualExtensionCount;
  
  const heartbeatMessage = totalExtensions > 0
    ? i18n.t(ctx.userId, 'messageHandler.heartbeatWithExtensions', {
        formattedTime,
        remainingMinutes,
        totalExtensions,
      })
    : i18n.t(ctx.userId, 'messageHandler.heartbeatNoExtensions', {
        formattedTime,
        remainingMinutes,
      });
  
  logger.debug('Sending enhanced heartbeat warning', {
    chatId: ctx.chatId,
    msgId: ctx.msgId,
    elapsedMs: elapsed,
    remainingMs: remaining,
    autoExtensionCount: ctx.autoExtensionCount,
    manualExtensionCount: ctx.manualExtensionCount,
    totalExtensions,
  });
  
  bot.api
    .editMessageText(ctx.chatId, ctx.msgId, heartbeatMessage, { parse_mode: 'HTML' })
    .catch((error) => {
      logger.warn('Failed to send enhanced heartbeat warning', {
        chatId: ctx.chatId,
        msgId: ctx.msgId,
        error: error.message,
      });
    });
}

// ============================================================================
// AUTO-EXTENSION FUNCTIONS
// ============================================================================

// AUTO_EXTENSION_THRESHOLD is imported from constants
// ACTIVITY_WINDOW_MS is imported from constants

/** Context for auto-extension operations */
interface AutoExtensionContext {
  userId: string;
  chatId: string;
  startTime: number;
  timeoutMs: number;
  lastEventTime: number;
}

/**
 * Checks if auto-extension should be triggered and performs the extension
 * 
 * Uses acquireExtensionLock() to prevent concurrent extensions with manual confirmation.
 * If lock cannot be acquired (manual extension in progress), operation is skipped.
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling timeout extensions
 * @param ctx - Auto-extension context containing user info and timing
 * @param autoExtensionCount - Reference to counter object that will be incremented
 * @returns true if extension was performed, false otherwise
 */
function checkAutoExtension(
  bot: Bot,
  sessionManager: SessionManager,
  ctx: AutoExtensionContext,
  autoExtensionCount: { value: number }
): boolean {
  const now = Date.now();
  const elapsed = now - ctx.startTime;
  
  const currentTimeout = sessionManager.getOriginalTimeout(ctx.userId) || ctx.timeoutMs;
  const totalExtension = sessionManager.getTimeoutExtension(ctx.userId);
  const effectiveTimeout = currentTimeout + totalExtension;
  
  const thresholdTime = effectiveTimeout * AUTO_EXTENSION_THRESHOLD;
  
  if (elapsed >= thresholdTime) {
    const timeSinceLastEvent = now - ctx.lastEventTime;
    
    if (timeSinceLastEvent < ACTIVITY_WINDOW_MS) {
      // Verify we don't exceed MAX_TIMEOUT_DURATION
      const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS;
      
      if (projectedTotal <= config.MAX_TIMEOUT_DURATION) {
        // CRITICAL SECTION: Acquire lock before extending timeout
        if (!acquireExtensionLock(ctx.userId, 'auto')) {
          // Lock held by manual extension - skip to avoid race condition
          logger.debug('Auto-extension skipped: lock held by manual operation', {
            userId: ctx.userId,
            chatId: ctx.chatId,
          });
          return false;
        }
        
        try {
          // Perform auto-extension (atomic operation inside lock)
          const extended = sessionManager.extendTimeout(ctx.userId, config.TIMEOUT_EXTENSION_MS);
          
          if (extended) {
            autoExtensionCount.value++;
            
            logger.info('Auto-extension triggered', {
              userId: ctx.userId,
              chatId: ctx.chatId,
              autoExtensionCount: autoExtensionCount.value,
              elapsedMs: elapsed,
              extensionMs: config.TIMEOUT_EXTENSION_MS,
              newTotalMs: elapsed + config.TIMEOUT_EXTENSION_MS,
            });
            
            // Notify user
            const minutes = Math.floor(config.TIMEOUT_EXTENSION_MS / ONE_MINUTE_MS);
            const notificationMsg = i18n.t(Number(ctx.userId), 'bot.extend.autoDetected', { minutes });
            
            bot.api
              .sendMessage(ctx.chatId, notificationMsg)
              .catch((error) => {
                logger.warn('Failed to send auto-extension notification', {
                  chatId: ctx.chatId,
                  error: error.message,
                });
              });
            
            return true;
          }
        } finally {
          // INVARIANT: Always release lock, even if extension fails
          releaseExtensionLock(ctx.userId, 'auto');
        }
      } else {
        logger.warn('Auto-extension skipped: would exceed MAX_TIMEOUT_DURATION', {
          userId: ctx.userId,
          chatId: ctx.chatId,
          projectedTotal,
          maxTimeout: config.MAX_TIMEOUT_DURATION,
        });
      }
    }
  }
  
  return false;
}

// ============================================================================
// INPUT SIZE VALIDATION
// ============================================================================

/**
 * Result of message size validation
 */
export interface ValidationResult {
  text: string;
  truncated: boolean;
  warning?: string;
}

/**
 * Validates and truncates message if it exceeds MAX_INPUT_SIZE_BYTES
 * 
 * @param text - The message text to validate
 * @param ctx - The Telegram context to send warnings
 * @returns Promise resolving to validation result with potentially truncated text
 */
export async function validateMessageSize(text: string, ctx: Context): Promise<ValidationResult> {
  const sizeBytes = Buffer.byteLength(text, 'utf-8');
  
  if (sizeBytes > config.MAX_INPUT_SIZE_BYTES) {
    const sizeMB = (sizeBytes / BYTES_PER_KB).toFixed(2);
    const maxMB = (config.MAX_INPUT_SIZE_BYTES / BYTES_PER_KB).toFixed(2);
    
    logger.warn('Input message too large, truncating', {
      sizeBytes,
      maxBytes: config.MAX_INPUT_SIZE_BYTES,
    });
    
    // Truncate to limit - ensure we don't cut in the middle of a multi-byte character
    let truncated = text;
    let currentBytes = sizeBytes;
    
    while (currentBytes > config.MAX_INPUT_SIZE_BYTES) {
      // Reduce by 10% to ensure we're under the limit
      const targetLength = Math.floor(truncated.length * 0.9);
      truncated = truncated.substring(0, targetLength);
      currentBytes = Buffer.byteLength(truncated, 'utf-8');
    }
    
    // Notify user
    const warningMsg = `⚠️ Mensaje demasiado grande (${sizeMB}KB). Truncado a ${maxMB}KB.`;
    await ctx.reply(warningMsg);
    
    return {
      text: truncated,
      truncated: true,
      warning: warningMsg,
    };
  }
  
  return {
    text,
    truncated: false,
  };
}

/**
 * Trims buffer to maximum bytes by removing oldest content
 * 
 * @param value - The string to trim
 * @param maxBytes - Maximum byte length allowed
 * @returns Trimmed string that fits within maxBytes
 */
function trimBufferToMaxBytes(value: string, maxBytes: number): string {
  const currentSize = Buffer.byteLength(value, 'utf-8');
  if (currentSize <= maxBytes) {
    return value;
  }

  const bytes = Buffer.from(value, 'utf-8');
  return bytes.subarray(bytes.length - maxBytes).toString('utf-8');
}

// ============================================================================
// STREAMING PROMPT HANDLER
// ============================================================================

/**
 * Sends a prompt to Copilot with streaming response handling
 * 
 * Manages the entire lifecycle of a Copilot API call including:
 * - Streaming response chunks with progress updates
 * - Timeout management with auto-extend and manual confirmation
 * - Heartbeat warnings for long-running operations
 * - Buffer size validation and truncation
 * - Error handling and user notifications
 * 
 * @param ctx - Grammy context for the message
 * @param session - Active Copilot session
 * @param prompt - The prompt to send to Copilot
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for timeout handling
 * @param userId - The user's Telegram ID string
 * @param userState - User state manager
 * @param abortSignal - Optional abort signal for cancellation
 * @returns Promise that resolves to the complete response buffer when streaming completes
 * @throws Error if operation is cancelled or times out
 */
async function sendPromptWithStreaming(
  ctx: Context,
  session: CopilotSession,
  prompt: string,
  bot: Bot,
  sessionManager: SessionManager,
  userId: string,
  userState: UserState,
  abortSignal?: AbortSignal
): Promise<string> {
  const chatId = String(ctx.chat?.id ?? '');
  // userId is the telegram ID string, we need to get the user from userState
  const user = userState.getOrCreate(userId, ctx.from?.username);
  
  let buffer = '';
  let msgId: number | null = null;
  let lastUpdate = 0;
  const timeoutMs = config.COPILOT_OPERATION_TIMEOUT;
  const startTime = Date.now();

  logger.info('Starting Copilot API call', sanitizeForLogging({
    chatId,
    userId,
    promptLength: prompt.length,
    prompt,
    hasAbortSignal: !!abortSignal,
  }));

  logger.debug('Starting streaming prompt', {
    chatId,
    promptLength: prompt.length,
    hasAbortSignal: !!abortSignal,
  });

  const statusMsg = await ctx.reply(i18n.t(user.id, 'bot.working'));
  msgId = statusMsg.message_id;
  lastUpdate = Date.now();

  logger.debug('Initial status message sent', {
    chatId,
    msgId,
    timestamp: Date.now(),
  });

  return await new Promise<string>((resolve, reject) => {
    let unsubscribe = () => {};
    let isFinished = false;
    let isCancelled = false;
    let lastProgressUpdate: Promise<any> | null = null;
    let lastEventTime = Date.now();
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let isAwaitingConfirmation = false;
    
    let autoExtensionCount = 0;
    let autoExtensionTimer: NodeJS.Timeout | null = null;
    
    let manualExtensionCount = 0;
    let totalManualExtensionMs = 0;
    
    let hasBufferWarningBeenSent = false;
    
    // Tool execution state for unified status UI
    let activeToolName: string | null = null;
    
    // Compaction tracking state
    let compactionStartTime = 0;
    
    /**
     * Timeout callback - asks user for confirmation before aborting
     * 
     * RACE CONDITION PROTECTION:
     * Uses acquireExtensionLock() to prevent concurrent extensions with auto-extension.
     * The lock is held during the entire confirmation and extension process.
     */
    const handleTimeout = async (): Promise<void> => {
      if (isFinished || isCancelled || isAwaitingConfirmation) return;

      isAwaitingConfirmation = true;
      
      if (!acquireExtensionLock(userId, 'manual')) {
        logger.warn('Manual extension confirmation skipped: lock held by auto-extension', {
          userId,
          chatId,
        });
        isAwaitingConfirmation = false;
        return;
      }
      
      try {
        const shouldExtend = await askTimeoutExtension(userId, chatId, startTime, bot);

        if (shouldExtend) {
          const elapsed = Date.now() - startTime;
          const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS;

          if (projectedTotal <= config.MAX_TIMEOUT_DURATION) {
            manualExtensionCount++;
            totalManualExtensionMs += config.TIMEOUT_EXTENSION_MS;

            logger.info('Manual extension via confirmation', {
              userId,
              chatId,
              manualExtensionCount,
              totalManualExtensionMs,
              elapsedMs: elapsed,
            });

            const minutes = Math.floor(config.TIMEOUT_EXTENSION_MS / 60000);
            await bot.api.sendMessage(chatId, i18n.t(Number(userId), 'bot.extend.extensionSuccess', { minutes }));

            const extended = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);
            
            if (!extended) {
              logger.error('Failed to extend timeout for manual extension', { userId });
              await bot.api.sendMessage(chatId, i18n.t(Number(userId), 'bot.extend.errorExtensionWarning'));
            } else {
              return;
            }
          } else {
            await bot.api.sendMessage(
              chatId,
              `⚠️ Límite máximo de 2 horas alcanzado. La operación será cancelada.`
            );
          }
        }

        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if (autoExtensionTimer) clearInterval(autoExtensionTimer);
        abortSignal?.removeEventListener('abort', onAbort);
        unsubscribe();

        try {
          await sessionManager.cancelActiveSession(userId);
          logger.info('Session aborted after user declined extension or timeout limit reached', {
            userId,
            chatId,
            shouldExtend,
          });
        } catch (error: any) {
          logger.warn('Failed to abort session', {
            userId,
            error: error.message,
          });
        }

        reject(new Error(i18n.t(Number(userId), 'errors.timeout')));
      } finally {
        releaseExtensionLock(userId, 'manual');
        isAwaitingConfirmation = false;
      }
    };

    // No timeout - let agent work indefinitely
    // sessionManager.startTimeout(userId, timeoutMs, handleTimeout); // REMOVED

    /**
     * Sends a heartbeat warning to the user using the extracted helper
     */
    const sendHeartbeatWarningLocal = () => {
      if (isFinished || isCancelled || !msgId) return;
      
      sendHeartbeatWarning(bot, {
        userId: Number(userId),
        chatId,
        msgId,
        startTime,
        timeoutMs,
        autoExtensionCount,
        manualExtensionCount,
        totalManualExtensionMs,
      });
    };

    /**
     * Schedules the next heartbeat check
     */
    const scheduleHeartbeat = (isFirstWarning: boolean = false) => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (isFinished || isCancelled) return;
      
      const interval = isFirstWarning 
        ? config.HEARTBEAT_WARNING_INTERVAL 
        : config.HEARTBEAT_UPDATE_INTERVAL;
      
      heartbeatTimer = setTimeout(() => {
        const timeSinceLastEvent = Date.now() - lastEventTime;
        
        if (timeSinceLastEvent >= interval) {
          try {
            sendHeartbeatWarningLocal();
          } finally {
            scheduleHeartbeat(false);
          }
        } else {
          const remainingTime = interval - timeSinceLastEvent;
          heartbeatTimer = setTimeout(() => {
            try {
              sendHeartbeatWarningLocal();
            } finally {
              scheduleHeartbeat(false);
            }
          }, remainingTime);
        }
      }, interval);
    };
    
    scheduleHeartbeat(true);

    /**
     * Checks if auto-extension should be triggered - uses extracted helper
     */
    const checkAutoExtensionLocal = () => {
      if (isFinished || isCancelled || isAwaitingConfirmation) return;
      
      const autoExtCounter = { value: autoExtensionCount };
      const didExtend = checkAutoExtension(bot, sessionManager, {
        userId,
        chatId,
        startTime,
        timeoutMs,
        lastEventTime,
      }, autoExtCounter);
      
      if (didExtend) {
        autoExtensionCount = autoExtCounter.value;
      }
    };

    autoExtensionTimer = setInterval(checkAutoExtensionLocal, AUTO_EXTENSION_CHECK_INTERVAL_MS);


    const onAbort = () => {
      isCancelled = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (autoExtensionTimer) clearInterval(autoExtensionTimer);
      sessionManager.clearTimeout(userId);
      unsubscribe();
      reject(new Error(i18n.t(0, 'bot.operationCancelled')));
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    unsubscribe = session.on(async (event) => {
      if (isCancelled) return;

      const now = Date.now();
      const elapsedMs = now - startTime;
      const timeSinceLastEvent = now - lastEventTime;

      if (timeSinceLastEvent > config.STALE_PERIOD_THRESHOLD_MS) {
        logger.warn('Stale period detected - no events received', {
          event: event.type,
          chatId,
          stalePeriodMs: timeSinceLastEvent,
          thresholdMs: config.STALE_PERIOD_THRESHOLD_MS,
          elapsedMs,
        });
      }

      const updateStatusMessage = (force: boolean = false) => {
        if (isFinished || isCancelled || !msgId) return;
        if (!force && now - lastUpdate <= config.TELEGRAM_UPDATE_INTERVAL) return;

        lastUpdate = Date.now();
        const progressMessage = formatProgressMessage(
          Number(userId),
          buffer.length,
          Date.now() - startTime,
          undefined,
          activeToolName ?? undefined
        );

        const currentUpdate = bot.api
          .editMessageText(chatId, msgId, progressMessage, { parse_mode: 'HTML' })
          .catch((error) => {
            logger.warn('Failed to update Telegram message', {
              chatId,
              msgId,
              error: error.message,
            });
          });

        lastProgressUpdate = lastProgressUpdate
          ? lastProgressUpdate.then(() => currentUpdate).catch(() => currentUpdate)
          : currentUpdate;
      };

      switch (event.type) {
        case 'assistant.message_delta': {
          const deltaSize = event.data.deltaContent.length;
          buffer += event.data.deltaContent;
          
          logger.debug('SDK event: assistant.message_delta', {
            event: 'assistant.message_delta',
            chatId,
            deltaSize,
            bufferSize: buffer.length,
            elapsedMs,
            timeSinceLastEventMs: timeSinceLastEvent,
          });
          
          const bufferSizeBytes = Buffer.byteLength(buffer, 'utf-8');
          if (bufferSizeBytes > config.MAX_BUFFER_SIZE_BYTES) {
            if (!hasBufferWarningBeenSent) {
              hasBufferWarningBeenSent = true;
              const bufferSizeKB = (bufferSizeBytes / BYTES_PER_KB).toFixed(2);
              const maxBufferSizeKB = (config.MAX_BUFFER_SIZE_BYTES / BYTES_PER_KB).toFixed(2);
              
              logger.warn('Streaming buffer size exceeded limit', {
                bufferSize: bufferSizeBytes,
                maxBufferSize: config.MAX_BUFFER_SIZE_BYTES,
                chatId,
              });
              
              const bufferWarningMsg = `⚠️ Buffer de streaming muy grande (${bufferSizeKB}KB). Se conservará solo la parte más reciente. Límite: ${maxBufferSizeKB}KB.`;
              
              bot.api
                .sendMessage(chatId, bufferWarningMsg)
                .catch((error) => {
                  logger.warn('Failed to send buffer size warning', {
                    chatId,
                    error: error.message,
                  });
                });
            }

            buffer = trimBufferToMaxBytes(buffer, config.MAX_BUFFER_SIZE_BYTES);
          }
          
          lastEventTime = now;
          scheduleHeartbeat(true);

          updateStatusMessage();
          break;
        }
        case 'session.compaction_start': {
          logger.info('Session compaction started', {
            userId,
            timestamp: new Date().toISOString(),
          });
          
          compactionStartTime = Date.now();
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          
          break;
        }
        case 'session.compaction_complete': {
          const durationMs = compactionStartTime > 0 ? Date.now() - compactionStartTime : 0;
          const success = (event.data as any)?.success !== false;
          const compactedTokens = (event.data as any)?.compactedTokens;
          const error = (event.data as any)?.error;
          
          logger.info('Session compaction completed', {
            userId,
            durationMs,
            success,
            compactedTokens,
            error,
          });
          
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          
          // Si la compactación tardó mucho, notificar al usuario
          if (durationMs > 5000) {
            try {
              await bot.api.sendMessage(
                Number(chatId),
                '⚙️ Optimizando historial de conversación...',
                { parse_mode: 'HTML' }
              );
            } catch (e) {
              logger.warn('Failed to send compaction notification', { error: e });
            }
          }
          
          compactionStartTime = 0;
          break;
        }
        case 'session.idle': {
          isFinished = true;
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          if (autoExtensionTimer) clearInterval(autoExtensionTimer);
          
          const totalElapsedMs = Date.now() - startTime;
          
          // Log session.idle event with final buffer size and total elapsed time
          logger.debug('SDK event: session.idle', {
            event: 'session.idle',
            chatId,
            bufferSize: buffer.length,
            elapsedMs,
            elapsedSeconds: Math.floor(elapsedMs / 1000),
          });
          
          // Log API call completion with performance metrics
          const totalExtension = sessionManager.getTimeoutExtension(userId);
          const manualExtensions = Math.floor(totalExtension / config.TIMEOUT_EXTENSION_MS);
          
          logger.info('Operation completed with enhanced stats', {
            chatId,
            userId,
            elapsedMs: totalElapsedMs,
            autoExtensionCount,
            manualExtensions,
            totalExtensions: autoExtensionCount + manualExtensions,
            totalExtensionMs: totalExtension,
          });
          
          const parts = splitMessage(buffer, TELEGRAM_MAX_MESSAGE_LENGTH);
          const doneMessage = i18n.t(Number(userId), 'bot.done');
          const safeParts =
            parts.length === 0
              ? [doneMessage]
              : parts.map((part) => formatForTelegram(part));
          
          // Add enhanced completion message footer
          const elapsedSeconds = Math.floor(elapsedMs / ONE_SECOND_MS);
          if (safeParts.length > 0 && safeParts[0] !== doneMessage) {
            const lastIndex = safeParts.length - 1;
            
            let duration = `${elapsedSeconds}s`;
            if (totalElapsedMs > ONE_MINUTE_MS) {
              const minutes = Math.floor(totalElapsedMs / ONE_MINUTE_MS);
              const seconds = Math.floor((totalElapsedMs % ONE_MINUTE_MS) / ONE_SECOND_MS);
              duration = `${minutes}m ${seconds}s`;
            }
            
            let completionFooter = i18n.t(Number(userId), 'messageHandler.completionFooter', { duration });
            if (autoExtensionCount > 0 || manualExtensions > 0) {
              const totalExtensionsCount = autoExtensionCount + manualExtensions;
              completionFooter = i18n.t(Number(userId), 'messageHandler.completionFooterWithExtensions', {
                duration,
                count: totalExtensionsCount,
              });
            }
            safeParts[lastIndex] += completionFooter;
          }
          
           const sendMessages = async () => {
             if (msgId) {
               try {
                  await bot.api.editMessageText(chatId, msgId, i18n.t(Number(userId), 'bot.completed'), { parse_mode: 'HTML' });
               } catch (error: any) {
                 logger.warn('Failed to update status message to completed', {
                   chatId,
                   msgId,
                   error: error.message,
                 });
               }
             }

             for (let i = 0; i < safeParts.length; i += 1) {
               if (isCancelled) break;
               try {
                 await bot.api.sendMessage(chatId, safeParts[i], { parse_mode: 'HTML' });
               } catch (error: any) {
                 logger.warn('Failed to send message part', {
                   chatId,
                   partIndex: i,
                   error: error.message,
                 });
               }
             }
           };

          const waitForProgress = lastProgressUpdate 
            ? lastProgressUpdate.catch((error: any) => {
                logger.debug('Progress update did not complete before sending final message', {
                  chatId,
                  userId,
                  error: error.message,
                });
              })
            : Promise.resolve();

          waitForProgress
            .then(() => sendMessages())
            .then(async () => {
              sessionManager.clearTimeout(userId);
              abortSignal?.removeEventListener('abort', onAbort);
              unsubscribe();
              resolve(buffer);
            })
            .catch((error) => {
              sessionManager.clearTimeout(userId);
              abortSignal?.removeEventListener('abort', onAbort);
              unsubscribe();
              reject(error);
            });
          break;
        }
        case 'session.error': {
          isFinished = true;
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          if (autoExtensionTimer) clearInterval(autoExtensionTimer);
          
          const totalElapsedMs = Date.now() - startTime;
          
          // Log session.error event with error message and elapsed time
          logger.error('SDK event: session.error', {
            event: 'session.error',
            chatId,
            errorMessage: event.data.message,
            elapsedMs,
            elapsedSeconds: Math.floor(elapsedMs / ONE_SECOND_MS),
          });
          
          // Log API call failure with performance metrics
          logger.error('Copilot API call failed', {
            chatId,
            userId,
            durationMs: totalElapsedMs,
            durationSeconds: Math.floor(totalElapsedMs / ONE_SECOND_MS),
            error: event.data.message,
            success: false,
          });

          const waitForProgress = lastProgressUpdate 
            ? lastProgressUpdate.catch((error: any) => {
                logger.debug('Progress update did not complete before sending error message', {
                  chatId,
                  userId,
                  error: error.message,
                });
              })
            : Promise.resolve();

          waitForProgress
            .then(() => {
              // Escape HTML to prevent injection attacks
              const safeErrorMessage = escapeHtml(sanitizeErrorForUser(event.data.message));
              return bot.api.sendMessage(
                chatId,
                i18n.t(Number(userId), 'bot.errorWithDetails', { error: safeErrorMessage }),
                { parse_mode: 'HTML' }
              );
            })
            .catch((error) => {
              logger.error('Failed to send error notification to user', {
                chatId,
                error: error.message,
              });
            })
            .finally(() => {
              sessionManager.clearTimeout(userId);
              abortSignal?.removeEventListener('abort', onAbort);
              unsubscribe();
              reject(event.data);
            });
          break;
        }
        case 'tool.execution_start': {
          const toolCallId = (event.data as any)?.toolCallId;
          const toolName = (event.data as any)?.toolName || 'herramienta';
          
          logger.debug('SDK event: tool.execution_start', {
            userId,
            toolCallId,
            toolName,
          });
          
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          
          activeToolName = toolName;
          updateStatusMessage(true);
          
          break;
        }
        case 'tool.execution_complete': {
          const toolCallId = (event.data as any)?.toolCallId;
          const toolName = (event.data as any)?.toolName || 'herramienta';
          const durationMs = (event.data as any)?.durationMs || 0;
          
          logger.debug('SDK event: tool.execution_complete', {
            userId,
            toolCallId,
            toolName,
            durationMs,
          });
          
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          
          activeToolName = null;
          updateStatusMessage(true);
          
          break;
        }
        case 'assistant.reasoning_delta': {
          const delta = event.data?.deltaContent || '';
          logger.debug('SDK event: assistant.reasoning_delta', {
            userId,
            deltaLength: delta.length,
            totalLength: delta.length,
          });
          
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          break;
        }
        case 'assistant.reasoning': {
          const content = event.data?.content || '';
          logger.debug('SDK event: assistant.reasoning', {
            userId,
            contentLength: content.length,
          });
          lastEventTime = Date.now();
          scheduleHeartbeat(true);
          break;
        }
        default:
          // Log any unknown/other events for visibility
          logger.debug('SDK event: unknown event type', {
            event: event.type,
            chatId,
            elapsedMs,
            eventData: event.data ? JSON.stringify(event.data).substring(0, MAX_EVENT_DATA_PREVIEW_LENGTH) : undefined,
          });
          break;
      }
    });

    session.send({ prompt }).catch((error) => {
      sessionManager.clearTimeout(userId);
      abortSignal?.removeEventListener('abort', onAbort);
      unsubscribe();
      reject(error);
    });
  });
}

// ============================================================================
// MESSAGE HANDLER REGISTRATION
// ============================================================================

/**
 * Registers the main message handler for processing user input
 * 
 * This is the core handler that:
 * - Processes text messages and forwards them to the Copilot SDK
 * - Manages streaming responses with progress updates
 * - Handles wizard inputs for interactive flows
 * - Validates input size and enforces limits
 * - Manages timeout extensions and auto-extend logic
 * 
 * @param bot - Grammy bot instance
 * @param sessionManager - Session manager for handling Copilot sessions
 * @param userState - User state manager
 * @param mcpRegistry - MCP server registry
 * @param wizardManagerOrTools - WizardManager (legacy) or ToolBundle
 * @param allowlistWizard - Optional allowlist setup wizard
 * @param tools - Optional ToolBundle (when first param is WizardManager)
 * @param addProjectWizard - Optional add project wizard
 */
export function registerMessageHandler(
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState,
  mcpRegistry: McpRegistry,
  wizardManagerOrTools: WizardManager | ToolBundle,
  allowlistWizard?: AllowlistSetupWizard,
  tools?: ToolBundle,
  addProjectWizard?: any
) {
  const isToolBundle = (value: unknown): value is ToolBundle =>
    !!value &&
    typeof value === 'object' &&
    'all' in (value as Record<string, unknown>);

  const wizardManager = isToolBundle(wizardManagerOrTools)
    ? ({ hasActiveWizard: () => false } as unknown as WizardManager)
    : wizardManagerOrTools;

  const resolvedAllowlistWizard = (allowlistWizard ?? {
    isInSetup: () => false,
    needsSetup: () => false,
    handleInput: async () => {},
    startSetup: async () => {},
  }) as AllowlistSetupWizard;

  const resolvedTools = (isToolBundle(wizardManagerOrTools)
    ? wizardManagerOrTools
    : tools) ?? ({ 
      all: [], 
      askUser: { hasPending: () => false, resolveResponse: () => false, cancel: () => {} },
      userInputHandler: async () => ({ answer: '', wasFreeform: true })
    } as ToolBundle);

  const handler = async (ctx: any) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return;

    const telegramIdStr = String(ctx.from?.id ?? '');
    const telegramIdNum = ctx.from?.id;
    if (!telegramIdNum) return; // Safety check
    
    const user = userState.getOrCreate(telegramIdStr, ctx.from?.username);

    // Priority 1: Check if user is in allowlist setup wizard (use Telegram ID)
    if (resolvedAllowlistWizard.isInSetup(telegramIdNum)) {
      logger.info('Allowlist wizard input received', sanitizeForLogging({
        telegramId: telegramIdNum,
        userId: user.id,
        input: text,
      }));

      await resolvedAllowlistWizard.handleInput(ctx, text, telegramIdNum);
      return;
    }

    // Priority 2: Check if user needs allowlist setup (use Telegram ID)
    if (needsAllowlistSetup && resolvedAllowlistWizard.needsSetup(telegramIdNum)) {
      logger.info('User needs allowlist setup, starting wizard', {
        telegramId: telegramIdNum,
        userId: user.id,
      });

      await resolvedAllowlistWizard.startSetup(ctx);
      return;
    }

    // Priority 3: Check if user has an active AddProject wizard session
    if (addProjectWizard && addProjectWizard.hasActiveWizard(telegramIdNum)) {
      logger.info('AddProject wizard input received', sanitizeForLogging({
        telegramId: telegramIdNum,
        username: ctx.from?.username,
        input: text,
      }));

      const result = await addProjectWizard.handleNameInput(telegramIdNum, text);
      await ctx.reply(result.message, {
        parse_mode: 'HTML',
        reply_markup: result.keyboard,
      });
      return;
    }

    // Priority 4: Check if user has an active wizard session (MCP wizard)
    if (wizardManager.hasActiveWizard(user.id)) {
      logger.info('Wizard input received', sanitizeForLogging({
        telegramId: telegramIdNum,
        username: ctx.from?.username,
        input: text,
      }));

      const result = wizardManager.handleInput(user.id, text);
      if (result) {
        // Note: wizard messages are already HTML-escaped in server-wizard.ts
        await ctx.reply(result.message, { parse_mode: 'HTML' });

        // If wizard completed successfully, reload MCP registry and recreate session
        if (result.complete && result.success) {
          if (sessionManager.isBusy(telegramIdStr)) {
            await ctx.reply(i18n.t(user.id, 'bot.waitPlease'));
            return;
          }
          
          sessionManager.setBusy(telegramIdStr, true);
          try {
            mcpRegistry.load();
            await sessionManager.recreateActiveSession(telegramIdStr, {
              model: userState.getCurrentModel(user.id),
               tools: resolvedTools.all,
              mcpServers: mcpRegistry.getEnabled(),
            });
            await ctx.reply(i18n.t(user.id, 'errors.configUpdated'));
          } catch (error: any) {
            logger.error('Error updating session after wizard completion', { error });
            await ctx.reply(i18n.t(user.id, 'bot.serverCreatedWithError', { error: sanitizeErrorForUser(error) }));
          } finally {
            sessionManager.setBusy(telegramIdStr, false);
          }
        }
      }
      return;
    }

    if (resolvedTools.askUser.hasPending()) {
      const resolved = resolvedTools.askUser.resolveResponse(text);
      if (resolved) return;
    }
    
    logger.info('User message received', sanitizeForLogging({
      telegramId: telegramIdNum,
      username: ctx.from?.username,
      messageLength: text.length,
      message: text,
    }));
    
    const validation = await validateMessageSize(text, ctx);
    const validatedText = validation.text;
    
    if (sessionManager.isBusy(telegramIdStr)) {
      await ctx.reply(i18n.t(user.id, 'bot.operationInProgressWait'));
      return;
    }
    sessionManager.setBusy(telegramIdStr, true);
    const cwd = userState.getCurrentCwd(user.id);
    const model = userState.getCurrentModel(user.id);
    
    // CRITICAL SECURITY: Validate cwd is in allowlist BEFORE creating session
    // This prevents bypass when user has allowed_paths_configured=1 in DB
    // but admin cleared ALLOWED_PATHS from .env
    if (!isPathAllowed(cwd)) {
      logger.warn('Blocked session creation - cwd not in allowlist', {
        telegramId: telegramIdNum,
        userId: user.id,
        cwd,
        needsAllowlistSetup,
      });
      sessionManager.setBusy(telegramIdStr, false);
      await ctx.reply(
        '⚠️ <b>Acceso Denegado</b>\n\n' +
        i18n.t(user.id, 'errors.pathNotAllowedDetailed'),
        { parse_mode: 'HTML' }
      );
      if (isAdminUser(telegramIdNum)) {
        const token = createAllowPathRequest(cwd, telegramIdNum, user.id);
        await ctx.reply(i18n.t(user.id, 'allowlistAdmin.promptAddPath', { path: escapeHtml(cwd) }), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              {
                text: i18n.t(user.id, 'allowlistAdmin.buttonAddPath'),
                callback_data: generateCallbackData('allowpath_confirm', token),
              },
              {
                text: i18n.t(user.id, 'common.cancel'),
                callback_data: generateCallbackData('allowpath_cancel', token),
              },
            ]],
          },
        });
      }
      return;
    }
    
    // Clear any previous cancellation flags
    sessionManager.clearCancelled(telegramIdStr, cwd);
    
    try {
      const controller = new AbortController();
      sessionManager.registerAborter(telegramIdStr, () => controller.abort());
      
      // Check if plan mode is active to preserve context
      const isPlanMode = sessionManager.isPlanModeActive(telegramIdStr);
      const switchOptions: any = {
        model,
        tools: resolvedTools.all,
        mcpServers: mcpRegistry.getEnabled(),
        onUserInputRequest: resolvedTools.userInputHandler,
      };
      
      let promptForSession = validatedText;
      if (isPlanMode) {
        promptForSession = `[[PLAN]]\n${validatedText}`;
      } else if (sessionManager.consumePlanModeExitPendingNotice(telegramIdStr)) {
        promptForSession =
          `[[PLAN_MODE_OFF]]\nPlan mode is OFF. Continue in normal execution mode.\n\n${validatedText}`;
      }
      
      const session = await sessionManager.switchProject(telegramIdStr, cwd, switchOptions);
      await sendPromptWithStreaming(
        ctx,
        session,
        promptForSession,
        bot,
        sessionManager,
        telegramIdStr,
        userState,
        controller.signal
      );
    } catch (error: any) {
      logger.error('Error during streaming', {
        telegramId: telegramIdNum,
        error: error.message,
      });
      
      // Don't send message if cancelled - /stop already sent feedback
      if (!sessionManager.isCancelled(telegramIdStr, cwd)) {
        await ctx.reply(i18n.t(user.id, 'messageHandler.errorWithDetails', { error: sanitizeErrorForUser(error) })).catch((telegramError: any) => {
          logger.warn('Failed to send error message to user', {
            chatId: ctx.chat?.id,
            userId: telegramIdNum,
            error: telegramError.message,
          });
        });
      }
    } finally {
      sessionManager.clearAborter(telegramIdStr);
      sessionManager.clearCancelled(telegramIdStr, cwd);
      sessionManager.setBusy(telegramIdStr, false);
    }
  };

  bot.on('message:text', handler);
  (bot as any).messageHandler = handler;
}

export { sendPromptWithStreaming };
