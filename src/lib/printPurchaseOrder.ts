import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { escapeHtml } from './htmlUtils';

type POItem = {
  product?: { name: string; sku: string; category: string; color?: string | null };
  quantity: number;
  unit_price: number;
  unit: string;
  current_stock: number;
  suggested_quantity: number;
  grade?: Record<string, number> | null;
  color?: string | null;
};

type POData = {
  order_number: string;
  supplier_name: string;
  total_value: number;
  created_at: string;
  notes?: string;
  status: string;
};

type GroupedMaterial = {
  category: string;
  items: {
    name: string;
    sku: string;
    quantity: number;
    unit: string;
    unit_price: number;
    subtotal: number;
    current_stock: number;
    grade?: Record<string, number> | null;
    color?: string | null;
  }[];
  totalQty: number;
  totalValue: number;
};

function classifyCategory(name: string, category: string): string {
  const n = (name || '').toLowerCase();
  const c = (category || '').toLowerCase();

  if (n.includes('tira') || c.includes('tira')) return 'Tiras';
  if (n.includes('cola') || c.includes('cola') || n.includes('adesivo')) return 'Colas / Adesivos';
  if (n.includes('napa') || n.includes('couro') || n.includes('cabedal')) return 'Cabedal / Napa';
  if (n.includes('forro') || n.includes('espuma')) return 'Forração / Espuma';
  if (n.includes('palmilha') || n.includes('insole')) return 'Palmilhas';
  if (n.includes('solado') || n.includes('sola') || c.includes('solado')) return 'Solados';
  if (n.includes('caixa') || n.includes('embalagem') || n.includes('saco')) return 'Embalagem';
  if (n.includes('linha') || n.includes('fio')) return 'Linhas / Fios';
  if (n.includes('ilhós') || n.includes('fivela') || n.includes('enfeite') || n.includes('rebite')) return 'Aviamentos';
  if (c) return c.charAt(0).toUpperCase() + c.slice(1);
  return 'Outros';
}

