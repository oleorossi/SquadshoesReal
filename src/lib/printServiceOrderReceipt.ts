import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { applyPrintSandbox, safeUrlAttr } from '@/lib/htmlUtils';

/**
 * Papel ÚNICO da Ordem de Serviço — "Modelo A" (decisão do dono, 01/08/2026).
 *
 * Uma folha só acompanha os pares até o prestador e volta partida na tesoura:
 *
 *   identidade (OS + setor)  →  itens com foto e grade por numeração
 *   →  material que sai junto  →  linha ✂  →  CANHOTO de devolução
 *
 * Substitui os DOIS documentos divergentes que existiam: o recibo A4 (chamado
 * só de ContractorReports) e a `printServiceOrderRemessa` (chamada da tela de
 * OS, inclusive pelo menu que dizia "Recibo"). Manter dois papéis era a origem
 * da divergência — não recriar o segundo.
 *
 * ⚠ SEM VALOR (decisão do dono, 31/07/2026): nem preço unitário, nem total.
 * O papel que vai pra rua comprova entrega e QUANTIDADE — preço é assunto do
 * contas a pagar, não do prestador no balcão. Não reintroduzir coluna de R$.
 *
 * ⚠ Vermelho (#C00000) NUNCA é o único sinal: a fábrica imprime laser P&B e o
 * vermelho vira cinza. Todo destaque em vermelho vem pareado com corpo grande
 * em Anton (ver CLAUDE.md § "Preferências de impressão", item 5).
 *
 * ⚠ A grade de 7 numerações precisa de ~93mm. A tabela ocupa a largura cheia e
 * NUNCA é comprimida: com `table-layout: fixed` o corte é silencioso — o
 * operador lê "18" onde estava "180" (CLAUDE.md § item 4).
 *
 * Mecanismo: iframe escondido + srcdoc + print(), igual aos outros prints. A
 * diferença é que aqui esperamos as FOTOS carregarem antes de imprimir — o
 * `setTimeout` fixo dos outros helpers imprimiria com o quadro vazio.
 */

export interface ReceiptContractor {
  name?: string | null;
  trade_name?: string | null;
  cnpj_cpf?: string | null;
  phone?: string | null;
}

/**
 * Material que sai junto com o lote.
 *
 * Aceita as DUAS formas de propósito: `meters` é o que o formulário de OS grava
 * hoje em `service_orders.materials_sent`; `quantity` + `unit` é a forma que o
 * motor de consumo produz, onde nem tudo é metro (dm², placa, kg). Quando as
 * duas vêm, `quantity` vence.
 */
export interface ReceiptMaterialSent {
  material: string;
  color?: string | null;
  /** Quantidade na unidade de estoque do produto (já convertida). */
  quantity?: number | null;
  unit?: string | null;
  /** Forma legada — equivale a `quantity` com `unit: 'm'`. */
  meters?: number | null;
}

/** Resolve a quantidade + unidade das duas formas aceitas. */
function materialQty(m: ReceiptMaterialSent): { value: number; unit: string } {
  if (m.quantity != null) return { value: Number(m.quantity) || 0, unit: (m.unit || '').trim() };
  return { value: Number(m.meters) || 0, unit: m.unit?.trim() || 'm' };
}

export interface ReceiptItem {
  ref_code?: string | null;
  ref_name?: string | null;
  color?: string | null;
  pairs: number;
  /**
   * Pares POR NUMERAÇÃO já expandidos (`{ "34": 144, "35": 288 }`) — NÃO é a
   * grade base de `sale_order_items.grade`, que vale 1 ficha (~12 pares). Use
   * `expandBaseGrade()` pra converter.
   */
  size_breakdown?: Record<string, number> | null;
  /** URL da foto da referência. Passe já em miniatura (ver `imageThumb.ts`). */
  photo_url?: string | null;
}

