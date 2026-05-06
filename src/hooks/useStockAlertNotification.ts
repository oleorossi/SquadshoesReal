import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StockAlertParams {
  orderId: string;
  orderNumber: string;
  materials: { name: string; missingAmount: number; unit: string }[];
}

export function useStockAlertNotification() {
  const qc = useQueryClient();

  const triggerStockAlert = async ({ orderId, orderNumber, materials }: StockAlertParams) => {
    const materialSummary = materials
      .map(m => `${m.missingAmount.toFixed(2)}${m.unit} de ${m.name}`)
      .join(', ');

    // Log the alert in audit_logs for traceability
    try {
      await supabase.from('audit_logs').insert({
        action: 'CRITICAL_STOCK_ALERT',
        resource: 'orders',
        resource_id: orderId,
        new_data: {
          order_number: orderNumber,
          missing_materials: materials,
          triggered_at: new Date().toISOString(),
        } as any,
        success: true,
      });
    } catch (e) {
      console.error('Failed to log stock alert:', e);
    }

    // Show real-time toast
    toast.warning(`Ruptura de Estoque: Pedido #${orderNumber}`, {
      description: `Faltam: ${materialSummary}. Ordem de Compra gerada.`,
      duration: 8000,
      action: {
        label: 'Ver OCs',
        onClick: () => window.location.assign('/purchase-orders'),
      },
    });

    // Refresh notifications so the bell picks it up
    qc.invalidateQueries({ queryKey: ['dashboard_notifications'] });
    qc.invalidateQueries({ queryKey: ['purchase_orders'] });
  };

  return { triggerStockAlert };
}
