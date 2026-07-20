import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, CurrencyDollar as DollarSign, Percent, TrendUp as TrendingUp, Warning as AlertTriangle, ChartBar as BarChart3, Truck, UserCheck, Buildings as Building2, ArrowsLeftRight as ArrowRightLeft } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from 'recharts';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';
import {
  parseDaysInput, formatDaysLabel, computeMarkupPrice,
  deriveMarginFromTargetProfit, computeReverseAnalysis,
} from '@/lib/markupCalc';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Pílula de saúde da margem real: verde ≥15% · âmbar 8–15% · vermelho <8%/negativa.
 *  Cores por token (hsl(var(--success/warning/destructive))) → adapta ao tema. */
function MarginHealthPill({ pct }: { pct: number }) {
  const token = pct >= 15 ? 'var(--success)' : pct >= 8 ? 'var(--warning)' : 'var(--destructive)';
  const label = pct >= 15 ? 'Saudável' : pct >= 8 ? 'Apertada' : 'Crítica';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wide"
      style={{ background: `hsl(${token} / 0.2)`, color: `hsl(${token})` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${token})` }} />
      {fmt(pct)}% {label}
    </span>
  );
}

const STORAGE_KEY = 'pricing-calculator-state';

function loadSaved(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default function PricingCalculatorPanel() {
  const { data: costPolicy } = useCostPolicies();
  const saved = useMemo(() => loadSaved(), []);

  // Overhead from cost_policies
  const policyOverhead = useMemo(() => {
    if (!costPolicy) return 0;
    const target = costPolicy.monthly_production_target || 1;
    return (costPolicy.overhead_monthly_total || 0) / target;
  }, [costPolicy]);

  // Simulator state
  const [cost, setCost] = useState(saved.cost ?? '');
  const [taxPct, setTaxPct] = useState(saved.taxPct ?? '');
  const [factoringRatePct, setFactoringRatePct] = useState(saved.factoringRatePct ?? '');
  const [days, setDays] = useState(saved.days ?? '');
  const [profitMarginPct, setProfitMarginPct] = useState(saved.profitMarginPct ?? '');
  // Modo inverso (auditoria 24/05/2026): em vez de digitar margem % e ver
  // preço, user digita "quero receber R$ X líquido por par" e o sistema
  // calcula a margem % equivalente + o preço de venda necessário. Útil
  // pra vendedor que pensa em "lucro real por par" em vez de %.
  const [targetProfitBrl, setTargetProfitBrl] = useState<string>(saved.targetProfitBrl ?? '');
  const [commissionPct, setCommissionPct] = useState(saved.commissionPct ?? '');
  const [freightValue, setFreightValue] = useState(saved.freightValue ?? '');
  const [overheadManual, setOverheadManual] = useState(saved.overheadManual ?? '');

  // Reverse state
  const [soldPrice, setSoldPrice] = useState(saved.soldPrice ?? '');
  const [reverseCost, setReverseCost] = useState(saved.reverseCost ?? '');
  const [reverseTaxPct, setReverseTaxPct] = useState(saved.reverseTaxPct ?? '');
  const [reverseFactoringPct, setReverseFactoringPct] = useState(saved.reverseFactoringPct ?? '');
  const [reverseDays, setReverseDays] = useState(saved.reverseDays ?? '');
  const [reverseCommissionPct, setReverseCommissionPct] = useState(saved.reverseCommissionPct ?? '');
  const [reverseFreightValue, setReverseFreightValue] = useState(saved.reverseFreightValue ?? '');
  const [reverseOverheadManual, setReverseOverheadManual] = useState(saved.reverseOverheadManual ?? '');

  // Persist all fields to localStorage on change
  useEffect(() => {
    const state: Record<string, string> = {
      cost, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual,
      soldPrice, reverseCost, reverseTaxPct, reverseFactoringPct, reverseDays, reverseCommissionPct, reverseFreightValue, reverseOverheadManual,
      targetProfitBrl,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [cost, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual,
      soldPrice, reverseCost, reverseTaxPct, reverseFactoringPct, reverseDays, reverseCommissionPct, reverseFreightValue, reverseOverheadManual,
      targetProfitBrl]);

  // Rateio de despesas: SÓ entra no cálculo se o usuário digitar. Campo vazio
  // (ou zerado) = sem rateio. Antes caía silenciosamente no valor da política
  // (`policyOverhead`), então uma simulação "sem rateio" saía descontando
  // R$ X/par que o usuário nunca preencheu. A política virou sugestão
  // clicável ("Aplicar política") em vez de fallback automático.
  const getOverhead = (manual: string) => parseBrlNumberNonNeg(manual);

  const copySimulatorToReverse = () => {
    setReverseCost(cost);
    setReverseTaxPct(taxPct);
    setReverseFactoringPct(factoringRatePct);
    setReverseDays(days);
    setReverseCommissionPct(commissionPct);
    setReverseFreightValue(freightValue);
    setReverseOverheadManual(overheadManual);
    if (results.isValid && results.suggestedPrice > 0) {
      // toFixed (ponto decimal), NUNCA fmt(): "1.234,56" num estado numérico é
      // relido como 1.234 (bug parseNum BRL) e é rejeitado pelo input type=number.
      setSoldPrice(results.suggestedPrice.toFixed(2));
    }
  };

  const copyReverseToSimulator = () => {
    setCost(reverseCost);
    setTaxPct(reverseTaxPct);
    setFactoringRatePct(reverseFactoringPct);
    setDays(reverseDays);
    setCommissionPct(reverseCommissionPct);
    setFreightValue(reverseFreightValue);
    setOverheadManual(reverseOverheadManual);
    setProfitMarginPct('');
  };

  // Fórmula (markup divisor, à vista, modo inverso e reversa) mora em
  // src/lib/markupCalc.ts — fonte única, travada por markupCalc.test.ts.
  // Parse de campos com parseBrlNumberNonNeg (NUNCA parseFloat cru — auditoria
  // 2026-06-14: "2.500,00" virava 2,5).
  const results = useMemo(() => {
    const numCost = parseBrlNumberNonNeg(cost);
    const numTax = parseBrlNumberNonNeg(taxPct);
    const numFactoring = parseBrlNumberNonNeg(factoringRatePct);
    const numDays = parseDaysInput(days);
    const numCommission = parseBrlNumberNonNeg(commissionPct);
    const numFreight = parseBrlNumberNonNeg(freightValue);
    const numOverhead = getOverhead(overheadManual);

    // custo_base = custo_materia_prima + (despesas_fixas / capacidade) + frete
    const totalCost = numCost + numOverhead + numFreight;

    // Modo inverso "quero receber R$ X líquido": deriva a margem % equivalente;
    // null (sem alvo ou taxas ≥ 100%) → usa a margem digitada.
    const derivedMargin = deriveMarginFromTargetProfit({
      totalCost, taxPct: numTax, factoringMonthlyPct: numFactoring,
      days: numDays, commissionPct: numCommission,
      targetProfitBrl: parseBrlNumberNonNeg(targetProfitBrl),
    });
    const numProfit = derivedMargin ?? parseBrlNumberNonNeg(profitMarginPct);

    const calc = computeMarkupPrice({
      totalCost, taxPct: numTax, profitPct: numProfit,
      factoringMonthlyPct: numFactoring, days: numDays, commissionPct: numCommission,
    });

    return { ...calc, numCost, numFreight, numOverhead, totalCost, derivedMarginPct: derivedMargin };
  }, [cost, taxPct, factoringRatePct, days, profitMarginPct, targetProfitBrl, commissionPct, freightValue, overheadManual, policyOverhead]);

  const reverseResults = useMemo(() => {
    const numFreight = parseBrlNumberNonNeg(reverseFreightValue);
    const numOverhead = getOverhead(reverseOverheadManual);
    const numSold = parseBrlNumberNonNeg(soldPrice);
    const numReverseCost = parseBrlNumberNonNeg(reverseCost);
    const rev = computeReverseAnalysis({
      soldPrice: numSold,
      materialCost: numReverseCost,
      overhead: numOverhead,
      freight: numFreight,
      taxPct: parseBrlNumberNonNeg(reverseTaxPct),
      factoringMonthlyPct: parseBrlNumberNonNeg(reverseFactoringPct),
      days: parseDaysInput(reverseDays),
      commissionPct: parseBrlNumberNonNeg(reverseCommissionPct),
    });
    if (!rev) return null;
    return { ...rev, numSold, numReverseCost, numFreight, numOverhead };
  }, [soldPrice, reverseCost, reverseTaxPct, reverseFactoringPct, reverseDays, reverseCommissionPct, reverseFreightValue, reverseOverheadManual, policyOverhead]);

  // Chart data for reverse calculator
  const reverseBarData = useMemo(() => {
    if (!reverseResults) return [];
    return [
      { name: 'Preço Venda', valor: reverseResults.numSold },
      { name: 'Impostos', valor: -reverseResults.taxValue },
      { name: 'Antecipação', valor: -reverseResults.factoringValue },
      { name: 'Comissão', valor: -reverseResults.commissionValue },
      { name: 'Frete', valor: -reverseResults.numFreight },
      { name: 'Rateio', valor: -reverseResults.numOverhead },
      { name: 'Custo MP', valor: -reverseResults.numReverseCost },
      { name: 'Lucro Real', valor: reverseResults.realProfit },
    ].filter(d => d.valor !== 0);
  }, [reverseResults]);

  return (
    <div className="space-y-6">
      {/* ── SIMULADOR ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Calculator className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Simulador de Preço</CardTitle>
                <CardDescription>Markup Divisor com rateio de despesas, antecipação, comissão e frete</CardDescription>
              </div>
            </div>
            <TooltipProvider>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={copySimulatorToReverse} className="gap-1.5">
                    <ArrowRightLeft className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs">Enviar p/ Reversa</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copiar dados para a Calculadora Reversa</TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label htmlFor="cost" className="text-xs">Custo MP (R$)</Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="cost" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0,00" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Matéria-prima</p>
            </div>
            <div>
              <Label htmlFor="tax" className="text-xs">Impostos (%)</Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="tax" type="number" step="0.01" min="0" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0" />
              </div>
            </div>
            <div>
              <Label htmlFor="factoring" className="text-xs">Factoring (a.m.%)</Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="factoring" type="number" step="0.01" min="0" value={factoringRatePct} onChange={(e) => setFactoringRatePct(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0" />
              </div>
            </div>
            <div>
              <Label htmlFor="days" className="text-xs">Prazo (Dias)</Label>
              <Input id="days" type="text" value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 h-9 text-sm" placeholder="60 ou 30/60/90" />
              {days.includes('/') && <p className="text-xs text-muted-foreground mt-1">Média: {fmt(parseDaysInput(days))} dias</p>}
            </div>
            <div>
              <Label htmlFor="profit" className="text-xs">
                Margem (%)
                {results.derivedMarginPct !== null && (
                  <span className="ml-1 text-[10px] font-mono text-success">
                    auto · {fmt(results.derivedMarginPct)}%
                  </span>
                )}
              </Label>
              <div className="relative mt-1">
                <TrendingUp className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="profit"
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    results.derivedMarginPct !== null
                      // toFixed (ponto): fmt() com vírgula é rejeitado pelo input
                      // type=number e o campo renderizava VAZIO no modo auto.
                      ? results.derivedMarginPct.toFixed(2)
                      : profitMarginPct
                  }
                  onChange={(e) => {
                    setProfitMarginPct(e.target.value);
                    setTargetProfitBrl(''); // user editou margem → desativa modo inverso
                  }}
                  disabled={results.derivedMarginPct !== null}
                  className="pl-8 h-9 text-sm font-semibold disabled:opacity-60 disabled:bg-muted/40"
                  placeholder="0"
                />
              </div>
              {results.derivedMarginPct !== null && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Derivado do "quero receber" abaixo
                </p>
              )}
            </div>
          </div>

          {/* ── Modo inverso (auditoria 24/05/2026) ── */}
          {/* Em vez de digitar margem %, user digita "quero receber R$ X
              líquido por par". Sistema calcula:
                margem % (em cima — preenche o campo de margem)
                preço de venda necessário (em baixo — exibido no painel
                de resultados que já existe). */}
          <div className="rounded-lg border-[1.5px] border-dashed border-foreground/20 bg-muted/20 p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <Label htmlFor="targetProfit" className="text-xs font-bold uppercase tracking-wide">
                Quero receber líquido (R$/par)
              </Label>
              {targetProfitBrl && (
                <button
                  type="button"
                  onClick={() => setTargetProfitBrl('')}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="targetProfit"
                  type="number"
                  step="0.01"
                  min="0"
                  value={targetProfitBrl}
                  onChange={(e) => setTargetProfitBrl(e.target.value)}
                  className="pl-8 h-10 text-base font-semibold"
                  placeholder="ex: 10,00"
                />
              </div>
              <p className="text-xs text-muted-foreground leading-tight">
                Digite o valor que quer embolsar por par (após impostos, factoring
                e comissão). O sistema calcula a margem % equivalente e o preço
                de venda necessário pra obter esse líquido.
              </p>
            </div>
            {results.derivedMarginPct !== null && results.suggestedPrice > 0 && (
              <div className="mt-3 pt-3 border-t border-foreground/10 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">↑ Margem calculada</p>
                  <p className="text-lg font-bold text-success tabular-nums">
                    {fmt(results.derivedMarginPct)}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">↓ Preço de venda</p>
                  <p className="text-lg font-bold text-primary tabular-nums">
                    R$ {fmt(results.suggestedPrice)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Overhead, Commission & Freight */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="overhead" className="text-xs flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                Rateio Despesas (R$/par)
              </Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="overhead" type="number" step="0.01" min="0" value={overheadManual} onChange={(e) => setOverheadManual(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0,00" />
              </div>
              {policyOverhead > 0 ? (
                <button
                  type="button"
                  onClick={() => setOverheadManual(policyOverhead.toFixed(2))}
                  className="text-xs text-muted-foreground mt-1 underline underline-offset-2 hover:text-foreground"
                >
                  Aplicar política: R$ {fmt(policyOverhead)}/par
                </button>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Despesas fixas ÷ capacidade</p>
              )}
            </div>
            <div>
              <Label htmlFor="commission" className="text-xs flex items-center gap-1.5">
                <UserCheck className="h-3 w-3 text-muted-foreground" />
                Comissão Representante (%)
              </Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="commission" type="number" step="0.01" min="0" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">% sobre o preço de venda</p>
            </div>
            <div>
              <Label htmlFor="freight" className="text-xs flex items-center gap-1.5">
                <Truck className="h-3 w-3 text-muted-foreground" />
                Frete (R$ por unidade)
              </Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="freight" type="number" step="0.01" min="0" value={freightValue} onChange={(e) => setFreightValue(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0,00" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Adicionado ao custo base</p>
            </div>
          </div>

          {!results.isValid ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-destructive">Markup ≥ 100% — impossível precificar</p>
                <p className="text-xs text-muted-foreground mt-1">A soma das taxas ultrapassa 100%. Reduza impostos, margem ou prazo.</p>
              </div>
            </div>
          ) : results.suggestedPrice > 0 ? (
            <>
              {/* ── Ticket de resultado (layout "Painel + Ticket") ──
                  Bloco escuro adaptativo (bg-foreground/text-background) com o PREÇO
                  como herói, à vista × markup × saúde da margem, e a composição do
                  preço como barra 100% (substitui a pizza — ui-ux-pro-max desaconselha
                  pizza >5 categorias; aqui são 7). */}
              {(() => {
                const realMarginPct = results.suggestedPrice > 0 ? (results.realProfit / results.suggestedPrice) * 100 : 0;
                const segs = [
                  { label: 'Custo MP', value: results.numCost, color: 'hsl(var(--background) / 0.62)' },
                  { label: 'Rateio', value: results.numOverhead, color: 'hsl(var(--background) / 0.44)' },
                  { label: 'Frete', value: results.numFreight, color: 'hsl(var(--background) / 0.30)' },
                  { label: 'Impostos', value: results.taxValue, color: 'hsl(var(--primary) / 0.55)' },
                  { label: 'Comissão', value: results.commissionValue, color: 'hsl(var(--primary) / 0.75)' },
                  { label: 'Antecipação', value: results.factoringValue, color: 'hsl(var(--primary))' },
                  { label: 'Lucro', value: Math.max(0, results.realProfit), color: 'hsl(var(--success))' },
                ].filter((s) => s.value > 0);
                const segTotal = segs.reduce((s, x) => s + x.value, 0) || 1;
                return (
                  <div className="rounded-2xl bg-foreground p-5 text-background sm:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-background/55">
                          Preço de venda sugerido · a prazo ({formatDaysLabel(days)})
                        </p>
                        <p className="display mt-1 leading-[0.82] text-background" style={{ fontSize: 'clamp(38px, 8vw, 58px)' }}>
                          <span className="align-top font-mono font-bold text-background/45" style={{ fontSize: '0.3em' }}>R$ </span>
                          {fmt(results.suggestedPrice)}
                        </p>
                      </div>
                      <div className="flex items-end gap-5">
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-background/50">À vista · 7d</p>
                          <p className="font-mono text-base font-bold tabular-nums">R$ {fmt(results.cashPrice)}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-background/50">Markup</p>
                          <p className="font-mono text-base font-bold tabular-nums">{fmt(results.totalMarkupPct)}%</p>
                        </div>
                        <MarginHealthPill pct={realMarginPct} />
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-background/55">Composição do preço</p>
                        <p className="font-mono text-[10px] text-background/55">
                          Custo base R$ {fmt(results.totalCost)} · Lucro R$ {fmt(results.realProfit)}/par
                        </p>
                      </div>
                      <div className="mt-2 flex h-4 overflow-hidden rounded-md" style={{ border: '1px solid hsl(var(--background) / 0.25)' }}>
                        {segs.map((s) => (
                          <div key={s.label} style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} title={`${s.label}: R$ ${fmt(s.value)}`} />
                        ))}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                        {segs.map((s) => (
                          <span key={s.label} className="flex items-center gap-1.5 font-mono text-[11px] text-background/80">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                            {s.label}
                            <span className="font-bold">{((s.value / segTotal) * 100).toFixed(0)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* DRE Simplificado do Simulador */}
              {results.suggestedPrice > 0 && (
                <Card className="border-dashed">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demonstrativo Simplificado</p>
                    <div className="space-y-1.5 text-sm font-mono">
                      <div className="flex justify-between"><span className="text-muted-foreground">Preço de Venda</span><span className="font-semibold">R$ {fmt(results.suggestedPrice)}</span></div>
                      <div className="flex justify-between text-destructive"><span>(−) Impostos</span><span>R$ {fmt(results.taxValue)}</span></div>
                      <div className="flex justify-between text-warning"><span>(−) Antecipação ({formatDaysLabel(days)})</span><span>R$ {fmt(results.factoringValue)}</span></div>
                      <div className="flex justify-between" style={{ color: 'hsl(var(--info))' }}><span>(−) Comissão</span><span>R$ {fmt(results.commissionValue)}</span></div>
                      <div className="border-t pt-1.5 flex justify-between"><span className="text-muted-foreground">(=) Receita Líquida</span><span className="font-semibold">R$ {fmt(results.suggestedPrice - results.taxValue - results.factoringValue - results.commissionValue)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>(−) Custo MP</span><span>R$ {fmt(results.numCost)}</span></div>
                      {results.numOverhead > 0 && (
                        <div className="flex justify-between" style={{ color: 'hsl(var(--stage-assy-fg))' }}><span>(−) Rateio Despesas</span><span>R$ {fmt(results.numOverhead)}</span></div>
                      )}
                      {results.numFreight > 0 && (
                        <div className="flex justify-between" style={{ color: 'hsl(var(--stage-sew-fg))' }}><span>(−) Frete</span><span>R$ {fmt(results.numFreight)}</span></div>
                      )}
                      <div className={`border-t pt-1.5 flex justify-between font-bold ${results.realProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        <span>(=) Lucro Real</span><span>R$ {fmt(results.realProfit)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              Preencha os campos acima para ver o preço sugerido
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── CALCULADORA REVERSA ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/20 p-2">
                <TrendingUp className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg">Calculadora Reversa — Margem Real</CardTitle>
                <CardDescription>Descubra a margem líquida real de uma venda já praticada</CardDescription>
              </div>
            </div>
            <TooltipProvider>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={copyReverseToSimulator} className="gap-1.5">
                    <ArrowRightLeft className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs">Enviar p/ Simulador</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copiar dados para o Simulador de Preço</TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label htmlFor="reverseCost" className="text-xs">Custo MP (R$)</Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseCost" type="number" step="0.01" min="0" placeholder="13,49" value={reverseCost} onChange={(e) => setReverseCost(e.target.value)} className="pl-8 h-9 text-sm" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Matéria-prima</p>
            </div>
            <div>
              <Label htmlFor="soldPrice" className="text-xs">Preço Venda (R$)</Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="soldPrice" type="number" step="0.01" min="0" placeholder="22,90" value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} className="pl-8 h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label htmlFor="reverseTax" className="text-xs">Impostos (%)</Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseTax" type="number" step="0.01" min="0" placeholder="6,5" value={reverseTaxPct} onChange={(e) => setReverseTaxPct(e.target.value)} className="pl-8 h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label htmlFor="reverseFactoring" className="text-xs">Factoring (a.m.%)</Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseFactoring" type="number" step="0.01" min="0" placeholder="3,5" value={reverseFactoringPct} onChange={(e) => setReverseFactoringPct(e.target.value)} className="pl-8 h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label htmlFor="reverseDays" className="text-xs">Prazo (Dias)</Label>
              <Input id="reverseDays" type="text" placeholder="60 ou 30/60/90" value={reverseDays} onChange={(e) => setReverseDays(e.target.value)} className="mt-1 h-9 text-sm" />
              {reverseDays.includes('/') && <p className="text-xs text-muted-foreground mt-1">Média: {fmt(parseDaysInput(reverseDays))} dias</p>}
            </div>
          </div>

          {/* Overhead, Commission & Freight for reverse */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="reverseOverhead" className="text-xs flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                Rateio Despesas (R$/par)
              </Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseOverhead" type="number" step="0.01" min="0" value={reverseOverheadManual} onChange={(e) => setReverseOverheadManual(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0,00" />
              </div>
              {policyOverhead > 0 ? (
                <button
                  type="button"
                  onClick={() => setReverseOverheadManual(policyOverhead.toFixed(2))}
                  className="text-xs text-muted-foreground mt-1 underline underline-offset-2 hover:text-foreground"
                >
                  Aplicar política: R$ {fmt(policyOverhead)}/par
                </button>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Despesas fixas ÷ capacidade</p>
              )}
            </div>
            <div>
              <Label htmlFor="reverseCommission" className="text-xs flex items-center gap-1.5">
                <UserCheck className="h-3 w-3 text-muted-foreground" />
                Comissão Representante (%)
              </Label>
              <div className="relative mt-1">
                <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseCommission" type="number" step="0.01" min="0" value={reverseCommissionPct} onChange={(e) => setReverseCommissionPct(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">% sobre o preço de venda</p>
            </div>
            <div>
              <Label htmlFor="reverseFreight" className="text-xs flex items-center gap-1.5">
                <Truck className="h-3 w-3 text-muted-foreground" />
                Frete (R$ por unidade)
              </Label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="reverseFreight" type="number" step="0.01" min="0" value={reverseFreightValue} onChange={(e) => setReverseFreightValue(e.target.value)} className="pl-8 h-9 text-sm" placeholder="0,00" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Adicionado ao custo base</p>
            </div>
          </div>

          {reverseResults ? (
            <>
              {/* ── Ticket de resultado — mesma linguagem visual do Simulador
                  (bloco escuro adaptativo + barra de composição 100%). Substitui
                  o grid de 7 cards (quebrava 5+2) e a pizza de 7 fatias. ── */}
              {(() => {
                const rr = reverseResults;
                const segs = [
                  { label: 'Custo MP', value: rr.numReverseCost, color: 'hsl(var(--background) / 0.62)' },
                  { label: 'Rateio', value: rr.numOverhead, color: 'hsl(var(--background) / 0.44)' },
                  { label: 'Frete', value: rr.numFreight, color: 'hsl(var(--background) / 0.30)' },
                  { label: 'Impostos', value: rr.taxValue, color: 'hsl(var(--primary) / 0.55)' },
                  { label: 'Comissão', value: rr.commissionValue, color: 'hsl(var(--primary) / 0.75)' },
                  { label: 'Antecipação', value: rr.factoringValue, color: 'hsl(var(--primary))' },
                  { label: 'Lucro', value: Math.max(0, rr.realProfit), color: 'hsl(var(--success))' },
                ].filter((s) => s.value > 0);
                const segTotal = segs.reduce((s, x) => s + x.value, 0) || 1;
                return (
                  <div className="rounded-2xl bg-foreground p-5 text-background sm:p-6">
                    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-background/55">
                          Lucro real por par · a prazo ({formatDaysLabel(reverseDays)})
                        </p>
                        <p
                          className={`display mt-1 leading-[0.82] ${rr.realProfit < 0 ? 'text-destructive' : 'text-background'}`}
                          style={{ fontSize: 'clamp(38px, 8vw, 58px)' }}
                        >
                          <span className="align-top font-mono font-bold text-background/45" style={{ fontSize: '0.3em' }}>R$ </span>
                          {fmt(rr.realProfit)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-5">
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-background/50">À vista · 7d</p>
                          <p className="font-mono text-base font-bold tabular-nums">R$ {fmt(rr.cashPrice)}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-background/50">Preço sugerido</p>
                          <p className="font-mono text-base font-bold tabular-nums">R$ {fmt(rr.suggestedPrice)}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-background/50">Markup bruto</p>
                          <p className="font-mono text-base font-bold tabular-nums">{fmt(rr.markupPct)}%</p>
                        </div>
                        <MarginHealthPill pct={rr.realMarginPct} />
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-background/55">Composição do preço praticado</p>
                        <p className="font-mono text-[10px] text-background/55">
                          Preço venda R$ {fmt(rr.numSold)} · Custo base R$ {fmt(rr.totalCost)}
                        </p>
                      </div>
                      <div className="mt-2 flex h-4 overflow-hidden rounded-md" style={{ border: '1px solid hsl(var(--background) / 0.25)' }}>
                        {segs.map((s) => (
                          <div key={s.label} style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} title={`${s.label}: R$ ${fmt(s.value)}`} />
                        ))}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                        {segs.map((s) => (
                          <span key={s.label} className="flex items-center gap-1.5 font-mono text-[11px] text-background/80">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                            {s.label}
                            <span className="font-bold">{((s.value / segTotal) * 100).toFixed(0)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* DRE resumida + waterfall lado a lado (a pizza de 7 fatias saiu —
                  a composição já está na barra 100% do ticket acima) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-dashed">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demonstrativo Simplificado</p>
                  <div className="space-y-1.5 text-sm font-mono">
                    <div className="flex justify-between"><span className="text-muted-foreground">Preço de Venda</span><span className="font-semibold">R$ {fmt(reverseResults.numSold)}</span></div>
                    <div className="flex justify-between text-destructive"><span>(−) Impostos</span><span>R$ {fmt(reverseResults.taxValue)}</span></div>
                    <div className="flex justify-between text-warning"><span>(−) Antecipação ({formatDaysLabel(reverseDays)})</span><span>R$ {fmt(reverseResults.factoringValue)}</span></div>
                    <div className="flex justify-between" style={{ color: 'hsl(var(--info))' }}><span>(−) Comissão</span><span>R$ {fmt(reverseResults.commissionValue)}</span></div>
                    <div className="border-t pt-1.5 flex justify-between"><span className="text-muted-foreground">(=) Receita Líquida</span><span className="font-semibold">R$ {fmt(reverseResults.netRevenue)}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>(−) Custo MP</span><span>R$ {fmt(reverseResults.numReverseCost)}</span></div>
                    {reverseResults.numOverhead > 0 && (
                      <div className="flex justify-between" style={{ color: 'hsl(var(--stage-assy-fg))' }}><span>(−) Rateio Despesas</span><span>R$ {fmt(reverseResults.numOverhead)}</span></div>
                    )}
                    {reverseResults.numFreight > 0 && (
                      <div className="flex justify-between" style={{ color: 'hsl(var(--stage-sew-fg))' }}><span>(−) Frete</span><span>R$ {fmt(reverseResults.numFreight)}</span></div>
                    )}
                    <div className={`border-t pt-1.5 flex justify-between font-bold ${reverseResults.realProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      <span>(=) Lucro Real</span><span>R$ {fmt(reverseResults.realProfit)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

                {reverseBarData.length > 0 && (
                  <Card className="border-dashed">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm">Waterfall — Fluxo de Caixa</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={reverseBarData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <RechartsTooltip formatter={(v: number) => `R$ ${fmt(v)}`} />
                            <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                              {reverseBarData.map((entry, i) => (
                                <Cell key={i} fill={entry.valor >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              Preencha custo e preço de venda para ver a análise de margem
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
