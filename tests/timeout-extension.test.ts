import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  MAX_SESSIONS: '1',
  TIMEOUT_EXTENSION_MS: '1200000', // 20 minutes default
};

describe('SessionManager - Timeout Extension', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('extendTimeout', () => {
    it('should return false when no active timeout', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      const result = manager.extendTimeout(userId, 600000);
      expect(result).toBe(false);
    });

    it('should return false when user is not busy', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      // User is not busy
      const result = manager.extendTimeout(userId, 600000);
      expect(result).toBe(false);
    });

    it('should successfully extend timeout when busy', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      // Set user as busy and start a timeout
      manager.setBusy(userId, true);
      const onTimeout = vi.fn();
      manager.startTimeout(userId, 3600000, onTimeout); // 60 min initial timeout
      
      // Advance 5 minutes
      vi.advanceTimersByTime(300000);
      
      // Extend by 20 minutes
      const result = manager.extendTimeout(userId, 1200000);
      expect(result).toBe(true);
      
      // Verify timeout hasn't fired yet (original would have been at 60 min, now 80 min)
      expect(onTimeout).not.toHaveBeenCalled();
      
      // Advance to original timeout point (55 more minutes = 60 total)
      vi.advanceTimersByTime(3300000);
      expect(onTimeout).not.toHaveBeenCalled();
      
      // Advance to extended timeout point (20 more minutes = 80 total)
      vi.advanceTimersByTime(1200000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('should accumulate multiple extensions', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      const onTimeout = vi.fn();
      manager.startTimeout(userId, 3600000, onTimeout); // 60 min
      
      // First extension: +20 min
      manager.extendTimeout(userId, 1200000);
      
      // Advance 65 minutes
      vi.advanceTimersByTime(3900000);
      expect(onTimeout).not.toHaveBeenCalled();
      
      // Second extension: +20 min more (total 100 min)
      manager.extendTimeout(userId, 1200000);
      
      // Advance to 95 minutes total
      vi.advanceTimersByTime(1800000);
      expect(onTimeout).not.toHaveBeenCalled();
      
      // Advance to 100 minutes total
      vi.advanceTimersByTime(300000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('should return total extensions via getTimeoutExtension', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      const onTimeout = vi.fn();
      manager.startTimeout(userId, 3600000, onTimeout);
      
      expect(manager.getTimeoutExtension(userId)).toBe(0);
      
      manager.extendTimeout(userId, 1200000);
      expect(manager.getTimeoutExtension(userId)).toBe(1200000);
      
      manager.extendTimeout(userId, 1200000);
      expect(manager.getTimeoutExtension(userId)).toBe(2400000);
    });

    it('should clear timeout extension when setBusy(false)', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      const onTimeout = vi.fn();
      manager.startTimeout(userId, 3600000, onTimeout);
      manager.extendTimeout(userId, 1200000);
      
      expect(manager.getTimeoutExtension(userId)).toBe(1200000);
      
      manager.setBusy(userId, false);
      
      expect(manager.getTimeoutExtension(userId)).toBe(0);
    });

    it('should clear timeout when clearTimeout is called', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      const onTimeout = vi.fn();
      manager.startTimeout(userId, 3600000, onTimeout);
      
      manager.clearTimeout(userId);
      
      // Timeout should not fire
      vi.advanceTimersByTime(2000000);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('getOriginalTimeout', () => {
    it('should return original timeout value', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 3600000, () => {});
      
      expect(manager.getOriginalTimeout(userId)).toBe(3600000);
    });

    it('should return null when no timeout', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      expect(manager.getOriginalTimeout(userId)).toBeNull();
    });

    it('should remain unchanged after extensions', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 3600000, () => {});
      
      manager.extendTimeout(userId, 1200000);
      manager.extendTimeout(userId, 1200000);
      
      // Original timeout should not change
      expect(manager.getOriginalTimeout(userId)).toBe(3600000);
    });
  });

  describe('Critical Bug Fix: Manual Extension Timeout Reset', () => {
    it('should NOT timeout immediately after manual extension', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const onTimeout = vi.fn();

      // Simulate typical session: 5 minutes initial timeout
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 300000, onTimeout); // 5 min

      // Simulate 4 minutes elapsed (user working)
      vi.advanceTimersByTime(240000); // 4 min

      // User confirms manual extension (5 minutes more)
      const extended = manager.extendTimeout(userId, 300000);
      expect(extended).toBe(true);

      // CRITICAL: Should NOT timeout immediately after extension
      vi.advanceTimersByTime(0);
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000); // +1s
      expect(onTimeout).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10000); // +10s
      expect(onTimeout).not.toHaveBeenCalled();

      // Math verification:
      // originalTimeout = 300000 (5 min) - MUST NOT be reset
      // totalExtensions = 300000 (5 min)
      // elapsed at extension = 240000 (4 min)
      // remainingTime = (300000 + 300000) - 240000 = 360000ms = 6 minutes

      // Should timeout after 6 minutes total from extension point
      vi.advanceTimersByTime(349000); // +349s more (total 360s from extension)
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('should preserve originalTimeout across multiple manual extensions', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const onTimeout = vi.fn();

      // Start with 5 minute timeout
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 300000, onTimeout);

      // First manual extension after 4 minutes
      vi.advanceTimersByTime(240000); // 4 min elapsed
      manager.extendTimeout(userId, 300000); // +5 min
      
      // originalTimeout should still be 300000
      expect(manager.getOriginalTimeout(userId)).toBe(300000);

      // Second manual extension after another 3 minutes (7 min total elapsed)
      vi.advanceTimersByTime(180000); // +3 min
      manager.extendTimeout(userId, 300000); // +5 min more
      
      // originalTimeout MUST still be 300000 (NOT reset!)
      expect(manager.getOriginalTimeout(userId)).toBe(300000);

      // Math after second extension:
      // originalTimeout = 300000
      // totalExtensions = 600000 (two 5-min extensions)
      // elapsed = 420000 (7 min)
      // remainingTime = (300000 + 600000) - 420000 = 480000ms = 8 min

      expect(onTimeout).not.toHaveBeenCalled();

      // Should timeout after 8 minutes from second extension
      vi.advanceTimersByTime(480000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('should handle extension when elapsed time exceeds originalTimeout', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const onTimeout = vi.fn();

      // Start with 1 minute timeout
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 60000, onTimeout); // 1 min

      // Advance 59 seconds (just before timeout)
      vi.advanceTimersByTime(59000);

      // Extend by 2 minutes
      const extended = manager.extendTimeout(userId, 120000);
      expect(extended).toBe(true);

      // Even though elapsed (59s) is close to originalTimeout (60s),
      // we should have proper remaining time calculated
      // remainingTime = (60000 + 120000) - 59000 = 121000ms

      expect(onTimeout).not.toHaveBeenCalled();

      // Should timeout after ~121 seconds from extension
      vi.advanceTimersByTime(121000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('should use Math.max(0, ...) to prevent negative remaining time', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const onTimeout = vi.fn();

      // Start with 1 minute timeout
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 60000, onTimeout);

      // Let it timeout
      vi.advanceTimersByTime(60000);
      expect(onTimeout).toHaveBeenCalledOnce();

      // Try to extend after timeout (edge case)
      const extended = manager.extendTimeout(userId, 30000);
      expect(extended).toBe(true);
    });

    it('should calculate correct remaining time with large extensions', async () => {
      const { SessionManager } = await import('../src/copilot/session-manager');
      const client = {
        createSession: vi.fn(async () => ({
          destroy: async () => {},
          on: () => () => {},
        })),
      };

      const manager = new SessionManager(client as any);
      const userId = 'user123';
      const onTimeout = vi.fn();

      // Start with 5 minute timeout
      manager.setBusy(userId, true);
      manager.startTimeout(userId, 300000, onTimeout); // 5 min

      // Advance 4.5 minutes (almost timed out)
      vi.advanceTimersByTime(270000);

      // Extend by 20 minutes (large extension)
      const extended = manager.extendTimeout(userId, 1200000);
      expect(extended).toBe(true);

      // Math:
      // originalTimeout = 300000 (5 min)
      // totalExtensions = 1200000 (20 min)
      // elapsed = 270000 (4.5 min)
      // remainingTime = 1500000 - 270000 = 1230000ms = 20.5 min

      expect(onTimeout).not.toHaveBeenCalled();

      // Verify originalTimeout not reset
      expect(manager.getOriginalTimeout(userId)).toBe(300000);

      // Should timeout after 20.5 minutes
      vi.advanceTimersByTime(1230000);
      expect(onTimeout).toHaveBeenCalledOnce();
    });
  });
});
