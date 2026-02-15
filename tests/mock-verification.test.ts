import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DEBE estar antes de los imports de módulos que usan child_process
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';

describe('Mock Verification', () => {
  beforeEach(() => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 12345,
      output: [null, Buffer.from(''), Buffer.from('')],
      signal: null,
    } as any);
  });

  it('should mock spawnSync successfully', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    
    // Call the mocked function
    const result = spawnSync('test-command', ['arg1'], { stdio: 'ignore' });
    
    // Verify it returns mocked value
    expect(result.status).toBe(0);
    expect(result.pid).toBe(12345);
    
    // Verify it was called
    expect(mockSpawnSync).toHaveBeenCalledWith('test-command', ['arg1'], { stdio: 'ignore' });
  });

  it('should allow overriding mock return value', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    
    // Override for this test
    mockSpawnSync.mockReturnValueOnce({
      status: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from('command not found'),
      pid: 12346,
      output: [null, Buffer.from(''), Buffer.from('command not found')],
      signal: null,
    } as any);
    
    const result = spawnSync('nonexistent', [], { stdio: 'ignore' });
    
    expect(result.status).toBe(1);
    expect(result.pid).toBe(12346);
  });
});
