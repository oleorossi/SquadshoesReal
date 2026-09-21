/**
 * Export XML opcional da OC quando o fornecedor tem export_xml_layout=true.
 * v1: stub estruturado baixado no browser (canal humano); path lógico devolvido
 * para gravar em purchase_orders.export_xml_path.
 */
import type { SourcePvLabel } from '@/hooks/usePurchaseDispatchQueue';

interface XmlExportArgs {
  orderNumber: string;
  supplierName: string;
  labels: SourcePvLabel[];
  items: Array<{
    product_name: string | null;
    color: string | null;
    quantity: number;
    unit: string | null;
  }>;
}

function esc(s: string) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function exportPurchaseOrderXmlStub(args: XmlExportArgs): Promise<string> {
  const pvNodes = (args.labels || [])
    .map((l) => `    <pedido codigo="${esc(l.order_number)}" cliente="${esc(l.client_order_number || '')}" />`)
    .join('\n');
  const itemNodes = (args.items || [])
    .map((it) => (
      `    <item nome="${esc(it.product_name || '')}" cor="${esc(it.color || '')}" qtd="${Number(it.quantity) || 0}" unidade="${esc(it.unit || '')}" />`
    ))
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ordemCompra numero="${esc(args.orderNumber)}" fornecedor="${esc(args.supplierName)}">
  <pedidos>
${pvNodes}
  </pedidos>
  <itens>
${itemNodes}
  </itens>
</ordemCompra>
`;

  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `OC_${(args.orderNumber || 'sem-numero').replace(/[^\w.-]+/g, '_')}_${stamp}.xml`;
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return `local-download:${filename}`;
}
