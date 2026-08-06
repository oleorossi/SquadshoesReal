import { describe, it, expect } from 'vitest';
import { buildPointingPlan, moveOptions, skipBlockedByPartial, applyPointing } from '../pointingPlan';
import { deriveCard, type KanbanCardData } from '../kanbanDerive';
import type { OrderStage } from '@/hooks/useOrderStages';

/**
 * Guard da REGRA ÚNICA de mover card → apontar. O diálogo de um card só e o
 * movimento em lote passam pelos mesmos cálculos: se pulo/estorno/elegibilidade
 * divergirem, o lote grava diferente do individual (bug silencioso no ledger).
 */

const FLOW = new Map<string, number>([
  ['Corte Palmilha', 1], ['Corte Forração', 2], ['Costura', 3],
  ['Aviamento', 4], ['Silk', 5], ['Montagem', 6],
]);

const stage = (name: string, order: number, over: Partial<OrderStage> = {}): OrderStage => ({
  id: `st-${name}`,
  order_id: 'op-1',
  stage_name: name,
  stage_order: order,
  status: 'pendente',
  quantity_processed: 0,
  quantity_total: 100,
  started_at: null, completed_at: null, completed_by: null,
  observations: '', defects: '', created_at: '', updated_at: '',
  standard_time_minutes: 0, cost_per_hour: 0, actual_time_minutes: 0, cost_per_pair: 0,
  ...over,
});

/** Card com o fluxo completo, parado no setor `column`. */
function makeCard(over: {
  stages: OrderStage[];
  column: string;
  front?: OrderStage | null;
}): KanbanCardData {
  const columnStage = over.stages.find(s => s.stage_name === over.column) ?? null;
  return {
    q: { order_id: 'op-1', order_number: 'OP-1', quantity: 100 } as KanbanCardData['q'],
    stages: over.stages,
    column: over.column,
    front: over.front ?? null,
    delivered: 0,
    isPartial: false,
    columnStage,
    upstreamGap: null,
  };
}

describe('buildPointingPlan', () => {
  it('avança pro próximo setor sem pular nada', () => {
    const stages = [
      stage('Corte Palmilha', 1), stage('Corte Forração', 2), stage('Costura', 3),
    ];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Corte Forração', FLOW);
    expect(plan.available).toBe(true);
    expect(plan.isBackward).toBe(false);
    expect(plan.skipped).toEqual([]);
    // Aponta no setor ONDE o card está (o trabalho que acabou de acontecer)
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
    expect(plan.remaining).toBe(100);
  });

  it('lista os setores intermediários quando o destino pula etapas', () => {
    const stages = [
      stage('Corte Palmilha', 1), stage('Corte Forração', 2), stage('Costura', 3), stage('Aviamento', 4),
    ];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Aviamento', FLOW);
    expect(plan.skipped).toEqual(['Corte Forração', 'Costura']);
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
  });

  it('setor já concluído não conta como pulo (sai da sequência pendente)', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2), stage('Costura', 3),
    ];
    const front = stages[0];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front }), 'Costura', FLOW);
    expect(plan.skipped).toEqual([]);
    expect(plan.pointedStage?.stage_name).toBe('Corte Forração');
  });

  it('voltar no fluxo estorna no último setor com progresso', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2),
    ];
    const front = stages[0];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front }), 'Corte Palmilha', FLOW);
    expect(plan.isBackward).toBe(true);
    expect(plan.available).toBe(true);
    expect(plan.pointedStage?.stage_name).toBe('Corte Palmilha');
    expect(plan.remaining).toBe(100); // pares disponíveis pra estornar
  });

  it('sem nenhum apontamento não há o que estornar', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Corte Forração', 2)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Forração', front: null }), 'Corte Palmilha', FLOW);
    expect(plan.isBackward).toBe(true);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toMatch(/estornar/i);
  });

  it('destino fora do fluxo da OP fica indisponível (não inventa etapa)', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Corte Forração', 2)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), 'Silk', FLOW);
    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toMatch(/não passa por Silk/i);
  });

  it('sem destino aponta no próprio setor atual', () => {
    const stages = [stage('Corte Palmilha', 1, { quantity_processed: 40 }), stage('Costura', 3)];
    const plan = buildPointingPlan(makeCard({ stages, column: 'Corte Palmilha' }), null, FLOW);
    expect(plan.available).toBe(true);
    expect(plan.isBackward).toBe(false);
    expect(plan.skipped).toEqual([]);
    expect(plan.remaining).toBe(60);
  });
});

