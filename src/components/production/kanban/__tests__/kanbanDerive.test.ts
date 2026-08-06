import { describe, it, expect } from 'vitest';
import { deriveCard } from '../kanbanDerive';
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
