import { buildGroupedReportHtml } from './printGroupedReport';
import { openPrintWindow, writePrintWindow } from './printOrder';
import { escapeHtml } from './htmlUtils';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

type OrderData = {
  id: string;
  order_number: string;
  reference_id: string;
  color: string;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id?: string;
};

type ReferenceData = {
  id: string;
  code: string;
  name: string;
  shoe_category?: string;
  image_url?: string;
  images?: string[];
};

type SaleOrderData = {
  id: string;
  order_number?: string;
  client_order_number?: string;
};

function getSoleColorForOrder(orderColor: string | null | undefined): string {
  const c = (orderColor || '').toLowerCase().trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Preto';
  return 'Caramelo';
}

function getPositiveGrade(grade: unknown): Record<string, number> {
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return {};
  return Object.fromEntries(
    Object.entries(grade)
      .map(([size, qty]) => [size, Number(qty) || 0] as const)
      .filter(([, qty]) => qty > 0)
  );
}

// ── Solagem section (special format — grouped by sole color) ─────────────────
export function buildSolagemSectionHtml(
  orders: OrderData[],
  saleOrders: SaleOrderData[],
): string {
  if (orders.length === 0) return '';

  const soleMap = new Map<string, { color: string; sizes: Record<string, number>; total: number }>();

  for (const order of orders) {
    const grade = getPositiveGrade(order.grade);
    const gradeSum = Object.values(grade).reduce((s, v) => s + v, 0);
    const totalPairs = order.quantity || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;

    for (const [size, qty] of Object.entries(grade)) {
      const q = Math.round(qty * multiplier);
      if (q <= 0) continue;
      const soleColor = getSoleColorForOrder(order.color);
      if (!soleMap.has(soleColor)) {
        soleMap.set(soleColor, { color: soleColor, sizes: {}, total: 0 });
      }
      const row = soleMap.get(soleColor)!;
      row.sizes[size] = (row.sizes[size] || 0) + q;
      row.total += q;
    }
  }

  const soleData = Array.from(soleMap.values()).filter(r => r.total > 0);
  if (soleData.length === 0) return '';

  // Collect all active sizes (including conjugated)
  const activeSizeSet = new Set<string>();
  soleData.forEach(r => Object.keys(r.sizes).forEach(s => { if (r.sizes[s] > 0) activeSizeSet.add(s); }));
  const activeSizes = Array.from(activeSizeSet).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
  });

  const grandTotal = soleData.reduce((s, r) => s + r.total, 0);
  const sizeTotals: Record<string, number> = {};
  activeSizes.forEach(s => { sizeTotals[s] = 0; });

  const headerCells = activeSizes.map(s =>
    `<th style="border:1px solid #a7f3d0;padding:4px 6px;text-align:center;font-size:10px;background:#d1fae5;color:#064e3b;">${s}</th>`
  ).join('');

  let rowsHtml = '';
  soleData.forEach(row => {
    rowsHtml += `<tr>
      <td style="border:1px solid #a7f3d0;padding:4px 6px;font-weight:700;font-size:11px;background:#f0fdf4;">${escapeHtml(row.color)}</td>`;
    activeSizes.forEach(s => {
      const qty = row.sizes[s] || 0;
      sizeTotals[s] += qty;
      rowsHtml += `<td style="border:1px solid #a7f3d0;padding:4px 6px;text-align:center;font-family:monospace;font-size:${qty > 0 ? '13px' : '10px'};font-weight:${qty > 0 ? '700' : '400'};color:${qty > 0 ? '#064e3b' : '#cbd5e1'};">${qty || '–'}</td>`;
    });
    rowsHtml += `<td style="border:1px solid #a7f3d0;padding:4px 6px;text-align:center;font-family:monospace;font-weight:900;font-size:14px;background:#dcfce7;color:#14532d;">${row.total}</td></tr>`;
  });

  rowsHtml += `<tr style="background:#bbf7d0;border-top:2px solid #16a34a;">
    <td style="border:1px solid #a7f3d0;padding:4px 8px;text-align:right;font-size:10px;font-weight:700;color:#14532d;">TOTAL</td>`;
  activeSizes.forEach(s => {
    rowsHtml += `<td style="border:1px solid #a7f3d0;padding:4px 6px;text-align:center;font-family:monospace;font-size:13px;font-weight:700;color:#14532d;">${sizeTotals[s] || ''}</td>`;
  });
  rowsHtml += `<td style="border:1px solid #a7f3d0;padding:4px 6px;text-align:center;font-family:monospace;font-size:15px;font-weight:900;color:#14532d;">${grandTotal}</td></tr>`;

  const clientOrderNumbers = new Set<string>();
  orders.forEach(order => {
    const so = saleOrders.find(s => s.id === (order as any).sale_order_id);
    if (so?.order_number) clientOrderNumbers.add(so.order_number);
    if (so?.client_order_number) clientOrderNumbers.add(`Ped. ${so.client_order_number}`);
  });

  const statCards = soleData.map(d =>
    `<div style="text-align:center;padding:6px 14px;background:#dcfce7;border:1px solid #a7f3d0;border-radius:6px;">
      <p style="font-size:20px;font-weight:900;color:#14532d;">${d.total}</p>
      <p style="font-size:9px;color:#16a34a;font-weight:700;">${escapeHtml(d.color)}</p>
    </div>`
  ).join('');

  return `
  <div style="margin-bottom:4px;padding:6px 12px;background:#f0fdf4;border:2px solid #16a34a;border-radius:6px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <div>
      <h1 style="font-size:17px;font-weight:900;color:#14532d;">🦶 Solagem</h1>
      <p style="font-size:9px;color:#16a34a;">Solagem e fixação do solado</p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;">
      <div style="text-align:center;padding:6px 14px;background:#dcfce7;border:1px solid #a7f3d0;border-radius:6px;">
        <p style="font-size:20px;font-weight:900;color:#14532d;">${orders.length}</p>
        <p style="font-size:9px;color:#16a34a;font-weight:700;">OPs</p>
      </div>
      ${statCards}
      <div style="text-align:center;padding:6px 14px;background:#dcfce7;border:2px solid #16a34a;border-radius:6px;">
        <p style="font-size:20px;font-weight:900;color:#14532d;">${grandTotal}</p>
        <p style="font-size:9px;color:#16a34a;font-weight:700;">Total Pares</p>
      </div>
    </div>
  </div>

  <h2 style="font-size:12px;margin:6px 0 4px;border-bottom:1px solid #a7f3d0;padding-bottom:2px;color:#14532d;">Grade Consolidada por Cor de Solado</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
    <thead><tr>
      <th style="border:1px solid #a7f3d0;padding:4px 8px;text-align:left;font-size:10px;background:#d1fae5;color:#064e3b;">Cor Solado</th>
      ${headerCells}
      <th style="border:1px solid #a7f3d0;padding:4px 8px;text-align:center;font-size:10px;background:#bbf7d0;color:#14532d;">Total</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  ${clientOrderNumbers.size > 0 ? `
  <p style="font-size:10px;color:#64748b;line-height:1.6;">
    <strong>Pedidos englobados:</strong> ${Array.from(clientOrderNumbers).map(escapeHtml).join(' &nbsp;•&nbsp; ')}
  </p>` : ''}`;
}

