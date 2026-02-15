import { describe, it, expect } from 'vitest';
import { parseEnvVariables } from '../src/mcp/env-parser';

describe('Environment Variables Parser', () => {
  describe('Basic parsing without commas', () => {
    it('should parse simple KEY=VALUE pairs', () => {
      const result = parseEnvVariables('DEBUG=true,PORT=3000');
      expect(result).toEqual({
        DEBUG: 'true',
        PORT: '3000',
      });
    });

    it('should handle single variable', () => {
      const result = parseEnvVariables('API_KEY=secret123');
      expect(result).toEqual({
        API_KEY: 'secret123',
      });
    });

    it('should trim whitespace around keys and values', () => {
      const result = parseEnvVariables('  KEY1  =  value1  ,  KEY2  =  value2  ');
      expect(result).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
      });
    });

    it('should handle empty input', () => {
      expect(parseEnvVariables('')).toEqual({});
      expect(parseEnvVariables('   ')).toEqual({});
    });

    it('should handle dash (-) as empty', () => {
      expect(parseEnvVariables('-')).toEqual({});
    });

    it('should handle values with equals signs', () => {
      const result = parseEnvVariables('CONNECTION=user=admin;pass=secret');
      expect(result).toEqual({
        CONNECTION: 'user=admin;pass=secret',
      });
    });
  });

  describe('Parsing with double quotes', () => {
    it('should parse values with commas inside double quotes', () => {
      const result = parseEnvVariables('API_KEY="sk-123,456,789",DEBUG=true');
      expect(result).toEqual({
        API_KEY: 'sk-123,456,789',
        DEBUG: 'true',
      });
    });

    it('should parse multiple quoted values', () => {
      const result = parseEnvVariables('LIST="a,b,c",TAGS="tag1,tag2,tag3"');
      expect(result).toEqual({
        LIST: 'a,b,c',
        TAGS: 'tag1,tag2,tag3',
      });
    });

    it('should parse mixed quoted and unquoted values', () => {
      const result = parseEnvVariables('PATH="/usr/bin:/usr/local/bin",SIMPLE=nocomma,CSV="1,2,3"');
      expect(result).toEqual({
        PATH: '/usr/bin:/usr/local/bin',
        SIMPLE: 'nocomma',
        CSV: '1,2,3',
      });
    });

    it('should handle empty quoted values', () => {
      const result = parseEnvVariables('EMPTY="",VALUE=test');
      expect(result).toEqual({
        EMPTY: '',
        VALUE: 'test',
      });
    });

    it('should preserve spaces inside quotes', () => {
      const result = parseEnvVariables('MESSAGE="Hello, World!"');
      expect(result).toEqual({
        MESSAGE: 'Hello, World!',
      });
    });

    it('should handle equals sign inside double quotes', () => {
      const result = parseEnvVariables('SQL="SELECT * FROM users WHERE id=1,status=\'active\'"');
      expect(result).toEqual({
        SQL: "SELECT * FROM users WHERE id=1,status='active'",
      });
    });
  });

  describe('Parsing with single quotes', () => {
    it('should parse values with commas inside single quotes', () => {
      const result = parseEnvVariables("LIST='a,b,c',DEBUG=true");
      expect(result).toEqual({
        LIST: 'a,b,c',
        DEBUG: 'true',
      });
    });

    it('should parse multiple single-quoted values', () => {
      const result = parseEnvVariables("KEY1='value,1',KEY2='value,2'");
      expect(result).toEqual({
        KEY1: 'value,1',
        KEY2: 'value,2',
      });
    });

    it('should preserve double quotes inside single quotes', () => {
      const result = parseEnvVariables('JSON=\'{"key":"value,with,comma"}\'');
      expect(result).toEqual({
        JSON: '{"key":"value,with,comma"}',
      });
    });
  });

  describe('Escape sequences', () => {
    it('should handle escaped commas without quotes', () => {
      const result = parseEnvVariables('PATH=/usr/bin\\,/usr/local/bin');
      expect(result).toEqual({
        PATH: '/usr/bin,/usr/local/bin',
      });
    });

    it('should handle escaped equals signs', () => {
      const result = parseEnvVariables('FORMULA=a\\=b+c');
      expect(result).toEqual({
        FORMULA: 'a=b+c',
      });
    });

    it('should handle escaped backslashes', () => {
      const result = parseEnvVariables('PATH=C:\\\\Program Files\\\\App');
      expect(result).toEqual({
        PATH: 'C:\\Program Files\\App',
      });
    });

    it('should handle escaped quotes inside quoted strings', () => {
      const result = parseEnvVariables('MESSAGE="She said \\"Hello\\""');
      expect(result).toEqual({
        MESSAGE: 'She said "Hello"',
      });
    });

    it('should handle complex escaping', () => {
      const result = parseEnvVariables('MIXED="value\\,with\\,escapes",SIMPLE=test');
      expect(result).toEqual({
        MIXED: 'value,with,escapes',
        SIMPLE: 'test',
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle missing values', () => {
      expect(() => parseEnvVariables('KEY1=')).toThrow(/Invalid.*KEY1/i);
    });

    it('should handle missing keys', () => {
      expect(() => parseEnvVariables('=value')).toThrow(/Invalid/i);
    });

    it('should handle unclosed double quotes', () => {
      expect(() => parseEnvVariables('KEY="unclosed')).toThrow(/Unclosed.*quote/i);
    });

    it('should handle unclosed single quotes', () => {
      expect(() => parseEnvVariables("KEY='unclosed")).toThrow(/Unclosed.*quote/i);
    });

    it('should handle trailing comma', () => {
      const result = parseEnvVariables('KEY=value,');
      expect(result).toEqual({
        KEY: 'value',
      });
    });

    it('should handle multiple consecutive commas', () => {
      const result = parseEnvVariables('KEY1=value1,,,KEY2=value2');
      expect(result).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
      });
    });

    it('should handle escape at end of string', () => {
      expect(() => parseEnvVariables('KEY=value\\')).toThrow(/Invalid.*escape/i);
    });

    it('should handle empty key-value pairs', () => {
      const result = parseEnvVariables('KEY1=value1,,KEY2=value2');
      expect(result).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
      });
    });

    it('should handle special characters in values', () => {
      const result = parseEnvVariables('URL=https://example.com?param=value&other=test');
      expect(result).toEqual({
        URL: 'https://example.com?param=value&other=test',
      });
    });

    it('should handle unicode characters', () => {
      const result = parseEnvVariables('GREETING="¡Hola, mundo! 你好"');
      expect(result).toEqual({
        GREETING: '¡Hola, mundo! 你好',
      });
    });
  });

  describe('Complex real-world scenarios', () => {
    it('should handle database connection string', () => {
      const result = parseEnvVariables('DB_URL="postgresql://user:pass@localhost:5432/db?sslmode=require,timeout=30"');
      expect(result).toEqual({
        DB_URL: 'postgresql://user:pass@localhost:5432/db?sslmode=require,timeout=30',
      });
    });

    it('should handle API key with special characters', () => {
      const result = parseEnvVariables('API_KEY="sk-proj-abc123,def456,ghi789",ENV=production');
      expect(result).toEqual({
        API_KEY: 'sk-proj-abc123,def456,ghi789',
        ENV: 'production',
      });
    });

    it('should handle CSV list with mixed quotes', () => {
      const result = parseEnvVariables('ALLOWED_ORIGINS="http://localhost:3000,https://example.com",CORS=true');
      expect(result).toEqual({
        ALLOWED_ORIGINS: 'http://localhost:3000,https://example.com',
        CORS: 'true',
      });
    });

    it('should handle JSON-like values', () => {
      const result = parseEnvVariables('CONFIG=\'{"host":"localhost","ports":[8080,8081,8082]}\'');
      expect(result).toEqual({
        CONFIG: '{"host":"localhost","ports":[8080,8081,8082]}',
      });
    });

    it('should handle Windows paths', () => {
      const result = parseEnvVariables('PATH="C:\\\\Program Files\\\\App",TEMP=C:\\\\Temp');
      expect(result).toEqual({
        PATH: 'C:\\Program Files\\App',
        TEMP: 'C:\\Temp',
      });
    });

    it('should handle complex mixed scenario', () => {
      const result = parseEnvVariables(
        'API_KEY="sk-123,456,789",DEBUG=true,LIST=\'a,b,c\',PATH=/usr/bin\\,/usr/local/bin,SIMPLE=value'
      );
      expect(result).toEqual({
        API_KEY: 'sk-123,456,789',
        DEBUG: 'true',
        LIST: 'a,b,c',
        PATH: '/usr/bin,/usr/local/bin',
        SIMPLE: 'value',
      });
    });
  });

  describe('Backward compatibility', () => {
    it('should work with old simple format', () => {
      const result = parseEnvVariables('NODE_ENV=production,PORT=3000,DEBUG=false');
      expect(result).toEqual({
        NODE_ENV: 'production',
        PORT: '3000',
        DEBUG: 'false',
      });
    });

    it('should handle numeric values', () => {
      const result = parseEnvVariables('PORT=3000,TIMEOUT=5000');
      expect(result).toEqual({
        PORT: '3000',
        TIMEOUT: '5000',
      });
    });

    it('should handle boolean-like values', () => {
      const result = parseEnvVariables('DEBUG=true,VERBOSE=false,ENABLE=1');
      expect(result).toEqual({
        DEBUG: 'true',
        VERBOSE: 'false',
        ENABLE: '1',
      });
    });
  });

  describe('Security considerations', () => {
    it('should not allow code injection patterns', () => {
      const result = parseEnvVariables('SAFE="$(cat /etc/passwd)"');
      expect(result).toEqual({
        SAFE: '$(cat /etc/passwd)',
      });
    });

    it('should preserve but not execute backticks', () => {
      const result = parseEnvVariables('COMMAND="`whoami`"');
      expect(result).toEqual({
        COMMAND: '`whoami`',
      });
    });

    it('should handle very long values', () => {
      const longValue = 'a'.repeat(10000);
      const result = parseEnvVariables(`KEY="${longValue}"`);
      expect(result).toEqual({
        KEY: longValue,
      });
    });
  });
});
