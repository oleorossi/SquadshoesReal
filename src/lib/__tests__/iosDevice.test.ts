import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIosBrowser } from '../iosDevice';

describe('isIosBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detecta iPhone pelo UA', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(isIosBrowser()).toBe(true);
  });

  it('detecta iPadOS com UA de Mac + toque', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(isIosBrowser()).toBe(true);
  });

  it('não marca desktop sem toque', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    });
    expect(isIosBrowser()).toBe(false);
  });
});
