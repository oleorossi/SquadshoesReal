import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, subMonths, differenceInDays, differenceInHours, isAfter, isBefore, parseISO } from 'date-fns';

export type PeriodFilter = '7d' | '30d' | '90d' | '180d' | 'all';

function getStartDate(period: PeriodFilter): Date | null {
  const now = new Date();
  switch (period) {
    case '7d': return subDays(now, 7);
    case '30d': return subDays(now, 30);
    case '90d': return subMonths(now, 3);
    case '180d': return subMonths(now, 6);
    default: return null;
  }
}

export function useProducaoKPIs(period: PeriodFilter) {
  return useQuery({
    queryKey: ['producao-kpis', period],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const startDate = getStartDate(period);
      const now = new Date();

      // Build queries with date filters to reduce data transfer
      let ordersQuery = supabase.from('orders').select('id, order_number, status, quantity, created_at, updated_at, planned_delivery, last_sector_finished_at').order('created_at', { ascending: false });
      if (startDate) {
        ordersQuery = ordersQuery.gte('created_at', startDate.toISOString());
      }

      let movementsQuery = supabase.from('stock_movements').select('id, quantity, created_at').eq('movement_type', 'out');
      if (startDate) {
        movementsQuery = movementsQuery.gte('created_at', startDate.toISOString());
      }

      const [ordersRes, productsRes, stagesRes, movementsRes, fgrRes] = await Promise.all([
        ordersQuery.limit(2000),
        supabase.from('products').select('id, quantity, min_stock, max_stock').eq('active', true),
        supabase.from('order_stages').select('id, order_id, stage_name, status, started_at, completed_at').limit(5000),
        movementsQuery.limit(2000),
        supabase.from('finished_goods_receipts').select('id, order_id, quantity_good, quantity_rework, quantity_scrap, created_at').limit(2000),
      ]);

      const allOrders = ordersRes.data || [];
      const products = productsRes.data || [];
      const allStages = stagesRes.data || [];
      const movements = movementsRes.data || [];
      const fgrData = (fgrRes.data || []).filter(f => !startDate || f.created_at >= startDate.toISOString());

      // Orders already filtered at DB level
      const orders = allOrders;

      // 1. Fill Rate — % OPs completed (all stages done)
      // orders.status uses Portuguese names ('Finalizado', 'Cancelada') — never English.
      const completedOps = orders.filter(o => ['Finalizado', 'Concluída'].includes(o.status));
      const fillRate = orders.length > 0 ? Math.round((completedOps.length / orders.length) * 100) : 0;

      // 2. Stock Accuracy — materials within min/max range
      const materialsWithPolicy = products.filter(p => p.min_stock > 0 || p.max_stock > 0);
      const materialsInRange = materialsWithPolicy.filter(p => {
        const aboveMin = p.min_stock <= 0 || p.quantity >= p.min_stock;
        const belowMax = p.max_stock <= 0 || p.quantity <= p.max_stock;
        return aboveMin && belowMax;
      });
      const stockAccuracy = materialsWithPolicy.length > 0
        ? Math.round((materialsInRange.length / materialsWithPolicy.length) * 100)
        : 100;

      // 3. Average Cycle Time — decimal days between created_at and last_sector_finished_at for completed orders
      const completedWithDates = completedOps.filter(o => o.created_at && (o.last_sector_finished_at || o.updated_at));
      const cycleTimes = completedWithDates.map(o =>
        differenceInHours(parseISO(o.last_sector_finished_at || o.updated_at), parseISO(o.created_at)) / 24
      );
      const avgCycleTime = cycleTimes.length > 0
        ? Number((cycleTimes.reduce((s, v) => s + v, 0) / cycleTimes.length).toFixed(1))
        : 0;

      // 4. Delayed OPs — where planned_delivery < now and not completed/cancelled
      const activeOrders = orders.filter(o => !['Finalizado', 'Concluída', 'Cancelada'].includes(o.status));
      const delayedOps = activeOrders.filter(o =>
        o.planned_delivery && isBefore(parseISO(o.planned_delivery), now)
      );
      const delayRate = activeOrders.length > 0
        ? Math.round((delayedOps.length / activeOrders.length) * 100)
        : 0;

      // 5. Pairs Produced in period
      const pairsProduced = completedOps.reduce((s, o) => s + o.quantity, 0);

      // 6. Component Turnover — period outflows / avg stock (already filtered at DB level)
      const periodMovements = movements;
      const totalOutflow = periodMovements.reduce((s, m) => s + m.quantity, 0);
      const avgStock = products.length > 0
        ? products.reduce((s, p) => s + p.quantity, 0) / products.length
        : 1;
      const turnover = avgStock > 0 ? Math.round((totalOutflow / avgStock) * 10) / 10 : 0;

      // 7. Efficiency and Avg Time by Stage
      const stageNames = [...new Set(allStages.map(s => s.stage_name))];
      const stageEfficiency = stageNames.map(name => {
        const stagesForName = allStages.filter(s => s.stage_name === name);
        const completed = stagesForName.filter(s => s.status === 'concluido').length;
        
        const completedWithTimes = stagesForName.filter(s => s.status === 'concluido' && s.started_at && s.completed_at);
        const avgTimeHours = completedWithTimes.length > 0
          ? completedWithTimes.reduce((sum, s) => {
              const diff = (new Date(s.completed_at!).getTime() - new Date(s.started_at!).getTime()) / (1000 * 60 * 60);
              return sum + diff;
            }, 0) / completedWithTimes.length
          : 0;

        return {
          name,
          total: stagesForName.length,
          completed,
          efficiency: stagesForName.length > 0 ? Math.round((completed / stagesForName.length) * 100) : 0,
          avgTimeHours: Number(avgTimeHours.toFixed(1)),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      // 8. Status Distribution for pie chart
      const statusDist = Object.entries(
        orders.reduce<Record<string, number>>((acc, o) => {
          acc[o.status] = (acc[o.status] || 0) + 1;
          return acc;
        }, {})
      ).map(([status, count]) => ({ status, count }));

      // 9. Delayed OPs list
      const delayedOpsList = delayedOps.slice(0, 10).map(o => ({
        id: o.id,
        order_number: o.order_number,
        quantity: o.quantity,
        planned_delivery: o.planned_delivery,
        daysLate: differenceInDays(now, parseISO(o.planned_delivery!)),
        status: o.status,
      }));

      // 10. Quality KPIs from finished_goods_receipts
      const totalGood = fgrData.reduce((s, f) => s + (f.quantity_good || 0), 0);
      const totalRework = fgrData.reduce((s, f) => s + (f.quantity_rework || 0), 0);
      const totalScrap = fgrData.reduce((s, f) => s + (f.quantity_scrap || 0), 0);
      const totalInspected = totalGood + totalRework + totalScrap;
      const defectRate = totalInspected > 0 ? Math.round(((totalRework + totalScrap) / totalInspected) * 1000) / 10 : 0;
      const reworkRate = totalInspected > 0 ? Math.round((totalRework / totalInspected) * 1000) / 10 : 0;
      const qualityScore = totalInspected > 0 ? Math.round((totalGood / totalInspected) * 1000) / 10 : 100;

      return {
        fillRate,
        stockAccuracy,
        avgCycleTime,
        delayRate,
        pairsProduced,
        turnover,
        stageEfficiency,
        statusDist,
        delayedOpsList,
        totalOps: orders.length,
        completedOps: completedOps.length,
        activeOps: activeOrders.length,
        delayedCount: delayedOps.length,
        defectRate,
        reworkRate,
        qualityScore,
        totalInspected,
      };
    },
  });
}
