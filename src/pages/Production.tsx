import { ProductionKanban } from "@/components/production/ProductionKanban";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
import { loadBottlenecksForOrders, BottleneckInfo } from "@/lib/sectorBottleneck";

export const Component = () => {
  const { data: orders = [], isLoading, refetch: refetchOrders } = useQuery({
    queryKey: ['kanban-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, 
          order_number, 
          quantity, 
          production_step,
          status,
          material_status,
          planned_delivery,
          is_ahead_of_schedule,
          technical_sheets:reference_id (
            name, 
            image_url,
            reference_color_variants (
              color,
              image_url
            )
          ),
          color,
          sale_orders:sale_order_id (client_name, client_order_number, delivery_deadline, billing_week, delivery_week, manual_billing_override, manual_override_reason, original_min_billing_date)
        `)
        .not('status', 'in', '("Rascunho","Cancelada","Finalizado")')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const { data: allStages = [], refetch: refetchStages } = useQuery({
    queryKey: ['kanban-stages'],
    queryFn: async () => {
      // Paginated fetch to bypass Supabase's default 1000-row limit.
      // order_stages can grow well beyond 1000 (8 stages per OP).
      const pageSize = 1000;
      let from = 0;
      const all: Array<{ order_id: string; stage_name: string; stage_order: number; status: string }> = [];
      // Hard cap to prevent runaway loops
      for (let i = 0; i < 20; i++) {
        const { data, error } = await supabase
          .from('order_stages')
          .select('order_id, stage_name, stage_order, status')
          .order('stage_order', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }
  });

  const orderIdList = useMemo(
    () => (orders as any[]).map((o: any) => o.id),
    [orders],
  );

  const { data: bottlenecks = new Map<string, BottleneckInfo>() } = useQuery({
    queryKey: ['kanban-bottlenecks', orderIdList.length],
    enabled: orderIdList.length > 0,
    queryFn: () => loadBottlenecksForOrders(orderIdList),
    staleTime: 60_000,
  });

  const kanbanOrders = useMemo(() => {
    const mapped = orders.map((o: any) => {
      const colorVariant = o.technical_sheets?.reference_color_variants?.find(
        (v: any) => (v.color?.toLowerCase().trim() || "") === (o.color?.toLowerCase().trim() || "")
      );

      // Derive current sector from order_stages
      const stages = allStages.filter((s: any) => s.order_id === o.id);
      let currentSector = 'Pendente';

      if (stages.length > 0) {
        const allCompleted = stages.every((s: any) => s.status === 'concluido');
        if (allCompleted) {
          currentSector = 'Pronto';
        } else {
          const sortedStages = [...stages].sort((a: any, b: any) => a.stage_order - b.stage_order);
          const firstPending = sortedStages.find((s: any) => s.status !== 'concluido');
          if (firstPending) {
            currentSector = firstPending.stage_name;
          }
        }
      }

      // Determine billing week for priority
      const billingWeek = o.sale_orders?.billing_week || o.sale_orders?.delivery_week || '';
      const deliveryDeadline = o.sale_orders?.delivery_deadline || o.planned_delivery || '';
      
      // Calculate if order is ahead of schedule
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadline = deliveryDeadline ? new Date(deliveryDeadline) : null;
      const daysUntilDeadline = deadline ? Math.ceil((deadline.getTime() - today.getTime()) / 86400000) : null;
      const isAhead = o.is_ahead_of_schedule || (daysUntilDeadline !== null && daysUntilDeadline > 14);

      return {
        id: o.id,
        order_number: o.order_number,
        client_order_number: o.sale_orders?.client_order_number,
        quantity: o.quantity,
        production_step: o.production_step || 'Pendente',
        current_sector: currentSector,
        reference_name: o.technical_sheets?.name,
        client_name: o.sale_orders?.client_name,
        material_status: o.material_status,
        image_url: (colorVariant?.image_url && colorVariant.image_url !== '') ? colorVariant.image_url : o.technical_sheets?.image_url,
        color: o.color,
        billing_week: billingWeek,
        delivery_deadline: deliveryDeadline,
        is_ahead_of_schedule: isAhead,
        manual_billing_override: !!o.sale_orders?.manual_billing_override,
        manual_override_reason: o.sale_orders?.manual_override_reason || null,
        original_min_billing_date: o.sale_orders?.original_min_billing_date || null,
        bottleneck: bottlenecks.get(o.id) || null,
      };
    });

    // Filter out completed orders (Pronto) — they should not appear in the production kanban
    const active = mapped.filter(o => o.current_sector !== 'Pronto');

    // Sort by billing_week ASC, then delivery_deadline ASC (priority)
    return active.sort((a, b) => {
      // First by billing week
      if (a.billing_week && b.billing_week) {
        const cmp = a.billing_week.localeCompare(b.billing_week);
        if (cmp !== 0) return cmp;
      }
      if (a.billing_week && !b.billing_week) return -1;
      if (!a.billing_week && b.billing_week) return 1;
      // Then by delivery deadline
      if (a.delivery_deadline && b.delivery_deadline) return a.delivery_deadline.localeCompare(b.delivery_deadline);
      if (a.delivery_deadline) return -1;
      if (b.delivery_deadline) return 1;
      return 0;
    });
  }, [orders, allStages, bottlenecks]);

  return (
    <div className="p-4 sm:p-6 page-enter">
        <header className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Produção Kanban</h1>
          <p className="text-sm text-muted-foreground">Fluxo automático por semana de faturamento — pedidos adiantados são sinalizados.</p>
        </header>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-[500px] gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Carregando kanban...</p>
          </div>
        ) : (
          <ProductionKanban orders={kanbanOrders} onRefresh={() => { void refetchOrders(); void refetchStages(); }} />
        )}
    </div>
  );
};

export default Component;
