import { describe, it, expect } from 'vitest';
import {
  isCancelledOrDraftOrder,
  isFinishedOrder,
  isInactiveOrder,
  EXCLUDED_ORDER_STATUSES,
} from './orderStatus';

describe('isCancelledOrDraftOrder', () => {
  // Regressão PV-00146: as 3 OPs duplicadas foram canceladas no banco, mas o
  // Sistema de Etiquetas filtrava só `status !== 'Finalizado'` — então elas
  // continuaram em "Em Produção", contando pares e gerando etiqueta. A tela
  // seguiu mostrando 2.496 pares no lugar de 1.248.
  it('pega as duas grafias do banco (OP feminina, PV masculino)', () => {
    expect(isCancelledOrDraftOrder('Cancelada')).toBe(true);
    expect(isCancelledOrDraftOrder('Cancelado')).toBe(true);
  });

  it('pega rascunho e o histórico em minúsculas', () => {
    expect(isCancelledOrDraftOrder('Rascunho')).toBe(true);
    expect(isCancelledOrDraftOrder('cancelada')).toBe(true);
    expect(isCancelledOrDraftOrder(' CANCELADA ')).toBe(true);
  });

  it('NÃO pega OP de trabalho — senão some produção real da tela', () => {
    for (const s of ['Reservado', 'Em Produção', 'Pendente', 'Finalizado']) {
      expect(isCancelledOrDraftOrder(s)).toBe(false);
    }
  });

  it('status vazio/nulo não é tratado como cancelado', () => {
    expect(isCancelledOrDraftOrder(null)).toBe(false);
    expect(isCancelledOrDraftOrder(undefined)).toBe(false);
    expect(isCancelledOrDraftOrder('')).toBe(false);
  });
});

describe('isFinishedOrder', () => {
  it('reconhece concluída em todas as grafias vistas na base', () => {
    for (const s of ['Finalizado', 'Concluído', 'concluido', 'concluído']) {
      expect(isFinishedOrder(s)).toBe(true);
    }
  });

  it('cancelada não é finalizada — são conceitos diferentes', () => {
    expect(isFinishedOrder('Cancelada')).toBe(false);
  });
});

describe('isInactiveOrder', () => {
  it('é a união: concluída OU cancelada/rascunho', () => {
    for (const s of ['Finalizado', 'Concluído', 'Cancelada', 'Rascunho']) {
      expect(isInactiveOrder(s)).toBe(true);
    }
    for (const s of ['Reservado', 'Em Produção']) {
      expect(isInactiveOrder(s)).toBe(false);
    }
  });

  it('a lista exportada cobre os 4 status que existem hoje na base', () => {
    // Base em 20/07/2026: Finalizado(180), Reservado(35), Em Produção(26), Cancelada(3)
    const lower = EXCLUDED_ORDER_STATUSES.map(s => s.toLowerCase());
    expect(lower).toContain('finalizado');
    expect(lower).toContain('cancelada');
    expect(lower).not.toContain('reservado');
    expect(lower).not.toContain('em produção');
  });
});
