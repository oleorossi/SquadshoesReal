import { describe, it, expect } from 'vitest';
import { deriveCard, deriveCards } from '../kanbanDerive';
import type { OrderStage } from '@/hooks/useOrderStages';
import type { QueueDetailRow } from '@/hooks/useProductionEngine';

/**
 * Guard da DERIVAÇÃO DO CARD (auditoria 2026-08-06).
 *
 * `deriveCard` decide, sozinha, em que coluna a OP aparece e quantos pares o
 * quadro anuncia como entregues. Ela não tinha um único teste — e foi
 * exatamente aí que nasceu o pior defeito medido em produção: o card da
 * OP-2026-01191 dizendo `288/288` no Acabamento com 180 pares cortados,
 * em VERDE, porque setor pulado é fechado com `quantity_processed = 0` e a
 * função trocava o número real pelo nominal.
 *
 * As fixtures abaixo são os estados REAIS do banco em 06/08/2026.
 */

const FLOW = new Map<string, number>([
  ['Corte Palmilha', 10], ['Corte Forração', 20], ['Costura Palmilha', 30],
  ['Costura Cabedal', 40], ['Aviamento', 50], ['Silk', 60], ['Colagem', 70],
  ['Montagem', 80], ['Solagem', 90], ['Acabamento', 100], ['Expedição', 110],
]);

const stage = (name: string, order: number, over: Partial<OrderStage> = {}): OrderStage => ({
  id: `st-${name}`,
  order_id: 'op-1',
  stage_name: name,
  stage_order: order,
  status: 'pendente',
  quantity_processed: 0,
  quantity_total: 288,
  started_at: null, completed_at: null, completed_by: null,
  observations: '', defects: '', created_at: '', updated_at: '',
  standard_time_minutes: 0, cost_per_hour: 0, actual_time_minutes: 0, cost_per_pair: 0,
  ...over,
} as OrderStage);

const queue = (over: Partial<QueueDetailRow> = {}): QueueDetailRow =>
  ({ order_id: 'op-1', order_number: 'OP-2026-01191', quantity: 288, ...over }) as QueueDetailRow;

const done = (n: number) => ({ status: 'concluido', quantity_processed: n });

describe('deriveCard — caminho normal', () => {
  it('OP sem nenhum apontamento fica no primeiro setor, sem entrega e sem parcial', () => {
    const stages = [stage('Corte Palmilha', 1), stage('Corte Forração', 2), stage('Acabamento', 3)];
    const card = deriveCard(queue(), stages, FLOW)!;
    expect(card.column).toBe('Corte Palmilha');
    expect(card.front).toBeNull();
    expect(card.delivered).toBe(0);
    expect(card.isPartial).toBe(false);
    expect(card.upstreamGap).toBeNull();
  });

  it('setor fechado de verdade entrega o lote cheio e NÃO marca parcial', () => {
    const stages = [
      stage('Corte Palmilha', 1, done(288)),
      stage('Corte Forração', 2),
      stage('Acabamento', 3),
    ];
    const card = deriveCard(queue(), stages, FLOW)!;
    expect(card.column).toBe('Corte Forração');
    expect(card.delivered).toBe(288);
    expect(card.isPartial).toBe(false);
    expect(card.upstreamGap).toBeNull();
  });

  it('entrega incompleta do setor anterior marca parcial com o número real', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'em_andamento', quantity_processed: 200 }),
      stage('Corte Forração', 2),
    ];
    const card = deriveCard(queue(), stages, FLOW)!;
    expect(card.column).toBe('Corte Forração');
    expect(card.delivered).toBe(200);
    expect(card.isPartial).toBe(true);
  });

  it('OP com todos os setores concluídos sai do quadro', () => {
    const stages = [stage('Corte Palmilha', 1, done(288)), stage('Acabamento', 2, done(288))];
    expect(deriveCard(queue(), stages, FLOW)).toBeNull();
  });
});

