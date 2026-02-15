/**
 * Database-related types
 * Replaces 'any' in database operations
 */

/**
 * SQLite column information
 */
export interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Generic database row
 */
export interface DatabaseRow {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Plan status values
 */
export type PlanStatus = 
  | 'draft'        // Generated but not approved
  | 'approved'     // Approved and ready to implement
  | 'in_progress'  // Implementation in progress
  | 'completed'    // Successfully implemented
  | 'cancelled'    // Cancelled by user
  | 'interrupted'; // Error/crash during implementation

/**
 * Plan database row
 */
export interface PlanRow {
  id: number;
  user_id: number;
  project_path: string;
  title: string;
  content: string;
  status: PlanStatus;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}
