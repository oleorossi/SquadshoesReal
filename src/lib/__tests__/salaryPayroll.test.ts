import { describe, it, expect } from 'vitest';
import { calculateSalaryPayroll, type SalaryDayInput } from '../salaryPayroll';

// Folha SALÁRIO CHEIO − DESCONTOS (decisão 2026-06-03). Trava a regra:
//   valor-dia = salário/30 ; valor-hora = salário/220
//   falta = −valor-dia ; atraso/saída-cedo = −(esperado−trabalhado)×valor-hora
//   HE (após 18h / fds / feriado) = +horas×valor-hora×1,5 ; falta NÃO tira DSR
//   batida ímpar = pendente (não desconta nem paga)
const MON = 1, THU = 4, FRI = 5, SUN = 0;

// Dia útil (seg–sex): jornada esperada 9h (540min). Fim de semana/feriado: 0.
const work = (date: string, dow: number, punches: string[]): SalaryDayInput =>
  ({ date, dayOfWeek: dow, isHoliday: false, isWorkday: dow >= 1 && dow <= 5, expectedMinutes: dow >= 1 && dow <= 5 ? 540 : 0, punches });
const weekend = (date: string, dow: number, punches: string[]): SalaryDayInput =>
  ({ date, dayOfWeek: dow, isHoliday: false, isWorkday: false, expectedMinutes: 0, punches });

describe('calculateSalaryPayroll', () => {
  it('dia perfeito (08–18): sem desconto, recebe o salário cheio', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, ['08:00', '12:00', '13:00', '18:00'])], 0);
    expect(r.valor_dia).toBeCloseTo(73.33, 1);
    expect(r.valor_hora).toBeCloseTo(10, 4);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(2200, 2);
  });

  it('FALTA (dia útil sem batida): desconta 1 valor-dia (sem mexer no DSR)', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, [])], 0);
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(73.33, 1);
    expect(r.gross_value).toBeCloseTo(2200 - 73.333, 1);
  });

  it('ATRASO + saída cedo (Marcio 21/05, 08:35–17:18): desconta 77min × valor-hora', () => {
    // span 08:35→17:18 = 523min − 1h almoço = 463 normal. déficit = 540 − 463 = 77min.
    const r = calculateSalaryPayroll(1850, [work('2026-05-21', THU, ['08:35', '17:18'])], 0);
    expect(r.normal_minutes).toBe(463);
    expect(r.atraso_minutes).toBe(77);
    expect(r.atraso_desconto).toBeCloseTo((77 / 60) * (1850 / 220), 2); // ≈ 10.79
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(1850 - (77 / 60) * (1850 / 220), 2);
  });

  it('atraso grande de 4 batidas (Marcio 22/05, 09:59–17:23): déficit 164min', () => {
    const r = calculateSalaryPayroll(1850, [work('2026-05-22', FRI, ['09:59', '11:56', '13:04', '17:23'])], 0);
    expect(r.normal_minutes).toBe(376); // (11:56−09:59)+(17:23−13:04)
    expect(r.atraso_minutes).toBe(164); // 540 − 376
    expect(r.atraso_desconto).toBeCloseTo((164 / 60) * (1850 / 220), 2);
  });

  it('DOMINGO trabalhado (Marcio 24/05, 09:45–17:48): tudo HE 1,5×, sem desconto', () => {
    // span 09:45→17:48 = 483 − 1h = 423min, todo premium (domingo).
    const r = calculateSalaryPayroll(1850, [weekend('2026-05-24', SUN, ['09:45', '17:48'])], 0);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(423);
    expect(r.he_value).toBeCloseTo((423 / 60) * (1850 / 220) * 1.5, 2); // ≈ 88.93
    expect(r.gross_value).toBeCloseTo(1850 + (423 / 60) * (1850 / 220) * 1.5, 2);
  });

  it('batida ÍMPAR (pulou batida): PENDENTE — não desconta nem paga, conta pro alerta', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-21', THU, ['08:21', '13:06', '18:30'])], 0);
    expect(r.pending_days).toBe(1);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.workdays).toBe(0); // dia pendente não entra no esperado
    expect(r.gross_value).toBeCloseTo(2200, 2); // sem desconto enquanto não resolver
  });

  it('hora extra após 18h em dia útil: desconta nada, soma a 1,5×', () => {
    // 08:00–20:00 com almoço: 9h normal + 2h após 18h.
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, ['08:00', '12:00', '13:00', '20:00'])], 0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(120);
    expect(r.he_value).toBeCloseTo((120 / 60) * 10 * 1.5, 2); // 30
    expect(r.gross_value).toBeCloseTo(2200 + 30, 2);
  });

  it('mês: 2 perfeitos + 1 falta + 1 atraso + 1 vale; líquido = salário − descontos', () => {
    const r = calculateSalaryPayroll(2200, [
      work('2026-05-04', MON, ['08:00', '12:00', '13:00', '18:00']), // perfeito
      work('2026-05-05', 2,   ['08:00', '12:00', '13:00', '18:00']), // perfeito
      work('2026-05-06', 3,   []),                                   // falta
      work('2026-05-07', THU, ['08:30', '18:00']),                   // atraso 30min
    ], 200);
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(73.333, 1);
    expect(r.atraso_minutes).toBe(30); // 08:30 span − 1h almoço = 510 normal; 540−510=30
    expect(r.atraso_desconto).toBeCloseTo((30 / 60) * 10, 2); // 5
    expect(r.advances_total).toBe(200);
    const expectedGross = 2200 - 73.333 - 5;
    expect(r.gross_value).toBeCloseTo(expectedGross, 1);
    expect(r.net_value).toBeCloseTo(expectedGross - 200, 1);
  });
});
