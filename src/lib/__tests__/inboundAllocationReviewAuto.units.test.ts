import { describe, expect, it } from 'vitest';
import { shouldOpenInboundAllocationDispute } from '@/lib/inboundAllocationReviewStore';

describe('inbound allocation auto-confirm (1 PV)', () => {
  it('não abre com um único PV', () => {
    expect(shouldOpenInboundAllocationDispute(['pv-1', 'pv-1'], false)).toBe(false);
    expect(shouldOpenInboundAllocationDispute([null, 'pv-1'], false)).toBe(false);
  });

  it('abre com disputa entre PVs', () => {
    expect(shouldOpenInboundAllocationDispute(['pv-1', 'pv-2'], false)).toBe(true);
  });

  it('junta produtos se já houver revisão aberta', () => {
    expect(shouldOpenInboundAllocationDispute(['pv-1'], true)).toBe(true);
  });
});
