import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldRunInteractiveSetup } from '../src/utils/interactive-setup';

describe('interactive setup required vars', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-setup-'));
    process.chdir(tempDir);
    delete process.env.SKIP_INTERACTIVE_SETUP;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true when required vars are missing', () => {
    expect(shouldRunInteractiveSetup()).toBe(true);
  });

  it('returns false when required vars are present, even without optional vars', () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'TELEGRAM_BOT_TOKEN=123456:abcdeABCDE12345\nTELEGRAM_CHAT_ID=123456789\n'
    );

    expect(shouldRunInteractiveSetup()).toBe(false);
  });

  it('returns false when SKIP_INTERACTIVE_SETUP is enabled', () => {
    process.env.SKIP_INTERACTIVE_SETUP = 'true';
    expect(shouldRunInteractiveSetup()).toBe(false);
  });
});
