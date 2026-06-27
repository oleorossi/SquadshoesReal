import { supabase } from '@/integrations/supabase/client';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

/**
 * Fichas de operador AUTOMÁTICAS a partir do pedido (PV) — só pros setores
 * Costura, Aviamento e Montagem. Pra cada item (referência + cor) gera 2 vias
 * (OPERADOR + SUPERVISOR) por setor que esteja em `technical_sheets.production_sectors`. Setor ausente
 * na ficha técnica → NÃO gera (decisão do usuário 2026-06-27). A grade mostra
 * DUAS linhas: "por ficha" (grade base) e "total pedido" (escalada à quantidade).
 * Print A4 num window.open próprio (inline styles + #000, regra de print).
 */

const SECTORS = ['Costura', 'Aviamento', 'Montagem'] as const;
type Sector = typeof SECTORS[number];

const SECTOR_THEME: Record<Sector, { bg: string; fg: string }> = {
  Costura: { bg: '#E1F5EE', fg: '#085041' },
  Aviamento: { bg: '#FAEEDA', fg: '#633806' },
  Montagem: { bg: '#EEEDFE', fg: '#3C3489' },
};

interface ItemRow {
  color: string | null;
  grade: Record<string, number> | null;
  quantity: number | null;
  reference_id: string | null;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Via = 'OPERADOR' | 'SUPERVISOR';

function fichaHtml(params: {
  sector: Sector; via: Via; pv: string; client: string; date: string;
  refCode: string; refName: string; color: string;
  sizes: string[]; base: Record<string, number>; scaled: Record<string, number>;
  baseSum: number; total: number;
}): string {
  const { sector, via, pv, client, date, refCode, refName, color, sizes, base, scaled, baseSum, total } = params;
  const th = SECTOR_THEME[sector];
  const head = sizes.map(s => `<th>${esc(s)}</th>`).join('');
  const baseRow = sizes.map(s => `<td>${base[s] || 0}</td>`).join('');
  const scaledRow = sizes.map(s => `<td>${scaled[s] || 0}</td>`).join('');
  const nFichas = baseSum > 0 ? Math.round(total / baseSum) : 0;
  // Selo de via bem distinto pra não misturar: operador = cor do setor; supervisor = preto.
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
      <div><span class="ml">Referência</span><span class="mv">${esc(refName)}${refCode ? ` · ${esc(refCode)}` : ''}</span></div>
      <div><span class="ml">Cor</span><span class="mv">${esc(color || '—')}</span></div>
      <div><span class="ml">Fichas</span><span class="mv">${nFichas} × ${baseSum}/ficha</span></div>
      <div><span class="ml">Total</span><span class="mv tot">${total} pares</span></div>
    </div>
    <table class="grade">
      <thead><tr><th class="rh">Nº</th>${head}<th class="tc">Total</th></tr></thead>
      <tbody>
        <tr><td class="rh">Por ficha</td>${baseRow}<td class="tc">${baseSum}</td></tr>
        <tr><td class="rh">Total pedido</td>${scaledRow}<td class="tc tot">${total}</td></tr>
      </tbody>
    </table>
    <div class="sign"><span>${signLeft}</span><span>Data: ____ / ____</span><span>Visto: __________</span></div>
  </div>`;
}

export async function printOperatorFichas(saleOrderId: string, orderNumberHint?: string): Promise<void> {
  const { data: so, error: soErr } = await supabase
    .from('sale_orders')
    .select('order_number, client_name, created_at')
    .eq('id', saleOrderId)
    .single();
  if (soErr) throw new Error(`Falha ao carregar o pedido: ${soErr.message}`);

  const { data: items, error: itErr } = await supabase
    .from('sale_order_items')
    .select('color, grade, quantity, reference_id')
    .eq('sale_order_id', saleOrderId);
  if (itErr) throw new Error(`Falha ao carregar itens: ${itErr.message}`);

  const refIds = [...new Set((items || []).map((i: any) => i.reference_id).filter(Boolean))] as string[];
  const sheetsById = new Map<string, { code: string; name: string; production_sectors: string[] }>();
  if (refIds.length > 0) {
    const { data: sheets } = await supabase
      .from('technical_sheets')
      .select('id, code, name, production_sectors')
      .in('id', refIds);
    (sheets || []).forEach((s: any) => sheetsById.set(s.id, {
      code: s.code || '', name: s.name || '',
      production_sectors: Array.isArray(s.production_sectors) ? s.production_sectors.map(String) : [],
    }));
  }

  const pv = so?.order_number || orderNumberHint || '';
  const client = (so?.client_name || '').trim();
  const date = new Date().toLocaleDateString('pt-BR');

  // Agrupa por SETOR (cada setor recebe seu maço de fichas).
  const blocks: string[] = [];
  let generated = 0;
  for (const sector of SECTORS) {
    const sectorFichas: string[] = [];
    for (const it of (items || []) as ItemRow[]) {
      if (!it.reference_id) continue;
      const sheet = sheetsById.get(it.reference_id);
      if (!sheet) continue;
      if (!sheet.production_sectors.includes(sector)) continue; // setor ausente → não gera
      const grade = it.grade || {};
      const baseSum = Object.values(grade).reduce((s, v) => s + Number(v || 0), 0);
      if (baseSum <= 0) continue;
      const total = Number(it.quantity) || baseSum;
      const multiplier = total / baseSum;
      const scaled = scaleGradeWithLargestRemainder(grade, multiplier, total);
      const sizes = Object.keys(grade).filter(s => Number(grade[s]) > 0).sort((a, b) => Number(a) - Number(b));
      const common = {
        sector, pv, client, date,
        refCode: sheet.code, refName: sheet.name, color: it.color || '',
        sizes, base: grade, scaled, baseSum, total,
      };
      // 2 vias por ficha: operador + supervisor (adjacentes pra separar fácil).
      sectorFichas.push(fichaHtml({ ...common, via: 'OPERADOR' }));
      sectorFichas.push(fichaHtml({ ...common, via: 'SUPERVISOR' }));
      generated += 2;
    }
    if (sectorFichas.length > 0) {
      blocks.push(`<div class="sector-group">${sectorFichas.join('')}</div>`);
    }
  }

  if (generated === 0) {
    alert('Nenhuma ficha gerada — os itens deste pedido não têm Costura, Aviamento ou Montagem na ficha técnica (ou estão sem grade).');
    return;
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Fichas de operador · ${esc(pv)}</title>
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
  .sector-group{break-before:auto}
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
