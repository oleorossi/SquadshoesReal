import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendUp as TrendingUp } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';

export default function Forecast() {
  const { data: summary = [] } = useQuery({
    queryKey: ['sku_forecast_summary'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('v_sku_forecast_summary').select('*').limit(100);
      return data || [];
    },
  });

  const { data: detailed = [] } = useQuery({
    queryKey: ['sku_forecast_detail'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('v_sku_forecast').select('*').limit(200);
      return data || [];
    },
  });

  const totalMonthly = summary.reduce((s: number, r: any) => s + Number(r.total_forecast_monthly || 0), 0);
  const totalCurrent = summary.reduce((s: number, r: any) => s + Number(r.total_forecast_current_month || 0), 0);

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="Comercial · Planejamento"
        title="Forecast de Demanda"
        description="Média móvel 6 meses × sazonalidade por SKU (referência × cor × numeração)"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">Forecast Médio Mensal</p>
          <p className="text-2xl font-bold">{totalMonthly.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground">pares projetados / mês</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">Forecast Mês Atual (sazonal)</p>
          <p className="text-2xl font-bold text-primary">{totalCurrent.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground">ajustado por sazonalidade</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase">SKUs Ativos no Forecast</p>
          <p className="text-2xl font-bold">{detailed.length}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {summary.length === 0 ? (
            <div className="py-10 text-center">
              <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                Sem dados históricos suficientes (precisa &ge; 6 meses de PVs aprovados)
              </p>
            </div>
          ) : (
            <div className="divide-y">
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-3 p-3 bg-muted/30 text-[10px] font-bold uppercase text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