/**
 * REGRESSÃO com dados REAIS de produção (auditoria 2026-07-26, projeto
 * ssvxfoybzmjlypnipqzn): `sector_settings.flow_order` diverge da rota das OPs.
 *   sector_settings: … Corte Forração(20), Aviamento(30), Costura(40) …
 *   order_stages:    … Corte Forração(2),  Costura(3),   Aviamento(4)  …  ← 229 de 232 OPs
 * Ordenar as etapas pela config global fazia "mover Corte Forração → Costura"
 * enxergar Aviamento no meio e FECHÁ-LO com 0 pares. Quem manda é o
 * stage_order da OP (é o que `apontar_producao_setor` valida).
 */
describe('rota da OP prevalece sobre sector_settings (dados de produção)', () => {
  const FLOW_REAL = new Map<string, number>([
    ['Corte Palmilha', 10], ['Corte Forração', 20], ['Aviamento', 30], ['Costura', 40],
    ['Silk', 50], ['Colagem', 60], ['Montagem', 70], ['Solagem', 80],
    ['Acabamento', 90], ['Expedição', 100],
  ]);
  const ROTA_REAL: Array<[string, number]> = [
    ['Corte Palmilha', 1], ['Corte Forração', 2], ['Costura', 3], ['Aviamento', 4],
    ['Silk', 5], ['Colagem', 6], ['Montagem', 7], ['Solagem', 8],
    ['Acabamento', 9], ['Expedição', 10],
  ];
  const opStages = (concluidos: string[]) =>
    ROTA_REAL.map(([name, order]) => stage(name, order, concluidos.includes(name)
      ? { status: 'concluido', quantity_processed: 12, quantity_total: 12 }
      : { quantity_total: 12 }));

  it('mover Corte Forração → Costura NÃO fecha Aviamento', () => {
    const stages = opStages(['Corte Palmilha']);
    const card = deriveCard(
      { order_id: 'op', order_number: 'OP-00804', quantity: 12 } as KanbanCardData['q'],
      stages, FLOW_REAL,
    )!;
    expect(card.column).toBe('Corte Forração');
    const plan = buildPointingPlan(card, 'Costura', FLOW_REAL);
    expect(plan.skipped).toEqual([]);   // era ['Aviamento'] antes do fix
    expect(plan.isBackward).toBe(false);
  });

  it('com Costura concluída o card cai em Aviamento (e não pula pro Silk)', () => {
    const stages = opStages(['Corte Palmilha', 'Corte Forração', 'Costura']);
    const card = deriveCard(
      { order_id: 'op', order_number: 'OP-00804', quantity: 12 } as KanbanCardData['q'],
      stages, FLOW_REAL,
    )!;
    expect(card.column).toBe('Aviamento');
  });

  it('voltar de Aviamento pra Costura é estorno pela rota da OP', () => {
    const stages = opStages(['Corte Palmilha', 'Corte Forração', 'Costura']);
    const card = deriveCard(
      { order_id: 'op', order_number: 'OP-00804', quantity: 12 } as KanbanCardData['q'],
      stages, FLOW_REAL,
    )!;
    const plan = buildPointingPlan(card, 'Costura', FLOW_REAL);
    expect(plan.isBackward).toBe(true);        // flow_order diria "pra frente"
    expect(plan.pointedStage?.stage_name).toBe('Costura');
  });
});

describe('moveOptions', () => {
  it('oferece os setores pendentes à frente e o anterior pra voltar', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2), stage('Costura', 3), stage('Aviamento', 4),
    ];
    const front = stages[0];
    const opts = moveOptions(makeCard({ stages, column: 'Corte Forração', front }), FLOW);
    expect(opts.fwdOptions).toEqual(['Costura', 'Aviamento']);
    expect(opts.backOption).toBe('Corte Palmilha');
  });

  it('sem progresso não oferece volta', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Costura', 3)];
    const opts = moveOptions(makeCard({ stages, column: 'Corte Palmilha', front: null }), FLOW);
    expect(opts.backOption).toBeNull();
    expect(opts.fwdOptions).toEqual(['Costura']);
  });
});

