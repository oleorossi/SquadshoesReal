import { describe, expect, it } from 'vitest';
import {
  dm2ToPlates,
  fiberStockDualDisplay,
  isFiberStockProduct,
  plateAreaDm2FromDims,
} from '@/lib/insolePlateDualDisplay';

describe('insolePlateDualDisplay', () => {
  it('calcula área 1000×1500 mm = 150 dm²', () => {
    expect(plateAreaDm2FromDims(1000, 1500, 'mm')).toBeCloseTo(150, 6);
  });

  it('reconhece fibra por grupo/setor e unidade de área', () => {
    expect(isFiberStockProduct({
      unit: 'dm²',
      purchase_unit: 'placa',
      product_groups: { name: 'PALMILHA', sector: 'Palmilha' },
    })).toBe(true);
    expect(isFiberStockProduct({
      unit: 'm',
      product_groups: { name: 'NAPA SOFT' },
    })).toBe(false);
  });

  it('converte dm²→placas via conversion_rate', () => {
    expect(dm2ToPlates(1500, {
      unit: 'dm²',
      purchase_unit: 'placa',
      conversion_rate: 150,
    })).toBeCloseTo(10, 6);
  });

  it('converte dm²→placas via dimensões do grupo quando não há conversion_rate', () => {
    expect(dm2ToPlates(300, {
      unit: 'dm²',
      product_groups: {
        name: 'PALMILHA',
        sector: 'Palmilha',
        dimensions_width: 1000,
        dimensions_length: 1500,
        dimensions_unit: 'mm',
      },
    })).toBeCloseTo(2, 6);
  });

  it('fiberStockDualDisplay devolve ambos os números', () => {
    const dual = fiberStockDualDisplay(450, {
      unit: 'dm²',
      purchase_unit: 'placa',
      conversion_rate: 150,
      product_groups: { name: 'PALMILHA', sector: 'Palmilha' },
    });
    expect(dual).toEqual({ dm2: 450, plates: 3 });
  });
});
