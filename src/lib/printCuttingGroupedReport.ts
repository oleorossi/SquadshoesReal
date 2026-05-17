import { printHtml } from './printOrder';
import { getOrderTotalPairs, getGradeTotal } from './cuttingCounts';
import { escapeHtml } from './htmlUtils';
import { scaleGradeWithLargestRemainder } from './scaleGrade';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

function deriveSoleType(color: string, reference?: ReferenceData): string {
  const refSoleColor = (reference as any)?.sole_color;
  if (refSoleColor && typeof refSoleColor === 'string' && refSoleColor.trim()) {
    return `Solado ${refSoleColor.trim()}`;
  }
  const c = (color || '').toLowerCase().normalize('NFC').trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Solado Preto';
  return 'Solado Caramelo';
}

type OrderData = {
  id: string;
  order_number: string;
  reference_id: string;
  color: string;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id?: string | null;
};

type ReferenceData = {
  id: string;
  code: string;
  name: string;
  shoe_category?: string;
  image_url?: string;
  images?: any[];
  has_straps?: boolean | null;
  /**
   * When false, the cabedal does NOT need to be cut (e.g. tiras models).
   * Defaults to true when undefined, preserving the previous behavior.
   */
  requires_cutting_cabedal?: boolean | null;
};

type SaleOrderData = {
  id: string;
  order_number?: string;
  client_name?: string;
  client_order_number?: string;
};

type GroupedByColor = {
  color: string;
  sizes: Record<string, number>;
  totalPairs: number;
  opNumbers: string[];
  clientNames: Set<string>;
};

