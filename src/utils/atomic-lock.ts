/**
 * Provides atomic lock mechanism for resource synchronization.
 * Uses JavaScript's single-threaded event loop to guarantee atomicity.
 */
export class AtomicLock {
  private locks = new Map<string, boolean>();
  
  /**
   * Attempts to acquire a lock atomically.
   * 
   * This operation is designed to be atomic - there is no race condition
   * between checking if the lock exists and setting it. In JavaScript's
   * single-threaded event loop, Map.has() followed by Map.set() in the
   * same synchronous block is atomic with respect to other JavaScript code.
   * 
   * @param key - Unique identifier for the resource to lock
   * @returns true if lock was acquired successfully, false if already locked
   * 
   * INVARIANT: If this returns true, the caller MUST call release() in a finally block
   */
  tryAcquire(key: string): boolean {
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, true);
    return true;
  }
  
  /**
   * Releases a lock.
   * 
   * This should always be called in a finally block to ensure the lock
   * is released even if an error occurs during the locked operation.
   * 
   * @param key - Identifier of the resource to unlock
   */
  release(key: string): void {
    this.locks.delete(key);
  }
  
  /**
   * Checks if a lock is currently held.
   * 
   * Useful for debugging and monitoring.
   * 
   * @param key - Identifier of the resource
   * @returns true if the lock is currently held
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }
  
  /**
   * Releases all locks.
   * 
   * Useful for testing and cleanup scenarios.
   * Should generally not be used in production code.
   */
  clear(): void {
    this.locks.clear();
  }
  
  /**
   * Returns the number of active locks.
   * 
   * Useful for debugging and monitoring for potential lock leaks.
   * 
   * @returns Number of currently held locks
   */
  size(): number {
    return this.locks.size;
  }
}
