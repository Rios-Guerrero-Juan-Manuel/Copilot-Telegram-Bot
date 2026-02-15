import { describe, it, expect, vi } from 'vitest';
import { createRateLimitMiddleware } from '../src/bot/rate-limit';

describe('Rate limit middleware', () => {
  it('blocks rapid consecutive messages from same user', async () => {
    const middleware = createRateLimitMiddleware('123', 1000);
    const next = vi.fn(async () => undefined);
    const reply = vi.fn(async () => undefined);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const ctx = {
      from: { id: 123 },
      message: { text: 'hello' },
      reply,
    } as any;

    await middleware(ctx, next);
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      expect.stringMatching(/demasiadas solicitudes|too many requests/i)
    );

    vi.useRealTimers();
  });

  it('allows message after interval', async () => {
    const middleware = createRateLimitMiddleware('123', 1000);
    const next = vi.fn(async () => undefined);
    const reply = vi.fn(async () => undefined);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const ctx = {
      from: { id: 123 },
      message: { text: 'hello' },
      reply,
    } as any;

    await middleware(ctx, next);
    vi.setSystemTime(new Date('2026-01-01T00:00:01.100Z'));
    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(reply).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
