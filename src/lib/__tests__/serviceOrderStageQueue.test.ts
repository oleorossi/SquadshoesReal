import { describe, expect, it } from 'vitest';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import {
  assessStageKitStock,
  filterRowsToStageKit,
  queuePullFilter,
  rankServiceOrderCandidates,
  stageKitComponents,
  summarizeStageQueue,
} from '@/lib/serviceOrderStageQueue';

function row(partial: Partial<ConsumptionRow> & Pick<ConsumptionRow, 'componentType' | 'groupName'>): ConsumptionRow {
  return {
    materialName: partial.groupName,
    color: 'PRETO',
    productUnit: 'm',
    totalQuantity: 10,
    available: 10,
    productIds: ['p1'],
    ...partial,
  } as ConsumptionRow;
}

describe('serviceOrderStageQueue', () => {
  it('o kit da Costura de cabedal ignora solado e palmilha', () => {
    expect(stageKitComponents('costura')).toEqual([
      'Cabedal', 'Forração', 'BOM', 'Componente Direto',
    ]);
    const kit = filterRowsToStageKit([
      row({ componentType: 'Cabedal', groupName: 'NAPA' }),
      row({ componentType: 'Solado', groupName: 'TR' }),
      row({ componentType: 'Palmilha', groupName: 'EVA' }),
      row({ componentType: 'BOM', groupName: 'LINHA' }),
    ], 'costura');
    expect(kit.map((item) => item.componentType)).toEqual(['Cabedal', 'BOM']);
  });

  it('o kit do Aviamento é só BOM + componente direto', () => {
    expect(stageKitComponents('mesa')).toEqual(['BOM', 'Componente Direto']);
    const kit = filterRowsToStageKit([
      row({ componentType: 'Cabedal', groupName: 'NAPA' }),
      row({ componentType: 'BOM', groupName: 'FIVELA' }),
      row({ componentType: 'Componente Direto', groupName: 'ILHOS' }),
      row({ componentType: 'Solado', groupName: 'TR' }),
    ], 'mesa');
    expect(kit.map((item) => item.componentType)).toEqual(['BOM', 'Componente Direto']);
  });

  it('estoque coberto no kit da etapa é ready mesmo com solado faltando na ficha', () => {
    const assessment = assessStageKitStock([
      row({ componentType: 'BOM', groupName: 'FIVELA', totalQuantity: 8, available: 20 }),
      row({ componentType: 'Solado', groupName: 'TR', totalQuantity: 100, available: 0, soleProductId: 's1' }),
    ], 'mesa');
    expect(assessment.status).toBe('ready');
  });

  it('falta só no kit da etapa marca short', () => {
    const assessment = assessStageKitStock([
      row({ componentType: 'Cabedal', groupName: 'NAPA', totalQuantity: 12, available: 1 }),
      row({ componentType: 'BOM', groupName: 'LINHA', totalQuantity: 2, available: 9 }),
    ], 'costura');
    expect(assessment.status).toBe('short');
    expect(assessment.shortCount).toBeGreaterThan(0);
  });

  it('cadastro incompleto no kit fica neutro', () => {
    const assessment = assessStageKitStock([
      row({
        componentType: 'BOM',
        groupName: 'FIVELA',
        totalQuantity: 0,
        warning: 'sem quantidade',
        productIds: [],
      }),
    ], 'mesa');
    expect(assessment.status).toBe('unknown');
  });

  it('ordena primeiro pelo prazo, depois pelo kit da etapa', () => {
    const ranked = rankServiceOrderCandidates([
      {
        id: 'far-ready',
        sector: 'mesa',
        billingDate: '2026-10-20',
        kitStatus: 'ready',
        source: 'a',
      },
      {
        id: 'near-short',
        sector: 'costura',
        billingDate: '2026-09-02',
        kitStatus: 'short',
        source: 'b',
      },
      {
        id: 'near-ready',
        sector: 'mesa',
        billingDate: '2026-09-02',
        kitStatus: 'ready',
        source: 'c',
      },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['near-ready', 'near-short', 'far-ready']);
    expect(ranked[0].pull).toBe('ambos');
    expect(ranked[1].pull).toBe('prazo_falta');
  });

  it('chip e relatório contam o filtro que puxou', () => {
    expect(queuePullFilter('2026-09-01', 'ready')).toBe('ambos');
    expect(queuePullFilter('2026-09-01', 'short')).toBe('prazo_falta');
    expect(queuePullFilter(null, 'unknown')).toBe('cadastro');

    const report = summarizeStageQueue(rankServiceOrderCandidates([
      { id: '1', sector: 'costura', billingDate: '2026-09-01', kitStatus: 'ready', source: 1 },
      { id: '2', sector: 'mesa', billingDate: '2026-09-10', kitStatus: 'short', source: 2 },
    ]));
    expect(report.total).toBe(2);
    expect(report.ready).toBe(1);
    expect(report.short).toBe(1);
    expect(report.byPull.ambos).toBe(1);
    expect(report.byPull.prazo_falta).toBe(1);
  });
});
