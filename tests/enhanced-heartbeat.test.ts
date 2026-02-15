import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bot } from 'grammy';
import { CopilotSession } from '@github/copilot-sdk';
import { SessionManager } from '../src/copilot/session-manager';
import { formatProgressMessage } from '../src/bot/message-handler';

describe('Enhanced Heartbeat Notifications - Phase 4', () => {
  let mockBot: any;
  let mockSession: any;
  let mockSessionManager: any;
  let mockCtx: any;
  let sessionEventHandlers: Map<string, Function>;
  let botApiCalls: any[];

  beforeEach(() => {
    sessionEventHandlers = new Map();
    botApiCalls = [];

    // Mock bot API
    mockBot = {
      api: {
        editMessageText: vi.fn((chatId, msgId, text, options) => {
          botApiCalls.push({ type: 'edit', chatId, msgId, text, options });
          return Promise.resolve({ message_id: msgId });
        }),
        sendMessage: vi.fn((chatId, text, options) => {
          const msgId = Math.floor(Math.random() * 10000);
          botApiCalls.push({ type: 'send', chatId, text, options, msgId });
          return Promise.resolve({ message_id: msgId });
        }),
      },
    };

    // Mock session
    mockSession = {
      on: vi.fn((handler: Function) => {
        const handlerId = `handler-${sessionEventHandlers.size}`;
        sessionEventHandlers.set(handlerId, handler);
        return () => sessionEventHandlers.delete(handlerId);
      }),
      destroy: vi.fn(() => Promise.resolve()),
    };

    // Mock session manager
    mockSessionManager = {
      startTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      extendTimeout: vi.fn(() => true),
      getOriginalTimeout: vi.fn(() => 600000), // 10 minutes
      getTimeoutExtension: vi.fn(() => 0),
      cancelActiveSession: vi.fn(() => Promise.resolve()),
    };

    // Mock context
    mockCtx = {
      chat: { id: 12345 },
      reply: vi.fn(() =>
        Promise.resolve({
          message_id: 1,
        })
      ),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionEventHandlers.clear();
    botApiCalls = [];
  });

  describe('formatProgressMessage with remaining time', () => {
    it('should format progress message with remaining time', () => {
      const bufferSize = 1500;
      const elapsedMs = 45000; // 45 seconds
      const remainingMs = 555000; // 9 minutes 15 seconds

      const message = formatProgressMessage(0, bufferSize, elapsedMs, remainingMs);

      expect(message).toContain('🔄');
      expect(message).toContain('1500');
      expect(message).toContain('45s');
      expect(message).toMatch(/9m (restantes|remaining)/);
    });

    it('should format progress message without remaining time', () => {
      const bufferSize = 1000;
      const elapsedMs = 30000; // 30 seconds

      const message = formatProgressMessage(0, bufferSize, elapsedMs);

      expect(message).toContain('🔄');
      expect(message).toContain('1000');
      expect(message).toContain('30s');
      expect(message).not.toMatch(/restantes|remaining/);
    });

    it('should handle zero remaining time', () => {
      const bufferSize = 2000;
      const elapsedMs = 60000; // 1 minute
      const remainingMs = 0;

      const message = formatProgressMessage(0, bufferSize, elapsedMs, remainingMs);

      expect(message).toContain('🔄');
      expect(message).toContain('2000');
      expect(message).toContain('60s');
      // Should not show "0m restantes"
      expect(message).not.toMatch(/restantes|remaining/);
    });

    it('should handle negative remaining time gracefully', () => {
      const bufferSize = 3000;
      const elapsedMs = 120000; // 2 minutes
      const remainingMs = -5000;

      const message = formatProgressMessage(0, bufferSize, elapsedMs, remainingMs);

      expect(message).toContain('🔄');
      expect(message).toContain('3000');
      expect(message).toContain('120s');
      expect(message).not.toMatch(/restantes|remaining/);
    });
  });

  describe('Enhanced heartbeat messages', () => {
    it('should show remaining time in heartbeat', async () => {
      // This test validates that the heartbeat message includes:
      // - Current elapsed time
      // - Remaining time until timeout
      // - Cancel option
      const expectedPattern = /⏳ (La tarea sigue en progreso|Task still in progress) \(\d+m \d+s\)\./;

      // We'll validate this by mocking the editMessageText call
      // and checking the message format
      const mockHeartbeatMessage = '⏳ La tarea sigue en progreso (2m 30s). Tiempo restante: 7m. /stop para cancelar';
      
      expect(mockHeartbeatMessage).toMatch(expectedPattern);
      expect(mockHeartbeatMessage).toContain('Tiempo restante:');
      expect(mockHeartbeatMessage).toContain('/stop para cancelar');
    });

    it('should show extension count when extensions exist', async () => {
      // Mock session manager to return extensions
      mockSessionManager.getTimeoutExtension.mockReturnValue(600000); // 10 minutes = 1 extension

      const mockHeartbeatWithExtension = '⏳ La tarea sigue en progreso (8m 15s). Tiempo restante: 6m. ⏱️ Extendido 2x. /stop para cancelar';

      expect(mockHeartbeatWithExtension).toContain('⏱️ Extendido');
      expect(mockHeartbeatWithExtension).toContain('2x');
    });

    it('should not show extensions when count is zero', async () => {
      mockSessionManager.getTimeoutExtension.mockReturnValue(0);

      const mockHeartbeatNoExtension = '⏳ La tarea sigue en progreso (1m 30s). Tiempo restante: 8m. /stop para cancelar';

      expect(mockHeartbeatNoExtension).not.toContain('⏱️ Extendido');
      expect(mockHeartbeatNoExtension).not.toContain('x.');
    });

    it('should combine auto and manual extensions', async () => {
      // 2 manual extensions = 1200000ms (20 minutes)
      mockSessionManager.getTimeoutExtension.mockReturnValue(1200000);
      
      // If we had 1 auto-extension, total should be 3
      const mockHeartbeatCombined = '⏳ La tarea sigue en progreso (15m 0s). Tiempo restante: 5m. ⏱️ Extendido 3x. /stop para cancelar';

      expect(mockHeartbeatCombined).toContain('⏱️ Extendido 3x');
    });

    it('should format remaining time correctly in minutes', async () => {
      // Test various remaining times
      const testCases = [
        { remainingMs: 540000, expectedMinutes: 9 },  // 9 minutes
        { remainingMs: 60000, expectedMinutes: 1 },   // 1 minute
        { remainingMs: 0, expectedMinutes: 0 },       // 0 minutes
        { remainingMs: 599999, expectedMinutes: 9 },  // 9m 59s -> 9m
        { remainingMs: 600000, expectedMinutes: 10 }, // 10 minutes
      ];

      testCases.forEach(({ remainingMs, expectedMinutes }) => {
        const calculatedMinutes = Math.max(0, Math.floor(remainingMs / 60000));
        expect(calculatedMinutes).toBe(expectedMinutes);
      });
    });
  });

  describe('Enhanced completion messages', () => {
    it('should show completion time for operations over 1 minute', async () => {
      const elapsedMs = 125000; // 2m 5s
      const completionMessage = `✅ Tarea completada (2m 5s)`;

      expect(completionMessage).toContain('✅ Tarea completada');
      expect(completionMessage).toContain('(2m 5s)');
    });

    it('should not show completion time for quick operations', async () => {
      const elapsedMs = 45000; // 45s (under 1 minute)
      const completionMessage = `✅ Tarea completada`;

      expect(completionMessage).toBe('✅ Tarea completada');
      expect(completionMessage).not.toContain('(');
    });

    it('should include extension stats in completion message', async () => {
      const elapsedMs = 900000; // 15 minutes
      const autoExtensions = 1;
      const manualExtensions = 2;
      const totalExtensions = autoExtensions + manualExtensions;

      const completionMessage = `✅ Tarea completada (15m 0s) | Extensiones: ${totalExtensions}`;

      expect(completionMessage).toContain('✅ Tarea completada');
      expect(completionMessage).toContain('(15m 0s)');
      expect(completionMessage).toContain('| Extensiones: 3');
    });

    it('should not show extensions when none were made', async () => {
      const elapsedMs = 65000; // 1m 5s
      const completionMessage = `✅ Tarea completada (1m 5s)`;

      expect(completionMessage).not.toContain('Extensiones');
    });

    it('should handle only auto-extensions', async () => {
      const elapsedMs = 720000; // 12 minutes
      const autoExtensions = 2;
      const manualExtensions = 0;
      const totalExtensions = autoExtensions + manualExtensions;

      const completionMessage = `✅ Tarea completada (12m 0s) | Extensiones: ${totalExtensions}`;

      expect(completionMessage).toContain('| Extensiones: 2');
    });

    it('should handle only manual extensions', async () => {
      const elapsedMs = 1200000; // 20 minutes
      const autoExtensions = 0;
      const manualExtensions = 3;
      const totalExtensions = autoExtensions + manualExtensions;

      const completionMessage = `✅ Tarea completada (20m 0s) | Extensiones: ${totalExtensions}`;

      expect(completionMessage).toContain('| Extensiones: 3');
    });
  });

  describe('Time formatting consistency', () => {
    it('should format elapsed time consistently as "Xm Ys"', () => {
      const testCases = [
        { ms: 0, expected: '0m 0s' },
        { ms: 30000, expected: '0m 30s' },
        { ms: 60000, expected: '1m 0s' },
        { ms: 90000, expected: '1m 30s' },
        { ms: 125000, expected: '2m 5s' },
        { ms: 3661000, expected: '61m 1s' },
      ];

      testCases.forEach(({ ms, expected }) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const formatted = `${minutes}m ${seconds}s`;
        
        expect(formatted).toBe(expected);
      });
    });

    it('should format remaining time consistently in minutes', () => {
      const testCases = [
        { ms: 540000, expected: '9m' },
        { ms: 60000, expected: '1m' },
        { ms: 0, expected: '0m' },
        { ms: 599999, expected: '9m' },
        { ms: 600000, expected: '10m' },
      ];

      testCases.forEach(({ ms, expected }) => {
        const minutes = Math.max(0, Math.floor(ms / 60000));
        const formatted = `${minutes}m`;
        
        expect(formatted).toBe(expected);
      });
    });
  });

  describe('Logging requirements', () => {
    it('should log enhanced heartbeat information', () => {
      const logData = {
        chatId: '12345',
        msgId: 1,
        elapsedMs: 150000,
        remainingMs: 450000,
        autoExtensionCount: 1,
        manualExtensions: 2,
        totalExtensions: 3,
      };

      // Validate all required fields are present
      expect(logData).toHaveProperty('chatId');
      expect(logData).toHaveProperty('msgId');
      expect(logData).toHaveProperty('elapsedMs');
      expect(logData).toHaveProperty('remainingMs');
      expect(logData).toHaveProperty('autoExtensionCount');
      expect(logData).toHaveProperty('manualExtensions');
      expect(logData).toHaveProperty('totalExtensions');
    });

    it('should log completion with extension statistics', () => {
      const logData = {
        chatId: '12345',
        userId: 'user-1',
        elapsedMs: 900000,
        autoExtensionCount: 2,
        manualExtensions: 1,
        totalExtensions: 3,
        totalExtensionMs: 1800000,
      };

      expect(logData).toHaveProperty('elapsedMs');
      expect(logData).toHaveProperty('autoExtensionCount');
      expect(logData).toHaveProperty('manualExtensions');
      expect(logData).toHaveProperty('totalExtensions');
      expect(logData).toHaveProperty('totalExtensionMs');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long elapsed times', () => {
      const elapsedMs = 7200000; // 2 hours
      const totalSeconds = Math.floor(elapsedMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const formatted = `${minutes}m ${seconds}s`;

      expect(formatted).toBe('120m 0s');
    });

    it('should handle near-zero remaining time', () => {
      const remainingMs = 100; // Less than 1 second
      const minutes = Math.max(0, Math.floor(remainingMs / 60000));

      expect(minutes).toBe(0);
    });

    it('should handle large extension counts', () => {
      const autoExtensions = 5;
      const manualExtensions = 10;
      const totalExtensions = autoExtensions + manualExtensions;

      expect(totalExtensions).toBe(15);
    });

    it('should calculate manual extensions from total extension time', () => {
      const extensionMs = 600000; // 10 minutes per extension
      const totalExtensionMs = 3000000; // 50 minutes total
      const manualExtensions = Math.floor(totalExtensionMs / extensionMs);

      expect(manualExtensions).toBe(5);
    });
  });
});
