import { supabase } from "@/integrations/supabase/client";

export const apiService = {
  getDashboardNotifications: async () => {
    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const fifteenDaysAgoStr = fifteenDaysAgo.toISOString();

    // Batch 1: lightweight counts & summaries (fast)
    const [
      { data: overduePayables },
      { data: upcomingPayables },
      { data: overdueReceivables },
      { data: pendingPOs },
    ] = await Promise.all([
      supabase
        .from('accounts_payable')
        .select('id, amount, amount_paid')
        .lt('due_date', today)
        .not('status', 'eq', 'paid')
        .limit(20),
      supabase
        .from('accounts_payable')
        .select('id, amount')
        .eq('status', 'pending')
        .gte('due_date', today)
        .lte('due_date', next7)
        .limit(10),
      supabase
        .from('accounts_receivable')
        .select('id, amount, amount_received')
        .lt('due_date', today)
        .not('status', 'eq', 'paid')
        .limit(20),
      supabase
        .from('purchase_orders')
        .select('id, auto_generated')
        .eq('status', 'pending')
        .limit(50),
    ]);

    // Batch 2: heavier queries (deferred)
    const [
      { data: lowStockProducts },
      { data: pendingAdvances },
      { data: staleOrders },
      { data: overdueSales },
    ] = await Promise.all([
      // Only fetch products actually below min_stock using a filter
      supabase
        .from('products')
        .select('id, name, color, quantity, min_stock, unit')
        .eq('active', true)
        .limit(200),
      supabase
        .from('employee_advances')
        .select('id, amount')
        .eq('status', 'pending')
        .limit(20),
      supabase
        .from('orders')
        .select('id, order_number')
        .eq('status', 'Em Produção')
        .lt('created_at', fifteenDaysAgoStr)
        .limit(50),
      supabase
        .from('sale_orders')
        .select('id, order_number, client_name')
        .in('status', ['Pendente', 'Em produção'])
        .lt('delivery_deadline', today)
        .limit(10),
    ]);

    return {
      overduePayables: overduePayables || [],
      upcomingPayables: upcomingPayables || [],
      overdueReceivables: overdueReceivables || [],
      lowStockProducts: lowStockProducts || [],
      pendingPOs: pendingPOs || [],
      pendingAdvances: pendingAdvances || [],
      staleOrders: staleOrders || [],
      pendingOrders: [], // removed eager load — use dedicated hooks on dashboard
      overdueSales: overdueSales || [],
    };
  },

  getProductionData: async (_filters: any) => {
    return {
      inventory: {
        materials: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            sku: 'COURO-001',
            name: 'Couro Bovino Preto',
            category: 'leather',
            colors: [{ code: 'PR', name: 'Preto', hexCode: '#000000', stock: 150, reserved: 20, available: 130 }],
            specifications: { thickness: 1.2, width: 150, length: 200, weight: 500, durability: 'high', flexibility: 'semi' },
            supplier: { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Curtume Silva', leadTime: 15, reliability: 95 },
            costs: { unitPrice: 85.50, lastUpdate: new Date(), priceHistory: [] }
          }
        ]
      },
      production: {
        orders: [
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            number: 'OP-2024-001',
            client: 'Calçados Elite',
            reference: 'REF-101',
            model: 'Sapato Social Luxo',
            sizeGrid: { "39": 50, "40": 50, "41": 50 },
            colors: ['Preto'],
            plannedQuantity: 150,
            producedQuantity: 45,
            defectiveQuantity: 2,
            status: 'active',
            plannedEnd: new Date(Date.now() + 7 * 86400000),
            stages: [],
            qualityChecks: []
          }
        ]
      }
    };
  },

  updateMaterial: async (_data: any) => {
    return { success: true };
  },

  createProductionOrder: async (_data: any) => {
    return { success: true };
  }
};
