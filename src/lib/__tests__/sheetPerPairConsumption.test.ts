import { describe, expect, it } from 'vitest';
import {
  computePerPairConsumption,
  isExcludedFromPerPair,
  type PerPairSource,
} from '@/lib/sheetPerPairConsumption';

const napaSheet = { dimensions_width: 1370, dimensions_unit: 'mm', products: { unit: 'm' } };

const src = (over: Partial<PerPairSource>): PerPairSource => ({
  component: 'Cabedal',
  material: 'NAPA SOFT',
  category: 'Cabedal',
  stockUnit: 'm',
  inputUnit: 'dm2',
  componentSheet: napaSheet,
  scalar: 0,
  perSize: null,
  ...over,
});

describe('computePerPairConsumption', () => {
  it('converte dm²/par → m/par pela largura da ficha de componente', () => {
    const [row] = computePerPairConsumption([src({ scalar: 13.7 })], ['34']);
    expect(row.unit).toBe('m');
    expect(row.average).toBeCloseTo(0.1, 6);
    expect(row.widthMissing).toBe(false);
  });

  it('sem largura fica em dm² e marca widthMissing', () => {
    const [row] = computePerPairConsumption([src({ scalar: 10, componentSheet: null })], ['34']);
    expect(row.unit).toBe('dm²');
    expect(row.average).toBe(10);
    expect(row.widthMissing).toBe(true);
  });

  it('média só nas numerações da grade da ficha', () => {
    const [row] = computePerPairConsumption(
      [src({ inputUnit: 'stock', stockUnit: 'un', perSize: { '28': 2, '29': 4, '40': 100 } })],
      ['28', '29'],
    );
    expect(row.average).toBe(3);
    expect(row.perSize).toEqual({ '28': 2, '29': 4 });
  });

  it('numeração sem valor cai no escalar', () => {
    const [row] = computePerPairConsumption(
      [src({ inputUnit: 'stock', stockUnit: 'un', scalar: 1, perSize: { '28': 3 } })],
      ['28', '29'],
    );
    expect(row.perSize).toEqual({ '28': 3, '29': 1 });
    expect(row.average).toBe(2);
  });

  it('tira: cm/PAR → m/par sem dividir por 2 (o ÷2 é só do input por pé)', () => {
    const [row] = computePerPairConsumption(
      [src({ component: 'Tiras', material: 'TIRA CHATA · 8 mm', category: null, inputUnit: 'stock', stockUnit: 'm', scale: 0.01, perSize: { '34': 60 } })],
      ['34'],
    );
    expect(row.unit).toBe('m');
    expect(row.average).toBeCloseTo(0.6, 6);
  });

  it('soma o mesmo material vindo de componentes diferentes', () => {
    const rows = computePerPairConsumption(
      [src({ scalar: 13.7 }), src({ component: 'Material extra', scalar: 27.4 })],
      ['34'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].average).toBeCloseTo(0.3, 6);
    expect(rows[0].components).toEqual(['Cabedal', 'Material extra']);
  });

  it('sem grade usa o escalar', () => {
    const [row] = computePerPairConsumption([src({ inputUnit: 'stock', stockUnit: 'par', scalar: 1, material: 'SOLADO 01', category: 'Solado' })], []);
    expect(row.average).toBe(1);
  });

  it('descarta linha zerada', () => {
    expect(computePerPairConsumption([src({ scalar: 0 })], ['34'])).toEqual([]);
  });
});

describe('isExcludedFromPerPair', () => {
  it.each([
    [{ component: 'Forração', material: 'NAPA FORRO', category: 'Cabedal' }],
    [{ component: 'BOM', material: 'NAPA FORRO', category: 'Forração da Palmilha' }],
    [{ component: 'BOM', material: 'COLA PU', category: 'Cola / Químico' }],
    [{ component: 'Palmilha', material: 'PLACA FIBRA 2MM', category: 'Palmilha' }],
    [{ component: 'BOM', material: 'Fibra Látex', category: 'Material Base' }],
  ])('exclui %o', (source) => {
    expect(isExcludedFromPerPair(source)).toBe(true);
  });

  it('mantém cabedal, tira e solado', () => {
    expect(isExcludedFromPerPair({ component: 'Cabedal', material: 'NAPA SOFT', category: 'Cabedal' })).toBe(false);
    expect(isExcludedFromPerPair({ component: 'Tiras', material: 'TIRA CHATA', category: null })).toBe(false);
    expect(isExcludedFromPerPair({ component: 'Solado', material: 'SOLADO 01', category: 'Solado' })).toBe(false);
  });
});
