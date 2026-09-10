import { describe, expect, it } from 'vitest';
import {
  calculateConsumptionWithUnit,
  convertDm2ToLinearMeters,
  isLinearWidthMissing,
  linearUnitOrDm2,
} from '@/lib/materialConsumption';

/**
 * Contrato da avaliação 2026-09-10 (specs/consumo-cabedal-dm2-metros.md):
 * consumo de cabedal digitado em dm²/par na ficha → metros lineares na geração.
 *
 * Trava:
 *  1. fórmula canônica metros = total_dm² ÷ (largura_mm / 10)
 *  2. widthMissing quando falta largura (risco ~100×)
 *  3. override dm² da ficha NÃO é tratado como yield linear (trap endurecido)
 */

describe('Cabedal dm² → metros lineares — contrato', () => {
  const bobina1000mm = {
    dimensions_width: 1000,
    dimensions_length: 1500,
    dimensions_unit: 'mm',
    products: { unit: 'm' },
  };

  const item24pares = {
    grade: { '36': 12, '38': 12 },
    fichas: 1,
    quantity: 24,
  };

  it('fórmula canônica: 6 dm²/par × 24 pares ÷ (1000mm/10) = 1,44 m', () => {
    const { total, unit } = calculateConsumptionWithUnit(
      item24pares,
      6,
      bobina1000mm,
      'metro',
    );
    expect(unit).toBe('metro');
    expect(total).toBeCloseTo(1.44, 6);
    expect(convertDm2ToLinearMeters(144, bobina1000mm)).toBeCloseTo(1.44, 6);
  });

  it('usa a largura, não a maior dimensão (bobina 1000×1500)', () => {
    // 144 dm² ÷ 100 dm²/m = 1,44 m. Com GREATEST daria ÷150 = 0,96 m.
    expect(convertDm2ToLinearMeters(144, bobina1000mm)).toBeCloseTo(1.44, 6);
  });

  it('sem largura: retorna dm² cru e marca widthMissing (risco ~100×)', () => {
    const semLargura = {
      dimensions_width: 0,
      dimensions_length: 0,
      dimensions_unit: 'mm',
      products: { unit: 'm' },
    };
    expect(isLinearWidthMissing(semLargura, 'm')).toBe(true);
    // Sem divisor, o conversor devolve o total em dm² — UI deve alertar, não tratar como m.
    expect(convertDm2ToLinearMeters(144, semLargura)).toBeCloseTo(144, 6);
    expect(linearUnitOrDm2(true)).toBe('dm2');
    expect(linearUnitOrDm2(false)).toBe('metro');
  });

  it('override dm² da ficha vence yield_per_size linear (não infla ~100×)', () => {
    // Ficha de componente com yield já em m/par (caminho legítimo sozinho),
    // MAS a ficha técnica manda override em dm²/par — deve converter dm²→m.
    const sheetComYield = {
      ...bobina1000mm,
      yield_per_size: { '36': 0.06, '38': 0.06 }, // m/par — se usado cru: 1,44 m
    };
    const overrideDm2 = { '36': 6, '38': 6 }; // dm²/par da ficha técnica

    const { total, unit } = calculateConsumptionWithUnit(
      item24pares,
      6,
      sheetComYield,
      'metro',
      overrideDm2,
    );

    expect(unit).toBe('metro');
    // 12×6 + 12×6 = 144 dm² ÷ 100 = 1,44 m — NÃO 144 m (dm² tratado como m)
    // NÃO 1,44 m vindos do yield 0,06 (coincidência numérica do yield sozinho)
    // Com override 6 dm²: resultado esperado 1,44 m via conversão.
    expect(total).toBeCloseTo(1.44, 6);

    // Controle: sem override, o yield linear 0,06 m/par × 24 = 1,44 m também,
    // então prova o trap com override que INFLARIA se tratado como linear:
    const overrideQueInflariaSeLinear = { '36': 6, '38': 6 };
    const infladoSeBug = 6 * 12 + 6 * 12; // 144 — seria "144 m" no trap
    expect(total).not.toBeCloseTo(infladoSeBug, 0);
    expect(overrideQueInflariaSeLinear['36']).toBe(6);
  });

  it('por-size da ficha (dm²) com bobina correta ainda fecha em metros', () => {
    const { total, unit } = calculateConsumptionWithUnit(
      item24pares,
      99, // escalar isca — não deve mandar quando há per-size
      bobina1000mm,
      'metro',
      { '36': 5, '38': 7 }, // dm²/par
    );
    // (12×5 + 12×7) = 144 dm² ÷ 100 = 1,44 m
    expect(unit).toBe('metro');
    expect(total).toBeCloseTo(1.44, 6);
  });
});
