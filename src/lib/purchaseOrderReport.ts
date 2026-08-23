import * as XLSX from 'xlsx';
import type { PurchaseOrder, PurchaseOrderItemSummary } from '@/hooks/usePurchaseOrders';

export interface PurchaseOrderReportSummary {
  count: number;
  supplierCount: number;
  total: number;
  average: number;
  openTotal: number;
  overdueCount: number;
}

export function summarizePurchaseOrders(orders: PurchaseOrder[], today: string): PurchaseOrderReportSummary {
  const active = orders.filter(order => order.status !== 'cancelled');
  const total = active.reduce((sum, order) => sum + (Number(order.total_value) || 0), 0);
  const open = active.filter(order => order.status !== 'received');
  return {
    count: orders.length,
    supplierCount: new Set(orders.map(order => order.supplier_name).filter(Boolean)).size,
    total,
    average: active.length ? total / active.length : 0,
    openTotal: open.reduce((sum, order) => sum + (Number(order.total_value) || 0), 0),
    overdueCount: open.filter(order => !!order.promised_date && order.promised_date < today).length,
  };
}

export function exportPurchaseOrdersXlsx(
  orders: PurchaseOrder[],
  summaries: Map<string, PurchaseOrderItemSummary> | undefined,
  statusLabel: (status: string) => string,
) {
  const rows = orders.flatMap(order => {
    const items = summaries?.get(order.id)?.items || [];
    const base = {
      'Nº OC': order.order_number,
      Fornecedor: order.supplier_name || '',
      Status: statusLabel(order.status),
      Origem: order.source_type === 'per_pv' ? 'Por pedido' : order.auto_generated ? 'Automática' : 'Manual',
      'Criada em': order.created_at?.slice(0, 10) || '',
      'Comprar até': order.purchase_by_date || '',
      'Entrega prevista': order.promised_date || '',
      'Valor da OC (R$)': Number(order.total_value) || 0,
    };
    if (!items.length) return [{ ...base, Item: '', SKU: '', Categoria: '', Cor: '', Quantidade: 0, Unidade: '', 'Preço unitário (R$)': 0, 'Total do item (R$)': 0 }];
    return items.map(item => ({
      ...base,
      Item: item.name,
      SKU: item.sku,
      Categoria: item.category,
      Cor: item.color || '',
      Quantidade: item.quantity,
      Unidade: item.unit,
      'Preço unitário (R$)': item.unitPrice,
      'Total do item (R$)': item.quantity * item.unitPrice,
    }));
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [12, 32, 13, 13, 13, 13, 15, 16, 16, 30, 14, 18, 16, 12, 10, 18, 18].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ordens e itens');
  XLSX.writeFile(wb, `ordens_compra_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
