import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger';
import { i18n } from '../i18n/index.js';

/**
 * Validates that a path exists and is accessible (synchronous).
 * Checks for overly permissive paths (root, home directory).
 * 
 * @param pathToCheck - Path to validate
 * @returns Object with valid flag and optional error message
 */
export function validatePath(pathToCheck: string): { valid: boolean; error?: string } {
  try {
    const resolved = path.resolve(pathToCheck);
    
    if (!fsSync.existsSync(resolved)) {
      return { valid: false, error: i18n.t(0, 'pathSetup.notExists') + `: ${resolved}` };
    }
    
    fsSync.accessSync(resolved, fsSync.constants.R_OK);
    
    const isRoot = resolved === '/' || /^[A-Z]:\\?$/i.test(resolved);
    const isHome = resolved === os.homedir();
    
    if (isRoot) {
      return { valid: false, error: '⚠️ ' + i18n.t(0, 'pathSetup.notAbsolute') };
    }
    
    if (isHome) {
      logger.warn('User configured home directory as allowed path', { path: resolved });
    }
    
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: i18n.t(0, 'pathSetup.errorValidating', { error: error.message }) };
  }
}

/**
 * Validates that a path exists and is accessible (async version).
 * Checks for overly permissive paths (root, home directory).
 * 
 * @param pathToCheck - Path to validate
 * @returns Promise resolving to object with valid flag and optional error message
 */
export async function validatePathAsync(pathToCheck: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const resolved = path.resolve(pathToCheck);
    
    try {
      await fs.access(resolved, fsSync.constants.R_OK);
    } catch {
      return { valid: false, error: i18n.t(0, 'pathSetup.notExists') + `: ${resolved}` };
    }
    
    const isRoot = resolved === '/' || /^[A-Z]:\\?$/i.test(resolved);
    const isHome = resolved === os.homedir();
    
    if (isRoot) {
      return { valid: false, error: '⚠️ ' + i18n.t(0, 'pathSetup.notAbsolute') };
    }
    
    if (isHome) {
      logger.warn('User configured home directory as allowed path', { path: resolved });
    }
    
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: i18n.t(0, 'pathSetup.errorValidating', { error: error.message }) };
  }
}

/**
 * Parses a comma-separated list of paths and validates each one.
 * 
 * @param input - Comma-separated string of paths
 * @returns Object with arrays of valid and invalid paths
 */
export function parsePaths(input: string): { valid: string[]; invalid: Array<{ path: string; error: string }> } {
  const paths = input
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  
  const valid: string[] = [];
  const invalid: Array<{ path: string; error: string }> = [];
  
  for (const p of paths) {
    const result = validatePath(p);
    if (result.valid) {
      valid.push(path.resolve(p));
    } else {
      invalid.push({ path: p, error: result.error || 'Invalid path' });
    }
  }
  
  return { valid, invalid };
}

/**
 * Updates .env file with new ALLOWED_PATHS (async version).
 * Creates new .env file if it doesn't exist.
 * 
 * @param allowedPaths - Array of allowed paths to write
 * @returns Promise that resolves when file is updated
 * @throws Error if file write fails
 */
export async function updateEnvFileAsync(allowedPaths: string[]): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');
  
  try {
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    const pathsValue = allowedPaths.join(',');
    const allowedPathsLine = `ALLOWED_PATHS=${pathsValue}`;
    
    if (envContent.includes('ALLOWED_PATHS=')) {
      envContent = envContent.replace(
        /^ALLOWED_PATHS=.*$/m,
        allowedPathsLine
      );
    } else {
      envContent += `\n${allowedPathsLine}\n`;
    }
    
    await fs.writeFile(envPath, envContent, 'utf-8');
    logger.info('Updated .env file with ALLOWED_PATHS', { paths: allowedPaths });
  } catch (error: any) {
    logger.error('Failed to update .env file', { error: error.message });
    throw error;
  }
}

/**
 * Updates .env file with new ALLOWED_PATHS (synchronous).
 * Creates new .env file if it doesn't exist.
 * 
 * @param allowedPaths - Array of allowed paths to write
 * @throws Error if file write fails
 */
export function updateEnvFile(allowedPaths: string[]): void {
  const envPath = path.join(process.cwd(), '.env');
  
  try {
    let envContent = '';
    
    if (fsSync.existsSync(envPath)) {
      envContent = fsSync.readFileSync(envPath, 'utf-8');
    }
    
    const pathsValue = allowedPaths.join(',');
    const allowedPathsLine = `ALLOWED_PATHS=${pathsValue}`;
    
    if (envContent.includes('ALLOWED_PATHS=')) {
      envContent = envContent.replace(
        /^ALLOWED_PATHS=.*$/m,
        allowedPathsLine
      );
    } else {
      envContent += `\n${allowedPathsLine}\n`;
    }
    
    fsSync.writeFileSync(envPath, envContent, 'utf-8');
    logger.info('Updated .env file with ALLOWED_PATHS', { paths: allowedPaths });
  } catch (error: any) {
    logger.error('Failed to update .env file', { error: error.message });
    throw error;
  }
}
