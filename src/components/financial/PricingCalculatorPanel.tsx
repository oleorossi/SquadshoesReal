import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, CurrencyDollar as DollarSign, Percent, TrendUp as TrendingUp, Warning as AlertTriangle, ChartBar as BarChart3, ChartPie as PieChart, Truck, UserCheck, Buildings as Building2, ArrowsLeftRight as ArrowRightLeft } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Legend } from 'recharts';
import { useCostPolicies } from '@/hooks/useCostPolicies';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IndicatorCard({ label, value, sub, color = 'primary' }: { label: string; value: string; sub?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'border-primary/30 bg-primary/5 text-primary',
    success: 'border-success/30 bg-success/5 text-success',
    destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
    warning: 'border-warning/30 bg-warning/5 text-warning',
    muted: 'border-border bg-muted/50 text-foreground',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.primary}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</p>
      <p className="display text-xl tabular-nums">{value}</p>
      {sub && <p className="text-[11px] mt-0.5 opacity-60">{sub}</p>}
    </div>
  );
}

// Paleta puxada dos tokens (handoff Novidade). Antes tinha um verde primário
// hardcoded que desencaixava do resto do sistema (vermelho Squad).
const COLORS = [
  'hsl(var(--primary))',          // custo (acento Squad)
  'hsl(var(--destructive))',      // impostos
  'hsl(var(--warning))',          // factoring
  'hsl(var(--stage-cut-fg))',     // comissão (azul corte)
  'hsl(var(--stage-sew-fg))',     // frete (roxo costura)
  'hsl(var(--success))',          // lucro
  'hsl(var(--stage-assy-fg))',    // overhead (laranja montagem)
];

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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [cost, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual,
      soldPrice, reverseCost, reverseTaxPct, reverseFactoringPct, reverseDays, reverseCommissionPct, reverseFreightValue, reverseOverheadManual]);

  // Effective overhead: manual override or policy-derived
  const getOverhead = (manual: string) => {
    const v = parseFloat(manual);
    return !isNaN(v) && v >= 0 && manual.trim() !== '' ? v : policyOverhead;
  };

  const copySimulatorToReverse = () => {
    setReverseCost(cost);
    setReverseTaxPct(taxPct);
    setReverseFactoringPct(factoringRatePct);
    setReverseDays(days);
    setReverseCommissionPct(commissionPct);
    setReverseFreightValue(freightValue);
    setReverseOverheadManual(overheadManual);
    if (results.isValid && results.suggestedPrice > 0) {
      setSoldPrice(fmt(results.suggestedPrice));
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

  // Parse days: supports "60" or "30/60/90" → returns average
  const parseDays = (input: string): number => {
    const trimmed = input.trim();
    if (!trimmed) return 0;
    const parts = trimmed.split('/').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (parts.length === 0) return 0;
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  };

  const formatDaysLabel = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return '0d';
    const parts = trimmed.split('/').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (parts.length <= 1) return `${parts[0] || 0}d`;
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
    return `${trimmed} (média ${fmt(avg)}d)`;
  };

  const results = useMemo(() => {
    const numCost = parseFloat(cost) || 0;
    const numTax = parseFloat(taxPct) || 0;
    const numFactoring = parseFloat(factoringRatePct) || 0;
    const numDays = parseDays(days);
    const numProfit = parseFloat(profitMarginPct) || 0;
    const numCommission = parseFloat(commissionPct) || 0;
    const numFreight = parseFloat(freightValue) || 0;
    const numOverhead = getOverhead(overheadManual);

    // custo_base = custo_materia_prima + (despesas_fixas / capacidade) + frete
    const totalCost = numCost + numOverhead + numFreight;

    const factoringTotalPct = (numFactoring / 30) * numDays;
    const totalMarkupPct = numTax + numProfit + factoringTotalPct + numCommission;
    const markupDivisor = 1 - (totalMarkupPct / 100);
    const isValid = markupDivisor > 0;
    const suggestedPrice = isValid ? (totalCost / markupDivisor) : 0;
    const realProfit = suggestedPrice * (numProfit / 100);
    const taxValue = suggestedPrice * (numTax / 100);
    const factoringValue = suggestedPrice * (factoringTotalPct / 100);
    const commissionValue = suggestedPrice * (numCommission / 100);

    // Preço à vista (7 dias)
    const factoringVistaP = (numFactoring / 30) * 7;
    const markupVistaPct = numTax + numProfit + factoringVistaP + numCommission;
    const markupVistaDivisor = 1 - (markupVistaPct / 100);
    const cashPrice = (isValid && markupVistaDivisor > 0) ? (totalCost / markupVistaDivisor) : 0;

    return { factoringTotalPct, totalMarkupPct, suggestedPrice, realProfit, isValid, taxValue, factoringValue, commissionValue, numFreight, numOverhead, totalCost, cashPrice };
  }, [cost, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual, policyOverhead]);

  const reverseResults = useMemo(() => {
    const numSold = parseFloat(soldPrice) || 0;
    const numReverseCost = parseFloat(reverseCost) || 0;
    const numTax = parseFloat(reverseTaxPct) || 0;
    const numFactoring = parseFloat(reverseFactoringPct) || 0;
    const numDays = parseDays(reverseDays);
    const numCommission = parseFloat(reverseCommissionPct) || 0;
    const numFreight = parseFloat(reverseFreightValue) || 0;
    const numOverhead = getOverhead(reverseOverheadManual);

    if (numSold <= 0 || numReverseCost <= 0) return null;

    const factoringTotalPct = (numFactoring / 30) * numDays;
    const taxValue = numSold * (numTax / 100);
    const factoringValue = numSold * (factoringTotalPct / 100);
    const commissionValue = numSold * (numCommission / 100);
    const netRevenue = numSold - taxValue - factoringValue - commissionValue;
    const totalCost = numReverseCost + numOverhead + numFreight;
    const realProfit = netRevenue - totalCost;
    const realMarginPct = (realProfit / numSold) * 100;
    const markupPct = totalCost > 0 ? ((numSold - totalCost) / totalCost) * 100 : 0;

    // Preço à vista (7 dias)
    const factoringVistaP = (numFactoring / 30) * 7;
    const cashMarkupPct = numTax + factoringVistaP + numCommission;
    const cashDivisor = 1 - (cashMarkupPct / 100);
    const cashPrice = cashDivisor > 0 ? ((totalCost + realProfit) / cashDivisor) : 0;

    // Preço sugerido (markup divisor com margem real encontrada)
    // totalMarkupPct reflete a margem real; suggestedMarkupPct clamp ≥ 0 para o divisor
    const totalMarkupPct = numTax + realMarginPct + factoringTotalPct + numCommission;
    const suggestedMarkupPct = numTax + Math.max(0, realMarginPct) + factoringTotalPct + numCommission;
    const suggestedDivisor = 1 - (suggestedMarkupPct / 100);
    const suggestedPrice = suggestedDivisor > 0 ? (totalCost / suggestedDivisor) : 0;

    return { taxValue, factoringValue, commissionValue, numFreight, numOverhead, netRevenue, realProfit, realMarginPct, markupPct, factoringTotalPct, numReverseCost, totalCost, numSold, cashPrice, suggestedPrice, totalMarkupPct, suggestedMarkupPct };
  }, [soldPrice, reverseCost, reverseTaxPct, reverseFactoringPct, reverseDays, reverseCommissionPct, reverseFreightValue, reverseOverheadManual, policyOverhead]);

  // Chart data for simulator
  const simulatorPieData = useMemo(() => {
    if (!results.isValid || results.suggestedPrice <= 0) return [];
    const numCostRaw = parseFloat(cost) || 0;
    return [
      { name: 'Matéria-Prima', value: numCostRaw },
      { name: 'Rateio Despesas', value: results.numOverhead },
      { name: 'Frete', value: results.numFreight },
      { name: 'Impostos', value: results.taxValue },
      { name: 'Antecipação', value: results.factoringValue },
      { name: 'Comissão', value: results.commissionValue },
      { name: 'Lucro', value: results.realProfit },
    ].filter(d => d.value > 0);
  }, [results, cost]);

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

  const reversePieData = useMemo(() => {
    if (!reverseResults || reverseResults.numSold <= 0) return [];
    return [
      { name: 'Custo MP', value: reverseResults.numReverseCost },
      { name: 'Rateio Despesas', value: reverseResults.numOverhead },
      { name: 'Impostos', value: reverseResults.taxValue },
      { name: 'Antecipação', value: reverseResults.factoringValue },
      { name: 'Comissão', value: reverseResults.commissionValue },
      { name: 'Frete', value: reverseResults.numFreight },
      { name: 'Lucro', value: Math.max(0, reverseResults.realProfit) },
    ].filter(d => d.value > 0);
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
              <p className="text-[10px] text-muted-foreground mt-1">Matéria-prima</p>
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
              {days.includes('/') && <p className="text-[10px] text-muted-foreground mt-1">Média: {fmt(parseDays(days))} dias</p>}
            </div>
            <div>
              <Label htmlFor="profit" className="text-xs">Margem (%)</Label>
              <div className="relative mt-1">
                <TrendingUp className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input id="profit" type="number" step="0.01" min="0" value={profitMarginPct} onChange={(e) => setProfitMarginPct(e.target.value)} className="pl-8 h-9 text-sm font-semibold" placeholder="0" />
              </div>
            </div>
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
                <Input id="overhead" type="number" step="0.01" min="0" value={overheadManual} onChange={(e) => setOverheadManual(e.target.value)} className="pl-8 h-9 text-sm" placeholder={fmt(policyOverhead)} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {policyOverhead > 0 ? `Política: R$ ${fmt(policyOverhead)}/par` : 'Despesas fixas ÷ capacidade'}
              </p>
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
              <p className="text-[10px] text-muted-foreground mt-1">% sobre o preço de venda</p>
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
              <p className="text-[10px] text-muted-foreground mt-1">Adicionado ao custo base</p>
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
              {/* Indicadores */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <IndicatorCard label="Preço Sugerido" value={`R$ ${fmt(results.suggestedPrice)}`} sub={`a prazo (${formatDaysLabel(days)})`} color="primary" />
                <IndicatorCard label="Preço à Vista" value={`R$ ${fmt(results.cashPrice)}`} sub="pagamento em 7 dias" color="primary" />
                <IndicatorCard label="Custo Base" value={`R$ ${fmt(results.totalCost)}`} sub={`MP ${fmt(parseFloat(cost)||0)} + Rateio ${fmt(results.numOverhead)} + Frete ${fmt(results.numFreight)}`} color="muted" />
                <IndicatorCard label="Lucro Líquido" value={`R$ ${fmt(results.realProfit)}`} sub="por unidade" color="success" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <IndicatorCard label="Antecipação" value={`${fmt(results.factoringTotalPct)}%`} sub={formatDaysLabel(days)} color="warning" />
                <IndicatorCard label="Comissão" value={`R$ ${fmt(results.commissionValue)}`} sub={`${commissionPct || '0'}% s/ venda`} color="muted" />
                <IndicatorCard label="Markup Total" value={`${fmt(results.totalMarkupPct)}%`} sub="impostos+juros+comissão+lucro" color="muted" />
              </div>

              {/* Gráfico pizza composição */}
              {simulatorPieData.length > 0 && (
                <Card className="border-dashed">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center gap-2">
                      <PieChart className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm">Composição do Preço</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex items-center gap-6">
                      <div className="w-44 h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <RePieChart>
                            <Pie data={simulatorPieData} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" strokeWidth={2} stroke="hsl(var(--card))">
                              {simulatorPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                           <RechartsTooltip formatter={(v: number) => `R$ ${fmt(v)}`} />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2 text-sm">
                        {simulatorPieData.map((d, i) => (
                          <div key={d.name} className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                            <span className="text-muted-foreground">{d.name}:</span>
                            <span className="font-medium font-mono">R$ {fmt(d.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* DRE Simplificado do Simulador */}
              {results.suggestedPrice > 0 && (
                <Card className="border-dashed">
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demonstrativo Simplificado</p>
                    <div className="space-y-1.5 text-sm font-mono">
                      <div className="flex justify-between"><span className="text-muted-foreground">Preço de Venda</span><span className="font-semibold">R$ {fmt(results.suggestedPrice)}</span></div>
                      <div className="flex justify-between text-destructive"><span>(−) Impostos</span><span>R$ {fmt(results.taxValue)}</span></div>
                      <div className="flex justify-between text-warning"><span>(−) Antecipação ({formatDaysLabel(days)})</span><span>R$ {fmt(results.factoringValue)}</span></div>
                      <div className="flex justify-between" style={{ color: 'hsl(200, 60%, 45%)' }}><span>(−) Comissão</span><span>R$ {fmt(results.commissionValue)}</span></div>
                      <div className="border-t pt-1.5 flex justify-between"><span className="text-muted-foreground">(=) Receita Líquida</span><span className="font-semibold">R$ {fmt(results.suggestedPrice - results.taxValue - results.factoringValue - results.commissionValue)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>(−) Custo MP</span><span>R$ {fmt(parseFloat(cost) || 0)}</span></div>
                      {results.numOverhead > 0 && (
                        <div className="flex justify-between" style={{ color: 'hsl(30, 70%, 50%)' }}><span>(−) Rateio Despesas</span><span>R$ {fmt(results.numOverhead)}</span></div>
                      )}
                      {results.numFreight > 0 && (
                        <div className="flex justify-between" style={{ color: 'hsl(280, 50%, 50%)' }}><span>(−) Frete</span><span>R$ {fmt(results.numFreight)}</span></div>
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
              <p className="text-[10px] text-muted-foreground mt-1">Matéria-prima</p>
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
              {reverseDays.includes('/') && <p className="text-[10px] text-muted-foreground mt-1">Média: {fmt(parseDays(reverseDays))} dias</p>}
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
                <Input id="reverseOverhead" type="number" step="0.01" min="0" value={reverseOverheadManual} onChange={(e) => setReverseOverheadManual(e.target.value)} className="pl-8 h-9 text-sm" placeholder={fmt(policyOverhead)} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {policyOverhead > 0 ? `Política: R$ ${fmt(policyOverhead)}/par` : 'Despesas fixas ÷ capacidade'}
              </p>
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
              <p className="text-[10px] text-muted-foreground mt-1">% sobre o preço de venda</p>
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
              <p className="text-[10px] text-muted-foreground mt-1">Adicionado ao custo base</p>
            </div>
          </div>

          {reverseResults ? (
            <>
              {/* Indicadores */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <IndicatorCard
                  label="Lucro Real"
                  value={`R$ ${fmt(reverseResults.realProfit)}`}
                  sub="líquido por unidade"
                  color={reverseResults.realProfit >= 0 ? 'success' : 'destructive'}
                />
                <IndicatorCard
                  label="Margem Real"
                  value={`${fmt(reverseResults.realMarginPct)}%`}
                  sub="sobre preço de venda"
                  color={reverseResults.realMarginPct >= 0 ? 'primary' : 'destructive'}
                />
                <IndicatorCard
                  label="Receita Líquida"
                  value={`R$ ${fmt(reverseResults.netRevenue)}`}
                  sub="após descontos"
                  color="muted"
                />
                <IndicatorCard
                  label="Comissão"
                  value={`R$ ${fmt(reverseResults.commissionValue)}`}
                  sub={`${reverseCommissionPct || '0'}% s/ venda`}
                  color="muted"
                />
                <IndicatorCard
                  label="Markup Bruto"
                  value={`${fmt(reverseResults.markupPct)}%`}
                  sub="sobre custo + frete"
                  color="warning"
                />
                <IndicatorCard
                  label="Preço à Vista"
                  value={`R$ ${fmt(reverseResults.cashPrice)}`}
                  sub="mesmo lucro em 7 dias"
                  color="primary"
                />
                <IndicatorCard
                  label="Preço Sugerido"
                  value={`R$ ${fmt(reverseResults.suggestedPrice)}`}
                  sub={`markup divisor (${fmt(reverseResults.suggestedMarkupPct)}%)`}
                  color="primary"
                />
               </div>

              {/* DRE resumida */}
              <Card className="border-dashed">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demonstrativo Simplificado</p>
                  <div className="space-y-1.5 text-sm font-mono">
                    <div className="flex justify-between"><span className="text-muted-foreground">Preço de Venda</span><span className="font-semibold">R$ {fmt(reverseResults.numSold)}</span></div>
                    <div className="flex justify-between text-destructive"><span>(−) Impostos</span><span>R$ {fmt(reverseResults.taxValue)}</span></div>
                    <div className="flex justify-between text-warning"><span>(−) Antecipação ({formatDaysLabel(reverseDays)})</span><span>R$ {fmt(reverseResults.factoringValue)}</span></div>
                    <div className="flex justify-between" style={{ color: 'hsl(200, 60%, 45%)' }}><span>(−) Comissão</span><span>R$ {fmt(reverseResults.commissionValue)}</span></div>
                    <div className="border-t pt-1.5 flex justify-between"><span className="text-muted-foreground">(=) Receita Líquida</span><span className="font-semibold">R$ {fmt(reverseResults.netRevenue)}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>(−) Custo MP</span><span>R$ {fmt(reverseResults.numReverseCost)}</span></div>
                    {reverseResults.numOverhead > 0 && (
                      <div className="flex justify-between" style={{ color: 'hsl(30, 70%, 50%)' }}><span>(−) Rateio Despesas</span><span>R$ {fmt(reverseResults.numOverhead)}</span></div>
                    )}
                    {reverseResults.numFreight > 0 && (
                      <div className="flex justify-between" style={{ color: 'hsl(280, 50%, 50%)' }}><span>(−) Frete</span><span>R$ {fmt(reverseResults.numFreight)}</span></div>
                    )}
                    <div className={`border-t pt-1.5 flex justify-between font-bold ${reverseResults.realProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      <span>(=) Lucro Real</span><span>R$ {fmt(reverseResults.realProfit)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Gráficos */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {reversePieData.length > 0 && (
                  <Card className="border-dashed">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center gap-2">
                        <PieChart className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm">Composição do Preço</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <RePieChart>
                            <Pie data={reversePieData} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" strokeWidth={2} stroke="hsl(var(--card))">
                              {reversePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                           <RechartsTooltip formatter={(v: number) => `R$ ${fmt(v)}`} />
                            <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

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
