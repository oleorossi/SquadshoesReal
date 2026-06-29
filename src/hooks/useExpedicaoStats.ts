import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PRODUCT_VOLUMES } from '@/lib/logistics/CubageEngine';
import { READY_TO_SHIP_STATUSES } from '@/lib/logistics/routeManagement';

export interface PendingOrderItem {
  id: string;
  order_number: string;
  client_name: string;
  client_id: string | null;
  total_pairs: number;
  packaging_mode: string | null;
  delivery_deadline: string | null;
  status: string | null;
  daysUntilDeadline: number | null; // negative = overdue
}

export interface ExpedicaoStats {
  // Embalagens
  totalBoxTypes: number;
  totalBoxStock: number;
  lowStockAlerts: number;
  boxTypesWithoutSupplier: number;

  // Transporte
  totalBaus: number;
  totalTransportadoras: number;
  totalCapacidadeM3: number;

  // Pedidos pendentes de expedição
  pendingOrders: number;
  overdueOrders: number;
  dueTodayOrders: number;
  pendingPairs: number;
  estimatedVolumeM3: number;
  estimatedWeightKg: number;

  // Clientes com entrega pendente
  clientesComEntrega: number;

  // Pedidos prontos (detalhes) — sorted by urgency
  pendingOrdersList: PendingOrderItem[];
}

const AVERAGE_WEIGHT_PER_PAIR = 0.45; // kg
const DEFAULT_VOLUME_PER_PAIR = PRODUCT_VOLUMES.ADULTO_SALTO; // m³

export function useExpedicaoStats() {
  return useQuery<ExpedicaoStats>({
    queryKey: ['expedicaoStats'],
    queryFn: async () => {
      // Run all queries in parallel
      const [
        boxTypesRes,
        bausRes,
        transportadorasRes,
        pendingOrdersRes,
      ] = await Promise.all([
        // Box types with stock info
        supabase.from('box_types').select('id, nome, quantity, min_stock, supplier_id, comprimento_cm, largura_cm, altura_cm, active').eq('active', true),
        // Baús (vehicles)
        supabase.from('baus').select('id, nome, comprimento_cm, largura_cm, altura_cm, capacidade_kg').eq('active', true),
        // Transportadoras (canônica = transporters; consolidação 2026-06-28)
        supabase.from('transporters').select('id, name').eq('active', true),
        // Sale orders ready to ship: production done, not yet dispatched
        supabase.from('sale_orders')
          .select('id, order_number, client_name, client_id, status, packaging_mode, delivery_deadline, shipped_at')
          .in('status', [...READY_TO_SHIP_STATUSES])
          .is('shipped_at' as any, null),
      ]);

      if (boxTypesRes.error) throw boxTypesRes.error;
      if (bausRes.error) throw bausRes.error;
      if (transportadorasRes.error) throw transportadorasRes.error;
      if (pendingOrdersRes.error) throw pendingOrdersRes.error;
      const boxTypes = boxTypesRes.data ?? [];
      const baus = bausRes.data ?? [];
      const transportadoras = transportadorasRes.data ?? [];
      const pendingOrders = pendingOrdersRes.data ?? [];

      // Calculate box stats
      const totalBoxStock = boxTypes.reduce((sum, b) => sum + (b.quantity || 0), 0);
      const lowStockAlerts = boxTypes.filter(b => (b.quantity || 0) <= (b.min_stock || 0)).length;
      const boxTypesWithoutSupplier = boxTypes.filter(b => !b.supplier_id).length;

      // Calculate total vehicle capacity
      const totalCapacidadeM3 = baus.reduce((sum, b) => {
        return sum + ((b.comprimento_cm * b.largura_cm * b.altura_cm) / 1_000_000);
      }, 0);

      // Get items for pending orders to calculate total pairs
      let pendingPairs = 0;
      const pendingOrderIds = pendingOrders.map(o => o.id);
      const pairsByOrder = new Map<string, number>();
      
      if (pendingOrderIds.length > 0) {
        // Chunk into 100-id batches to stay within URL-length limits while
        // still covering ALL pending orders (the previous code silently dropped
        // anything past index 100, undercounting pendingPairs).
        const CHUNK = 100;
        for (let i = 0; i < pendingOrderIds.length; i += CHUNK) {
          const ids = pendingOrderIds.slice(i, i + CHUNK);
          const { data: items, error: itemsErr } = await supabase
            .from('sale_order_items')
            .select('sale_order_id, quantity')
            .in('sale_order_id', ids);
          if (itemsErr) throw itemsErr;
          (items ?? []).forEach(item => {
            pairsByOrder.set(item.sale_order_id, (pairsByOrder.get(item.sale_order_id) || 0) + (item.quantity || 0));
          });
        }
        pendingPairs = Array.from(pairsByOrder.values()).reduce((a, b) => a + b, 0);
      }

      const estimatedVolumeM3 = pendingPairs * DEFAULT_VOLUME_PER_PAIR;
      const estimatedWeightKg = pendingPairs * AVERAGE_WEIGHT_PER_PAIR;

      // Unique clients with pending delivery
      const uniqueClients = new Set(
        pendingOrders
          .map((o) => o.client_id || o.client_name)
          .filter(Boolean)
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingOrdersList: PendingOrderItem[] = pendingOrders.map(o => {
        const pairs = pairsByOrder.get(o.id) ?? 0;
        let daysUntilDeadline: number | null = null;
        if (o.delivery_deadline) {
          const dl = new Date(o.delivery_deadline + 'T00:00:00');
          daysUntilDeadline = Math.round((dl.getTime() - today.getTime()) / 86_400_000);
        }
        return {
          id: o.id,
          order_number: o.order_number,
          client_name: o.client_name,
          client_id: o.client_id,
          total_pairs: pairs,
          packaging_mode: o.packaging_mode,
          delivery_deadline: o.delivery_deadline,
          status: o.status,
          daysUntilDeadline,
        };
      }).sort((a, b) => {
        // Overdue first, then by ascending days until deadline, then no-deadline last
        const da = a.daysUntilDeadline;
        const db = b.daysUntilDeadline;
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });

      const overdueOrders = pendingOrdersList.filter(o => (o.daysUntilDeadline ?? 1) < 0).length;
      const dueTodayOrders = pendingOrdersList.filter(o => o.daysUntilDeadline === 0).length;

      return {
        totalBoxTypes: boxTypes.length,
        totalBoxStock,
        lowStockAlerts,
        boxTypesWithoutSupplier,
        totalBaus: baus.length,
        totalTransportadoras: transportadoras.length,
        totalCapacidadeM3: Math.round(totalCapacidadeM3 * 100) / 100,
        pendingOrders: pendingOrders.length,
        overdueOrders,
        dueTodayOrders,
        pendingPairs,
        estimatedVolumeM3: Math.round(estimatedVolumeM3 * 1000) / 1000,
        estimatedWeightKg: Math.round(estimatedWeightKg),
        clientesComEntrega: uniqueClients.size,
        pendingOrdersList,
      };
    },
    staleTime: 2 * 60_000,
  });
}
