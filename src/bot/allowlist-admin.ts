import { promises as fs } from 'fs';
import * as path from 'path';
import type { Bot } from 'grammy';
import { config, getAllowedPaths, setAllowedPaths } from '../config';
import { ALLOWLIST_SETUP_DELAY_MS } from '../constants';
import { i18n } from '../i18n/index.js';
import type { SessionManager } from '../copilot/session-manager';
import type { UserState } from '../state/user-state';
import { updateEnvFile } from '../utils/path-setup';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/formatter';
import { gracefulShutdownWithTimeout } from '../utils/graceful-shutdown';
import { restartCurrentProcess } from '../utils/process-restart.js';

interface PendingAllowPathRequest {
  path: string;
  telegramId: number;
  userId: number;
}

const pendingAllowPathRequests = new Map<string, PendingAllowPathRequest>();

function normalizePathForCompare(input: string): string {
  return process.platform === 'win32' ? input.toLowerCase() : input;
}

export function isAdminUser(telegramId?: number): boolean {
  return !!telegramId && telegramId === Number(config.TELEGRAM_CHAT_ID);
}

export function createAllowPathRequest(pathToAdd: string, telegramId: number, userId: number): string {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendingAllowPathRequests.set(token, {
    path: path.resolve(pathToAdd),
    telegramId,
    userId,
  });
  return token;
}

export function consumeAllowPathRequest(token: string): PendingAllowPathRequest | null {
  const req = pendingAllowPathRequests.get(token) ?? null;
  if (req) {
    pendingAllowPathRequests.delete(token);
  }
  return req;
}

export function clearAllowPathRequest(token: string): void {
  pendingAllowPathRequests.delete(token);
}

export async function addAllowedPathAndRestart(
  userId: number,
  pathToAdd: string,
  bot: Bot,
  sessionManager: SessionManager,
  userState: UserState
): Promise<{ ok: boolean; message: string }> {
  const resolvedPath = path.resolve(pathToAdd);

  try {
    await fs.access(resolvedPath);
  } catch {
    return {
      ok: false,
      message: i18n.t(userId, 'allowlistAdmin.invalidPath', { path: escapeHtml(resolvedPath) }),
    };
  }

  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) {
    return {
      ok: false,
      message: i18n.t(userId, 'allowlistAdmin.notDirectory', { path: escapeHtml(resolvedPath) }),
    };
  }

  const currentAllowedPaths = getAllowedPaths();
  const normalizedResolved = normalizePathForCompare(resolvedPath);
  const alreadyAllowed = currentAllowedPaths.some(
    (allowed) => normalizePathForCompare(path.resolve(allowed)) === normalizedResolved
  );

  if (alreadyAllowed) {
    return {
      ok: false,
      message: i18n.t(userId, 'allowlistAdmin.alreadyAllowed', { path: escapeHtml(resolvedPath) }),
    };
  }

  const updatedPaths = [...currentAllowedPaths, resolvedPath];
  updateEnvFile(updatedPaths);
  setAllowedPaths(updatedPaths);

  logger.info('Allowed path added by admin', {
    telegramId: config.TELEGRAM_CHAT_ID,
    path: resolvedPath,
  });

  const message =
    i18n.t(userId, 'allowlistAdmin.added', { path: escapeHtml(resolvedPath) }) +
    '\n\n' +
    (config.ALLOWLIST_ADMIN_AUTO_RESTART
      ? i18n.t(userId, 'allowlistAdmin.restartingNotice')
      : i18n.t(userId, 'allowlistAdmin.appliedWithoutRestart'));

  if (config.ALLOWLIST_ADMIN_AUTO_RESTART) {
    setTimeout(async () => {
      const restarted = restartCurrentProcess();
      logger.info('Allowpath admin restart decision', {
        autoRestart: true,
        restartSpawned: restarted,
      });

      await gracefulShutdownWithTimeout(
        {
          bot,
          sessionManager,
          db: userState.getDatabase(),
        },
        0
      );
    }, ALLOWLIST_SETUP_DELAY_MS);
  } else {
    logger.info('Allowpath admin applied without restart (runtime allowlist updated)');
  }

  return { ok: true, message };
}
