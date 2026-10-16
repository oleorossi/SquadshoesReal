import { describe, expect, it } from 'vitest';
import {
  buildArtisanalStrapMeasureYieldPayload,
  strapYieldCeiling,
} from '@/lib/confirmArtisanalStrapMeasureYield';

describe('buildArtisanalStrapMeasureYieldPayload', () => {
  it('manda só o rendimento quando a banda não muda', () => {
    expect(buildArtisanalStrapMeasureYieldPayload({ confirmedYieldMPerM: 90 })).toEqual({
      confirmed_yield_m_per_m: 90,
    });
  });

  it('omitir a banda não é o mesmo que zerá-la', () => {
    // Banda ausente = cada napa mantém a sua. Mandar `null` ou 0 faria o SQL
    // recusar o lote inteiro, então a chave simplesmente não vai.
    expect(buildArtisanalStrapMeasureYieldPayload({
      confirmedYieldMPerM: 90,
      cutBandWidthMm: null,
    })).not.toHaveProperty('cut_band_width_mm');
  });

  it('leva a banda quando o dono pede para corrigi-la', () => {
    expect(buildArtisanalStrapMeasureYieldPayload({
      confirmedYieldMPerM: 120,
      cutBandWidthMm: 11,
    })).toEqual({ confirmed_yield_m_per_m: 120, cut_band_width_mm: 11 });
  });

  it('só manda escopo quando o lote é parcial', () => {
    expect(buildArtisanalStrapMeasureYieldPayload({
      confirmedYieldMPerM: 90,
      baseGroupIds: ['a', 'b'],
    })).toEqual({ confirmed_yield_m_per_m: 90, base_group_ids: ['a', 'b'] });
  });
});

describe('strapYieldCeiling', () => {
  it('espelha floor(largura ÷ banda) — o CHECK do banco', () => {
    // TIRA OVERLOCK 5 mm hoje: 1370 mm de ficha, banda 18 mm.
    expect(strapYieldCeiling(1370, 18)).toBe(76);
    // Banda menor, teto maior: é por isso que corrigir a banda destrava
    // rendimentos que o cadastro atual recusa.
    expect(strapYieldCeiling(1370, 11)).toBe(124);
    expect(strapYieldCeiling(1370, 32)).toBe(42);
    expect(strapYieldCeiling(1370, 3)).toBe(456);
  });

  it('nunca arredonda para cima — banda parcial não vira tira', () => {
    expect(strapYieldCeiling(1370, 400)).toBe(3);
    expect(strapYieldCeiling(100, 30)).toBe(3);
  });

  it('cadastro incompleto devolve 0 em vez de Infinity ou NaN', () => {
    expect(strapYieldCeiling(0, 18)).toBe(0);
    expect(strapYieldCeiling(1370, 0)).toBe(0);
    expect(strapYieldCeiling(null, null)).toBe(0);
    expect(strapYieldCeiling(undefined, 18)).toBe(0);
  });
});
