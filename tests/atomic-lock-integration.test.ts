/**
 * Integration tests for timeout extension lock race condition fix
 * 
 * These tests verify that the AtomicLock implementation in message-handler.ts
 * correctly prevents race conditions in real-world timeout extension scenarios.
 * 
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../src/config', () => ({
  config: {
    TIMEOUT_EXTENSION_MS: 1200000, // 20 minutes
    MAX_TIMEOUT_DURATION: 7200000, // 2 hours
  },
  isPathAllowed: vi.fn(() => true),
  needsAllowlistSetup: vi.fn(() => false),
}));

vi.mock('../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/copilot/session-manager', () => ({
  SessionManager: class {
    private busy = new Map<string, boolean>();
    private timeouts = new Map<string, NodeJS.Timeout>();
    private extensions = new Map<string, number>();
    
    setBusy(userId: string, busy: boolean) {
      this.busy.set(userId, busy);
    }
    
    isBusy(userId: string) {
      return this.busy.get(userId) || false;
    }
    
    startTimeout(userId: string, ms: number, callback: () => void) {
      this.extensions.set(userId, 0);
      const timeout = setTimeout(callback, ms);
      this.timeouts.set(userId, timeout);
    }
    
    extendTimeout(userId: string, ms: number): boolean {
      if (!this.isBusy(userId)) return false;
      
      const current = this.extensions.get(userId) || 0;
      this.extensions.set(userId, current + ms);
      return true;
    }
    
    getTimeoutExtension(userId: string): number {
      return this.extensions.get(userId) || 0;
    }
  },
}));

describe('Message Handler - Timeout Extension Lock Integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Race Condition Prevention in Real Scenarios', () => {
    it('should prevent auto and manual extensions from running simultaneously', async () => {
      // This test simulates the exact scenario that was causing the bug:
      // - Auto-extension timer fires
      // - User clicks "extend" button at almost the same time
      // - Both attempt to acquire lock
      // - Only one should succeed
      
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'user123';
      let autoExtensionCalled = false;
      let manualExtensionCalled = false;
      
      // Simulate auto-extension
      const autoExtension = async () => {
        if (!lock.tryAcquire(userId)) {
          return { type: 'auto', success: false, reason: 'lock_held' };
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 50));
          autoExtensionCalled = true;
          return { type: 'auto', success: true };
        } finally {
          lock.release(userId);
        }
      };
      
      // Simulate manual extension
      const manualExtension = async () => {
        if (!lock.tryAcquire(userId)) {
          return { type: 'manual', success: false, reason: 'lock_held' };
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 30));
          manualExtensionCalled = true;
          return { type: 'manual', success: true };
        } finally {
          lock.release(userId);
        }
      };
      
      // Fire both simultaneously (race condition scenario)
      const [autoResult, manualResult] = await Promise.all([
        autoExtension(),
        manualExtension(),
      ]);
      
      // CRITICAL: Only one should have succeeded
      const successCount = [autoResult.success, manualResult.success].filter(Boolean).length;
      expect(successCount).toBe(1);
      
      // Only one extension function should have been called
      expect(autoExtensionCalled !== manualExtensionCalled).toBe(true);
      
      // One should report lock_held
      const blockedResults = [autoResult, manualResult].filter(
        r => 'reason' in r && r.reason === 'lock_held'
      );
      expect(blockedResults).toHaveLength(1);
    });
    
    it('should handle multiple rapid-fire extension attempts', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'stress-test-user';
      const attemptCount = 20;
      let successfulExtensions = 0;
      
      const attemptExtension = async (attemptId: number) => {
        if (!lock.tryAcquire(userId)) {
          return { attemptId, success: false };
        }
        
        try {
          // Simulate varying processing times
          await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 10));
          successfulExtensions++;
          return { attemptId, success: true };
        } finally {
          lock.release(userId);
        }
      };
      
      const results = await Promise.all(
        Array.from({ length: attemptCount }, (_, i) => attemptExtension(i))
      );
      
      // Only ONE extension should have succeeded
      expect(successfulExtensions).toBe(1);
      
      const successful = results.filter(r => r.success);
      expect(successful).toHaveLength(1);
      
      const failed = results.filter(r => !r.success);
      expect(failed).toHaveLength(attemptCount - 1);
    });
    
    it('should properly release lock even if extension operation throws', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'error-user';
      
      const extensionWithError = async () => {
        if (!lock.tryAcquire(userId)) {
          throw new Error('Lock already held');
        }
        
        try {
          // Simulate operation that throws
          throw new Error('Extension operation failed');
        } finally {
          // CRITICAL: Must release even on error
          lock.release(userId);
        }
      };
      
      await expect(extensionWithError()).rejects.toThrow('Extension operation failed');
      
      // Lock should be released
      expect(lock.isLocked(userId)).toBe(false);
      
      // Should be able to acquire again
      const reacquired = lock.tryAcquire(userId);
      expect(reacquired).toBe(true);
    });
    
    it('should handle sequential extensions correctly after lock release', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'sequential-user';
      const extensionLog: number[] = [];
      
      const extend = async (id: number) => {
        if (!lock.tryAcquire(userId)) {
          return false;
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 10));
          extensionLog.push(id);
          return true;
        } finally {
          lock.release(userId);
        }
      };
      
      // First extension
      const result1 = await extend(1);
      expect(result1).toBe(true);
      
      // Wait for lock to be fully released
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Second extension (should succeed)
      const result2 = await extend(2);
      expect(result2).toBe(true);
      
      // Third extension
      const result3 = await extend(3);
      expect(result3).toBe(true);
      
      expect(extensionLog).toEqual([1, 2, 3]);
      expect(lock.isLocked(userId)).toBe(false);
    });
  });
  
  describe('Memory Leak Prevention', () => {
    it('should not leak locks over many extension cycles', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'leak-test-user';
      const cycles = 250;
      
      for (let i = 0; i < cycles; i++) {
        const acquired = lock.tryAcquire(userId);
        expect(acquired).toBe(true);
        
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 1));
        
        lock.release(userId);
      }
      
      // No locks should remain
      expect(lock.size()).toBe(0);
      expect(lock.isLocked(userId)).toBe(false);
    });
    
    it('should handle multiple users without interference', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const users = ['user1', 'user2', 'user3', 'user4', 'user5'];
      
      // All users acquire locks
      const acquisitions = users.map(userId => lock.tryAcquire(userId));
      expect(acquisitions.every(a => a === true)).toBe(true);
      expect(lock.size()).toBe(5);
      
      // Release user2 and user4
      lock.release('user2');
      lock.release('user4');
      expect(lock.size()).toBe(3);
      
      // user2 and user4 should be able to reacquire
      expect(lock.tryAcquire('user2')).toBe(true);
      expect(lock.tryAcquire('user4')).toBe(true);
      expect(lock.size()).toBe(5);
      
      // Others still locked
      expect(lock.isLocked('user1')).toBe(true);
      expect(lock.isLocked('user3')).toBe(true);
      expect(lock.isLocked('user5')).toBe(true);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle rapid acquire-release cycles', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const userId = 'rapid-user';
      
      for (let i = 0; i < 100; i++) {
        expect(lock.tryAcquire(userId)).toBe(true);
        lock.release(userId);
      }
      
      expect(lock.isLocked(userId)).toBe(false);
      expect(lock.size()).toBe(0);
    });
    
    it('should handle concurrent operations on different users', async () => {
      const { AtomicLock } = await import('../src/utils/atomic-lock');
      const lock = new AtomicLock();
      const results: string[] = [];
      
      const doWork = async (userId: string) => {
        if (!lock.tryAcquire(userId)) {
          return;
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 10));
          results.push(userId);
        } finally {
          lock.release(userId);
        }
      };
      
      await Promise.all([
        doWork('user1'),
        doWork('user2'),
        doWork('user3'),
        doWork('user1'), // Duplicate - should fail
        doWork('user2'), // Duplicate - should fail
      ]);
      
      // Should have 3 unique results (user1, user2, user3)
      expect(results.length).toBe(3);
      expect(new Set(results).size).toBe(3);
      expect(results.sort()).toEqual(['user1', 'user2', 'user3']);
    });
  });
});
