import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  ClipboardText,
  Factory,
  Package,
  ShieldCheck,
  Tag,
  Warning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  evaluateTechnicalSheetReadiness,
  type TechnicalSheetAuditSignals,
  type TechnicalSheetReadinessInput,
  type TechnicalSheetReadinessStageKey,
  type TechnicalSheetReadinessTab,
} from '@/lib/technicalSheetReadiness';

const STAGE_ICONS = {
  identity: Tag,
  engineering: ClipboardText,
  stock: Package,
  production: Factory,
  release: ShieldCheck,
} satisfies Record<TechnicalSheetReadinessStageKey, typeof Tag>;

interface Props {
  sheet: TechnicalSheetReadinessInput;
  audit?: TechnicalSheetAuditSignals | null;
  auditLoaded?: boolean;
  onSelectTab: (tab: TechnicalSheetReadinessTab) => void;
}

export function TechnicalSheetReadinessRail({ sheet, audit, auditLoaded, onSelectTab }: Props) {
  const resolvedAudit = auditLoaded ? (audit || {}) : undefined;
  const stages = useMemo(
    () => evaluateTechnicalSheetReadiness(sheet, resolvedAudit),
    [sheet, resolvedAudit],
  );
  const readyCount = stages.filter((stage) => stage.ready).length;
  const { data: usage } = useQuery({
    queryKey: ['technical_sheet_operational_usage', sheet.id],
    enabled: Boolean(sheet.id),
    staleTime: 60_000,
    queryFn: async () => {
      const [items, openOrders, staleSnapshots] = await Promise.all([
        supabase.from('sale_order_items').select('id', { count: 'exact', head: true }).eq('reference_id', sheet.id || ''),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('reference_id', sheet.id || '')
          .not('status', 'in', '(Finalizado,Cancelada,Cancelado)'),
        supabase.from('technical_sheet_snapshots').select('sale_order_id')
          .eq('sheet_id', sheet.id || '')
          .not('outdated_at', 'is', null),
      ]);
      const error = items.error || openOrders.error || staleSnapshots.error;
      if (error) throw error;
      const saleOrderIds = Array.from(new Set(
        (staleSnapshots.data || []).map((snapshot) => snapshot.sale_order_id).filter(Boolean),
      )) as string[];
      let actionableStaleSnapshots = 0;
      if (saleOrderIds.length > 0) {
        const { count, error: staleError } = await supabase
          .from('v_pv_outdated_status')
          .select('sale_order_id', { count: 'exact', head: true })
          .in('sale_order_id', saleOrderIds)
          .neq('status_label', 'in_sync');
        if (staleError) throw staleError;
        actionableStaleSnapshots = count || 0;
      }
      return {
        saleItems: items.count || 0,
        openOrders: openOrders.count || 0,
        staleSnapshots: actionableStaleSnapshots,
      };
    },
  });

  return (
    <section className="rounded-xl border bg-card" aria-label="Prontidão industrial da ficha">
      <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">Prontidão industrial</p>
            <Badge variant={readyCount === stages.length ? 'default' : 'outline'} className="font-mono text-xs">
              {readyCount}/{stages.length} etapas
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Uma única linha entre engenharia, unidade de estoque, produção e liberação comercial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{usage?.saleItems ?? 0} item(ns) de PV</span>
          <span aria-hidden="true">·</span>
          <span>{usage?.openOrders ?? 0} OP(s) aberta(s)</span>
          {(usage?.staleSnapshots || 0) > 0 && (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
              {usage?.staleSnapshots} PV(s) para sincronizar
            </Badge>
          )}
          <Button variant="link" size="sm" className="h-auto px-1 text-xs" asChild>
            <Link to="/sales?view=pendencias">Pedidos</Link>
          </Button>
          <Button variant="link" size="sm" className="h-auto px-1 text-xs" asChild>
            <Link to="/reservas-estoque">Reservas</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-5">
        {stages.map((stage) => {
          const Icon = STAGE_ICONS[stage.key];
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => onSelectTab(stage.tab)}
              className={cn(
                'min-h-24 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                !stage.ready && 'bg-warning/5',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                  <Icon className="h-4 w-4" />
                  {stage.label}
                </span>
                {stage.ready ? (
                  <CheckCircle className="h-4 w-4 text-success" weight="fill" />
                ) : (
                  <Warning className="h-4 w-4 text-warning" weight="fill" />
                )}
              </div>
              <p className={cn('mt-3 text-xs leading-relaxed', stage.ready ? 'text-success' : 'text-muted-foreground')}>
                {stage.ready
                  ? 'Etapa pronta'
                  : `Revisar: ${stage.issues.join(', ')}`}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