export interface ReceiptServiceOrder {
  id?: string;
  order_number?: string | null;
  description?: string | null;
  service_date?: string | null;
  quoted_deadline?: string | null;
  quantity?: number | null;
  notes?: string | null;
  target_sector?: string | null;
  /** Nº do pedido no SISTEMA (PV-00151). Usado como fallback do do cliente. */
  sale_order_number?: string | null;
  /**
   * Nº do pedido do CLIENTE, quando cadastrado. É ele que vai no cabeçalho —
   * o do sistema entra só quando este não existe (mesma precedência já usada
   * na etiqueta e na lista de pedidos).
   */
  client_order_number?: string | null;
  /**
   * Nºs das ordens de produção que a OS cobre (`OP-00231`). Derivados dos itens
   * do PV gravados na OS — ver `serviceOrderOps.ts`. Vazio quando as OPs ainda
   * não foram geradas: nesse caso a linha simplesmente não sai no papel.
   */
  op_numbers?: string[] | null;
  client_name?: string | null;
  materials_sent?: ReceiptMaterialSent[] | null;
}

export interface ReceiptCompany {
  name: string;
  cnpj?: string;
}

export interface PrintReceiptOptions {
  items?: ReceiptItem[];
  company?: ReceiptCompany;
  /**
   * Reimpressão só do canhoto (lote voltando em parcelas). Omite a metade de
   * cima e imprime o canhoto já com a linha "Já devolvido" preenchida.
   */
  stubOnly?: boolean;
  /** Pares já devolvidos por numeração — só usado quando `stubOnly`. */
  alreadyReturned?: Record<string, number> | null;
}

const DEFAULT_COMPANY: ReceiptCompany = { name: 'Squad Shoes' };

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

const fmtInt = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtQty = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

/** Ordena numerações como NÚMERO ("9" antes de "10"), com fallback alfabético. */
const sortSizes = (sizes: string[]) =>
  [...sizes].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b), 'pt-BR');
  });

/**
 * Expande a grade BASE do item do PV (1 ficha, ~12 pares) para pares por
 * numeração, proporcional ao total de pares do item.
 *
 * `sale_order_items.grade` guarda a grade base — 36 pares de uma base
 * `{34:1,35:2,36:2,37:3,38:2,39:1,40:1}` (soma 12) são 3 grades, logo
 * `{34:3,35:6,36:6,37:9,38:6,39:3,40:3}`. Ver memória
 * "sale_order_items.grade é grade BASE".
 *
 * O resto da divisão é distribuído nas numerações de maior peso, então a soma
 * do resultado é SEMPRE igual a `pairs` — o canhoto não pode fechar diferente
 * do total impresso no cabeçalho.
 */
export function expandBaseGrade(
  base: Record<string, number> | null | undefined,
  pairs: number,
): Record<string, number> {
  const entries = Object.entries(base || {})
    .map(([size, v]) => [size, Number(v) || 0] as [string, number])
    .filter(([, v]) => v > 0);
  const baseSum = entries.reduce((s, [, v]) => s + v, 0);
  const total = Math.max(0, Math.round(Number(pairs) || 0));
  if (entries.length === 0 || baseSum <= 0 || total === 0) return {};

  const out: Record<string, number> = {};
  let assigned = 0;
  for (const [size, v] of entries) {
    const n = Math.floor((v / baseSum) * total);
    out[size] = n;
    assigned += n;
  }
  // Sobra por arredondamento vai pras numerações de maior peso na base.
  const rest = total - assigned;
  if (rest > 0) {
    const byWeight = [...entries].sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < rest; i++) {
      const size = byWeight[i % byWeight.length][0];
      out[size] = (out[size] || 0) + 1;
    }
  }
  return out;
}

/** Soma os breakdowns de vários itens numa única linha por numeração. */
function mergeBreakdowns(items: ReceiptItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    for (const [size, qty] of Object.entries(it.size_breakdown || {})) {
      out[size] = (out[size] || 0) + (Number(qty) || 0);
    }
  }
  return out;
}

