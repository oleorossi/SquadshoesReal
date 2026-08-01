import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { TrendUp as TrendingUp } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

export default function Forecast() {
  const { data: summary = [] } = useQuery({
    queryKey: ['sku_forecast_summary'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_sku_forecast_summary').select('*').limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: detailed = [] } = useQuery({
    queryKey: ['sku_forecast_detail'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_sku_forecast').select('*').limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const totalMonthly = summary.reduce((s: number, r: any) => s + Number(r.total_forecast_monthly || 0), 0);
  const totalCurrent = summary.reduce((s: number, r: any) => s + Number(r.total_forecast_current_month || 0), 0);

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · FORECAST"
        title="Forecast de Demanda"
        description="Média móvel 6 meses × sazonalidade por SKU (referência × cor × numeração)"
      />

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
              {summary.map((r: any) => (
                <div key={`${r.reference_id}-${r.color}`} className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-3 p-3 text-sm items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RefChip code={r.reference_code} />
                      <p className="font-semibold truncate">{r.reference_name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.color || 'sem cor'}</p>
                  </div>
                  <Badge variant="outline" className="justify-self-end font-mono">{r.sizes_count}</Badge>
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
