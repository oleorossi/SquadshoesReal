import { openPrintWindow, writePrintWindow } from './printOrder';
import { escapeHtml } from './htmlUtils';
import { scaleGradeWithLargestRemainder } from './scaleGrade';

export type { OrderData as GroupedReportOrderData, ReferenceData as GroupedReportReferenceData };

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

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
  images?: string[];
};

type SaleOrderData = {
  id: string;
  order_number?: string;
  client_name?: string;
  client_order_number?: string;
};

type GroupedItem = {
  refId: string;
  refCode: string;
  refName: string;
  color: string;
  imageUrl: string;
  sizes: Record<string, number>;
  baseGrade: Record<string, number>;
  baseGradeSum: number;
  fichas: number;
  totalPairs: number;
  opNumbers: string[];
  opDetails: Array<{ opNumber: string; quantity: number }>;
  category: string;
  strapsLabel?: string;
  clientNames: Set<string>;
  soleType: string;
};

// ── Sector visual config ─────────────────────────────────────────────────────
const SECTOR_CONFIG: Record<string, { color: string; lightBg: string; darkBg: string; emoji: string; description: string }> = {
  'Corte':      { color: '#7c2d12', lightBg: '#fff7ed', darkBg: '#c2410c', emoji: '✂️',  description: 'Corte de materiais por numeração' },
  'Forração':   { color: '#134e4a', lightBg: '#f0fdfa', darkBg: '#0d9488', emoji: '🧵',  description: 'Forração e preparação de palmilhas' },
  'Aviamento':  { color: '#164e63', lightBg: '#ecfeff', darkBg: '#0891b2', emoji: '🧷',  description: 'Aplicação de acessórios e tiras' },
  'Silk':       { color: '#701a75', lightBg: '#fdf4ff', darkBg: '#a21caf', emoji: '🎨',  description: 'Serigrafia e estampagem' },
  'Colagem':    { color: '#713f12', lightBg: '#fefce8', darkBg: '#ca8a04', emoji: '🔥',  description: 'Colagem de solado e montagem base' },
  'Montagem':   { color: '#1e3a5f', lightBg: '#eff6ff', darkBg: '#1d4ed8', emoji: '🔧',  description: 'Montagem e prensa do cabedal' },
  'Solagem':    { color: '#14532d', lightBg: '#f0fdf4', darkBg: '#16a34a', emoji: '🦶',  description: 'Solagem e fixação do solado' },
  'Acabamento': { color: '#064e3b', lightBg: '#ecfdf5', darkBg: '#059669', emoji: '✨',  description: 'Acabamento, revisão e embalagem' },
};

function getSectorConfig(name: string) {
  return SECTOR_CONFIG[name] || { color: '#1e293b', lightBg: '#f8fafc', darkBg: '#334155', emoji: '📋', description: name };
}

function deriveSoleType(color: string): string {
  const c = (color || '').toLowerCase().normalize('NFC').trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Solado Preto';
  return 'Solado Caramelo';
}

function classifyCategory(shoeCategory: string | undefined): string {
  const cat = (shoeCategory || '').toLowerCase().trim();
  if (cat.includes('infantil') || cat.includes('kids') || cat.includes('criança') || cat.includes('bebe') || cat.includes('bebê')) return 'Infantil';
  if (cat.includes('adulto') || cat.includes('adult') || cat.includes('feminino') || cat.includes('masculino')) return 'Adulto';
  if (cat) return cat.charAt(0).toUpperCase() + cat.slice(1);
  return 'Sem Categoria';
}

function normalizeGroupPart(value: string): string {
  return value.trim().toUpperCase().normalize('NFC');
}

