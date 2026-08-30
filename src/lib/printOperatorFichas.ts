import { supabase } from '@/integrations/supabase/client';
import { filterOperationalOperatorItems } from '@/lib/operatorPrintEligibility';
import { isCancelledOrDraftOrder } from '@/lib/orderStatus';

/**
 * Fichas de operador a partir do pedido (PV) ou de OPs selecionadas — pros setores
 * Corte Forração, Aviamento e Montagem. Pra cada item (referência + cor), gera N
 * fichas REPETIDAS (N = total ÷ pares-por-ficha; ex.: 1104 ÷ 12 = 92), cada uma com
 * a grade BASE (12 pares) numerada "Ficha f/N" — porque cada papel acompanha uma
 * fornada física. Cada fornada sai em 2 vias (OPERADOR + SUPERVISOR). Setor ausente
 * em `technical_sheets.production_sectors` → NÃO gera. (Regras do usuário 2026-06-27.)
 * Print A4 num window.open próprio (inline styles + #000, regra de print).
 */

const SECTORS = ['Corte Forração', 'Aviamento', 'Montagem'] as const;
type Sector = typeof SECTORS[number];
type Via = 'OPERADOR' | 'SUPERVISOR';

/** Setores que a ficha de operador cobre — exposto pro diálogo de seleção. */
export const OPERATOR_FICHA_SECTORS = SECTORS;

/** Cada fornada sai em 2 vias (OPERADOR + SUPERVISOR). */
const VIAS_POR_FICHA = 2;

const SECTOR_THEME: Record<Sector, { bg: string; fg: string }> = {
  'Corte Forração': { bg: '#E1F5EE', fg: '#085041' },
  'Aviamento': { bg: '#FAEEDA', fg: '#633806' },
  'Montagem': { bg: '#EEEDFE', fg: '#3C3489' },
};

const PAPER_WARN_LIMIT = 1000;

interface FichaInput {
  pv: string;
  client: string;
  refCode: string;
  refName: string;
  color: string;
  grade: Record<string, number>; // grade BASE (1 ficha)
  quantity: number;              // total de pares do item/OP
  sectors: string[];             // production_sectors da ficha técnica
}

export interface FichaPlan {
  /** Grade base (1 ficha = 1 fornada). */
  base: Record<string, number>;
  /** Pares por ficha (soma da grade base). */
  baseSum: number;
  /** Nº de fornadas = total ÷ pares por ficha. 0 = não gera nada. */
  nFichas: number;
  /** Setores da ficha técnica que realmente geram ficha (interseção com SECTORS). */
  sectors: Sector[];
  /** Papéis impressos = fornadas × setores × 2 vias. */
  papers: number;
}

/**
 * Quantas fichas um item/OP gera, e em quais setores. FONTE ÚNICA: o render
 * abaixo e o diálogo de seleção (SaleOrders → "Ficha Montagem") chamam esta
 * função, pra prévia na tela bater com o que sai na impressora.
 */
