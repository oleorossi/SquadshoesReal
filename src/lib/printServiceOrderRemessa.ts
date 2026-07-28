import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { applyPrintSandbox } from '@/lib/htmlUtils';

/**
 * Guia de Remessa da OS (Modelo 3 — "capa de marca").
 *
 * Documento que segue JUNTO com os pares e materiais físicos da fábrica até o
 * prestador de serviço. Ele confere o que recebeu e assina o recebimento.
 * Layout: faixa vermelha da marca com o nº da OS em destaque, contagem de pares
 * gigante, cartões dos itens do pedido, tira de materiais enviados e faixa de
 * recebimento assinável.
 *
 * Mesmo mecanismo dos outros prints (iframe escondido + srcdoc + print()) —
 * complementa `printServiceOrderReceipt.ts` (recibo formal) com um layout
 * operacional/visual pra hand-off no balcão.
 */

export interface RemessaContractor {
  name?: string | null;
  trade_name?: string | null;
  cnpj_cpf?: string | null;
  phone?: string | null;
  payment_days?: number | null;
}

export interface RemessaMaterial {
  material: string;
  color: string;
  meters: number;
}

/** Item do pedido coberto pela OS (ref · cor + pares). Opcional: quando a OS
 *  tem PV vinculado com itens selecionados, cada um vira um cartão. */
export interface RemessaItem {
  label: string;
  pairs: number;
}

export interface RemessaOrder {
  order_number?: string | null;
  target_sector?: string | null;
  description?: string | null;
  service_date?: string | null;
  service_time?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_value?: number | null;
  notes?: string | null;
  materials_sent?: RemessaMaterial[] | null;
  sale_order_number?: string | null;
  client_order_number?: string | null;
  client_name?: string | null;
}

export interface RemessaCompany {
  name: string;
  cnpj?: string;
}

const DEFAULT_COMPANY: RemessaCompany = { name: 'Squad Shoes' };

const SECTOR_LABEL: Record<string, string> = {
  costura: 'Costura',
  mesa: 'Aviamento',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  corte_cabedal: 'Corte Cabedal',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
};

