import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ALLOWLIST_SETUP_DELAY_MS } from '../src/constants';

let mockedAllowedPaths: string[] = [];
let adminAutoRestart = false;
const updateEnvFileMock = vi.fn();
const gracefulShutdownMock = vi.fn().mockResolvedValue(undefined);
const setAllowedPathsMock = vi.fn((paths: string[]) => {
  mockedAllowedPaths = [...paths];
});
const restartCurrentProcessMock = vi.fn(() => true);

vi.mock('../src/config', () => ({
  config: {
    TELEGRAM_CHAT_ID: '123',
    LOG_DIR: './logs',
    LOG_LEVEL: 'info',
    LOG_MAX_SIZE: '20m',
    LOG_MAX_FILES: '14d',
    LOG_DATE_PATTERN: 'YYYY-MM-DD',
    get ALLOWLIST_ADMIN_AUTO_RESTART() {
      return adminAutoRestart;
    },
  },
  getAllowedPaths: () => mockedAllowedPaths,
  setAllowedPaths: (...args: unknown[]) => setAllowedPathsMock(...args),
}));

vi.mock('../src/utils/path-setup', () => ({
  updateEnvFile: (...args: unknown[]) => updateEnvFileMock(...args),
}));

vi.mock('../src/utils/graceful-shutdown', () => ({
  gracefulShutdownWithTimeout: (...args: unknown[]) => gracefulShutdownMock(...args),
}));
vi.mock('../src/utils/process-restart.js', () => ({
  restartCurrentProcess: (...args: unknown[]) => restartCurrentProcessMock(...args),
}));

import {
  addAllowedPathAndRestart,
  consumeAllowPathRequest,
  createAllowPathRequest,
} from '../src/bot/allowlist-admin';

describe('allowlist-admin flow', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'allowpath-admin-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockedAllowedPaths = [];
    adminAutoRestart = false;
    updateEnvFileMock.mockClear();
    gracefulShutdownMock.mockClear();
    setAllowedPathsMock.mockClear();
    restartCurrentProcessMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create and consume allowpath request tokens', () => {
    const token = createAllowPathRequest(tempDir, 123, 1);
    const request = consumeAllowPathRequest(token);
    expect(request).not.toBeNull();
    expect(request?.path).toBe(path.resolve(tempDir));

    const consumedAgain = consumeAllowPathRequest(token);
    expect(consumedAgain).toBeNull();
  });

  it('should reject paths that do not exist', async () => {
    const result = await addAllowedPathAndRestart(
      1,
      path.join(tempDir, 'missing-folder'),
      {} as any,
      {} as any,
      { getDatabase: () => ({}) } as any
    );

    expect(result.ok).toBe(false);
    expect(updateEnvFileMock).not.toHaveBeenCalled();
  });

  it('should reject paths already present in ALLOWED_PATHS', async () => {
    mockedAllowedPaths = [tempDir];

    const result = await addAllowedPathAndRestart(
      1,
      tempDir,
      {} as any,
      {} as any,
      { getDatabase: () => ({}) } as any
    );

    expect(result.ok).toBe(false);
    expect(updateEnvFileMock).not.toHaveBeenCalled();
  });

  it('should append a valid path without restart by default', async () => {
    const result = await addAllowedPathAndRestart(
      1,
      tempDir,
      {} as any,
      {} as any,
      { getDatabase: () => ({ db: true }) } as any
    );

    expect(result.ok).toBe(true);
    expect(updateEnvFileMock).toHaveBeenCalledWith([path.resolve(tempDir)]);
    expect(setAllowedPathsMock).toHaveBeenCalledWith([path.resolve(tempDir)]);
    expect(gracefulShutdownMock).not.toHaveBeenCalled();
  });

  it('should schedule restart when admin auto restart is enabled', async () => {
    adminAutoRestart = true;
    const result = await addAllowedPathAndRestart(
      1,
      tempDir,
      {} as any,
      {} as any,
      { getDatabase: () => ({ db: true }) } as any
    );
    expect(result.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(ALLOWLIST_SETUP_DELAY_MS);
    expect(restartCurrentProcessMock).toHaveBeenCalled();
    expect(gracefulShutdownMock).toHaveBeenCalled();
  });
});
