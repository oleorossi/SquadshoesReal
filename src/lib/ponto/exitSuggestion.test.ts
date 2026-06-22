import { describe, it, expect } from 'vitest';
import { computeExitPattern, suggestExitTime, dowOf } from './exitSuggestion';

// 2026-06-01 = segunda? Confere o dow (0=dom). 2026-06-01 é segunda → 1.
describe('exitSuggestion', () => {
  it('dowOf sem timezone shift', () => {
    expect(dowOf('2026-06-01')).toBe(1); // segunda
    expect(dowOf('2026-06-07')).toBe(0); // domingo
  });

  it('mediana da última batida por dia da semana', () => {
    const rows = [
      // 3 segundas saindo 18:00, 18:10, 18:20 → mediana 18:10
      { record_date: '2026-06-01', punches: ['08:00', '12:00', '13:00', '18:00'] },
      { record_date: '2026-06-08', punches: ['08:00', '12:00', '13:00', '18:10'] },
      { record_date: '2026-06-15', punches: ['08:00', '12:00', '13:00', '18:20'] },
    ];
    const pat = computeExitPattern(rows);
    expect(pat.byDow[1]).toBe(18 * 60 + 10); // 18:10
    expect(suggestExitTime(pat, '2026-06-22').time).toBe('18:10'); // outra segunda
    expect(suggestExitTime(pat, '2026-06-22').source).toBe('dow');
  });

  it('cai pra mediana geral quando o dia da semana não tem amostra suficiente', () => {
    const rows = [
      { record_date: '2026-06-01', punches: ['08:00', '18:00'] }, // seg
      { record_date: '2026-06-02', punches: ['08:00', '17:00'] }, // ter
      { record_date: '2026-06-03', punches: ['08:00', '19:00'] }, // qua
    ];
    const pat = computeExitPattern(rows);
    // sexta (sem amostra própria) → mediana geral (17/18/19 → 18:00)
    const s = suggestExitTime(pat, '2026-06-05');
    expect(s.time).toBe('18:00');
    expect(s.source).toBe('overall');
  });

  it('ignora dias incompletos (ímpar/1 batida) no padrão', () => {
    const rows = [
      { record_date: '2026-06-01', punches: ['08:00'] },              // 1 batida → ignora
      { record_date: '2026-06-02', punches: ['08:00', '12:00', '18:00'] }, // ímpar → ignora
    ];
    const pat = computeExitPattern(rows);
    expect(pat.samples).toBe(0);
    expect(suggestExitTime(pat, '2026-06-10').source).toBe('default'); // 18:00
    expect(suggestExitTime(pat, '2026-06-10').time).toBe('18:00');
  });
});
