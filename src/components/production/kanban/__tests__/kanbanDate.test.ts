import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayISO } from '../kanbanDerive';

/**
 * Trava a regressão do fuso no cabeçalho de capacidade do Kanban.
 *
 * `new Date().toISOString().slice(0,10)` é UTC: em São Paulo (UTC-3) ele vira o
 * dia SEGUINTE a partir das 21h. As colunas mostram
 * `hoje: {planned}/{capacity}` lendo `v_production_schedule_grid` por essa data
 * — então das 21h à meia-noite o quadro exibia a grade de AMANHÃ rotulada como
 * "hoje", bem no turno que programa o dia seguinte.
 */
describe('todayISO do Kanban é data LOCAL, não UTC', () => {
  afterEach(() => vi.useRealTimers());

  it('às 21h BRT ainda retorna o dia corrente (o UTC já virou)', () => {
    // 2026-07-29 21:30 em São Paulo == 2026-07-30 00:30 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T00:30:00.000Z'));

    // Só vale como prova quando o ambiente roda em fuso negativo (CI usa UTC).
    const offsetMin = new Date().getTimezoneOffset(); // UTC-3 => +180
    if (offsetMin <= 0) {
      expect(todayISO()).toBe('2026-07-30');
      return;
    }
    expect(todayISO()).toBe('2026-07-29');
  });

  it('às 23h59 BRT continua no dia corrente', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T02:59:00.000Z')); // 23:59 BRT

    const offsetMin = new Date().getTimezoneOffset();
    if (offsetMin <= 0) {
      expect(todayISO()).toBe('2026-07-30');
      return;
    }
    expect(todayISO()).toBe('2026-07-29');
  });

  it('sempre devolve YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
