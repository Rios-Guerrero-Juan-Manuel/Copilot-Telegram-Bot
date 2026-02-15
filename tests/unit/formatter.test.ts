import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeMarkdown } from '../../src/utils/formatter';

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    const input = '<script>alert("XSS")</script>';
    const expected = '&lt;script&gt;alert("XSS")&lt;/script&gt;';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('should escape ampersands', () => {
    const input = 'Tom & Jerry';
    const expected = 'Tom &amp; Jerry';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle string with no special characters', () => {
    const input = 'Hello World';
    expect(escapeHtml(input)).toBe(input);
  });

  it('should escape MCP server names with special characters', () => {
    const input = '<malicious>server';
    const expected = '&lt;malicious&gt;server';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('should escape command arguments', () => {
    const input = '--eval="<script>alert(1)</script>"';
    const expected = '--eval="&lt;script&gt;alert(1)&lt;/script&gt;"';
    expect(escapeHtml(input)).toBe(expected);
  });
});

describe('escapeMarkdown', () => {
  it('should escape backticks in code blocks', () => {
    const input = '`code`';
    const expected = '\\`code\\`';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('should escape asterisks', () => {
    const input = '*bold*';
    const expected = '\\*bold\\*';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('should escape underscores', () => {
    const input = '_italic_';
    const expected = '\\_italic\\_';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('should escape dangerous command arguments', () => {
    const input = '--eval';
    const expected = '\\-\\-eval';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('should escape full dangerous command', () => {
    const input = 'node --eval="process.exit()"';
    const expected = 'node \\-\\-eval\\="process\\.exit\\(\\)"';
    expect(escapeMarkdown(input)).toBe(expected);
  });

  it('should handle empty string', () => {
    expect(escapeMarkdown('')).toBe('');
  });

  it('should escape all special Markdown characters', () => {
    const input = '\\*_[]()~`>#+-=|{}.!';
    const expected = '\\\\\\*\\_\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!';
    expect(escapeMarkdown(input)).toBe(expected);
  });
});

describe('HTML Injection Prevention', () => {
  it('should prevent XSS in LLM-generated messages', () => {
    const maliciousQuestion = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(maliciousQuestion);
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });

  it('should prevent XSS in MCP server warnings', () => {
    const maliciousCommand = '<script>steal_data()</script>';
    const escaped = escapeHtml(maliciousCommand);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('should prevent Markdown injection in dangerous args warning', () => {
    const maliciousFlag = '--eval=`malicious code`';
    const escaped = escapeMarkdown(maliciousFlag);
    // Backticks should be escaped
    expect(escaped).not.toContain('`malicious code`');
    expect(escaped).toContain('\\`');
  });
});
