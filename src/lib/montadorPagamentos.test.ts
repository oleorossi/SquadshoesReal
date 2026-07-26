import { describe, expect, it } from 'vitest';
import {
  buildPagamentoRows, EPS, rangesOverlap, runOverlapsRange, statusPagamento,
  type RunResumo,
} from './montadorPagamentos';
import type { ProducaoAgg } from './montadorProduction';

const agg = (bruto: number, medio = 0, dificil = 0): ProducaoAgg => ({
  paresMedio: medio, paresDificil: dificil, pares: medio + dificil, bruto,
});
const run = (over: Partial<RunResumo> = {}): RunResumo => ({
  id: 'r1', period: '2026-07-01_2026-07-15', status: 'aprovado', total_liquido: 0, exactPeriod: true, ...over,
});

describe('rangesOverlap', () => {
  it('sobrepõe quando há interseção (inclusive borda)', () => {
    expect(rangesOverlap('2026-07-01', '2026-07-15', '2026-07-15', '2026-07-31')).toBe(true);
    expect(rangesOverlap('2026-07-01', '2026-07-31', '2026-07-10', '2026-07-12')).toBe(true);
  });
  it('não sobrepõe intervalos disjuntos ou vazios', () => {
    expect(rangesOverlap('2026-07-01', '2026-07-15', '2026-07-16', '2026-07-31')).toBe(false);
    expect(rangesOverlap('', '2026-07-15', '2026-07-01', '2026-07-31')).toBe(false);
  });
});

describe('runOverlapsRange', () => {
  it('run mensal sobrepõe filtro quinzenal do mesmo mês', () => {
    expect(runOverlapsRange('2026-07', '2026-07-01', '2026-07-15')).toBe(true);
  });
  it('run quinzenal exata sobrepõe o próprio intervalo', () => {
    expect(runOverlapsRange('2026-07-01_2026-07-15', '2026-07-01', '2026-07-15')).toBe(true);
  });
  it('run de mês vizinho não sobrepõe', () => {
    expect(runOverlapsRange('2026-06', '2026-07-01', '2026-07-15')).toBe(false);
    expect(runOverlapsRange('2026-06-16_2026-06-30', '2026-07-01', '2026-07-15')).toBe(false);
  });
  it('period malformado nunca sobrepõe', () => {
    expect(runOverlapsRange('lixo', '2026-07-01', '2026-07-15')).toBe(false);
    expect(runOverlapsRange('', '2026-07-01', '2026-07-15')).toBe(false);
  });
});

describe('statusPagamento', () => {
  it('pendente quando nada pago (inclusive resíduo de float)', () => {
    expect(statusPagamento(500, 0)).toBe('pendente');
    expect(statusPagamento(500, EPS)).toBe('pendente');
  });
  it('pago quando quita (borda de EPS) ou paga além', () => {
    expect(statusPagamento(500, 500)).toBe('pago');
    expect(statusPagamento(500, 500 - EPS)).toBe('pago');
    expect(statusPagamento(500, 600)).toBe('pago');
  });
  it('parcial no meio', () => {
    expect(statusPagamento(500, 200)).toBe('parcial');
    expect(statusPagamento(500, 499.98)).toBe('parcial');
  });
});

describe('buildPagamentoRows', () => {
  const montadores = [
    { id: 'a', name: 'Antonio' },
    { id: 'b', name: 'Bruna' },
    { id: 'c', name: 'Caio' },
  ];

  it('monta linhas com saldo/status e ordena por produzido desc', () => {
    const rows = buildPagamentoRows({
      montadores,
      producao: new Map([
        ['a', agg(300, 100, 20)],
        ['b', agg(900, 300, 0)],
      ]),
      pagoByEmployee: new Map([
        ['a', { paidTotal: 300, runs: [run({ total_liquido: 300 })] }],
        ['b', { paidTotal: 400, runs: [run({ total_liquido: 900 })] }],
      ]),
    });
    expect(rows.map((r) => r.employeeId)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ produzido: 900, pago: 400, saldo: 500, status: 'parcial' });
    expect(rows[1]).toMatchObject({ produzido: 300, pago: 300, saldo: 0, status: 'pago' });
  });

  it('exclui montador sem produção E sem pagamento; inclui pago sem produção', () => {
    const rows = buildPagamentoRows({
      montadores,
      producao: new Map([['a', agg(100)]]),
      pagoByEmployee: new Map([['c', { paidTotal: 50, runs: [run()] }]]),
    });
    expect(rows.map((r) => r.employeeId).sort()).toEqual(['a', 'c']);
    const caio = rows.find((r) => r.employeeId === 'c')!;
    expect(caio).toMatchObject({ produzido: 0, pago: 50, saldo: -50, status: 'pago' });
  });

  it('pago > produzido → saldo negativo com status pago', () => {
    const rows = buildPagamentoRows({
      montadores,
      producao: new Map([['a', agg(200)]]),
      pagoByEmployee: new Map([['a', { paidTotal: 250, runs: [run()] }]]),
    });
    expect(rows[0].saldo).toBeCloseTo(-50);
    expect(rows[0].status).toBe('pago');
  });

  it('divergência SÓ com run exata aprovada/paga de valor travado ≠ produzido', () => {
    const mk = (r: RunResumo, produzido = 500) => buildPagamentoRows({
      montadores: [{ id: 'a', name: 'A' }],
      producao: new Map([['a', agg(produzido)]]),
      pagoByEmployee: new Map([['a', { paidTotal: 10, runs: [r] }]]),
    })[0];
    expect(mk(run({ total_liquido: 480, status: 'aprovado' })).divergencia).toBe(true);
    expect(mk(run({ total_liquido: 500, status: 'pago' })).divergencia).toBe(false);
    // rascunho ainda recalculável → sem alerta
    expect(mk(run({ total_liquido: 480, status: 'rascunho' })).divergencia).toBe(false);
    // run de período diferente (mensal × filtro quinzenal) não compara valor
    expect(mk(run({ total_liquido: 9999, exactPeriod: false })).divergencia).toBe(false);
  });
});
