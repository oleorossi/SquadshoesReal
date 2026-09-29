/**
 * markupCalc — fonte ÚNICA da fórmula de precificação do Markup
 * (/pricing-calculator: painéis Manual e Por Ficha Técnica).
 *
 * Modelo (markup DIVISOR, percentuais "por dentro" do preço):
 *   preço = custo_total / (1 − (impostos + margem + factoring + comissão) / 100)
 *   margem = % do PREÇO (não do custo); lucro = preço × margem/100.
 *
 * Factoring: desconto LINEAR SIMPLES no prazo médio — espelha o aditivo
 * MALUPE (op. 296, 28/09/2026: face 16.488 → líquido 15.750,50 em 42d):
 *   deságio% = taxa_mês × (prazo_médio_dias / 30)
 * Prazo médio = média dos dias das parcelas (iguais). NÃO usa juros compostos.
 */

/** Prazo considerado "à vista" (dias de factoring do preço à vista). */
export const CASH_DAYS = 3;

const fmt2 = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Prazo em dias a partir do texto do campo: "60" → 60; "30/60/90" → média (60).
 * Com parcelas iguais, a média é o prazo médio usado no deságio linear.
 * O menu não modela parcelas com valores diferentes — regra comercial:
 * as parcelas têm sempre mesmo valor.
 */
