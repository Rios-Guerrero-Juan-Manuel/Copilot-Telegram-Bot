import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../src/utils/logger';

// Mock the logger before importing safeLogger
vi.mock('../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

describe('safeLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should auto-sanitize metadata in info logs', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    safeLogger.info('Test message', {
      userId: '123',
      apiKey: 'secret123',
      message: 'Hello world',
    });

    expect(logger.info).toHaveBeenCalledWith('Test message', {
      userId: '123',
      apiKey: '[REDACTED]',
      message: 'Hello world',
    });
  });

  it('should auto-sanitize metadata in error logs', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    const error = new Error('Test error');
    safeLogger.error('Error occurred', { error, token: 'abc123' });

    expect(logger.error).toHaveBeenCalledWith('Error occurred', {
      error: expect.objectContaining({
        name: 'Error',
        message: 'Test error',
      }),
      token: '[REDACTED]',
    });
  });

  it('should auto-sanitize metadata in warn logs', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    safeLogger.warn('Warning', { password: 'secret', user: 'john' });

    expect(logger.warn).toHaveBeenCalledWith('Warning', {
      password: '[REDACTED]',
      user: 'john',
    });
  });

  it('should auto-sanitize metadata in debug logs', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    safeLogger.debug('Debug info', { privateKey: 'key123', data: 'value' });

    expect(logger.debug).toHaveBeenCalledWith('Debug info', {
      privateKey: '[REDACTED]',
      data: 'value',
    });
  });

  it('should handle log method with level parameter', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    safeLogger.log('info', 'Custom log', { secret: 'hidden', visible: 'shown' });

    expect(logger.log).toHaveBeenCalledWith('info', 'Custom log', {
      secret: '[REDACTED]',
      visible: 'shown',
    });
  });

  it('should handle undefined metadata gracefully', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    safeLogger.info('Simple message');

    expect(logger.info).toHaveBeenCalledWith('Simple message', undefined);
  });

  it('should truncate long messages in metadata', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    const longMessage = 'x'.repeat(1500);
    safeLogger.info('Test', { message: longMessage });

    const call = (logger.info as any).mock.calls[0];
    expect(call[1].message).toHaveLength(1003); // 1000 + '...'
  });

  it('should handle circular references in metadata', async () => {
    const { safeLogger } = await import('../src/utils/safe-logger');
    
    const circular: any = { name: 'test' };
    circular.self = circular;

    expect(() => safeLogger.info('Circular data', circular)).not.toThrow();
    expect(logger.info).toHaveBeenCalled();
  });
});