/**
 * Trava do PULO PARCIAL (auditoria 2026-08-06). Pular setor deixando saldo
 * aberto na origem punha a OP em dois lugares ao mesmo tempo — o card ia
 * embora e a origem ficava com pares pendurados, invisíveis no quadro — e,
 * de quebra, desarmava as travas de quantidade do servidor pelo resto da rota
 * (setor fechado com 0 vira "entregou tudo" pra elas).
 */
describe('skipBlockedByPartial', () => {
  const stages = [
    stage('Corte Palmilha', 1), stage('Corte Forração', 2),
    stage('Costura', 3), stage('Aviamento', 4),
  ];
  const card = makeCard({ stages, column: 'Corte Palmilha' });

  it('barra o pulo quando a origem não fecha', () => {
    const plan = buildPointingPlan(card, 'Aviamento', FLOW);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(skipBlockedByPartial(plan, 60)).toBe(true);   // 60 de 100
  });

  it('libera o pulo com o lote cheio', () => {
    const plan = buildPointingPlan(card, 'Aviamento', FLOW);
    expect(skipBlockedByPartial(plan, 100)).toBe(false);
  });

  it('não interfere em movimento sem pulo — parcial pro próximo setor é normal', () => {
    const plan = buildPointingPlan(card, 'Corte Forração', FLOW);
    expect(plan.skipped).toEqual([]);
    expect(skipBlockedByPartial(plan, 60)).toBe(false);
  });

  it('não interfere em estorno', () => {
    const comProgresso = [
      stage('Corte Palmilha', 1, { status: 'concluido', quantity_processed: 100 }),
      stage('Corte Forração', 2),
    ];
    const c = makeCard({
      stages: comProgresso, column: 'Corte Forração', front: comProgresso[0],
    });
    const plan = buildPointingPlan(c, 'Corte Palmilha', FLOW);
    expect(plan.isBackward).toBe(true);
    expect(skipBlockedByPartial(plan, 10)).toBe(false);
  });
});

/**
 * Pular setor exige ACEITE HUMANO explícito (decisão do dono 06/08/2026).
 * Antes, `applyPointing` auto-confirmava `limite_setor_anterior` e
 * `material_nao_reservado` pelos setores pulados: os avisos do servidor eram
 * levantados e engolidos aqui dentro, sem ninguém ver.
 */
describe('applyPointing — confirmação humana do pulo', () => {
  const stages = [
    stage('Corte Palmilha', 1), stage('Corte Forração', 2),
    stage('Costura', 3), stage('Aviamento', 4),
  ];
  const card = makeCard({ stages, column: 'Corte Palmilha' });
  const fakeApontar = () => {
    const calls: unknown[] = [];
    return {
      calls,
      mutateAsync: async (p: unknown) => { calls.push(p); return { success: true }; },
    } as never;
  };

  it('recusa o pulo sem aceite, SEM gravar nada', async () => {
    const apontar = fakeApontar();
    const plan = buildPointingPlan(card, 'Aviamento', FLOW);
    const res = await applyPointing({ card, plan, target: 'Aviamento', qty: 100, apontar });
    expect(res.status).toBe('blocked');
    expect((apontar as unknown as { calls: unknown[] }).calls).toHaveLength(0);
  });

  it('com aceite, grava a origem e fecha os pulados', async () => {
    const apontar = fakeApontar();
    const plan = buildPointingPlan(card, 'Aviamento', FLOW);
    const res = await applyPointing({
      card, plan, target: 'Aviamento', qty: 100, apontar, skipAcknowledged: true,
    });
    expect(res.status).toBe('ok');
    // 1 apontamento na origem + 2 setores pulados
    expect((apontar as unknown as { calls: unknown[] }).calls).toHaveLength(3);
  });

  it('movimento sem pulo não pede aceite nenhum', async () => {
    const apontar = fakeApontar();
    const plan = buildPointingPlan(card, 'Corte Forração', FLOW);
    const res = await applyPointing({ card, plan, target: 'Corte Forração', qty: 100, apontar });
    expect(res.status).toBe('ok');
    expect((apontar as unknown as { calls: unknown[] }).calls).toHaveLength(1);
  });
});
