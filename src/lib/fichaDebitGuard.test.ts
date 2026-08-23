import { describe, expect, it } from 'vitest';
import { evaluateFichaDebitGuard } from './fichaDebitGuard';

describe('evaluateFichaDebitGuard', () => {
  it('bloqueia PV sem OP', () => {
    const r = evaluateFichaDebitGuard([]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/sem OP/i);
  });

  it('bloqueia OP sem referência ou sem ficha', () => {
    expect(evaluateFichaDebitGuard([{ reference_id: null, has_sheet: false }]).allowed).toBe(false);
    expect(evaluateFichaDebitGuard([{ reference_id: 'ref', has_sheet: false }]).allowed).toBe(false);
  });

  it('libera só quando toda OP tem ficha', () => {
    const r = evaluateFichaDebitGuard([
      { reference_id: 'a', has_sheet: true },
      { reference_id: 'b', has_sheet: true },
    ]);
    expect(r.allowed).toBe(true);
    expect(r.missingSheet).toBe(0);
  });
});
