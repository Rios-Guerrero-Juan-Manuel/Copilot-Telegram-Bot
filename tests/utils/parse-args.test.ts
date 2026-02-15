import { describe, it, expect } from 'vitest';
import { parseCommandArgs } from '../../src/utils/parse-args';

describe('parseCommandArgs', () => {
  describe('Basic functionality', () => {
    it('should parse simple arguments without quotes', () => {
      expect(parseCommandArgs('/addproject ProjectName C:\\path')).toEqual([
        'ProjectName',
        'C:\\path',
      ]);
    });

    it('should parse arguments with single spaces', () => {
      expect(parseCommandArgs('/cd folder1 folder2')).toEqual(['folder1', 'folder2']);
    });

    it('should handle empty string', () => {
      expect(parseCommandArgs('/command')).toEqual([]);
    });

    it('should handle command with no arguments', () => {
      expect(parseCommandArgs('/cd')).toEqual([]);
    });

    it('should trim leading and trailing spaces', () => {
      expect(parseCommandArgs('/command   arg1   arg2  ')).toEqual(['arg1', 'arg2']);
    });
  });

  describe('Double quotes', () => {
    it('should parse Windows path with spaces in double quotes', () => {
      expect(parseCommandArgs('/addproject Copilot-Bot "C:\\Users\\John\\copilot-telegram-bot"')).toEqual([
        'Copilot-Bot',
        'C:\\Users\\John\\copilot-telegram-bot',
      ]);
    });

    it('should parse argument with spaces in double quotes', () => {
      expect(parseCommandArgs('/command "arg with spaces"')).toEqual(['arg with spaces']);
    });

    it('should parse multiple quoted arguments', () => {
      expect(parseCommandArgs('/command "first arg" "second arg"')).toEqual([
        'first arg',
        'second arg',
      ]);
    });

    it('should handle mixed quoted and unquoted arguments', () => {
      expect(parseCommandArgs('/command unquoted "quoted arg" another')).toEqual([
        'unquoted',
        'quoted arg',
        'another',
      ]);
    });

    it('should preserve multiple spaces inside quotes', () => {
      expect(parseCommandArgs('/command "arg  with   multiple    spaces"')).toEqual([
        'arg  with   multiple    spaces',
      ]);
    });
  });

  describe('Single quotes', () => {
    it('should parse argument with spaces in single quotes', () => {
      expect(parseCommandArgs("/command 'arg with spaces'")).toEqual(['arg with spaces']);
    });

    it('should parse Windows path with spaces in single quotes', () => {
      expect(parseCommandArgs("/addproject ProjectName 'C:\\Users\\Jane\\My Projects\\copilot-bot'")).toEqual([
        'ProjectName',
        'C:\\Users\\Jane\\My Projects\\copilot-bot',
      ]);
    });

    it('should parse multiple single-quoted arguments', () => {
      expect(parseCommandArgs("/command 'first arg' 'second arg'")).toEqual([
        'first arg',
        'second arg',
      ]);
    });
  });

  describe('Mixed quotes', () => {
    it('should handle double quotes inside single quotes', () => {
      const input = `/command 'arg with "quotes"'`;
      expect(parseCommandArgs(input)).toEqual(['arg with "quotes"']);
    });

    it('should handle single quotes inside double quotes', () => {
      const input = `/command "arg with 'quotes'"`;
      expect(parseCommandArgs(input)).toEqual(["arg with 'quotes'"]);
    });

    it('should handle alternating quote styles', () => {
      const input = `/command "double" 'single' "double again"`;
      expect(parseCommandArgs(input)).toEqual([
        'double',
        'single',
        'double again',
      ]);
    });
  });

  describe('Escape sequences', () => {
    it('should handle escaped double quotes', () => {
      expect(parseCommandArgs('/command "arg with \\"escaped\\" quotes"')).toEqual([
        'arg with "escaped" quotes',
      ]);
    });

    it('should handle escaped single quotes', () => {
      expect(parseCommandArgs("/command 'arg with \\'escaped\\' quotes'")).toEqual([
        "arg with 'escaped' quotes",
      ]);
    });

    it('should handle escaped backslashes', () => {
      expect(parseCommandArgs('/command "path\\\\with\\\\backslashes"')).toEqual([
        'path\\with\\backslashes',
      ]);
    });

    it('should handle Windows paths with backslashes (no escape needed outside quotes)', () => {
      expect(parseCommandArgs('/command C:\\Users\\Test')).toEqual(['C:\\Users\\Test']);
    });

    it('should handle escaped spaces outside quotes', () => {
      expect(parseCommandArgs('/command arg\\ with\\ escaped\\ spaces')).toEqual([
        'arg with escaped spaces',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle unclosed double quotes', () => {
      expect(parseCommandArgs('/command "unclosed quote')).toEqual(['unclosed quote']);
    });

    it('should handle unclosed single quotes', () => {
      expect(parseCommandArgs("/command 'unclosed quote")).toEqual(['unclosed quote']);
    });

    it('should handle empty quotes', () => {
      expect(parseCommandArgs('/command "" arg')).toEqual(['', 'arg']);
    });

    it('should handle only quotes', () => {
      expect(parseCommandArgs('/command ""')).toEqual(['']);
    });

    it('should handle multiple consecutive spaces', () => {
      expect(parseCommandArgs('/command arg1    arg2     arg3')).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('should handle quote at the end of unquoted arg', () => {
      expect(parseCommandArgs('/command arg"')).toEqual(['arg"']);
    });

    it('should handle quote at the start of unquoted arg', () => {
      expect(parseCommandArgs('/command "arg')).toEqual(['arg']);
    });

    it('should handle backslash at end', () => {
      expect(parseCommandArgs('/command arg\\')).toEqual(['arg\\']);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle the original failing case', () => {
      expect(parseCommandArgs('/addproject Copilot-Bot "C:\\Projects\\copilot-telegram-bot"')).toEqual([
        'Copilot-Bot',
        'C:\\Projects\\copilot-telegram-bot',
      ]);
    });

    it('should handle complex project path', () => {
      expect(
        parseCommandArgs('/addproject "My Project" "C:\\Users\\John Doe\\Documents\\Project Files"')
      ).toEqual(['My Project', 'C:\\Users\\John Doe\\Documents\\Project Files']);
    });

    it('should handle cd with quoted path', () => {
      expect(parseCommandArgs('/cd "D:\\Folder With Spaces\\Subfolder"')).toEqual([
        'D:\\Folder With Spaces\\Subfolder',
      ]);
    });

    it('should maintain backward compatibility with simple paths', () => {
      expect(parseCommandArgs('/addproject MyProject D:\\SimpleFolder')).toEqual([
        'MyProject',
        'D:\\SimpleFolder',
      ]);
    });

    it('should handle Unix-style paths with spaces', () => {
      expect(parseCommandArgs('/cd "/home/user/my documents"')).toEqual(['/home/user/my documents']);
    });

    it('should handle Windows paths with trailing backslash', () => {
      // Issue 2: Trailing backslash should not be lost
      expect(parseCommandArgs('/cd "C:\\Users\\Test\\"')).toEqual(['C:\\Users\\Test\\']);
      expect(parseCommandArgs('/addproject Test "C:\\Users\\Test\\"')).toEqual([
        'Test',
        'C:\\Users\\Test\\',
      ]);
    });
  });
});
