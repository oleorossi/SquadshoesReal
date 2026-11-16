import { describe, expect, it } from 'vitest';
import {
  ATELIER_PRODUCTION_HOLD_TITLE,
  atelierProductionHoldBlocksStatus,
  formatAtelierProductionHoldMessage,
  saleOrderShowsAtelierProductionHold,
  type AtelierProductionHoldLine,
} from '@/lib/atelierProductionHold';

const pendente: AtelierProductionHoldLine = {
  saleOrderId: 'pv',
  itemId: 'item-1',
  referenceCode: 'I701',
  color: 'PRETO',
  pendingJobs: '11111111-1111-1111-1111-111111111111 · costura · sent_to_contractor',
  reason: 'Ateliê — costura só libera após recebido e conferido (status: sent_to_contractor)',
};

describe('portão Em Produção × cabedal no Ateliê', () => {
  it('aprovar com Ateliê pendente passa', () => {
    expect(atelierProductionHoldBlocksStatus('Aprovado', true)).toBe(false);
    expect(atelierProductionHoldBlocksStatus('Rascunho', true)).toBe(false);
    expect(atelierProductionHoldBlocksStatus('Pendente', true)).toBe(false);
  });

  it('Em Produção com Ateliê pendente é bloqueado', () => {
    expect(atelierProductionHoldBlocksStatus('Em Produção', true)).toBe(true);
  });

  it('Em Produção depois do retorno passa', () => {
    expect(atelierProductionHoldBlocksStatus('Em Produção', false)).toBe(false);
    expect(formatAtelierProductionHoldMessage([])).toBeNull();
  });

  it('a mensagem nomeia referência, cor, motivo e job', () => {
    const message = formatAtelierProductionHoldMessage([pendente]);
    expect(message?.startsWith(ATELIER_PRODUCTION_HOLD_TITLE)).toBe(true);
    expect(message).toContain('I701 / PRETO — Ateliê — costura só libera após recebido e conferido');
    expect(message).toContain('Jobs pendentes: 11111111-1111-1111-1111-111111111111 · costura · sent_to_contractor.');
  });

  it('o selo aparece antes de Em Produção e some depois', () => {
    expect(saleOrderShowsAtelierProductionHold('Rascunho')).toBe(true);
    expect(saleOrderShowsAtelierProductionHold('Pendente')).toBe(true);
    expect(saleOrderShowsAtelierProductionHold('Aprovado')).toBe(true);
    expect(saleOrderShowsAtelierProductionHold('Em Produção')).toBe(false);
    expect(saleOrderShowsAtelierProductionHold('Faturado')).toBe(false);
  });
});
