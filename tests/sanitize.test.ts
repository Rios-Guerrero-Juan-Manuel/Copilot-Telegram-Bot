import { describe, it, expect } from 'vitest';
import { sanitizeForLogging } from '../src/utils/sanitize';

describe('sanitizeForLogging', () => {
  it('should redact telegram bot token', () => {
    const input = {
      token: '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz',
      message: 'Hello',
    };
    const result = sanitizeForLogging(input);
    expect(result.token).toBe('[REDACTED]');
    expect(result.message).toBe('Hello');
  });

  it('should redact copilot token', () => {
    const input = {
      copilotToken: 'gho_abcdefghijklmnopqrstuvwxyz1234567890',
      message: 'Hello',
    };
    const result = sanitizeForLogging(input);
    expect(result.copilotToken).toBe('[REDACTED]');
    expect(result.message).toBe('Hello');
  });

  it('should truncate long user messages', () => {
    const longMessage = 'a'.repeat(1500);
    const input = { userMessage: longMessage };
    const result = sanitizeForLogging(input);
    expect(result.userMessage).toHaveLength(1003); // 1000 chars + '...'
    expect(result.userMessage).toMatch(/^a{1000}\.\.\.$/);
  });

  it('should not truncate short messages', () => {
    const input = { userMessage: 'Hello world' };
    const result = sanitizeForLogging(input);
    expect(result.userMessage).toBe('Hello world');
  });

  it('should redact fields containing "token" in name', () => {
    const input = {
      apiToken: 'secret123',
      accessToken: 'secret456',
      refreshToken: 'secret789',
    };
    const result = sanitizeForLogging(input);
    expect(result.apiToken).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('should redact fields containing "key" in name', () => {
    const input = {
      apiKey: 'secret123',
      secretKey: 'secret456',
      privateKey: 'secret789',
    };
    const result = sanitizeForLogging(input);
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.secretKey).toBe('[REDACTED]');
    expect(result.privateKey).toBe('[REDACTED]');
  });

  it('should redact fields containing "password" in name', () => {
    const input = {
      password: 'secret123',
      userPassword: 'secret456',
    };
    const result = sanitizeForLogging(input);
    expect(result.password).toBe('[REDACTED]');
    expect(result.userPassword).toBe('[REDACTED]');
  });

  it('should handle nested objects', () => {
    const input = {
      user: {
        name: 'John',
        password: 'secret',
        token: 'abc123',
      },
      message: 'Hello',
    };
    const result = sanitizeForLogging(input);
    expect(result.user.name).toBe('John');
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.token).toBe('[REDACTED]');
    expect(result.message).toBe('Hello');
  });

  it('should handle arrays', () => {
    const input = {
      items: [
        { name: 'Item1', token: 'secret1' },
        { name: 'Item2', apiKey: 'secret2' },
      ],
    };
    const result = sanitizeForLogging(input);
    expect(result.items[0].name).toBe('Item1');
    expect(result.items[0].token).toBe('[REDACTED]');
    expect(result.items[1].name).toBe('Item2');
    expect(result.items[1].apiKey).toBe('[REDACTED]');
  });

  it('should handle null and undefined values', () => {
    const input = {
      nullValue: null,
      undefinedValue: undefined,
      token: 'secret',
    };
    const result = sanitizeForLogging(input);
    expect(result.nullValue).toBe(null);
    expect(result.undefinedValue).toBe(undefined);
    expect(result.token).toBe('[REDACTED]');
  });

  it('should handle primitive values', () => {
    expect(sanitizeForLogging('hello')).toBe('hello');
    expect(sanitizeForLogging(123)).toBe(123);
    expect(sanitizeForLogging(true)).toBe(true);
    expect(sanitizeForLogging(null)).toBe(null);
  });

  it('should truncate text fields with "message", "prompt", "content"', () => {
    const longText = 'b'.repeat(1500);
    const input = {
      message: longText,
      prompt: longText,
      content: longText,
      normalField: longText, // Should NOT be truncated
    };
    const result = sanitizeForLogging(input);
    expect(result.message).toHaveLength(1003);
    expect(result.prompt).toHaveLength(1003);
    expect(result.content).toHaveLength(1003);
    expect(result.normalField).toHaveLength(1500); // Not truncated
  });

  it('should redact "secret" field names', () => {
    const input = {
      secret: 'mysecret',
      clientSecret: 'anothersecret',
    };
    const result = sanitizeForLogging(input);
    expect(result.secret).toBe('[REDACTED]');
    expect(result.clientSecret).toBe('[REDACTED]');
  });

  it('should handle circular references gracefully', () => {
    const input: any = { name: 'Test' };
    input.self = input; // Create circular reference
    
    // Should not throw an error
    expect(() => sanitizeForLogging(input)).not.toThrow();
  });
});
