import { TELEGRAM_MAX_MESSAGE_LENGTH } from '../constants';

/**
 * Splits a long line into chunks of maximum length.
 * 
 * @param line - Line to split
 * @param maxLength - Maximum length per chunk
 * @returns Array of line chunks
 */
function splitLongLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];
  const parts: string[] = [];
  let start = 0;
  while (start < line.length) {
    parts.push(line.slice(start, start + maxLength));
    start += maxLength;
  }
  return parts;
}

/**
 * Attempts to add next chunk to current buffer, flushing if necessary.
 * 
 * @param result - Result array to flush to
 * @param current - Current buffer
 * @param nextChunk - Next chunk to add
 * @param maxLength - Maximum buffer length
 * @returns Updated buffer and flush status
 */
function pushChunk(
  result: string[],
  current: string,
  nextChunk: string,
  maxLength: number
): { current: string; flushed: boolean } {
  if (!nextChunk) return { current, flushed: false };
  if (current.length + nextChunk.length <= maxLength) {
    return { current: current + nextChunk, flushed: false };
  }
  if (current.length > 0) {
    result.push(current);
  }
  return { current: nextChunk, flushed: true };
}

/**
 * Splits a text segment respecting paragraph and line boundaries.
 * 
 * @param segment - Text segment to split
 * @param maxLength - Maximum length per chunk
 * @returns Array of text chunks
 */
function splitTextSegment(segment: string, maxLength: number): string[] {
  const result: string[] = [];
  const paragraphs = segment.split(/\n{2,}/);
  let current = '';

  paragraphs.forEach((paragraph, index) => {
    const prefix = index === 0 ? '' : '\n\n';
    const candidate = `${prefix}${paragraph}`;
    if (candidate.length <= maxLength) {
      const merged = pushChunk(result, current, candidate, maxLength);
      current = merged.current;
      return;
    }

    const lines = paragraph.split('\n');
    lines.forEach((line, lineIndex) => {
      const linePrefix = lineIndex === 0 ? prefix : '\n';
      const lineText = `${linePrefix}${line}`;
      if (lineText.length <= maxLength) {
        const merged = pushChunk(result, current, lineText, maxLength);
        current = merged.current;
        return;
      }

      const chunks = splitLongLine(lineText, maxLength);
      chunks.forEach((chunk) => {
        if (chunk.length > maxLength) return;
        const merged = pushChunk(result, current, chunk, maxLength);
        current = merged.current;
      });
    });
  });

  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Splits a long message into multiple chunks respecting Telegram's length limits.
 * Preserves code blocks and paragraph boundaries.
 * 
 * @param text - The text to split
 * @param maxLength - Maximum length per message chunk
 * @returns Array of message chunks
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const segments: Array<{ type: 'text' | 'code'; value: string }> = [];
  const codeRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  const result: string[] = [];
  let current = '';

  for (const segment of segments) {
    if (segment.type === 'code') {
      if (segment.value.length > maxLength) {
        if (current.length > 0) {
          result.push(current);
          current = '';
        }
        result.push(...splitTextSegment(segment.value, maxLength));
        continue;
      }
      const merged = pushChunk(result, current, segment.value, maxLength);
      current = merged.current;
      continue;
    }

    const parts = splitTextSegment(segment.value, maxLength);
    parts.forEach((part) => {
      const merged = pushChunk(result, current, part, maxLength);
      current = merged.current;
    });
  }

  if (current.length > 0) result.push(current);
  return result;
}
