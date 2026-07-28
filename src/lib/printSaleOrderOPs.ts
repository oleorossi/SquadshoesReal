import { supabase } from '@/integrations/supabase/client';
import { printHtml } from '@/lib/printOrder';
import { getClientLogoUrl } from '@/lib/getClientLogo';
import { escapeHtml, safeUrlAttr } from '@/lib/htmlUtils';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

const SIZES_ALL = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

/** Regra: cor preta do cabedal → solado Preto; todas as demais → Caramelo. */
function getSoleColor(orderColor: string | null | undefined): string {
  const c = (orderColor || '').toLowerCase().trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Preto';
  return 'Caramelo';
}

type OrderWithRef = {
  id: string;
  order_number: string;
  reference_id: string;
  quantity: number;
  color: string;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id: string | null;
  technical_sheets?: { name: string; code: string; image_url?: string; images?: string[]; upper_material?: string | null; sole_color?: string | null } | null;
};

async function fetchOPsForSaleOrder(saleOrderId: string): Promise<OrderWithRef[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, technical_sheets(name, code, image_url, upper_material, sole_color)')
    .eq('sale_order_id', saleOrderId);
  if (error) throw error;
  return (data || []).map((o: any) => ({
    ...o,
    grade: o.grade as Record<string, number> | null,
  }));
}