/** Tabela de grade de um item: cabeçalho de numerações + linha de pares. */
function gradeTableHtml(breakdown: Record<string, number>): string {
  const sizes = sortSizes(Object.keys(breakdown).filter((s) => Number(breakdown[s]) > 0));
  if (sizes.length === 0) return '';
  const total = sizes.reduce((s, k) => s + Number(breakdown[k] || 0), 0);
  return `
    <table class="grade">
      <thead>
        <tr>
          ${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}
          <th class="tot">TOT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          ${sizes.map((s) => `<td>${fmtInt(breakdown[s])}</td>`).join('')}
          <td class="tot">${fmtInt(total)}</td>
        </tr>
      </tbody>
    </table>`;
}

/**
 * Matriz do canhoto: Enviado (impresso) + linhas em branco pro prestador
 * preencher na bancada. Quando é reimpressão, entra "Já devolvido".
 */
function stubTableHtml(
  breakdown: Record<string, number>,
  alreadyReturned?: Record<string, number> | null,
): string {
  const sizes = sortSizes(Object.keys(breakdown).filter((s) => Number(breakdown[s]) > 0));
  if (sizes.length === 0) return '';
  const total = sizes.reduce((s, k) => s + Number(breakdown[k] || 0), 0);
  const hasReturned = !!alreadyReturned && Object.keys(alreadyReturned).length > 0;
  const returnedTotal = hasReturned
    ? sizes.reduce((s, k) => s + (Number(alreadyReturned?.[k]) || 0), 0)
    : 0;

  const blankRow = (label: string) => `
    <tr>
      <td class="rowlbl">${esc(label)}</td>
      ${sizes.map(() => '<td class="blank"></td>').join('')}
      <td class="blank tot"></td>
    </tr>`;

  return `
    <table class="grade stub">
      <thead>
        <tr>
          <th class="rowlbl">Nº</th>
          ${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}
          <th class="tot">TOT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="rowlbl">Enviado</td>
          ${sizes.map((s) => `<td>${fmtInt(breakdown[s])}</td>`).join('')}
          <td class="tot">${fmtInt(total)}</td>
        </tr>
        ${hasReturned ? `
        <tr>
          <td class="rowlbl">Já devolvido</td>
          ${sizes.map((s) => `<td>${fmtInt(alreadyReturned?.[s] || 0)}</td>`).join('')}
          <td class="tot">${fmtInt(returnedTotal)}</td>
        </tr>` : ''}
        ${blankRow('Bom')}
        ${blankRow('Defeito')}
        ${blankRow('Perda')}
      </tbody>
    </table>`;
}

function itemBlockHtml(item: ReceiptItem): string {
  const label = [item.ref_code, item.color].filter(Boolean).join(' · ') || item.ref_name || '—';
  const photo = safeUrlAttr(item.photo_url);
  const grade = gradeTableHtml(item.size_breakdown || {});
  return `
    <div class="item">
      <div class="photo">
        ${photo
          ? `<img src="${photo}" alt="" />`
          : '<span class="nophoto">sem foto</span>'}
      </div>
      <div class="itembody">
        <div class="itemtop">
          <span class="ref">${esc(label)}</span>
          <span class="pairs">${fmtInt(item.pairs)}<small>pares</small></span>
        </div>
        ${grade || '<div class="nograde">Grade por numeração não informada neste item.</div>'}
      </div>
    </div>`;
}

