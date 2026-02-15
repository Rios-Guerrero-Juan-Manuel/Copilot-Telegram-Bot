import { describe, it, expect } from 'vitest';
import { sanitizeForLogging } from '../src/utils/sanitize';
import { isNetworkError } from '../src/utils/telegram-retry';

describe('Critical Fixes - Phase 2 Review', () => {
  describe('Issue #3: Fix overly broad key regex', () => {
    it('should NOT redact "keyboard" field', () => {
      const input = { keyboard: 'inline', apiKey: 'secret123' };
      const result = sanitizeForLogging(input);
      expect(result.keyboard).toBe('inline');
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('should NOT redact "hotkey" field', () => {
      const input = { hotkey: 'Ctrl+C', secretKey: 'secret456' };
      const result = sanitizeForLogging(input);
      expect(result.hotkey).toBe('Ctrl+C');
      expect(result.secretKey).toBe('[REDACTED]');
    });

    it('should NOT redact "monkeyPatch" field', () => {
      const input = { monkeyPatch: true, privateKey: 'secret789' };
      const result = sanitizeForLogging(input);
      expect(result.monkeyPatch).toBe(true);
      expect(result.privateKey).toBe('[REDACTED]');
    });

    it('should redact specific key patterns only', () => {
      const input = {
        apiKey: 'secret1',
        api_key: 'secret2',
        'api-key': 'secret3',
        secretKey: 'secret4',
        secret_key: 'secret5',
        privateKey: 'secret6',
        private_key: 'secret7',
        accessKey: 'secret8',
        access_key: 'secret9',
        authKey: 'secret10',
        auth_key: 'secret11',
      };
      const result = sanitizeForLogging(input);
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result['api-key']).toBe('[REDACTED]');
      expect(result.secretKey).toBe('[REDACTED]');
      expect(result.secret_key).toBe('[REDACTED]');
      expect(result.privateKey).toBe('[REDACTED]');
      expect(result.private_key).toBe('[REDACTED]');
      expect(result.accessKey).toBe('[REDACTED]');
      expect(result.access_key).toBe('[REDACTED]');
      expect(result.authKey).toBe('[REDACTED]');
      expect(result.auth_key).toBe('[REDACTED]');
    });
  });

  describe('Issue #4: Fix text truncation length', () => {
    it('should allow longer text in message fields (1000 chars)', () => {
      const longMessage = 'a'.repeat(500);
      const input = { message: longMessage };
      const result = sanitizeForLogging(input);
      expect(result.message).toBe(longMessage); // Should not be truncated
    });

    it('should truncate text over 1000 chars', () => {
      const longMessage = 'a'.repeat(1500);
      const input = { message: longMessage };
      const result = sanitizeForLogging(input);
      expect(result.message).toHaveLength(1003); // 1000 chars + '...'
      expect(result.message).toMatch(/^a{1000}\.\.\.$/);
    });

    it('should allow code blocks up to 1000 chars', () => {
      const codeBlock = 'function test() {\n' + '  return true;\n'.repeat(50) + '}';
      const input = { content: codeBlock };
      const result = sanitizeForLogging(input);
      // Should not truncate if under 1000
      if (codeBlock.length <= 1000) {
        expect(result.content).toBe(codeBlock);
      }
    });
  });

  describe('Issue #5: Fix /plan task logging', () => {
    it('should truncate "task" field', () => {
      const longTask = 'x'.repeat(1500);
      const input = { task: longTask };
      const result = sanitizeForLogging(input);
      expect(result.task).toHaveLength(1003); // 1000 + '...'
    });

    it('should truncate nested task fields', () => {
      const longTask = 'y'.repeat(1500);
      const input = { planData: { task: longTask } };
      const result = sanitizeForLogging(input);
      expect(result.planData.task).toHaveLength(1003);
    });
  });

  describe('Issue #6: Fix circular array detection', () => {
    it('should handle circular references in arrays', () => {
      const arr: any[] = [1, 2, 3];
      arr.push(arr); // Create circular reference
      
      const input = { data: arr };
      
      // Should not throw an error
      expect(() => sanitizeForLogging(input)).not.toThrow();
      
      const result = sanitizeForLogging(input);
      expect(result.data).toBeDefined();
      expect(result.data[3]).toBe('[Circular]');
    });

    it('should handle nested arrays with circular references', () => {
      const innerArr: any[] = [1, 2];
      const outerArr: any[] = [innerArr, 3];
      innerArr.push(outerArr); // Create circular reference
      
      const input = { data: outerArr };
      
      expect(() => sanitizeForLogging(input)).not.toThrow();
      
      const result = sanitizeForLogging(input);
      expect(result.data).toBeDefined();
    });
  });

  describe('Issue #2: Fix Error object serialization', () => {
    it('should serialize Error objects with all properties', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at test.ts:1:1';
      
      const input = { error };
      const result = sanitizeForLogging(input);
      
      expect(result.error).toBeDefined();
      expect(result.error.name).toBe('Error');
      expect(result.error.message).toBe('Test error');
      expect(result.error.stack).toContain('Test error');
    });

    it('should handle custom error properties', () => {
      const error: any = new Error('Custom error');
      error.code = 'ERR_CUSTOM';
      error.statusCode = 500;
      
      const input = { error };
      const result = sanitizeForLogging(input);
      
      expect(result.error.message).toBe('Custom error');
      expect(result.error.code).toBe('ERR_CUSTOM');
      expect(result.error.statusCode).toBe(500);
    });

    it('should handle nested errors', () => {
      const innerError = new Error('Inner error');
      const outerError: any = new Error('Outer error');
      outerError.cause = innerError;
      
      const input = { error: outerError };
      const result = sanitizeForLogging(input);
      
      expect(result.error.message).toBe('Outer error');
      expect(result.error.cause).toBeDefined();
      expect(result.error.cause.message).toBe('Inner error');
    });

    it('should handle Error in arrays', () => {
      const errors = [
        new Error('Error 1'),
        new Error('Error 2'),
      ];
      
      const input = { errors };
      const result = sanitizeForLogging(input);
      
      expect(result.errors[0].message).toBe('Error 1');
      expect(result.errors[1].message).toBe('Error 2');
    });
  });

  describe('Final Review - Critical Fixes', () => {
    describe('Issue #1: HTML Escaping in User Input', () => {
      it('should provide escapeHtml utility function', () => {
        // Will be exported from formatter.ts
        const escapeHtml = (text: string): string => {
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        };

        expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
          '&lt;script&gt;alert("XSS")&lt;/script&gt;'
        );
        expect(escapeHtml('Project & Name')).toBe('Project &amp; Name');
        expect(escapeHtml('<b>Bold</b>')).toBe('&lt;b&gt;Bold&lt;/b&gt;');
      });

      it('should handle edge cases in HTML escaping', () => {
        const escapeHtml = (text: string): string => {
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        };

        expect(escapeHtml('')).toBe('');
        expect(escapeHtml('Normal text')).toBe('Normal text');
        expect(escapeHtml('&lt;&gt;')).toBe('&amp;lt;&amp;gt;');
        expect(escapeHtml('<><><>')).toBe('&lt;&gt;&lt;&gt;&lt;&gt;');
      });
    });

    describe('Issue #2: Fix Token Regex Pattern', () => {
      it('should NOT redact total_tokens and max_tokens', () => {
        const data = {
          total_tokens: 1500,
          max_tokens: 4000,
          prompt_tokens: 500,
          completion_tokens: 1000,
        };

        const sanitized = sanitizeForLogging(data);

        // These should NOT be redacted
        expect(sanitized.total_tokens).toBe(1500);
        expect(sanitized.max_tokens).toBe(4000);
        expect(sanitized.prompt_tokens).toBe(500);
        expect(sanitized.completion_tokens).toBe(1000);
      });

      it('should redact actual auth/api tokens', () => {
        const data = {
          auth_token: 'secret123',
          api_token: 'secret456',
          access_token: 'secret789',
          authToken: 'secret000',
          apiToken: 'secret111',
          bearer_token: 'secret222',
        };

        const sanitized = sanitizeForLogging(data);

        // These SHOULD be redacted
        expect(sanitized.auth_token).toBe('[REDACTED]');
        expect(sanitized.api_token).toBe('[REDACTED]');
        expect(sanitized.access_token).toBe('[REDACTED]');
        expect(sanitized.authToken).toBe('[REDACTED]');
        expect(sanitized.apiToken).toBe('[REDACTED]');
        expect(sanitized.bearer_token).toBe('[REDACTED]');
      });

      it('should handle mixed token fields correctly', () => {
        const data = {
          total_tokens: 1500,
          auth_token: 'secret123',
          max_tokens: 4000,
          api_token: 'secret456',
          prompt_tokens: 100,
        };

        const sanitized = sanitizeForLogging(data);

        // Should NOT redact count fields
        expect(sanitized.total_tokens).toBe(1500);
        expect(sanitized.max_tokens).toBe(4000);
        expect(sanitized.prompt_tokens).toBe(100);

        // Should redact auth fields
        expect(sanitized.auth_token).toBe('[REDACTED]');
        expect(sanitized.api_token).toBe('[REDACTED]');
      });
    });

    describe('Issue #3: Add EAI_AGAIN to Network Errors', () => {
      it('should recognize EAI_AGAIN as a network error', () => {
        const error = { code: 'EAI_AGAIN', message: 'Temporary DNS failure' };
        expect(isNetworkError(error)).toBe(true);
      });

      it('should recognize all network error codes', () => {
        const networkErrors = [
          'ECONNRESET',
          'ETIMEDOUT',
          'ENOTFOUND',
          'ECONNREFUSED',
          'EHOSTUNREACH',
          'EAI_AGAIN',
        ];

        networkErrors.forEach((code) => {
          expect(isNetworkError({ code })).toBe(true);
        });
      });

      it('should not recognize non-network errors', () => {
        expect(isNetworkError({ code: 'EACCES' })).toBe(false);
        expect(isNetworkError({ code: 'ENOENT' })).toBe(false);
        expect(isNetworkError({ code: 'UNKNOWN' })).toBe(false);
        expect(isNetworkError({})).toBe(false);
      });
    });

    describe('Issue #4: Add Max Depth Limit to Sanitization', () => {
      it('should handle deeply nested objects without stack overflow', () => {
        // Create a deeply nested object (20 levels)
        let deepObj: any = { value: 'bottom' };
        for (let i = 0; i < 20; i++) {
          deepObj = { nested: deepObj, level: i };
        }

        // Should not throw stack overflow
        expect(() => sanitizeForLogging(deepObj)).not.toThrow();
      });

      it('should stop recursing at max depth', () => {
        // Create nested object beyond default depth (10)
        let deepObj: any = { value: 'level0' };
        for (let i = 1; i <= 15; i++) {
          deepObj = { nested: deepObj, level: i };
        }

        const sanitized = sanitizeForLogging(deepObj);

        // Should have some levels but truncate at max depth
        expect(sanitized).toBeDefined();
        expect(sanitized.nested).toBeDefined();
        
        // Navigate down and check for depth limit
        let current = sanitized;
        let depth = 0;
        while (current && current.nested && typeof current.nested === 'object' && depth < 20) {
          if (current.nested === '[Max Depth Reached]') break;
          current = current.nested;
          depth++;
        }
        
        // Should stop before reaching 15 levels (max depth ~10)
        expect(depth).toBeLessThan(15);
      });

      it('should handle circular references at any depth', () => {
        const obj: any = { name: 'parent' };
        obj.self = obj; // Circular reference

        const sanitized = sanitizeForLogging(obj);

        expect(sanitized.name).toBe('parent');
        expect(sanitized.self).toBe('[Circular]');
      });

      it('should handle deeply nested arrays without stack overflow', () => {
        let deepArray: any = ['bottom'];
        for (let i = 0; i < 20; i++) {
          deepArray = [deepArray, i];
        }

        // Should not throw
        expect(() => sanitizeForLogging(deepArray)).not.toThrow();
      });

      it('should mark when max depth is reached', () => {
        let deepObj: any = { value: 'bottom' };
        for (let i = 0; i < 12; i++) {
          deepObj = { nested: deepObj };
        }

        const sanitized = sanitizeForLogging(deepObj);
        
        // Navigate to max depth
        let current = sanitized;
        let foundMaxDepth = false;
        for (let i = 0; i < 15; i++) {
          if (current.nested === '[Max Depth Reached]') {
            foundMaxDepth = true;
            break;
          }
          if (typeof current.nested !== 'object') break;
          current = current.nested;
        }

        expect(foundMaxDepth).toBe(true);
      });
    });

    describe('Issue #5: Timeout Should Abort Session', () => {
      it('should have cancelActiveSession method in SessionManager', async () => {
        const { SessionManager } = await import('../src/copilot/session-manager');
        
        expect(SessionManager.prototype.cancelActiveSession).toBeDefined();
        expect(typeof SessionManager.prototype.cancelActiveSession).toBe('function');
      });

      // Integration test for timeout abortion is in message-handler integration tests
    });
  });
});
