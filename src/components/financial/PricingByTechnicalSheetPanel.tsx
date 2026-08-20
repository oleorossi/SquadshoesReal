/**
 * PricingByTechnicalSheetPanel — calculadora de markup automática.
 *
 * Auto-preenche o custo de matéria-prima a partir do MOTOR CANÔNICO de consumo
 * (`calculate_order_consumption`, o mesmo do custeio `calculate_order_cost_item`),
 * precificando as linhas a `products.unit_price` — F6-1 da auditoria de motores.
 * A soma crua de `sheet_materials` (antiga fonte) inflava ~5× em fichas com
 * solados alternativos + 2 caixas na BOM e IGNORAVA materiais resolvidos por
 * grupo (napa/EVA), que estruturalmente nunca entram em `sheet_materials`.
 *
 * Diferente do PricingCalculatorPanel (todo manual), aqui:
 *   • Select de ficha técnica (busca em useTechnicalSheets)
 *   • Custo MP é READ-ONLY — vem do motor de explosão (grade base de 12 pares)
 *   • Filtro de caixa por modo de embalagem (espelho de filter_caixa_by_packaging_mode)
 *   • Breakdown de materiais visível pra auditoria
 *   • MOD default vem das bom_operations da ficha (mesma fonte do custeio — F6-4);
 *     labor_costs (tabela global legada) só como fallback de ficha sem operações
 *   • Overhead vem de cost_policies (mesma fonte do panel manual)
 *   • Inputs MANUAIS: impostos, factoring, dias, comissão, margem, frete
 *   • Mesma fórmula de markup divisor → preço sugerido + margem real
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, CurrencyDollar as DollarSign, FileText, Warning as AlertTriangle, ArrowsClockwise as RefreshCw, UserCheck, Cube as Box, Percent, FloppyDisk as Save, ClockCounterClockwise as History, Trash as Trash2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { useLaborCosts } from '@/hooks/useFinanceAdvanced';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useBomOperations } from '@/hooks/useBomOperations';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from '@/lib/packagingPairsPerBox';
import { PACKAGING_MODE_LABELS, PACKAGING_MODE_CANONICAL, type PackagingMode } from '@/hooks/useSaleOrders';
import { useFactoringConfigs } from '@/components/finance/FactoringTab';
import { usePricingSimulations, useCreatePricingSimulation, useDeletePricingSimulation } from '@/hooks/usePricingSimulations';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { format, parseISO } from 'date-fns';
import { parseBrlNumberNonNeg } from '@/lib/parseBrlNumber';
import { parseDaysInput, parseDaysInstallments, computeMarkupPrice, deriveMarginFromTargetProfit } from '@/lib/markupCalc';

const STORAGE_KEY = 'pricing-by-sheet-state';

/** Grade base (~1 ficha fechada). O motor é chamado com esta quantidade e o
 *  resultado é dividido de volta pra R$/par — evita distorção de itens com
 *  arredondamento por ficha (caixa colmeia, tiras via CEIL de fichas). */
const GRADE_BASE_QTY = 12;

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type SavedState = {
  sheetId?: string;
  packagingMode?: string;
  factoringConfigId?: string;
  taxPct?: string;
  factoringRatePct?: string;
  days?: string;
  profitMarginPct?: string;
  targetProfitBrl?: string;
  commissionPct?: string;
  freightValue?: string;
  overheadManual?: string;
  laborManual?: string;
  packagingManual?: string;
};

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

type Props = {
  /** Quando vem de deep-link (PV ou outra tela), seleciona a ficha automaticamente. */
  initialSheetId?: string;
};