export function parseDaysInput(input: string): number {
  const parts = parseDaysInstallments(input);
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

/** Parcelas da condição de pagamento. Cada parcela tem o mesmo valor. */
export function parseDaysInstallments(input: string): number[] {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return [];
  return trimmed
    .split('/')
    .map((s) => parseFloat(s.trim().replace(',', '.')))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Rótulo do prazo pra exibição: "60" → "60d"; "30/60/90" → "30/60/90 (média 60,00d)". */
export function formatDaysLabel(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return '0d';
  const parts = trimmed
    .split('/')
    .map((s) => parseFloat(s.trim().replace(',', '.')))
    .filter((n) => !isNaN(n) && n > 0);
  if (parts.length <= 1) return `${parts[0] || 0}d`;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return `${trimmed} (média ${fmt2(avg)}d)`;
}

/** Prazo médio em dias a partir de um número ou lista de parcelas. */
export function averageDays(days: number | number[]): number {
  const installments = (Array.isArray(days) ? days : [days])
    .map((day) => Math.max(0, Number(day) || 0))
    .filter((day) => day > 0);
  if (installments.length === 0) return 0;
  return installments.reduce((a, b) => a + b, 0) / installments.length;
}

/**
 * Percentual efetivo de deságio por factoring LINEAR (juros simples).
 * deságio% = taxa_mês × (prazo_médio / 30)
 *
 * Calibrado no aditivo MALUPE: face 16.488, prazo médio 42d, taxa ≈ 3,195% a.m.
 * → líquido 15.750,50.
 */
export function simpleFactoringPct(monthlyRatePct: number, days: number | number[]): number {
  const monthlyRate = Math.max(0, Number(monthlyRatePct) || 0);
  const avg = averageDays(days);
  if (monthlyRate <= 0 || avg <= 0) return 0;
  return monthlyRate * (avg / 30);
}

/** @deprecated use simpleFactoringPct — alias mantido só enquanto testes/imports migram. */
export const compoundFactoringPct = simpleFactoringPct;

export interface MarkupInput {
  /** Custo base já somado (MP + MO + overhead + embalagem + frete), R$/par. */
  totalCost: number;
  taxPct: number;
  /** Margem desejada, % do preço. */
  profitPct: number;
  factoringMonthlyPct: number;
  days: number | number[];
  commissionPct: number;
}

export interface MarkupOutput {
  /** false quando a soma das taxas ≥ 100% (divisor ≤ 0 — impossível precificar). */
  isValid: boolean;
  suggestedPrice: number;
  /** Preço com o MESMO custo/margem mas factoring de no máx. CASH_DAYS dias. */
  cashPrice: number;
  factoringTotalPct: number;
  totalMarkupPct: number;
  markupDivisor: number;
  taxValue: number;
  factoringValue: number;
  commissionValue: number;
  realProfit: number;
}

/** Fórmula direta do simulador: custo + parâmetros → preço sugerido. */
export function computeMarkupPrice(p: MarkupInput): MarkupOutput {
  const factoringTotalPct = simpleFactoringPct(p.factoringMonthlyPct, p.days);
  const totalMarkupPct = p.taxPct + p.profitPct + factoringTotalPct + p.commissionPct;
  const markupDivisor = 1 - totalMarkupPct / 100;
  const isValid = markupDivisor > 0;
  const suggestedPrice = isValid ? p.totalCost / markupDivisor : 0;

  // À vista: factoring com min(CASH_DAYS, prazo médio). Nunca mais dias que o
  // próprio prazo (senão à vista > a prazo quando prazo < CASH_DAYS).
  const cashAvgDays = Math.min(CASH_DAYS, averageDays(p.days));
  const factoringVistaPct = simpleFactoringPct(p.factoringMonthlyPct, cashAvgDays);
  const markupVistaDivisor = 1 - (p.taxPct + p.profitPct + factoringVistaPct + p.commissionPct) / 100;
  const cashPrice = isValid && markupVistaDivisor > 0 ? p.totalCost / markupVistaDivisor : 0;

  return {
    isValid,
    suggestedPrice,
    cashPrice,
    factoringTotalPct,
    totalMarkupPct,
    markupDivisor,
    taxValue: suggestedPrice * (p.taxPct / 100),
    factoringValue: suggestedPrice * (factoringTotalPct / 100),
    commissionValue: suggestedPrice * (p.commissionPct / 100),
    realProfit: suggestedPrice * (p.profitPct / 100),
  };
}

export interface TargetProfitInput {
  totalCost: number;
  taxPct: number;
  factoringMonthlyPct: number;
  days: number | number[];
  commissionPct: number;
  /** "Quero receber R$ X líquido por par" (após impostos, factoring e comissão). */
  targetProfitBrl: number;
}

/**
 * Modo inverso: deriva a margem % equivalente a um lucro-alvo em R$/par.
 *
 * Álgebra: preço = (custo + lucro_alvo) / (1 − K/100), com K = impostos +
 * factoring + comissão (SEM margem); margem % = lucro_alvo / preço × 100.
 * Reaplicar essa margem na fórmula direta devolve o MESMO preço (travado em teste).
 *
 * Retorna null quando não dá pra derivar (alvo ≤ 0 ou K ≥ 100%) — caller usa a
 * margem digitada manualmente.
 */
export function deriveMarginFromTargetProfit(p: TargetProfitInput): number | null {
  if (!(p.targetProfitBrl > 0)) return null;
  const nonMarginPct = p.taxPct + simpleFactoringPct(p.factoringMonthlyPct, p.days) + p.commissionPct;
  const denom = 1 - nonMarginPct / 100;
  if (denom <= 0) return null;
  const derivedPrice = (p.totalCost + p.targetProfitBrl) / denom;
  return derivedPrice > 0 ? (p.targetProfitBrl / derivedPrice) * 100 : 0;
}

export interface ReverseInput {
  /** Preço efetivamente praticado na venda, R$/par. */
  soldPrice: number;
  /** Custo de matéria-prima, R$/par. */
  materialCost: number;
  /** Mão de obra direta, R$/par. */
  labor: number;
  overhead: number;
  /** Embalagem adicional fora do BOM, R$/par. */
  packaging: number;
  freight: number;
  taxPct: number;
  factoringMonthlyPct: number;
  days: number | number[];
  commissionPct: number;
}

export interface ReverseOutput {
  taxValue: number;
  factoringValue: number;
  commissionValue: number;
  factoringTotalPct: number;
  netRevenue: number;
  totalCost: number;
  realProfit: number;
  /** Margem líquida real, % do preço praticado (negativa em prejuízo). */
  realMarginPct: number;
  /** Markup bruto sobre custo total. */
  markupPct: number;
  /** Preço que entrega o MESMO lucro se o cliente pagar em CASH_DAYS dias. */
  cashPrice: number;
  /** Preço pela fórmula direta usando a margem real encontrada (clamp ≥ 0). */
  suggestedPrice: number;
  totalMarkupPct: number;
  suggestedMarkupPct: number;
}

/** Análise reversa: preço praticado → margem líquida real. Inverso exato da direta. */
export function computeReverseAnalysis(p: ReverseInput): ReverseOutput | null {
  if (!(p.soldPrice > 0) || !(p.materialCost > 0)) return null;

  const factoringTotalPct = simpleFactoringPct(p.factoringMonthlyPct, p.days);
  const taxValue = p.soldPrice * (p.taxPct / 100);
  const factoringValue = p.soldPrice * (factoringTotalPct / 100);
  const commissionValue = p.soldPrice * (p.commissionPct / 100);
  const netRevenue = p.soldPrice - taxValue - factoringValue - commissionValue;
  const totalCost = p.materialCost + p.labor + p.overhead + p.packaging + p.freight;
  const realProfit = netRevenue - totalCost;
  const realMarginPct = (realProfit / p.soldPrice) * 100;
  const markupPct = totalCost > 0 ? ((p.soldPrice - totalCost) / totalCost) * 100 : 0;

  const cashAvgDays = Math.min(CASH_DAYS, averageDays(p.days));
  const factoringVistaPct = simpleFactoringPct(p.factoringMonthlyPct, cashAvgDays);
  const cashDivisor = 1 - (p.taxPct + factoringVistaPct + p.commissionPct) / 100;
  const cashPrice = cashDivisor > 0 ? Math.max(0, (totalCost + realProfit) / cashDivisor) : 0;

  const totalMarkupPct = p.taxPct + realMarginPct + factoringTotalPct + p.commissionPct;
  const suggestedMarkupPct = p.taxPct + Math.max(0, realMarginPct) + factoringTotalPct + p.commissionPct;
  const suggestedDivisor = 1 - suggestedMarkupPct / 100;
  const suggestedPrice = suggestedDivisor > 0 ? totalCost / suggestedDivisor : 0;

  return {
    taxValue,
    factoringValue,
    commissionValue,
    factoringTotalPct,
    netRevenue,
    totalCost,
    realProfit,
    realMarginPct,
    markupPct,
    cashPrice,
    suggestedPrice,
    totalMarkupPct,
    suggestedMarkupPct,
  };
}
