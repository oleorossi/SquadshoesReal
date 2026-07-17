/**
 * markupCalc — fonte ÚNICA da fórmula de precificação do Markup
 * (/pricing-calculator: painéis Manual e Por Ficha Técnica).
 *
 * Antes desta lib a fórmula vivia copiada 3× (simulador, reversa e by-sheet);
 * o fix do "à vista min(7, dias)" de 2026-06-14 precisou ser aplicado nos 3
 * lugares. Aqui mora a conta; os painéis só montam entrada e exibem saída.
 *
 * Modelo (markup DIVISOR, percentuais "por dentro" do preço):
 *   preço = custo_total / (1 − (impostos + margem + factoring + comissão) / 100)
 *   margem = % do PREÇO (não do custo); lucro = preço × margem/100.
 *
 * Factoring: juros SIMPLES (taxa a.m. / 30 × dias). O financeiro real
 * (factoringCalc.ts) usa juros COMPOSTOS — divergência conhecida e mantida de
 * propósito (auditoria 2026-06-14; unificar é decisão do dono, muda números).
 */

/** Prazo considerado "à vista" (dias de factoring do preço à vista). */
export const CASH_DAYS = 7;

const fmt2 = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Prazo em dias a partir do texto do campo: "60" → 60; "30/60/90" → média (60).
 * Com parcelas iguais e juros simples, a média das parcelas é matematicamente
 * exata (Σ taxa×dᵢ×preçoᵢ = taxa×média×preço quando os preçoᵢ são iguais).
 */
export function parseDaysInput(input: string): number {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return 0;
  const parts = trimmed
    .split('/')
    .map((s) => parseFloat(s.trim().replace(',', '.')))
    .filter((n) => !isNaN(n) && n > 0);
  if (parts.length === 0) return 0;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
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

/** % efetivo de factoring por juros simples: (taxa a.m. / 30) × dias. */
export function simpleFactoringPct(monthlyRatePct: number, days: number): number {
  return ((monthlyRatePct || 0) / 30) * (days || 0);
}

export interface MarkupInput {
  /** Custo base já somado (MP + MO + overhead + embalagem + frete), R$/par. */
  totalCost: number;
  taxPct: number;
  /** Margem desejada, % do preço. */
  profitPct: number;
  factoringMonthlyPct: number;
  days: number;
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

  // À vista nunca com MAIS dias de factoring que o prazo (senão à vista > a
  // prazo quando o prazo é < CASH_DAYS). Auditoria 2026-06-14.
  const factoringVistaPct = simpleFactoringPct(p.factoringMonthlyPct, Math.min(CASH_DAYS, p.days));
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
  days: number;
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
  overhead: number;
  freight: number;
  taxPct: number;
  factoringMonthlyPct: number;
  days: number;
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
  /** Markup bruto sobre custo total (custo + overhead + frete). */
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
  const totalCost = p.materialCost + p.overhead + p.freight;
  const realProfit = netRevenue - totalCost;
  const realMarginPct = (realProfit / p.soldPrice) * 100;
  const markupPct = totalCost > 0 ? ((p.soldPrice - totalCost) / totalCost) * 100 : 0;

  // À vista com o mesmo lucro em ≤ CASH_DAYS dias; clamp em 0 quando o prejuízo
  // é maior que o custo (preço negativo é nonsense). Auditoria 2026-06-14.
  const factoringVistaPct = simpleFactoringPct(p.factoringMonthlyPct, Math.min(CASH_DAYS, p.days));
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