describe('deriveCard — setor PULADO não pode virar entrega completa', () => {
  /** Estado real da OP-2026-01191 no banco em 06/08/2026. */
  const opPulada = () => [
    stage('Corte Palmilha', 1, { status: 'em_andamento', quantity_processed: 180 }),
    stage('Corte Forração', 2, done(0)),
    stage('Aviamento', 5, done(0)),
    stage('Silk', 6, done(0)),
    stage('Colagem', 7, done(0)),
    stage('Montagem', 8, done(0)),
    stage('Solagem', 9, done(0)),
    stage('Acabamento', 10, { status: 'em_andamento', quantity_processed: 0 }),
  ];

  it('anuncia os pares REALMENTE apontados, não o total nominal', () => {
    const card = deriveCard(queue(), opPulada(), FLOW)!;
    expect(card.column).toBe('Acabamento');
    // ⚠ A regressão que este teste existe pra pegar: aqui já saiu 288.
    expect(card.delivered).toBe(0);
  });

  it('fica ÂMBAR — o sinal de parcial não pode desligar justamente aqui', () => {
    expect(deriveCard(queue(), opPulada(), FLOW)!.isPartial).toBe(true);
  });

  it('aponta o buraco deixado pra trás: 108 pares nunca cortados', () => {
    const gap = deriveCard(queue(), opPulada(), FLOW)!.upstreamGap;
    expect(gap).toEqual({ sector: 'Corte Palmilha', missing: 108 });
  });

  it('OP-2026-01195: mesma mecânica, 24 pares de buraco', () => {
    const stages = [
      stage('Corte Palmilha', 1, { status: 'em_andamento', quantity_processed: 408, quantity_total: 432 }),
      stage('Solagem', 9, { ...done(0), quantity_total: 432 }),
      stage('Acabamento', 10, { status: 'em_andamento', quantity_processed: 0, quantity_total: 432 }),
    ];
    const card = deriveCard(queue({ quantity: 432 }), stages, FLOW)!;
    expect(card.column).toBe('Acabamento');
    expect(card.delivered).toBe(0);
    expect(card.isPartial).toBe(true);
    expect(card.upstreamGap).toEqual({ sector: 'Corte Palmilha', missing: 24 });
  });

  it('pulo com o lote CHEIO segue legítimo: sem buraco e sem âmbar', () => {
    const stages = [
      stage('Corte Palmilha', 1, done(288)),
      stage('Corte Forração', 2, done(288)),
      stage('Acabamento', 3),
    ];
    const card = deriveCard(queue(), stages, FLOW)!;
    expect(card.column).toBe('Acabamento');
    expect(card.delivered).toBe(288);
    expect(card.isPartial).toBe(false);
    expect(card.upstreamGap).toBeNull();
  });
});

describe('deriveCard — ordem da rota manda, não a config global', () => {
  it('usa stage_order da OP mesmo quando o flow_order global discorda', () => {
    // Rota legada: Aviamento (4) vem antes de Silk (5), mas o global põe
    // Aviamento em 50 e Silk em 60 — mesma ordem relativa. O que não pode é a
    // função reordenar pela config e fechar setor que a OP ainda não passou.
    const stages = [
      stage('Corte Palmilha', 1, done(288)),
      stage('Aviamento', 4),
      stage('Silk', 5),
    ];
    const card = deriveCard(queue(), stages, FLOW)!;
    expect(card.column).toBe('Aviamento');
  });

  it("normaliza 'Mesa' para 'Aviamento' na coluna do card", () => {
    const stages = [stage('Corte Palmilha', 1, done(288)), stage('Mesa', 4)];
    expect(deriveCard(queue(), stages, FLOW)!.column).toBe('Aviamento');
  });
});

/**
 * SETORES EM PARALELO (decisão do dono 06/08/2026, substitui a de 12/07).
 *
 * O motor agenda o mesmo `parallel_group` no mesmo nível — a OP roda em Corte
 * Palmilha E Corte Forração no mesmo dia. O quadro serial deixava a coluna do
 * par vazia: medido em 06/08, Corte Forração tinha 514 pares em 28 OPs e dizia
 * "Sem OP aguardando".
 */
