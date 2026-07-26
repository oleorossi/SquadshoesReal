import { describe, expect, it } from 'vitest';
import {
  aggregateReferenciasProduzidas, FICHA_SETOR_TO_SECTOR_KEY, toFactoryDay,
  type OrderInfo, type PointingInput, type StageInput,
} from './referenciasProduzidas';

const orderA: OrderInfo = { id: 'op-a', order_number: 'OP-001', color: 'Preto', reference_id: 'ref-1', code: 'S-039', name: 'Sandália 39' };
const orderB: OrderInfo = { id: 'op-b', order_number: 'OP-002', color: 'preto ', reference_id: 'ref-1', code: 'S-039', name: 'Sandália 39' };
const orderSemRef: OrderInfo = { id: 'op-c', order_number: 'OP-003', color: 'Nude', reference_id: null, code: null, name: null };
const ORDERS = new Map([[orderA.id, orderA], [orderB.id, orderB], [orderSemRef.id, orderSemRef]]);

const pt = (over: Partial<PointingInput> = {}): PointingInput => ({
  order_id: 'op-a', order_stage_id: 'st-a', stage_name: 'Montagem', quantity: 10,
  created_at: '2026-07-10T15:00:00+00:00', ...over,
});
const st = (over: Partial<StageInput> = {}): StageInput => ({
  id: 'st-x', order_id: 'op-b', stage_name: 'Montagem', completed_at: '2026-07-12T18:00:00+00:00',
  quantity_processed: 24, quantity_total: 30, ...over,
});

const run = (args: Partial<Parameters<typeof aggregateReferenciasProduzidas>[0]> = {}) =>
  aggregateReferenciasProduzidas({
    pointings: [], fallbackStages: [], stageIdsComPointing: new Set(), orders: ORDERS,
    sectorKey: 'montagem', from: '2026-07-01', to: '2026-07-15', ...args,
  });

describe('toFactoryDay', () => {
  it('converte UTC pro dia-fábrica de São Paulo (UTC-3)', () => {
    // 02:30 UTC = 23:30 do dia ANTERIOR em SP
    expect(toFactoryDay('2026-07-16T02:30:00+00:00')).toBe('2026-07-15');
    expect(toFactoryDay('2026-07-10T15:00:00+00:00')).toBe('2026-07-10');
  });
  it('timestamp inválido → vazio', () => {
    expect(toFactoryDay('lixo')).toBe('');
  });
});

describe('FICHA_SETOR_TO_SECTOR_KEY', () => {
  it('aviamento da Ficha vira o enum canônico mesa', () => {
    expect(FICHA_SETOR_TO_SECTOR_KEY.aviamento).toBe('mesa');
    expect(FICHA_SETOR_TO_SECTOR_KEY.montagem).toBe('montagem');
  });
});

describe('aggregateReferenciasProduzidas', () => {
  it('soma pointings do setor no intervalo, agrupando ref+cor (case/trim-insensitive)', () => {
    const rows = run({
      pointings: [
        pt({ quantity: 10 }),
        pt({ order_id: 'op-b', order_stage_id: 'st-b', quantity: 5 }), // 'preto ' junta com 'Preto'
        pt({ stage_name: 'Solagem', quantity: 99 }),                    // outro setor: fora
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'S-039', color: 'Preto', pares: 15, opsCount: 2, fonte: 'apontamento' });
    expect(rows[0].ops).toEqual(['OP-001', 'OP-002']);
  });

  it('borda de fuso: 02:30 UTC do dia 16 conta como dia 15 (dentro do filtro)', () => {
    const rows = run({ pointings: [pt({ created_at: '2026-07-16T02:30:00+00:00' })] });
    expect(rows).toHaveLength(1);
    // e 15:00 UTC do dia 16 fica fora
    expect(run({ pointings: [pt({ created_at: '2026-07-16T15:00:00+00:00' })] })).toHaveLength(0);
  });

  it('estorno (quantity negativa) desconta; grupo nunca fica negativo', () => {
    const rows = run({ pointings: [pt({ quantity: 12 }), pt({ quantity: -4 })] });
    expect(rows[0].pares).toBe(8);
    expect(run({ pointings: [pt({ quantity: 5 }), pt({ quantity: -9 })] })).toHaveLength(0);
  });

  it('fallback de estágio concluído entra SÓ quando o stage não tem nenhum pointing', () => {
    const comLedger = run({
      pointings: [pt({ order_id: 'op-b', order_stage_id: 'st-x', quantity: 7 })],
      fallbackStages: [st()],
      stageIdsComPointing: new Set(['st-x']),
    });
    expect(comLedger[0].pares).toBe(7); // não soma os 24 do estágio

    const semLedger = run({ fallbackStages: [st()] });
    expect(semLedger[0]).toMatchObject({ pares: 24, fonte: 'estagio' });
  });

  it('fallback usa quantity_total quando quantity_processed = 0 (pré-backfill)', () => {
    const rows = run({ fallbackStages: [st({ quantity_processed: 0 })] });
    expect(rows[0].pares).toBe(30);
  });

  it('mistura ledger + estágio no mesmo grupo → fonte "misto"', () => {
    const rows = run({
      pointings: [pt({ quantity: 6 })],
      fallbackStages: [st()], // op-b, mesma ref+cor
    });
    expect(rows[0]).toMatchObject({ pares: 30, fonte: 'misto' });
  });

  it('stage_name legado "Mesa" casa com o setor aviamento da Ficha', () => {
    const rows = run({
      sectorKey: FICHA_SETOR_TO_SECTOR_KEY.aviamento,
      pointings: [pt({ stage_name: 'Mesa' }), pt({ stage_name: 'Aviamento', quantity: 3 })],
    });
    expect(rows[0].pares).toBe(13);
  });

  it('OP sem reference_id vira "(sem referência)" mantendo a cor', () => {
    const rows = run({ pointings: [pt({ order_id: 'op-c', order_stage_id: 'st-c' })] });
    expect(rows[0]).toMatchObject({ code: '—', name: '(sem referência)', color: 'Nude', pares: 10 });
  });

  it('intervalo invertido → vazio', () => {
    expect(run({ from: '2026-07-15', to: '2026-07-01', pointings: [pt()] })).toEqual([]);
  });
});
