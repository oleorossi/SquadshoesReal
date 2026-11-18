import { describe, expect, it } from 'vitest';
import {
  atelierReceiptDetail,
  atelierReceiptProgressLabel,
  atelierReceiptRemaining,
  atelierReceivedCap,
  atelierWholePairs,
  pointingRemainingWithAtelierCap,
} from '@/lib/atelierReceipt';
import { atelierJobBlocksProduction } from '@/lib/atelier';

describe('recebimento parcial do Ateliê', () => {
  it('recusa fração, vírgula e negativo antes de chegar no servidor', () => {
    expect(atelierWholePairs('5')).toBe(5);
    expect(atelierWholePairs('0', true)).toBe(0);
    expect(atelierWholePairs('-2')).toBeNull();
    expect(atelierWholePairs('2,5')).toBeNull();
    expect(atelierWholePairs('2.5')).toBeNull();
    expect(atelierWholePairs('')).toBeNull();
  });

  it('não deixa a soma passar dos pares e mostra o saldo', () => {
    expect(atelierReceiptRemaining(180, 80)).toBe(100);
    expect(atelierReceiptRemaining(180, 180)).toBe(0);
    expect(atelierReceiptRemaining(180, 200)).toBe(0);
    expect(atelierReceiptProgressLabel('Costura', 80, 180)).toBe('Costura · 80/180 recebidos');
  });

  it('Em Produção libera com saldo e continua travada sem nenhum par', () => {
    expect(atelierJobBlocksProduction('contractor', 'partially_received', 80)).toBe(false);
    expect(atelierJobBlocksProduction('contractor', 'realized', 0)).toBe(true);
    expect(atelierJobBlocksProduction('contractor', 'received_at_factory', 180)).toBe(false);
    expect(atelierJobBlocksProduction('internal', 'partially_done', 10)).toBe(false);
    expect(atelierJobBlocksProduction('internal', 'in_progress', 0)).toBe(true);
    expect(atelierJobBlocksProduction('internal', 'done')).toBe(false);
  });

  it('a OP usa o menor saldo entre costura e aviamento', () => {
    expect(atelierReceivedCap([80, 40])).toBe(40);
    expect(atelierReceivedCap([80])).toBe(80);
    expect(atelierReceivedCap([])).toBeNull();
  });

  it('Montagem e Colagem não apontam acima do saldo recebido', () => {
    expect(pointingRemainingWithAtelierCap({
      stageName: 'Montagem',
      stageRemaining: 100,
      inboundRemaining: 100,
      alreadyProcessed: 0,
      cap: 80,
    })).toBe(80);
    expect(pointingRemainingWithAtelierCap({
      stageName: 'Colagem',
      stageRemaining: 180,
      inboundRemaining: 80,
      alreadyProcessed: 50,
      cap: 80,
    })).toBe(30);
    expect(pointingRemainingWithAtelierCap({
      stageName: 'Silk',
      stageRemaining: 180,
      inboundRemaining: null,
      alreadyProcessed: 0,
      cap: 80,
    })).toBe(180);
    expect(pointingRemainingWithAtelierCap({
      stageName: 'Montagem',
      stageRemaining: 40,
      inboundRemaining: 40,
      alreadyProcessed: 0,
      cap: null,
    })).toBe(40);
  });

  it('separa bons, defeito, perda e o que ainda está fora', () => {
    expect(atelierReceiptDetail({
      sent: 12, good: 7, defect: 1, loss: 1,
    })).toBe('7 bons · 1 defeito · 1 perda · 3 a receber · defeito pendente: 1');
    expect(atelierReceiptDetail({
      sent: 12, good: 10, defect: 1, loss: 1, pendingDefect: 0,
    })).toBe('10 bons · 1 defeito · 1 perda · 0 a receber');
    expect(atelierReceiptDetail({
      sent: 12, good: 4, defect: 1, loss: 0, pendingDefect: 0, inRework: 1, stillOut: 7,
    })).toBe('4 bons · 1 em retrabalho · 0 perda · 7 a receber');
  });
});
