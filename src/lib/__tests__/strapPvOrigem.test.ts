import { describe, expect, it } from 'vitest';
import {
  listMissingStrapPvOrigemChoices,
  listStrapHubIncompleteForOrigem,
  resolveEffectiveStrapPvOrigem,
  sourceModeForEffectiveOrigem,
  strapFreightPerMeter,
} from '@/lib/strapPvOrigem';

describe('strapPvOrigem', () => {
  it('Hub fixo ganha sobre snapshot do PV', () => {
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'prestador' },
      { id: 'm1', origem_padrao: 'sempre_fabrica' },
    )).toBe('fabrica');
    expect(resolveEffectiveStrapPvOrigem(
      { pv_origem: 'fabrica' },
      { id: 'm1', origem_padrao: 'sempre_sku_acabado' },
    )).toBe('sku_acabado');
  });

  it('escolhe_no_pv exige pv_origem', () => {
    const issues = listMissingStrapPvOrigemChoices(
      [
        { label: 'Tira 1', measure_id: 'm1', pv_origem: null },
        { label: 'Tira 2', measure_id: 'm2', pv_origem: 'fabrica' },
        { label: 'Strass', measure_id: 'm3' },
        { label: 'Legado', measure_id: 'm4' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv' },
        { id: 'm2', origem_padrao: 'escolhe_no_pv' },
        { id: 'm3', origem_padrao: 'sempre_sku_acabado' },
        { id: 'm4' },
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].label).toBe('Tira 1');
  });

  it('lista preço ausente conforme origem efetiva', () => {
    const issues = listStrapHubIncompleteForOrigem(
      [
        { label: 'A', measure_id: 'm1', pv_origem: 'fabrica' },
        { label: 'B', measure_id: 'm2', pv_origem: 'prestador' },
      ],
      [
        { id: 'm1', origem_padrao: 'escolhe_no_pv', preco_artesanal_per_m: null },
        { id: 'm2', origem_padrao: 'escolhe_no_pv', preco_prestador_per_m: 1.5 },
      ],
    );
    expect(issues.map((issue) => issue.code)).toEqual(['preco_artesanal_ausente']);
  });

  it('frete/m exige Y > 0', () => {
    expect(strapFreightPerMeter(80, 1600)).toBeCloseTo(0.05);
    expect(strapFreightPerMeter(80, 0)).toBeNull();
    expect(strapFreightPerMeter(null, 1600)).toBeNull();
  });

  it('origem efetiva mapeia para source_mode do motor', () => {
    expect(sourceModeForEffectiveOrigem('sku_acabado')).toBe('buy_ready');
    expect(sourceModeForEffectiveOrigem('fabrica')).toBe('internal');
    expect(sourceModeForEffectiveOrigem('prestador')).toBe('internal');
    expect(sourceModeForEffectiveOrigem(null)).toBeNull();
  });
});
