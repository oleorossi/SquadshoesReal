import { describe, it, expect } from 'vitest';
import { QUADRO_PJ, isQuadroPj, resolveContractKind } from '../payrollContract';

describe('payrollContract', () => {
  it('quadro atual é PJ', () => {
    expect(QUADRO_PJ).toBe(true);
    expect(resolveContractKind()).toBe('pj');
    expect(resolveContractKind(null)).toBe('pj');
  });

  it('override explícito respeita clt/pj', () => {
    expect(resolveContractKind('clt')).toBe('clt');
    expect(resolveContractKind('pj')).toBe('pj');
    expect(isQuadroPj('clt')).toBe(false);
  });
});
