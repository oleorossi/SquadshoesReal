import { describe, it, expect } from 'vitest';
import {
  areaToStockDivisor,
  calcRequiredForGrade,
  calculateConsumptionWithUnit,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
} from '@/lib/materialConsumption';

/**
 * Testes de unidades para o motor de cálculo de consumo do frontend
 * (src/lib/materialConsumption.ts).
 *
 * Cobre:
 *  - Sheets lineares (unit='cm' ou 'm') → saída sempre em metros.
 *  - Sheets de placa (unit='dm²') → saída em placas, com waste%.
 *  - Conversões dm² ↔ metro linear via largura da peça.
 */

describe('calculateConsumptionWithUnit — sheet linear em metros', () => {
  // GUARDA da regra do dono (03/08/2026, commit 9a0ea69): o consumo cadastrado
  // JÁ embute o rendimento real do material — o sistema NÃO acrescenta perda.
  // O campo waste_pct segue existindo em fichas antigas; o motor tem que
  // ignorá-lo. Se alguém reintroduzir `× (1 + waste/100)`, estes testes quebram.
  it('rendimento m/par ignora waste_pct da ficha', () => {
    const sheet = {
      products: { unit: 'm' },
      yield_per_size: { '34': 0.5, '36': 0.55, '38': 0.6 },
      waste_pct: 5, // valor legado — deve ser ignorado
    };
    const item = {
      grade: { '34': 1, '36': 1, '38': 1 },
      fichas: 10,
      quantity: 30,
    };
    // (1×0.5 + 1×0.55 + 1×0.6) × 10 = 16.5 m — cru, sem os 5%
    const { total, unit } = calculateConsumptionWithUnit(item, 0, sheet, 'auto');
    expect(unit).toBe('metro');
    expect(total).toBeCloseTo(16.5, 3);
  });

  it('sheet em cm é convertido para metros na saída', () => {
    const sheet = {
      products: { unit: 'cm' },
      yield_per_size: { '36': 22, '38': 24 }, // cm/par
      waste_pct: 0,
    };
    const item = { grade: { '36': 1, '38': 1 }, fichas: 5, quantity: 10 };
    // (22 + 24) × 5 = 230 cm = 2.30 m
    const { total, unit } = calculateConsumptionWithUnit(item, 0, sheet, 'auto');
    expect(unit).toBe('metro');
    expect(total).toBeCloseTo(2.3, 3);
  });
});

describe('calculateConsumptionWithUnit — sheet de placa (dm²)', () => {
  it('placa: dm² → quantidade de placas usando área da peça', () => {
    // Placa 100cm × 50cm = 1000mm × 500mm = 50 dm² por placa
    const sheet = {
      products: { unit: 'dm²' },
      dimensions_length: 100,
      dimensions_width: 50,
      dimensions_unit: 'cm',
      waste_pct: 0,
      yield_per_size: { '36': 6.5 }, // dm²/par
    };
    const item = { grade: { '36': 2 }, fichas: 5, quantity: 10 };
    // 2 × 6.5 × 5 = 65 dm² → 65 / 50 = 1.3 placas
    const { total, unit } = calculateConsumptionWithUnit(item, 6.5, sheet, 'auto');
    expect(unit).toBe('placa');
    expect(total).toBeCloseTo(1.3, 3);
  });
});

describe('convertDm2ToLinearMeters / convertDm2ToPlates', () => {
  it('converte dm² → metros lineares com largura 1.4 m', () => {
    const sheet = {
      dimensions_width: 1.4,
      dimensions_unit: 'm',
      waste_pct: 0,
    };
    // largura = 1.4m = 1400mm → 140 dm² por metro linear
    // 280 dm² / 140 dm²/m = 2.0 m
    expect(convertDm2ToLinearMeters(280, sheet)).toBeCloseTo(2.0, 3);
  });

  // ── A LARGURA é a largura, não "a maior dimensão" (mig 20261231120000) ────
  // Era Math.max(width, length). Enquanto todo cadastro tinha largura >=
  // comprimento os dois davam o mesmo número; o grupo PALMILHA quebrou o empate
  // e o max devolvia o COMPRIMENTO, subestimando o consumo em 33%.
  it('usa a LARGURA mesmo quando o comprimento é maior (caso PALMILHA)', () => {
    const bobina = { dimensions_width: 1000, dimensions_length: 1500, dimensions_unit: 'mm' };
    // largura 1000mm → 100 dm²/m. Com o antigo max() daria 1500mm → 150 dm²/m.
    expect(convertDm2ToLinearMeters(1000, bobina)).toBeCloseTo(10, 6);
    expect(areaToStockDivisor('m', bobina)).toBeCloseTo(100, 6);
  });

  it('não regride cadastro que gravou a medida só no comprimento', () => {
    const soComprimento = { dimensions_width: 0, dimensions_length: 1370, dimensions_unit: 'mm' };
    expect(areaToStockDivisor('m', soComprimento)).toBeCloseTo(137, 6);
  });

  it('a ÁREA da placa continua largura × comprimento (não é afetada)', () => {
    // 1000 × 1500 mm = 150 dm² — o mesmo 150 que, aplicado como dm²/m, era o bug.
    const placa = { dimensions_width: 1000, dimensions_length: 1500, dimensions_unit: 'mm' };
    expect(convertDm2ToPlates(300, placa)).toBeCloseTo(2, 6);
  });

  it('IGNORA waste% na conversão para metros lineares', () => {
    const sheet = {
      dimensions_width: 1.4,
      dimensions_unit: 'm',
      waste_pct: 10, // valor legado — deve ser ignorado
    };
    // 280 dm² / 140 dm²/m = 2.0 m — os 10% NÃO entram
    expect(convertDm2ToLinearMeters(280, sheet)).toBeCloseTo(2.0, 3);
  });

  it('IGNORA waste% na conversão dm² → placas', () => {
    const sheet = {
      dimensions_length: 100,
      dimensions_width: 50,
      dimensions_unit: 'cm',
      waste_pct: 8, // valor legado — deve ser ignorado
    };
    // placa = 50 dm²; 100 dm² / 50 = 2 placas exatas, sem os 8%
    expect(convertDm2ToPlates(100, sheet)).toBeCloseTo(2, 3);
  });
});

describe('calcRequiredForGrade — paridade com SQL calc_required_for_grade', () => {
  it('usa per_size quando disponível', () => {
    expect(
      calcRequiredForGrade({ '36': 6, '38': 7 }, { '36': 2, '38': 3 }, 6.5, 5)
    ).toBeCloseTo(2 * 6 + 3 * 7, 4);
  });

  it('cai no fallback quantityPerUnit × totalQuantity quando per_size vazio', () => {
    expect(calcRequiredForGrade({}, { '36': 2 }, 6.5, 2)).toBeCloseTo(13, 4);
  });
});
