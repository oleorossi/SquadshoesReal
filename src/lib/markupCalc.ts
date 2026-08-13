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
 * Factoring: desconto composto, igual ao motor financeiro (`factoringCalc.ts`):
 *   desconto = 1 − 1 / (1 + taxa_mensal) ^ (dias / 30)
 * Isso mantém a precificação alinhada ao valor líquido que será recebido.
 */

/** Prazo considerado "à vista" (dias de factoring do preço à vista). */
export const CASH_DAYS = 7;

const fmt2 = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Prazo em dias a partir do texto do campo: "60" → 60; "30/60/90" → média (60).
 * Com parcelas iguais, a média representa o prazo médio de recebimento usado
 * na simulação de desconto composto. O menu não modela parcelas com valores
 * diferentes — regra comercial confirmada: as parcelas têm sempre mesmo valor.
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

/**
 * Percentual efetivo de desconto por factoring composto. Espelha
 * `calculateFactoringDiscount`: PV = FV / (1 + i) ^ (dias / 30).
 */
export function compoundFactoringPct(monthlyRatePct: number, days: number | number[]): number {
  const monthlyRate = Math.max(0, Number(monthlyRatePct) || 0) / 100;
  const installments = (Array.isArray(days) ? days : [days])
    .map((day) => Math.max(0, Number(day) || 0))
    .filter((day) => day > 0);
  if (monthlyRate <= 0 || installments.length === 0) return 0;
  // Cada parcela tem o mesmo valor: o desconto efetivo é a média dos PVs,
  // nunca o desconto composto aplicado ao prazo médio.
  const presentValueFactor = installments.reduce(
    (sum, day) => sum + 1 / Math.pow(1 + monthlyRate, day / 30), 0,
  ) / installments.length;
  return (1 - presentValueFactor) * 100;
}

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
  const factoringTotalPct = compoundFactoringPct(p.factoringMonthlyPct, p.days);
  const totalMarkupPct = p.taxPct + p.profitPct + factoringTotalPct + p.commissionPct;
  const markupDivisor = 1 - totalMarkupPct / 100;
  const isValid = markupDivisor > 0;
  const suggestedPrice = isValid ? p.totalCost / markupDivisor : 0;

  // À vista nunca com MAIS dias de factoring que o prazo (senão à vista > a
  // prazo quando o prazo é < CASH_DAYS). Auditoria 2026-06-14.
  const cashDays = (Array.isArray(p.days) ? p.days : [p.days]).map((day) => Math.min(CASH_DAYS, day));
  const factoringVistaPct = compoundFactoringPct(p.factoringMonthlyPct, cashDays);
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
  const nonMarginPct = p.taxPct + compoundFactoringPct(p.factoringMonthlyPct, p.days) + p.commissionPct;
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

  const factoringTotalPct = compoundFactoringPct(p.factoringMonthlyPct, p.days);
  const taxValue = p.soldPrice * (p.taxPct / 100);
  const factoringValue = p.soldPrice * (factoringTotalPct / 100);
  const commissionValue = p.soldPrice * (p.commissionPct / 100);
  const netRevenue = p.soldPrice - taxValue - factoringValue - commissionValue;
  const totalCost = p.materialCost + p.labor + p.overhead + p.packaging + p.freight;
  const realProfit = netRevenue - totalCost;
  const realMarginPct = (realProfit / p.soldPrice) * 100;
  const markupPct = totalCost > 0 ? ((p.soldPrice - totalCost) / totalCost) * 100 : 0;

  // À vista com o mesmo lucro em ≤ CASH_DAYS dias; clamp em 0 quando o prejuízo
  // é maior que o custo (preço negativo é nonsense). Auditoria 2026-06-14.
  const cashDays = (Array.isArray(p.days) ? p.days : [p.days]).map((day) => Math.min(CASH_DAYS, day));
  const factoringVistaPct = compoundFactoringPct(p.factoringMonthlyPct, cashDays);
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