describe('deriveCards — setores em paralelo', () => {
  // Espelha sector_settings de produção: grupo "corte" (10,20) colapsa em 10;
  // grupo "costura_aviamento" (30,40,50) colapsa em 30; o resto é serial.
  const LEVEL = new Map<string, number>([
    ['Corte Palmilha', 10], ['Corte Forração', 10],
    ['Costura Palmilha', 30], ['Costura Cabedal', 30], ['Aviamento', 30],
    ['Silk', 60], ['Colagem', 70], ['Montagem', 80], ['Solagem', 90],
    ['Acabamento', 100], ['Expedição', 110],
  ]);

  const rota = () => [
    stage('Corte Palmilha', 1), stage('Corte Forração', 2),
    stage('Costura Palmilha', 3), stage('Costura Cabedal', 4), stage('Aviamento', 5),
    stage('Silk', 6), stage('Acabamento', 10),
  ];

  it('OP nova aparece nas DUAS colunas do grupo de corte', () => {
    const cards = deriveCards(queue(), rota(), FLOW, LEVEL);
    expect(cards.map(c => c.column)).toEqual(['Corte Palmilha', 'Corte Forração']);
  });

  it('cada card tem chave própria — seleção não vaza pro irmão', () => {
    const cards = deriveCards(queue(), rota(), FLOW, LEVEL);
    expect(new Set(cards.map(c => c.key)).size).toBe(2);
    expect(cards[0].key).not.toBe(cards[1].key);
  });

  it('cada card aponta o irmão, pra não parecer duplicata', () => {
    const cards = deriveCards(queue(), rota(), FLOW, LEVEL);
    expect(cards[0].parallelSiblings).toEqual(['Corte Forração']);
    expect(cards[1].parallelSiblings).toEqual(['Corte Palmilha']);
  });

  it('fechar UM setor do par deixa só o outro — não ressuscita o concluído', () => {
    const stages = rota();
    stages[0] = stage('Corte Palmilha', 1, done(288));
    const cards = deriveCards(queue(), stages, FLOW, LEVEL);
    expect(cards.map(c => c.column)).toEqual(['Corte Forração']);
    expect(cards[0].parallelSiblings).toEqual([]);
  });

  it('grupo de 3 (costura + aviamento) gera 3 cards', () => {
    const stages = rota();
    stages[0] = stage('Corte Palmilha', 1, done(288));
    stages[1] = stage('Corte Forração', 2, done(288));
    const cards = deriveCards(queue(), stages, FLOW, LEVEL);
    expect(cards.map(c => c.column)).toEqual(['Costura Palmilha', 'Costura Cabedal', 'Aviamento']);
  });

  it('setor serial continua com UM card só', () => {
    const stages = rota();
    for (let i = 0; i < 5; i++) stages[i] = stage(stages[i].stage_name, i + 1, done(288));
    const cards = deriveCards(queue(), stages, FLOW, LEVEL);
    expect(cards.map(c => c.column)).toEqual(['Silk']);
  });

  it('sem mapa de níveis, cai no comportamento serial antigo', () => {
    expect(deriveCards(queue(), rota(), FLOW).map(c => c.column)).toEqual(['Corte Palmilha']);
  });

  it('OP terminada não gera card nenhum', () => {
    const stages = rota().map(s => stage(s.stage_name, s.stage_order, done(288)));
    expect(deriveCards(queue(), stages, FLOW, LEVEL)).toEqual([]);
  });

  it('o irmão herda a matemática de entrega — não inventa número próprio', () => {
    const stages = rota();
    // Corte Palmilha entregou parcial; ambos os cards do nível seguinte...
    stages[0] = stage('Corte Palmilha', 1, done(288));
    stages[1] = stage('Corte Forração', 2, done(0));   // pulado, fechado com zero
    const cards = deriveCards(queue(), stages, FLOW, LEVEL);
    // ...caem no grupo da costura, todos com o buraco do Corte Forração visível
    expect(cards.map(c => c.column)).toEqual(['Costura Palmilha', 'Costura Cabedal', 'Aviamento']);
    for (const c of cards) {
      expect(c.delivered).toBe(0);
      expect(c.isPartial).toBe(true);
      expect(c.upstreamGap).toEqual({ sector: 'Corte Forração', missing: 288 });
    }
  });
});