export function planFichas(p: {
  grade: Record<string, number> | null | undefined;
  quantity: number;
  sectors: string[];
}): FichaPlan {
  const base = p.grade || {};
  const baseSum = Object.values(base).reduce((s, v) => s + Number(v || 0), 0);
  const sectors = SECTORS.filter(s => p.sectors.includes(s));
  if (baseSum <= 0 || sectors.length === 0) {
    return { base, baseSum, nFichas: 0, sectors, papers: 0 };
  }
  const total = Number(p.quantity) || baseSum;
  const nFichas = Math.max(1, Math.round(total / baseSum));
  return { base, baseSum, nFichas, sectors, papers: nFichas * sectors.length * VIAS_POR_FICHA };
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fichaHtml(p: {
  sector: Sector; via: Via; pv: string; client: string; date: string;
  refCode: string; refName: string; color: string;
  sizes: string[]; base: Record<string, number>; baseSum: number;
  fornada: number; nFichas: number;
}): string {
  const { sector, via, pv, client, date, refCode, refName, color, sizes, base, baseSum, fornada, nFichas } = p;
  const th = SECTOR_THEME[sector];
  const head = sizes.map(s => `<th>${esc(s)}</th>`).join('');
  const baseRow = sizes.map(s => `<td>${base[s] || 0}</td>`).join('');
  const viaStyle = via === 'SUPERVISOR' ? 'background:#0f172a;color:#fff' : `background:${th.fg};color:#fff`;
  const signLeft = via === 'SUPERVISOR'
    ? 'Conferido por (supervisor): ____________________'
    : 'Executado por (operador): ____________________';
  return `
  <div class="ficha">
    <div class="band" style="background:${th.bg};color:${th.fg}">
      <span class="bt">${esc(sector.toUpperCase())}</span>
      <span class="via" style="${viaStyle}">VIA · ${esc(via)}</span>
    </div>
    <div class="subline">Ficha de produção · ${esc(pv)} · ${esc(client)} · ${esc(date)}</div>
    <div class="meta">
      <div><span class="ml">Referência</span><span class="mv">${esc(refName || refCode || '—')}</span></div>
      ${refCode && refCode !== refName ? `<div><span class="ml">Cód. interno</span><span class="mv">${esc(refCode)}</span></div>` : ''}
      <div><span class="ml">Cor</span><span class="mv">${esc(color || '—')}</span></div>
      <div><span class="ml">Ficha</span><span class="mv tot">${fornada} / ${nFichas}</span></div>
      <div><span class="ml">Pares por ficha</span><span class="mv">${baseSum} pares</span></div>
    </div>
    <table class="grade">
      <thead><tr><th class="rh">Nº</th>${head}<th class="tc">Total</th></tr></thead>
      <tbody><tr><td class="rh">Pares</td>${baseRow}<td class="tc tot">${baseSum}</td></tr></tbody>
    </table>
    <div class="sign"><span>${signLeft}</span><span>Data: ____ / ____</span><span>Visto: __________</span></div>
  </div>`;
}

function renderAndOpen(inputs: FichaInput[], titleHint: string): void {
  const date = new Date().toLocaleDateString('pt-BR');
  const blocks: string[] = [];
  let generated = 0;
  // Agrupa por SETOR (cada setor recebe seu maço).
  for (const sector of SECTORS) {
    const fichas: string[] = [];
    for (const it of inputs) {
      const { base, baseSum, nFichas, sectors } = planFichas(it);
      if (!sectors.includes(sector)) continue; // setor ausente → não gera
      if (nFichas === 0) continue;             // sem grade base → nada a imprimir
      const sizes = Object.keys(base).filter(s => Number(base[s]) > 0).sort((a, b) => Number(a) - Number(b));
      // N fichas REPETIDAS; cada fornada em 2 vias (operador + supervisor, adjacentes).
      for (let f = 1; f <= nFichas; f++) {
        const common = {
          sector, pv: it.pv, client: it.client, date,
          refCode: it.refCode, refName: it.refName, color: it.color,
          sizes, base, baseSum, fornada: f, nFichas,
        };
        fichas.push(fichaHtml({ ...common, via: 'OPERADOR' }));
        fichas.push(fichaHtml({ ...common, via: 'SUPERVISOR' }));
        generated += 2;
      }
    }
    if (fichas.length > 0) blocks.push(`<div class="sector-group">${fichas.join('')}</div>`);
  }

  if (generated === 0) {
    alert('Nenhuma ficha gerada — os itens selecionados não têm Corte Forração, Aviamento ou Montagem na ficha técnica (ou estão sem grade).');
    return;
  }
  if (generated > PAPER_WARN_LIMIT &&
      !window.confirm(`Isso vai gerar ${generated} fichas (papéis), 2 vias por fornada de 12 pares. Continuar?`)) {
    return;
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Fichas de operador · ${esc(titleHint)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#e8e6e1;font-family:Arial,Helvetica,sans-serif;color:#000}
  body{padding:14px}
  @page{size:A4 portrait;margin:10mm}
  .ficha{width:190mm;max-width:100%;margin:0 auto 10px;background:#fff;border:1.5px solid #000;break-inside:avoid;page-break-inside:avoid}
  .band{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1.5px solid #000}
  .band .bt{font-size:16px;font-weight:800;letter-spacing:1px}
  .via{font-size:11px;font-weight:800;letter-spacing:1px;padding:3px 11px;border-radius:3px}
  .subline{padding:4px 12px;border-bottom:1px solid #000;font-size:10px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:.5px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:8px 12px;border-bottom:1px solid #000}
  .meta>div{display:flex;flex-direction:column}
  .ml{font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#555}
  .mv{font-size:13px;font-weight:700}
  .mv.tot{font-size:14px}
  table.grade{width:100%;border-collapse:collapse}
  table.grade th,table.grade td{border:1px solid #000;padding:5px 4px;text-align:center;font-size:12px}
  table.grade th{background:#f2f2f2;font-weight:800;font-size:11px}
  table.grade .rh{text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;width:96px;background:#fafafa}
  table.grade .tc{font-weight:800}
  table.grade .tot{font-size:13px}
  .sign{display:flex;gap:18px;justify-content:space-between;padding:7px 12px;border-top:1px solid #000;font-size:10px;color:#333}
  .print-bar{max-width:190mm;margin:14px auto 0;text-align:center}
  .print-bar button{font:inherit;font-size:12px;font-weight:600;padding:9px 22px;border-radius:4px;cursor:pointer;border:0}
  .print-bar .go{background:#0f172a;color:#fff}
  .print-bar .close{background:#fff;color:#0f172a;border:1px solid #0f172a;margin-left:8px}
  @media print{body{background:#fff;padding:0}.ficha{width:auto}.print-bar{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sector-group{page-break-before:always}.sector-group:first-child{page-break-before:auto}}
</style></head><body>
  ${blocks.join('')}
  <div class="print-bar">
    <button class="go" onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="close" onclick="window.close()">Fechar</button>
  </div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups para gerar as fichas de operador.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Fichas de operador de UM pedido (PV) inteiro — usa os itens do PV (grade base). */
export async function printOperatorFichas(saleOrderId: string, orderNumberHint?: string): Promise<void> {
  const { data: so, error: soErr } = await supabase
    .from('sale_orders').select('order_number, client_name').eq('id', saleOrderId).single();
  if (soErr) throw new Error(`Falha ao carregar o pedido: ${soErr.message}`);

  const { data: items, error: itErr } = await (supabase as any)
    .from('sale_order_items')
    .select('color, grade, quantity, reference_id, production_excluded_at')
    .eq('sale_order_id', saleOrderId);
  if (itErr) throw new Error(`Falha ao carregar itens: ${itErr.message}`);

  const operationalItems = filterOperationalOperatorItems((items || []) as Array<{
    color: string | null;
    grade: Record<string, number> | null;
    quantity: number;
    reference_id: string | null;
    production_excluded_at: string | null;
  }>);
  if (operationalItems.length === 0) {
    alert('Este pedido não tem itens ativos na produção para gerar fichas de operador.');
    return;
  }

  const sheets = await fetchSectorsByRef(operationalItems.map(i => i.reference_id));
  const pv = so?.order_number || orderNumberHint || '';
  const client = (so?.client_name || '').trim();

  const inputs: FichaInput[] = operationalItems.map((it: any) => {
    const sheet = sheetsByRef(sheets, it.reference_id);
    return {
      pv, client,
      refCode: sheet.code, refName: sheet.name, color: it.color || '',
      grade: it.grade || {}, quantity: Number(it.quantity) || 0, sectors: sheet.sectors,
    };
  });
  renderAndOpen(inputs, pv);
}

/**
 * Fichas de operador a partir de OPs SELECIONADAS (tela Imprimir Fichas). A OP guarda
 * a grade ESCALADA (real); a grade BASE (1 ficha) vem de `sale_order_items` pelo
 * `sale_order_item_id` (fallback: deriva a base pelo MDC da grade escalada).
 */
export async function printOperatorFichasFromRows(rows: Array<{
  reference_id: string | null; reference_name?: string; reference_code?: string;
  color?: string; total_pairs?: number | null; grid?: Record<string, number>;
  sale_order_number?: string; client_name?: string; sale_order_item_id?: string | null;
  status?: string;
}>): Promise<void> {
  const valid = rows.filter(r => r.reference_id && !isCancelledOrDraftOrder(r.status));
  if (valid.length === 0) { alert('Selecione ao menos uma OP.'); return; }

  const itemIds = [...new Set(valid.map(r => r.sale_order_item_id).filter(Boolean))] as string[];
  const baseByItem = new Map<string, Record<string, number>>();
  const activeItemIds = new Set<string>();
  if (itemIds.length > 0) {
    const { data, error } = await (supabase as any)
      .from('sale_order_items')
      .select('id, grade, production_excluded_at')
      .in('id', itemIds);
    if (error) throw new Error(`Falha ao validar os itens produtivos: ${error.message}`);
    (data || []).forEach((it: any) => {
      if (it.production_excluded_at != null) return;
      activeItemIds.add(it.id);
      baseByItem.set(it.id, (it.grade || {}) as Record<string, number>);
    });
  }

  // Revalida no clique: se o admin retirou o item enquanto a tela estava
  // aberta, a seleção antiga não pode materializar uma nova ficha fabril.
  const operationalRows = valid.filter(r => !r.sale_order_item_id || activeItemIds.has(r.sale_order_item_id));
  if (operationalRows.length === 0) {
    alert('As OPs selecionadas foram canceladas ou retiradas da produção. Nenhuma ficha foi gerada.');
    return;
  }

  const sheets = await fetchSectorsByRef(operationalRows.map(r => r.reference_id));

  const inputs: FichaInput[] = operationalRows.map(r => {
    const sheet = sheetsByRef(sheets, r.reference_id);
    const base = (r.sale_order_item_id && baseByItem.get(r.sale_order_item_id)) || deriveBaseFromScaled(r.grid || {});
    return {
      pv: r.sale_order_number || '', client: (r.client_name || '').trim(),
      refCode: r.reference_code || sheet.code, refName: r.reference_name || sheet.name,
      color: r.color || '', grade: base, quantity: Number(r.total_pairs) || 0, sectors: sheet.sectors,
    };
  });
  const pvs = [...new Set(operationalRows.map(r => r.sale_order_number).filter(Boolean))];
  renderAndOpen(inputs, pvs.length === 1 ? pvs[0]! : `${operationalRows.length} OPs`);
}

type SheetInfo = { code: string; name: string; sectors: string[] };

async function fetchSectorsByRef(refIds: (string | null)[]): Promise<Map<string, SheetInfo>> {
  const ids = [...new Set(refIds.filter(Boolean))] as string[];
  const map = new Map<string, SheetInfo>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from('technical_sheets').select('id, code, name, production_sectors').in('id', ids);
  (data || []).forEach((s: any) => map.set(s.id, {
    code: s.code || '', name: s.name || '',
    sectors: Array.isArray(s.production_sectors) ? s.production_sectors.map(String) : [],
  }));
  return map;
}

function sheetsByRef(map: Map<string, SheetInfo>, refId: string | null): SheetInfo {
  return (refId && map.get(refId)) || { code: '', name: '', sectors: [] };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

/**
 * Deriva a grade base (1 ficha) de uma grade escalada pelo MDC dos valores.
 * Exportada porque o diálogo de seleção precisa da MESMA base pra prever
 * quantas fichas cada OP gera quando ela não tem `sale_order_item_id`.
 */
export function deriveBaseFromScaled(scaled: Record<string, number>): Record<string, number> {
  const vals = Object.values(scaled).map(v => Math.round(Number(v) || 0)).filter(v => v > 0);
  if (vals.length === 0) return scaled;
  const g = vals.reduce((acc, v) => gcd(acc, v));
  if (g <= 1) return scaled;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scaled)) out[k] = Math.round((Number(v) || 0) / g);
  return out;
}
