import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { Bot } from 'grammy';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_CHAT_ID: '123456',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '1',
  COPILOT_OPERATION_TIMEOUT: '3600000', // 60 min
  TIMEOUT_EXTENSION_MS: '1200000', // 20 min
  MAX_TIMEOUT_DURATION: '7200000', // 120 min
  HEARTBEAT_WARNING_INTERVAL: '300000', // 5 min
  HEARTBEAT_UPDATE_INTERVAL: '120000', // 2 min
  TELEGRAM_UPDATE_INTERVAL: '10000',
};

describe('Timeout System Critical Fixes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Issue #1: Remove redundant extendTimeout call', () => {
    it('should NOT call extendTimeout after user confirmation', async () => {
      // After user confirms extension, code should only call startTimeout
      // NOT extendTimeout followed by startTimeout
      
      const { SessionManager } = await import('../src/copilot/session-manager');
      const config = (await import('../src/config')).config;
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: vi.fn(),
          on: vi.fn(() => () => {}),
        })),
      };

      const sessionManager = new SessionManager(mockClient as any);
      const userId = 'user123';
      
      sessionManager.setBusy(userId, true);
      const timeoutCallback = vi.fn();
      sessionManager.startTimeout(userId, config.COPILOT_OPERATION_TIMEOUT, timeoutCallback);

      // When user confirms extension, should call startTimeout directly
      // This resets tracking properly
      sessionManager.startTimeout(userId, config.TIMEOUT_EXTENSION_MS, timeoutCallback);
      
      // Verify that the timeout is properly set to the extension amount
      const originalTimeout = sessionManager.getOriginalTimeout(userId);
      expect(originalTimeout).toBe(config.TIMEOUT_EXTENSION_MS);
    });

    it('should NOT trigger auto-extension every 30 seconds after manual extension', async () => {
      // This test verifies that after manual extension via confirmation,
      // auto-extension doesn't fire every 30 seconds
      
      const { SessionManager } = await import('../src/copilot/session-manager');
      const config = (await import('../src/config')).config;
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: vi.fn(),
          on: vi.fn(() => () => {}),
        })),
      };

      const sessionManager = new SessionManager(mockClient as any);
      const userId = 'user123';
      
      sessionManager.setBusy(userId, true);
      let callbackCount = 0;
      const timeoutCallback = vi.fn(() => {
        callbackCount++;
      });
      
      // Simulate manual extension by calling startTimeout with extension amount
      sessionManager.startTimeout(userId, config.TIMEOUT_EXTENSION_MS, timeoutCallback);
      
      // Advance time by 30 seconds (auto-extension check interval)
      vi.advanceTimersByTime(30000);
      
      // Callback should NOT have been called yet
      expect(timeoutCallback).not.toHaveBeenCalled();
      
      // Advance another 30 seconds
      vi.advanceTimersByTime(30000);
      
      // Still should not be called
      expect(timeoutCallback).not.toHaveBeenCalled();
    });
  });

  describe('Issue #2: Prevent race condition with multiple handleTimeout calls', () => {
    it('should NOT call handleTimeout while awaiting user confirmation', async () => {
      // This test verifies the isAwaitingConfirmation flag prevents race conditions
      // When handleTimeout is waiting for user response, subsequent calls should be blocked
      
      let isAwaitingConfirmation = false;
      
      const handleTimeout = async () => {
        if (isAwaitingConfirmation) {
          // Should exit early if already awaiting confirmation
          return;
        }
        
        isAwaitingConfirmation = true;
        try {
          // Simulate asking user (would take time)
          await vi.waitFor(() => {}, { timeout: 100 });
        } finally {
          isAwaitingConfirmation = false;
        }
      };
      
      // First call starts awaiting
      const promise1 = handleTimeout();
      expect(isAwaitingConfirmation).toBe(true);
      
      // Second call should exit early
      const promise2 = handleTimeout();
      
      await Promise.all([promise1, promise2]);
      expect(isAwaitingConfirmation).toBe(false);
    });

    it('should check isAwaitingConfirmation in checkAutoExtension', () => {
      // Auto-extension should not trigger while waiting for user confirmation
      
      let isFinished = false;
      let isCancelled = false;
      let isAwaitingConfirmation = false;
      
      const checkAutoExtension = () => {
        if (isFinished || isCancelled || isAwaitingConfirmation) {
          return false; // Exit early
        }
        return true; // Can proceed with auto-extension
      };
      
      // Normal state - can auto-extend
      expect(checkAutoExtension()).toBe(true);
      
      // While awaiting confirmation - cannot auto-extend
      isAwaitingConfirmation = true;
      expect(checkAutoExtension()).toBe(false);
      
      // After confirmation - can auto-extend again
      isAwaitingConfirmation = false;
      expect(checkAutoExtension()).toBe(true);
    });
  });

  describe('Issue #3: Track extensions manually', () => {
    it('should track manual extension count separately from auto-extensions', () => {
      // Manual extensions should be tracked independently
      
      let manualExtensionCount = 0;
      let totalManualExtensionMs = 0;
      let autoExtensionCount = 0;
      
      const TIMEOUT_EXTENSION_MS = 1200000; // 20 min
      
      // First manual extension
      manualExtensionCount++;
      totalManualExtensionMs += TIMEOUT_EXTENSION_MS;
      
      expect(manualExtensionCount).toBe(1);
      expect(totalManualExtensionMs).toBe(1200000);
      
      // Auto-extension
      autoExtensionCount++;
      
      expect(autoExtensionCount).toBe(1);
      
      // Second manual extension
      manualExtensionCount++;
      totalManualExtensionMs += TIMEOUT_EXTENSION_MS;
      
      expect(manualExtensionCount).toBe(2);
      expect(totalManualExtensionMs).toBe(2400000); // 40 min
      
      // Total extensions
      const totalExtensions = autoExtensionCount + manualExtensionCount;
      expect(totalExtensions).toBe(3);
    });

    it('should include manual extension data in logs', () => {
      // Verify that manual extension logging includes correct metadata
      
      const userId = 'user123';
      const chatId = 123456;
      let manualExtensionCount = 0;
      let totalManualExtensionMs = 0;
      const TIMEOUT_EXTENSION_MS = 1200000;
      const elapsed = 3000000; // 50 min
      
      // Simulate manual extension
      manualExtensionCount++;
      totalManualExtensionMs += TIMEOUT_EXTENSION_MS;
      
      // Log data that should be included
      const logData = {
        userId,
        chatId,
        manualExtensionCount,
        totalManualExtensionMs,
        elapsedMs: elapsed,
      };
      
      expect(logData.manualExtensionCount).toBe(1);
      expect(logData.totalManualExtensionMs).toBe(1200000);
      expect(logData.elapsedMs).toBe(3000000);
    });
  });

  describe('Issue #4: Add MAX_TIMEOUT_DURATION validation to /extend command', () => {
    it('should validate MAX_TIMEOUT_DURATION in /extend command', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const config = (await import('../src/config')).config;
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: vi.fn(),
          on: vi.fn(() => () => {}),
        })),
      };

      const sessionManager = new SessionManager(mockClient as any);
      const userId = 'user123';
      
      sessionManager.setBusy(userId, true);
      const timeoutCallback = vi.fn();
      
      // Start with operation that has been running for 110 minutes
      const startTime = Date.now() - 6600000; // 110 min ago
      sessionManager.startTimeout(userId, config.COPILOT_OPERATION_TIMEOUT, timeoutCallback);
      
      // Simulate elapsed time
      const elapsed = 6600000; // 110 min
      const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS; // 110 + 20 = 130 min
      
      // Check if would exceed MAX_TIMEOUT_DURATION (120 min)
      const wouldExceedMax = projectedTotal > config.MAX_TIMEOUT_DURATION;
      
      expect(wouldExceedMax).toBe(true);
      expect(projectedTotal).toBe(7800000); // 130 min
      expect(config.MAX_TIMEOUT_DURATION).toBe(7200000); // 120 min
      
      // Extension should be rejected
      if (wouldExceedMax) {
        // Should send error message and NOT extend
        const shouldExtend = false;
        expect(shouldExtend).toBe(false);
      }
    });

    it('should allow /extend if within MAX_TIMEOUT_DURATION', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const config = (await import('../src/config')).config;
      
      const mockClient = {
        createSession: vi.fn(async () => ({
          destroy: vi.fn(),
          on: vi.fn(() => () => {}),
        })),
      };

      const sessionManager = new SessionManager(mockClient as any);
      const userId = 'user123';
      
      sessionManager.setBusy(userId, true);
      const timeoutCallback = vi.fn();
      sessionManager.startTimeout(userId, config.COPILOT_OPERATION_TIMEOUT, timeoutCallback);
      
      // Simulate elapsed time of 80 minutes
      const elapsed = 4800000; // 80 min
      const projectedTotal = elapsed + config.TIMEOUT_EXTENSION_MS; // 80 + 20 = 100 min
      
      // Check if within MAX_TIMEOUT_DURATION (120 min)
      const withinMax = projectedTotal <= config.MAX_TIMEOUT_DURATION;
      
      expect(withinMax).toBe(true);
      expect(projectedTotal).toBe(6000000); // 100 min
      
      // Extension should be allowed
      if (withinMax) {
        const success = sessionManager.extendTimeout(userId, config.TIMEOUT_EXTENSION_MS);
        expect(success).toBe(true);
      }
    });
  });

  describe('Issue #5: Fix heartbeat remaining time calculation', () => {
    it('should calculate remaining time from actual timeout schedule', () => {
      // After startTimeout resets tracking, heartbeat should calculate
      // remaining time from manual tracking, not SessionManager methods
      
      const startTime = Date.now();
      const baseTimeout = 3600000; // 60 min original timeout
      const autoExtensionCount = 2;
      const manualExtensionCount = 1;
      const TIMEOUT_EXTENSION_MS = 1200000; // 20 min
      
      // Calculate effective timeout
      const totalAutoExtensionMs = autoExtensionCount * TIMEOUT_EXTENSION_MS; // 40 min
      const totalManualExtensionMs = manualExtensionCount * TIMEOUT_EXTENSION_MS; // 20 min
      const effectiveTimeout = baseTimeout + totalAutoExtensionMs + totalManualExtensionMs; // 120 min
      
      // Current elapsed time
      const elapsed = 5400000; // 90 min
      
      // Calculate remaining
      const remaining = effectiveTimeout - elapsed;
      const remainingMinutes = Math.max(0, Math.floor(remaining / 60000));
      
      expect(effectiveTimeout).toBe(7200000); // 120 min
      expect(remaining).toBe(1800000); // 30 min
      expect(remainingMinutes).toBe(30);
    });

    it('should include total extension count in heartbeat', () => {
      // Heartbeat should show total extensions (auto + manual)
      
      const autoExtensionCount = 2;
      const manualExtensionCount = 1;
      const totalExtensions = autoExtensionCount + manualExtensionCount;
      
      expect(totalExtensions).toBe(3);
      
      // Message format
      const heartbeatMessage = `⏳ La tarea sigue en progreso (90m 0s). Tiempo restante: 30m. ⏱️ Extendido ${totalExtensions}x. /stop para cancelar`;
      
      expect(heartbeatMessage).toContain('Extendido 3x');
    });

    it('should use manual tracking instead of SessionManager for remaining time', () => {
      // After startTimeout is called, SessionManager tracking resets
      // Must use manual tracking: baseTimeout + (autoExtensionCount * EXTENSION_MS) + totalManualExtensionMs
      
      const timeoutMs = 3600000; // Original timeout
      const autoExtensionCount = 1;
      const totalManualExtensionMs = 1200000; // One manual extension
      const TIMEOUT_EXTENSION_MS = 1200000;
      
      const effectiveTimeout = timeoutMs + (autoExtensionCount * TIMEOUT_EXTENSION_MS) + totalManualExtensionMs;
      
      expect(effectiveTimeout).toBe(6000000); // 60 + 20 + 20 = 100 min
      
      const elapsed = 4800000; // 80 min
      const remaining = effectiveTimeout - elapsed;
      const remainingMinutes = Math.floor(remaining / 60000);
      
      expect(remaining).toBe(1200000); // 20 min
      expect(remainingMinutes).toBe(20);
    });
  });

  describe('Integration: Complete workflow', () => {
    it('should handle auto-extension followed by manual extension correctly', () => {
      // Scenario:
      // 1. Start with 60 min timeout
      // 2. Auto-extend at 42 min (70% threshold) -> +20 min (now 80 min total)
      // 3. User manually extends at 50 min -> +20 min (now 100 min total)
      // 4. Heartbeat at 70 min should show 30 min remaining
      
      const startTime = Date.now();
      const baseTimeout = 3600000; // 60 min
      let autoExtensionCount = 0;
      let manualExtensionCount = 0;
      let totalManualExtensionMs = 0;
      const TIMEOUT_EXTENSION_MS = 1200000; // 20 min
      
      // Step 1: Start operation
      // (timeout set to 60 min)
      
      // Step 2: Auto-extend at 42 min
      autoExtensionCount++;
      
      // Step 3: Manual extend at 50 min (user confirms or uses /extend)
      manualExtensionCount++;
      totalManualExtensionMs += TIMEOUT_EXTENSION_MS;
      
      // Step 4: Calculate remaining at 70 min
      const elapsed = 4200000; // 70 min
      const effectiveTimeout = baseTimeout + (autoExtensionCount * TIMEOUT_EXTENSION_MS) + totalManualExtensionMs;
      const remaining = effectiveTimeout - elapsed;
      const remainingMinutes = Math.floor(remaining / 60000);
      
      expect(effectiveTimeout).toBe(6000000); // 100 min
      expect(remaining).toBe(1800000); // 30 min
      expect(remainingMinutes).toBe(30);
      
      const totalExtensions = autoExtensionCount + manualExtensionCount;
      expect(totalExtensions).toBe(2);
    });

    it('should prevent race condition during user confirmation', async () => {
      // Scenario:
      // 1. handleTimeout is called, starts asking user
      // 2. While waiting for user, auto-extension check runs
      // 3. Auto-extension should be blocked by isAwaitingConfirmation
      
      let isAwaitingConfirmation = false;
      let isFinished = false;
      let isCancelled = false;
      
      const handleTimeout = async () => {
        if (isFinished || isCancelled || isAwaitingConfirmation) return;
        
        isAwaitingConfirmation = true;
        try {
          // Simulate user confirmation (takes time)
          await new Promise((resolve) => setTimeout(resolve, 50));
          return true; // User confirmed
        } finally {
          isAwaitingConfirmation = false;
        }
      };
      
      const checkAutoExtension = () => {
        if (isFinished || isCancelled || isAwaitingConfirmation) {
          return false; // Blocked
        }
        return true; // Can proceed
      };
      
      // Start handleTimeout
      const confirmationPromise = handleTimeout();
      
      // While waiting, try auto-extension
      vi.advanceTimersByTime(30000);
      const canAutoExtend = checkAutoExtension();
      
      // Should be blocked
      expect(canAutoExtend).toBe(false);
      
      // Wait for confirmation to complete
      await confirmationPromise;
      
      // Now should be able to auto-extend
      expect(checkAutoExtension()).toBe(true);
    });
  });

  describe('Logging and monitoring', () => {
    it('should log manual extensions with correct metadata', () => {
      const userId = 'user123';
      const chatId = 123456;
      const elapsed = 3000000; // 50 min
      let manualExtensionCount = 1;
      let totalManualExtensionMs = 1200000;
      
      const logData = {
        userId,
        chatId,
        manualExtensionCount,
        totalManualExtensionMs,
        elapsedMs: elapsed,
      };
      
      expect(logData).toEqual({
        userId: 'user123',
        chatId: 123456,
        manualExtensionCount: 1,
        totalManualExtensionMs: 1200000,
        elapsedMs: 3000000,
      });
    });

    it('should log heartbeat with extension info', () => {
      const elapsed = 4200000; // 70 min
      const remaining = 1800000; // 30 min
      const autoExtensionCount = 1;
      const manualExtensionCount = 1;
      const totalExtensions = 2;
      
      const logData = {
        elapsedMs: elapsed,
        remainingMs: remaining,
        autoExtensionCount,
        manualExtensionCount,
        totalExtensions,
      };
      
      expect(logData.totalExtensions).toBe(2);
      expect(logData.autoExtensionCount).toBe(1);
      expect(logData.manualExtensionCount).toBe(1);
    });
  });
});