function buildColorGradeTable(
  title: string,
  emoji: string,
  items: GroupedByColor[],
  activeSizes: string[],
  grandTotal: number,
): string {
  if (items.length === 0) return '';

  const sizeTotals: Record<string, number> = {};
  activeSizes.forEach(s => { sizeTotals[s] = 0; });

  let rows = '';
  items.forEach(group => {
    rows += `<tr>`;
    rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:11px;font-weight:700;">${escapeHtml(group.color)}</td>`;
    rows += `<td style="border:1px solid #999;padding:2px 4px;font-size:8px;color:#0369a1;">${group.clientNames.size > 0 ? escapeHtml(Array.from(group.clientNames).join(', ')) : '—'}</td>`;
    rows += `<td style="border:1px solid #999;padding:2px 4px;font-size:8px;color:#666;">${escapeHtml(group.opNumbers.join(', '))}</td>`;
    activeSizes.forEach(s => {
      const qty = group.sizes[s] || 0;
      sizeTotals[s] += qty;
      rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:11px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
    });
    rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#f5f5f0;">${group.totalPairs}</td>`;
    rows += `</tr>`;
  });

  // Totals row
  rows += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">`;
  rows += `<td colspan="3" style="border:1px solid #999;padding:2px 4px;text-align:right;font-size:10px;">TOTAL</td>`;
  activeSizes.forEach(s => {
    rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`;
  });
  rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:12px;font-weight:700;">${grandTotal}</td>`;
  rows += `</tr>`;

  return `
    <h2 style="font-size:14px;margin:6px 0 4px;border-bottom:2px solid #333;padding-bottom:2px;">${emoji} ${title}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
      <thead><tr style="background:#e8e8d0;">
        <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:10px;">Cor</th>
        <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">Lojas</th>
        <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">OPs</th>
        ${activeSizes.map(s => `<th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:10px;">${s}</th>`).join('')}
        <th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Build a single-row summary table (no color grouping — sums all sizes) */
function buildSummedGradeTable(
  title: string,
  emoji: string,
  orders: OrderData[],
): string {
  if (orders.length === 0) return '';

  const sizeTotals: Record<string, number> = {};
  SIZES.forEach(s => { sizeTotals[s] = 0; });
  let grandTotal = 0;
  const opNumbers: string[] = [];

  for (const order of orders) {
    const grade = order.grade;
    const gradeSum = getGradeTotal(grade);
    const totalPairs = getOrderTotalPairs(order);
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    grandTotal += totalPairs;
    opNumbers.push(order.order_number);

    if (grade && typeof grade === 'object') {
      const scaled = scaleGradeWithLargestRemainder(grade as Record<string, number>, multiplier, totalPairs);
      for (const s of SIZES) {
        const qty = scaled[s] || 0;
        if (qty > 0) sizeTotals[s] += qty;
      }
    }
  }

  const activeSizes = SIZES.filter(s => (sizeTotals[s] || 0) > 0);
  if (activeSizes.length === 0) return '';

  let rows = `<tr>`;
  rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:11px;font-weight:700;">Todas as cores</td>`;
  rows += `<td style="border:1px solid #999;padding:2px 4px;font-size:8px;color:#666;">${escapeHtml(opNumbers.join(', '))}</td>`;
  activeSizes.forEach(s => {
    rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:11px;font-weight:700">${sizeTotals[s] || ''}</td>`;
  });
  rows += `<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#f5f5f0;">${grandTotal}</td>`;
  rows += `</tr>`;

  return `
    <h2 style="font-size:14px;margin:6px 0 4px;border-bottom:2px solid #333;padding-bottom:2px;">${emoji} ${title}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
      <thead><tr style="background:#e8e8d0;">
        <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:10px;">Agrupamento</th>
        <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">OPs</th>
        ${activeSizes.map(s => `<th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:10px;">${s}</th>`).join('')}
        <th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function groupOrdersByColor(orders: OrderData[], saleOrders?: SaleOrderData[]): { items: GroupedByColor[]; activeSizes: string[]; grandTotal: number } {
  const byColor = new Map<string, GroupedByColor>();
  for (const order of orders) {
    const color = order.color || '—';
    const grade = order.grade;
    const gradeSum = getGradeTotal(grade);
    const totalPairs = getOrderTotalPairs(order);
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;

    if (!byColor.has(color)) {
      byColor.set(color, { color, sizes: {}, totalPairs: 0, opNumbers: [], clientNames: new Set<string>() });
    }
    const group = byColor.get(color)!;
    group.opNumbers.push(order.order_number);
    group.totalPairs += totalPairs;
    if (saleOrders && order.sale_order_id) {
      const so = saleOrders.find(s => s.id === order.sale_order_id);
      if (so?.client_name) group.clientNames.add(so.client_name);
    }
    if (grade) {
      const scaled = scaleGradeWithLargestRemainder(grade as Record<string, number>, multiplier, totalPairs);
      for (const s of SIZES) {
        const qty = scaled[s] || 0;
        if (qty > 0) group.sizes[s] = (group.sizes[s] || 0) + qty;
      }
    }
  }

  const items = Array.from(byColor.values()).sort((a, b) => a.color.localeCompare(b.color));
  const activeSizes = SIZES.filter(s => items.some(g => (g.sizes[s] || 0) > 0));
  const grandTotal = items.reduce((s, g) => s + g.totalPairs, 0);
  return { items, activeSizes, grandTotal };
}

/**
 * Relatório agrupado para setor de Corte — divisão em 3 fichas com quebra de página:
 *   1. CABEDAL — apenas para modelos SEM tiras habilitadas (por cor)
 *   2. FORRAÇÃO — sempre presente, agrupada por cor (cores não podem ser somadas)
 *   3. PALMILHA — sempre presente, soma total independente da cor
 *
 * Cada seção inicia em nova página de impressão (page-break-before: always),
 * exceto a primeira. A grade individual por referência+cor é incluída como
 * apêndice opcional na seção CABEDAL para auditoria.
 */
 export function printCuttingGroupedReport(
   selectedOrders: OrderData[],
   references: ReferenceData[],
   _getStrapsLabel?: (order: any) => string,
   saleOrders?: SaleOrderData[],
   extra?: {
     silkRegistrations?: any[];
     soleMappings?: any[];
   }
 ) {
  if (selectedOrders.length === 0) return;

  // OPs cujo cabedal ainda precisa ser cortado (modelos SEM tiras).
  // Modelos COM tiras vêm com cabedal pré-montado, então NÃO entram na ficha de Cabedal.
  // Forração e Palmilha continuam sendo cortadas para todas as OPs.
   const silkRegistrations = extra?.silkRegistrations || [];
   const soleMappings = extra?.soleMappings || [];
 
   const getOrderSilk = (order: OrderData) => {
     const soleMapping = soleMappings.find(m => m.sheet_id === order.reference_id && m.product_color === order.color);
     const soleProductId = soleMapping?.sole_product_id;
     if (!soleProductId) return undefined;
 
     const saleOrder = saleOrders?.find(so => so.id === order.sale_order_id);
     const clientId = (saleOrder as any)?.client_id;
     const economicGroupId = (saleOrder as any)?.economic_group_id;
 
     let silk: any;
     if (clientId) {
       silk = silkRegistrations.find(s => s.sole_product_id === soleProductId && s.client_id === clientId);
     }
     if (!silk && economicGroupId) {
       silk = silkRegistrations.find(s => s.sole_product_id === soleProductId && s.economic_group_id === economicGroupId);
     }
     if (!silk) {
       silk = silkRegistrations.find(s => s.sole_product_id === soleProductId && !s.client_id && !s.economic_group_id);
     }
 
     return silk ? { silk_name: silk.silk_name, silk_url: silk.silk_url } : undefined;
   };
 
   const nonStrapOrders: OrderData[] = [];
   for (const order of selectedOrders) {
    const ref = references.find(r => r.id === order.reference_id);
    if (!ref) continue;
    const cabedalCut = ref.requires_cutting_cabedal ?? !ref.has_straps;
    if (cabedalCut) {
      nonStrapOrders.push(order);
    }
  }

  const allGrouped = groupOrdersByColor(selectedOrders, saleOrders);
  const totalPairsAll = allGrouped.grandTotal;

  // Cabeçalho compartilhado (renderizado em cada ficha)
  const buildSheetHeader = (sheetTitle: string, sheetEmoji: string, opCount: number, pairCount: number, extra?: string) => `
    <div style="border-bottom:3px solid #111;padding-bottom:4px;margin-bottom:4px;">
      <h1 style="font-size:18px;margin:0 0 2px;">${sheetEmoji} Ficha de Corte — ${sheetTitle}</h1>
      <p style="font-size:10px;color:#666;margin:0;">
        Gerado em ${new Date().toLocaleString('pt-BR')} · ${opCount} ${opCount === 1 ? 'OP' : 'OPs'} · ${pairCount} pares${extra ? ' · ' + extra : ''}
      </p>
    </div>`;

  const sections: string[] = [];

  // ===== SEÇÃO 1: CABEDAL — apenas para modelos SEM tiras =====
  if (nonStrapOrders.length > 0) {
    const cabedal = groupOrdersByColor(nonStrapOrders, saleOrders);
    let cabedalHtml = buildSheetHeader('Cabedal', '👟', nonStrapOrders.length, cabedal.grandTotal, 'Modelos sem tira');
    cabedalHtml += buildColorGradeTable('Cabedal — por Cor', '👟', cabedal.items, cabedal.activeSizes, cabedal.grandTotal);

    // Apêndice: grade individual por solado/referência/cor (auditoria)
    cabedalHtml += '<div style="margin-top:4px;border-top:2px dashed #999;padding-top:6px;"></div>';
    cabedalHtml += '<h2 style="font-size:13px;margin:0 0 4px;">📐 Detalhamento por Solado / Referência / Cor</h2>';

    const bySole = new Map<string, Map<string, { ref: ReferenceData; orders: OrderData[] }>>();
    for (const order of nonStrapOrders) {
      const ref = references.find(r => r.id === order.reference_id);
      if (!ref) continue;
      const soleType = deriveSoleType(order.color);
      if (!bySole.has(soleType)) bySole.set(soleType, new Map());
      const refMap = bySole.get(soleType)!;
      if (!refMap.has(order.reference_id)) refMap.set(order.reference_id, { ref, orders: [] });
      refMap.get(order.reference_id)!.orders.push(order);
    }

    for (const [soleType, refMap] of bySole) {
      const soleBorderColor = soleType === 'Solado Preto' ? '#333' : '#c9a84c';
      const soleEmoji = soleType === 'Solado Preto' ? '⬛' : '🟨';
      cabedalHtml += '<div style="margin-top:4px;border-top:2px solid ' + soleBorderColor + ';padding-top:3px;"></div>';
      cabedalHtml += '<h3 style="font-size:12px;margin:0 0 3px;font-weight:800;">' + soleEmoji + ' ' + escapeHtml(soleType) + '</h3>';

      for (const [, { ref, orders: refOrders }] of refMap) {
        const refCode = ref.code || '—';
        const refName = ref.name || '';

        const refActiveSizes = SIZES.filter(s =>
          refOrders.some(o => {
            if (!o.grade || typeof o.grade !== 'object') return false;
            const grade = o.grade as Record<string, number>;
            const gradeSum = getGradeTotal(grade);
            const totalPairs = getOrderTotalPairs(o);
            const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
            return Math.round((Number(grade[s]) || 0) * multiplier) > 0;
          })
        );
        if (refActiveSizes.length === 0) continue;

        const refClientNames = new Set<string>();
        if (saleOrders) {
          for (const o of refOrders) {
            if (o.sale_order_id) {
              const so = saleOrders.find(s => s.id === o.sale_order_id);
              if (so?.client_name) refClientNames.add(so.client_name);
            }
          }
        }
        const clientLabel = refClientNames.size > 0
          ? ' <span style="font-size:9px;padding:1px 6px;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:3px;color:#0369a1;font-weight:600;">🏪 ' + escapeHtml(Array.from(refClientNames).join(', ')) + '</span>'
          : '';

        cabedalHtml += '<div style="margin-bottom:5px;page-break-inside:avoid;">';
        cabedalHtml += '<h4 style="font-size:11px;margin:4px 0 2px;font-weight:700;">' + escapeHtml(refCode) + ' — ' + escapeHtml(refName) + clientLabel + '</h4>';
        cabedalHtml += '<table style="width:100%;border-collapse:collapse;">';
        cabedalHtml += '<thead><tr style="background:#e8e8d0;">';
        cabedalHtml += '<th style="border:1px solid #999;padding:2px 4px;text-align:left;font-size:9px;">OP</th>';
        cabedalHtml += '<th style="border:1px solid #999;padding:2px 4px;text-align:left;font-size:9px;">Cor</th>';
        cabedalHtml += '<th style="border:1px solid #999;padding:2px 4px;text-align:left;font-size:9px;">Loja</th>';
        refActiveSizes.forEach(s => { cabedalHtml += '<th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:9px;">' + s + '</th>'; });
        cabedalHtml += '<th style="border:1px solid #999;padding:2px 4px;text-align:center;font-size:9px;background:#e0e0c8;">Total</th>';
        cabedalHtml += '</tr></thead><tbody>';

        const refSizeTotals: Record<string, number> = {};
        refActiveSizes.forEach(s => { refSizeTotals[s] = 0; });
        let refGrandTotal = 0;

        for (const order of refOrders) {
          const grade = order.grade as Record<string, number> | null;
          const gradeSum = getGradeTotal(grade);
          const totalPairs = getOrderTotalPairs(order);
          const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
          const scaled = scaleGradeWithLargestRemainder(grade, multiplier, totalPairs);
          const orderClientName = saleOrders ? (() => { const so = saleOrders.find(s => s.id === order.sale_order_id); return so?.client_name || '—'; })() : '—';

          cabedalHtml += '<tr>';
           const silk = getOrderSilk(order);
           const silkLabel = silk ? ` <span style="font-size:8px;padding:1px 3px;background:#f5f5f0;border:1px solid #ddd;border-radius:2px;color:#444;font-weight:700;">SILK: ${escapeHtml(silk.silk_name)}</span>` : '';

           cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;font-size:10px;font-weight:600;">' + escapeHtml(order.order_number) + '</td>';
           cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;font-size:10px;">' + escapeHtml(order.color || '—') + silkLabel + '</td>';
          cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;font-size:9px;color:#0369a1;">' + escapeHtml(orderClientName) + '</td>';
          refActiveSizes.forEach(s => {
            const qty = scaled[s] || 0;
            refSizeTotals[s] += qty;
            cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:10px;font-weight:' + (qty > 0 ? '700' : '400') + '">' + (qty || '') + '</td>';
          });
          refGrandTotal += totalPairs;
          cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-weight:700;font-size:10px;background:#f5f5f0;">' + totalPairs + '</td>';
          cabedalHtml += '</tr>';
        }

        if (refOrders.length > 1) {
          cabedalHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
          cabedalHtml += '<td colspan="3" style="border:1px solid #999;padding:2px 4px;text-align:right;font-size:9px;">SUBTOTAL</td>';
          refActiveSizes.forEach(s => { cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:10px;">' + (refSizeTotals[s] || '') + '</td>'; });
          cabedalHtml += '<td style="border:1px solid #999;padding:2px 4px;text-align:center;font-family:monospace;font-size:10px;font-weight:700;">' + refGrandTotal + '</td>';
          cabedalHtml += '</tr>';
        }
        cabedalHtml += '</tbody></table></div>';
      }
    }

    sections.push(`<section class="cut-sheet">${cabedalHtml}</section>`);
  }

  // ===== SEÇÃO 2: FORRAÇÃO — sempre presente, por cor =====
  const forroGrouped = groupOrdersByColor(selectedOrders, saleOrders);
  if (forroGrouped.items.length > 0) {
    let forroHtml = buildSheetHeader('Forração', '🧵', selectedOrders.length, forroGrouped.grandTotal, `${forroGrouped.items.length} ${forroGrouped.items.length === 1 ? 'cor' : 'cores'}`);
    forroHtml += buildColorGradeTable('Forração — por Cor', '🧵', forroGrouped.items, forroGrouped.activeSizes, forroGrouped.grandTotal);
    sections.push(`<section class="cut-sheet">${forroHtml}</section>`);
  }

  // ===== SEÇÃO 3: PALMILHA — sempre presente, soma total =====
  let palmilhaHtml = buildSheetHeader('Palmilha', '🦶', selectedOrders.length, totalPairsAll, 'Soma total — independe da cor');
  palmilhaHtml += buildSummedGradeTable('Palmilha — Total (todas as cores)', '🦶', selectedOrders);
  sections.push(`<section class="cut-sheet">${palmilhaHtml}</section>`);

  // Concatena com quebra de página entre seções (a primeira não recebe break)
  const html = sections
    .map((s, i) => i === 0 ? s : `<div style="page-break-before:always;"></div>${s}`)
    .join('');

  printHtml('Fichas de Corte (Cabedal · Forração · Palmilha)', html, { landscape: true });
}
