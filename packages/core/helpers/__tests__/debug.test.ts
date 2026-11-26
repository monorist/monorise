import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugLog } from '../debug';

describe('debugLog', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs nothing unless MONORISE_DEBUG is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (const value of [undefined, '', '0', 'false', 'FALSE', ' Off ', 'no']) {
      if (value === undefined) vi.stubEnv('MONORISE_DEBUG', undefined as never);
      else vi.stubEnv('MONORISE_DEBUG', value);
      debugLog('[MONORISE_DEBUG] trace', { payload: 'secret' });
    }

    expect(log).not.toHaveBeenCalled();
  });

  it('logs when MONORISE_DEBUG is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('MONORISE_DEBUG', '1');

    debugLog('[MONORISE_DEBUG] trace', { id: 1 });

    expect(log).toHaveBeenCalledWith('[MONORISE_DEBUG] trace', { id: 1 });
  });
});
