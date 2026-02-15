/**
 * Tests for time utility functions
 */

import { describe, it, expect } from 'vitest';
import { formatElapsedTime } from '../src/utils/time';

describe('formatElapsedTime', () => {
  it('should format seconds only', () => {
    expect(formatElapsedTime(0)).toBe('0s');
    expect(formatElapsedTime(5000)).toBe('5s');
    expect(formatElapsedTime(30000)).toBe('30s');
    expect(formatElapsedTime(59000)).toBe('59s');
  });

  it('should format minutes and seconds', () => {
    expect(formatElapsedTime(60000)).toBe('1m 0s');
    expect(formatElapsedTime(65000)).toBe('1m 5s');
    expect(formatElapsedTime(125000)).toBe('2m 5s');
    expect(formatElapsedTime(3599000)).toBe('59m 59s');
  });

  it('should format hours and minutes', () => {
    expect(formatElapsedTime(3600000)).toBe('1h 0m');
    expect(formatElapsedTime(3660000)).toBe('1h 1m');
    expect(formatElapsedTime(7200000)).toBe('2h 0m');
    expect(formatElapsedTime(7380000)).toBe('2h 3m');
  });

  it('should floor fractional seconds', () => {
    expect(formatElapsedTime(1500)).toBe('1s');
    expect(formatElapsedTime(999)).toBe('0s');
  });

  it('should handle large values correctly', () => {
    // 24 hours
    expect(formatElapsedTime(86400000)).toBe('24h 0m');
    // 25 hours
    expect(formatElapsedTime(90000000)).toBe('25h 0m');
    // 1 day, 2 hours, 30 minutes
    expect(formatElapsedTime(95400000)).toBe('26h 30m');
  });
});
