import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Test the schema validation exactly as it works in config.ts
describe('Config empty string handling', () => {
  // Create the same preprocessor used in config.ts
  const numericPreprocessor = z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return 10000;
      return Number(val);
    },
    z.number()
  );

  const numericWithBounds = z.preprocess(
    (val) => {
      if (val === '' || val === undefined) return 1200000;
      return Number(val);
    },
    z.number().min(1000).max(3600000)
  );

  it('should use default when value is empty string from env', () => {
    // Simulate how process.env works - values are always strings or undefined
    const schema = z.object({
      timeout: numericPreprocessor,
    });
    
    // Empty string in env variable
    const result = schema.parse({ timeout: '' });
    expect(result.timeout).toBe(10000);
  });

  it('should parse valid number string from env', () => {
    const schema = z.object({
      timeout: numericPreprocessor,
    });
    
    const result = schema.parse({ timeout: '5000' });
    expect(result.timeout).toBe(5000);
  });

  it('should use default when undefined from env', () => {
    const schema = z.object({
      timeout: numericPreprocessor,
    });
    
    const result = schema.parse({});
    expect(result.timeout).toBe(10000);
  });

  it('should reject value below minimum', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    expect(() => schema.parse({ timeout: '500' })).toThrow();
  });

  it('should reject value above maximum', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    expect(() => schema.parse({ timeout: '4000000' })).toThrow();
  });

  it('should accept value within bounds', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    const result = schema.parse({ timeout: '60000' });
    expect(result.timeout).toBe(60000);
  });

  it('should use default for empty string with bounds', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    const result = schema.parse({ timeout: '' });
    expect(result.timeout).toBe(1200000);
  });

  it('should accept minimum boundary value', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    const result = schema.parse({ timeout: '1000' });
    expect(result.timeout).toBe(1000);
  });

  it('should accept maximum boundary value', () => {
    const schema = z.object({
      timeout: numericWithBounds,
    });
    
    const result = schema.parse({ timeout: '3600000' });
    expect(result.timeout).toBe(3600000);
  });
});