// ── Shared CSS for all A4-landscape sector reports ───────────────────────────
function buildSectorReportCss(cfg: { color: string; lightBg: string; darkBg: string }): string {
  return `
  <style>
    @page { size: A4 landscape; margin: 8mm 8mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px; color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-break { page-break-after: always; break-after: page; }
    .avoid-break { page-break-inside: avoid; break-inside: avoid; }

    /* ── Report header ── */
    .report-header {
      display: flex; align-items: stretch; gap: 0;
      margin-bottom: 8px;
      border-radius: 6px; overflow: hidden;
      border: 2px solid ${cfg.darkBg};
    }
    .report-header-sector {
      background: ${cfg.darkBg}; color: #fff;
      padding: 6px 14px;
      display: flex; align-items: center; gap: 8px;
    }
    .report-header-sector h1 { font-size: 17px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
    .report-header-sector p  { font-size: 9px;  opacity: 0.85; margin-top: 2px; }
    .report-header-meta {
      flex: 1; background: ${cfg.lightBg};
      padding: 6px 14px;
      display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    }
    .meta-item { text-align: center; }
    .meta-item .val { font-size: 18px; font-weight: 900; color: ${cfg.color}; line-height: 1; }
    .meta-item .lbl { font-size: 8px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.4px; }
    .report-ts { margin-left: auto; font-size: 8px; color: #94a3b8; text-align: right; }

    /* ── Sole / category section headers ── */
    .sole-header {
      border-top: 3px solid ${cfg.darkBg};
      padding: 5px 0 3px;
      margin-top: 10px;
    }
    .sole-header h2 { font-size: 14px; font-weight: 900; color: ${cfg.color}; }
    .cat-header {
      border-bottom: 1px solid #cbd5e1;
      margin: 6px 0 4px; padding-bottom: 2px;
    }
    .cat-header h3 { font-size: 12px; font-weight: 700; color: #475569; }

    /* ── Product card ── */
    .product-card {
      border: 1px solid #e2e8f0;
      border-left: 4px solid ${cfg.darkBg};
      border-radius: 4px;
      padding: 6px 8px;
      margin-bottom: 5px;
      display: flex; gap: 8px; align-items: flex-start;
      background: #fff;
    }
    .product-card .img-wrap {
      width: 80px; height: 80px; flex-shrink: 0;
      border: 1px solid #e2e8f0; border-radius: 4px;
      overflow: hidden; background: #f8fafc;
      display: flex; align-items: center; justify-content: center;
    }
    .product-card .img-wrap img { width: 100%; height: 100%; object-fit: contain; }
    .product-card .img-wrap .no-img { font-size: 8px; color: #94a3b8; text-align: center; }
    .product-card .info { flex: 1; min-width: 0; }
    .product-card .ref-line {
      display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 2px;
    }
    .product-card .ref-name { font-size: 13px; font-weight: 800; color: #0f172a; }
    .product-card .ref-color { font-size: 11px; color: #475569; }
    .product-card .ref-pairs { font-size: 12px; font-weight: 700; color: ${cfg.color}; }
    .product-card .ref-fichas { font-size: 9px; color: #64748b; }
    /* ── OP list mini-table ── */
    .ops-block { margin: 4px 0; }
    .ops-block-title { font-size: 7.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #94a3b8; margin-bottom: 2px; }
    .ops-table { border-collapse: collapse; font-size: 8.5px; }
    .ops-table td { border: 1px solid #e2e8f0; padding: 1px 5px; font-family: 'Courier New', monospace; }
    .ops-table td.op-num { font-weight: 700; color: #0f172a; background: #f8fafc; }
    .ops-table td.op-qty { color: #0369a1; font-weight: 600; text-align: center; }
    .ops-single { font-size: 8px; color: #64748b; margin: 2px 0; font-family: 'Courier New', monospace; }
    .badge-client { font-size: 9px; padding: 1px 5px; background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 3px; color: #0369a1; font-weight: 600; }
    .badge-straps { font-size: 10px; color: #b91c1c; font-weight: 700; }

    /* ── Grade table ── */
    .grade-table { border-collapse: collapse; margin-top: 4px; }
    .grade-table th {
      border: 1px solid #cbd5e1; padding: 2px 5px;
      text-align: center; font-size: 9px; font-weight: 700;
      background: #f1f5f9; color: #475569; text-transform: uppercase;
    }
    .grade-table th.size-header { background: ${cfg.lightBg}; color: ${cfg.color}; }
    .grade-table th.total-header { background: #e2e8f0; }
    .grade-table td {
      border: 1px solid #cbd5e1; padding: 2px 5px;
      text-align: center; font-family: 'Courier New', monospace;
    }
    .grade-table td.base-val { font-size: 9px; color: #94a3b8; background: #fafafa; }
    .grade-table td.main-val { font-size: 12px; font-weight: 700; color: #0f172a; }
    .grade-table td.main-val.zero { color: #e2e8f0; font-weight: 400; font-size: 9px; }
    .grade-table td.total-val { font-size: 12px; font-weight: 900; color: ${cfg.color}; background: #f8fafc; }

    /* ── Category subtotal ── */
    .subtotal-table { border-collapse: collapse; width: 100%; margin: 4px 0 12px; }
    .subtotal-table td {
      border: 1px solid #cbd5e1; padding: 3px 6px;
      text-align: center; font-family: 'Courier New', monospace; font-size: 10px;
      background: #f1f5f9;
    }
    .subtotal-table td.label { text-align: right; font-size: 9px; font-weight: 700; color: #475569; font-family: inherit; }
    .subtotal-table td.grand { font-size: 12px; font-weight: 900; color: ${cfg.color}; background: #e2e8f0; }

    /* ── Sector-specific blocks ── */
    .sector-note {
      border: 1px solid #e2e8f0; border-radius: 4px;
      padding: 4px 8px; margin-top: 4px;
      background: ${cfg.lightBg};
      font-size: 9px; color: ${cfg.color};
    }
    .boxes-wrap { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
    .box { width: 22px; height: 22px; border: 2px solid ${cfg.darkBg}; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 900; color: ${cfg.color}; }

    /* ── Grand summary table ── */
    .summary-table { border-collapse: collapse; width: 100%; margin-top: 6px; font-size: 9px; }
    .summary-table th { border: 1px solid #cbd5e1; padding: 3px 5px; background: #1e293b; color: #fff; font-weight: 700; text-transform: uppercase; font-size: 8.5px; }
    .summary-table td { border: 1px solid #cbd5e1; padding: 3px 5px; }
    .summary-table tr:nth-child(even) td { background: #f8fafc; }
    .summary-table .total-row td { background: #f1f5f9 !important; font-weight: 900; border-top: 2px solid #334155; font-size: 10px; }
    .summary-table td.mono { font-family: 'Courier New', monospace; text-align: center; }
    .summary-table td.num  { font-weight: 700; text-align: center; font-family: 'Courier New', monospace; }

    @media screen {
      body { background: #f1f5f9; padding: 10px; max-width: 297mm; margin: 0 auto; }
      .product-card { box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    }
  </style>
  `;
}

