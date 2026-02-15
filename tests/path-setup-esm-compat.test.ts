import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parsePaths, validatePath, validatePathAsync } from '../src/utils/path-setup';

describe('path-setup ESM compatibility', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'allowlist-path-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('validatePath should accept an existing directory', () => {
    const result = validatePath(tempDir);
    expect(result.valid).toBe(true);
  });

  it('validatePathAsync should accept an existing directory', async () => {
    const result = await validatePathAsync(tempDir);
    expect(result.valid).toBe(true);
  });

  it('parsePaths should return a valid path list', () => {
    const parsed = parsePaths(tempDir);
    expect(parsed.invalid).toHaveLength(0);
    expect(parsed.valid).toContain(path.resolve(tempDir));
  });
});
