/**
 * Tests de concurrencia para AtomicLock
 * 
 * Estos tests verifican que la clase AtomicLock previene race conditions
 * en el manejo de locks para extensión de timeout.
 * 
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AtomicLock } from '../src/utils/atomic-lock';

describe('AtomicLock - Concurrency Tests', () => {
  let lock: AtomicLock;
  
  beforeEach(() => {
    lock = new AtomicLock();
  });
  
  describe('Basic Lock Operations', () => {
    it('should acquire lock on first attempt', () => {
      const acquired = lock.tryAcquire('user123');
      expect(acquired).toBe(true);
      expect(lock.isLocked('user123')).toBe(true);
    });
    
    it('should reject second acquire attempt for same key', () => {
      lock.tryAcquire('user123');
      const secondAcquire = lock.tryAcquire('user123');
      expect(secondAcquire).toBe(false);
    });
    
    it('should release lock correctly', () => {
      lock.tryAcquire('user123');
      lock.release('user123');
      expect(lock.isLocked('user123')).toBe(false);
    });
    
    it('should allow re-acquisition after release', () => {
      lock.tryAcquire('user123');
      lock.release('user123');
      const reacquired = lock.tryAcquire('user123');
      expect(reacquired).toBe(true);
    });
    
    it('should handle multiple independent locks', () => {
      const lock1 = lock.tryAcquire('user1');
      const lock2 = lock.tryAcquire('user2');
      const lock3 = lock.tryAcquire('user3');
      
      expect(lock1).toBe(true);
      expect(lock2).toBe(true);
      expect(lock3).toBe(true);
      expect(lock.size()).toBe(3);
    });
    
    it('should release only specified lock', () => {
      lock.tryAcquire('user1');
      lock.tryAcquire('user2');
      lock.tryAcquire('user3');
      
      lock.release('user2');
      
      expect(lock.isLocked('user1')).toBe(true);
      expect(lock.isLocked('user2')).toBe(false);
      expect(lock.isLocked('user3')).toBe(true);
      expect(lock.size()).toBe(2);
    });
  });
  
  describe('Race Condition Prevention', () => {
    it('should handle simulated concurrent acquire attempts', async () => {
      const userId = 'concurrent-user';
      const attempts = 10;
      const results: boolean[] = [];
      
      // Simulate 10 concurrent attempts to acquire same lock
      const promises = Array.from({ length: attempts }, async () => {
        // Simulate network delay / concurrent execution
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        return lock.tryAcquire(userId);
      });
      
      const acquireResults = await Promise.all(promises);
      
      // CRITICAL: Only ONE should have succeeded
      const successCount = acquireResults.filter(r => r === true).length;
      expect(successCount).toBe(1);
      
      // All others should have failed
      expect(acquireResults.filter(r => r === false).length).toBe(attempts - 1);
      
      // Lock should be held
      expect(lock.isLocked(userId)).toBe(true);
    });
    
    it('should handle high-volume concurrent operations (stress test)', async () => {
      const userId = 'stress-test-user';
      const concurrentAttempts = 100;
      
      const promises = Array.from({ length: concurrentAttempts }, async (_, i) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
        return lock.tryAcquire(userId);
      });
      
      const results = await Promise.all(promises);
      const successCount = results.filter(r => r === true).length;
      
      // CRITICAL: Exactly ONE acquisition should succeed
      expect(successCount).toBe(1);
      expect(lock.isLocked(userId)).toBe(true);
    });
    
    it('should prevent double-extension scenario', async () => {
      const userId = 'double-extension-user';
      let extensionCount = 0;
      
      // Simulate extension operation
      const performExtension = async () => {
        if (!lock.tryAcquire(userId)) {
          return { extended: false, reason: 'lock_held' };
        }
        
        try {
          // Simulate async extension work
          await new Promise(resolve => setTimeout(resolve, 10));
          extensionCount++;
          return { extended: true, reason: 'success' };
        } finally {
          lock.release(userId);
        }
      };
      
      // Fire 5 concurrent extension attempts
      const results = await Promise.all([
        performExtension(),
        performExtension(),
        performExtension(),
        performExtension(),
        performExtension(),
      ]);
      
      // Only 1 should have extended
      expect(extensionCount).toBe(1);
      
      const successfulExtensions = results.filter(r => r.extended === true);
      expect(successfulExtensions).toHaveLength(1);
      
      const blockedExtensions = results.filter(r => r.reason === 'lock_held');
      expect(blockedExtensions).toHaveLength(4);
    });
  });
  
  describe('Lock Release Guarantees', () => {
    it('should release lock even if operation throws error', async () => {
      const userId = 'error-user';
      
      const operationWithError = async () => {
        if (!lock.tryAcquire(userId)) {
          throw new Error('Lock already held');
        }
        
        try {
          throw new Error('Simulated operation error');
        } finally {
          lock.release(userId);
        }
      };
      
      await expect(operationWithError()).rejects.toThrow('Simulated operation error');
      
      // CRITICAL: Lock must be released even after error
      expect(lock.isLocked(userId)).toBe(false);
    });
    
    it('should not leak locks on repeated acquire-release cycles', async () => {
      const userId = 'leak-test-user';
      const cycles = 100;
      
      for (let i = 0; i < cycles; i++) {
        const acquired = lock.tryAcquire(userId);
        expect(acquired).toBe(true);
        lock.release(userId);
      }
      
      // No locks should remain
      expect(lock.size()).toBe(0);
      expect(lock.isLocked(userId)).toBe(false);
    });
    
    it('should handle clear() without memory leaks', () => {
      // Create many locks
      for (let i = 0; i < 1000; i++) {
        lock.tryAcquire(`user${i}`);
      }
      
      expect(lock.size()).toBe(1000);
      
      lock.clear();
      
      expect(lock.size()).toBe(0);
      
      // All should be releasable and re-acquirable
      const reacquired = lock.tryAcquire('user500');
      expect(reacquired).toBe(true);
    });
  });
  
  describe('Real-World Extension Scenarios', () => {
    it('should handle auto-extension vs manual-extension race', async () => {
      const userId = 'race-scenario';
      let autoExtensions = 0;
      let manualExtensions = 0;
      
      // Simulate auto-extension check
      const autoExtension = async () => {
        if (!lock.tryAcquire(userId)) {
          return { type: 'auto', extended: false };
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 20));
          autoExtensions++;
          return { type: 'auto', extended: true };
        } finally {
          lock.release(userId);
        }
      };
      
      // Simulate manual confirmation
      const manualExtension = async () => {
        if (!lock.tryAcquire(userId)) {
          return { type: 'manual', extended: false };
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 15));
          manualExtensions++;
          return { type: 'manual', extended: true };
        } finally {
          lock.release(userId);
        }
      };
      
      // Fire both simultaneously
      const results = await Promise.all([
        autoExtension(),
        manualExtension(),
      ]);
      
      // CRITICAL: Only one should succeed (either auto OR manual)
      expect(autoExtensions + manualExtensions).toBe(1);
      
      const successfulResults = results.filter(r => r.extended);
      expect(successfulResults).toHaveLength(1);
    });
    
    it('should handle sequential extensions after lock release', async () => {
      const userId = 'sequential-user';
      const extensionLog: string[] = [];
      
      const extend = async (id: string) => {
        if (!lock.tryAcquire(userId)) {
          return false;
        }
        
        try {
          await new Promise(resolve => setTimeout(resolve, 5));
          extensionLog.push(id);
          return true;
        } finally {
          lock.release(userId);
        }
      };
      
      // First extension
      await extend('ext1');
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Second extension (should succeed since first released)
      await extend('ext2');
      
      // Third extension
      await extend('ext3');
      
      expect(extensionLog).toEqual(['ext1', 'ext2', 'ext3']);
      expect(lock.isLocked(userId)).toBe(false);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle release of non-existent lock gracefully', () => {
      // Should not throw
      expect(() => lock.release('non-existent')).not.toThrow();
      expect(lock.isLocked('non-existent')).toBe(false);
    });
    
    it('should handle empty key strings', () => {
      const acquired = lock.tryAcquire('');
      expect(acquired).toBe(true);
      expect(lock.isLocked('')).toBe(true);
      
      lock.release('');
      expect(lock.isLocked('')).toBe(false);
    });
    
    it('should handle very long key strings', () => {
      const longKey = 'user' + 'x'.repeat(10000);
      const acquired = lock.tryAcquire(longKey);
      expect(acquired).toBe(true);
      expect(lock.isLocked(longKey)).toBe(true);
    });
    
    it('should differentiate between similar keys', () => {
      lock.tryAcquire('user123');
      
      expect(lock.isLocked('user123')).toBe(true);
      expect(lock.isLocked('user124')).toBe(false);
      expect(lock.isLocked('user12')).toBe(false);
      expect(lock.isLocked('user1234')).toBe(false);
    });
  });
});
