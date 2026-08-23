import { describe, it, expect } from 'vitest';
import {
  areaToStockDivisor,
  calcRequiredForGrade,
  calculateConsumptionWithUnit,
  calculateGradeBasedDm2,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  pickConsumptionForSize,
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

  it('chave conjugada 33/34 casa grade numérica 33 e 34', () => {
    expect(
      calcRequiredForGrade({ '33/34': 8, '36': 9 }, { '33': 2, '34': 3, '36': 1 }, 6.5, 6)
    ).toBeCloseTo(2 * 8 + 3 * 8 + 1 * 9, 4);
  });

  it('grade conjugada 33/34 casa mapa numérico 33', () => {
    expect(
      calcRequiredForGrade({ '33': 7.5, '36': 9 }, { '33/34': 4, '36': 1 }, 6.5, 5)
    ).toBeCloseTo(4 * 7.5 + 1 * 9, 4);
  });

  it('zero explícito no per_size vale 0 e não cai no escalar', () => {
    expect(
      calcRequiredForGrade({ '34': 6, '36': 0 }, { '34': 1, '36': 1 }, 6.5, 2)
    ).toBeCloseTo(6, 4);
  });
});

describe('pickConsumptionForSize', () => {
  it('chave exata vence conjugada', () => {
    const picked = pickConsumptionForSize({ '33': 5, '33/34': 8 }, '33');
    expect(picked).toEqual({ found: true, value: 5, key: '33' });
  });

  it('grade 33 casa mapa 33/34', () => {
    const picked = pickConsumptionForSize({ '33/34': 8, '36': 9 }, '33');
    expect(picked).toEqual({ found: true, value: 8, key: '33/34' });
  });

  it('grade 33/34 casa mapa 33/34', () => {
    const picked = pickConsumptionForSize({ '33/34': 8 }, '33/34');
    expect(picked).toEqual({ found: true, value: 8, key: '33/34' });
  });

  it('zero explícito é encontrado', () => {
    const picked = pickConsumptionForSize({ '36': 0, '37': 8 }, '36');
    expect(picked).toEqual({ found: true, value: 0, key: '36' });
  });

  it('ausente devolve found=false', () => {
    expect(pickConsumptionForSize({ '36': 8 }, '33')).toEqual({ found: false });
    expect(pickConsumptionForSize({}, '36')).toEqual({ found: false });
    expect(pickConsumptionForSize(null, '36')).toEqual({ found: false });
  });

  it('string vazia e nulo não contam como preenchido', () => {
    expect(pickConsumptionForSize({ '36': '' }, '36')).toEqual({ found: false });
    expect(pickConsumptionForSize({ '36': null }, '36')).toEqual({ found: false });
  });
});

describe('calculateGradeBasedDm2 — conjugada e zero explícito', () => {
  it('override conjugado 33/34 entra na grade numérica', () => {
    const total = calculateGradeBasedDm2(
      { grade: { '33': 2, '34': 2, '36': 1 }, quantity: 5, fichas: 1 },
      6.5,
      null,
      { '33/34': 8, '36': 9 },
    );
    expect(total).toBeCloseTo(2 * 8 + 2 * 8 + 1 * 9, 4);
  });

  it('zero explícito no override não cai no escalar', () => {
    const total = calculateGradeBasedDm2(
      { grade: { '36': 2, '38': 2 }, quantity: 4, fichas: 1 },
      6.5,
      null,
      { '36': 0, '38': 8 },
    );
    expect(total).toBeCloseTo(0 + 2 * 8, 4);
  });

  it('tamanho realmente ausente ainda cai no escalar', () => {
    const total = calculateGradeBasedDm2(
      { grade: { '36': 1, '38': 1 }, quantity: 2, fichas: 1 },
      6.5,
      null,
      { '36': 8 },
    );
    expect(total).toBeCloseTo(8 + 6.5, 4);
  });

  it('PV-00125 CF 09 PRETO: grade 33/34 e 39/40 casam o mapa da ficha', () => {
    const grade = { '35': 2, '36': 2, '37': 3, '38': 2, '33/34': 1, '39/40': 2 };
    const map = { '35': 20, '36': 20, '37': 20, '38': 20, '33/34': 20, '39/40': 20 };
    expect(pickConsumptionForSize(map, '33/34')).toEqual({ found: true, value: 20, key: '33/34' });
    expect(pickConsumptionForSize(map, '39/40')).toEqual({ found: true, value: 20, key: '39/40' });
    expect(pickConsumptionForSize(map, '33')).toEqual({ found: true, value: 20, key: '33/34' });
    expect(pickConsumptionForSize(map, '39')).toEqual({ found: true, value: 20, key: '39/40' });
    const total = calculateGradeBasedDm2(
      { grade, quantity: 12, fichas: 1 },
      20,
      null,
      map,
    );
    expect(total).toBeCloseTo(240, 4);
  });

  it('PV-00125: se 33/34 e 39/40 fossem diferentes do escalar, o lookup velho erraria', () => {
    const grade = { '35': 2, '36': 2, '37': 3, '38': 2, '33/34': 1, '39/40': 2 };
    const map = { '35': 20, '36': 20, '37': 20, '38': 20, '33/34': 8, '39/40': 12 };
    const novo = calculateGradeBasedDm2({ grade, quantity: 12, fichas: 1 }, 20, null, map);
    // Velho: split_part('33/34','/',1)='33' não está no mapa → NULLIF → escalar 20.
    const velho =
      1 * 20 + 2 * 20 + 2 * 20 + 3 * 20 + 2 * 20 + 2 * 20;
    expect(velho).toBe(240);
    expect(novo).toBeCloseTo(1 * 8 + 2 * 20 + 2 * 20 + 3 * 20 + 2 * 20 + 2 * 12, 4);
    expect(novo).toBeCloseTo(212, 4);
    expect(novo).not.toBe(velho);
  });
});
