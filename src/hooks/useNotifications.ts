import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/lib/apiService';
import { supabase } from '@/integrations/supabase/client';

export interface NotificationItem {
  id: string;
  category: 'finance' | 'stock' | 'production' | 'hr' | 'purchasing';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  link?: string;
  sector?: string;
}


export function useNotifications() {
  return useQuery({
    queryKey: ['dashboard_notifications'],
    queryFn: async () => {
      // Promise.allSettled — if one source fails (e.g. notifications table is
      // unreachable), still render whatever the other call returned.
      const [dashRes, sectorRes] = await Promise.allSettled([
        apiService.getDashboardNotifications(),
        supabase
          .from('notifications')
          .select('*')
          .eq('read', false)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      const data = dashRes.status === 'fulfilled' ? dashRes.value : {
        overduePayables: [], overdueReceivables: [], lowStockProducts: [],
        pendingPOs: [], pendingAdvances: [], staleOrders: [],
      } as any;
      const sectorNotifications =
        sectorRes.status === 'fulfilled' && !sectorRes.value.error
          ? (sectorRes.value.data || [])
          : [];
      if (sectorRes.status === 'fulfilled' && sectorRes.value.error) {
        console.warn('[useNotifications] sector query failed:', sectorRes.value.error.message);
      }

      const notifications: NotificationItem[] = [];

      const {
        overduePayables,
        overdueReceivables,
        lowStockProducts,
        pendingPOs,
        pendingAdvances,
        staleOrders,
      } = data;

      // --- Contas a pagar vencidas ---
      if (overduePayables && overduePayables.length > 0) {
        const totalOverdue = overduePayables.reduce((s, p) => s + (p.amount - (p.amount_paid || 0)), 0);
        notifications.push({
          id: 'overdue-payables',
          category: 'finance',
          severity: 'critical',
          title: `${overduePayables.length} conta(s) a pagar vencida(s)`,
          description: `Total: ${fmt(totalOverdue)}`,
          link: '/finance',
        });
      }

      // --- Contas a receber vencidas ---
      if (overdueReceivables && overdueReceivables.length > 0) {
        const totalOverdue = overdueReceivables.reduce((s, r) => s + (r.amount - (r.amount_received || 0)), 0);
        notifications.push({
          id: 'overdue-receivables',
          category: 'finance',
          severity: 'warning',
          title: `${overdueReceivables.length} conta(s) a receber vencida(s)`,
          description: `Total: ${fmt(totalOverdue)}`,
          link: '/finance',
        });
      }

      // --- Estoque abaixo do mínimo ---
      if (lowStockProducts) {
        const lowItems = lowStockProducts.filter(p => p.quantity <= p.min_stock);
        const zeroItems = lowItems.filter(p => p.quantity <= 0);
        const belowMin = lowItems.filter(p => p.quantity > 0);

        if (zeroItems.length > 0) {
          notifications.push({
            id: 'stock-zero',
            category: 'stock',
            severity: 'critical',
            title: `${zeroItems.length} material(is) com estoque zerado`,
            description: zeroItems.slice(0, 3).map(p => p.name + (p.color ? ` (${p.color})` : '')).join(', ') + (zeroItems.length > 3 ? '...' : ''),
            link: '/estoque',
          });
        }
        if (belowMin.length > 0) {
          notifications.push({
            id: 'stock-low',
            category: 'stock',
            severity: 'warning',
            title: `${belowMin.length} material(is) abaixo do mínimo`,
            description: belowMin.slice(0, 3).map(p => `${p.name}: ${p.quantity}/${p.min_stock}`).join(', ') + (belowMin.length > 3 ? '...' : ''),
            link: '/estoque',
          });
        }
      }

      // --- OCs pendentes ---
      if (pendingPOs && pendingPOs.length > 0) {
        const autoCount = pendingPOs.filter(p => p.auto_generated).length;
        notifications.push({
          id: 'pending-pos',
          category: 'purchasing',
          severity: 'info',
          title: `${pendingPOs.length} ordem(ns) de compra pendente(s)`,
          description: autoCount > 0 ? `${autoCount} gerada(s) automaticamente` : 'Aguardando revisão',
          link: '/purchase-orders',
        });
      }

      // --- Adiantamentos pendentes ---
      if (pendingAdvances && pendingAdvances.length > 0) {
        const totalAdv = pendingAdvances.reduce((s, a) => s + a.amount, 0);
        notifications.push({
          id: 'pending-advances',
          category: 'hr',
          severity: 'info',
          title: `${pendingAdvances.length} adiantamento(s) pendente(s)`,
          description: `Total: ${fmt(totalAdv)}`,
          link: '/employees',
        });
      }

      // --- OPs em produção há mais de 15 dias ---
      if (staleOrders && staleOrders.length > 0) {
        notifications.push({
          id: 'stale-ops',
          category: 'production',
          severity: 'warning',
          title: `${staleOrders.length} OP(s) em produção há mais de 15 dias`,
          description: staleOrders.slice(0, 3).map(o => o.order_number).join(', ') + (staleOrders.length > 3 ? '...' : ''),
          link: '/orders',
        });
      }
      // --- Notificações de Setor ---

      if (sectorNotifications && sectorNotifications.length > 0) {
        sectorNotifications.forEach(sn => {
          notifications.push({
            id: sn.id,
            category: 'production',
            severity: 'info',
            title: `Novo trabalho em ${sn.sector}`,
            description: sn.message,
            link: `/${sn.sector?.toLowerCase()}`,
            sector: sn.sector
          });
        });
      }

      return notifications;
    },

    staleTime: 5 * 60 * 1000, // 5 min
    refetchInterval: 10 * 60 * 1000, // auto-refresh 10 min
  });
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
