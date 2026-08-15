import { describe, expect, it } from 'vitest';
import { resolveServiceOrderWorkflow } from '@/lib/serviceOrderWorkflow';

describe('resolveServiceOrderWorkflow', () => {
  it('manda uma OS rastreada antes de permitir conferência', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Pendente', dispatchTracked: true, quantity: 120,
      qtyDispatched: 0, qtyInField: 0, qtyToDispatch: 120,
    });

    expect(state.primaryAction).toBe('dispatch');
    expect(state.canDispatch).toBe(true);
    expect(state.canConference).toBe(false);
  });

  it('oferece conferência quando há pares fisicamente na rua', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Em Andamento', dispatchTracked: true, quantity: 120,
      qtyDispatched: 60, qtyInField: 60, qtyToDispatch: 60,
    });

    expect(state.primaryAction).toBe('conference');
    expect(state.canConference).toBe(true);
    expect(state.canDispatch).toBe(true);
  });

  it('mantém compatibilidade com OS legada de envio implícito', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Pendente', dispatchTracked: false, quantity: 80,
    });

    expect(state.primaryAction).toBe('conference');
    expect(state.qtyInField).toBe(80);
  });

  it('leva uma OS concluída com conta para o financeiro', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Concluído', dispatchTracked: true, quantity: 100,
      qtyDispatched: 100, qtyInField: 0, qtyReturnedGood: 98,
      qtyLoss: 2, hasPayable: true, isPaid: false,
    });

    expect(state.primaryAction).toBe('finance');
    expect(state.financeDone).toBe(true);
    expect(state.financePaid).toBe(false);
  });

  it('encerra a etapa financeira do trabalho interno sem fabricar uma AP', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Concluído', dispatchTracked: true, quantity: 20,
      qtyDispatched: 20, qtyReturnedGood: 20,
      hasPayable: false, expectsPayable: false,
    });

    expect(state.primaryAction).toBeNull();
    expect(state.financeDone).toBe(true);
    expect(state.canOpenFinance).toBe(false);
  });

  it('não oferece ação operacional para OS cancelada', () => {
    const state = resolveServiceOrderWorkflow({
      status: 'Cancelado', dispatchTracked: true, quantity: 100,
      qtyToDispatch: 100,
    });

    expect(state.primaryAction).toBeNull();
    expect(state.canDispatch).toBe(false);
    expect(state.canConference).toBe(false);
  });
});