export function printServiceOrderReceipt(
  order: ReceiptServiceOrder,
  contractor?: ReceiptContractor,
  opts?: PrintReceiptOptions,
): void {
  const company = opts?.company ?? DEFAULT_COMPANY;
  const nowStr = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

  const osNo = order.order_number || 'OS';
  const sector = order.target_sector
    ? SECTOR_LABEL[order.target_sector] || order.target_sector
    : null;
  const contractorName = contractor?.trade_name?.trim() || contractor?.name?.trim() || '—';

  const items = (opts?.items || []).filter((i) => Number(i.pairs) > 0);
  // Total do papel: soma dos itens quando houver, senão o que está gravado na OS.
  const totalPairs = items.length > 0
    ? items.reduce((s, i) => s + (Number(i.pairs) || 0), 0)
    : Number(order.quantity || 0);

  const merged = mergeBreakdowns(items);
  const stubOnly = !!opts?.stubOnly;
  const stubTable = stubTableHtml(merged, stubOnly ? opts?.alreadyReturned : null);

  const materials = (order.materials_sent || []).filter((m) => m.material?.trim());

  const docTitle = stubOnly ? `Canhoto ${osNo}` : `OS ${osNo}`;

  // Pedido do CLIENTE manda; o do sistema é o fallback. Mesma precedência já
  // usada na etiqueta e na lista de PVs — o prestador e o cliente conversam pelo
  // número do cliente quando ele existe.
  const pedidoNo = order.client_order_number?.trim() || order.sale_order_number?.trim() || null;
  // OPs no cabeçalho, em destaque, TODAS listadas (a regra do projeto manda
  // remover conteúdo antes de reduzir fonte — nenhum número é escondido atrás
  // de um "+2"). Corpo abaixo do nº da OS, que segue sendo a identidade do papel.
  const opNumbers = (order.op_numbers || []).filter(Boolean);

  const headerHtml = `
    <header class="head">
      <div class="ident">
        <span class="eyebrow">${stubOnly ? 'Canhoto de devolução · reimpressão' : 'Ordem de serviço'} · ${esc(company.name)}</span>
        <div class="os">${esc(osNo)}</div>
        ${sector ? `<div class="sector">${esc(sector)}</div>` : ''}
        ${opNumbers.length > 0 || pedidoNo ? `
          <div class="idrefs">
            ${opNumbers.length > 0 ? `<span class="idref"><span class="k">${opNumbers.length === 1 ? 'OP' : 'OPs'}</span>${esc(opNumbers.join(' · '))}</span>` : ''}
            ${pedidoNo ? `<span class="idref"><span class="k">Pedido</span>${esc(pedidoNo)}</span>` : ''}
          </div>` : ''}
      </div>
      <div class="totalbox">
        <span class="n">${fmtInt(totalPairs)}</span>
        <span class="l">pares</span>
      </div>
    </header>

    <div class="meta">
      <div><span class="k">Prestador</span><span class="v">${esc(contractorName)}</span></div>
      <div><span class="k">Envio</span><span class="v mono">${fmtDate(order.service_date)}</span></div>
      <div><span class="k">Prazo</span><span class="v mono">${fmtDate(order.quoted_deadline)}</span></div>
    </div>
    ${order.client_name ? `<div class="client">Cliente: <b>${esc(order.client_name)}</b></div>` : ''}`;

  const bodyHtml = stubOnly ? '' : `
    ${items.length > 0 ? `
      <div class="sectitle"><span>Pares enviados</span><span class="hint">${items.length} ${items.length === 1 ? 'item' : 'itens'}</span></div>
      <div class="items">${items.map(itemBlockHtml).join('')}</div>
    ` : (order.description ? `
      <div class="sectitle"><span>Serviço contratado</span></div>
      <div class="desc">${esc(order.description)}</div>
    ` : '')}

    ${materials.length > 0 ? `
      <div class="sectitle"><span>Material que sai junto</span><span class="hint">conferir na saída</span></div>
      <div class="mats">
        ${materials.map((m) => {
          const { value, unit } = materialQty(m);
          return `
          <div class="row">
            <span class="box"></span>
            <span class="nm">${esc(m.material)}${m.color ? ` · ${esc(m.color)}` : ''}</span>
            <span class="qt mono">${fmtQty(value)}${unit ? ` ${esc(unit)}` : ''}</span>
          </div>`;
        }).join('')}
      </div>` : ''}

    ${order.notes ? `<div class="notes"><b>Obs.:</b> ${esc(order.notes)}</div>` : ''}

    <div class="cut"><span>&#9986; Cortar aqui · canhoto volta com o lote</span></div>`;

  const stubHtml = `
    <section class="stub-sec">
      <div class="sectitle">
        <span>Canhoto de devolução · ${esc(osNo)}</span>
        <span class="hint">${esc(contractorName)}${sector ? ` · ${esc(sector)}` : ''}</span>
      </div>
      ${stubTable || `<div class="nograde">Grade por numeração não informada — conferir por total: <b>${fmtInt(totalPairs)} pares</b>.</div>`}
      <div class="sign">
        <div class="line">Recebi conforme · assinatura do prestador</div>
        <div class="line">Data</div>
      </div>
    </section>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${esc(docTitle)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #000; font-size: 10pt; line-height: 1.4;
  }
  .mono { font-family: 'Fira Code', ui-monospace, 'SF Mono', monospace; font-variant-numeric: tabular-nums; }
  .os, .sector, .ref, .pairs, .totalbox .n, .sectitle, .idref,
  table.grade thead th, table.grade tbody td {
    font-family: 'Anton', 'Arial Narrow', Impact, sans-serif;
  }
  .eyebrow {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 7.5pt; letter-spacing: .16em; text-transform: uppercase; color: #333;
  }

  /* ── Identidade: lida a 1m. Vermelho SEMPRE pareado com corpo grande. ── */
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px;
          border-bottom: 2px solid #000; padding-bottom: 8px; }
  .os { font-size: 30pt; line-height: .9; letter-spacing: .01em; }
  .sector { font-size: 20pt; line-height: 1; color: #C00000; text-transform: uppercase; }
  .totalbox { text-align: right; border: 2px solid #000; padding: 6px 12px; min-width: 34mm; }
  .totalbox .n { display: block; font-size: 26pt; line-height: .92; }
  .totalbox .l { display: block; font-family: 'Fira Code', ui-monospace, monospace;
                 font-size: 7.5pt; letter-spacing: .16em; text-transform: uppercase; }

  /* OP e Pedido: identidade secundária do papel. Abaixo do nº da OS (30pt) e do
     setor (20pt), acima de tudo o mais — é o que a bancada usa pra amarrar o
     serviço à produção. 14pt (~18.7px) fica acima do piso de identidade (14px)
     do PRINT_SPEC. Quebra linha com 2+ OPs em vez de encolher. */
  .idrefs { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
  .idref { font-size: 14pt; line-height: 1.15; letter-spacing: .01em; }
  .idref .k { font-family: 'Fira Code', ui-monospace, monospace;
              font-size: 7pt; letter-spacing: .12em; text-transform: uppercase;
              color: #333; margin-right: 5px; }

  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
          border: 1.5px solid #000; padding: 6px 9px; margin-top: 7px; }
  .meta .k { display: block; font-family: 'Fira Code', ui-monospace, monospace;
             font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: #333; }
  .meta .v { display: block; font-size: 10.5pt; font-weight: 700; line-height: 1.2; }
  .client { font-size: 9.5pt; margin-top: 5px; }

  .sectitle { display: flex; justify-content: space-between; align-items: baseline;
              font-size: 12pt; text-transform: uppercase; letter-spacing: .04em;
              border-bottom: 1.5px solid #000; padding-bottom: 2px; margin: 12px 0 6px; }
  .sectitle .hint { font-family: 'Fira Code', ui-monospace, monospace;
                    font-size: 7.5pt; letter-spacing: .1em; text-transform: none; color: #444; }

  /* ── Itens: foto + grade por numeração ── */
  .items { display: flex; flex-direction: column; }
  .item { display: flex; gap: 8px; align-items: flex-start;
          padding: 6px 0; border-bottom: 1px solid #000; page-break-inside: avoid; }
  .item:last-child { border-bottom: none; }
  .photo { width: 20mm; height: 20mm; flex: none; border: 1.5px solid #000;
           display: flex; align-items: center; justify-content: center;
           overflow: hidden; background: #f2f2f2; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo .nophoto { font-family: 'Fira Code', ui-monospace, monospace; font-size: 6.5pt;
                    color: #777; letter-spacing: .08em; text-transform: uppercase; }
  .itembody { flex: 1; min-width: 0; }
  .itemtop { display: flex; justify-content: space-between; align-items: baseline;
             gap: 8px; margin-bottom: 4px; }
  .ref { font-size: 15pt; line-height: 1; text-transform: uppercase; }
  .pairs { font-size: 15pt; line-height: 1; white-space: nowrap; }
  .pairs small { font-family: 'Fira Code', ui-monospace, monospace; font-size: 6.5pt;
                 letter-spacing: .12em; display: block; text-align: right; }

  /* Grade: largura CHEIA, nunca comprimida (corte silencioso de dígito). */
  table.grade { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grade th, table.grade td { border: 1px solid #000; text-align: center;
                                   padding: 1.5px 1px; font-variant-numeric: tabular-nums; }
  table.grade thead th { font-size: 9pt; background: #000; color: #fff; }
  table.grade tbody td { font-size: 11pt; }
  table.grade th.tot { background: #C00000; }
  table.grade td.tot { background: #e8e8e8; }
  table.grade .rowlbl { font-family: 'Fira Code', ui-monospace, monospace; font-size: 7pt;
                        letter-spacing: .06em; text-transform: uppercase; text-align: left;
                        padding-left: 3px; background: #e8e8e8; width: 20mm; }
  table.grade thead th.rowlbl { background: #000; color: #fff; }
  /* Campo manuscrito: ~6mm de altura (piso de 20px / ~5,3mm). */
  table.grade td.blank { height: 6mm; background: #fff; }
  .nograde { font-size: 9pt; color: #444; padding: 3px 0; }
  .desc { font-size: 11pt; padding: 4px 0; }

  .mats { border: 1.5px solid #000; }
  .mats .row { display: flex; align-items: center; gap: 7px; padding: 3px 8px;
               border-bottom: 1px solid #000; font-size: 10pt; }
  .mats .row:last-child { border-bottom: none; }
  .mats .box { width: 3.5mm; height: 3.5mm; border: 1.5px solid #000; flex: none; }
  .mats .nm { flex: 1; font-weight: 600; }
  .mats .qt { font-weight: 700; }

  .notes { margin-top: 8px; padding: 5px 9px; border-left: 3px solid #000;
           background: #f2f2f2; font-size: 9.5pt; white-space: pre-wrap; }

  /* ── Linha de corte: obrigatória, é o que separa o canhoto ── */
  .cut { margin: 12px 0 10px; border-top: 2px dashed #000; text-align: center; }
  .cut span { position: relative; top: -6pt; background: #fff; padding: 0 8px;
              font-family: 'Fira Code', ui-monospace, monospace; font-size: 7.5pt;
              letter-spacing: .16em; text-transform: uppercase; }

  .stub-sec { page-break-inside: avoid; }
  .sign { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16mm; margin-top: 10mm; }
  .sign .line { border-top: 1.5px solid #000; padding-top: 3px;
                font-family: 'Fira Code', ui-monospace, monospace; font-size: 7.5pt;
                letter-spacing: .1em; text-transform: uppercase; }

  footer.foot { margin-top: 8px; padding-top: 4px; border-top: 1px solid #000;
                font-family: 'Fira Code', ui-monospace, monospace; font-size: 6.5pt;
                letter-spacing: .06em; color: #444;
                display: flex; justify-content: space-between; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  ${headerHtml}
  ${bodyHtml}
  ${stubHtml}
  <footer class="foot">
    <span>${esc(company.name)} · ${esc(osNo)}</span>
    <span>Emitido em ${esc(nowStr)}</span>
  </footer>
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
    // As fotos das referências carregam DEPOIS do onload do documento. Os
    // outros helpers de print esperam 300ms fixos — aqui isso imprimiria com o
    // quadro vazio. `allow-same-origin` deixa o pai ler o contentDocument.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 3000);
    };

    const doc = iframe.contentDocument;
    const pending = doc ? Array.from(doc.images).filter((img) => !img.complete) : [];
    if (pending.length === 0) {
      setTimeout(finish, 250);
      return;
    }
    let left = pending.length;
    const tick = () => { left -= 1; if (left <= 0) setTimeout(finish, 120); };
    pending.forEach((img) => {
      img.addEventListener('load', tick, { once: true });
      // Foto quebrada não pode travar a impressão do papel.
      img.addEventListener('error', tick, { once: true });
    });
    // Rede lenta / URL morta: imprime mesmo assim depois de 4s.
    setTimeout(finish, 4000);
  };
}
