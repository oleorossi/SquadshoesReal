import { describe, expect, it } from 'vitest';
import {
  aggregateMaterialAvailability,
  type RawMaterialAvailability,
} from '../materialAvailability';

function contribution(
  product_id: string,
  product_name: string,
  required: number,
  available: number,
  color: string,
): RawMaterialAvailability {
  return {
    product_id,
    product_name,
    required,
    available,
    referenceLabel: `NL02 - NL01 (${color})`,
    color,
    grade: { '34': 576, '35': 576, '36': 576 },
  };
}

describe('aggregateMaterialAvailability', () => {
  it('detecta falta compartilhada entre as três cores do PV-00167', () => {
    const colors = ['ROSADO', 'OFF WHITE', 'NEW WHISKY'];
    const rows = colors.flatMap((color) => [
      // Cada item isolado cabe nos 29,13096 kg; juntos, os 51,84 kg não cabem.
      contribution('hotmelt', 'HOTMELT', 17.28, 29.13096, color),
      contribution('cola-forte', 'COLA FORTE', 24.192, 0, color),
      contribution('cola-pvc', 'COLA PVC', 40.31424, 0, color),
    ]);

    expect(rows.filter((row) => row.product_id === 'hotmelt')
      .every((row) => row.required <= row.available)).toBe(true);

    const aggregated = aggregateMaterialAvailability(rows, new Map([
      ['hotmelt', 'Químicos'],
      ['cola-forte', 'Químicos'],
      ['cola-pvc', 'Químicos'],
    ]));
    const shortages = aggregated.filter((row) => row.required > row.available);
    const byProduct = new Map(aggregated.map((row) => [row.product_id, row]));

    expect(shortages).toHaveLength(3);
    expect(byProduct.get('cola-pvc')?.required).toBeCloseTo(120.94272, 5);
    expect(byProduct.get('cola-forte')?.required).toBeCloseTo(72.576, 5);
    expect(byProduct.get('hotmelt')).toMatchObject({
      available: 29.13096,
      referenceLabels: [
        'NL02 - NL01 (ROSADO)',
        'NL02 - NL01 (OFF WHITE)',
        'NL02 - NL01 (NEW WHISKY)',
      ],
      grade: null,
    });
    expect(byProduct.get('hotmelt')?.required).toBeCloseTo(51.84, 5);
    expect(
      Number(byProduct.get('hotmelt')?.required) - Number(byProduct.get('hotmelt')?.available),
    ).toBeCloseTo(22.70904, 5);
  });

  it('usa o estoque uma vez e não cria falta quando ele cobre a soma', () => {
    const [aggregated] = aggregateMaterialAvailability([
      contribution('produto-1', 'MATERIAL', 5, 20, 'PRETO'),
      contribution('produto-1', 'MATERIAL', 7, 20, 'BRANCO'),
      contribution('produto-1', 'MATERIAL', 8, 20, 'CARAMELO'),
    ], new Map([['produto-1', 'Insumos']]));

    expect(aggregated).toMatchObject({
      product_id: 'produto-1',
      required: 20,
      available: 20,
      color: null,
      grade: null,
    });
  });

  it('mantém baldes de estoque distintos separados', () => {
    const aggregated = aggregateMaterialAvailability([
      contribution('produto-a', 'MATERIAL A', 6, 5, 'PRETO'),
      contribution('produto-b', 'MATERIAL B', 4, 5, 'PRETO'),
    ], new Map([
      ['produto-a', 'Insumos'],
      ['produto-b', 'Insumos'],
    ]));
    const shortages = aggregated.filter((row) => row.required > row.available);

    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toMatchObject({
      product_id: 'produto-a',
      required: 6,
      available: 5,
    });
  });

  it('não colapsa cores nem grades diferentes do mesmo solado', () => {
    const aggregated = aggregateMaterialAvailability([
      contribution('solado-1', 'SOLADO 01', 12, 5, 'PRETO'),
      contribution('solado-1', 'SOLADO 01', 8, 5, 'CARAMELO'),
    ], new Map([['solado-1', 'Solado']]));

    expect(aggregated).toHaveLength(2);
    expect(aggregated.map((row) => ({
      color: row.color,
      required: row.required,
      grade: row.grade,
    }))).toEqual([
      {
        color: 'PRETO',
        required: 12,
        grade: { '34': 576, '35': 576, '36': 576 },
      },
      {
        color: 'CARAMELO',
        required: 8,
        grade: { '34': 576, '35': 576, '36': 576 },
      },
    ]);
  });
});
