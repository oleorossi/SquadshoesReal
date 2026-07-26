// ─────────────────────────────────────────────────────────────────────────────
// Relatório de PAGAMENTO POR PRODUÇÃO da Ficha de Montadores — lógica pura.
//
// Cruza o PRODUZIDO (ficha_montadores via sumProducaoRows/aggregateProducaoByMontador
// — snapshot R$/par por linha, MESMA fórmula da folha) com o JÁ PAGO
// (payroll_payments das payroll_runs cujo PERÍODO sobrepõe o intervalo filtrado).
//
// Decisão de produto: o pagamento conta pela sobreposição do PERÍODO DA RUN com o
// filtro (não pela data do pagamento) — responde "quanto já paguei pela produção
// desse período". Run mensal × filtro quinzenal conta INTEIRA e a UI sinaliza com
// exactPeriod=false ("período difere").
// ─────────────────────────────────────────────────────────────────────────────

import type { ProducaoAgg } from '@/lib/montadorProduction';
import { periodToRange } from '@/lib/payrollPeriod';

export type StatusPagamento = 'pendente' | 'parcial' | 'pago';

/** Tolerância de centavos pra comparação de R$ (evita parcial fantasma por float). */
export const EPS = 0.005;

/** Intervalos ISO fechados [aFrom,aTo] × [bFrom,bTo] se sobrepõem? */
export function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  if (!aFrom || !aTo || !bFrom || !bTo) return false;
  return aFrom <= bTo && bFrom <= aTo;
}

/** A run (period 'YYYY-MM' ou 'from_to') sobrepõe o intervalo filtrado? */
export function runOverlapsRange(runPeriod: string, from: string, to: string): boolean {
  const r = periodToRange(String(runPeriod || ''));
  if (!r.from || !r.to) return false; // period malformado nunca sobrepõe
  return rangesOverlap(r.from, r.to, from, to);
}

export interface RunResumo {
  id: string;
  period: string;
  status: string;
  total_liquido: number;
  /** true quando o period da run é EXATAMENTE o intervalo filtrado. */
  exactPeriod: boolean;
}

export interface PagamentoMontadorRow {
  employeeId: string;
  nome: string;
  paresMedio: number;
  paresDificil: number;
  pares: number;
  /** R$ bruto da produção no período (snapshot — ProducaoAgg.bruto). */
  produzido: number;
  /** Σ payroll_payments das runs sobrepostas ao período. */
  pago: number;
  /** produzido − pago (negativo = pagou além do produzido do filtro). */
  saldo: number;
  status: StatusPagamento;
  /** Runs sobrepostas (badges/tooltip na UI). */
  runs: RunResumo[];
  /** Run aprovada/paga de período exato com valor travado ≠ produzido atual. */
  divergencia: boolean;
}

export function statusPagamento(produzido: number, pago: number): StatusPagamento {
  if (pago <= EPS) return 'pendente';
  if (produzido - pago <= EPS) return 'pago';
  return 'parcial';
}

export function buildPagamentoRows(args: {
  montadores: { id: string; name: string }[];
  producao: Map<string, ProducaoAgg>;
  pagoByEmployee: Map<string, { paidTotal: number; runs: RunResumo[] }>;
}): PagamentoMontadorRow[] {
  const { montadores, producao, pagoByEmployee } = args;
  const rows: PagamentoMontadorRow[] = [];
  for (const m of montadores) {
    const p = producao.get(m.id);
    const pg = pagoByEmployee.get(m.id);
    const produzido = p?.bruto || 0;
    const pago = pg?.paidTotal || 0;
    if (produzido <= 0 && pago <= 0) continue; // sem produção nem pagamento no período
    const runs = pg?.runs || [];
    const divergencia = runs.some(
      (r) => r.exactPeriod
        && (r.status === 'aprovado' || r.status === 'pago')
        && Math.abs((Number(r.total_liquido) || 0) - produzido) > EPS,
    );
    rows.push({
      employeeId: m.id,
      nome: m.name,
      paresMedio: p?.paresMedio || 0,
      paresDificil: p?.paresDificil || 0,
      pares: p?.pares || 0,
      produzido,
      pago,
      saldo: produzido - pago,
      status: statusPagamento(produzido, pago),
      runs,
      divergencia,
    });
  }
  return rows.sort((a, b) => b.produzido - a.produzido);
}
