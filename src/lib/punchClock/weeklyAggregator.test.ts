import { describe, it, expect } from 'vitest';
import { aggregateByWeek, type DayWithDate } from './weeklyAggregator';

/** Helper pra criar dia mockado pros tests. */
function mkDay(
  date: string,
  status: 'OK' | 'INCONSISTENTE' | 'IRREGULAR' | 'FALTA' | 'DSR',
  worked: number,
  expected: number,
  missing: number,
): DayWithDate {
  return {
    date,
    status,
    workedMinutes: worked,
    expectedMinutes: expected,
    missingMinutes: missing,
    detail: '',
    sortedPunches: [],
  };
}

describe('aggregateByWeek', () => {
  it('agrupa dias em semanas Seg→Dom (default)', () => {
    // Semana 04/05/2026 (Seg) → 10/05/2026 (Dom) — período do MODELO
    const days: DayWithDate[] = [
      mkDay('2026-05-04', 'OK', 530, 480, 0),       // Seg
      mkDay('2026-05-05', 'OK', 480, 480, 0),       // Ter
      mkDay('2026-05-06', 'OK', 549, 480, 0),       // Qua
      mkDay('2026-05-07', 'OK', 528, 480, 0),       // Qui
      mkDay('2026-05-08', 'OK', 502, 480, 0),       // Sex
      mkDay('2026-05-09', 'FALTA', 0, 240, 240),    // Sáb
      mkDay('2026-05-10', 'DSR', 0, 0, 0),          // Dom
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekStart).toBe('2026-05-04');
    expect(weeks[0].weekEnd).toBe('2026-05-10');
    expect(weeks[0].expectedMinutes).toBe(2640); // 5×480 + 240 = 44h
    expect(weeks[0].workedMinutes).toBe(2589);   // soma trabalhada
    expect(weeks[0].missingMinutes).toBe(240);
    expect(weeks[0].balanceMinutes).toBe(-51);    // 2589 − 2640
    expect(weeks[0].countsByStatus.OK).toBe(5);
    expect(weeks[0].countsByStatus.FALTA).toBe(1);
    expect(weeks[0].countsByStatus.DSR).toBe(1);
  });

  it('agrupa múltiplas semanas e ordena por weekStart', () => {
    const days: DayWithDate[] = [
      mkDay('2026-05-11', 'OK', 480, 480, 0),
      mkDay('2026-05-04', 'OK', 480, 480, 0),
      mkDay('2026-05-18', 'OK', 480, 480, 0),
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks).toHaveLength(3);
    expect(weeks[0].weekStart).toBe('2026-05-04');
    expect(weeks[1].weekStart).toBe('2026-05-11');
    expect(weeks[2].weekStart).toBe('2026-05-18');
  });

  it('sugestão "Ajustar batidas no RH" quando há inconsistência ou irregular', () => {
    // Mesmo com saldo positivo, exceções vencem
    const days: DayWithDate[] = [
      mkDay('2026-05-04', 'OK', 600, 480, 0),
      mkDay('2026-05-05', 'INCONSISTENTE', 0, 480, 480),
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks[0].suggestedAction).toBe('Ajustar batidas no RH');
  });

  it('sugestão "Compensar HH:MM" para saldo negativo sem exceções', () => {
    const days: DayWithDate[] = [
      mkDay('2026-05-04', 'OK', 240, 480, 240),    // trabalhou só 4h
      mkDay('2026-05-05', 'OK', 240, 480, 240),
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks[0].balanceMinutes).toBe(-480);
    expect(weeks[0].suggestedAction).toBe('Compensar 08:00');
  });

  it('sugestão "Banco a favor +HH:MM" para saldo positivo', () => {
    const days: DayWithDate[] = [
      mkDay('2026-05-04', 'OK', 600, 480, 0),     // 2h extras
      mkDay('2026-05-05', 'OK', 600, 480, 0),     // +2h
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks[0].balanceMinutes).toBe(240);
    expect(weeks[0].suggestedAction).toBe('Banco a favor +04:00');
  });

  it('sugestão "OK" quando tudo zera', () => {
    const days: DayWithDate[] = [
      mkDay('2026-05-04', 'OK', 480, 480, 0),
      mkDay('2026-05-05', 'OK', 480, 480, 0),
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks[0].balanceMinutes).toBe(0);
    expect(weeks[0].suggestedAction).toBe('OK');
  });

  it('weekStartsOn=0 (Dom→Sáb)', () => {
    const days: DayWithDate[] = [
      mkDay('2026-05-03', 'DSR', 0, 0, 0),         // Dom
      mkDay('2026-05-04', 'OK', 480, 480, 0),      // Seg
      mkDay('2026-05-09', 'OK', 240, 240, 0),      // Sáb
    ];
    const weeks = aggregateByWeek(days, { weekStartsOn: 0 });
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekStart).toBe('2026-05-03');
    expect(weeks[0].weekEnd).toBe('2026-05-09');
  });

  it('caso albana 11/05-17/05 do MODELO (mistura faltas + inconsist + irregular)', () => {
    // Da planilha: Esperado 44:00, Trabalhado 17:25, Faltante 28:00, Saldo -26:35
    // Dias OK 2, Faltas 2, Inconsist 1, Irregular 1 → "Ajustar batidas no RH"
    const days: DayWithDate[] = [
      mkDay('2026-05-11', 'OK', 480, 480, 0),
      mkDay('2026-05-12', 'OK', 565, 480, 0),     // trabalhou 9h25
      mkDay('2026-05-13', 'IRREGULAR', 0, 480, 480),
      mkDay('2026-05-14', 'INCONSISTENTE', 0, 480, 480),
      mkDay('2026-05-15', 'FALTA', 0, 480, 480),
      mkDay('2026-05-16', 'FALTA', 0, 240, 240),
      mkDay('2026-05-17', 'DSR', 0, 0, 0),
    ];
    const weeks = aggregateByWeek(days);
    expect(weeks[0].expectedMinutes).toBe(2640); // 44h
    expect(weeks[0].countsByStatus.OK).toBe(2);
    expect(weeks[0].countsByStatus.FALTA).toBe(2);
    expect(weeks[0].countsByStatus.INCONSISTENTE).toBe(1);
    expect(weeks[0].countsByStatus.IRREGULAR).toBe(1);
    expect(weeks[0].suggestedAction).toBe('Ajustar batidas no RH');
  });
});
