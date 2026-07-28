import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { escapeHtml } from './htmlUtils';
import { applyPrintSandbox } from '@/lib/htmlUtils';

interface MissingMaterial {
  materialId: string;
  name: string;
  unit: string;
  missingAmount: number;
  currentStock: number;
  sku?: string;
}

interface PrintPurchaseOrderParams {
  orderId: string;
  orderNumber: string;
  customerName?: string;
  materials: MissingMaterial[];
}

export function printStockPurchaseOrder({ orderNumber, customerName, materials }: PrintPurchaseOrderParams) {
  const today = format(new Date(), "dd/MM/yyyy", { locale: ptBR });

  const rows = materials.map(m => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">
        <p style="font-weight:900;font-size:14px;text-transform:uppercase;margin:0;">${escapeHtml(m.name)}</p>
        ${m.sku ? `<p style="font-size:9px;color:#94a3b8;font-family:monospace;margin:2px 0 0;">SKU: ${escapeHtml(m.sku)}</p>` : ''}
      </td>
      <td style="padding:12px;text-align:center;border-bottom:2px solid #e2e8f0;font-weight:700;text-transform:uppercase;">
        ${m.unit || 'm'}
      </td>
      <td style="padding:12px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:10px;color:#64748b;">
        ${m.currentStock.toFixed(2)}
      </td>
      <td style="padding:12px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:15px;font-weight:900;">
        ${m.missingAmount.toFixed(2)}
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>OC - ${orderNumber}</title>
  <style>
    @page { margin: 5mm 6mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 5mm 6mm; }
    table { width: 100%; border-collapse: collapse; }
  </style>
</head>
<body>
  <!-- Cabeçalho -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f172a;padding-bottom:8px;margin-bottom:12px;">
    <div>
      <h1 style="font-size:15px;font-weight:900;letter-spacing:-0.5px;margin:0;">ORDEM DE COMPRA</h1>
      <span style="font-size:10px;font-weight:700;background:#0f172a;color:white;padding:1px 6px;display:inline-block;margin-top:4px;">
        URGENTE: REPOSIÇÃO DE PRODUÇÃO
      </span>
    </div>
    <div style="text-align:right;">
      <p style="font-size:13px;font-weight:900;margin:0;">Nº OC-${escapeHtml(orderNumber)}</p>
      <p style="font-size:10px;font-weight:700;color:#64748b;margin:2px 0 0;">Emissão: ${today}</p>
    </div>
  </div>

  <!-- Rastreabilidade -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
    <div style="padding:5px 8px;background:#f1f5f9;border-radius:6px;">
      <p style="font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;margin:0;">Vinculado ao Pedido</p>
      <p style="font-size:13px;font-weight:700;margin:2px 0 0;">#${escapeHtml(orderNumber)}</p>
    </div>
    <div style="padding:5px 8px;background:#f1f5f9;border-radius:6px;">
      <p style="font-size:9px;font-weight:900;color:#94a3b8;text-transform:uppercase;margin:0;">Cliente do Pedido</p>
      <p style="font-size:13px;font-weight:700;text-transform:uppercase;margin:2px 0 0;">${escapeHtml(customerName || 'Venda Interna')}</p>
    </div>
  </div>

  <!-- Tabela de Itens -->
  <table style="border:2px solid #0f172a;margin-bottom:16px;">
    <thead>
      <tr style="background:#0f172a;color:white;font-size:10px;text-transform:uppercase;">
        <th style="padding:4px 8px;text-align:left;border-right:1px solid rgba(255,255,255,0.2);">Insumo / Referência</th>
        <th style="padding:4px 8px;text-align:center;border-right:1px solid rgba(255,255,255,0.2);">Unidade</th>
        <th style="padding:4px 8px;text-align:right;border-right:1px solid rgba(255,255,255,0.2);">Estoque Atual</th>
        <th style="padding:4px 8px;text-align:right;">Qtd. Necessária</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <!-- Instrução -->
  <div style="padding:5px 8px;border-left:3px solid #0f172a;background:#f8fafc;font-size:10px;line-height:1.5;margin-bottom:16px;">
    <strong>INSTRUÇÃO DE ENTREGA:</strong> Favor identificar a NF de remessa com o número do
    pedido <strong>#${escapeHtml(orderNumber)}</strong> para agilizar a conferência e entrada no setor de Corte.
  </div>

  <!-- Rodapé -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #e2e8f0;padding-top:12px;">
    <div style="width:33%;border-bottom:1px solid #0f172a;padding-bottom:4px;">
      <p style="font-size:8px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin:0;">Assinatura PCP</p>
    </div>
    <div style="font-size:8px;color:#cbd5e1;text-transform:uppercase;font-weight:900;">
      Sistema Industrial — Gerado automaticamente
    </div>
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  applyPrintSandbox(iframe); // T6: HTML de impressão sem <script> (ver htmlUtils)
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 300);
  }
}