// ── Sector-specific extra info rendered inside each product card ─────────────
function buildSectorExtra(sectorName: string, group: GroupedItem): string {
  switch (sectorName) {
    case 'Aviamento':
    case 'Acabamento': {
      const boxes = Math.ceil(group.totalPairs / 12);
      const strapsHtml = group.strapsLabel
        ? `<span class="badge-straps">🎨 Tiras: ${escapeHtml(group.strapsLabel)}</span>`
        : '';
      let boxesHtml = '';
      if (boxes > 0) {
        const maxBoxes = Math.min(boxes, 24);
        const boxDivs = Array.from({ length: maxBoxes }, (_, i) => `<div class="box">${i + 1}</div>`).join('');
        const extra = boxes > maxBoxes ? `<span style="font-size:8px;color:#94a3b8;">+${boxes - maxBoxes}</span>` : '';
        boxesHtml = `
          <div class="sector-note" style="margin-top:4px;">
            <strong>${boxes} caixa(s) × 12 pares</strong>
            <div class="boxes-wrap">${boxDivs}${extra}</div>
          </div>`;
      }
      return (strapsHtml ? `<div style="margin-top:3px;">${strapsHtml}</div>` : '') + boxesHtml;
    }

    case 'Solagem':
    case 'Colagem':
    case 'Montagem': {
      const soleColor = deriveSoleType(group.color) === 'Solado Preto' ? 'Preto' : 'Caramelo';
      return `
        <div class="sector-note" style="display:flex;gap:16px;align-items:center;">
          <div><span style="font-size:8px;font-weight:700;text-transform:uppercase;color:#64748b;">Solado</span><br><strong style="font-size:11px;">${escapeHtml(soleColor)}</strong></div>
          <div style="width:1px;height:24px;background:#e2e8f0;"></div>
          <div><span style="font-size:8px;font-weight:700;text-transform:uppercase;color:#64748b;">Palmilha</span><br><strong style="font-size:11px;">${escapeHtml(soleColor === 'Preto' ? 'Preto' : 'Caramelo')}</strong></div>
        </div>`;
    }

    case 'Corte': {
      const strapsHtml = group.strapsLabel
        ? `<span class="badge-straps">🎨 Tiras: ${escapeHtml(group.strapsLabel)}</span>`
        : '';
      return strapsHtml ? `<div style="margin-top:3px;">${strapsHtml}</div>` : '';
    }

    case 'Silk': {
      return `<div class="sector-note">⚠️ Verificar silk/estampa na ficha técnica antes de iniciar.</div>`;
    }

    default:
      return group.strapsLabel
        ? `<div style="margin-top:3px;"><span class="badge-straps">🎨 Tiras: ${escapeHtml(group.strapsLabel)}</span></div>`
        : '';
  }
}

