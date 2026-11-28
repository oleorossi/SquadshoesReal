import { describe, expect, it } from 'vitest';
import {
  AGUARDANDO_CABEDAL,
  saleOrderAwaitsCabedal,
  saleOrderDisplayStatus,
  saleOrderMatchesStatusFilter,
  summarizeCabedalHold,
} from '@/lib/saleOrderCabedalHold';
import type { AtelierProductionHoldLine } from '@/lib/atelierProductionHold';

const line = (over: Partial<AtelierProductionHoldLine> = {}): AtelierProductionHoldLine => ({
  saleOrderId: 'pv',
  itemId: 'i1',
  referenceCode: 'I90',
  color: 'ROSADO',
  pendingJobs: '',
  reason: 'Ateliê — aviamento ainda sem recebimento (0/360)',
  ...over,
});

describe('fase Aguardando Cabedal (derivada de Aprovado)', () => {
  it('Aprovado com cabedal fora vira Aguardando Cabedal', () => {
    expect(saleOrderAwaitsCabedal('Aprovado', [line()])).toBe(true);
    expect(saleOrderDisplayStatus('Aprovado', [line()])).toBe(AGUARDANDO_CABEDAL);
  });

  it('Aprovado sem cabedal fora continua Aprovado', () => {
    expect(saleOrderDisplayStatus('Aprovado', [])).toBe('Aprovado');
    expect(saleOrderDisplayStatus('Aprovado', undefined)).toBe('Aprovado');
  });

  it('saldo parcial já conferido não segura o pedido', () => {
    expect(saleOrderAwaitsCabedal('Aprovado', [line({ blocks: false })])).toBe(false);
  });

  it('só Aprovado entra na fase', () => {
    for (const s of ['Rascunho', 'Pendente', 'Em Produção', 'Faturado', 'Cancelado']) {
      expect(saleOrderDisplayStatus(s, [line()])).toBe(s);
    }
  });

  it('o filtro separa Aprovado de Aguardando Cabedal', () => {
    expect(saleOrderMatchesStatusFilter(AGUARDANDO_CABEDAL, 'Aprovado', [line()])).toBe(true);
    expect(saleOrderMatchesStatusFilter('Aprovado', 'Aprovado', [line()])).toBe(false);
    expect(saleOrderMatchesStatusFilter('Aprovado', 'Aprovado', [])).toBe(true);
    expect(saleOrderMatchesStatusFilter('all', 'Aprovado', [line()])).toBe(true);
  });

  it('o resumo lista só os itens que seguram o pedido', () => {
    const r = summarizeCabedalHold([line(), line({ itemId: 'i2', blocks: false })]);
    expect(r.count).toBe(1);
    expect(r.items[0].label).toBe('I90 · ROSADO');
  });
});
