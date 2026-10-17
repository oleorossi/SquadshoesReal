import { describe, expect, it } from 'vitest';
import { kitItemEffectiveCost } from '@/lib/materiaisBaseKitCost';

describe('kitItemEffectiveCost (Materiais base · total ativo)', () => {
  it('soma custo persistido quando não há rascunho', () => {
    expect(kitItemEffectiveCost({ cost_per_pair: 1.07, is_active: true })).toBe(1.07);
    expect(kitItemEffectiveCost({ cost_per_pair: 0.6, is_active: true })).toBe(0.6);
  });

  it('aceita vírgula pt-BR no rascunho (bug: Number("3,45") → 0)', () => {
    // Number("3,45") === NaN → || 0; o total ficava sem as linhas novas.
    expect(Number('3,45') || 0).toBe(0);
    expect(
      kitItemEffectiveCost(
        { cost_per_pair: 0, is_active: true },
        { cost: '3,45', active: true },
      ),
    ).toBe(3.45);
    expect(
      kitItemEffectiveCost(
        { cost_per_pair: 0, is_active: true },
        { cost: '0,70', active: true },
      ),
    ).toBe(0.7);
  });

  it('aceita ponto decimal no rascunho', () => {
    expect(
      kitItemEffectiveCost(
        { cost_per_pair: 0, is_active: true },
        { cost: '0.6', active: true },
      ),
    ).toBe(0.6);
  });

  it('linha inativa não entra no total', () => {
    expect(
      kitItemEffectiveCost(
        { cost_per_pair: 9, is_active: true },
        { cost: '9', active: false },
      ),
    ).toBe(0);
    expect(kitItemEffectiveCost({ cost_per_pair: 9, is_active: false })).toBe(0);
  });

  it('total das linhas do sintoma do dono (Rasteirinha)', () => {
    const rows = [
      { item: { cost_per_pair: 0, is_active: true }, draft: { cost: '3,45', active: true } },
      { item: { cost_per_pair: 0, is_active: true }, draft: { cost: '3,40', active: true } },
      { item: { cost_per_pair: 0, is_active: true }, draft: { cost: '0,70', active: true } },
      { item: { cost_per_pair: 0.6, is_active: true }, draft: { cost: '0.6', active: true } },
      { item: { cost_per_pair: 0, is_active: true }, draft: { cost: '1', active: true } },
    ];
    const total = rows.reduce((s, r) => s + kitItemEffectiveCost(r.item, r.draft), 0);
    expect(total).toBeCloseTo(9.15, 5);
  });
});
