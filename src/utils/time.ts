/**
 * Time Utility Functions
 * 
 * Provides common time formatting and manipulation utilities.
 */

import { ONE_SECOND_MS } from '../constants';

/**
 * Formats elapsed time in milliseconds to a human-readable string.
 * 
 * - If >= 1 hour: formats as "Xh Ym" (e.g., "2h 30m")
 * - If >= 1 minute: formats as "Xm Ys" (e.g., "5m 30s")
 * - Otherwise: formats as "Xs" (e.g., "45s")
 * 
 * @param ms - Elapsed time in milliseconds
 * @returns Formatted string representing the elapsed time
 */
export function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / ONE_SECOND_MS);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}
