import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Invalida TODAS as caches afetadas por uma transição de produção,
 * garantindo sincronia entre PCP Hub, Kanban, Ordens, Setores e Ondas.
 */
export function invalidateProductionCaches(queryClient: ReturnType<typeof useQueryClient>) {
  const keys = [
    ['orders'],
    ['order_stages'],
    ['production_orders'],
    ['notifications'],
    // Kanban (Production.tsx)
    ['kanban-orders'],
    ['kanban-stages'],
    // PCP Hub — Ordens (Orders.tsx)
    ['sale_orders_for_ops'],
    // PCP Hub — Dashboard / KPIs
    ['producao-kpis'],
    // Setores de produção (Corte Palmilha, Corte Forração, Mesa, Silk, Colagem, Montagem, Solagem, Acabamento, Expedição)
    ['sector-board'],
    // Ondas de produção
    ['waves'],
    ['wave-detail'],
    ['finishing-packages'],
    // Pedidos de venda (refletem progresso da OP)
    ['sale_orders'],
  ];
  keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
}

export function useProductionTransitions() {
  const queryClient = useQueryClient();

  const finalizeSectorTask = async (orderId: string, currentSector: string) => {
    try {
      const { data, error } = await supabase.rpc('finalize_production_sector', {
        p_order_id: orderId,
        p_current_sector: currentSector
      });

      if (error) throw error;

      invalidateProductionCaches(queryClient);

      return data;
    } catch (err: any) {
      console.error(`Erro na transição de setor para a OP ${orderId}:`, err);
      toast.error(`Erro na transição de setor: ${err.message}`);
      throw err;
    }
  };

  return { finalizeSectorTask, invalidateProductionCaches: () => invalidateProductionCaches(queryClient) };
}