function groupItems(items: POItem[]): GroupedMaterial[] {
  const map = new Map<string, GroupedMaterial>();

  items.forEach(item => {
    const name = item.product?.name || '?';
    const cat = classifyCategory(name, item.product?.category || '');

    if (!map.has(cat)) {
      map.set(cat, { category: cat, items: [], totalQty: 0, totalValue: 0 });
    }

    const group = map.get(cat)!;
    // Sole items keep grade per item (no merging by SKU — different colors have different grades)
    const isSole = cat === 'Solados';
    const existing = !isSole && group.items.find(i => i.sku === (item.product?.sku || ''));
    if (existing) {
      existing.quantity += item.quantity;
      existing.subtotal += item.quantity * item.unit_price;
    } else {
      group.items.push({
        name,
        sku: item.product?.sku || '',
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        subtotal: item.quantity * item.unit_price,
        current_stock: item.current_stock,
        grade: item.grade ?? null,
        color: item.color ?? item.product?.color ?? null,
      });
    }
  });

  // Recalculate totals
  map.forEach(g => {
    g.totalQty = g.items.reduce((s, i) => s + i.quantity, 0);
    g.totalValue = g.items.reduce((s, i) => s + i.subtotal, 0);
  });

  return Array.from(map.values()).sort((a, b) => a.category.localeCompare(b.category, 'pt-BR'));
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function printPurchaseOrderGrouped(order: POData, items: POItem[]) {
  const groups = groupItems(items);
  const grandTotal = groups.reduce((s, g) => s + g.totalValue, 0);

  const groupsHtml = groups.map(g => {
    const isSole = g.category === 'Solados';

    // For sole items: build a color × size grid per item
    const soleRowsHtml = isSole ? (() => {
      const allSizes = new Set<string>();
      for (const item of g.items) {
        if (item.grade) Object.keys(item.grade).forEach(s => allSizes.add(s));
      }
      const sizes = Array.from(allSizes).sort((a, b) => {
        const na = parseFloat(a.split('/')[0]);
        const nb = parseFloat(b.split('/')[0]);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      });

      if (sizes.length === 0) return null; // no grade data — fall back to normal rows

      const sizeTotals: Record<string, number> = {};
      let grandRowTotal = 0;

      const rows = g.items.map(item => {
        const colorLabel = item.color ?? '—';
        const rowGrade = item.grade || {};
        // Total/valor da linha ancorados em item.quantity (o que é precificado e
        // soma no rodapé g.totalValue). Antes usava a soma da grade → quando grade
        // ≠ quantity a linha divergia do total (auditoria 2026-07-02).
        const rowTotal = Number(item.quantity) || sizes.reduce((s, sz) => s + (rowGrade[sz] ?? 0), 0);
        grandRowTotal += rowTotal;

        const sizeCells = sizes.map(sz => {
          const q = rowGrade[sz] ?? 0;
          sizeTotals[sz] = (sizeTotals[sz] ?? 0) + q;
          return `<td style="text-align:center">${q > 0 ? q : '—'}</td>`;
        }).join('');

        return `<tr>
          <td style="font-weight:600">${escapeHtml(item.name)}</td>
          <td style="font-weight:500;color:#475569">${escapeHtml(colorLabel)}</td>
          ${sizeCells}
          <td style="text-align:center;font-weight:700;color:#2563eb">${rowTotal}</td>
          <td style="text-align:right">${fmt(item.unit_price)}</td>
          <td style="text-align:right;font-weight:600">${fmt(rowTotal * item.unit_price)}</td>
        </tr>`;
      }).join('');

      const totalCells = sizes.map(sz =>
        `<td style="text-align:center;font-weight:700">${sizeTotals[sz] || '—'}</td>`
      ).join('');

      const sizeHeaders = sizes.map(sz => `<th style="text-align:center">Nº ${sz}</th>`).join('');

      return `
        <table>
          <thead>
            <tr>
              <th style="text-align:left">Solado</th>
              <th style="text-align:left">Cor</th>
              ${sizeHeaders}
              <th style="text-align:center">Total</th>
              <th style="text-align:right">Pr. Un.</th>
              <th style="text-align:right">Valor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#f8fafc;border-top:2px solid #cbd5e1">
              <td style="font-weight:700" colspan="2">TOTAL</td>
              ${totalCells}
              <td style="text-align:center;font-weight:700;color:#2563eb">${grandRowTotal}</td>
              <td></td>
              <td style="text-align:right;font-weight:700">${fmt(g.totalValue)}</td>
            </tr>
          </tfoot>
        </table>`;
    })() : null;

    const normalRowsHtml = (!isSole || soleRowsHtml === null) ? `
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Material</th>
            <th style="text-align:left">SKU</th>
            <th style="text-align:center">Est. Atual</th>
            <th style="text-align:center">Qtd</th>
            <th style="text-align:center">Un</th>
            <th style="text-align:right">Preço Un.</th>
            <th style="text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${g.items.map(i => `
            <tr>
              <td>${escapeHtml(i.name)}</td>
              <td class="sku">${escapeHtml(i.sku)}</td>
              <td style="text-align:center">${fmtQty(i.current_stock)}</td>
              <td style="text-align:center;font-weight:600">${fmtQty(i.quantity)}</td>
              <td style="text-align:center">${escapeHtml(i.unit)}</td>
              <td style="text-align:right">${fmt(i.unit_price)}</td>
              <td style="text-align:right;font-weight:600">${fmt(i.subtotal)}</td>
            </tr>
          `).join('')}
        </tbody>` : '';

    return `
    <div class="group-section">
      <div class="group-header">
        <span class="group-title">${escapeHtml(g.category)}</span>
        <span class="group-summary">${g.items.length} ite${g.items.length > 1 ? 'ns' : 'm'} — ${fmtQty(g.totalQty)} un. — ${fmt(g.totalValue)}</span>
      </div>
      ${soleRowsHtml ?? (normalRowsHtml + '</table>')}
    </div>
  `;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>OC ${order.order_number}</title>
<style>
  @page { margin: 5mm 6mm; size: A4 portrait; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-bottom: 8px; }
  .header h1 { font-size: 16px; color: #2563eb; }
  .header .meta { text-align: right; font-size: 10px; color: #666; }
  .header .meta strong { color: #1a1a1a; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-bottom: 10px; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
  .info-grid .label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-grid .value { font-size: 11px; font-weight: 600; }

  .group-section { margin-bottom: 10px; }
  .group-header { display: flex; justify-content: space-between; align-items: center; background: #1e293b; color: white; padding: 6px 10px; border-radius: 4px 4px 0 0; }
  .group-title { font-weight: 700; font-size: 12px; }
  .group-summary { font-size: 10px; opacity: 0.85; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 6px; border-bottom: 1px solid #cbd5e1; color: #475569; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
  .sku { font-family: monospace; font-size: 9px; color: #64748b; }

  .grand-total { display: flex; justify-content: flex-end; margin-top: 6px; padding: 6px 14px; background: #2563eb; color: white; border-radius: 6px; font-size: 13px; font-weight: 700; gap: 16px; }

  .notes { margin-top: 12px; padding: 8px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; font-size: 10px; color: #92400e; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Ordem de Compra</h1>
      <div style="font-size:10px;color:#64748b;margin-top:2px">Resumo Agrupado de Materiais</div>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(order.order_number)}</strong></div>
      <div>${format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</div>
    </div>
  </div>

  <div class="info-grid">
    <div><div class="label">Fornecedor</div><div class="value">${escapeHtml(order.supplier_name)}</div></div>
    <div><div class="label">Status</div><div class="value">${escapeHtml(order.status)}</div></div>
    <div><div class="label">Total</div><div class="value">${fmt(grandTotal)}</div></div>
  </div>

  ${groupsHtml}

  <div class="grand-total">
    <span>Total Geral:</span>
    <span>${fmt(grandTotal)}</span>
  </div>

  ${order.notes ? `<div class="notes"><strong>Obs:</strong> ${escapeHtml(order.notes)}</div>` : ''}
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 3000);
    }, 300);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// printSupplierPOs: one-PDF-per-supplier, combining multiple OCs.
// Sole items get a special color × size grid; other items use the grouped layout.
// ─────────────────────────────────────────────────────────────────────────────

function isSolado(name: string, category: string): boolean {
  return (name || '').toLowerCase().includes('solado') ||
    (name || '').toLowerCase().includes('sola') ||
    (category || '').toLowerCase().includes('solado');
}

function soleModelName(productName: string, color: string | null | undefined): string {
  if (!color) return productName.trim();
  return productName.replace(new RegExp(`\\b${color}\\b`, 'i'), '').replace(/\s{2,}/g, ' ').trim();
}

type SupplierPOItem = POItem & { purchase_order_id?: string };

export function printSupplierPOs(
  supplierName: string,
  orders: POData[],
  items: SupplierPOItem[],
): void {
  const today = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  const orderNumbers = orders.map(o => o.order_number).join(', ');
  const grandTotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  // Split items into sole vs other
  const soleItems = items.filter(i => isSolado(i.product?.name || '', i.product?.category || ''));
  const otherItems = items.filter(i => !isSolado(i.product?.name || '', i.product?.category || ''));

  // ── Non-sole section (same grouped layout) ──────────────────────────────
  const otherGroups = groupItems(otherItems);
  const otherHtml = otherGroups.length === 0 ? '' : otherGroups.map(g => `
    <div class="group-section">
      <div class="group-header">
        <span class="group-title">${escapeHtml(g.category)}</span>
        <span class="group-summary">${g.items.length} ite${g.items.length > 1 ? 'ns' : 'm'} — ${fmtQty(g.totalQty)} un. — ${fmt(g.totalValue)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Material</th>
            <th style="text-align:left">SKU</th>
            <th style="text-align:center">Est. Atual</th>
            <th style="text-align:center">Qtd</th>
            <th style="text-align:center">Un</th>
            <th style="text-align:right">Preço Un.</th>
            <th style="text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${g.items.map(i => `
            <tr>
              <td>${escapeHtml(i.name)}</td>
              <td class="sku">${escapeHtml(i.sku)}</td>
              <td style="text-align:center">${fmtQty(i.current_stock)}</td>
              <td style="text-align:center;font-weight:600">${fmtQty(i.quantity)}</td>
              <td style="text-align:center">${escapeHtml(i.unit)}</td>
              <td style="text-align:right">${fmt(i.unit_price)}</td>
              <td style="text-align:right;font-weight:600">${fmt(i.subtotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  // ── Sole section: color × size grid grouped by model ─────────────────────
  let soleHtml = '';
  if (soleItems.length > 0) {
    // Group by model name
    const modelMap = new Map<string, { items: SupplierPOItem[]; unitPrice: number }>();
    for (const item of soleItems) {
      const model = soleModelName(item.product?.name || item.product?.sku || 'Solado', item.color ?? item.product?.color);
      if (!modelMap.has(model)) modelMap.set(model, { items: [], unitPrice: item.unit_price });
      modelMap.get(model)!.items.push(item);
    }

    const modelSections = Array.from(modelMap.entries()).map(([model, { items: mItems, unitPrice }]) => {
      // Collect all sizes across all items for this model
      const allSizes = new Set<string>();
      for (const item of mItems) {
        if (item.grade) {
          Object.keys(item.grade).forEach(s => allSizes.add(s));
        }
      }
      const sizes = Array.from(allSizes).sort((a, b) => {
        const na = parseFloat(a.split('/')[0]);
        const nb = parseFloat(b.split('/')[0]);
        return na - nb;
      });

      let modelTotal = 0;
      const sizeTotals: Record<string, number> = {};

      const rows = mItems.map(item => {
        const colorLabel = item.color ?? item.product?.color ?? '—';
        const rowGrade = item.grade || {};
        // Total/valor da linha ancorados em item.quantity (o que é precificado e
        // soma no grandTotal + resumo do grupo); a grade fica só como distribuição
        // por numeração. Antes usava a soma da grade → quando grade ≠ quantity a
        // linha divergia do total geral (auditoria 2026-07-02).
        const rowTotal = Number(item.quantity) || sizes.reduce((s, sz) => s + (rowGrade[sz] ?? 0), 0);
        modelTotal += rowTotal;

        const sizeCells = sizes.map(sz => {
          const q = rowGrade[sz] || 0;
          sizeTotals[sz] = (sizeTotals[sz] || 0) + q;
          return `<td style="text-align:center">${q > 0 ? q : '—'}</td>`;
        }).join('');

        return `<tr>
          <td style="font-weight:600">${escapeHtml(colorLabel)}</td>
          ${sizeCells}
          <td style="text-align:center;font-weight:700;color:#2563eb">${rowTotal}</td>
          <td style="text-align:right">${fmt(unitPrice)}</td>
          <td style="text-align:right;font-weight:600">${fmt(rowTotal * unitPrice)}</td>
        </tr>`;
      }).join('');

      const totalCells = sizes.map(sz =>
        `<td style="text-align:center;font-weight:700">${sizeTotals[sz] || '—'}</td>`
      ).join('');

      const sizeHeaders = sizes.map(sz => `<th style="text-align:center">Nº${sz}</th>`).join('');

      return `
        <div class="model-block">
          <div class="model-name">Modelo: ${escapeHtml(model)}</div>
          <table>
            <thead>
              <tr>
                <th style="text-align:left;width:120px">Cor</th>
                ${sizeHeaders}
                <th style="text-align:center">Total</th>
                <th style="text-align:right">Pr. Un.</th>
                <th style="text-align:right">Valor</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr class="totals-row">
                <td style="font-weight:700">TOTAL</td>
                ${totalCells}
                <td style="text-align:center;font-weight:700;color:#2563eb">${modelTotal}</td>
                <td></td>
                <td style="text-align:right;font-weight:700">${fmt(modelTotal * unitPrice)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`;
    }).join('');

    soleHtml = `
      <div class="group-section">
        <div class="group-header">
          <span class="group-title">Solados</span>
          <span class="group-summary">${soleItems.length} ite${soleItems.length > 1 ? 'ns' : 'm'} — ${fmt(soleItems.reduce((s, i) => s + i.quantity * i.unit_price, 0))}</span>
        </div>
        <div style="padding:8px 0">
          ${modelSections}
        </div>
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>OC Consolidada — ${escapeHtml(supplierName)}</title>
<style>
  @page { margin: 5mm 6mm; size: A4 portrait; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 6px; margin-bottom: 8px; }
  .header h1 { font-size: 16px; color: #2563eb; }
  .header .meta { text-align: right; font-size: 10px; color: #666; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin-bottom: 10px; padding: 6px 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
  .info-grid .label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .info-grid .value { font-size: 11px; font-weight: 600; }

  .group-section { margin-bottom: 10px; }
  .group-header { display: flex; justify-content: space-between; align-items: center; background: #1e293b; color: white; padding: 6px 10px; border-radius: 4px 4px 0 0; }
  .group-title { font-weight: 700; font-size: 12px; }
  .group-summary { font-size: 10px; opacity: 0.85; }

  .model-block { margin: 6px 0 10px 0; }
  .model-name { font-size: 11px; font-weight: 700; color: #1e40af; padding: 4px 8px; background: #eff6ff; border-left: 3px solid #2563eb; margin-bottom: 4px; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 6px; border-bottom: 1px solid #cbd5e1; color: #475569; }
  td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; }
  .sku { font-family: monospace; font-size: 9px; color: #64748b; }
  tfoot td { background: #f8fafc; border-top: 2px solid #cbd5e1; }
  .totals-row td { font-weight: 700; }

  .grand-total { display: flex; justify-content: flex-end; margin-top: 6px; padding: 6px 14px; background: #2563eb; color: white; border-radius: 6px; font-size: 13px; font-weight: 700; gap: 16px; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Ordem de Compra Consolidada</h1>
      <div style="font-size:10px;color:#64748b;margin-top:2px">OCs: ${escapeHtml(orderNumbers)}</div>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(supplierName)}</strong></div>
      <div>${today}</div>
    </div>
  </div>

  <div class="info-grid">
    <div><div class="label">Fornecedor</div><div class="value">${escapeHtml(supplierName)}</div></div>
    <div><div class="label">Nº de OCs</div><div class="value">${orders.length}</div></div>
    <div><div class="label">Total Geral</div><div class="value">${fmt(grandTotal)}</div></div>
  </div>

  ${soleHtml}
  ${otherHtml}

  <div class="grand-total">
    <span>Total Geral:</span>
    <span>${fmt(grandTotal)}</span>
  </div>
</body>
</html>`;

  openPrintWindow(html);
}

function openPrintWindow(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 3000);
    }, 300);
  };
}
