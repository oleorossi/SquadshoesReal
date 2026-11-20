import { describe, expect, it } from 'vitest';
import {
  capacityAlert,
  gradesEqual,
  movableGrade,
  planRedistribution,
  reportMovementEffect,
  reportPendingDelta,
  returnDateForPairs,
  shrinkGrade,
} from '@/lib/osRedistribuicao';

const grade = { '34': 40, '35': 80, '36': 120 };

describe('redistribuição de OS', () => {
  it('a soma dos destinos tem que fechar o que sai', () => {
    const plan = planRedistribution({
      movable: grade,
      unsentPairs: 0,
      streetPairs: 240,
      take: { '34': 40, '35': 80 },
      moves: [
        { contractorId: 'a', internal: false, grade: { '34': 40, '35': 40 } },
        { contractorId: 'b', internal: false, grade: { '35': 30 } },
      ],
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/não fecha/);
  });

  it('não deixa passar do saldo nem duplicar numeração', () => {
    const over = planRedistribution({
      movable: grade,
      unsentPairs: 240,
      streetPairs: 0,
      take: { '36': 121 },
      moves: [{ contractorId: 'a', internal: false, grade: { '36': 121 } }],
    });
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/36/);

    const ok = planRedistribution({
      movable: grade,
      unsentPairs: 240,
      streetPairs: 0,
      take: { '34': 40, '36': 80 },
      moves: [
        { contractorId: 'a', internal: false, grade: { '34': 40 } },
        { contractorId: 'b', internal: false, grade: { '36': 80 } },
      ],
    });
    expect(ok.ok).toBe(true);
    expect(ok.unsentPairs).toBe(120);
    expect(ok.streetPairs).toBe(0);
    expect(ok.requiresUnproducedReturn).toBe(false);
    expect(ok.payable).toBe(0);
    expect(gradesEqual(ok.take, { '34': 40, '36': 80 })).toBe(true);
  });

  it('par já enviado exige devolução sem produção e não gera conta', () => {
    const plan = planRedistribution({
      movable: { pares: 240 },
      unsentPairs: 40,
      streetPairs: 200,
      take: { pares: 100 },
      moves: [
        { contractorId: 'a', internal: false, grade: { pares: 60 } },
        { contractorId: null, internal: true, grade: { pares: 40 } },
      ],
    });
    expect(plan.ok).toBe(true);
    expect(plan.unsentPairs).toBe(40);
    expect(plan.streetPairs).toBe(60);
    expect(plan.requiresUnproducedReturn).toBe(true);
    expect(plan.payable).toBe(0);
  });

  it('par que já voltou como produção não entra no saldo', () => {
    const plan = planRedistribution({
      movable: { '35': 10 },
      unsentPairs: 0,
      streetPairs: 10,
      take: { '35': 11 },
      moves: [{ contractorId: 'a', internal: false, grade: { '35': 11 } }],
    });
    expect(plan.ok).toBe(false);
  });

  it('encolhe a grade pelas numerações maiores', () => {
    expect(shrinkGrade(grade, 130)).toEqual({ '34': 40, '35': 70 });
    expect(movableGrade(grade, 110)).toEqual({ '34': 40, '35': 70 });
  });

  it('recalcula a volta pelo dia útil e avisa a capacidade sem bloquear', () => {
    expect(returnDateForPairs('2026-11-16', 10, 5)).toBe('2026-11-18');
    expect(returnDateForPairs('2026-11-16', 12, null, 5)).toBe('2026-11-23');
    expect(capacityAlert(30, 5)).toMatch(/não é bloqueado/);
    expect(capacityAlert(25, 5)).toBeNull();
  });

  it('o relatório tira a devolução sem produção da conta e da rua', () => {
    const effect = reportMovementEffect('return', 'unproduced_return', null);
    expect(effect.kind).toBe('devolucao_sem_producao');
    expect(effect.physicalSign).toBe(1);
    expect(effect.payableSign).toBe(0);
    expect(effect.countsAsProduced).toBe(false);
    expect(reportPendingDelta({
      source: 'return',
      kind: 'unproduced_return',
      reversesReturnId: null,
      qtyDispatched: 0,
      qtyGood: 40,
      qtyDefect: 0,
      qtyLoss: 0,
    })).toBe(-40);
    expect(reportMovementEffect('return', 'scrap', null).physicalSign).toBe(0);
    expect(reportMovementEffect('return', 'reversal', null).payableSign).toBe(0);
    expect(reportMovementEffect('return', null, null).countsAsProduced).toBe(true);
  });
});
