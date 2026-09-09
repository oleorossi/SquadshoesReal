/**
 * Trava o recorte de período da baixa de vales (D15, auditoria RH 2026-07-29).
 *
 * O bug original baixava todos os vales do funcionário sem filtro de data. A
 * baixa externa atual precisa continuar limitada à competência escolhida para
 * não retirar da folha um vale lançado para o mês seguinte.
 *
 * O intervalo é MEIO-ABERTO de propósito: montar o último dia do mês por string
 * ('YYYY-MM-31') produziria data inválida em fevereiro e em meses de 30 dias.
 */
import { describe, it, expect } from 'vitest';
import { periodDateRange } from '../useEmployees';

describe('periodDateRange — recorte da baixa externa de vales', () => {
  it('mês comum devolve [1º do mês, 1º do mês seguinte)', () => {
    expect(periodDateRange('2026-08')).toEqual({ from: '2026-08-01', before: '2026-09-01' });
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(periodDateRange('2026-12')).toEqual({ from: '2026-12-01', before: '2027-01-01' });
  });

  it('fevereiro nunca produz data inexistente (o motivo do intervalo meio-aberto)', () => {
    const r = periodDateRange('2026-02');
    expect(r).toEqual({ from: '2026-02-01', before: '2026-03-01' });
    // 2026 não é bissexto: '2026-02-29' e '2026-02-31' não existem, e o formato
    // meio-aberto evita ter que saber disso.
    expect(r.before).not.toMatch(/-02-3\d$/);
  });

  it('mês de 30 dias fecha no 1º do seguinte, não no dia 31', () => {
    expect(periodDateRange('2026-04').before).toBe('2026-05-01');
    expect(periodDateRange('2026-11').before).toBe('2026-12-01');
  });

  it('mantém zero à esquerda no mês', () => {
    expect(periodDateRange('2026-01')).toEqual({ from: '2026-01-01', before: '2026-02-01' });
    expect(periodDateRange('2026-09').before).toBe('2026-10-01');
  });

  it('o intervalo cobre o mês inteiro e exclui o vizinho — o que separa vale do mês do vale futuro', () => {
    const { from, before } = periodDateRange('2026-07');
    const dentroInicio = '2026-07-01';
    const dentroFim = '2026-07-31';
    const foraFuturo = '2026-08-01';   // o vale que NÃO pode ser baixado junto
    const foraPassado = '2026-06-30';
    expect(dentroInicio >= from && dentroInicio < before).toBe(true);
    expect(dentroFim >= from && dentroFim < before).toBe(true);
    expect(foraFuturo >= from && foraFuturo < before).toBe(false);
    expect(foraPassado >= from && foraPassado < before).toBe(false);
  });
});
