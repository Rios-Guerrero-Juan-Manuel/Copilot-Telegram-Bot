import { test, expect, describe, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe.skip('TAREA 4.5: GitHub Actions CI/CD Implementation', () => {
  const rootDir = process.cwd();
  const workflowsDir = join(rootDir, '.github', 'workflows');

  describe('Workflow Files', () => {
    test('should have .github/workflows directory', () => {
      expect(existsSync(workflowsDir)).toBe(true);
    });

    test('should have ci.yml workflow file', () => {
      const ciPath = join(workflowsDir, 'ci.yml');
      expect(existsSync(ciPath)).toBe(true);
    });

    test('should have coverage.yml workflow file', () => {
      const coveragePath = join(workflowsDir, 'coverage.yml');
      expect(existsSync(coveragePath)).toBe(true);
    });
  });

  describe('CI Workflow Content', () => {
    const ciPath = join(workflowsDir, 'ci.yml');
    let ciContent: string;

    beforeEach(() => {
      if (existsSync(ciPath)) {
        ciContent = readFileSync(ciPath, 'utf8');
      }
    });

    test('should trigger on push to main and develop', () => {
      expect(ciContent).toContain('on:');
      expect(ciContent).toContain('push:');
      expect(ciContent).toContain('branches: [ main, develop ]');
    });

    test('should trigger on pull requests to main', () => {
      expect(ciContent).toContain('pull_request:');
      expect(ciContent).toContain('branches: [ main ]');
    });

    test('should use ubuntu-latest runner', () => {
      expect(ciContent).toContain('runs-on: ubuntu-latest');
    });

    test('should test multiple Node.js versions', () => {
      expect(ciContent).toContain('strategy:');
      expect(ciContent).toContain('matrix:');
      expect(ciContent).toContain('node-version: [18.x, 20.x]');
    });

    test('should checkout code', () => {
      expect(ciContent).toContain('uses: actions/checkout@v4');
    });

    test('should setup Node.js with caching', () => {
      expect(ciContent).toContain('uses: actions/setup-node@v4');
      expect(ciContent).toContain("cache: 'npm'");
    });

    test('should install dependencies', () => {
      expect(ciContent).toContain('npm ci');
    });

    test('should run build', () => {
      expect(ciContent).toContain('npm run build');
    });

    test('should run tests', () => {
      expect(ciContent).toMatch(/run:\s+npm test/);
    });

    test('should run linter', () => {
      expect(ciContent).toContain('npm run lint');
    });
  });

  describe('Coverage Workflow Content', () => {
    const coveragePath = join(workflowsDir, 'coverage.yml');
    let coverageContent: string;

    beforeEach(() => {
      if (existsSync(coveragePath)) {
        coverageContent = readFileSync(coveragePath, 'utf8');
      }
    });

    test('should trigger on push to main', () => {
      expect(coverageContent).toContain('on:');
      expect(coverageContent).toContain('push:');
      expect(coverageContent).toContain('branches: [ main ]');
    });

    test('should use Node.js 20.x', () => {
      expect(coverageContent).toContain("node-version: '20.x'");
    });

    test('should run tests with coverage', () => {
      expect(coverageContent).toContain('npm test -- --coverage');
    });

    test('should upload to Codecov', () => {
      expect(coverageContent).toContain('uses: codecov/codecov-action@v4');
    });

    test('should use CODECOV_TOKEN from secrets', () => {
      expect(coverageContent).toContain('token: ${{ secrets.CODECOV_TOKEN }}');
    });

    test('should not fail CI on coverage upload error', () => {
      expect(coverageContent).toContain('fail_ci_if_error: false');
    });
  });

  describe('README.md Badges', () => {
    const readmePath = join(rootDir, 'README.md');
    let readmeContent: string;

    beforeEach(() => {
      if (existsSync(readmePath)) {
        readmeContent = readFileSync(readmePath, 'utf8');
      }
    });

    test('should have README.md file', () => {
      expect(existsSync(readmePath)).toBe(true);
    });

    test('should have CI badge', () => {
      expect(readmeContent).toMatch(/!\[CI\]/);
      expect(readmeContent).toContain('workflows/CI/badge.svg');
    });

    test('should have Coverage badge', () => {
      expect(readmeContent).toMatch(/!\[Coverage\]/);
      expect(readmeContent).toContain('codecov');
    });

    test('should have Node.js version badge', () => {
      expect(readmeContent).toMatch(/!\[Node\.js Version\]/);
      expect(readmeContent).toContain('node-%3E%3D18.0.0');
    });

    test('should have License badge', () => {
      expect(readmeContent).toMatch(/!\[License.*MIT\]/);
    });
  });

  describe('Package.json Scripts', () => {
    const packageJsonPath = join(rootDir, 'package.json');
    let packageJson: any;

    beforeEach(() => {
      if (existsSync(packageJsonPath)) {
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      }
    });

    test('should have build script', () => {
      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.build).toBeDefined();
      expect(packageJson.scripts.build).toBe('tsc');
    });

    test('should have test script', () => {
      expect(packageJson.scripts.test).toBeDefined();
      expect(packageJson.scripts.test).toBe('vitest run');
    });

    test('should have lint script', () => {
      expect(packageJson.scripts.lint).toBeDefined();
      expect(packageJson.scripts.lint).toBe('eslint src/');
    });
  });

  describe('Vitest Configuration', () => {
    const vitestConfigPath = join(rootDir, 'vitest.config.ts');

    test('should have vitest.config.ts', () => {
      expect(existsSync(vitestConfigPath)).toBe(true);
    });

    test('should have coverage configuration', () => {
      if (existsSync(vitestConfigPath)) {
        const vitestContent = readFileSync(vitestConfigPath, 'utf8');
        expect(vitestContent).toContain('coverage');
        expect(vitestContent).toContain('provider');
        expect(vitestContent).toContain('reporter');
      }
    });
  });

  describe('Helper Scripts', () => {
    test('should have setup script', () => {
      const setupPath = join(rootDir, 'setup-ci-cd.mjs');
      expect(existsSync(setupPath)).toBe(true);
    });

    test('should have validation script', () => {
      const validatePath = join(rootDir, 'validate-ci-cd.mjs');
      expect(existsSync(validatePath)).toBe(true);
    });
  });

  describe('Documentation', () => {
    test('should have full implementation documentation', () => {
      const docPath = join(rootDir, 'TAREA_4_5_CI_CD_IMPLEMENTATION.md');
      expect(existsSync(docPath)).toBe(true);
    });

    test('should have quick reference guide', () => {
      const quickRefPath = join(rootDir, 'TAREA_4_5_QUICK_REFERENCE.md');
      expect(existsSync(quickRefPath)).toBe(true);
    });
  });

  describe('Acceptance Criteria', () => {
    test('✅ CI runs on every push/PR', () => {
      const ciPath = join(workflowsDir, 'ci.yml');
      const ciContent = readFileSync(ciPath, 'utf8');
      
      // Verify triggers
      expect(ciContent).toContain('on:');
      expect(ciContent).toContain('push:');
      expect(ciContent).toContain('pull_request:');
      
      // Verify it will run
      expect(ciContent).toContain('runs-on: ubuntu-latest');
    });

    test('✅ Tests must pass before merge', () => {
      const ciPath = join(workflowsDir, 'ci.yml');
      const ciContent = readFileSync(ciPath, 'utf8');
      
      // Verify test step exists (which will block on failure)
      expect(ciContent).toMatch(/run:\s+npm test/);
    });

    test('✅ Coverage is reported', () => {
      const coveragePath = join(workflowsDir, 'coverage.yml');
      const coverageContent = readFileSync(coveragePath, 'utf8');
      
      // Verify coverage is generated and uploaded
      expect(coverageContent).toContain('npm test -- --coverage');
      expect(coverageContent).toContain('codecov/codecov-action');
    });

    test('✅ Badges in README', () => {
      const readmePath = join(rootDir, 'README.md');
      const readmeContent = readFileSync(readmePath, 'utf8');
      
      // Verify all required badges
      expect(readmeContent).toMatch(/!\[CI\]/);
      expect(readmeContent).toMatch(/!\[Coverage\]/);
    });
  });
});
