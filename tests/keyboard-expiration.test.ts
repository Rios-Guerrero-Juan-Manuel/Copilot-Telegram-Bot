import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for keyboard auto-expiration feature (TAREA 4.1)
 * 
 * Requirements:
 * - Keyboards expire after TTL (default 5 minutes)
 * - Timestamp is included in callback_data
 * - Expired callbacks are rejected with clear message
 * - TTL is configurable via .env
 */

describe('Keyboard Expiration', () => {
  describe('generateCallbackData', () => {
    it('should include timestamp in callback_data', async () => {
      const { generateCallbackData } = await import('../src/bot/keyboard-utils');
      
      const callbackData = generateCallbackData('model', 'claude-sonnet-4.5');
      
      // Format: action:data:timestamp
      const parts = callbackData.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('model');
      expect(parts[1]).toBe('claude-sonnet-4.5');
      expect(parseInt(parts[2])).toBeGreaterThan(0);
      expect(parseInt(parts[2])).toBeLessThanOrEqual(Date.now());
    });

    it('should handle multiple colons in data', async () => {
      const { generateCallbackData } = await import('../src/bot/keyboard-utils');
      
      const callbackData = generateCallbackData('mcp_toggle', 'server:enable');
      
      const parts = callbackData.split(':');
      // Should be: mcp_toggle:server:enable:timestamp (4 parts)
      expect(parts.length).toBeGreaterThanOrEqual(3);
      
      // Timestamp should be last part
      const timestamp = parseInt(parts[parts.length - 1]);
      expect(timestamp).toBeGreaterThan(0);
    });

    it('should generate different timestamps for sequential calls', async () => {
      const { generateCallbackData } = await import('../src/bot/keyboard-utils');
      
      const callback1 = generateCallbackData('model', 'gpt-5');
      await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms
      const callback2 = generateCallbackData('model', 'gpt-5');
      
      const timestamp1 = parseInt(callback1.split(':').pop()!);
      const timestamp2 = parseInt(callback2.split(':').pop()!);
      
      expect(timestamp2).toBeGreaterThanOrEqual(timestamp1);
    });
  });

  describe('isCallbackValid', () => {
    it('should accept fresh callback data', async () => {
      const { generateCallbackData, isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      const callbackData = generateCallbackData('model', 'claude-sonnet-4.5');
      
      expect(isCallbackValid(callbackData)).toBe(true);
    });

    it('should reject expired callback data', async () => {
      const { isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      // Create expired callback (6 minutes ago, default TTL is 5 minutes)
      const expiredTimestamp = Date.now() - (6 * 60 * 1000);
      const expiredCallbackData = `model:gpt-5:${expiredTimestamp}`;
      
      expect(isCallbackValid(expiredCallbackData)).toBe(false);
    });

    it('should accept callback within TTL', async () => {
      const { isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      // Create callback from 4 minutes ago (within 5 minute TTL)
      const recentTimestamp = Date.now() - (4 * 60 * 1000);
      const recentCallbackData = `model:gpt-5:${recentTimestamp}`;
      
      expect(isCallbackValid(recentCallbackData)).toBe(true);
    });

    it('should handle callback data with multiple colons', async () => {
      const { isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      const recentTimestamp = Date.now() - (2 * 60 * 1000);
      const callbackData = `mcp_toggle:server:name:enable:${recentTimestamp}`;
      
      expect(isCallbackValid(callbackData)).toBe(true);
    });

    it('should handle invalid timestamp gracefully', async () => {
      const { isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      const invalidCallbackData = `model:gpt-5:invalid`;
      
      expect(isCallbackValid(invalidCallbackData)).toBe(false);
    });

    it('should handle callback data without timestamp', async () => {
      const { isCallbackValid } = await import('../src/bot/keyboard-utils');
      
      const oldFormatCallbackData = `model:gpt-5`;
      
      expect(isCallbackValid(oldFormatCallbackData)).toBe(false);
    });
  });

  describe('extractCallbackParts', () => {
    it('should extract action and data from callback with timestamp', async () => {
      const { extractCallbackParts, generateCallbackData } = await import('../src/bot/keyboard-utils');
      
      const callbackData = generateCallbackData('model', 'claude-opus-4.6');
      const { action, data } = extractCallbackParts(callbackData);
      
      expect(action).toBe('model');
      expect(data).toBe('claude-opus-4.6');
    });

    it('should handle data with colons', async () => {
      const { extractCallbackParts, generateCallbackData } = await import('../src/bot/keyboard-utils');
      
      const callbackData = generateCallbackData('mcp_toggle', 'server:name:enable');
      const { action, data } = extractCallbackParts(callbackData);
      
      expect(action).toBe('mcp_toggle');
      expect(data).toBe('server:name:enable');
    });
  });

  describe('Config - KEYBOARD_TTL_MS', () => {
    it('should use default TTL of 5 minutes', async () => {
      vi.resetModules();
      const { KEYBOARD_TTL_MS } = await import('../src/bot/keyboard-utils');
      
      expect(KEYBOARD_TTL_MS).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should respect custom TTL from environment', async () => {
      // Set custom TTL
      const originalTTL = process.env.KEYBOARD_TTL_MS;
      process.env.KEYBOARD_TTL_MS = '600000'; // 10 minutes
      
      vi.resetModules();
      const { KEYBOARD_TTL_MS } = await import('../src/bot/keyboard-utils');
      
      expect(KEYBOARD_TTL_MS).toBe(600000);
      
      // Restore original value
      if (originalTTL !== undefined) {
        process.env.KEYBOARD_TTL_MS = originalTTL;
      } else {
        delete process.env.KEYBOARD_TTL_MS;
      }
    });
  });
});

describe('Callback Handlers - Expiration Validation', () => {
  it('should validate timestamp before processing model callback', async () => {
    const originalTTL = process.env.KEYBOARD_TTL_MS;
    delete process.env.KEYBOARD_TTL_MS;
    vi.resetModules();

    const callbacks: Array<{ pattern: RegExp; handler: Function }> = [];
    const mockBot = {
      callbackQuery: vi.fn((pattern: RegExp, handler: Function) => {
        callbacks.push({ pattern, handler });
      }),
    };
    
    const mockSessionManager = {
      isBusy: vi.fn().mockReturnValue(false),
      setBusy: vi.fn(),
      recreateActiveSession: vi.fn(),
    };
    
    const mockUserState = {
      getOrCreate: vi.fn().mockReturnValue({ id: 'user-1' }),
      setCurrentModel: vi.fn(),
    };
    
    const mockMcpRegistry = {
      getEnabled: vi.fn().mockReturnValue([]),
    };
    
    const mockTools = {
      all: [],
    };
    
    // Import and register callbacks
    const { registerCallbacks } = await import('../src/bot/callbacks');
    registerCallbacks(mockBot, mockSessionManager, mockUserState, mockMcpRegistry, mockTools);
    
    // Create expired callback data
    const expiredTimestamp = Date.now() - (6 * 60 * 1000);
    const expiredCallbackData = `model:claude-sonnet-4.5:${expiredTimestamp}`;
    
    // Mock context
    const mockCtx = {
      callbackQuery: {
        data: expiredCallbackData,
      },
      from: { id: 12345 },
      match: ['model:claude-sonnet-4.5', 'claude-sonnet-4.5', `${expiredTimestamp}`],
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    
    // Find and execute the model callback handler
    const modelHandler = callbacks.find((h) => h.pattern.test(expiredCallbackData));
    
    if (modelHandler) {
      await modelHandler.handler(mockCtx);
      
      // Should edit message with expiration notice
      expect(mockCtx.editMessageText).toHaveBeenCalledWith(
        expect.stringMatching(/expirad|expired/i)
      );
      expect(mockCtx.answerCallbackQuery).toHaveBeenCalled();
      
      // Should NOT recreate session
      expect(mockSessionManager.recreateActiveSession).not.toHaveBeenCalled();
    }

    if (originalTTL !== undefined) {
      process.env.KEYBOARD_TTL_MS = originalTTL;
    }
  });

  it('should process valid callback normally', async () => {
    const originalTTL = process.env.KEYBOARD_TTL_MS;
    delete process.env.KEYBOARD_TTL_MS;
    vi.resetModules();

    const callbacks: Array<{ pattern: RegExp; handler: Function }> = [];
    const mockBot = {
      callbackQuery: vi.fn((pattern: RegExp, handler: Function) => {
        callbacks.push({ pattern, handler });
      }),
    };
    
    const mockSessionManager = {
      isBusy: vi.fn().mockReturnValue(false),
      setBusy: vi.fn(),
      recreateActiveSession: vi.fn().mockResolvedValue(undefined),
    };
    
    const mockUserState = {
      getOrCreate: vi.fn().mockReturnValue({ id: 'user-1' }),
      setCurrentModel: vi.fn(),
    };
    
    const mockMcpRegistry = {
      getEnabled: vi.fn().mockReturnValue([]),
    };
    
    const mockTools = {
      all: [],
    };
    
    // Import and register callbacks
    const { registerCallbacks } = await import('../src/bot/callbacks');
    registerCallbacks(mockBot, mockSessionManager, mockUserState, mockMcpRegistry, mockTools);
    
    // Create fresh callback data
    const freshTimestamp = Date.now();
    const freshCallbackData = `model:claude-sonnet-4.5:${freshTimestamp}`;
    
    // Mock context
    const mockCtx = {
      callbackQuery: {
        data: freshCallbackData,
      },
      from: { id: 12345 },
      match: ['model:claude-sonnet-4.5', 'claude-sonnet-4.5', `${freshTimestamp}`],
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    
    // Find and execute the model callback handler
    const modelHandler = callbacks.find((h) => h.pattern.test(freshCallbackData));
    
    if (modelHandler) {
      await modelHandler.handler(mockCtx);
      
      // Should process normally
      expect(mockSessionManager.setBusy).toHaveBeenCalledWith('12345', true);
      expect(mockUserState.setCurrentModel).toHaveBeenCalledWith('user-1', 'claude-sonnet-4.5');
    }

    if (originalTTL !== undefined) {
      process.env.KEYBOARD_TTL_MS = originalTTL;
    }
  });
});
