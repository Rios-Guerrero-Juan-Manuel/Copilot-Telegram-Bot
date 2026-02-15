import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'token',
  TELEGRAM_CHAT_ID: '123',
  DEFAULT_PROJECT_PATH: 'C:\\temp',
  ALLOWED_PATHS: 'C:\\temp',
  ASK_USER_TIMEOUT: '5000',
};

function withHandledRejection<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

describe('ask_telegram_user tool', () => {
  let mockBot: any;
  let chatId: string;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    Object.assign(process.env, baseEnv);
    
    chatId = '123456';
    
    mockBot = {
      api: {
        sendMessage: vi.fn(async () => ({
          message_id: 1,
        })),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('token matching', () => {
    it('should accept response from correct user with matching token', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = tool.handler({
        question: '¿Continuar?',
        options: ['Sí', 'No'],
      });
      
      // Verify message was sent
      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        '¿Continuar?',
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
        })
      );
      
      // Extract token from callback_data
      const call = mockBot.api.sendMessage.mock.calls[0];
      const keyboard = call[2].reply_markup.inline_keyboard;
      const callbackData = keyboard[0][0].callback_data;
      const token = callbackData.split(':')[1];
      
      // Resolve with correct token
      const resolved = resolveResponse('Sí', token);
      expect(resolved).toBe(true);
      
      // Advance timers to allow promise resolution
      await vi.runAllTimersAsync();
      
      const result = await promise;
      expect(result).toEqual({ userResponse: 'Sí' });
    });

    it('should reject response from wrong user (mismatched token)', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = withHandledRejection(tool.handler({
        question: '¿Aprobar cambios?',
        options: ['✅ Aprobar', '❌ Cancelar'],
      }));
      
      // Try to resolve with wrong token
      const wrongToken = 'wrong123';
      const resolved = resolveResponse('✅ Aprobar', wrongToken);
      expect(resolved).toBe(false);
      
      // Promise should still be pending
      // Cleanup by timing out
      await vi.runAllTimersAsync();
      
      await expect(promise).rejects.toThrow('Timeout: no se recibió respuesta del usuario');
    });

    it('should accept response without token when no token is pending', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Without any pending ask_user, resolveResponse should return false
      const resolved = resolveResponse('any response', undefined);
      expect(resolved).toBe(false);
    });

    it('should accept response without token verification when token not required', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user without options (text response)
      const promise = tool.handler({
        question: '¿Cuál es tu nombre?',
      });
      
      // Resolve without token (backward compatibility)
      const resolved = resolveResponse('Juan');
      expect(resolved).toBe(true);
      
      await vi.runAllTimersAsync();
      
      const result = await promise;
      expect(result).toEqual({ userResponse: 'Juan' });
    });
  });

  describe('timeout handling', () => {
    it('should timeout after specified duration without response', async () => {
      // Set shorter timeout for test
      process.env.ASK_USER_TIMEOUT = '3000';
      vi.resetModules();
      const { config } = await import('../src/config');
      const { createAskUserTool } = await import('../src/copilot/tools');
      
      expect(config.ASK_USER_TIMEOUT).toBe(3000);
      
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = withHandledRejection(tool.handler({
        question: '¿Timeout test?',
        options: ['Sí', 'No'],
      }));
      
      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(3000);
      
      // Should reject with timeout error
      await expect(promise).rejects.toThrow('Timeout: no se recibió respuesta del usuario');
    });

    it('should cleanup state on timeout', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, hasPending, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = withHandledRejection(tool.handler({
        question: 'Test cleanup',
      }));
      
      // Verify pending state
      expect(hasPending()).toBe(true);
      
      // Timeout
      await vi.runAllTimersAsync();
      
      await expect(promise).rejects.toThrow('Timeout');
      
      // State should be cleaned up
      expect(hasPending()).toBe(false);
      
      // Should not be able to resolve anymore
      const resolved = resolveResponse('late response');
      expect(resolved).toBe(false);
    });

    it('should clear timeout when response is received', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      // Start ask_user
      const promise = tool.handler({
        question: 'Test timeout clear',
      });
      
      // Respond before timeout
      await vi.advanceTimersByTimeAsync(1000);
      resolveResponse('response');
      
      await vi.runAllTimersAsync();
      
      const result = await promise;
      expect(result).toEqual({ userResponse: 'response' });
      
      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();
      
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('cancellation', () => {
    it('should handle user cancellation via cancel()', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, cancel } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = tool.handler({
        question: 'Test cancellation',
        options: ['Yes', 'No'],
      });
      
      // Cancel the pending request
      cancel();
      
      await vi.runAllTimersAsync();
      
      const result = await promise;
      expect(result).toEqual({ cancelled: true });
    });

    it('should cleanup state after cancellation', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, cancel, hasPending, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start ask_user
      const promise = tool.handler({
        question: 'Test state cleanup',
      });
      
      expect(hasPending()).toBe(true);
      
      // Cancel
      cancel();
      
      await vi.runAllTimersAsync();
      await promise;
      
      // State should be cleared
      expect(hasPending()).toBe(false);
      
      // Should not accept responses anymore
      const resolved = resolveResponse('too late');
      expect(resolved).toBe(false);
    });

    it('should clear timeout when cancelled', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, cancel } = createAskUserTool(mockBot as Bot, chatId);
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      withHandledRejection(tool.handler({
        question: 'Test',
      }));
      
      cancel();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
      
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('concurrent prompts', () => {
    it('should handle multiple simultaneous prompts with different tokens', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start first ask_user
      const promise1 = tool.handler({
        question: '¿Primera pregunta?',
        options: ['A', 'B'],
      });
      
      // Extract first token
      const call1 = mockBot.api.sendMessage.mock.calls[0];
      const keyboard1 = call1[2].reply_markup.inline_keyboard;
      const token1 = keyboard1[0][0].callback_data.split(':')[1];
      
      // Starting second ask_user should cancel the first
      const promise2 = withHandledRejection(tool.handler({
        question: '¿Segunda pregunta?',
        options: ['C', 'D'],
      }));
      
      // Extract second token
      const call2 = mockBot.api.sendMessage.mock.calls[1];
      const keyboard2 = call2[2].reply_markup.inline_keyboard;
      const token2 = keyboard2[0][0].callback_data.split(':')[1];
      
      expect(token1).not.toBe(token2);
      
      // First promise should be cancelled
      await Promise.resolve();
      const result1 = await promise1;
      expect(result1).toEqual({ cancelled: true });
      
      // Second should still be active
      const resolved = resolveResponse('D', token2);
      expect(resolved).toBe(true);
      
      await vi.runAllTimersAsync();
      const result2 = await promise2;
      expect(result2).toEqual({ userResponse: 'D' });
    });

    it('should route responses to correct promise based on token', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      // This test verifies that only the latest ask_user receives responses
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start first
      const promise1 = tool.handler({
        question: 'First',
      });
      
      // Start second (cancels first)
      const promise2 = tool.handler({
        question: 'Second',
      });
      
      // Resolve second
      resolveResponse('Answer to second');
      
      await vi.runAllTimersAsync();
      
      // First should be cancelled
      const result1 = await promise1;
      expect(result1).toEqual({ cancelled: true });
      
      // Second should have the answer
      const result2 = await promise2;
      expect(result2).toEqual({ userResponse: 'Answer to second' });
    });

    it('should prevent old token from resolving new prompt', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      // Start first ask_user
      const promise1 = tool.handler({
        question: 'First',
        options: ['Yes'],
      });
      
      // Get first token
      const call1 = mockBot.api.sendMessage.mock.calls[0];
      const keyboard1 = call1[2].reply_markup.inline_keyboard;
      const oldToken = keyboard1[0][0].callback_data.split(':')[1];
      
      // Start second (cancels first)
      const promise2 = withHandledRejection(tool.handler({
        question: 'Second',
        options: ['No'],
      }));
      
      // Try to use old token - should fail
      const resolved = resolveResponse('Yes', oldToken);
      expect(resolved).toBe(false);
      
      await vi.runAllTimersAsync();
      
      // First is cancelled
      const result1 = await promise1;
      expect(result1).toEqual({ cancelled: true });
      
      // Second times out (no valid response)
      await expect(promise2).rejects.toThrow('Timeout');
    });
  });

  describe('message formatting', () => {
    it('should send message with HTML parse mode', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      withHandledRejection(tool.handler({
        question: 'Test <b>HTML</b>',
      }));
      
      // HTML should be escaped to prevent injection
      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        'Test &lt;b&gt;HTML&lt;/b&gt;',
        expect.objectContaining({
          parse_mode: 'HTML',
        })
      );
    });

    it('should create inline keyboard with correct structure when options provided', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      const options = ['✅ Aprobar', '✏️ Modificar', '❌ Cancelar'];
      
      withHandledRejection(tool.handler({
        question: 'Plan review',
        options,
      }));
      
      const call = mockBot.api.sendMessage.mock.calls[0];
      const keyboard = call[2].reply_markup.inline_keyboard;
      
      expect(keyboard).toHaveLength(3);
      expect(keyboard[0][0].text).toBe('✅ Aprobar');
      expect(keyboard[1][0].text).toBe('✏️ Modificar');
      expect(keyboard[2][0].text).toBe('❌ Cancelar');
      
      // Each button should have callback_data with token and timestamp
      expect(keyboard[0][0].callback_data).toMatch(/^ask_user_response:[a-z0-9]+:✅ Aprobar:\d+$/);
      expect(keyboard[1][0].callback_data).toMatch(/^ask_user_response:[a-z0-9]+:✏️ Modificar:\d+$/);
      expect(keyboard[2][0].callback_data).toMatch(/^ask_user_response:[a-z0-9]+:❌ Cancelar:\d+$/);
    });

    it('should not include inline keyboard when no options provided', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      withHandledRejection(tool.handler({
        question: 'What is your name?',
      }));
      
      const call = mockBot.api.sendMessage.mock.calls[0];
      expect(call[2].reply_markup).toBeUndefined();
    });
  });

  describe('hasPending utility', () => {
    it('should return false initially', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { hasPending } = createAskUserTool(mockBot as Bot, chatId);
      expect(hasPending()).toBe(false);
    });

    it('should return true when ask_user is pending', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, hasPending } = createAskUserTool(mockBot as Bot, chatId);
      
      expect(hasPending()).toBe(false);
      
      const promise = withHandledRejection(tool.handler({
        question: 'Pending test',
      }));
      
      expect(hasPending()).toBe(true);
      
      // Cleanup
      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow();
    });

    it('should return false after response received', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, hasPending, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      const promise = withHandledRejection(tool.handler({
        question: 'Test',
      }));
      
      expect(hasPending()).toBe(true);
      
      resolveResponse('answer');
      
      await vi.runAllTimersAsync();
      await promise;
      
      expect(hasPending()).toBe(false);
    });

    it('should return false after timeout', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, hasPending } = createAskUserTool(mockBot as Bot, chatId);
      
      const promise = withHandledRejection(tool.handler({
        question: 'Test',
      }));
      
      expect(hasPending()).toBe(true);
      
      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow();
      
      expect(hasPending()).toBe(false);
    });

    it('should return false after cancellation', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, hasPending, cancel } = createAskUserTool(mockBot as Bot, chatId);
      
      const promise = tool.handler({
        question: 'Test',
      });
      
      expect(hasPending()).toBe(true);
      
      cancel();
      
      await vi.runAllTimersAsync();
      await promise;
      
      expect(hasPending()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty options array', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      withHandledRejection(tool.handler({
        question: 'Question',
        options: [],
      }));
      
      const call = mockBot.api.sendMessage.mock.calls[0];
      const keyboard = call[2].reply_markup?.inline_keyboard;
      
      expect(keyboard).toEqual([]);
    });

    it('should handle undefined options', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      withHandledRejection(tool.handler({
        question: 'Question',
        options: undefined,
      }));
      
      const call = mockBot.api.sendMessage.mock.calls[0];
      expect(call[2].reply_markup).toBeUndefined();
    });

    it('should handle special characters in options', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, resolveResponse } = createAskUserTool(mockBot as Bot, chatId);
      
      const specialOption = '✅ Test: with:colons & <html>';
      
      const promise = tool.handler({
        question: 'Test',
        options: [specialOption],
      });
      
      const call = mockBot.api.sendMessage.mock.calls[0];
      const keyboard = call[2].reply_markup.inline_keyboard;
      const callbackData = keyboard[0][0].callback_data;
      const token = callbackData.split(':')[1];
      
      // Should properly encode in callback_data (now with timestamp, may be truncated)
      // Just verify the token is extractable
      expect(token).toBeTruthy();
      expect(token.length).toBe(6); // Token should be 6 chars
      
      resolveResponse(specialOption, token);
      await vi.runAllTimersAsync();
      
      const result = await promise;
      expect(result).toEqual({ userResponse: specialOption });
    });

    it('should handle very long question text', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      const longQuestion = 'A'.repeat(4000);
      
      withHandledRejection(tool.handler({
        question: longQuestion,
      }));
      
      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
        chatId,
        longQuestion,
        expect.any(Object)
      );
    });

    it('should generate unique tokens for successive prompts', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool } = createAskUserTool(mockBot as Bot, chatId);
      
      const tokens = new Set<string>();
      
      for (let i = 0; i < 10; i++) {
        mockBot.api.sendMessage.mockClear();
        
        const promise = withHandledRejection(tool.handler({
          question: `Question ${i}`,
          options: ['Yes'],
        }));
        
        const call = mockBot.api.sendMessage.mock.calls[0];
        const keyboard = call[2].reply_markup.inline_keyboard;
        const callbackData = keyboard[0][0].callback_data;
        const token = callbackData.split(':')[1];
        
        tokens.add(token);
        
        // Cleanup
        await vi.runAllTimersAsync();
        await expect(promise).rejects.toThrow();
      }
      
      // All tokens should be unique
      expect(tokens.size).toBe(10);
    });

    it('should handle rapid cancel/restart cycles', async () => {
      const { createAskUserTool } = await import('../src/copilot/tools');
      const { tool, cancel } = createAskUserTool(mockBot as Bot, chatId);
      
      // Rapid fire
      const promise1 = tool.handler({ question: 'Q1' });
      await Promise.resolve();
      cancel();
      await vi.runAllTimersAsync();
      
      const promise2 = tool.handler({ question: 'Q2' });
      await Promise.resolve();
      cancel();
      await vi.runAllTimersAsync();
      
      const promise3 = tool.handler({ question: 'Q3' });
      await Promise.resolve();
      cancel();
      await vi.runAllTimersAsync();
      
      const result1 = await promise1;
      const result2 = await promise2;
      const result3 = await promise3;
      
      expect(result1).toEqual({ cancelled: true });
      expect(result2).toEqual({ cancelled: true });
      expect(result3).toEqual({ cancelled: true });
    });
  });

  describe('ASK_USER_CANCELLED constant', () => {
    it('should export ASK_USER_CANCELLED constant', async () => {
      const { ASK_USER_CANCELLED } = await import('../src/copilot/tools');
      expect(ASK_USER_CANCELLED).toBeDefined();
      expect(typeof ASK_USER_CANCELLED).toBe('string');
    });
  });
});
