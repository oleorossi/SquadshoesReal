import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { TrendUp as TrendingUp } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApproveSopPlan, useCreateSopPlan, useSaveSopPlanItem, useSopPlanItems, useSopPlans, useSopSectorLoad, SopPlanItem } from '@/hooks/useSopPlanning';
import { CheckCircle, Plus, Rows } from '@phosphor-icons/react';

function ForecastData() {
  const { data: summary = [] } = useQuery({
    queryKey: ['sku_forecast_summary'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view legada fora do types.ts gerado
      const { data, error } = await (supabase as any).from('v_sku_forecast_summary').select('*').limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: detailed = [] } = useQuery({
    queryKey: ['sku_forecast_detail'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view legada fora do types.ts gerado
      const { data, error } = await (supabase as any).from('v_sku_forecast').select('*').limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const totalMonthly = summary.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_forecast_monthly || 0), 0);
  const totalCurrent = summary.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total_forecast_current_month || 0), 0);

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard
          label="Forecast Médio Mensal"
          value={totalMonthly.toFixed(0)}
          unit="pares"
          hint="projetados / mês"
        />
        <StatCard
          label="Forecast Mês Atual (sazonal)"
          value={totalCurrent.toFixed(0)}
          unit="pares"
          hint="ajustado por sazonalidade"
          tone="primary"
        />
        <StatCard
          label="SKUs Ativos no Forecast"
          value={detailed.length}
          hint="referência × cor × numeração"
        />
      </StatGrid>

      <Panel flush>
          {summary.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Sem dados históricos suficientes"
              description="É necessário ≥ 6 meses de PVs aprovados para projetar a demanda."
            />
          ) : (
            <div className="divide-y">
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-3 p-3 bg-muted/30 text-xs font-bold uppercase text-muted-foreground">
                <span>Modelo / Cor</span>
                <span className="text-right">Tamanhos</span>
                <span className="text-right">Vendido 6m</span>
                <span className="text-right">Média/mês</span>
                <span className="text-right">Mês atual</span>
              </div>
              {summary.map((r: Record<string, unknown>) => (
                <div key={`${r.reference_id}-${r.color}`} className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-3 p-3 text-sm items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RefChip code={String(r.reference_code || '')} />
                      <p className="font-semibold truncate">{String(r.reference_name || '')}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{String(r.color || 'sem cor')}</p>
                  </div>
                  <Badge variant="outline" className="justify-self-end font-mono">{String(r.sizes_count || 0)}</Badge>
                  <span className="text-right font-mono">{Number(r.total_sold_6m).toFixed(0)}</span>
                  <span className="text-right font-mono font-semibold">{Number(r.total_forecast_monthly).toFixed(0)}</span>
                  <span className="text-right font-mono font-bold text-primary">{Number(r.total_forecast_current_month).toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
      </Panel>
    </div>
  );
}

export default function Forecast() {
  return (
    <div className="space-y-4">
      <EditorialPageHeader sectionLabel="COMERCIAL · FORECAST E S&OP" title="Forecast de Demanda" description="Previsão estatística, carteira confirmada e consenso mensal para planejar a capacidade dos setores." />
      <Tabs defaultValue="forecast">
        <TabsList>
          <TabsTrigger value="forecast"><TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Forecast</TabsTrigger>
          <TabsTrigger value="sop"><Rows className="mr-1.5 h-3.5 w-3.5" /> S&OP</TabsTrigger>
        </TabsList>
        <TabsContent value="forecast" className="mt-4"><ForecastData /></TabsContent>
        <TabsContent value="sop" className="mt-4"><SopPlanning /></TabsContent>
      </Tabs>
    </div>
  );
}

function SopPlanning() {
  const { data: plans = [] } = useSopPlans();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedPlan = plans.find(plan => plan.id === selectedId) || plans[0] || null;
  const { data: items = [], isLoading: itemsLoading } = useSopPlanItems(selectedPlan?.id || null);
  const { data: sectorLoad = [] } = useSopSectorLoad(selectedPlan?.id || null);
  const createPlan = useCreateSopPlan();
  const approvePlan = useApproveSopPlan();
  const saveItem = useSaveSopPlanItem();
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [scenario, setScenario] = useState<'conservador' | 'base' | 'agressivo'>('base');
  const [drafts, setDrafts] = useState<Record<string, SopPlanItem>>({});
  const plan = selectedPlan;
  const editable = plan?.status === 'rascunho';
  const rows = items.map(item => drafts[item.id] || item);
  const updateDraft = (item: SopPlanItem, field: 'forecast_pairs' | 'confirmed_pairs' | 'adjustment_pairs', value: string) => {
    const numeric = Number(value);
    setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] || item), [field]: Number.isFinite(numeric) ? numeric : 0 } }));
  };
  const saveDraft = (item: SopPlanItem) => {
    const draft = drafts[item.id];
    if (!draft) return;
    saveItem.mutate(draft, { onSuccess: () => setDrafts(current => { const next = { ...current }; delete next[item.id]; return next; }) });
  };

  return <div className="space-y-4">
    <Panel className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium">Mês
          <Input type="month" value={periodMonth} onChange={e => setPeriodMonth(e.target.value)} className="w-40" />
        </label>
        <label className="grid gap-1 text-xs font-medium">Cenário
          <Select value={scenario} onValueChange={value => setScenario(value as typeof scenario)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conservador">Conservador</SelectItem>
              <SelectItem value="base">Base</SelectItem>
              <SelectItem value="agressivo">Agressivo</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Button disabled={!periodMonth || createPlan.isPending} onClick={() => createPlan.mutate({ periodMonth: `${periodMonth}-01`, scenario }, { onSuccess: id => { setSelectedId(id); setDrafts({}); } })}><Plus className="mr-1.5 h-4 w-4" /> Criar plano</Button>
        {plans.length > 0 && <label className="ml-auto grid gap-1 text-xs font-medium">Plano
          <Select value={plan?.id || ''} onValueChange={value => { setSelectedId(value); setDrafts({}); }}>
            <SelectTrigger className="max-w-[290px]"><SelectValue /></SelectTrigger>
            <SelectContent searchPlaceholder="Buscar plano por mês, cenário ou status…" searchLabel="Localizar plano">
              {plans.map(p => <SelectItem key={p.id} value={p.id}>{new Date(`${p.period_month}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · {p.scenario} · {p.status}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">O S&OP consolida demanda e capacidade mensal; ele não cria nem reprioriza OPs da agenda diária.</p>
    </Panel>
    {!plan ? <EmptyState icon={TrendingUp} title="Crie o primeiro plano S&OP" description="O plano começa com forecast mensal e carteira confirmada do mês escolhido." /> : <>
      <div className="flex items-center gap-2"><Badge variant={plan.status === 'aprovado' ? 'default' : 'outline'}>{plan.status}</Badge><span className="text-sm text-muted-foreground">{rows.length} referências/cor</span>{editable && <Button className="ml-auto" size="sm" disabled={approvePlan.isPending || rows.length === 0} onClick={() => approvePlan.mutate(plan.id)}><CheckCircle className="mr-1.5 h-4 w-4" /> Aprovar e travar</Button>}</div>
      <Panel flush>
        {itemsLoading ? <div className="p-4 text-sm text-muted-foreground">Carregando plano…</div> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b bg-muted/30 text-left text-muted-foreground"><th className="p-3">Referência / cor</th><th className="p-3 text-right">Forecast</th><th className="p-3 text-right">Carteira</th><th className="p-3 text-right">Ajuste</th><th className="p-3 text-right">Plano</th><th className="p-3"></th></tr></thead><tbody>{rows.map(item => <tr className="border-b border-border/60" key={item.id}><td className="p-3"><RefChip code={item.reference_code} /> <span className="ml-1 font-medium">{item.reference_name}</span><span className="ml-1 text-muted-foreground">· {item.color || 'sem cor'}</span></td>{(['forecast_pairs', 'confirmed_pairs', 'adjustment_pairs'] as const).map(field => <td className="p-2" key={field}><Input disabled={!editable} type="number" min={field === 'adjustment_pairs' ? undefined : 0} value={item[field]} onChange={e => updateDraft(item, field, e.target.value)} className="ml-auto h-8 w-24 text-right" /></td>)}<td className="p-3 text-right font-mono font-bold">{Math.max(item.confirmed_pairs, item.forecast_pairs + item.adjustment_pairs)}</td><td className="p-2">{editable && drafts[item.id] && <Button size="sm" variant="outline" onClick={() => saveDraft(item)} disabled={saveItem.isPending}>Salvar</Button>}</td></tr>)}</tbody></table></div>}
      </Panel>
      <Panel flush><div className="border-b p-3 text-sm font-semibold">Carga mensal por setor</div><div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">{sectorLoad.map(load => <div className="flex items-center justify-between p-3 text-sm" key={load.sector}><div><p className="font-medium">{load.sector}</p><p className="text-xs text-muted-foreground">{load.planned_pairs} pares planejados · {load.open_order_pairs} pares já abertos</p></div><Badge variant="outline" className={load.utilization_pct > 100 ? 'border-primary text-primary' : ''}>{load.utilization_pct}%</Badge></div>)}</div></Panel>
    </>}
  </div>;
}
