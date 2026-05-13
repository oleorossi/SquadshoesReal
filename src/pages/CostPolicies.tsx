/**
 * Políticas de Custo — tela de edição dos defaults usados pelo sistema.
 *
 * Cobre os campos do registro `cost_policies` (active=true):
 *   - overhead_monthly_total + monthly_production_target → R$/par derivado
 *   - packaging_cost_per_pair
 *   - freight_allocation_pct
 *   - default_tax_pct + default_commission_pct (Markup defaults)
 *
 * Usado por: Markup (PricingByTechnicalSheetPanel), order costs,
 * indicadores financeiros — fonte da verdade pra defaults fiscais/operacionais.
 */
import { useState, useEffect, useMemo } from 'react';
import { useCostPolicies, useUpdateCostPolicy } from '@/hooks/useCostPolicies';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FloppyDisk as Save, ArrowsClockwise as RefreshCw, Calculator, Cube as Box, Truck, Receipt, Percent, WarningCircle as AlertCircle } from '@phosphor-icons/react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CostPolicies() {
  const { data: policy, isLoading } = useCostPolicies();
  const update = useUpdateCostPolicy();

  // Estado local (string pra inputs aceitarem digitação livre)
  const [form, setForm] = useState({
    overhead_monthly_total: '',
    monthly_production_target: '',
    packaging_cost_per_pair: '',
    freight_allocation_pct: '',
    default_tax_pct: '',
    default_commission_pct: '',
  });

  // Inicializa quando a policy carrega
  useEffect(() => {
    if (!policy) return;
    setForm({
      overhead_monthly_total: String(policy.overhead_monthly_total ?? ''),
      monthly_production_target: String(policy.monthly_production_target ?? ''),
      packaging_cost_per_pair: String(policy.packaging_cost_per_pair ?? ''),
      freight_allocation_pct: String(policy.freight_allocation_pct ?? ''),
      default_tax_pct: String(policy.default_tax_pct ?? ''),
      default_commission_pct: String(policy.default_commission_pct ?? ''),
    });
  }, [policy]);

  // Overhead/par derivado em tempo real
  const derivedOverhead = useMemo(() => {
    const total = parseFloat(form.overhead_monthly_total) || 0;
    const target = parseFloat(form.monthly_production_target) || 0;
    if (target <= 0) return 0;
    return total / target;
  }, [form.overhead_monthly_total, form.monthly_production_target]);

  const handleSave = () => {
    if (!policy) return;
    update.mutate({
      id: policy.id,
      data: {
        overhead_monthly_total: parseFloat(form.overhead_monthly_total) || 0,
        monthly_production_target: parseFloat(form.monthly_production_target) || 0,
        packaging_cost_per_pair: parseFloat(form.packaging_cost_per_pair) || 0,
        freight_allocation_pct: parseFloat(form.freight_allocation_pct) || 0,
        default_tax_pct: parseFloat(form.default_tax_pct) || 0,
        default_commission_pct: parseFloat(form.default_commission_pct) || 0,
        // Mantém overhead_rate_per_pair sincronizado (alguns lugares legacy leem essa coluna direto)
        overhead_rate_per_pair: derivedOverhead,
      },
    });
  };

  return (
    <div className="space-y-5 page-enter max-w-4xl">
      {/* Header */}
      <div>
        <div className="eyebrow">Financeiro · Configuração</div>
        <h1 className="display text-2xl mt-1.5 sm:text-3xl">Políticas de Custo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defaults usados pelo simulador Markup, cálculo de custo de OP e indicadores financeiros.
          Mudanças aqui afetam novos cálculos imediatamente; simulações já salvas mantêm o snapshot original.
        </p>
      </div>

      {isLoading || !policy ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-4">
          {/* Overhead */}
          <Card className="slash-top">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                Overhead operacional
              </CardTitle>
              <CardDescription className="text-xs">
                Custos fixos mensais (aluguel, energia, administrativo) rateados por capacidade de produção.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Total mensal de overhead (R$)</Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.overhead_monthly_total}
                  onChange={e => setForm(f => ({ ...f, overhead_monthly_total: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Capacidade mensal (pares)</Label>
                <Input
                  type="number" step="1" min={0}
                  value={form.monthly_production_target}
                  onChange={e => setForm(f => ({ ...f, monthly_production_target: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Overhead por par (calculado)</span>
                  <span className="display text-xl tabular-nums text-primary">{fmtBRL(derivedOverhead)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Total ÷ capacidade. Atualiza ao mudar os campos acima.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Embalagem + Frete */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Box className="h-4 w-4 text-primary" />
                Embalagem & Frete
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs flex items-center gap-1.5">
                  <Box className="h-3 w-3" /> Custo de embalagem por par (R$)
                </Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.packaging_cost_per_pair}
                  onChange={e => setForm(f => ({ ...f, packaging_cost_per_pair: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Soma das caixas + fitilho + acessórios de embalagem médios por par.
                </p>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1.5">
                  <Truck className="h-3 w-3" /> Alocação de frete (%)
                </Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.freight_allocation_pct}
                  onChange={e => setForm(f => ({ ...f, freight_allocation_pct: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Referência de frete sobre receita — usada como hint no Markup.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Defaults fiscais */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                Defaults fiscais (Markup)
              </CardTitle>
              <CardDescription className="text-xs">
                Pré-preenchem os campos do simulador Markup. Vazio = sem auto-fill.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs flex items-center gap-1.5">
                  <Percent className="h-3 w-3" /> Imposto total padrão (%)
                </Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.default_tax_pct}
                  onChange={e => setForm(f => ({ ...f, default_tax_pct: e.target.value }))}
                  placeholder="Ex: 7.65 (PIS+COFINS+ICMS+ISS)"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1.5">
                  <Percent className="h-3 w-3" /> Comissão padrão (%)
                </Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={form.default_commission_pct}
                  onChange={e => setForm(f => ({ ...f, default_commission_pct: e.target.value }))}
                  placeholder="Ex: 5"
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* Resumo + Ações */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="text-xs space-y-0.5">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-semibold">Política ativa:</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{policy.id.slice(0, 8)}…</span>
                </div>
                <p className="text-muted-foreground">
                  Custo/par estimado (sem material/MO):
                  <strong className="text-foreground tabular-nums ml-1">
                    {fmtBRL(derivedOverhead + (parseFloat(form.packaging_cost_per_pair) || 0))}
                  </strong>
                  {' '}(overhead + embalagem)
                </p>
              </div>
              <Button
                onClick={handleSave}
                disabled={update.isPending}
                className="gap-1.5"
              >
                {update.isPending ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Salvando...</>
                ) : (
                  <><Save className="h-3.5 w-3.5" /> Salvar políticas</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
