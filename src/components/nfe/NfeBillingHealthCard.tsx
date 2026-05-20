import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface HealthRow {
  sale_order_id: string;
  order_number: string;
  client_name: string;
  so_status: string;
  nfe_required: boolean | null;
  total: number;
  delivery_deadline: string | null;
  nfes_autorizadas: number;
  nfes_ativas: number;
  ar_pendente: number;
  health: string;
}

const HEALTH_LABELS: Record<string, { label: string; tone: 'red' | 'amber' | 'muted' }> = {
  faturado_sem_nf: { label: 'Faturado sem NF', tone: 'red' },
  nf_emitida_status_atrasado: { label: 'NF emitida sem Faturado', tone: 'amber' },
  faturado_sem_ar: { label: 'Faturado sem AR', tone: 'amber' },
};

export function NfeBillingHealthCard() {
  const [expanded, setExpanded] = useState(false);
  const { data: rows = [], isLoading } = useQuery<HealthRow[]>({
    queryKey: ['v_sale_order_billing_health'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_sale_order_billing_health')
        .select('*')
        .not('health', 'in', '("ok","cancelado","informal_ok")');
      if (error) throw error;
      return (data || []) as HealthRow[];
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return null;

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.health] = (acc[r.health] || 0) + 1;
    return acc;
  }, {});

  if (rows.length === 0) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-medium">Nenhuma inconsistência fiscal detectada</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          PVs com inconsistência fiscal ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(counts).map(([key, cnt]) => {
            const cfg = HEALTH_LABELS[key] || { label: key, tone: 'muted' as const };
            const cls = cfg.tone === 'red'
              ? 'bg-red-500/10 text-red-600 border-red-500/20'
              : cfg.tone === 'amber'
              ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
              : 'bg-muted text-muted-foreground border-border';
            return (
              <Badge key={key} variant="outline" className={cls}>
                {cfg.label}: {cnt}
              </Badge>
            );
          })}
        </div>
        {expanded ? (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {rows.map(r => (
              <div key={r.sale_order_id} className="flex items-center justify-between gap-2 text-xs border-b border-border/40 py-1">
                <div className="flex flex-col">
                  <span className="font-mono font-medium">{r.order_number}</span>
                  <span className="text-muted-foreground">{r.client_name}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {(HEALTH_LABELS[r.health]?.label) || r.health}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Ocultar lista' : 'Ver lista detalhada'}
        </Button>
      </CardContent>
    </Card>
  );
}
