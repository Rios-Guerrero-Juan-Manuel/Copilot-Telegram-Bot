/**
 * Tests for tool parameter types
 */
import { describe, it, expect } from 'vitest';
import {
  AskUserParams,
  LogMessageParams,
  SendFileParams,
} from '../src/types/tools.js';

describe('Tool Parameter Types', () => {
  describe('AskUserParams', () => {
    it('should require question', () => {
      const params: AskUserParams = {
        question: 'What is your name?',
      };
      expect(params.question).toBe('What is your name?');
    });

    it('should accept optional options array', () => {
      const params: AskUserParams = {
        question: 'Choose one:',
        options: ['Option A', 'Option B', 'Option C'],
      };
      expect(params.options).toHaveLength(3);
    });

    it('should work without options', () => {
      const params: AskUserParams = {
        question: 'Enter your answer:',
      };
      expect(params.options).toBeUndefined();
    });
  });

  describe('LogMessageParams', () => {
    it('should require message', () => {
      const params: LogMessageParams = {
        message: 'Test log message',
      };
      expect(params.message).toBe('Test log message');
    });

    it('should accept optional level', () => {
      const errorParams: LogMessageParams = {
        message: 'Error occurred',
        level: 'error',
      };
      expect(errorParams.level).toBe('error');

      const warnParams: LogMessageParams = {
        message: 'Warning message',
        level: 'warn',
      };
      expect(warnParams.level).toBe('warn');

      const infoParams: LogMessageParams = {
        message: 'Info message',
        level: 'info',
      };
      expect(infoParams.level).toBe('info');

      const debugParams: LogMessageParams = {
        message: 'Debug message',
        level: 'debug',
      };
      expect(debugParams.level).toBe('debug');
    });

    it('should work without level', () => {
      const params: LogMessageParams = {
        message: 'Default level message',
      };
      expect(params.level).toBeUndefined();
    });
  });

  describe('SendFileParams', () => {
    it('should require filePath', () => {
      const params: SendFileParams = {
        filePath: '/path/to/file.txt',
      };
      expect(params.filePath).toBe('/path/to/file.txt');
    });

    it('should accept optional caption', () => {
      const params: SendFileParams = {
        filePath: '/path/to/image.png',
        caption: 'Sample image',
      };
      expect(params.caption).toBe('Sample image');
    });

    it('should work without caption', () => {
      const params: SendFileParams = {
        filePath: '/path/to/document.pdf',
      };
      expect(params.caption).toBeUndefined();
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct log levels', () => {
      const validParams: LogMessageParams = {
        message: 'test',
        level: 'error',
      };
      expect(validParams.level).toBe('error');
    });

    it('should enforce string arrays for options', () => {
      const params: AskUserParams = {
        question: 'test',
        options: ['a', 'b', 'c'],
      };
      expect(params.options).toHaveLength(3);
    });
  });
});
