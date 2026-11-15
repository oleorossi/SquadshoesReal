import { describe, expect, it } from 'vitest';
import {
  additionalMaterialLinesRequired,
  perSizeFallbackWarning,
  soleStandardDuplicateWarning,
} from '@/lib/additionalMaterialLines';

const grade = { '35': 2, '36': 4, '37': 4, '38': 2 };

describe('additionalMaterialLinesRequired', () => {
  it('ignora linha inativa e linha fora do consumo', () => {
    const rows = additionalMaterialLinesRequired({
      lines: [
        { productId: 'off', quantityPerUnit: 5, isActive: false },
        { productId: 'price', quantityPerUnit: 5, includeInConsumption: false },
        { productId: 'on', quantityPerUnit: 1 },
      ],
      quantity: 10,
    });
    expect(rows.map((row) => row.productId)).toEqual(['on']);
    expect(rows[0].requiredRaw).toBe(10);
  });

  it('soma a grade por tamanho e aplica a perda, com fallback na média', () => {
    const [row] = additionalMaterialLinesRequired({
      lines: [{
        id: 'line-1',
        productId: 'cola',
        quantityPerUnit: 10,
        consumptionType: 'per_size',
        consumptionPerSize: { '35': 1, '36': 2, '37': 3 },
        wastagePercentage: 10,
      }],
      grade,
      quantity: 12,
    });
    // 35:2×1 + 36:4×2 + 37:4×3 + 38:2×10 (média) = 2+8+12+20 = 42; +10% = 46.2
    expect(row.requiredRaw).toBeCloseTo(46.2, 6);
    expect(row.fallbackSizes).toEqual(['38']);
    expect(perSizeFallbackWarning(row.fallbackSizes)).toMatch(/38/);
  });

  it('a grade da ficha de componente vence o mapa da linha', () => {
    const [row] = additionalMaterialLinesRequired({
      lines: [{
        id: 'line-1',
        productId: 'cola',
        quantityPerUnit: 9,
        consumptionType: 'per_size',
        consumptionPerSize: { '35': 1 },
      }],
      grade: { '35': 4 },
      quantity: 4,
      grading: [{
        sheetMaterialId: 'line-1',
        sizeNumber: 35,
        specificConsumption: 3,
        createdAt: '2026-11-15T00:00:00Z',
      }],
    });
    expect(row.requiredRaw).toBe(12);
    expect(row.fallbackSizes).toEqual([]);
  });

  it('soma linhas repetidas do mesmo produto e escala a grade-base até a quantidade do pedido', () => {
    const rows = additionalMaterialLinesRequired({
      lines: [
        { productId: 'cola', quantityPerUnit: 1, createdAt: '2026-01-02' },
        { productId: 'cola', quantityPerUnit: 2, createdAt: '2026-01-01' },
      ],
      grade,
      quantity: 720,
      scaleGradeToQuantity: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].lineCount).toBe(2);
    expect(rows[0].requiredRaw).toBeCloseTo(3 * 720, 6);
    expect(rows[0].firstCreatedAt).toBe('2026-01-01');
  });

  it('o aviso do item padrão nomeia a quantidade ignorada', () => {
    expect(soleStandardDuplicateWarning(0.0018)).toMatch(/0\.0018/);
    expect(soleStandardDuplicateWarning(0.0018)).toMatch(/IGNORADA/);
  });
});
