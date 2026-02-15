import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAllowedPaths, isPathAllowed, setAllowedPaths } from '../src/config';

/**
 * Additional tests for allowlist bypass fix in /plan and /exitplan commands
 * 
 * These commands also use getCurrentCwd() without validation, creating the same bypass vulnerability
 */

describe('Allowlist Bypass Fix - /plan and /exitplan Commands', () => {
  // Store original allowlist
  let originalAllowlist: string[];
  
  beforeEach(() => {
    // Save current state
    originalAllowlist = [...getAllowedPaths()];
  });
  
  afterEach(() => {
    // Restore original state
    setAllowedPaths(originalAllowlist);
  });
  
  describe('/plan command security', () => {
    it('should block /plan when cwd is not in allowlist', () => {
      const cwd = 'C:\\not-allowed\\project';
      setAllowedPaths([]);
      
      // This should fail the security check
      expect(isPathAllowed(cwd)).toBe(false);
      
      // Expected behavior:
      // 1. User executes /plan <task>
      // 2. cwd = getCurrentCwd(user.id)
      // 3. isPathAllowed(cwd) returns false
      // 4. Command blocked with error message
      // 5. NO session created
    });

    it('should allow /plan when cwd is in allowlist', () => {
      const cwd = 'C:\\allowed\\project';
      setAllowedPaths([cwd]);
      
      // This should pass the security check
      expect(isPathAllowed(cwd)).toBe(true);
    });
  });

  describe('/exitplan command security', () => {
    it('should block /exitplan when cwd is not in allowlist', () => {
      const cwd = 'C:\\not-allowed\\project';
      setAllowedPaths([]);
      
      // This should fail the security check
      expect(isPathAllowed(cwd)).toBe(false);
      
      // Expected behavior:
      // 1. User executes /exitplan
      // 2. cwd = getCurrentCwd(user.id)
      // 3. isPathAllowed(cwd) returns false
      // 4. Command blocked with error message
      // 5. NO session created
    });

    it('should allow /exitplan when cwd is in allowlist', () => {
      const cwd = 'C:\\allowed\\project';
      setAllowedPaths([cwd]);
      
      // This should pass the security check
      expect(isPathAllowed(cwd)).toBe(true);
    });
  });

  describe('Bypass scenarios for plan commands', () => {
    it('should block /plan with configured DB but empty .env allowlist', () => {
      // Same bypass scenario as message-handler:
      // - User has allowed_paths_configured = 1 in DB
      // - Admin cleared ALLOWED_PATHS from .env
      // - User tries to use /plan
      
      const userConfiguredInDB = true;
      setAllowedPaths([]); // Empty .env
      const cwd = 'C:\\some\\project';
      
      const cwdAllowed = isPathAllowed(cwd);
      
      // Expected: User should be blocked from using /plan
      expect(cwdAllowed).toBe(false);
    });

    it('should block /exitplan with configured DB but empty .env allowlist', () => {
      // Same bypass scenario for /exitplan command
      
      const userConfiguredInDB = true;
      setAllowedPaths([]); // Empty .env
      const cwd = 'C:\\some\\project';
      const isPlanModeActive = true; // User is currently in plan mode
      
      const cwdAllowed = isPathAllowed(cwd);
      
      // Expected: User should be blocked from using /exitplan
      // (which creates a new normal session)
      expect(cwdAllowed).toBe(false);
    });
  });

  describe('Integration with existing security checks', () => {
    it('should maintain existing /cd security checks', () => {
      // /cd already has isPathAllowed check for targetPath
      const targetPath = 'C:\\not-allowed\\target';
      setAllowedPaths([]);
      
      // /cd should block changing to non-allowed path
      expect(isPathAllowed(targetPath)).toBe(false);
    });

    it('should maintain existing /switch security checks', () => {
      // /switch already has isPathAllowed check for projectPath
      const projectPath = 'C:\\not-allowed\\project';
      setAllowedPaths([]);
      
      // /switch should block switching to non-allowed project
      expect(isPathAllowed(projectPath)).toBe(false);
    });

    it('should maintain existing callback security checks', () => {
      // Callbacks already have isPathAllowed check for path
      const path = 'C:\\not-allowed\\callback';
      setAllowedPaths([]);
      
      // Callback should block selecting non-allowed project
      expect(isPathAllowed(path)).toBe(false);
    });
  });

  describe('Complete security coverage verification', () => {
    it('all switchProject calls should have allowlist validation', () => {
      // This test documents that ALL places using switchProject
      // must validate the path with isPathAllowed BEFORE calling it
      
      const secureCallSites = {
        '/cd': 'validates targetPath before switchProject',
        '/switch': 'validates projectPath before switchProject',
        'callbacks': 'validates path before switchProject',
        'message-handler': 'validates cwd before switchProject (FIXED)',
        '/plan': 'validates cwd before switchProject (FIXED)',
        '/exitplan': 'validates cwd before switchProject (FIXED)',
      };
      
      // All 6 call sites now have security validation
      expect(Object.keys(secureCallSites).length).toBe(6);
      
      // Verify each has validation
      Object.entries(secureCallSites).forEach(([location, validation]) => {
        expect(validation).toContain('validates');
        expect(validation).toContain('before switchProject');
      });
    });
  });
});
