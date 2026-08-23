import { describe, expect, it } from 'vitest';
import {
  billingWeekFromMonthWeek,
  coerceToISODate,
  monthWeekToISODate,
  sanitizeSaleOrderHeaderDates,
} from './billingWeek';

describe('monthWeekToISODate', () => {
  it('clampa S1 de setembro/2026 no dia 1 (segunda cairia em agosto)', () => {
    expect(monthWeekToISODate('2026-09', 'S1')).toBe('2026-09-01');
  });

  it('devolve a segunda da semana 3 de setembro/2026', () => {
    expect(monthWeekToISODate('2026-09', 'S3')).toBe('2026-09-14');
  });
});

describe('coerceToISODate', () => {
  it('preserva ISO já válido', () => {
    expect(coerceToISODate('2026-09-14')).toBe('2026-09-14');
  });

  it('converte o token YYYY-MM-S# que o Postgres recusa como date', () => {
    expect(coerceToISODate('2026-09-S3')).toBe('2026-09-14');
    expect(coerceToISODate('2026-09-S1')).toBe('2026-09-01');
  });

  it('deriva do par mês+semana quando o deadline vem vazio', () => {
    expect(coerceToISODate('', '2026-09', 'S3')).toBe('2026-09-14');
    expect(coerceToISODate(null, '2026-09', 'S3')).toBe('2026-09-14');
  });

  it('não envia lixo pra coluna date', () => {
    expect(coerceToISODate('ontem')).toBeNull();
    expect(coerceToISODate('')).toBeNull();
    expect(coerceToISODate('lixo', '2026-09', 'S3')).toBeNull();
  });
});

describe('billingWeekFromMonthWeek', () => {
  it('concatena mês + semana no formato persistido no PV', () => {
    expect(billingWeekFromMonthWeek('2026-09', 'S3')).toBe('2026-09-S3');
  });

  it('não duplica quando a semana já veio no token completo', () => {
    expect(billingWeekFromMonthWeek('2026-09', '2026-09-S3')).toBe('2026-09-S3');
  });
});

describe('sanitizeSaleOrderHeaderDates', () => {
  it('impede o writer atômico de receber 2026-09-S3 em delivery_deadline', () => {
    const sanitized = sanitizeSaleOrderHeaderDates({
      delivery_deadline: '2026-09-S3',
      delivery_month: '2026-09',
      delivery_week: 'S3',
      original_min_billing_date: '2026-09-S1',
    });

    expect(sanitized.delivery_deadline).toBe('2026-09-14');
    expect(sanitized.original_min_billing_date).toBe('2026-09-01');
    expect(sanitized.billing_week).toBe('2026-09-S3');
  });

  it('preenche deadline a partir do par mês+semana quando o form não derivou', () => {
    const sanitized = sanitizeSaleOrderHeaderDates({
      delivery_deadline: '',
      delivery_month: '2026-09',
      delivery_week: 'S3',
    });
    expect(sanitized.delivery_deadline).toBe('2026-09-14');
    expect(sanitized.billing_week).toBe('2026-09-S3');
  });
});