// ── Main builder ─────────────────────────────────────────────────────────────
export function buildGroupedReportHtml(
  sectorName: string,
  sectorEmoji: string,
  selectedOrders: OrderData[],
  references: ReferenceData[],
  getStrapsLabel?: (order: any) => string,
  saleOrders?: SaleOrderData[],
): string {
  if (selectedOrders.length === 0) return '';

  const cfg = getSectorConfig(sectorName);

  // Build grouped items
  const groupMap = new Map<string, GroupedItem>();

  for (const order of selectedOrders) {
    const ref = references.find(r => r.id === order.reference_id);
    if (!ref) continue;
    const grade = order.grade;
    const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v), 0) : 0;
    const totalPairs = order.quantity || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    const fichas = gradeSum > 0 ? Math.round(totalPairs / gradeSum) : 1;
    const color = order.color || '—';
    const category = classifyCategory(ref.shoe_category);
    const colorKey = normalizeGroupPart(color);
    const soleType = deriveSoleType(color);
    const soleKey = normalizeGroupPart(soleType);
    const strapsLabel = getStrapsLabel
      ? (() => { try { return getStrapsLabel(order) || ''; } catch { return ''; } })()
      : '';
    const strapsKey = normalizeGroupPart(strapsLabel || '__NO_STRAPS__');
    const storeKey = sectorName === 'Acabamento' ? (order.sale_order_id || '__NO_SO__') : '__ALL__';
    const key = soleKey + '|' + category + '|' + order.reference_id + '|' + colorKey + '|' + strapsKey + '|' + storeKey;

    if (!groupMap.has(key)) {
      const images = ref.images as string[] | undefined;
      const imageUrl = (images && images.length > 0 ? images[0] : ref.image_url) || '';
      const baseGrade: Record<string, number> = {};
      if (grade) {
        for (const s of SIZES) {
          const qty = Number(grade[s]) || 0;
          if (qty > 0) baseGrade[s] = qty;
        }
      }
      groupMap.set(key, {
        refId: order.reference_id,
        refCode: ref.code || '',
        refName: ref.name || '',
        color,
        imageUrl,
        sizes: {},
        baseGrade,
        baseGradeSum: gradeSum,
        fichas: 0,
        totalPairs: 0,
        opNumbers: [],
        opDetails: [],
        category,
        strapsLabel: strapsLabel || undefined,
        clientNames: new Set<string>(),
        soleType,
      });
    }
    const group = groupMap.get(key)!;
    group.opNumbers.push(order.order_number);
    group.opDetails.push({ opNumber: order.order_number, quantity: totalPairs });
    group.totalPairs += totalPairs;
    group.fichas += fichas;
    if (!group.strapsLabel && strapsLabel) group.strapsLabel = strapsLabel;
    if (saleOrders && order.sale_order_id) {
      const so = saleOrders.find(s => s.id === order.sale_order_id);
      if (so?.client_name) group.clientNames.add(so.client_name);
    }
    // Per-order scaling with largest-remainder distribution so the contribution
    // to group.sizes sums exactly to the order's totalPairs. Naive per-size
    // Math.round per order accumulated rounding error across orders.
    if (grade) {
      const scaled = scaleGradeWithLargestRemainder(grade as Record<string, number>, multiplier, totalPairs);
      for (const [sKey, qty] of Object.entries(scaled)) {
        if (qty > 0) group.sizes[sKey] = (group.sizes[sKey] || 0) + qty;
      }
    }
  }

  const items = Array.from(groupMap.values());

  items.sort((a, b) => {
    const bySole = a.soleType.localeCompare(b.soleType, 'pt-BR');
    if (bySole !== 0) return bySole;
    if (sectorName === 'Acabamento') {
      const aClient = a.clientNames.size > 0 ? Array.from(a.clientNames).join(', ') : 'zzz';
      const bClient = b.clientNames.size > 0 ? Array.from(b.clientNames).join(', ') : 'zzz';
      const byClient = aClient.localeCompare(bClient, 'pt-BR');
      if (byClient !== 0) return byClient;
    }
    const byCat = (() => {
      if (a.category === 'Adulto') return -1;
      if (b.category === 'Adulto') return 1;
      if (a.category === 'Infantil') return -1;
      if (b.category === 'Infantil') return 1;
      return a.category.localeCompare(b.category);
    })();
    if (byCat !== 0) return byCat;
    const byRef = (a.refCode + ' ' + a.refName).localeCompare(b.refCode + ' ' + b.refName, 'pt-BR');
    if (byRef !== 0) return byRef;
    return a.color.localeCompare(b.color, 'pt-BR');
  });

  const soleMap = new Map<string, Map<string, GroupedItem[]>>();
  for (const item of items) {
    if (!soleMap.has(item.soleType)) soleMap.set(item.soleType, new Map());
    const catMap = soleMap.get(item.soleType)!;
    if (!catMap.has(item.category)) catMap.set(item.category, []);
    catMap.get(item.category)!.push(item);
  }

  // Collect all active sizes across all items (preserves conjugated keys)
  const allActiveSizeSet = new Set<string>();
  items.forEach(g => Object.keys(g.sizes).forEach(s => { if ((g.sizes[s] || 0) > 0) allActiveSizeSet.add(s); }));
  // Sort sizes: numeric first, then conjugated like "24/25"
  const allActiveSizes = Array.from(allActiveSizeSet).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const grandTotalPairs = items.reduce((s, g) => s + g.totalPairs, 0);

  // ── HTML output ──
  let html = buildSectorReportCss(cfg);

  // Report header
  const soleStatCards = Array.from(soleMap.entries()).map(([sole, catMap]) => {
    const soleTotal = Array.from(catMap.values()).flat().reduce((s, g) => s + g.totalPairs, 0);
    const soleLabel = sole === 'Solado Preto' ? '⬛ Solado Preto' : '🟨 Solado Caramelo';
    return `<div class="meta-item"><div class="val">${soleTotal}</div><div class="lbl">${soleLabel}</div></div>`;
  }).join('');

  html += `
  <div class="report-header avoid-break">
    <div class="report-header-sector">
      <div>
        <h1>${sectorEmoji} ${escapeHtml(sectorName)}</h1>
        <p>${escapeHtml(cfg.description)}</p>
      </div>
    </div>
    <div class="report-header-meta">
      <div class="meta-item"><div class="val">${selectedOrders.length}</div><div class="lbl">OPs</div></div>
      <div class="meta-item"><div class="val">${items.length}</div><div class="lbl">Grupos</div></div>
      <div class="meta-item"><div class="val">${grandTotalPairs}</div><div class="lbl">Total Pares</div></div>
      ${soleStatCards}
      <div class="report-ts">Gerado em<br>${new Date().toLocaleString('pt-BR')}</div>
    </div>
  </div>`;

  // Per sole type → category
  for (const [soleType, catMap] of soleMap) {
    const soleTotal = Array.from(catMap.values()).flat().reduce((s, g) => s + g.totalPairs, 0);
    const soleEmoji = soleType === 'Solado Preto' ? '⬛' : '🟨';

    html += `<div class="sole-header avoid-break">
      <h2>${soleEmoji} ${escapeHtml(soleType)} — ${soleTotal} pares</h2>
    </div>`;

    const sortedCats = Array.from(catMap.entries()).sort(([a], [b]) => {
      if (a === 'Adulto') return -1;
      if (b === 'Adulto') return 1;
      if (a === 'Infantil') return -1;
      if (b === 'Infantil') return 1;
      return a.localeCompare(b);
    });

    for (const [category, catItems] of sortedCats) {
      const catTotal = catItems.reduce((s, g) => s + g.totalPairs, 0);
      const catSizeTotals: Record<string, number> = {};
      allActiveSizes.forEach(s => { catSizeTotals[s] = 0; });

      html += `<div class="cat-header"><h3>${escapeHtml(category)} — ${catTotal} pares</h3></div>`;

      for (const group of catItems) {
        const oSizes = allActiveSizes.filter(s => (group.sizes[s] || 0) > 0 || (group.baseGrade[s] || 0) > 0);

        const imgHtml = group.imageUrl
          ? `<img src="${group.imageUrl}" />`
          : `<div class="no-img">Sem<br>foto</div>`;

        // Grade table
        let gradeHtml = '';
        if (oSizes.length > 0) {
          const headerCells = oSizes.map(s => `<th class="size-header">${s}</th>`).join('');
          const showBase = group.baseGradeSum > 0 && group.fichas > 1;
          const baseRow = showBase
            ? `<tr>${oSizes.map(s => `<td class="base-val">${group.baseGrade[s] || ''}</td>`).join('')}<td class="base-val">${group.baseGradeSum}p</td></tr>`
            : '';
          const mainRow = `<tr>${oSizes.map(s => {
            const q = group.sizes[s] || 0;
            return `<td class="main-val${q === 0 ? ' zero' : ''}">${q || '–'}</td>`;
          }).join('')}<td class="total-val">${group.totalPairs}</td></tr>`;

          gradeHtml = `
          <table class="grade-table">
            <thead><tr>${headerCells}<th class="total-header">Total</th></tr></thead>
            <tbody>${baseRow}${mainRow}</tbody>
          </table>`;
        }

        oSizes.forEach(s => { catSizeTotals[s] += group.sizes[s] || 0; });

        const clientBadge = group.clientNames.size > 0
          ? `<span class="badge-client">🏪 ${escapeHtml(Array.from(group.clientNames).join(', '))}</span>`
          : '';
        const fichasInfo = group.fichas > 1
          ? `<span class="ref-fichas">${group.fichas} fichas × ${group.baseGradeSum}p</span>`
          : '';

        const sectorExtra = buildSectorExtra(sectorName, group);

        // OP list block — single OP stays compact; multiple OPs get a mini-table
        let opsHtml = '';
        if (group.opDetails.length === 1) {
          opsHtml = `<div class="ops-single">OP: <strong>${escapeHtml(group.opDetails[0].opNumber)}</strong> — ${group.opDetails[0].quantity} pares</div>`;
        } else {
          const opRows = group.opDetails
            .map(d => `<tr><td class="op-num">${escapeHtml(d.opNumber)}</td><td class="op-qty">${d.quantity} pares</td></tr>`)
            .join('');
          opsHtml = `
          <div class="ops-block">
            <div class="ops-block-title">Ordens de Produção agrupadas (${group.opDetails.length})</div>
            <table class="ops-table"><tbody>${opRows}</tbody></table>
          </div>`;
        }

        html += `
        <div class="product-card avoid-break">
          <div class="img-wrap">${imgHtml}</div>
          <div class="info">
            <div class="ref-line">
              <span class="ref-name">${escapeHtml(group.refCode)} — ${escapeHtml(group.refName)}</span>
              <span class="ref-color">Cor: <strong>${escapeHtml(group.color)}</strong></span>
              <span class="ref-pairs">${group.totalPairs} pares</span>
              ${fichasInfo}
              ${clientBadge}
            </div>
            ${opsHtml}
            ${gradeHtml}
            ${sectorExtra}
          </div>
        </div>`;
      }

      // Category subtotal row
      const subtotalCells = allActiveSizes.map(s =>
        `<td${catSizeTotals[s] > 0 ? ' style="font-weight:700;"' : ''}>${catSizeTotals[s] || ''}</td>`
      ).join('');
      html += `
      <table class="subtotal-table avoid-break">
        <tr>
          <td class="label">Subtotal ${escapeHtml(soleType)} / ${escapeHtml(category)}</td>
          ${subtotalCells}
          <td class="grand">${catTotal}</td>
        </tr>
      </table>`;
    }
  }

  // ── Grand summary (last section, own page) ──────────────────────────────────
  const grandSizeTotals: Record<string, number> = {};
  allActiveSizes.forEach(s => { grandSizeTotals[s] = 0; });

  let summaryRows = '';
  items.forEach(group => {
    summaryRows += '<tr>';
    summaryRows += `<td>${escapeHtml(group.soleType)}</td>`;
    summaryRows += `<td style="font-weight:600;">${escapeHtml(group.refCode + ' ' + group.refName)}</td>`;
    summaryRows += `<td>${escapeHtml(group.color)}</td>`;
    summaryRows += `<td style="color:#0369a1;">${group.clientNames.size > 0 ? escapeHtml(Array.from(group.clientNames).join(', ')) : '—'}</td>`;
    summaryRows += `<td style="color:#64748b;">${escapeHtml(group.opNumbers.join(', '))}</td>`;
    allActiveSizes.forEach(s => {
      const qty = group.sizes[s] || 0;
      grandSizeTotals[s] += qty;
      summaryRows += `<td class="mono"${qty > 0 ? ' style="font-weight:700;"' : ''}>${qty || ''}</td>`;
    });
    summaryRows += `<td class="num" style="color:${cfg.color};">${group.totalPairs}</td>`;
    summaryRows += '</tr>';
  });

  summaryRows += `<tr class="total-row">
    <td colspan="5" style="text-align:right;">TOTAL GERAL</td>
    ${allActiveSizes.map(s => `<td class="mono">${grandSizeTotals[s] || ''}</td>`).join('')}
    <td class="num">${grandTotalPairs}</td>
  </tr>`;

  html += `
  <div class="page-break"></div>
  <div style="margin-top:6px;">
    <h2 style="font-size:13px;font-weight:800;margin-bottom:6px;color:${cfg.color};border-bottom:2px solid ${cfg.darkBg};padding-bottom:3px;">
      Resumo Geral — ${escapeHtml(sectorName)} (${grandTotalPairs} pares)
    </h2>
    <table class="summary-table">
      <thead><tr>
        <th>Solado</th><th>Referência</th><th>Cor</th><th>Lojas</th><th>OPs</th>
        ${allActiveSizes.map(s => `<th>${s}</th>`).join('')}
        <th>Total</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>`;

  return html;
}

// ── Standalone print function ─────────────────────────────────────────────────
export function printGroupedReport(
  sectorName: string,
  sectorEmoji: string,
  selectedOrders: OrderData[],
  references: ReferenceData[],
  getStrapsLabel?: (order: any) => string,
  saleOrders?: SaleOrderData[],
) {
  if (selectedOrders.length === 0) return;

  const printWin = openPrintWindow('Agrupado ' + sectorName);

  try {
    const html = buildGroupedReportHtml(sectorName, sectorEmoji, selectedOrders, references, getStrapsLabel, saleOrders);
    // CSS already embedded in buildGroupedReportHtml; pass landscape false to avoid overriding @page
    writePrintWindow(printWin, 'Agrupado ' + sectorName, html, { landscape: true });
  } catch (error) {
    console.error('Erro ao gerar relatório agrupado', error);
    const message = error instanceof Error ? error.message : 'Falha inesperada ao montar o relatório.';
    writePrintWindow(
      printWin,
      'Agrupado ' + sectorName,
      `<h1 style="font-size:18px;margin-bottom:8px;">Erro ao gerar relatório agrupado</h1><p style="font-size:12px;color:#444;">${message}</p>`
    );
  }
}