export default function PricingByTechnicalSheetPanel({ initialSheetId }: Props = {}) {
  const saved = useMemo(() => loadSaved(), []);
  const { data: costPolicy } = useCostPolicies();
  const { data: sheets = [], isLoading: loadingSheets } = useTechnicalSheets();
  const { data: laborCosts = [] } = useLaborCosts();
  const { data: factoringConfigs = [] } = useFactoringConfigs();
  const { data: simulations = [] } = usePricingSimulations(null);
  const createSim = useCreatePricingSimulation();
  const deleteSim = useDeletePricingSimulation();

  // Overhead de cost_policies — F6-3: cadeia ÚNICA, idêntica ao motor SQL
  // (calculate_order_cost_item): overhead_rate_per_pair direto; quando 0/nulo,
  // deriva de overhead_monthly_total ÷ monthly_production_target (meta 0 → 0,
  // espelhando o NULLIF do SQL — antes dividia por 1 e mostrava o total mensal).
  const policyOverhead = useMemo(() => {
    if (!costPolicy) return 0;
    const rate = Number(costPolicy.overhead_rate_per_pair) || 0;
    if (rate > 0) return rate;
    const target = Number(costPolicy.monthly_production_target) || 0;
    return target > 0 ? (Number(costPolicy.overhead_monthly_total) || 0) / target : 0;
  }, [costPolicy]);

  const [sheetId, setSheetId] = useState<string>(initialSheetId || saved.sheetId || '');

  // Mão de obra — F6-4: a fonte canônica de MOD é `bom_operations` da FICHA
  // selecionada (Σ minutos/60 × cost_per_hour das operações ativas), a MESMA
  // query do custeio `calculate_order_cost_item` e da aba de margem da ficha.
  // A tabela global `labor_costs` (Financeiro · Comissões & MO) fica só como
  // FALLBACK documentado pra ficha sem NENHUMA operação cadastrada — ela não
  // tem coluna de ficha, então nunca reproduz o MOD por modelo do custeio.
  const { data: bomOperations = [] } = useBomOperations(sheetId || null);

  const bomLaborBreakdown = useMemo(
    () =>
      (bomOperations || [])
        // Espelho do filtro do custeio: active IS NOT FALSE + tempo/custo não-nulos.
        .filter((op: any) => op.active !== false && op.standard_time_minutes != null && op.cost_per_hour != null)
        .map((op: any) => ({
          id: op.id as string,
          operation: (op.operation_name as string) || '—',
          hourCost: Number(op.cost_per_hour) || 0,
          minutesPerUnit: Number(op.standard_time_minutes) || 0,
          costPerUnit: ((Number(op.cost_per_hour) || 0) * (Number(op.standard_time_minutes) || 0)) / 60,
        })),
    [bomOperations]
  );

  const legacyLaborBreakdown = useMemo(
    () =>
      (laborCosts || [])
        .filter((l: any) => l.active)
        .map((l: any) => ({
          id: l.id as string,
          operation: (l.operation_name as string) || '—',
          hourCost: Number(l.hour_cost) || 0,
          minutesPerUnit: Number(l.time_per_unit_minutes) || 0,
          costPerUnit: ((Number(l.hour_cost) || 0) * (Number(l.time_per_unit_minutes) || 0)) / 60,
        })),
    [laborCosts]
  );

  const laborSource: 'ficha' | 'labor_costs' =
    (bomOperations || []).length > 0 ? 'ficha' : 'labor_costs';
  const laborBreakdown = laborSource === 'ficha' ? bomLaborBreakdown : legacyLaborBreakdown;
  const policyLaborCost = useMemo(
    () => laborBreakdown.reduce((sum, l) => sum + l.costPerUnit, 0),
    [laborBreakdown]
  );

  // Se o deep-link mudar (ex: navegação interna sem unmount), troca a ficha
  useEffect(() => {
    if (initialSheetId && initialSheetId !== sheetId) setSheetId(initialSheetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSheetId]);
  // Modo de embalagem simulado — decide QUAL caixa da BOM entra no custo
  // (espelho do filter_caixa_by_packaging_mode aplicado pelo custeio ao PV).
  const [packagingMode, setPackagingMode] = useState<PackagingMode>(
    (saved.packagingMode as PackagingMode) || 'colmeia'
  );
  const [factoringConfigId, setFactoringConfigId] = useState(saved.factoringConfigId ?? '');
  const [taxPct, setTaxPct] = useState(saved.taxPct ?? '');
  const [factoringRatePct, setFactoringRatePct] = useState(saved.factoringRatePct ?? '');
  const [days, setDays] = useState(saved.days ?? '');
  const [profitMarginPct, setProfitMarginPct] = useState(saved.profitMarginPct ?? '');
  // Modo inverso "quero receber R$ X líquido/par" — mesmo do painel Manual.
  const [targetProfitBrl, setTargetProfitBrl] = useState(saved.targetProfitBrl ?? '');
  const [commissionPct, setCommissionPct] = useState(saved.commissionPct ?? '');
  const [freightValue, setFreightValue] = useState(saved.freightValue ?? '');
  const [overheadManual, setOverheadManual] = useState(saved.overheadManual ?? '');
  const [laborManual, setLaborManual] = useState(saved.laborManual ?? '');
  const [packagingManual, setPackagingManual] = useState(saved.packagingManual ?? '');

  // Persiste a cada mudança
  useEffect(() => {
    const state: SavedState = {
      sheetId, packagingMode, factoringConfigId, taxPct, factoringRatePct, days, profitMarginPct, targetProfitBrl,
      commissionPct, freightValue, overheadManual, laborManual, packagingManual,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [sheetId, packagingMode, factoringConfigId, taxPct, factoringRatePct, days, profitMarginPct, targetProfitBrl, commissionPct, freightValue, overheadManual, laborManual, packagingManual]);

  // Auto-preenche factoring quando o usuário escolhe uma config
  useEffect(() => {
    if (!factoringConfigId) return;
    const cfg = factoringConfigs.find(c => c.id === factoringConfigId);
    if (!cfg) return;
    setFactoringRatePct(String(Number(cfg.monthly_interest_rate) || ''));
    setDays(String(cfg.receiving_days || ''));
  }, [factoringConfigId, factoringConfigs]);

  // F6-1: custo MP vem do MOTOR CANÔNICO de consumo (calculate_order_consumption,
  // wrapper do by_grade — o mesmo que alimenta calculate_order_cost_item), NÃO da
  // soma crua de sheet_materials. O motor resolve 1 solado (não soma alternativas),
  // usa sole_standard_items pras colas e inclui os materiais resolvidos por grupo
  // (napa/EVA/placa) que nunca entram na BOM. Chamado com a grade base (12 pares)
  // e dividido de volta pra R$/par. Cor vazia → resolução default do grupo.
  const { data: engineData, isLoading: loadingMaterials } = useQuery({
    queryKey: ['pricing-sheet-engine-consumption', sheetId],
    enabled: !!sheetId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_order_consumption', {
        p_reference_id: sheetId,
        p_order_quantity: GRADE_BASE_QTY,
        p_color: '',
      });
      if (error) throw error;
      const lines = (Array.isArray(data) ? data : []) as any[];
      const ids = Array.from(new Set(lines.map((l: any) => l?.product_id).filter(Boolean))) as string[];
      let products: any[] = [];
      if (ids.length > 0) {
        const { data: prods, error: prodErr } = await supabase
          .from('products')
          .select('id, name, unit, unit_price')
          .in('id', ids);
        if (prodErr) throw prodErr;
        products = prods || [];
      }
      return { lines, products };
    },
  });

  // Precifica as linhas do motor. Filtro de caixa por modo de embalagem é o
  // espelho TS de filter_caixa_by_packaging_mode (só age quando a ficha tem
  // ≥ 2 tipos de caixa E o modo escolhido existe entre eles).
  const engineBreakdown = useMemo(() => {
    if (!engineData) return [] as Array<{
      key: string; component: string; name: string; unit: string;
      qtyPerPair: number; unitPrice: number; costPerPair: number;
      resolved: boolean; unitMismatch: boolean; warning: string | null;
    }>;
    const productMap = new Map<string, any>(engineData.products.map((p: any) => [p.id, p]));
    const presentCaixaTypes = new Set<CollectiveType>();
    engineData.lines.forEach((l: any) => {
      const prod = productMap.get(l?.product_id);
      const t = caixaCollectiveTypeFromName(prod?.name ?? l?.product_name);
      if (t) presentCaixaTypes.add(t);
    });
    return engineData.lines
      .filter((l: any) => {
        const prod = productMap.get(l?.product_id);
        return shouldShowCaixaForMode(prod?.name ?? l?.product_name, packagingMode, presentCaixaTypes);
      })
      .map((l: any, idx: number) => {
        const prod = productMap.get(l?.product_id);
        const resolved = !!l?.product_id && !!prod;
        const unitPrice = Number(prod?.unit_price) || 0;
        const required = Number(l?.required) || 0;
        const lineUnit = String(l?.unit ?? prod?.unit ?? '').trim();
        const productUnit = String(prod?.unit ?? '').trim();
        // Guard de unidade (espírito do convert_to_product_unit do custeio): o
        // motor já emite na unidade do produto; se divergir, NÃO precifica —
        // linha entra zerada com aviso visível em vez de custo errado calado.
        const unitMismatch = !!(lineUnit && productUnit && lineUnit.toLowerCase() !== productUnit.toLowerCase());
        const costPerPair = resolved && !unitMismatch ? (unitPrice * required) / GRADE_BASE_QTY : 0;
        return {
          key: `${l?.product_id ?? 'sem-produto'}-${l?.component ?? ''}-${idx}`,
          component: String(l?.component ?? '—'),
          name: String(prod?.name ?? l?.product_name ?? l?.material ?? '—'),
          unit: lineUnit || productUnit || 'un',
          qtyPerPair: required / GRADE_BASE_QTY,
          unitPrice,
          costPerPair,
          resolved,
          unitMismatch,
          warning: (l?.consumption_warning || l?.conversion_warning || null) as string | null,
        };
      });
  }, [engineData, packagingMode]);

  const totalMaterialCost = useMemo(
    () => engineBreakdown.reduce((sum, b) => sum + b.costPerPair, 0),
    [engineBreakdown]
  );

  const selectedSheet = useMemo(
    () => sheets.find((s: any) => s.id === sheetId),
    [sheets, sheetId]
  );

  // Campo vazio → default da política; preenchido → parseBrlNumberNonNeg
  // (NUNCA parseFloat cru — auditoria 2026-06-14: "2.500,00" virava 2,5).
  const getOverhead = () =>
    overheadManual.trim() !== '' ? parseBrlNumberNonNeg(overheadManual) : policyOverhead;

  const getLabor = () =>
    laborManual.trim() !== '' ? parseBrlNumberNonNeg(laborManual) : policyLaborCost;

  // O motor canônico já inclui as caixas e demais itens do BOM. A política e
  // este override representam exclusivamente embalagem adicional fora do BOM.
  // Deixá-la em branco/zero na política não acrescenta nada ao custo.
  const policyPackaging = Number(costPolicy?.packaging_cost_per_pair) || 0;
  const getPackaging = () =>
    packagingManual.trim() !== '' ? parseBrlNumberNonNeg(packagingManual) : policyPackaging;

  // Frete % auto-sugestão — cost_policies.freight_allocation_pct é uma referência
  // mas o usuário insere R$/par manualmente porque o cálculo aqui é em valor absoluto.
  const policyFreightAllocPct = Number(costPolicy?.freight_allocation_pct) || 0;

  // Defaults fiscais/comissão (cost_policies.default_*_pct, mig 20260530160000)
  const policyDefaultTaxPct = Number(costPolicy?.default_tax_pct) || 0;
  const policyDefaultCommissionPct = Number(costPolicy?.default_commission_pct) || 0;

  // Auto-fill somente no primeiro uso. Um cenário salvo (inclusive um campo
  // deixado em branco) sempre tem precedência sobre a política.
  useEffect(() => {
    if (!costPolicy) return;
    if (!Object.prototype.hasOwnProperty.call(saved, 'taxPct') && policyDefaultTaxPct > 0) setTaxPct(String(policyDefaultTaxPct));
    if (!Object.prototype.hasOwnProperty.call(saved, 'commissionPct') && policyDefaultCommissionPct > 0) setCommissionPct(String(policyDefaultCommissionPct));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costPolicy?.id]);

  // Fórmula (markup divisor, à vista, modo inverso) mora em src/lib/markupCalc.ts
  // — fonte única compartilhada com o painel Manual, travada por markupCalc.test.ts.
  const results = useMemo(() => {
    const numCost = totalMaterialCost;
    const numTax = parseBrlNumberNonNeg(taxPct);
    const numFactoring = parseBrlNumberNonNeg(factoringRatePct);
    const numDays = parseDaysInput(days);
    const numCommission = parseBrlNumberNonNeg(commissionPct);
    const numFreight = parseBrlNumberNonNeg(freightValue);
    const numOverhead = getOverhead();
    const numLabor = getLabor();
    const numPackaging = getPackaging();

    const totalCost = numCost + numLabor + numOverhead + numPackaging + numFreight;

    // Modo inverso: lucro-alvo em R$/par → margem % equivalente; null → margem digitada.
    const derivedMargin = deriveMarginFromTargetProfit({
      totalCost, taxPct: numTax, factoringMonthlyPct: numFactoring, days: parseDaysInstallments(days),
      commissionPct: numCommission, targetProfitBrl: parseBrlNumberNonNeg(targetProfitBrl),
    });
    const numProfit = derivedMargin ?? parseBrlNumberNonNeg(profitMarginPct);

    const calc = computeMarkupPrice({
      totalCost, taxPct: numTax, profitPct: numProfit,
      factoringMonthlyPct: numFactoring, days: parseDaysInstallments(days), commissionPct: numCommission,
    });
    // Aqui, além do divisor válido, exige custo de MP > 0 (sem BOM não há o que simular).
    const isValid = calc.isValid && numCost > 0;

    return {
      numCost, numLabor, numOverhead, numPackaging, numFreight, totalCost,
      factoringTotalPct: calc.factoringTotalPct, totalMarkupPct: calc.totalMarkupPct,
      markupDivisor: calc.markupDivisor,
      isValid,
      suggestedPrice: isValid ? calc.suggestedPrice : 0,
      cashPrice: isValid ? calc.cashPrice : 0,
      realProfit: isValid ? calc.realProfit : 0,
      taxValue: isValid ? calc.taxValue : 0,
      factoringValue: isValid ? calc.factoringValue : 0,
      commissionValue: isValid ? calc.commissionValue : 0,
      derivedMarginPct: derivedMargin,
      effectiveProfitPct: numProfit,
    };
  }, [totalMaterialCost, taxPct, factoringRatePct, days, profitMarginPct, targetProfitBrl, commissionPct, freightValue, overheadManual, laborManual, packagingManual, policyOverhead, policyLaborCost, policyPackaging]);

  return (
    <div className="space-y-5">
      {/* Seletor de ficha */}
      <Card className="slash-top">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Ficha técnica de origem
          </CardTitle>
          <CardDescription className="text-xs">
            Custo de matéria-prima é calculado automaticamente pelo motor de consumo da ficha
            selecionada — a mesma explosão usada no custeio do pedido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={sheetId} onValueChange={setSheetId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={loadingSheets ? 'Carregando fichas...' : 'Selecione uma ficha técnica...'} />
            </SelectTrigger>
            <SelectContent className="max-h-[60vh]">
              {sheets.map((s: any) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.code ? `${s.code} — ${s.name}` : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedSheet && (
            <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="secondary">{(selectedSheet as any).code || '—'}</Badge>
              <span className="font-medium">{(selectedSheet as any).name}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                Solado: {(selectedSheet as any).sole_material || '—'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Custo agregado + breakdown */}
      {sheetId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Custo de matéria-prima por par
              {loadingMaterials && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Modo de embalagem simulado — mesmo filtro de caixa do custeio do PV */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                <Box className="h-3 w-3" /> Modo de embalagem simulado
              </Label>
              <Select value={packagingMode} onValueChange={(v) => setPackagingMode(v as PackagingMode)}>
                <SelectTrigger className="h-8 text-xs sm:max-w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGING_MODE_CANONICAL.map(m => (
                    <SelectItem key={m} value={m} className="text-xs">
                      {PACKAGING_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loadingMaterials ? (
              <Skeleton className="h-32" />
            ) : engineBreakdown.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Motor de consumo não retornou materiais</p>
                  <p className="text-muted-foreground mt-0.5">
                    Preencha as Especificações (solado/forração/palmilha) e o BOM da ficha técnica
                    antes de simular preço.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Componente</th>
                        <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Material</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Consumo/par</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">R$/un</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Custo/par</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {engineBreakdown.map(b => (
                        <tr key={b.key}>
                          <td className="py-1.5 px-3 text-muted-foreground">{b.component}</td>
                          <td className="py-1.5 px-3 font-medium">
                            {b.name}
                            {!b.resolved && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] border-warning/50 text-warning">não resolvido</Badge>
                            )}
                            {b.unitMismatch && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] border-warning/50 text-warning">unidade divergente</Badge>
                            )}
                            {b.warning && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] border-warning/50 text-warning" title={b.warning}>aviso</Badge>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                            {b.qtyPerPair.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {b.unit}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums">{fmtBRL(b.unitPrice)}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums font-bold">{fmtBRL(b.costPerPair)}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/30 font-bold">
                        <td className="py-2 px-3 uppercase tracking-wider text-xs" colSpan={4}>Total matéria-prima por par</td>
                        <td className="py-2 px-3 text-right font-mono text-base text-primary">{fmtBRL(totalMaterialCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Linhas do motor canônico de consumo (grade base de {GRADE_BASE_QTY} pares,
                  1 solado resolvido, caixa filtrada pelo modo de embalagem) × preço unitário
                  de estoque — mesma composição do custeio do pedido.
                </p>
                {(selectedSheet as any)?.has_straps && (
                  <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Tiras não incluídas no custo MP</p>
                      <p className="text-muted-foreground mt-0.5">
                        O consumo de tiras depende das cores escolhidas no PV — entra no custeio do
                        pedido (calculate_order_cost), não nesta simulação por ficha. Considere uma
                        folga na margem ou some manualmente.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Mão de obra — breakdown das operações ativas */}
      {sheetId && totalMaterialCost > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              Mão de obra por par
              <Badge variant="secondary" className="ml-auto text-xs">
                {laborBreakdown.length} {laborBreakdown.length === 1 ? 'operação' : 'operações'}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              {laborSource === 'ficha' ? (
                <>
                  Operações da <strong>ficha selecionada</strong> (aba Operações — mesma fonte do
                  custeio do pedido): hora × tempo/par ÷ 60, só ativas.
                </>
              ) : (
                <>
                  Ficha sem operações próprias — usando o fallback global de{' '}
                  <code>labor_costs</code> (Financeiro · Operacional · Comissões & MO). Cadastre as
                  operações na aba <strong>Operações da ficha técnica</strong> pra MOD por modelo.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {laborBreakdown.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Nenhuma operação cadastrada</p>
                  <p className="text-muted-foreground mt-0.5">
                    O custo de mão de obra ficará zero. Cadastre as operações na aba
                    <strong> Operações da ficha técnica</strong> (fonte do custeio), ou use o
                    campo manual abaixo pra simular um valor.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Operação</th>
                      <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">R$/hora</th>
                      <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">min/par</th>
                      <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Custo/par</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {laborBreakdown.map(l => (
                      <tr key={l.id}>
                        <td className="py-1.5 px-3 font-medium">{l.operation}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{fmtBRL(l.hourCost)}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{l.minutesPerUnit}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums font-bold">{fmtBRL(l.costPerUnit)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-bold">
                      <td className="py-2 px-3 uppercase tracking-wider text-xs" colSpan={3}>Total mão de obra por par</td>
                      {/* C14: honra o override manual (getLabor) — antes mostrava só o
                          policyLaborCost e divergia do preço/breakdown quando havia override. */}
                      <td className="py-2 px-3 text-right font-mono text-base text-primary">{fmtBRL(getLabor())}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Inputs do simulador (manuais — só impostos/margem/etc) */}
      {sheetId && totalMaterialCost > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Parâmetros de venda</CardTitle>
            <CardDescription className="text-xs">
              Custo MP vem da ficha. Você define impostos, comissão, factoring, frete e a margem desejada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Factoring config — auto-preenche taxa + dias */}
            {factoringConfigs.length > 0 && (
              <div className="rounded-md border bg-primary/5 border-primary/20 p-2.5 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider font-bold text-primary flex items-center gap-1">
                  <Percent className="h-3 w-3" /> Factoring cadastrado
                </Label>
                <Select value={factoringConfigId} onValueChange={setFactoringConfigId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecionar factoring (auto-preenche taxa e prazo)..." />
                  </SelectTrigger>
                  <SelectContent>
                    {factoringConfigs.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name} — {fmt(Number(c.monthly_interest_rate))}%/mês · {c.receiving_days}d
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Selecionar uma config preenche automaticamente a taxa e o prazo abaixo. Você pode editar manualmente depois.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Margem desejada (%)
                  {results.derivedMarginPct !== null && (
                    <span className="ml-1 text-[10px] font-mono text-success">
                      auto · {fmt(results.derivedMarginPct)}%
                    </span>
                  )}
                </Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 25"
                  value={
                    results.derivedMarginPct !== null
                      ? results.derivedMarginPct.toFixed(2)
                      : profitMarginPct
                  }
                  onChange={e => {
                    setProfitMarginPct(e.target.value);
                    setTargetProfitBrl(''); // user editou margem → desativa modo inverso
                  }}
                  disabled={results.derivedMarginPct !== null}
                  className="mt-1 h-9 text-sm disabled:opacity-60 disabled:bg-muted/40"
                />
                {results.derivedMarginPct !== null && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Derivada do "quero receber" abaixo
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Impostos (%)</Label>
                <Input
                  type="number" step="0.01"
                  placeholder={policyDefaultTaxPct > 0 ? `Política: ${fmt(policyDefaultTaxPct)}` : 'Ex: 7.65'}
                  value={taxPct} onChange={e => setTaxPct(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                {policyDefaultTaxPct > 0 && !taxPct && (
                  <p className="text-xs text-muted-foreground mt-0.5">Default da política: <strong>{fmt(policyDefaultTaxPct)}%</strong></p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Comissão (%)</Label>
                <Input
                  type="number" step="0.01"
                  placeholder={policyDefaultCommissionPct > 0 ? `Política: ${fmt(policyDefaultCommissionPct)}` : 'Ex: 5'}
                  value={commissionPct} onChange={e => setCommissionPct(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                {policyDefaultCommissionPct > 0 && !commissionPct && (
                  <p className="text-xs text-muted-foreground mt-0.5">Default da política: <strong>{fmt(policyDefaultCommissionPct)}%</strong></p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Frete (R$/par)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 1.50"
                  value={freightValue} onChange={e => setFreightValue(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                {policyFreightAllocPct > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ref. política: <strong>{fmt(policyFreightAllocPct)}%</strong> alocação
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Factoring/mês (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 1.99"
                  value={factoringRatePct} onChange={e => setFactoringRatePct(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Prazo de recebimento</Label>
                <Input
                  placeholder="Ex: 30/60/90"
                  value={days} onChange={e => setDays(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-0.5">Use barras pra média (30/60/90)</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Mão de obra/par <span className="font-mono">(R$)</span>
                </Label>
                <Input
                  type="number" step="0.01"
                  placeholder={`Cadastrado: ${fmt(policyLaborCost)}`}
                  value={laborManual} onChange={e => setLaborManual(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vazio usa <strong>{fmtBRL(policyLaborCost)}</strong> (operações ativas)
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Overhead/par <span className="font-mono">(R$)</span>
                </Label>
                <Input
                  type="number" step="0.01"
                  placeholder={`Política: ${fmt(policyOverhead)}`}
                  value={overheadManual} onChange={e => setOverheadManual(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vazio usa <strong>{fmtBRL(policyOverhead)}</strong> (cost_policies)
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Box className="h-3 w-3" /> Embalagem/par <span className="font-mono">(R$)</span>
                </Label>
                <Input
                  type="number" step="0.01"
                  placeholder={`Política: ${fmt(policyPackaging)}`}
                  value={packagingManual} onChange={e => setPackagingManual(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vazio usa <strong>{fmtBRL(policyPackaging)}</strong> da política. Informe apenas custos fora do BOM.
                </p>
              </div>
            </div>

            {/* ── Modo inverso — mesmo do painel Manual: em vez de digitar a
                margem %, o usuário digita o lucro líquido que quer por par e o
                sistema deriva margem + preço (markupCalc.deriveMarginFromTargetProfit). ── */}
            <div className="rounded-lg border-[1.5px] border-dashed border-foreground/20 bg-muted/20 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <Label htmlFor="sheetTargetProfit" className="text-xs font-bold uppercase tracking-wide">
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
                    id="sheetTargetProfit"
                    type="number" step="0.01" min="0"
                    value={targetProfitBrl}
                    onChange={(e) => setTargetProfitBrl(e.target.value)}
                    className="pl-8 h-9 text-sm font-semibold"
                    placeholder="ex: 10,00"
                  />
                </div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Digite o lucro líquido por par (após impostos, factoring e comissão).
                  O sistema deriva a margem % e o preço de venda em cima do custo da ficha.
                </p>
              </div>
              {results.derivedMarginPct !== null && results.suggestedPrice > 0 && (
                <div className="mt-3 pt-3 border-t border-foreground/10 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">↑ Margem calculada</p>
                    <p className="text-lg font-bold text-success tabular-nums">{fmt(results.derivedMarginPct)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">↓ Preço de venda</p>
                    <p className="text-lg font-bold text-primary tabular-nums">R$ {fmt(results.suggestedPrice)}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {sheetId && totalMaterialCost > 0 && results.isValid && (
        <Card className="border-primary/30 bg-primary/5 slash-top">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">Resultado</CardTitle>
            <Button
              size="sm"
              variant="default"
              className="gap-1.5 h-7 text-xs"
              disabled={createSim.isPending}
              onClick={() => {
                const sheetMeta = sheets.find((s: any) => s.id === sheetId) as any;
                createSim.mutate({
                  sheet_id: sheetId,
                  sheet_code: sheetMeta?.code ?? null,
                  sheet_name: sheetMeta?.name ?? null,
                  material_cost: results.numCost,
                  labor_cost: results.numLabor,
                  overhead_cost: results.numOverhead,
                  packaging_cost: results.numPackaging,
                  freight_cost: results.numFreight,
                  total_cost: results.totalCost,
                  tax_pct: parseBrlNumberNonNeg(taxPct),
                  factoring_rate_pct: parseBrlNumberNonNeg(factoringRatePct),
                  factoring_days: parseDaysInput(days),
                  factoring_total_pct: results.factoringTotalPct,
                  commission_pct: parseBrlNumberNonNeg(commissionPct),
                  // margem EFETIVA (derivada do "quero receber" quando ativo)
                  profit_margin_pct: results.effectiveProfitPct,
                  suggested_price: results.suggestedPrice,
                  cash_price: results.cashPrice,
                  real_profit: results.realProfit,
                  notes: null,
                });
              }}
            >
              <Save className="h-3.5 w-3.5" />
              {createSim.isPending ? 'Salvando...' : 'Salvar simulação'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-card p-3 border">
                <p className="eyebrow">Custo total</p>
                <p className="display text-2xl tabular-nums mt-1">{fmtBRL(results.totalCost)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  MP {fmtBRL(results.numCost)}
                  {results.numLabor > 0 && ` + MO ${fmtBRL(results.numLabor)}`}
                  + OH {fmtBRL(results.numOverhead)}
                  {results.numPackaging > 0 && ` + Emb ${fmtBRL(results.numPackaging)}`}
                  {results.numFreight > 0 && ` + Frete ${fmtBRL(results.numFreight)}`}
                </p>
              </div>
              <div className="rounded-lg bg-card p-3 border border-primary/40">
                <p className="eyebrow text-primary">Preço sugerido</p>
                <p className="display text-2xl tabular-nums mt-1 text-primary">{fmtBRL(results.suggestedPrice)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Markup divisor {(results.markupDivisor * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-lg bg-card p-3 border">
                <p className="eyebrow">Preço à vista</p>
                <p className="display text-2xl tabular-nums mt-1">{fmtBRL(results.cashPrice)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">7 dias de factoring</p>
              </div>
              <div className="rounded-lg bg-card p-3 border border-success/40">
                <p className="eyebrow text-success">Lucro real</p>
                <p className="display text-2xl tabular-nums mt-1 text-success">{fmtBRL(results.realProfit)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmt(results.effectiveProfitPct)}% sobre venda
                </p>
              </div>
            </div>

            {/* Breakdown do markup */}
            <div className="text-xs space-y-1 pt-2 border-t">
              <p className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
                Decomposição do preço
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">Custo MP:</span><span className="tabular-nums">{fmtBRL(results.numCost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mão de obra:</span><span className="tabular-nums">{fmtBRL(results.numLabor)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Overhead:</span><span className="tabular-nums">{fmtBRL(results.numOverhead)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Embalagem:</span><span className="tabular-nums">{fmtBRL(results.numPackaging)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Frete:</span><span className="tabular-nums">{fmtBRL(results.numFreight)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Impostos:</span><span className="tabular-nums">{fmtBRL(results.taxValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Antecipação:</span><span className="tabular-nums">{fmtBRL(results.factoringValue)} ({fmt(results.factoringTotalPct)}%)</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Comissão:</span><span className="tabular-nums">{fmtBRL(results.commissionValue)}</span></div>
                <div className="flex justify-between font-bold"><span>Lucro real:</span><span className="tabular-nums text-success">{fmtBRL(results.realProfit)}</span></div>
                <div className="flex justify-between font-bold border-t pt-1"><span>Preço sugerido:</span><span className="tabular-nums text-primary">{fmtBRL(results.suggestedPrice)}</span></div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {sheetId && totalMaterialCost > 0 && !results.isValid && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Markup inválido</p>
              <p className="text-muted-foreground mt-0.5">
                A soma de impostos + margem + factoring + comissão chegou ou ultrapassou 100% — não é
                possível calcular um preço viável. Reduza algum dos parâmetros.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Histórico de simulações */}
      {simulations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico de simulações
              <Badge variant="secondary" className="ml-auto text-xs">
                {simulations.length} {simulations.length === 1 ? 'registro' : 'registros'}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Últimas simulações salvas (50 mais recentes). Use pra comparar margens entre épocas/clientes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Quando</th>
                    <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Ficha</th>
                    <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Custo</th>
                    <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Margem</th>
                    <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Preço</th>
                    <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-xs text-muted-foreground">Lucro</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {simulations.map(s => (
                    <tr key={s.id} className="hover:bg-muted/30">
                      <td className="py-1.5 px-3 font-mono tabular-nums text-muted-foreground">
                        {format(parseISO(s.created_at), 'dd/MM HH:mm')}
                      </td>
                      <td className="py-1.5 px-3 font-medium">
                        {s.sheet_code ? `${s.sheet_code} — ${s.sheet_name}` : (s.sheet_name || '—')}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{fmtBRL(s.total_cost)}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{fmt(s.profit_margin_pct)}%</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums font-bold text-primary">{fmtBRL(s.suggested_price)}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-success">{fmtBRL(s.real_profit)}</td>
                      <td className="py-1.5 px-3 text-right">
                        <DeleteConfirmButton onConfirm={() => deleteSim.mutate(s.id)} title="Excluir simulação?" size="h-6 w-6" iconSize="h-3 w-3" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
