import { describe, expect, it } from 'vitest';
import { splitMessage } from '../src/utils/message-splitter';

describe('splitMessage', () => {
  it('splits long text into chunks', () => {
    const text = 'a'.repeat(5000);
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
  });

  it('keeps code blocks together when possible', () => {
    const text = 'Intro\n\n```js\nconsole.log("test");\n```\n\nOutro';
    const parts = splitMessage(text, 4096);
    expect(parts.length).toBe(1);
    expect(parts[0]).toContain('```js');
  });
});
