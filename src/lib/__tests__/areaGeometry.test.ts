import { describe, expect, it } from 'vitest';
import {
  assertAreaGeometry,
  areaStockDm2PerUnit,
  isAreaStockUnit,
  plateAreaDm2,
} from '@/lib/areaGeometry';
import {
  areaToStockDivisor,
  convertDm2ToLinearMeters,
  convertDm2ToStockUnit,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';

/**
 * Unificação geometria de área + motor (18/10/2026).
 * Paridade TS×SQL: NAPA (linear) e PLACA EVA (W×L).
 */

const bobinaNapa: ComponentSheetCandidate = {
  dimensions_width: 1370,
  dimensions_length: 1000,
  dimensions_unit: 'mm',
  products: { unit: 'm' },
};

const placaEva: ComponentSheetCandidate = {
  dimensions_width: 1000,
  dimensions_length: 1500,
  dimensions_unit: 'mm',
  products: { unit: 'placa' },
};

describe('isAreaStockUnit / assertAreaGeometry', () => {
  it('reconhece m²/dm²/cm²/placa', () => {
    expect(isAreaStockUnit('dm²')).toBe(true);
    expect(isAreaStockUnit('m2')).toBe(true);
    expect(isAreaStockUnit('placa')).toBe(true);
    expect(isAreaStockUnit('m')).toBe(false);
    expect(isAreaStockUnit('un')).toBe(false);
  });

  it('exige L×A+unidade', () => {
    expect(assertAreaGeometry({ width: 1000, length: null, dimensionsUnit: 'mm' }).ok).toBe(false);
    expect(assertAreaGeometry({ width: 1000, length: 1500, dimensionsUnit: '' }).ok).toBe(false);
    const ok = assertAreaGeometry({ width: 1000, length: 1500, dimensionsUnit: 'mm' });
    expect(ok.ok).toBe(true);
  });
});

describe('paridade NAPA (linear) × PLACA EVA (área W×L)', () => {
  it('NAPA: 137 dm² ÷ 137 dm²/m = 1 m', () => {
    expect(convertDm2ToLinearMeters(137, bobinaNapa)).toBeCloseTo(1, 6);
    expect(areaToStockDivisor('m', bobinaNapa)).toBeCloseTo(137, 6);
  });

  it('PLACA EVA 1000×1500: dm2_per_unit = 150; 300 dm² → 2 placas', () => {
    expect(plateAreaDm2({
      width: placaEva.dimensions_width,
      length: placaEva.dimensions_length,
      dimensionsUnit: placaEva.dimensions_unit,
    })).toBeCloseTo(150, 6);
    expect(areaStockDm2PerUnit('placa', {
      width: 1000,
      length: 1500,
      dimensionsUnit: 'mm',
    }).dm2PerUnit).toBeCloseTo(150, 6);
    expect(convertDm2ToStockUnit(300, 'placa', placaEva)).toBeCloseTo(2, 6);
    expect(areaToStockDivisor('placa', placaEva)).toBeCloseTo(150, 6);
  });

  it('estoque em dm²: fator 1 (não divide pela área da placa)', () => {
    expect(areaStockDm2PerUnit('dm²', {
      width: 1000,
      length: 1500,
      dimensionsUnit: 'mm',
    }).dm2PerUnit).toBe(1);
    expect(convertDm2ToStockUnit(300, 'dm²', placaEva)).toBeCloseTo(300, 6);
    expect(areaToStockDivisor('dm²', placaEva)).toBe(1);
  });

  it('m² / cm²: fatores fixos 100 e 0.01', () => {
    expect(areaStockDm2PerUnit('m²', null).dm2PerUnit).toBe(100);
    expect(areaStockDm2PerUnit('cm²', null).dm2PerUnit).toBe(0.01);
    expect(convertDm2ToStockUnit(200, 'm²', null)).toBeCloseTo(2, 6);
  });
});
