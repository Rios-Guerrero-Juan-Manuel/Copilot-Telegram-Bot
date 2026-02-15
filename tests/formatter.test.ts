import { describe, expect, it } from 'vitest';
import { formatForTelegram, escapeHtml } from '../src/utils/formatter';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('A < B')).toBe('A &lt; B');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('A > B')).toBe('A &gt; B');
  });

  it('escapes multiple special characters', () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert("XSS")&lt;/script&gt;'
    );
  });

  it('handles Windows paths with backslashes', () => {
    expect(escapeHtml('C:\\Users\\Test\\')).toBe('C:\\Users\\Test\\');
  });

  it('handles paths with special characters', () => {
    const path = 'C:\\Projects\\<test> & copy';
    expect(escapeHtml(path)).toBe('C:\\Projects\\&lt;test&gt; &amp; copy');
  });
});

describe('formatForTelegram', () => {
  it('formats bold and inline code', () => {
    const formatted = formatForTelegram('**bold** and `code`');
    expect(formatted).toContain('<b>bold</b>');
    expect(formatted).toContain('<code>code</code>');
  });

  it('formats code blocks', () => {
    const formatted = formatForTelegram('```\nconst a = 1;\n```');
    expect(formatted).toContain('<pre><code>');
    expect(formatted).toContain('const a = 1;');
  });
});
