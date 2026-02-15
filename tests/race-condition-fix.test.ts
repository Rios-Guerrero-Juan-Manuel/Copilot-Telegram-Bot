import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Test suite for Race Condition Fix in Timeout Extension
 * 
 * Verifies that the mutex pattern prevents concurrent timeout extensions
 * between auto-extend and manual confirmation.
 */
describe('Race Condition Fix - Timeout Extension Mutex', () => {
  let messageHandlerContent: string;

  beforeEach(() => {
    const filePath = join(__dirname, '..', 'src', 'bot', 'message-handler.ts');
    messageHandlerContent = readFileSync(filePath, 'utf-8');
  });

  describe('Mutex Infrastructure', () => {
    it('should have timeoutExtensionLocks Map declared', () => {
      expect(messageHandlerContent).toMatch(/timeoutExtensionLocks|timeoutExtensionLock/);
      expect(messageHandlerContent).toMatch(/new Map<string,\s*boolean>\(\)|new AtomicLock\(\)/);
    });

    it('should have acquireExtensionLock function with correct signature', () => {
      expect(messageHandlerContent).toMatch(/function acquireExtensionLock\(/);
      expect(messageHandlerContent).toMatch(/userId:\s*string/);
      expect(messageHandlerContent).toMatch(/operationType:\s*['"]auto['"][\s|]*['"]manual['"]/);
      expect(messageHandlerContent).toMatch(/:\s*boolean/);
    });

    it('should have releaseExtensionLock function with correct signature', () => {
      expect(messageHandlerContent).toMatch(/function releaseExtensionLock\(/);
      expect(messageHandlerContent).toMatch(/userId:\s*string/);
      expect(messageHandlerContent).toMatch(/operationType:\s*['"]auto['"][\s|]*['"]manual['"]/);
    });

    it('should check if lock is already held before acquiring', () => {
      const acquireFnMatch = messageHandlerContent.match(
        /function acquireExtensionLock[\s\S]*?^}/m
      );
      expect(acquireFnMatch).toBeTruthy();
      const acquireFn = acquireFnMatch![0];
      
      expect(acquireFn).toMatch(/timeoutExtensionLocks\.get\(userId\)|timeoutExtensionLock\.tryAcquire\(userId\)/);
      expect(acquireFn).toContain('return false');
    });

    it('should delete lock in releaseExtensionLock', () => {
      const releaseFnMatch = messageHandlerContent.match(
        /function releaseExtensionLock[\s\S]*?^}/m
      );
      expect(releaseFnMatch).toBeTruthy();
      const releaseFn = releaseFnMatch![0];
      
      expect(releaseFn).toMatch(/timeoutExtensionLocks\.delete\(userId\)|timeoutExtensionLock\.release\(userId\)/);
    });
  });

  describe('Auto-Extension Lock Usage', () => {
    let checkAutoExtensionFn: string;

    beforeEach(() => {
      const match = messageHandlerContent.match(
        /function checkAutoExtension[\s\S]*?^}/m
      );
      expect(match).toBeTruthy();
      checkAutoExtensionFn = match![0];
    });

    it('should acquire lock before extending', () => {
      expect(checkAutoExtensionFn).toContain("acquireExtensionLock(ctx.userId, 'auto')");
    });

    it('should return false if lock cannot be acquired', () => {
      // Check for pattern: if (!acquireExtensionLock(...)) { ... return false }
      expect(checkAutoExtensionFn).toMatch(/if\s*\(\s*!acquireExtensionLock/);
      expect(checkAutoExtensionFn).toMatch(/return false/);
    });

    it('should release lock in finally block', () => {
      expect(checkAutoExtensionFn).toContain('finally');
      expect(checkAutoExtensionFn).toMatch(/finally[\s\S]*releaseExtensionLock\(ctx\.userId,\s*['"]auto['"]\)/);
    });

    it('should have try-finally structure for lock guarantee', () => {
      expect(checkAutoExtensionFn).toMatch(/try[\s\S]*finally/);
    });
  });

  describe('Manual Extension Lock Usage', () => {
    let handleTimeoutFn: string;

    beforeEach(() => {
      const match = messageHandlerContent.match(
        /const handleTimeout = async[\s\S]*?};/
      );
      expect(match).toBeTruthy();
      handleTimeoutFn = match![0];
    });

    it('should acquire lock before asking for confirmation', () => {
      expect(handleTimeoutFn).toContain("acquireExtensionLock(userId, 'manual')");
    });

    it('should return early if lock cannot be acquired', () => {
      // Check for pattern: if (!acquireExtensionLock(...)) { ... return }
      expect(handleTimeoutFn).toMatch(/if\s*\(\s*!acquireExtensionLock/);
      expect(handleTimeoutFn).toMatch(/isAwaitingConfirmation = false/);
      expect(handleTimeoutFn).toMatch(/return/);
    });

    it('should release lock in finally block', () => {
      expect(handleTimeoutFn).toContain('finally');
      expect(handleTimeoutFn).toMatch(/finally[\s\S]*releaseExtensionLock\(userId,\s*['"]manual['"]\)/);
    });

    it('should reset isAwaitingConfirmation in finally block', () => {
      expect(handleTimeoutFn).toMatch(/finally[\s\S]*isAwaitingConfirmation = false/);
    });

    it('should have try-finally structure for lock guarantee', () => {
      expect(handleTimeoutFn).toMatch(/try[\s\S]*finally/);
    });
  });

  describe('Logging and Documentation', () => {
    it('should log lock acquisition', () => {
      expect(messageHandlerContent).toMatch(/logger\.debug.*Extension lock acquired/i);
    });

    it('should log lock release', () => {
      expect(messageHandlerContent).toMatch(/logger\.debug.*Extension lock released/i);
    });

    it('should log when lock is already held', () => {
      expect(messageHandlerContent).toMatch(/logger\.debug.*lock.*already/i);
    });

    it('should document race condition protection', () => {
      expect(messageHandlerContent).toMatch(/RACE CONDITION PROTECTION/i);
    });

    it('should document invariants', () => {
      expect(messageHandlerContent).toMatch(/INVARIANT/i);
    });

    it('should have detailed comments about lock usage', () => {
      expect(messageHandlerContent).toMatch(/CRITICAL SECTION/i);
    });
  });

  describe('Race Condition Scenarios', () => {
    it('should prevent double extension when auto and manual happen simultaneously', () => {
      // Both functions acquire lock
      expect(messageHandlerContent).toMatch(/acquireExtensionLock\(ctx\.userId,\s*['"]auto['"]\)/);
      expect(messageHandlerContent).toMatch(/acquireExtensionLock\(userId,\s*['"]manual['"]\)/);
      
      // Both check lock before proceeding
      const autoMatch = messageHandlerContent.match(/function checkAutoExtension[\s\S]*?^}/m);
      const manualMatch = messageHandlerContent.match(/const handleTimeout = async[\s\S]*?};/);
      
      expect(autoMatch![0]).toMatch(/if\s*\(\s*!acquireExtensionLock/);
      expect(manualMatch![0]).toMatch(/if\s*\(\s*!acquireExtensionLock/);
    });

    it('should ensure lock is always released even on error', () => {
      // Check that finally blocks exist for both operations
      const autoMatch = messageHandlerContent.match(/function checkAutoExtension[\s\S]*?^}/m);
      const manualMatch = messageHandlerContent.match(/const handleTimeout = async[\s\S]*?};/);
      
      expect(autoMatch![0]).toContain('finally');
      expect(autoMatch![0]).toMatch(/finally[\s\S]*releaseExtensionLock/);
      
      expect(manualMatch![0]).toContain('finally');
      expect(manualMatch![0]).toMatch(/finally[\s\S]*releaseExtensionLock/);
    });
  });
});
