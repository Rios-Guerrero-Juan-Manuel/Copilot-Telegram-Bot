/**
 * Escapes HTML special characters to prevent XSS
 * @param text - Text to escape
 * @returns Escaped text safe for HTML
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes Markdown special characters for Telegram Markdown mode
 * @param text - Text to escape
 * @returns Escaped text safe for Markdown
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

/**
 * Formats inline Markdown syntax to HTML.
 * Converts backticks to code, ** to bold, * to italic.
 * 
 * @param text - Text with inline Markdown
 * @returns HTML-formatted text
 */
function formatInline(text: string): string {
  let formatted = escapeHtml(text);
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  formatted = formatted.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  return formatted;
}

/**
 * Formats text for Telegram HTML mode by converting Markdown-like syntax
 * Supports code blocks (```), inline code (`), bold (**), and italic (*)
 * @param text - Raw text with Markdown-like formatting
 * @returns HTML-formatted text safe for Telegram's parse_mode: 'HTML'
 */
export function formatForTelegram(text: string): string {
  if (!text) return '';

  const codeRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let output = '';

  while ((match = codeRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    output += formatInline(before);

    const codeContent = match[1].replace(/^\n/, '').replace(/\n$/, '');
    output += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    output += formatInline(text.slice(lastIndex));
  }

  return output;
}