const fmtMoney = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtMeters = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return '—';
    return format(d, 'dd/MM/yyyy', { locale: ptBR });
  } catch {
    return '—';
  }
};
const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printServiceOrderRemessa(
  order: RemessaOrder,
  contractor: RemessaContractor | undefined,
  opts?: { items?: RemessaItem[]; company?: RemessaCompany },
): void {
  const company = opts?.company ?? DEFAULT_COMPANY;
  const nowStr = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

  const osNo = order.order_number || 'OS';
  const sector = order.target_sector ? SECTOR_LABEL[order.target_sector] || order.target_sector : null;
  const contractorName = contractor?.trade_name?.trim() || contractor?.name?.trim() || '—';
  const paymentDays = Number(contractor?.payment_days ?? 0);

  const qty = Number(order.quantity || 0);
  const unitPrice = Number(order.unit_price || 0);
  const totalValue = Number(order.total_value || qty * unitPrice);

  // Itens do PV (cartões). Fallback: 1 cartão a partir da descrição quando não há
  // itens vinculados, pra a guia nunca sair vazia de conteúdo.
  const items = (opts?.items || []).filter((i) => Number(i.pairs) > 0);
  const itemCards = items.length > 0
    ? items.map((i) => `
        <div class="icard">
          <span class="d">${esc(i.label)}</span>
          <span class="q mono">${fmtInt(i.pairs)}</span>
        </div>`).join('')
    : (order.description
        ? `<div class="icard"><span class="d">${esc(order.description)}</span><span class="q mono">${fmtInt(qty)}</span></div>`
        : '');

  const materials = (order.materials_sent || []).filter((m) => m.material?.trim());
  const totalMeters = materials.reduce((s, m) => s + Number(m.meters || 0), 0);
  const matStrip = materials.length > 0
    ? `
      <div class="eyebrow" style="margin-top:14px">Materiais enviados</div>
      <div class="matstrip">
        ${materials.map((m) => `
          <span class="m"><b>${esc(m.material)}</b>${m.color ? ` · ${esc(m.color)}` : ''} <span class="mt mono">${fmtMeters(m.meters)} m</span></span>`).join('')}
      </div>` : '';

  const pvLine = [order.sale_order_number, order.client_order_number].filter(Boolean).join(' · ');

  const valueNote = unitPrice > 0
    ? `Valor da OS <b>${fmtMoney(totalValue)}</b> (${fmtInt(qty)} × ${fmtMoney(unitPrice)}).`
    : `Valor da OS <b>${fmtMoney(totalValue)}</b>.`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Remessa ${esc(osNo)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #161310; font-size: 11pt; line-height: 1.5; }
  .display { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; letter-spacing: .01em; }
  .mono { font-family: 'Fira Code', ui-monospace, 'SF Mono', monospace; font-variant-numeric: tabular-nums; }
  .eyebrow { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; font-size: 9pt; color: #7c756b; }

  .band { background: #E11D2E; color: #fff; padding: 22px 26px 20px; }
  .band .eyebrow { color: rgba(255,255,255,.85); }
  .band .os { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; font-size: 46pt; line-height: .84; margin: 6px 0 8px; }
  .band .kick { display: flex; align-items: center; gap: 10px; font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: 16pt; }
  .band .kick .arrow { opacity: .72; }

  .body { padding: 20px 26px 22px; }
  .meta2 { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 22px; padding-bottom: 14px; border-bottom: 1.5px solid #ded9d2; }
  .meta2 .k { font-size: 8.5pt; color: #7c756b; text-transform: uppercase; letter-spacing: .08em; }
  .meta2 b { font-weight: 600; font-size: 11pt; }

  .pares { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 8px; }
  .pares .n { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; color: #E11D2E; font-size: 52pt; line-height: .8; }
  .pares .lbl { text-align: right; }
  .pares .lbl .t { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 15pt; }
  .pares .lbl .s { font-size: 9.5pt; color: #7c756b; }

  .cards { display: flex; flex-direction: column; gap: 7px; margin: 10px 0; }
  .icard { display: flex; align-items: center; gap: 12px; border: 1.5px solid #ded9d2; border-left: 4px solid #161310; border-radius: 3px; padding: 9px 13px; page-break-inside: avoid; }
  .icard .d { flex: 1; font-weight: 600; }
  .icard .q { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; font-weight: 700; font-size: 17pt; }

  .matstrip { display: flex; flex-wrap: wrap; gap: 7px; margin: 8px 0 4px; }
  .matstrip .m { font-size: 9.5pt; background: #f3f0eb; border-radius: 3px; padding: 5px 10px; }
  .matstrip .m b { font-weight: 600; }
  .matstrip .m .mt { color: #B4121F; font-weight: 700; }

  .notes { margin-top: 12px; padding: 8px 12px; background: #fffbeb; border-left: 3px solid #d97706; font-size: 9.5pt; color: #78350f; white-space: pre-wrap; }

  .ackband { margin-top: 18px; background: #fdf0f1; border: 1.5px solid #f3c2c6; border-radius: 3px; padding: 15px 18px; display: flex; gap: 22px; align-items: flex-end; page-break-inside: avoid; }
  .ackband .txt { flex: 1; font-size: 10pt; color: #463f37; line-height: 1.5; }
  .ackband .txt b { color: #161310; }
  .ackband .sg { width: 220px; text-align: center; }
  .ackband .sg .ln { border-top: 1.5px solid #161310; padding-top: 5px; margin-top: 34px; }
  .ackband .sg .l { font-size: 8.5pt; color: #7c756b; text-transform: uppercase; letter-spacing: .05em; }

  footer.foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ded9d2; font-size: 8pt; color: #a8a29a; text-align: center; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="band">
    <div class="eyebrow">Guia de remessa · Ordem de serviço</div>
    <div class="os">${esc(osNo)}</div>
    ${sector ? `<div class="kick"><span class="arrow">&rarr;</span> ${esc(sector)}</div>` : ''}
  </div>

  <div class="body">
    <div class="meta2">
      <div><span class="k">Prestador</span><br><b>${esc(contractorName)}${paymentDays > 0 ? ` · pgto ${paymentDays}d` : ''}</b></div>
      <div><span class="k">Emissão</span><br><b>${esc(nowStr)}</b></div>
      ${pvLine ? `<div><span class="k">Pedido (PV)</span><br><b class="mono">${esc(pvLine)}</b></div>` : ''}
      ${order.client_name ? `<div><span class="k">Cliente</span><br><b>${esc(order.client_name)}</b></div>` : ''}
    </div>

    <div class="pares">
      <span class="n">${fmtInt(qty)}</span>
      <span class="lbl"><div class="t">Pares</div><div class="s">enviados nesta remessa</div></span>
    </div>

    ${itemCards ? `<div class="cards">${itemCards}</div>` : ''}

    ${matStrip}

    ${order.notes ? `<div class="notes"><strong>Obs.:</strong> ${esc(order.notes)}</div>` : ''}

    <div class="ackband">
      <div class="txt">Recebi os <b>${fmtInt(qty)} pares</b>${materials.length > 0 ? ` e os materiais acima (<b>${fmtMeters(totalMeters)} m</b>)` : ''}, conferidos conforme esta guia de remessa. ${valueNote}</div>
      <div class="sg"><div class="ln"></div><div class="l">Assinatura do prestador · data</div></div>
    </div>

    <footer class="foot">${esc(company.name)} · Guia de remessa emitida em ${esc(nowStr)}</footer>
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  applyPrintSandbox(iframe); // T6: HTML de impressão sem <script> (ver htmlUtils)
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