// ── Combined report ───────────────────────────────────────────────────────────
export function printCombinedSectorReport(
  orders: OrderData[],
  references: ReferenceData[],
  saleOrders: SaleOrderData[],
  getStrapsLabel?: (order: any) => string,
  allStages?: any[],
  selectedSectors?: string[],
) {
  if (orders.length === 0) return;

  const printWin = openPrintWindow('Relatório Completo - Todos os Setores');

  try {
    const allSectors = [
      { name: 'Corte',      emoji: '✂️' },
      { name: 'Forração',   emoji: '🧵' },
      { name: 'Aviamento',  emoji: '🧷' },
      { name: 'Silk',       emoji: '🎨' },
      { name: 'Colagem',    emoji: '🔥' },
      { name: 'Montagem',   emoji: '🔧' },
      { name: 'Acabamento', emoji: '✨' },
    ];

    const sectors = selectedSectors && selectedSectors.length > 0
      ? allSectors.filter(s => selectedSectors.includes(s.name))
      : allSectors;
    const includeSolagem =
      !selectedSectors || selectedSectors.length === 0 || selectedSectors.includes('Solagem');

    // Cover page HTML
    const allSectorNames = [
      ...sectors.map(s => s.name),
      ...(includeSolagem ? ['Solagem'] : []),
    ];
    const grandTotal = orders.reduce((s, o) => s + (o.quantity || 0), 0);

    let combinedHtml = `
    <style>
      @page { size: A4 landscape; margin: 8mm 8mm; }
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:'Helvetica Neue',Arial,sans-serif; font-size:11px; color:#000; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .page-break { page-break-after:always; break-after:page; }
      .avoid-break { page-break-inside:avoid; break-inside:avoid; }
    </style>

    <div style="padding:20mm 16mm;background:#0f172a;min-height:180mm;display:flex;flex-direction:column;justify-content:center;border-radius:4px;">
      <p style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Relatório de Produção</p>
      <h1 style="color:#f8fafc;font-size:36px;font-weight:900;line-height:1.1;margin-bottom:5px;">Relatório Completo<br>de Produção</h1>
      <p style="color:#64748b;font-size:12px;margin-bottom:20px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px;">
        <div style="background:#1e293b;border-radius:8px;padding:10px 18px;text-align:center;">
          <p style="color:#f8fafc;font-size:28px;font-weight:900;">${orders.length}</p>
          <p style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Ordens de Produção</p>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 18px;text-align:center;">
          <p style="color:#f8fafc;font-size:28px;font-weight:900;">${grandTotal}</p>
          <p style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total de Pares</p>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:10px 18px;text-align:center;">
          <p style="color:#f8fafc;font-size:28px;font-weight:900;">${allSectorNames.length}</p>
          <p style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Setores</p>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${allSectorNames.map(name => `<span style="background:#334155;color:#cbd5e1;padding:4px 10px;border-radius:4px;font-size:10px;font-weight:600;">${escapeHtml(name)}</span>`).join('')}
      </div>
    </div>
    <div class="page-break"></div>`;

    // One section per sector — each sector already includes its CSS inside buildGroupedReportHtml
    for (const sector of sectors) {
      const pendingOrders = orders.filter(order => {
        if (!allStages) return true;
        const stage = allStages.find(s => s.order_id === order.id && s.stage_name === sector.name);
        return !stage || (stage.status !== 'concluido' && stage.status !== 'cancelado');
      });

      if (pendingOrders.length === 0) continue;

      const sectorHtml = buildGroupedReportHtml(
        sector.name,
        sector.emoji,
        pendingOrders,
        references,
        getStrapsLabel,
        saleOrders as any,
      );
      if (sectorHtml) {
        combinedHtml += sectorHtml;
        combinedHtml += `<div class="page-break"></div>`;
      }
    }

    // Solagem (special format)
    if (includeSolagem) {
      const pendingForSolagem = orders.filter(order => {
        if (!allStages) return true;
        const stage = allStages.find(s => s.order_id === order.id && s.stage_name === 'Solagem');
        return !stage || (stage.status !== 'concluido' && stage.status !== 'cancelado');
      });

      if (pendingForSolagem.length > 0) {
        const solagemHtml = buildSolagemSectionHtml(pendingForSolagem, saleOrders);
        if (solagemHtml) {
          combinedHtml += solagemHtml;
        }
      }
    }

    writePrintWindow(printWin, 'Relatório Completo - Todos os Setores', combinedHtml, { landscape: true });
  } catch (error) {
    console.error('Erro ao gerar relatório combinado', error);
    const message = error instanceof Error ? error.message : 'Falha inesperada.';
    writePrintWindow(
      printWin,
      'Relatório Completo',
      `<h1 style="font-size:18px;">Erro ao gerar relatório</h1><p>${message}</p>`
    );
  }
}
