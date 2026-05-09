/**
 * PricingByTechnicalSheetPanel — calculadora de markup automática.
 *
 * Auto-preenche o custo de matéria-prima a partir do BOM da ficha técnica
 * selecionada (sheet_materials × products.unit_price × (1 + waste_pct)).
 *
 * Diferente do PricingCalculatorPanel (todo manual), aqui:
 *   • Select de ficha técnica (busca em useTechnicalSheets)
 *   • Custo MP é READ-ONLY — vem do BOM
 *   • Breakdown de materiais visível pra auditoria
 *   • Overhead vem de cost_policies (mesma fonte do panel manual)
 *   • Inputs MANUAIS: impostos, factoring, dias, comissão, margem, frete
 *   • Mesma fórmula de markup divisor → preço sugerido + margem real
 */
import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { useCostPolicies } from '@/hooks/useCostPolicies';
import { useTechnicalSheets, useSheetMaterials } from '@/hooks/useTechnicalSheets';
import { useComponentSheets } from '@/hooks/useComponentSheets';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const STORAGE_KEY = 'pricing-by-sheet-state';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type SavedState = {
  sheetId?: string;
  taxPct?: string;
  factoringRatePct?: string;
  days?: string;
  profitMarginPct?: string;
  commissionPct?: string;
  freightValue?: string;
  overheadManual?: string;
};

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default function PricingByTechnicalSheetPanel() {
  const saved = useMemo(() => loadSaved(), []);
  const { data: costPolicy } = useCostPolicies();
  const { data: sheets = [], isLoading: loadingSheets } = useTechnicalSheets();
  const { data: componentSheets = [] } = useComponentSheets();

  // Overhead derivado de cost_policies (mesma fórmula do panel manual)
  const policyOverhead = useMemo(() => {
    if (!costPolicy) return 0;
    const target = costPolicy.monthly_production_target || 1;
    return (costPolicy.overhead_monthly_total || 0) / target;
  }, [costPolicy]);

  const [sheetId, setSheetId] = useState<string>(saved.sheetId ?? '');
  const [taxPct, setTaxPct] = useState(saved.taxPct ?? '');
  const [factoringRatePct, setFactoringRatePct] = useState(saved.factoringRatePct ?? '');
  const [days, setDays] = useState(saved.days ?? '');
  const [profitMarginPct, setProfitMarginPct] = useState(saved.profitMarginPct ?? '');
  const [commissionPct, setCommissionPct] = useState(saved.commissionPct ?? '');
  const [freightValue, setFreightValue] = useState(saved.freightValue ?? '');
  const [overheadManual, setOverheadManual] = useState(saved.overheadManual ?? '');

  // Persiste a cada mudança
  useEffect(() => {
    const state: SavedState = {
      sheetId, taxPct, factoringRatePct, days, profitMarginPct,
      commissionPct, freightValue, overheadManual,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [sheetId, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual]);

  const { data: materials = [], isLoading: loadingMaterials } = useSheetMaterials(sheetId || null);

  // Mapa product_id → component_sheet (pra waste_pct)
  const componentSheetMap = useMemo(() => {
    const map: Record<string, any> = {};
    componentSheets.forEach((cs: any) => { map[cs.product_id] = cs; });
    return map;
  }, [componentSheets]);

  // Custo MP vindo do BOM (replica getCostPerPair de TechnicalSheets.tsx:4301)
  const bomBreakdown = useMemo(() => {
    return materials
      .map((m: any) => {
        const prod = m.products;
        if (!prod) return null;
        const unitPrice = Number(prod.unit_price || 0);
        const cs = componentSheetMap[m.product_id];
        const wastePct = cs ? (cs.waste_pct || 0) : 0;
        const rawCost = Number(m.quantity_per_unit) * unitPrice;
        const finalCost = rawCost * (1 + wastePct / 100);
        return {
          id: m.id,
          name: prod.name || '—',
          unit: prod.unit || 'un',
          quantity: Number(m.quantity_per_unit) || 0,
          unitPrice,
          wastePct,
          rawCost,
          finalCost,
        };
      })
      .filter(Boolean) as Array<{
        id: string; name: string; unit: string; quantity: number;
        unitPrice: number; wastePct: number; rawCost: number; finalCost: number;
      }>;
  }, [materials, componentSheetMap]);

  const totalMaterialCost = useMemo(
    () => bomBreakdown.reduce((sum, b) => sum + b.finalCost, 0),
    [bomBreakdown]
  );

  const selectedSheet = useMemo(
    () => sheets.find((s: any) => s.id === sheetId),
    [sheets, sheetId]
  );

  const getOverhead = () => {
    const v = parseFloat(overheadManual);
    return !isNaN(v) && v >= 0 && overheadManual.trim() !== '' ? v : policyOverhead;
  };

  // Suporta "60" ou "30/60/90" → média
  const parseDays = (input: string): number => {
    const trimmed = input.trim();
    if (!trimmed) return 0;
    const parts = trimmed.split('/').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (parts.length === 0) return 0;
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  };

  const results = useMemo(() => {
    const numCost = totalMaterialCost;
    const numTax = parseFloat(taxPct) || 0;
    const numFactoring = parseFloat(factoringRatePct) || 0;
    const numDays = parseDays(days);
    const numProfit = parseFloat(profitMarginPct) || 0;
    const numCommission = parseFloat(commissionPct) || 0;
    const numFreight = parseFloat(freightValue) || 0;
    const numOverhead = getOverhead();

    const totalCost = numCost + numOverhead + numFreight;
    const factoringTotalPct = (numFactoring / 30) * numDays;
    const totalMarkupPct = numTax + numProfit + factoringTotalPct + numCommission;
    const markupDivisor = 1 - (totalMarkupPct / 100);
    const isValid = markupDivisor > 0 && numCost > 0;
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

    return {
      numCost, numOverhead, numFreight, totalCost,
      factoringTotalPct, totalMarkupPct, markupDivisor,
      isValid, suggestedPrice, cashPrice,
      realProfit, taxValue, factoringValue, commissionValue,
    };
  }, [totalMaterialCost, taxPct, factoringRatePct, days, profitMarginPct, commissionPct, freightValue, overheadManual, policyOverhead]);

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
            Custo de matéria-prima é calculado automaticamente pelo BOM da ficha selecionada.
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
          <CardContent>
            {loadingMaterials ? (
              <Skeleton className="h-32" />
            ) : bomBreakdown.length === 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Ficha sem materiais no BOM</p>
                  <p className="text-muted-foreground mt-0.5">
                    Cadastre os materiais na aba BOM da ficha técnica antes de simular preço.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left py-2 px-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Material</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Consumo/par</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">R$/un</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Perda</th>
                        <th className="text-right py-2 px-3 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Custo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {bomBreakdown.map(b => (
                        <tr key={b.id}>
                          <td className="py-1.5 px-3 font-medium">{b.name}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                            {b.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {b.unit}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums">{fmtBRL(b.unitPrice)}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">
                            {b.wastePct > 0 ? `+${b.wastePct}%` : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums font-bold">{fmtBRL(b.finalCost)}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/30 font-bold">
                        <td className="py-2 px-3 uppercase tracking-wider text-[11px]" colSpan={4}>Total matéria-prima por par</td>
                        <td className="py-2 px-3 text-right font-mono text-base text-primary">{fmtBRL(totalMaterialCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Fórmula: Σ (consumo/par × preço unitário × (1 + perda %)) por material do BOM.
                </p>
              </>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Margem desejada (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 25"
                  value={profitMarginPct} onChange={e => setProfitMarginPct(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Impostos (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 7.65"
                  value={taxPct} onChange={e => setTaxPct(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Comissão (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 5"
                  value={commissionPct} onChange={e => setCommissionPct(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Frete (R$/par)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 1.50"
                  value={freightValue} onChange={e => setFreightValue(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground">Factoring/mês (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="Ex: 1.99"
                  value={factoringRatePct} onChange={e => setFactoringRatePct(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Prazo de recebimento</Label>
                <Input
                  placeholder="Ex: 30/60/90"
                  value={days} onChange={e => setDays(e.target.value)}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Use barras pra média (30/60/90)</p>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">
                  Overhead/par <span className="font-mono">(R$)</span>
                </Label>
                <Input
                  type="number" step="0.01"
                  placeholder={`Política: ${fmt(policyOverhead)}`}
                  value={overheadManual} onChange={e => setOverheadManual(e.target.value)}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Vazio usa <strong>{fmtBRL(policyOverhead)}</strong> (cost_policies)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {sheetId && totalMaterialCost > 0 && results.isValid && (
        <Card className="border-primary/30 bg-primary/5 slash-top">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-card p-3 border">
                <p className="eyebrow">Custo total</p>
                <p className="display text-2xl tabular-nums mt-1">{fmtBRL(results.totalCost)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  MP {fmtBRL(results.numCost)} + OH {fmtBRL(results.numOverhead)}
                  {results.numFreight > 0 && ` + Frete ${fmtBRL(results.numFreight)}`}
                </p>
              </div>
              <div className="rounded-lg bg-card p-3 border border-primary/40">
                <p className="eyebrow text-primary">Preço sugerido</p>
                <p className="display text-2xl tabular-nums mt-1 text-primary">{fmtBRL(results.suggestedPrice)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Markup divisor {(results.markupDivisor * 100).toFixed(1)}%
                </p>
              </div>
              <div className="rounded-lg bg-card p-3 border">
                <p className="eyebrow">Preço à vista</p>
                <p className="display text-2xl tabular-nums mt-1">{fmtBRL(results.cashPrice)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">7 dias de factoring</p>
              </div>
              <div className="rounded-lg bg-card p-3 border border-success/40">
                <p className="eyebrow text-success">Lucro real</p>
                <p className="display text-2xl tabular-nums mt-1 text-success">{fmtBRL(results.realProfit)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {profitMarginPct || 0}% sobre venda
                </p>
              </div>
            </div>

            {/* Breakdown do markup */}
            <div className="text-xs space-y-1 pt-2 border-t">
              <p className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground mb-2">
                Decomposição do preço
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">Custo MP:</span><span className="tabular-nums">{fmtBRL(results.numCost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Overhead:</span><span className="tabular-nums">{fmtBRL(results.numOverhead)}</span></div>
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
    </div>
  );
}