function buildCorteHtml(ops: OrderWithRef[]): string {
  // Aggregate by color across all OPs
  const colorMap = new Map<string, { color: string; refCode: string; refName: string; sizes: Record<string, number>; total: number; isBalancinho: boolean }>();

  for (const order of ops) {
    const grade = order.grade;
    if (!grade) continue;
    const color = order.color || '—';
    const refCode = order.technical_sheets?.code || '';
    const refName = order.technical_sheets?.name || '';
    const isBalancinho = !!(order.technical_sheets?.upper_material);
    const key = `${color}|${refCode}`;
    const existing = colorMap.get(key) || { color, refCode, refName, sizes: {}, total: 0, isBalancinho };

    for (const [size, qty] of Object.entries(grade)) {
      const q = Number(qty) || 0;
      if (q > 0) {
        existing.sizes[size] = (existing.sizes[size] || 0) + q;
        existing.total += q;
      }
    }
    if (isBalancinho) existing.isBalancinho = true;
    colorMap.set(key, existing);
  }

  const rows = Array.from(colorMap.values());
  const activeSizes = SIZES_ALL.filter(s => rows.some(r => (r.sizes[s] || 0) > 0));
  const sizeTotals: Record<string, number> = {};
  activeSizes.forEach(s => { sizeTotals[s] = 0; });
  let grandTotal = 0;

  let rowsHtml = '';
  rows.forEach(row => {
    const balancinhoBadge = row.isBalancinho
      ? ' <span style="background:#FFD700;color:#333;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-left:4px;">BALANCINHO</span>'
      : '';
    rowsHtml += '<tr>';
    rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;font-weight:600;font-size:10px;">${escapeHtml(row.refCode)} — ${escapeHtml(row.refName)}${balancinhoBadge}</td>`;
    rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${escapeHtml(row.color)}</td>`;
    activeSizes.forEach(s => {
      const qty = row.sizes[s] || 0; sizeTotals[s] += qty; grandTotal += qty;
      rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${qty || ''}</td>`;
    });
    rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${row.total}</td>`;
    rowsHtml += '</tr>';
  });

  rowsHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
  rowsHtml += '<td colspan="2" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>';
  activeSizes.forEach(s => { rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`; });
  rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;">${grandTotal}</td></tr>`;

  return `
    <div style="border-bottom: 2px solid #333; margin-bottom: 15px; padding-bottom: 5px; display: flex; justify-content: space-between; align-items: flex-end;">
      <h1 style="font-size:20px; margin:0; color:#1a56db;">✂️ Lista de Corte</h1>
      <div style="text-align:right; font-size:10px; color:#666;">
        Gerado em ${new Date().toLocaleString('pt-BR')} | ${ops.length} OP(s)
      </div>
    </div>
    <div style="background:#f8fafc; padding:10px; border-radius:6px; border:1px solid #e2e8f0; margin-bottom:15px; font-size:10px;">
      <strong>OPs incluídas:</strong> ${escapeHtml(ops.map(o => o.order_number).join(', '))}
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; border:1px solid #999; border-radius:8px; overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="border:1px solid #999; padding:8px 6px; text-align:left; font-size:10px; color:#475569;">Referência</th>
          <th style="border:1px solid #999; padding:8px 6px; text-align:center; font-size:10px; color:#475569;">Cor</th>
          ${activeSizes.map(s => `<th style="border:1px solid #999; padding:8px 6px; text-align:center; font-size:10px; color:#475569;">${s}</th>`).join('')}
          <th style="border:1px solid #999; padding:8px 6px; text-align:center; font-size:10px; background:#e2e8f0; color:#1e293b;">Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

}

function buildSolagemHtml(ops: OrderWithRef[]): string {
  const map = new Map<string, { color: string; sizes: Record<string, number>; total: number }>();

  for (const order of ops) {
    const grade = order.grade;
    if (!grade) continue;
    for (const [size, qty] of Object.entries(grade)) {
      const q = Number(qty) || 0;
      if (q <= 0) continue;
      const soleColor = getSoleColor(order.color);
      if (!map.has(soleColor)) map.set(soleColor, { color: soleColor, sizes: {}, total: 0 });
      const row = map.get(soleColor)!;
      row.sizes[size] = (row.sizes[size] || 0) + q;
      row.total += q;
    }
  }

  const soleData = Array.from(map.values()).filter(r => r.total > 0);
  const activeSizes = SIZES_ALL.filter(s => soleData.some(r => (r.sizes[s] || 0) > 0));
  const grandTotal = soleData.reduce((s, r) => s + r.total, 0);
  const sizeTotals: Record<string, number> = {};
  activeSizes.forEach(s => { sizeTotals[s] = 0; });

  let rowsHtml = '';
  soleData.forEach(row => {
    rowsHtml += '<tr>';
    rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;font-weight:600;font-size:11px;">${escapeHtml(row.color)}</td>`;
    activeSizes.forEach(s => {
      const qty = row.sizes[s] || 0; sizeTotals[s] += qty;
      rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
    });
    rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#f5f5f0;">${row.total}</td></tr>`;
  });
  rowsHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
  rowsHtml += '<td style="border:1px solid #999;padding:4px 8px;text-align:right;font-size:11px;">TOTAL</td>';
  activeSizes.forEach(s => { rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;">${sizeTotals[s] || ''}</td>`; });
  rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:13px;">${grandTotal}</td></tr>`;

  let detailHtml = '<h2 style="font-size:13px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Detalhamento por OP</h2>';
  ops.forEach(order => {
    const grade = order.grade;
    if (!grade) return;
    const gradeSum = Object.values(grade).reduce((s, v) => s + Number(v), 0);
    const totalPairs = order.quantity || gradeSum;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    // Hamilton (largest-remainder) garante Σcélulas === totalPairs; o Math.round
    // por célula divergia do total quando multiplier≠1. Auditoria 2026-06-14, Área 3.
    const scaledGrade = scaleGradeWithLargestRemainder(grade, multiplier, totalPairs);
    const gradeStr = activeSizes.map(s => `${s}:${scaledGrade[s] || 0}`).join(' | ');
    detailHtml += `<p style="font-size:10px;margin:2px 0;"><strong>${escapeHtml(order.order_number)}</strong> — ${escapeHtml(order.technical_sheets?.code || '')} ${escapeHtml(order.technical_sheets?.name || '')} — Cor: ${escapeHtml(order.color || '—')} — ${gradeStr} = <strong>${totalPairs} pares</strong></p>`;
  });

  return `
    <div style="border-bottom: 2px solid #333; margin-bottom: 15px; padding-bottom: 5px; display: flex; justify-content: space-between; align-items: flex-end;">
      <h1 style="font-size:20px; margin:0; color:#1a56db;">🦶 Demanda de Solados</h1>
      <div style="text-align:right; font-size:10px; color:#666;">
        Gerado em ${new Date().toLocaleString('pt-BR')} | ${ops.length} OP(s)
      </div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; border:1px solid #999; border-radius:8px; overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="border:1px solid #999; padding:10px 8px; text-align:left; font-size:11px; color:#475569;">Cor Solado</th>
          ${activeSizes.map(s => `<th style="border:1px solid #999; padding:10px 8px; text-align:center; font-size:11px; color:#475569;">${s}</th>`).join('')}
          <th style="border:1px solid #999; padding:10px 8px; text-align:center; font-size:11px; background:#e2e8f0; color:#1e293b;">Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
      ${detailHtml}
    </div>`;

}

async function buildSectorChecklistHtml(ops: OrderWithRef[], sectorName: string, emoji: string, title: string): Promise<string> {
  let fullHtml = '';
  for (let i = 0; i < ops.length; i++) {
    const order = ops[i];
    const ref = order.technical_sheets;
    if (!ref) continue;
    const grade = order.grade;
    const activeSizes = SIZES_ALL.filter(s => grade && Number(grade[s]) > 0);
    const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v), 0) : 0;
    const totalPairs = gradeSum || order.quantity || 0;
    const pairsPerFicha = 12;
    const totalFichas = Math.ceil(totalPairs / pairsPerFicha);

    let imageUrl = '';
    // Try color variant image first
    if (order.color) {
      try {
        const { data: variant } = await supabase
          .from('reference_color_variants')
          .select('image_url')
          .eq('reference_id', order.reference_id)
          .eq('color', order.color)
          .maybeSingle();
        if (variant?.image_url) imageUrl = variant.image_url;
      } catch { /* ignore */ }
    }
    // Fall back to reference main image
    if (!imageUrl) {
      const images = (ref as any).images as string[] | null;
      if (images && images.length > 0) imageUrl = images[0];
      else if (ref.image_url) imageUrl = ref.image_url;
    }
    // Fall back to any variant that has an image
    if (!imageUrl) {
      try {
        const { data: anyVariant } = await supabase
          .from('reference_color_variants')
          .select('image_url')
          .eq('reference_id', order.reference_id)
          .not('image_url', 'is', null)
          .not('image_url', 'eq', '')
          .limit(1)
          .maybeSingle();
        if (anyVariant?.image_url) imageUrl = anyVariant.image_url;
      } catch { /* ignore */ }
    }
    if (!imageUrl) {
      const { data: prodRef } = await supabase.from('product_references').select('image_url').eq('technical_sheet_id', order.reference_id).maybeSingle();
      if (prodRef?.image_url) imageUrl = prodRef.image_url;
    }

    const silkLogoUrl = await getClientLogoUrl(order);
    const imageHtml = imageUrl
      ? `<img src="${safeUrlAttr(imageUrl)}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
      : `<div style="width:200px;height:200px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">Sem foto</div>`;
    const silkHtml = `<img src="${safeUrlAttr(silkLogoUrl)}" style="width:100px;height:100px;object-fit:contain;" />`;

    let gradeHtml = '';
    if (grade && activeSizes.length > 0) {
      gradeHtml = `<table style="border-collapse:collapse;margin-top:5px;">
        <tr style="background:#e8e8d0;">
          ${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 8px;font-size:11px;text-align:center;">${s}</th>`).join('')}
          <th style="border:1px solid #999;padding:3px 8px;font-size:11px;text-align:center;background:#e0e0c8;">Total</th>
        </tr>
        <tr>
          ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;">${Number(grade[s]) || 0}</td>`).join('')}
          <td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;background:#f5f5f0;">${totalPairs}</td>
        </tr>
      </table>`;
    }

    const squaresHtml = Array.from({ length: totalFichas }, (_, j) =>
      `<div style="width:40px;height:40px;border:2px solid #333;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#555;margin:2px;font-weight:600;">${j + 1}</div>`
    ).join('');

    if (i > 0) fullHtml += '<div style="page-break-before:always;"></div>';

    fullHtml += `
      <div style="display:flex; gap:20px; align-items:flex-start; margin-bottom:20px; padding:15px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;">
        <div style="flex-shrink:0;">
          ${imageHtml}
        </div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
            <div>
              <h1 style="font-size:18px; margin:0; color:#1a56db;">${emoji} ${escapeHtml(title)}</h1>
              <p style="font-size:14px; margin:4px 0 0; font-weight:700; color:#475569;">OP: ${escapeHtml(order.order_number)}</p>
            </div>
            <div style="text-align:center; background:white; padding:5px; border-radius:8px; border:1px solid #e2e8f0; min-width:100px;">
              <p style="font-size:8px; color:#94a3b8; text-transform:uppercase; margin:0 0 4px; font-weight:700;">Logotipo SILK</p>
              ${silkHtml}
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; font-size:11px; margin-bottom:12px; padding:10px; background:white; border-radius:6px; border:1px solid #e2e8f0;">
            <div><span style="color:#64748b; font-weight:600;">Referência:</span> <span style="font-weight:700;">${escapeHtml(ref?.code || '')} — ${escapeHtml(ref?.name || '')}</span></div>
            <div><span style="color:#64748b; font-weight:600;">Cor:</span> <span style="font-weight:700;">${escapeHtml(order.color || '—')}</span></div>
            <div><span style="color:#64748b; font-weight:600;">Quantidade:</span> <span style="font-weight:700;">${totalPairs} pares</span></div>
            <div><span style="color:#64748b; font-weight:600;">Status:</span> <span style="font-weight:700; color:#1a56db;">${escapeHtml(order.status)}</span></div>
          </div>

          ${(order as any).item_observation ? `<div style="margin-top:5px; padding:5px 8px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:10px; color:#92400e;"><strong>📝 Observação:</strong> ${escapeHtml((order as any).item_observation)}</div>` : ''}
          <div style="margin-top:4px;">
            ${gradeHtml}
          </div>
        </div>
      </div>
      
      <div style="margin-bottom:30px;">
        <h2 style="font-size:14px; margin:0 0 10px; padding-bottom:5px; border-bottom:2px solid #e2e8f0; color:#1e293b;">
          📋 Controle de Produção — <span style="color:#1a56db;">${totalFichas} fichas</span>
        </h2>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-size:10px; color:#64748b;">
          <span>Setor: <strong>${sectorName}</strong> | Total: <strong>${totalPairs} pares</strong> | Padrão: <strong>${pairsPerFicha} pares/ficha</strong></span>
          <span>Instrução: Marque cada quadrado ao concluir uma ficha.</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:4px; padding:10px; background:#f1f5f9; border-radius:8px;">${squaresHtml}</div>
      </div>`;

  }
  return fullHtml;
}

export async function printAllSectorsForSaleOrder(saleOrderId: string, orderNumber: string) {
  const ops = await fetchOPsForSaleOrder(saleOrderId);
  if (ops.length === 0) {
    throw new Error('Nenhuma OP vinculada a este pedido de venda.');
  }

  // Ordem canônica pós PR1-PR3. Corte unificado renderiza Palmilha+Forração
  // juntos (buildCorteHtml). Setores que tinham apenas placeholder genérico
  // agora recebem checklist próprio.
  const corteHtml = buildCorteHtml(ops);
  const aviamentoHtml = await buildSectorChecklistHtml(ops, 'Aviamento', '🧷', 'Aviamento');
  const costuraHtml = await buildSectorChecklistHtml(ops, 'Costura', '🧵', 'Costura');
  const silkHtml = await buildSectorChecklistHtml(ops, 'Silk', '🎨', 'Silk');
  const colagemHtml = await buildSectorChecklistHtml(ops, 'Colagem', '💨', 'Colagem');
  const montagemHtml = await buildSectorChecklistHtml(ops, 'Montagem', '🔧', 'Montagem');
  const solagemHtml = buildSolagemHtml(ops);
  const acabamentoHtml = await buildSectorChecklistHtml(ops, 'Acabamento', '✨', 'Acabamento');

  const section = (title: string, html: string, fallbackEmoji: string) =>
    html ? html : `<h1>${fallbackEmoji} ${title}</h1><p>Sem dados</p>`;

  const combinedHtml = `
    <div style="margin-bottom:5px;font-size:10px;color:#666;">Pedido de Venda: <strong>${escapeHtml(orderNumber)}</strong> | ${ops.length} OP(s): ${escapeHtml(ops.map(o => o.order_number).join(', '))}</div>

    ${corteHtml}
    <div style="page-break-before:always;"></div>
    ${section('Aviamento', aviamentoHtml, '🧷')}
    <div style="page-break-before:always;"></div>
    ${section('Costura', costuraHtml, '🧵')}
    <div style="page-break-before:always;"></div>
    ${section('Silk', silkHtml, '🎨')}
    <div style="page-break-before:always;"></div>
    ${section('Colagem', colagemHtml, '💨')}
    <div style="page-break-before:always;"></div>
    ${section('Montagem', montagemHtml, '🔧')}
    <div style="page-break-before:always;"></div>
    ${solagemHtml}
    <div style="page-break-before:always;"></div>
    ${section('Acabamento', acabamentoHtml, '✨')}
  `;

  printHtml(`OPs - ${orderNumber}`, combinedHtml);
}
