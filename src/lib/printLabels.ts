import { escapeHtml } from './htmlUtils';

/** Sanitiza valor de barcode pra interpolação segura em <script> (evita XSS/quebra de tag). Barcodes/nº de pedido são alfanuméricos. */
function sanitizeBarcode(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9._\-\/]/g, '');
}

/** Literal de string JS seguro pra interpolar dentro de <script>, PRESERVANDO
 *  todos os caracteres (ex.: URL de QR com `:` `?` `=` `&` `#`). Usa
 *  JSON.stringify (escapa aspas/barras/quebras) e neutraliza `</` pra não
 *  fechar a tag <script>. Diferente de sanitizeBarcode, que é pra CODE128
 *  (alfanumérico) e NÃO serve pra URL. */
function jsStringLiteral(value: unknown): string {
  return JSON.stringify(String(value ?? '')).replace(/<\//g, '<\\/');
}

/**
 * Generates printable box labels (rótulos caixa externa), individual labels (etiquetas caixa individual)
 * and brand hangtags (etiquetas de marca/penduricalhos).
 * Based on industrial standard (Beira Rio / Molekinha pattern)
 *
 * These functions return HTML strings — rendering is handled by the caller.
 */

/**
 * Hardening CSS aplicado em TODOS os builders de etiqueta — garante:
 *  - cor fiel (sem desbotamento) em qualquer impressora
 *  - imagem com contraste otimizado (P&B fiel)
 *  - SEM clipping em containers ancestrais que possam ter overflow:hidden
 *  - SEM animações/transforms residuais que distorcem snapshot do print
 *  - cores forçadas a #000 em rule-lines/borders (não dependem de tokens)
 *
 * Inserido logo após `*{box-sizing:border-box;margin:0;padding:0;}` em cada
 * builder. Mesma proteção que PrintWorkSheetsPage aplica em fichas A4.
 */
const LABEL_PRINT_HARDENING = `
@media print{
  *{
    -webkit-print-color-adjust:exact !important;
    color-adjust:exact !important;
    print-color-adjust:exact !important;
  }
  html,body{overflow:visible !important;background:#fff !important;}
  body *{overflow:visible !important;max-height:none !important;}
  img{image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;}
  *{animation:none !important;transition:none !important;}
}`;

export interface BoxIdentificationData {
  nfe?: string;
  remessa?: string;
  orderNumber: string;
  refCode: string;
  refName: string;
  color: string;
  boxNumber: number;
  totalBoxes: number;
  boxOfNf?: string;
  senderName: string;
  senderCnpj: string;
  senderAddress?: string;
  recipientName?: string;
  /** Razão social completa (preferida sobre recipientName quando ambos presentes). */
  recipientRazaoSocial?: string;
  recipientCnpj?: string;
  recipientNumber?: string;
  recipientAddress?: string;
  recipientNeighborhood?: string;
  recipientCity?: string;
  recipientUf?: string;
  recipientCep?: string;
  /** Código da filial fornecido pelo cliente (ex: "L12", "SP-03"). */
  recipientBranchCode?: string;
  /** Nome amigável da filial. */
  recipientBranchName?: string;
  transporter?: string;
  clientOrderNumber?: string;
  /** Nosso PV (sale_orders.order_number, ex.: "PV-00146"). Só aparece no header
   *  como FALLBACK quando o pedido do cliente vem vazio — o cliente reconhece o
   *  pedido dele; sem ele, o nosso número é a próxima referência mais útil (e o
   *  OP fica como último recurso, já que ele também vive no rodapé). */
  saleOrderNumber?: string;
  shoeCategory?: string;
  mainMaterial?: string;
  /** Marca impressa na linha MARCA da grade = silk do solado (cascata
   *  cliente→grupo→padrão), ou 'Squad Shoes' quando o solado não tem silk.
   *  Resolvido pelo caller via RPC resolve_item_brand. (User 2026-06-07.) */
  marca?: string;
  grade: { size: string; qty: number }[];
  barcode?: string;
  imageUrl?: string;
  /** True quando imageUrl é fallback (master da ficha técnica, variante "preta"
   *  ou placeholder) — a foto NÃO corresponde à cor real pedida. Etiqueta
   *  aplica filter:grayscale pra deixar claro pro recebedor que essa imagem
   *  é só ilustrativa, não retrata a cor real do produto. */
  imageIsFallback?: boolean;
  strapsLabel?: string;
  /** Distintivo da grade (ex.: "5-10", "F-PP"). Aparece grande no canto. */
  sizeRangeLabel?: string;
  /** Ex.: total de pares na remessa. Quando undefined, omite linha. */
  totalPairsInRemessa?: number;
  /** Quantidade de talões/fichas dentro do corrugado/remessa. */
  taloes?: number;
  /** Identificador do lote do PV (opcional). */
  lote?: string;
  /** Número da fábrica/setor (opcional). */
  fab?: string;
  /** Página global e total (ex.: 41 de 72). Omite quando ambos faltam. */
  pageNumber?: number;
  pageTotal?: number;
  /** Número da ficha/talão dentro do PV. Aparece no header como metadata
   *  secundária ("PROG.: <orderNumber> / FICHA <ficha>"). Opcional. */
  ficha?: string;
}

interface LabelData {
  refName: string;
  refCode: string;
  color: string;
  category: string;
  sizes: { size: string; qty: number }[];
  totalQty: number;
  costPrice: number;
  salePrice: number;
  imageUrl: string;
  /** MATERIAL resolvido (cascata do labelUtils) — vira mainMaterial no rótulo. */
  material?: string;
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Escape closing script tag inside template literals for document.write safety */
function safeScript(src?: string): string {
  if (src) {
    return `<script src="${src}"><` + `/script>`;
  }
  return '';
}

function safeScriptBlock(code: string): string {
  return `<script>${code}<` + `/script>`;
}

/** SVG inline do logo SilkMark — só pra marcas legacy catalogadas (HOST/NOVA/
 *  PRIME). A MARCA real vem do caller via `item.marca` (RPC resolve_item_brand
 *  = silk do solado, cascata cliente→grupo→padrão; fallback 'Squad Shoes').
 *  Marca sem logo catalogado → retorna '' e o selo sai só com o texto.
 *  ⚠ O antigo mapa LABEL_SOLADO_TO_SILK (solado→silk hardcoded) foi removido
 *  em 10/06/2026: tinha códigos de solado inexistentes e nenhum caller passava
 *  o solado — o selo saía SEMPRE 'HOST' inventado. (Audit F3.)
 *  currentColor → herda fg do container. */
function silkLogoSvg(silk: string, size: number): string {
  if (silk === 'HOST') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M 4 12 L 9 4 L 14 12 L 9 20 Z" fill="currentColor"/>
      <circle cx="17" cy="12" r="3" fill="currentColor"/>
    </svg>`;
  }
  if (silk === 'NOVA') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M 12 2 L 14 10 L 22 12 L 14 14 L 12 22 L 10 14 L 2 12 L 10 10 Z" fill="currentColor"/>
    </svg>`;
  }
  if (silk === 'PRIME') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"/>
      <circle cx="12" cy="12" r="3.5" fill="currentColor"/>
    </svg>`;
  }
  return '';
}

/** Build HTML string for box identification labels (rótulo Caixa Externa).
 *
 * Formato 198×132mm — 2 etiquetas empilhadas verticalmente por folha A4 portrait
 * com 6mm de margem de corte entre elas. Visual ECONOMIA DE TINTA (2026-06-30,
 * "Opção 4 — editorial bold"): fundo BRANCO, molduras/divisórias pretas grossas
 * (3px) e tipografia forte, SEM nenhum preenchimento de área (saiu o amarelo
 * fluor #FFE94A + todas as faixas pretas).
 *   - HEADER: NF em destaque (Anton, preto sobre branco) + PEDIDO: <pedido do
 *     CLIENTE; se ausente, nosso OP> / FICHA <ficha> à direita.
 *   - BODY: 2 colunas — esquerda com dados do destinatário num GRID 2-col (rótulo
 *     largura fixa + valor alinhado), CLIENTE em destaque (Anton); direita com
 *     foto grande do produto em moldura preta 3px + nome da cor abaixo.
 *   - GRADE TABLE: rótulos MARCA/REFERENCIA/TAMANHO/QUANTIDADE à esquerda, valores
 *     em grid à direita. Linha MARCA renderiza SilkMark determinado pelo solado.
 *   - FOOTER: OP (nosso) + código de barras + VOLUME em Anton, tudo preto/branco.
 *
 * Regra: campo vazio → linha/célula NÃO renderiza (em vez de aparecer "—").
 *
 * Histórico: redimensionado de 150×100mm → 198×132mm em 19/05/2026 conforme
 * handoff `cxext_198x132_handoff/` (README + screen-etiquetas.jsx). Fontes
 * escaladas proporcionalmente (NF 26→34px, foto 220×170→310×240px, PEDIDO
 * 22→28px, TT total 13→18px, QUANTIDADE 12→16px).
 */
export function buildBoxIdentificationHtml(items: BoxIdentificationData[]): string {
  // Helper: célula só renderiza se valor for truthy. Evita "—" vazios.
  const fieldRow = (
    label: string,
    val: string | number | undefined | null,
    opts: { mono?: boolean; big?: boolean } = {},
  ): string => {
    if (val === undefined || val === null || val === '' || val === 0) return '';
    return `<div class="field${opts.mono ? ' mono' : ''}${opts.big ? ' big' : ''}">
      <span class="lbl">${escapeHtml(label)}:</span>
      <span class="val">${escapeHtml(String(val))}</span>
    </div>`;
  };

  // Fallback SVG quando imageUrl ausente/quebrada — silhueta de calçado escura
  // sobre fundo amarelo (mantém continuidade visual com o restante da etiqueta).
  const SHOE_FALLBACK_SVG = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 130" preserveAspectRatio="xMidYMid meet">' +
      '<ellipse cx="100" cy="118" rx="78" ry="6" fill="#000" opacity="0.18"/>' +
      '<path d="M 24 100 Q 26 86 40 84 L 150 84 Q 174 84 180 96 Q 184 104 184 110 Q 184 114 180 114 L 32 114 Q 24 114 24 108 Z" fill="#1A1A1A" stroke="#000" stroke-width="0.8"/>' +
      '<path d="M 40 84 Q 44 56 70 50 L 124 50 Q 156 52 168 70 Q 178 80 180 96 L 40 96 Z" fill="#2A2A2A" stroke="#000" stroke-width="0.8"/>' +
    '</svg>',
  );
  const FALLBACK_PHOTO_DATA_URL = `data:image/svg+xml;utf8,${SHOE_FALLBACK_SVG}`;

  // Render de uma etiqueta individual (198×132mm).
  const renderLabel = (item: BoxIdentificationData, idx: number): string => {
    // ─── HEADER NF / PROG ──────────────────────────────────
    // E-M3: sem NF, exibe o rótulo "NF:" com valor vazio (em vez de "—"),
    // mantendo o layout do header íntegro (a célula PROG. continua).
    const nfValue = item.nfe || '';
    // Topo = PEDIDO DO CLIENTE (o que o cliente reconhece); sem ele, cai no
    // nosso PV, e só então no OP. Pedido do dono 2026-06-30, refinado 2026-07-20:
    // antes pulava direto pro OP, que já aparece no rodapé — o header ficava
    // repetindo o mesmo número e o PV não saía em lugar nenhum do rótulo.
    const pedidoTopo = item.clientOrderNumber || item.saleOrderNumber || item.orderNumber || '';
    const progParts = [
      pedidoTopo ? escapeHtml(String(pedidoTopo)) : '',
      item.ficha ? `FICHA ${escapeHtml(item.ficha)}` : '',
    ].filter(Boolean);
    const progValue = progParts.join(' / ') || '—';

    // ─── DESTINATÁRIO (esquerda) ───────────────────────────
    const cliente = item.recipientRazaoSocial || item.recipientName || '';
    const cepFmt = item.recipientCep
      ? (() => {
          const c = item.recipientCep!.replace(/\D/g, '');
          return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : item.recipientCep!;
        })()
      : '';
    const recipientFields = [
      fieldRow('CLIENTE', cliente, { big: true }),
      fieldRow('CNPJ', item.recipientCnpj),
      fieldRow('ENDEREÇO', item.recipientAddress),
      fieldRow('BAIRRO', item.recipientNeighborhood),
      fieldRow('CIDADE', item.recipientCity),
      fieldRow('UF', item.recipientUf),
      fieldRow('CEP', cepFmt),
    ].filter(Boolean).join('');
    // CÓD. PRODUTO substituiu IDENTIF. CLI em 2026-07-20 (pedido do dono): o
    // slot imprimia os 5 últimos dígitos do CNPJ do cliente (ou código/nome da
    // filial) — dado interno nosso, que nem a expedição nem o cliente usam. O
    // refCode já chegava aqui, só não era impresso em lugar nenhum do rótulo.
    const orderFields = [
      fieldRow('CÓD. PRODUTO', item.refCode, { mono: true }),
      fieldRow('PED. COMPRA', item.clientOrderNumber, { mono: true }),
    ].filter(Boolean).join('');

    // ─── REMETENTE (faixa fina sob o header) ───────────────
    // Empresa emitente escolhida no PV (resolveSender → razão social + CNPJ +
    // endereço). Distinta do destinatário (que é o CLIENTE no corpo). Quando
    // não houver dados de remetente, a faixa não renderiza.
    const remetenteParts = [
      item.senderName,
      item.senderCnpj ? `CNPJ ${item.senderCnpj}` : '',
      item.senderAddress,
    ].filter(Boolean);
    const remetenteHtml = remetenteParts.length
      ? `<div class="remetente-row">
          <span class="rem-label">REMET.:</span>
          <span class="rem-val">${escapeHtml(remetenteParts.join('  ·  '))}</span>
        </div>`
      : '';

    // ─── FOTO + COR (direita) ──────────────────────────────
    // imageIsFallback aplica grayscale pra deixar claro que a cor da foto não
    // corresponde à cor real do pedido (foto mestra da ficha técnica).
    const imgFilter = item.imageIsFallback ? 'filter:grayscale(100%);-webkit-filter:grayscale(100%);' : '';
    const fallbackBadge = item.imageIsFallback
      ? `<div class="photo-fallback-badge">FOTO GENÉRICA</div>`
      : '';
    const photoInner = item.imageUrl
      ? `${fallbackBadge}<img src="${escapeHtml(item.imageUrl)}" style="${imgFilter}" onerror="this.onerror=null;this.src='${FALLBACK_PHOTO_DATA_URL}';" alt="" />`
      : `<img src="${FALLBACK_PHOTO_DATA_URL}" alt="" />`;

    // ─── GRADE (tabela rodapé) ─────────────────────────────
    const gradeCols = item.grade.length + 1; // +1 para a coluna TOTAL
    /**
     * Fonte da grade — estratégia HIERÁRQUICA (opção B, escolhida pelo dono em
     * 05/08/2026 sobre a escala uniforme e a quebra em duas faixas).
     *
     * A coluna é `1fr`: quanto mais numerações, mais estreita, e o que não cabe
     * é CORTADO em silêncio (print não vaza, só some). Quando precisa encolher,
     * encolhe na ordem de prioridade do PRINT_SPEC:
     *
     *   QUANTIDADE  — o número que o operador conta. Resiste até o fim (22→18).
     *   numeração   — identifica, mas é 2 dígitos e tolera menos corpo (18→12).
     *   TOTAL       — rótulo, o primeiro a ceder (11→8).
     *
     * ⚠ Medido: em grade larga quem aperta a coluna NÃO é o número da grade, é
     * a palavra "TOTAL" (5 chars em mono contra 2 dígitos em Anton). Por isso
     * ela cai mais rápido que os números.
     *
     * Pisos do PRINT_SPEC respeitados: grade Anton ≥ 12px, rótulo mono ≥ 6,5px.
     */
    const sizeFontPx   = gradeCols <= 8  ? 18 : gradeCols <= 12 ? 15 : gradeCols <= 16 ? 13 : 12;
    const qtyFontPx    = gradeCols <= 12 ? 22 : gradeCols <= 16 ? 20 : 18;
    const totalLabelPx = gradeCols <= 9  ? 11 : gradeCols <= 13 ? 9.5 : 8;
    const sizeCells = item.grade.map(g =>
      `<div class="cell" style="font-size:${sizeFontPx}px;">${escapeHtml(String(g.size))}</div>`,
    ).join('');
    const qtyCells = item.grade.map(g =>
      `<div class="cell" style="font-size:${qtyFontPx}px;">${g.qty}</div>`,
    ).join('');
    const totalQty = item.grade.reduce((sum, g) => sum + g.qty, 0);

    /**
     * Caixa fechada com UMA numeração (decisão do dono, 11/08/2026): a tabela de
     * 7 colunas com 6 zeros vira ruído e some, e o número da caixa ocupa o espaço
     * inteiro — o operador lê a numeração a um metro da bancada.
     *
     * ⚠ O gatilho é o CONTEÚDO da caixa, não o modo do pedido. Assim a caixa de
     * sobra do pedido tradicional — que já é de numeração única hoje — ganha o
     * mesmo tratamento, em vez de existirem dois rótulos para a mesma situação.
     */
    const isSingleSizeBox = item.grade.length === 1;
    const singleSize = isSingleSizeBox ? String(item.grade[0].size) : '';

    // ─── MARCA / SELO (linha 1 da tabela de grade) ─────────
    // Selo e texto usam a MESMA marca: item.marca, resolvida pelo caller via
    // RPC resolve_item_brand (silk do solado, cascata cliente→grupo→padrão).
    // Sem marca → 'Squad Shoes' (default do RPC) — NUNCA um silk inventado.
    const brand = (item.marca || '').trim() || 'Squad Shoes';
    const brandLogo = silkLogoSvg(brand.toUpperCase(), 14);

    // ─── RODAPÉ PEDIDO / VOLUME ────────────────────────────
    // Rodapé = NOSSO OP (produção). O pedido do cliente foi pro topo; aqui fica
    // o OP pra rastreio interno, sem duplicar o mesmo número em cima e embaixo.
    const opFooter = item.orderNumber || item.clientOrderNumber || '—';
    const volNumerador = item.boxNumber ?? 1;
    const volDenominador = item.totalBoxes ?? 1;

    return `
      <div class="label-cx-ext">
        <div class="nf-row">
          <div class="nf-cell">
            <span class="nf-label">NF:</span>
            <span class="nf-value">${escapeHtml(String(nfValue))}</span>
          </div>
          <div class="prog-cell">
            <span class="prog-label">PEDIDO:</span>
            <span class="prog-value">${progValue}</span>
          </div>
        </div>

        ${remetenteHtml}

        <div class="body">
          <div class="body-left">
            ${recipientFields}
            ${orderFields ? '<div class="gap"></div>' + orderFields : ''}
          </div>
          <div class="body-right">
            <div class="photo-frame">${photoInner}</div>
            ${item.color ? `<div class="cor-row"><span class="cor-name">${escapeHtml(item.color)}</span></div>` : ''}
          </div>
        </div>

        <div class="grade-table" style="grid-template-columns:110px repeat(${gradeCols}, 1fr);">
          <div class="glabel first">MARCA:</div>
          <div class="row-marca">${brandLogo}<span class="brand-mark">${escapeHtml(brand)}</span></div>
          <div class="glabel">REFERENCIA</div>
          <div class="row-ref">${escapeHtml(item.refName || item.refCode || '—')}</div>
          ${item.mainMaterial ? `<div class="glabel">MATERIAL</div>
          <div class="row-mat">${escapeHtml(item.mainMaterial)}</div>` : ''}
          ${isSingleSizeBox ? `
          <div class="glabel last">TAMANHO</div>
          <div class="single-size" style="grid-column: 2 / -1;">
            <div class="ss-col"><span class="ss-cap">TAMANHO</span><span class="ss-num ss-red">${escapeHtml(singleSize)}</span></div>
            <div class="ss-col"><span class="ss-cap">QUANTIDADE</span><span class="ss-num">${totalQty}</span></div>
          </div>` : `
          <div class="glabel">TAMANHO</div>
          ${sizeCells}<div class="cell total tam-total" style="font-size:${totalLabelPx}px;">TOTAL</div>
          <div class="glabel last">QUANTIDADE</div>
          ${qtyCells}<div class="cell total qtd-total" style="font-size:${qtyFontPx}px;">${totalQty}</div>`}
        </div>

        <div class="footer">
          <div class="pedido">
            <span class="lbl">OP:</span>
            <span class="val">${escapeHtml(String(opFooter))}</span>
          </div>
          ${item.barcode ? `<div class="box-bc-wrap"><svg id="bx-${idx}"></svg></div>` : ''}
          <div class="volume">
            <span class="lbl">VOLUME:</span>
            <span class="val">${volNumerador}<span class="sep">/</span>${volDenominador}</span>
          </div>
        </div>
      </div>`;
  };

  // Construímos pages com 2 etiquetas empilhadas por A4 portrait. Linha de
  // corte (6mm) intercala. page-break-inside:avoid no .page garante que cada
  // par fique na mesma folha.
  const labels = items.map(renderLabel);

  // (código órfão da implementação 150×100mm removido em 19/05/2026 — agora
  //  vive em git history se precisar consultar; o novo renderLabel acima cobre
  //  todo o ciclo de renderização da etiqueta 198×132mm.)

  // Pages com 2 etiquetas empilhadas por A4 portrait + linha de corte (6mm)
  // entre elas. page-break-inside:avoid no .page garante que cada par fique
  // na mesma folha; .page-break dispara break-after:page nas folhas que não
  // são a última, evitando uma página em branco no final.
  const pages: string[] = [];
  for (let i = 0; i < labels.length; i += 2) {
    const first = labels[i];
    const second = labels[i + 1];
    const isLastPage = i + 2 >= labels.length;
    pages.push(`<section class="page${!isLastPage ? ' page-break' : ''}">
      ${first}
      ${second || ''}
    </section>`);
  }
  const totalPages = Math.ceil(labels.length / 2);

  // Preload das imagens dos produtos pra evitar layout shift na impressão.
  const uniqueImageUrls = [...new Set(items.map(i => i.imageUrl).filter(Boolean))];
  const preloadLinks = uniqueImageUrls
    .map(u => `<link rel="preload" as="image" href="${escapeHtml(u as string)}" crossorigin="anonymous" />`)
    .join('\n');

  // Código de barras (CODE128) por etiqueta — antes a caixa master saía SEM barcode
  // (o campo item.barcode era descartado), quebrando conferência na expedição.
  const boxBarcodeInits = items.map((it, idx) => {
    if (!it.barcode) return '';
    const code = sanitizeBarcode(it.barcode);
    return `try{JsBarcode("#bx-${idx}","${code}",{format:"CODE128",width:1.4,height:42,displayValue:true,fontSize:13,margin:0});}catch(e){}`;
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Rótulo Caixa Externa · 198×132mm</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;600;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
${preloadLinks}
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{background:#e8e6e1;font-family:'Inter Tight',sans-serif;color:#000;-webkit-font-smoothing:antialiased;}
body{padding:24px;}
${LABEL_PRINT_HARDENING}

/* A4 portrait — 210×297mm. Cada .page acomoda 2 .label-cx-ext empilhadas com
   6mm de gap (margem de corte).
   @page margin:0 — CRÍTICO: com margem > 0 o navegador desenha o cabeçalho/rodapé
   automático (data/hora, "about:blank" e "N/N" das páginas) NA margem, sujando o
   rótulo. Com margin:0 o Chrome NÃO desenha esse chrome. O recuo seguro de 9mm
   passa a vir do padding do .page (abaixo), então a posição do rótulo não muda. */
@page{size:A4 portrait;margin:0;}

.page{
  width:210mm;min-height:297mm;margin:0 auto;background:#fff;
  box-shadow:0 18px 48px -16px rgba(0,0,0,0.25);
  padding:9mm;display:flex;flex-direction:column;align-items:center;gap:6mm;
  page-break-inside:avoid;break-inside:avoid;
}
.page.page-break{break-after:page;page-break-after:always;}
.page:not(.page-break){break-after:avoid;page-break-after:avoid;}

.label-cx-ext{
  width:192mm;height:132mm;background:#fff;
  border:3px solid #000;color:#000;
  font-family:'Inter Tight',sans-serif;
  display:flex;flex-direction:column;
  page-break-inside:avoid;break-inside:avoid;
  overflow:hidden;position:relative;
}

@media print{
  body{padding:0;background:#fff;}
  /* padding:9mm — recuo seguro (antes vinha do @page margin:9mm, agora zerado
     pra remover o cabeçalho/rodapé do navegador). Mantém o rótulo na MESMA
     posição de antes (192mm de largura dentro dos 210mm com 9mm de cada lado).
     min-height:0 (era 297mm) — CRÍTICO com @page margin:0: um .page de 297mm
     (border-box, já inclui o padding) fica EXATAMENTE do tamanho da folha A4 e o
     Chrome transborda por arredondamento, gerando uma página EM BRANCO depois de
     cada rótulo (184 = 92×2). Cada rótulo já quebra a folha sozinho (.page-break →
     break-after), então o .page não precisa preencher a folha inteira: fica do
     tamanho do conteúdo (~288mm com 2 rótulos), que cabe folgado em 1 folha. */
  .page{box-shadow:none;padding:9mm;width:210mm;min-height:0;gap:6mm;}
  /* Fix 2026-05-23: era 198mm — estourava 6mm em A4 com @page margin 9mm
     (área útil = 192mm). Borda direita saía cortada. Manter 192mm em
     print pra caber dentro da margem segura. */
  .label-cx-ext{width:192mm;height:132mm;}
  /* Fix 2026-06-22: o LABEL_PRINT_HARDENING global aplica em @media print
     "body *{overflow:visible;max-height:none}" pra impedir que containers
     ANCESTRAIS cortem a etiqueta — mas isso também remove o overflow:hidden
     da moldura da foto e o teto max-height:100% da imagem. Sem o teto, a foto
     cresce até max-width:100% (altura = largura/proporção) e VAZA pra baixo,
     por cima da grade + código de barras + VOLUME (bug reportado: "foto grande
     demais, cortando"). Reafirmamos a contenção com especificidade de classe +
     !important (mesma prioridade do "body *", classe vence o seletor universal),
     restaurando o comportamento que já valia em tela. */
  .label-cx-ext,.photo-frame{overflow:hidden !important;}
  .photo-frame img{max-width:100% !important;max-height:100% !important;}
  .print-footer{display:none !important;}
}

/* HEADER NF / PEDIDO ─────────────────── */
.nf-row{display:grid;grid-template-columns:1.4fr 1fr;border-bottom:3px solid #000;flex-shrink:0;}
.nf-cell{padding:6px 14px;border-right:3px solid #000;display:flex;align-items:baseline;gap:8px;background:#fff;color:#000;}
.nf-cell .nf-label{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;letter-spacing:0.06em;color:#555;}
/* Vermelho de conferência (spec variacao-material-pv): NF, pedido e cliente
   em #D9264E (squad red) — os 3 campos que a expedição procura primeiro. */
.nf-cell .nf-value{font-family:'Anton',sans-serif;font-size:40px;letter-spacing:0.02em;line-height:.92;color:#D9264E;}
.prog-cell{padding:6px 14px;display:flex;flex-direction:column;justify-content:center;gap:1px;}
.prog-cell .prog-label{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;letter-spacing:0.06em;color:#555;}
.prog-cell .prog-value{font-family:'Anton',sans-serif;font-size:24px;letter-spacing:0.02em;line-height:1;color:#D9264E;}

/* REMETENTE (faixa fina) ───────────── */
.remetente-row{display:flex;gap:6px;align-items:baseline;padding:3px 14px;border-bottom:1.5px solid #000;background:#fff;color:#000;flex-shrink:0;}
.remetente-row .rem-label{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:9px;letter-spacing:0.06em;white-space:nowrap;}
.remetente-row .rem-val{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:9.5px;line-height:1.15;}

/* CORPO 2 colunas ──────────────────── */
.body{display:flex;flex:1;min-height:0;}
.body-left{flex:1.3;border-right:3px solid #000;padding:8px 14px;display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;}
/* Grid de 2 colunas: rótulo (largura fixa) + valor. Garante a coluna de
   valores SEMPRE alinhada (fix do alinhamento "torto" 2026-06-30). */
.body-left .field{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:baseline;border-bottom:0.5px solid #bbb;padding-bottom:2px;line-height:1.25;}
.body-left .field .lbl{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;letter-spacing:0.06em;color:#555;}
.body-left .field .val{font-weight:700;font-size:12px;}
.body-left .field.mono .val{font-family:'JetBrains Mono',monospace;}
.body-left .field.big .val{font-family:'Anton',sans-serif;font-weight:400;font-size:19px;letter-spacing:0.01em;color:#D9264E;}
.body-left .gap{height:4px;}

.body-right{flex:1;display:flex;flex-direction:column;padding:8px 10px 6px;}
.photo-frame{flex:1;border:3px solid #000;background:#fff;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;}
.photo-frame img{max-width:100%;max-height:100%;object-fit:contain;}
.photo-fallback-badge{position:absolute;top:6px;left:6px;z-index:2;background:#fff;color:#000;border:1px solid #000;font-size:8.5px;font-weight:800;padding:2px 5px;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap;line-height:1;font-family:'JetBrains Mono',monospace;}
.cor-row{margin-top:4px;display:flex;justify-content:space-between;align-items:center;gap:6px;}
.cor-row .cor-name{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:18px;letter-spacing:0.04em;text-transform:uppercase;line-height:1.1;color:#C00000;}

/* TABELA grade ───────────────────── */
/* Grade unificada num único grid: col 1 = rótulos, cols 2..N = valores.
   Garante que cada rótulo (MARCA/REFERENCIA/TAMANHO/QUANTIDADE) compartilhe a
   altura da sua linha de valores (antes eram 2 colunas flex independentes que
   desalinhavam por terem alturas de linha calculadas separadamente). */
.grade-table{display:grid;border-top:3px solid #000;flex-shrink:0;}
.grade-table > .glabel{border-right:1.5px solid #000;border-bottom:1px solid #000;padding:4px 10px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;letter-spacing:0.06em;color:#555;display:flex;align-items:center;}
.grade-table > .glabel.first{background:#fff;color:#000;}
.grade-table > .glabel.last{border-bottom:none;}
/* Caixa fechada por UMA numeração — o número é a informação principal, lida a
   um metro. Corpo grande em Anton porque no laser P&B da fábrica o vermelho
   vira cinza: o tamanho da fonte é que precisa carregar o destaque sozinho. */
.grade-table > .single-size{display:flex;align-items:stretch;}
.single-size > .ss-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 0;}
.single-size > .ss-col + .ss-col{border-left:1.5px solid #000;}
.ss-cap{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:9px;letter-spacing:0.12em;color:#555;}
.ss-num{font-family:'Anton',Impact,sans-serif;font-size:52px;line-height:0.9;color:#000;}
.ss-num.ss-red{color:#C00000;}
.grade-table > .cell{text-align:center;border-right:1px solid #000;border-bottom:1px solid #000;font-family:'Anton',sans-serif;font-weight:400;color:#000;font-size:18px;padding:2px 0;display:flex;align-items:center;justify-content:center;}
.grade-table > .cell.tam-total{background:#fff;color:#000;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;}
.grade-table > .cell.qtd-total{background:#fff;color:#000;font-size:22px;border-bottom:none;}
.grade-table > .row-marca{grid-column:2 / -1;background:#fff;color:#000;padding:3px 10px;text-align:left;display:flex;align-items:center;gap:8px;border-bottom:1px solid #000;}
.grade-table > .row-marca .brand-mark{font-family:'Anton',sans-serif;font-size:20px;letter-spacing:0.06em;color:#000;line-height:1;}
.grade-table > .row-ref{grid-column:2 / -1;text-align:left;padding:4px 10px;font-size:15px;border-bottom:1px solid #000;font-family:'JetBrains Mono',monospace;font-weight:700;color:#C00000;display:flex;align-items:center;}
/* MATERIAL (spec variacao-material-pv): nome do grupo/variação de material
   (ex.: NAPA SOFT). Linha só existe quando o valor foi resolvido — cascata
   variação do PV > cabedal da ficha > (tiras) forração pick-one. */
.grade-table > .row-mat{grid-column:2 / -1;text-align:left;padding:4px 10px;font-size:16px;border-bottom:1px solid #000;font-family:'Anton',sans-serif;letter-spacing:0.05em;text-transform:uppercase;color:#000;display:flex;align-items:center;}

/* RODAPÉ PEDIDO + VOLUME ──────────── */
.footer{display:flex;border-top:3px solid #000;background:#fff;color:#000;flex-shrink:0;}
.footer .pedido{flex:1;padding:6px 14px;border-right:3px solid #000;display:flex;align-items:center;gap:8px;}
.footer .volume{padding:6px 14px;display:flex;align-items:baseline;gap:8px;}
.footer .lbl{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12px;letter-spacing:0.06em;color:#555;}
.footer .val{font-family:'Anton',sans-serif;font-size:28px;letter-spacing:0.02em;line-height:1;color:#000;}
.footer .volume .sep{font-size:16px;}
.footer .box-bc-wrap{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:2px 12px;border-left:3px solid #000;}
.footer .box-bc-wrap svg{height:11mm;width:auto;max-width:62mm;}

/* Linha de corte entre as 2 etiquetas (visível só em tela, sumindo em print) */

/* Print footer (botões "Imprimir" / "Voltar" — só em tela) */
.print-footer{max-width:190mm;margin:24px auto 12px;padding:18px 24px;background:#fff;border:1px solid #d4d4d4;border-radius:6px;font-family:Arial,sans-serif;text-align:center;}
.print-footer__title{font-size:12px;font-weight:700;color:#111;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;}
.print-footer__sub{font-size:11px;color:#555;margin-bottom:14px;}
.print-footer__btn{display:inline-block;padding:9px 22px;background:#0f172a;color:#fff;text-decoration:none;border-radius:4px;font-size:12px;font-weight:600;letter-spacing:0.3px;font-family:inherit;}
.print-footer__btn--ghost{background:#fff;color:#0f172a;border:1px solid #0f172a;margin-left:8px;}
</style>
</head><body>${pages.join('')}
<div class="print-footer">
  <p class="print-footer__title">${items.length} etiqueta${items.length === 1 ? '' : 's'} · ${totalPages} folha${totalPages === 1 ? '' : 's'} A4</p>
  <p class="print-footer__sub">Cada folha A4 imprime 2 etiquetas (= 2 caixas). Confira o layout antes de mandar pra impressão.</p>
  <a class="print-footer__btn" href="javascript:window.print()">Imprimir agora</a>
  <a class="print-footer__btn print-footer__btn--ghost" href="javascript:window.close()">Voltar e ajustar</a>
</div>
${safeScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js')}
${safeScriptBlock(`
var _bxRetry=0;
function initBoxBC(){
  if(typeof JsBarcode==='undefined'){_bxRetry++;if(_bxRetry>40){return;}setTimeout(initBoxBC,150);return;}
  ${boxBarcodeInits}
}
initBoxBC();
`)}
${safeScriptBlock(`
function waitForImages(){
  var imgs=document.querySelectorAll('img');
  var promises=[];
  imgs.forEach(function(img){
    if(!img.complete){
      promises.push(new Promise(function(resolve){
        img.onload=resolve;
        img.onerror=resolve;
        setTimeout(resolve,8000);
      }));
    }
  });
  return Promise.all(promises);
}
window._imagesReady=waitForImages();
`)}
</body></html>`;
}

/** Build HTML string for thermal labels (Elgin L42 Pro Full)
 * Layout: 100x30mm — 3 zones horizontais
 *   Esquerda: Ref, Material, Cor, Numeração grande
 *   Centro:   Imagem do produto ou logotipo
 *   Direita:  Código de barras (EAN-13/CODE-128) com quiet zone
 * Rodapé:     Dados de composição / categoria
 *
 * Margem de segurança: 1.5mm sup/inf, 2mm laterais
 * Quiet zone barras: 3mm antes/depois
 * Fontes: Arial/Helvetica sem serifa para nitidez térmica
 * Cores: Preto puro 100% (#000)
 */
export type ThermalLabelConfig = {
  marginPct: number;        // margin % on all sides (default 5)
  fontSizeName: number;     // pt for reference name (default 10)
  fontSizeCode: number;     // pt for code (default 6.5)
  fontSizeColor: number;    // pt for color row (default 6)
  fontSizeMaterial: number; // pt for material (default 5.5)
  fontSizeSize: number;     // pt for size box (default 11)
  fontSizePed: number;      // pt for pedido (default 6)
  imgWidthMm: number;       // image width in mm (default 24)
  imgHeightMm: number;      // image height in mm (default 20)
  leftColumnMm: number;     // left column width mm (default 26)
  rightColumnMm: number;    // right column (barcode) width mm (default 24)
  showImage: boolean;
  showBarcode: boolean;
  showCode: boolean;
  showMaterial: boolean;
  showCategory: boolean;
  showPedido: boolean;
  showSize: boolean;
};

export const DEFAULT_THERMAL_CONFIG: ThermalLabelConfig = {
  marginPct: 3,
  fontSizeName: 11,
  fontSizeCode: 5.5,
  fontSizeColor: 6.5,
  fontSizeMaterial: 5.5,
  fontSizeSize: 20,
  fontSizePed: 5.5,
  imgWidthMm: 20,
  imgHeightMm: 22,
  leftColumnMm: 26,
  rightColumnMm: 17,
  showImage: true,
  showBarcode: true,
  showCode: true,
  showMaterial: true,
  showCategory: true,
  showPedido: true,
  showSize: true,
};

export function buildThermalLabelsHtml(labels: {
  refCode: string; refName: string; mainMaterial: string; color: string;
  size: string; barcode: string; imageUrl?: string; shoeCategory?: string;
  clientOrderNumber?: string; qty?: number; strapsLabel?: string;
  /** True quando imageUrl é fallback (foto mestra, não retrata a cor real
   *  pedida). Aplica grayscale + selo "FOTO GENÉRICA" na moldura da foto. */
  imageIsFallback?: boolean;
}[], logoUrl: string, dimensions = { width: 100, height: 30 }, config: ThermalLabelConfig = DEFAULT_THERMAL_CONFIG, senderCnpj?: string): string {
  const { width: W, height: H } = dimensions;
  const c = { ...DEFAULT_THERMAL_CONFIG, ...config };

  // Auto-scale proportional to label dimensions (reference: 100×30mm)
  const scaleH = H / 30;
  const scaleW = W / 100;

  // Scaled font sizes — grow/shrink with label height
  const fs = {
    name:     +(c.fontSizeName     * scaleH).toFixed(1),
    code:     +(c.fontSizeCode     * scaleH).toFixed(1),
    color:    +(c.fontSizeColor    * scaleH).toFixed(1),
    material: +(c.fontSizeMaterial * scaleH).toFixed(1),
    ped:      +(c.fontSizePed      * scaleH).toFixed(1),
    size:      Math.round(c.fontSizeSize * scaleH),
  };

  // Scaled column and image widths — grow/shrink with label width
  const scaledLeftColMm  = +(c.leftColumnMm  * scaleW).toFixed(1);
  const scaledRightColMm = +(c.rightColumnMm * scaleW).toFixed(1);
  const scaledImgWidthMm  = +(c.imgWidthMm  * scaleW).toFixed(1);
  const scaledImgHeightMm = +(c.imgHeightMm * scaleH).toFixed(1);

  // Safe padding: tight enough to use most of the label, safe enough to avoid printer cutoff
  const effectiveMarginPct = Math.max(c.marginPct, 3);
  const baseMarginX = W * effectiveMarginPct / 100;
  const baseMarginY = H * effectiveMarginPct / 100;
  const printerBleedGuardX = Math.max(W * 0.015, 1.5);
  const printerBleedGuardY = Math.max(H * 0.04, 1.0);
  const safePadX = +(baseMarginX + printerBleedGuardX).toFixed(1);
  const safePadY = +(baseMarginY + printerBleedGuardY).toFixed(1);
  const innerW = Math.max(24, +(W - safePadX * 2).toFixed(1));
  const innerH = Math.max(12, +(H - safePadY * 2).toFixed(1));
  const hasLeftColumn = c.showImage || c.showSize;
  const hasRightColumn = c.showBarcode;
  const gapCount = (c.showImage ? 1 : 0) + (c.showSize ? 1 : 0) + (hasRightColumn ? 1 : 0);
  const columnGapMm = +(0.8 * scaleW).toFixed(1);
  const totalGapMm = gapCount * columnGapMm;
  const minInfoWidthMm = clamp(+(innerW * 0.28).toFixed(1), 14, 40);
  const requestedLeftMm = hasLeftColumn ? scaledLeftColMm : 0;
  const requestedRightMm = hasRightColumn ? scaledRightColMm : 0;
  const sideColumnsBudgetMm = Math.max(0, innerW - minInfoWidthMm - totalGapMm);
  const requestedSideTotalMm = requestedLeftMm + requestedRightMm;
  const sideScale = requestedSideTotalMm > 0 && requestedSideTotalMm > sideColumnsBudgetMm
    ? sideColumnsBudgetMm / requestedSideTotalMm
    : 1;
  const leftColumnMm = hasLeftColumn
    ? +Math.min(requestedLeftMm * sideScale, sideColumnsBudgetMm * 0.5).toFixed(1)
    : 0;
  const rightColumnMm = hasRightColumn
    ? +Math.min(requestedRightMm * sideScale, sideColumnsBudgetMm * 0.55).toFixed(1)
    : 0;
  const infoColumnMm = +(innerW - leftColumnMm - rightColumnMm - totalGapMm).toFixed(1);
  const sizeBoxWidthMm = c.showSize && hasLeftColumn ? +clamp(leftColumnMm * 0.38, 7, 14).toFixed(1) : 0;
  const imageFrameWidthMm = c.showImage && hasLeftColumn
    ? Math.max(5, +(leftColumnMm - (c.showSize ? sizeBoxWidthMm + 0.8 : 0)).toFixed(1))
    : 0;
  const imageMaxWidthMm = c.showImage
    ? Math.max(4, Math.min(scaledImgWidthMm, +(imageFrameWidthMm - 0.5).toFixed(1)))
    : 0;
  const imageMaxHeightMm = c.showImage
    ? Math.max(6, Math.min(scaledImgHeightMm, +(innerH - 2).toFixed(1)))
    : 0;
  // ── Layout 2026-06-17: [FOTO] [DESCRIÇÃO] [Nº] [CÓDIGO] ──
  // A numeração saiu da esquerda e passou a ficar ENTRE a descrição e o código
  // de barras (caixa preta, coluna própria). A foto do produto ocupa a coluna
  // da esquerda. As larguras reaproveitam o budget já calculado (foto = antigo
  // frame da imagem; Nº = antiga size box), só muda a POSIÇÃO no grid.
  // Foto recebe TODA a coluna da esquerda (o Nº saiu de lá) → imagem maior.
  const photoColMm = c.showImage ? +Math.max(leftColumnMm, 8).toFixed(1) : 0;
  // Nº em destaque (número grande), em chip que preenche a altura útil.
  const sizeColMm = c.showSize ? +clamp(sizeBoxWidthMm, 10, 13).toFixed(1) : 0;
  const barcodeHeightPx = Math.max(24, Math.round(innerH * 3.5));
  const barcodeHeightMm = Math.max(6, +(innerH - 1.5).toFixed(1));

  // Header strip: dark band with ref code + optional category
  const showHeader = c.showCode;
  const headerHeightMm = showHeader ? +(Math.max(H * 0.20, 4.5)).toFixed(1) : 0;
  const headerFontPt   = +(5.4 * scaleH).toFixed(1);
  const headerCatFontPt = +(4.6 * scaleH).toFixed(1);
  // Footer strip: "FABRICADO NO BRASIL · CNPJ" — required by INMETRO 576/2014
  const footerHeightMm = +(Math.max(H * 0.115, 3.0)).toFixed(1);
  const footerFontPt   = +(3.8 * scaleH).toFixed(1);
  // Shell top accounts for header + small gap; bottom clears footer
  const shellTopMm    = showHeader ? +(headerHeightMm + Math.max(safePadY * 0.4, 0.6)).toFixed(1) : safePadY;
  const shellBottomMm = +(+footerHeightMm + Math.max(safePadY * 0.3, 0.4)).toFixed(1);

  const labelHtml = labels.map((l, idx) => {
    // Referência = SOMENTE o nome do modelo. O SKU/refCode (ex: '3213131')
    // NUNCA aparece. User explícito em 2026-05.
    const displayReference = (l.refName && l.refName.trim() && l.refName.trim() !== '—')
      ? l.refName.trim()
      : '—';

    const hasHeader = showHeader && !!displayReference && displayReference !== '—';
    const thisShellTopMm = hasHeader ? shellTopMm : safePadY;

    const headerHtml = hasHeader ? `
      <header class="lbl-hdr">
        <span class="lbl-hdr-code">${escapeHtml(displayReference)}</span>
        <span class="lbl-hdr-right">${
          c.showCategory && l.shoeCategory ? escapeHtml(l.shoeCategory) :
          l.qty ? `× ${l.qty} PAR` : ''
        }</span>
      </header>` : '';

    const footerText = senderCnpj
      ? `FABRICADO NO BRASIL &nbsp;·&nbsp; CNPJ ${escapeHtml(senderCnpj)}`
      : `FABRICADO NO BRASIL`;

    return `<div class="print-page">
      ${headerHtml}
      <section class="label-shell" style="top:${thisShellTopMm}mm">
        ${c.showImage ? `<div class="label-image-frame">${l.imageUrl
            ? `${l.imageIsFallback ? `<div class="img-fallback-badge">FOTO GENÉRICA</div>` : ''}<img src="${escapeHtml(l.imageUrl)}" class="label-img" crossorigin="anonymous" ${l.imageIsFallback ? `style="filter:grayscale(100%);-webkit-filter:grayscale(100%);" ` : ''}onerror="this.onerror=null;this.style.display='none'" />`
            : `<img src="${escapeHtml(logoUrl)}" class="label-img" crossorigin="anonymous" alt="Logo" />`}</div>` : ''}

        <div class="label-info">
          <p class="info-reference">${escapeHtml(displayReference)}</p>
          <p class="info-color">${escapeHtml(l.color || '—')}${l.strapsLabel ? ` <span class="info-straps">| ${escapeHtml(l.strapsLabel.replace(/\|/g, ' · ').replace(/:/g, ': '))}</span>` : ''}${!showHeader && l.qty ? ` <strong class="info-qty">×${l.qty}</strong>` : ''}</p>
          ${c.showMaterial && l.mainMaterial ? `<p class="info-material">${escapeHtml(l.mainMaterial)}</p>` : ''}
          ${c.showPedido && l.clientOrderNumber ? `<p class="info-pedido">PED. ${escapeHtml(l.clientOrderNumber)}</p>` : ''}
          ${!showHeader && c.showCategory && l.shoeCategory ? `<p class="info-category">${escapeHtml(l.shoeCategory)}</p>` : ''}
        </div>

        ${c.showSize ? `<div class="label-size-box"><span class="sz-nr">Nº</span>${escapeHtml(l.size || '—')}</div>` : ''}

        ${hasRightColumn ? `<div class="label-right">
          ${l.barcode
            ? `<svg id="bc-${idx}" class="label-barcode"></svg>`
            : `<span class="label-no-barcode">—</span>`
          }
        </div>` : ''}
      </section>
      <footer class="lbl-ftr">${footerText}</footer>
    </div>`;
  }).join('');

  const barcodeInits = labels.map((l, idx) => {
    if (!l.barcode || !c.showBarcode) return '';
    // Em ficha-mode o barcode é "REF-34(2) 35(3) ..." (com espaços/parênteses,
    // legais em CODE128). sanitizeBarcode os removia, alterando o payload
    // codificado. jsStringLiteral preserva o valor inteiro e ainda é seguro
    // dentro do <script> (escapa aspas e neutraliza </). Já é uma string
    // entre aspas, então NÃO envolver em "" de novo.
    const code = jsStringLiteral(l.barcode);
    return `try{var el=document.querySelector("#bc-${idx}");JsBarcode(el,${code},{format:"CODE128",width:0.8,height:${barcodeHeightPx},displayValue:false,margin:0});if(el){el.removeAttribute("width");el.removeAttribute("height");el.style.width="100%";el.style.height="auto";}}catch(e){}`;
  }).filter(Boolean).join('\n');

  const cols: string[] = [];
  if (c.showImage) cols.push(`${photoColMm}mm`);   // FOTO (esquerda)
  cols.push(`1fr`);                                 // DESCRIÇÃO
  if (c.showSize) cols.push(`${sizeColMm}mm`);      // Nº (entre descrição e código)
  if (hasRightColumn) cols.push(`${rightColumnMm}mm`); // CÓDIGO DE BARRAS (direita)
  const gridCols = cols.join(' ');

  // Collect unique image URLs for preloading
  const uniqueImageUrls = [...new Set(labels.map(l => l.imageUrl).filter(Boolean))];
  const preloadLinks = uniqueImageUrls.map(u => `<link rel="preload" as="image" href="${escapeHtml(u as string)}" crossorigin="anonymous" />`).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Etiquetas - Elgin L42 Pro Full</title>
${preloadLinks}
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{
    margin:0;
    padding:0;
    background:#fff;
    color:#000;
    font-family:Arial,Helvetica,sans-serif;
    -webkit-font-smoothing:none;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .preview-shell{
    display:flex;
    flex-direction:column;
    align-items:flex-start;
    gap:10px;
    padding:16px;
  }
  @media screen {
    body{background:#e5e7eb;}
    .print-page{
      box-shadow:0 2px 10px rgba(0,0,0,0.18);
      border:1px solid #d4d4d8;
      background:#fff;
    }
  }
  .print-page{
    width:${W}mm;
    height:${H}mm;
    overflow:hidden;
    position:relative;
    flex:none;
    page-break-after:always;
    break-after:page;
    background:#fff;
    border:0.4mm solid #000;
  }
  .print-page:last-child{page-break-after:auto;break-after:auto;}
  .lbl-hdr{
    position:absolute;
    top:0;left:0;right:0;
    height:${headerHeightMm}mm;
    background:#000;
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:0 ${safePadX}mm;
    overflow:hidden;
  }
  .lbl-hdr::before{
    content:'';
    position:absolute;
    left:0;top:0;bottom:0;
    width:${+(1.2 * scaleW).toFixed(1)}mm;
    background:rgba(255,255,255,0.18);
  }
  .lbl-hdr-code{
    font-size:${headerFontPt}pt;
    font-weight:800;
    text-transform:uppercase;
    letter-spacing:0.4px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .lbl-hdr-right{
    font-size:${headerCatFontPt}pt;
    font-weight:500;
    opacity:0.75;
    text-transform:uppercase;
    white-space:nowrap;
    flex-shrink:0;
    margin-left:1mm;
  }
  .label-shell{
    position:absolute;
    left:${safePadX}mm;
    top:${safePadY}mm;
    right:${safePadX}mm;
    bottom:${shellBottomMm}mm;
    display:grid;
    grid-template-columns:${gridCols};
    column-gap:${columnGapMm}mm;
    align-items:center;
    overflow:hidden;
  }
  .label-image-frame{
    width:100%;
    height:100%;
    min-width:0;
    min-height:0;
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    position:relative;
  }
  /* Selo "FOTO GENÉRICA" (análogo ao .photo-fallback-badge da caixa externa):
     marca que a foto é ilustrativa e não retrata a cor real do produto. */
  .img-fallback-badge{
    position:absolute;
    top:0;left:0;
    z-index:1;
    background:#000;
    color:#fff;
    font-size:3pt;
    font-weight:800;
    line-height:1;
    letter-spacing:0.2px;
    padding:0.3mm 0.5mm;
    text-transform:uppercase;
    white-space:nowrap;
  }
  .label-img{
    width:auto;
    height:auto;
    max-width:100%;
    max-height:100%;
    object-fit:contain;
    display:block;
  }
  .label-size-box{
    width:100%;
    height:100%;
    align-self:stretch;
    padding:0.4mm 0.4mm;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    text-align:center;
    overflow:hidden;
    background:#000;
    color:#fff;
    border-radius:1mm;
    font-size:${fs.size}pt;
    font-weight:900;
    line-height:1;
    letter-spacing:-0.5px;
  }
  .sz-nr{
    display:block;
    font-size:${+(3.0 * scaleH).toFixed(1)}pt;
    font-weight:600;
    letter-spacing:0.8px;
    opacity:0.55;
    line-height:1;
    margin-bottom:0.3mm;
    text-transform:uppercase;
  }
  .label-info{
    min-width:0;
    height:100%;
    display:flex;
    flex-direction:column;
    justify-content:center;
    gap:0.3mm;
    overflow:hidden;
    padding:0.3mm 1.2mm;
    ${c.showImage ? 'border-left:0.22mm solid #000;' : ''}
    ${(c.showSize || hasRightColumn) ? 'border-right:0.22mm solid #000;' : ''}
  }
  .info-reference,
  .info-code,
  .info-color,
  .info-material,
  .info-pedido,
  .info-category{
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    text-transform:uppercase;
  }
  .info-reference{
    font-size:${fs.name}pt;
    font-weight:900;
    line-height:1;
    letter-spacing:0.3px;
  }
  .info-code{
    font-size:${fs.code}pt;
    font-weight:700;
    line-height:1;
  }
  .info-color{
    font-size:${fs.color}pt;
    font-weight:800;
    line-height:1.02;
  }
  .info-material{
    font-size:${fs.material}pt;
    font-weight:600;
    line-height:1.02;
    opacity:0.72;
  }
  .info-pedido,
  .info-category{
    font-size:${fs.ped}pt;
    font-weight:600;
    line-height:1;
    opacity:0.65;
  }
  .label-right{
    height:100%;
    min-width:0;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
    padding:0.5mm 0;
  }
  .label-barcode{
    width:100%;
    max-width:100%;
    height:auto;
    max-height:${barcodeHeightMm}mm;
    display:block;
  }
  .label-no-barcode{
    font-size:6.5pt;
    font-weight:700;
    color:#000;
  }
  .lbl-ftr{
    position:absolute;
    bottom:0;left:0;right:0;
    height:${footerHeightMm}mm;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:0 ${safePadX}mm;
    font-size:${footerFontPt}pt;
    font-weight:700;
    letter-spacing:0.6px;
    text-transform:uppercase;
    background:#f5f5f5;
    border-top:0.4mm solid #000;
    overflow:hidden;
    white-space:nowrap;
  }
  @media print{
    html,body{background:#fff !important;}
    body{padding:0 !important;margin:0 !important;}
    .preview-shell{display:block;padding:0;margin:0;}
    .print-page{box-shadow:none;border:0.4mm solid #000;}
    /* Fix 2026-06-22: o LABEL_PRINT_HARDENING ("body *{overflow:visible;
       max-height:none}") reabre o clip da moldura e tira o teto da imagem,
       fazendo a foto do produto vazar pra fora do frame na impressão. Reafirma
       a contenção (mesmo bug corrigido na etiqueta de caixa externa). */
    .print-page,.label-shell,.label-image-frame{overflow:hidden !important;}
    .label-img{max-width:100% !important;max-height:100% !important;}
    .print-setup-notice{display:none !important;}
  }
  @page{size:${W}mm ${H}mm;margin:0;}
  ${LABEL_PRINT_HARDENING}
  /* Screen-only setup guidance */
  .print-setup-notice{
    font-family:Arial,Helvetica,sans-serif;
    background:#fffbeb;
    border:1.5px solid #f59e0b;
    border-radius:6px;
    padding:10px 14px;
    margin:0 auto 14px auto;
    max-width:${W * 2}mm;
    font-size:11px;
    line-height:1.5;
    color:#444;
  }
  .print-setup-notice strong{color:#b45309;}
  .print-setup-notice ol{margin:4px 0 0 16px;padding:0;}
</style>
</head><body>
<div class="print-setup-notice">
  <strong>Configurações de impressão para etiquetadora Elgin (${W}&times;${H}&nbsp;mm)</strong>
  <ol>
    <li>No diálogo de impressão: <strong>Mais configurações &rarr; Tamanho do papel: Personalizado ${W}&times;${H}&nbsp;mm</strong></li>
    <li>Margens: <strong>Nenhuma (0)</strong> &nbsp;|&nbsp; Escala: <strong>100%</strong> &nbsp;|&nbsp; Desmarca &ldquo;Cabeçalhos e rodapés&rdquo;</li>
    <li>Na etiquetadora: selecione o papel correspondente (${W}&times;${H}&nbsp;mm) antes de imprimir.</li>
  </ol>
</div>
<main class="preview-shell">${labelHtml}</main>
${safeScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js')}
${safeScriptBlock(`
var _bcRetry=0;
function initBC(){
  if(typeof JsBarcode==='undefined'){_bcRetry++;if(_bcRetry>40){console.warn('JsBarcode CDN timeout');return;}setTimeout(initBC,150);return;}
  ${barcodeInits}
}
initBC();

// Wait for all images before allowing print
function waitForImages(){
  var imgs=document.querySelectorAll('img');
  var promises=[];
  imgs.forEach(function(img){
    if(!img.complete){
      promises.push(new Promise(function(resolve){
        img.onload=resolve;
        img.onerror=resolve;
        setTimeout(resolve,6000);
      }));
    }
  });
  return Promise.all(promises);
}
window._imagesReady=waitForImages();
`)}
</body></html>`;
}

/** Sanitize string for ZPL UTF-8 (^CI28): strip control chars, keep Portuguese accents. */
function zplAscii(str: string): string {
  return str
    .normalize('NFC')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Escapa um valor pra ir DENTRO de `^FD` (auditoria 2026-07-28 · T6).
 *
 * `zplAscii` tira só controles — `^` e `~` passavam INTEIROS, e eles são os
 * delimitadores de comando do ZPL: um produto chamado "SANDÁLIA ^XZ" encerrava
 * a etiqueta ali, e qualquer `^` no nome/cor podia emendar comando arbitrário
 * na impressora térmica. Cadastro é dado do usuário; não dá pra confiar.
 *
 * Estratégia: modo hexadecimal do ZPL (`^FH`), que traduz `_XX` em byte. Com
 * ele, `^` vira `_5E`, `~` vira `_7E` e o próprio `_` precisa virar `_5F`
 * (senão o firmware leria os dois caracteres seguintes como hex). O texto sai
 * IDÊNTICO no papel — só deixa de ser executável.
 *
 * ⚠ Só use o retorno em campo emitido com o prefixo `^FH` (ver ZPL_FH).
 */
export function zplField(value: unknown, maxLen: number): string {
  return zplAscii(String(value ?? ''))
    .slice(0, maxLen)
    .replace(/_/g, '_5F')
    .replace(/\^/g, '_5E')
    .replace(/~/g, '_7E');
}

/** Prefixo que liga o modo hex do `^FD` seguinte. Par obrigatório de zplField. */
const ZPL_FH = '^FH_';

/**
 * Generate a PDF of thermal labels (one label per page, sized exactly to the label).
 * Universal format — opens in any PDF viewer (Preview, Adobe, Chrome) and prints
 * directly. No driver or special software needed, unlike ZPL.
 *
 * Returns a Blob ready to download. Caller is responsible for triggering download.
 */
export async function buildThermalLabelsPdf(
  labels: {
    refCode: string;
    refName: string;
    mainMaterial: string;
    color: string;
    size: string;
    barcode: string;
    shoeCategory?: string;
    clientOrderNumber?: string;
    qty?: number;
    strapsLabel?: string;
    imageUrl?: string;
    /** True quando imageUrl é fallback — desenha a foto em escala de cinza
     *  e adiciona texto "FOTO GENÉRICA" junto à moldura. */
    imageIsFallback?: boolean;
  }[],
  dimensions = { width: 100, height: 30 },
  senderCnpj?: string,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: JsBarcode }] = await Promise.all([
    import('jspdf'),
    import('jsbarcode'),
  ]);

  const { width: W, height: H } = dimensions;
  const doc = new jsPDF({ orientation: W >= H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H], compress: true });

  // Layout constants (mm) — proportional to 100×30 reference
  const scale = H / 30;
  const padX = 1.5;
  const padY = 1.0;

  // Header strip (black band with ref code at top)
  const headerH = Math.max(H * 0.20, 4.5);
  // Footer strip (CNPJ / Brasil)
  const footerH = Math.max(H * 0.115, 3.0);

  // Helper: render barcode (CODE128) to a data URL via offscreen canvas
  const barcodeCache = new Map<string, string>();
  const renderBarcode = (value: string): string | null => {
    if (!value) return null;
    if (barcodeCache.has(value)) return barcodeCache.get(value)!;
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 80,
        displayValue: false,
        margin: 0,
      });
      const url = canvas.toDataURL('image/png');
      barcodeCache.set(value, url);
      return url;
    } catch {
      return null;
    }
  };

  // Helper: truncate text to fit a max width at the current font size
  const fitText = (text: string, maxWidthMm: number): string => {
    if (!text) return '';
    if (doc.getTextWidth(text) <= maxWidthMm) return text;
    let s = text;
    while (s.length > 1 && doc.getTextWidth(s + '…') > maxWidthMm) s = s.slice(0, -1);
    return s + '…';
  };

  // Pré-carrega as fotos de produto como PNG data URL — jsPDF precisa dos bytes
  // embutidos, não de URL remota. O bucket reference-images tem CORS aberto, então
  // a normalização via canvas não "tainta" o canvas. Falha de carga = etiqueta sem
  // foto (degrada suave, nunca quebra o PDF inteiro). Downscale p/ não inflar o PDF.
  const imageCache = new Map<string, { dataUrl: string; w: number; h: number }>();
  // Cache separado pras versões em escala de cinza (foto fallback). A mesma URL
  // pode ser fallback numa label e não noutra, então mantemos as duas variantes
  // e escolhemos no momento do desenho via l.imageIsFallback.
  const grayImageCache = new Map<string, { dataUrl: string; w: number; h: number }>();
  // URLs que aparecem ao menos uma vez como fallback → precisam da variante cinza.
  const fallbackUrls = new Set(
    labels.filter(l => l.imageIsFallback && l.imageUrl).map(l => l.imageUrl as string),
  );
  const uniqueImgUrls = [...new Set(labels.map(l => l.imageUrl).filter(Boolean))] as string[];
  await Promise.all(uniqueImgUrls.map(async (url) => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('img load failed'));
        im.src = url;
      });
      const maxDim = 260;
      const natW = img.naturalWidth || 200;
      const natH = img.naturalHeight || 200;
      const s = Math.min(1, maxDim / Math.max(natW, natH));
      const cw = Math.max(1, Math.round(natW * s));
      const ch = Math.max(1, Math.round(natH * s));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cw, ch);
      imageCache.set(url, { dataUrl: canvas.toDataURL('image/png'), w: cw, h: ch });

      // jsPDF não tem filtro grayscale nativo — geramos a versão cinza num 2º
      // canvas só quando essa URL é usada como foto fallback em alguma label.
      if (fallbackUrls.has(url)) {
        try {
          const grayCanvas = document.createElement('canvas');
          grayCanvas.width = cw; grayCanvas.height = ch;
          const gctx = grayCanvas.getContext('2d');
          if (gctx) {
            gctx.drawImage(img, 0, 0, cw, ch);
            const imgData = gctx.getImageData(0, 0, cw, ch);
            const px = imgData.data;
            for (let p = 0; p < px.length; p += 4) {
              const gray = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
              px[p] = px[p + 1] = px[p + 2] = gray;
            }
            gctx.putImageData(imgData, 0, 0);
            grayImageCache.set(url, { dataUrl: grayCanvas.toDataURL('image/png'), w: cw, h: ch });
          }
        } catch { /* canvas tainted ou getImageData bloqueado — usa colorida */ }
      }
    } catch { /* sem foto pra essa URL — segue sem */ }
  }));

  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (i > 0) doc.addPage([W, H], W >= H ? 'landscape' : 'portrait');

    // Outer border
    doc.setLineWidth(0.3);
    doc.setDrawColor(0);
    doc.rect(0.2, 0.2, W - 0.4, H - 0.4);

    // ─── Header (black band) — exibe nome do modelo (refName); SKU/refCode
    // não aparece mais em etiquetas (decisão do usuário em 2026-05). ───
    const headerName = (l.refName || l.refCode || '').toUpperCase();
    if (headerName) {
      doc.setFillColor(0, 0, 0);
      doc.rect(0, 0, W, headerH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7 * scale);
      const headerLeftX = padX;
      const headerTextY = headerH / 2 + (7 * scale) * 0.35 / 2.83;
      doc.text(fitText(headerName, W * 0.55), headerLeftX, headerTextY, { baseline: 'middle' });
      const headerRight = l.shoeCategory ? l.shoeCategory.toUpperCase() : (l.qty ? `× ${l.qty} PAR` : '');
      if (headerRight) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5 * scale);
        doc.text(fitText(headerRight, W * 0.4), W - padX, headerTextY, { baseline: 'middle', align: 'right' });
      }
      doc.setTextColor(0, 0, 0);
    }

    // ─── Body layout (2026-06-17): FOTO | DESCRIÇÃO | Nº | CÓDIGO ───
    const bodyTop = (headerName ? headerH : 0) + padY;
    const bodyBottom = H - footerH - padY * 0.5;
    const bodyH = bodyBottom - bodyTop;

    // Código de barras na direita — MENOR (largura reduzida).
    const barcodeW = Math.min(W * 0.20, 18);
    const barcodeX = W - padX - barcodeW;

    // Nº ENTRE a descrição e o código de barras — número GRANDE em chip preto
    // que ocupa toda a altura útil do corpo (bodyTop/bodyBottom já reservam a
    // margem de segurança da impressora) → número cresce pra cima e pra baixo.
    const sizeBoxW = Math.min(W * 0.16, 13);
    const sizeBoxX = barcodeX - 1.2 - sizeBoxW;
    const sizeBoxH = bodyH;
    const sizeBoxY = bodyTop;

    // Foto do produto na ESQUERDA — maior (ocupa mais da etiqueta). Foto
    // fallback: usa a variante cinza quando disponível (cai pra colorida se a
    // conversão tiver falhado por canvas tainted).
    const imgData = l.imageUrl
      ? ((l.imageIsFallback && grayImageCache.get(l.imageUrl)) || imageCache.get(l.imageUrl))
      : undefined;
    const imgFrameW = imgData ? Math.min(W * 0.22, 20) : 0;
    const imgFrameX = padX;

    const infoX = imgFrameX + (imgData ? imgFrameW + 1.2 : 0);
    const infoW = sizeBoxX - infoX - 1.2;

    // Size box (chip compacto)
    if (l.size) {
      doc.setFillColor(0, 0, 0);
      doc.roundedRect(sizeBoxX, sizeBoxY, sizeBoxW, sizeBoxH, 0.7, 0.7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(2.3 * scale);
      doc.text('Nº', sizeBoxX + sizeBoxW / 2, sizeBoxY + sizeBoxH * 0.18, { align: 'center', baseline: 'middle' });
      doc.setFont('helvetica', 'bold');
      const sizeFontPt = Math.min(sizeBoxH * 2.3, sizeBoxW * 1.6);
      doc.setFontSize(sizeFontPt);
      const sizeText = (l.size || '—').slice(0, 6);
      doc.text(sizeText, sizeBoxX + sizeBoxW / 2, sizeBoxY + sizeBoxH * 0.66, { align: 'center', baseline: 'middle' });
      doc.setTextColor(0, 0, 0);
    }

    // Foto do produto (contain dentro do frame, preserva proporção)
    if (imgData) {
      const ar = imgData.w / (imgData.h || 1);
      let drawW = imgFrameW;
      let drawH = imgFrameW / ar;
      if (drawH > bodyH) { drawH = bodyH; drawW = bodyH * ar; }
      const ix = imgFrameX + (imgFrameW - drawW) / 2;
      const iy = bodyTop + (bodyH - drawH) / 2;
      try { doc.addImage(imgData.dataUrl, 'PNG', ix, iy, drawW, drawH, undefined, 'FAST'); } catch { /* ignora foto que falhar */ }
      // Texto "FOTO GENÉRICA" junto à moldura quando a foto é fallback.
      if (l.imageIsFallback) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(3);
        doc.setTextColor(120, 120, 120);
        doc.text('FOTO GENÉRICA', imgFrameX, bodyTop + 0.4, { baseline: 'top' });
        doc.setTextColor(0, 0, 0);
      }
    }

    // Info column (ref name, color, material, pedido)
    let infoY = bodyTop + 0.5;
    const lineGap = bodyH / 5;

    // Ref name (largest)
    const nameFontPt = Math.max(7, 10 * scale);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(nameFontPt);
    const refDisplay = (l.refName || l.refCode || '—').toUpperCase();
    doc.text(fitText(refDisplay, infoW), infoX, infoY + lineGap * 0.6, { baseline: 'middle' });

    // Color
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.max(6, 6.5 * scale));
    const colorText = (l.color || '—').toUpperCase() + (l.qty ? `   ×${l.qty}` : '');
    doc.text(fitText(colorText, infoW), infoX, infoY + lineGap * 1.7, { baseline: 'middle' });

    // Material
    if (l.mainMaterial) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(Math.max(5, 5.5 * scale));
      doc.setTextColor(85, 85, 85);
      doc.text(fitText(l.mainMaterial.toUpperCase(), infoW), infoX, infoY + lineGap * 2.7, { baseline: 'middle' });
      doc.setTextColor(0, 0, 0);
    }

    // Client order number
    if (l.clientOrderNumber) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(Math.max(4.5, 5 * scale));
      doc.setTextColor(110, 110, 110);
      doc.text(fitText(`PED. ${l.clientOrderNumber}`, infoW), infoX, infoY + lineGap * 3.6, { baseline: 'middle' });
      doc.setTextColor(0, 0, 0);
    }

    // Separadores verticais: entre foto↔descrição e entre descrição↔Nº
    // (espelha as bordas da etiqueta HTML).
    doc.setLineWidth(0.15);
    doc.setDrawColor(0);
    if (imgData) doc.line(infoX - 0.6, bodyTop + 0.5, infoX - 0.6, bodyBottom - 0.5);
    doc.line(sizeBoxX - 0.6, bodyTop + 0.5, sizeBoxX - 0.6, bodyBottom - 0.5);

    // Barcode (right column)
    if (l.barcode) {
      const dataUrl = renderBarcode(l.barcode);
      if (dataUrl) {
        const bcH = Math.max(6, bodyH - 2);
        const bcY = bodyTop + (bodyH - bcH) / 2;
        doc.addImage(dataUrl, 'PNG', barcodeX, bcY, barcodeW, bcH, undefined, 'FAST');
      }
    }

    // ─── Footer (CNPJ) ───
    doc.setFillColor(245, 245, 245);
    doc.rect(0, H - footerH, W, footerH, 'F');
    doc.setLineWidth(0.2);
    doc.line(0, H - footerH, W, H - footerH);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.max(3.8, 4.2 * scale));
    const footerText = senderCnpj
      ? `FABRICADO NO BRASIL  ·  CNPJ ${senderCnpj}`
      : 'FABRICADO NO BRASIL';
    doc.text(fitText(footerText, W - padX * 2), W / 2, H - footerH / 2, { align: 'center', baseline: 'middle' });
  }

  return doc.output('blob');
}

/**
 * Generate ZPL2 code for Elgin thermal printers (203 DPI).
 * One ^XA...^XZ block per label — send directly to Elgin L42 Pro / VOX via:
 *   - Elgin Gerenciador de Impressora
 *   - Raw port 9100 / Generic-Text printer
 *   - .zpl file download then drag-to-printer
 *
 * Layout (landscape 100×30mm default):
 *   [SIZE BOX] | [REFERENCE / COLOR / MATERIAL] | [CODE128 BARCODE]
 */
export function buildThermalLabelsZpl(
  labels: {
    refCode: string;
    refName: string;
    mainMaterial: string;
    color: string;
    size: string;
    barcode: string;
  }[],
  dimensions = { width: 100, height: 30 }
): string {
  const DPI = 203;
  const dpMm = DPI / 25.4; // ≈ 7.987 dots per mm
  const W = Math.round(dimensions.width  * dpMm);
  const H = Math.round(dimensions.height * dpMm);

  // Horizontal padding (dots)
  const padX = Math.round(1.5 * dpMm);
  const padY = Math.round(1.2 * dpMm);
  const innerH = H - padY * 2;

  // Layout 2026-06-17: DESCRIÇÃO (esquerda) | Nº | CÓDIGO. ZPL não tem foto.
  // Info zone começa na esquerda.
  const infoX = padX;
  // Right zone: barcode — MENOR (~24% width).
  const barcodeW = Math.round(W * 0.24);
  const barcodeX = W - padX - barcodeW;
  // Size box ENTRE a descrição e o código de barras — número em destaque (~16% width).
  const sizeBoxW = Math.round(W * 0.16);
  const sizeBoxH = innerH;
  const sizeBoxX = barcodeX - Math.round(2.5 * dpMm) - sizeBoxW;
  const infoW = sizeBoxX - infoX - Math.round(2 * dpMm);

  // Barcode height: leave ~1.5mm headroom at top and bottom
  const barcodeH = innerH - Math.round(1 * dpMm);

  // Font heights (dots): scale proportionally to innerH
  const sizeFont  = Math.round(innerH * 0.78); // número em destaque (preenche a altura útil)
  const refFont   = Math.max(18, Math.round(innerH * 0.22));
  const colorFont = Math.max(16, Math.round(innerH * 0.18));
  const matFont   = Math.max(14, Math.round(innerH * 0.15));

  // ZPL font width ≈ 85% of height (condensed appearance)
  const fw = (h: number) => Math.round(h * 0.85);

  // Vertical positions for info rows (evenly spaced in innerH)
  const rowY = (frac: number) => padY + Math.round(innerH * frac);

  // Size number centered vertically
  const sizeCenterY = padY + Math.round((innerH - sizeFont) / 2);

  const blocks = labels.map(l => {
    // zplField + ^FH: `^` e `~` do cadastro viram hex e não comandam a
    // impressora (T6). Texto impresso é o mesmo; só perde o poder de executar.
    const refName  = zplField(l.refName || l.refCode || '', 32);
    const color    = zplField(l.color, 28);
    const material = zplField(l.mainMaterial, 28);
    const sizeVal  = zplField(l.size, 6);
    // CODE128 não tem modo hex — aqui a defesa é a allow-list de caracteres.
    const barcode  = (l.barcode || l.refCode || '').replace(/[^A-Za-z0-9 ._\-\/]/g, '').slice(0, 50);

    return [
      '^XA',
      `^PW${W}`,        // print width
      `^LL${H}`,        // label length
      `^LH0,0`,         // label home (origin)
      `^CI28`,          // encoding: UTF-8

      // ── Size box border (entre descrição e código) ──
      `^FO${sizeBoxX},${padY}^GB${sizeBoxW},${sizeBoxH},2,B,2^FS`,

      // ── Size number (centered in box) ──
      `^FO${sizeBoxX + 2},${sizeCenterY}^A0N,${sizeFont},${fw(sizeFont)}${ZPL_FH}^FD${sizeVal}^FS`,

      // ── Reference name ──
      refName  ? `^FO${infoX},${rowY(0.04)}^A0N,${refFont},${fw(refFont)}${ZPL_FH}^FD${refName}^FS`   : '',

      // ── Color ──
      color    ? `^FO${infoX},${rowY(0.36)}^A0N,${colorFont},${fw(colorFont)}${ZPL_FH}^FD${color}^FS` : '',

      // ── Material ──
      material ? `^FO${infoX},${rowY(0.62)}^A0N,${matFont},${fw(matFont)}${ZPL_FH}^FD${material}^FS`  : '',

      // ── Code128 barcode with human-readable text below ──
      barcode  ? [
        `^FO${barcodeX},${padY}`,
        `^BCN,${barcodeH},Y,N,N`,
        `^FD${barcode}^FS`,
      ].join('\n') : '',

      '^XZ',
    ].filter(Boolean).join('\n');
  });

  return blocks.join('\n\n');
}

/** Build HTML for individual box labels
 * Layout: A4 Retrato (210mm × 297mm), 6 etiquetas por página (2 colunas × 3 linhas)
 * Altura etiqueta: ~2cm conteúdo útil, largura página: 21cm
 */
export function buildIndividualLabelsHtml(items: LabelData[]): string {
  const labels: string[] = [];

  items.forEach(item => {
    item.sizes.forEach(s => {
      if (s.qty <= 0) return;
      for (let i = 0; i < s.qty; i++) {
        labels.push(`
          <div class="label-cell">
            ${item.imageUrl ? `
              <div style="height:30mm;display:flex;align-items:center;justify-content:center;margin-bottom:3px;overflow:hidden;">
                <img src="${escapeHtml(item.imageUrl)}" crossorigin="anonymous" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;filter:grayscale(100%);" onerror="this.parentElement.style.display='none'" />
              </div>
            ` : ''}
            <div style="text-align:center;margin-bottom:2px;">
              <p style="margin:0;font-size:13px;font-weight:bold;text-transform:uppercase;line-height:1.15;">${escapeHtml(item.refName || item.refCode || '—')}</p>
            </div>
            <div style="border-top:1px dashed #999;border-bottom:1px dashed #999;padding:3px 0;margin:2px 0;text-align:center;">
              <p style="margin:0;font-size:22px;font-weight:bold;font-family:'Courier New',monospace;line-height:1;">Nº ${escapeHtml(s.size)}</p>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;">
              <span><strong>COR:</strong> ${escapeHtml(item.color)}</span>
              <span>${fmt(item.salePrice)}</span>
            </div>
            ${item.category ? `<p style="text-align:center;font-size:7px;color:#888;margin:2px 0 0 0;">${escapeHtml(item.category)}</p>` : ''}
          </div>`);
      }
    });
  });

  // Agrupar em páginas de 6 etiquetas (2 colunas × 3 linhas)
  const LABELS_PER_PAGE = 6;
  const pages: string[] = [];
  for (let i = 0; i < labels.length; i += LABELS_PER_PAGE) {
    const pageLabels = labels.slice(i, i + LABELS_PER_PAGE);
    const isLast = i + LABELS_PER_PAGE >= labels.length;
    pages.push(`<div class="page${!isLast ? ' page-break' : ''}">${pageLabels.join('')}</div>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas - Caixa Individual</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;color:#000;margin:0;padding:0;}
      .page{
        width:210mm;
        height:297mm;
        padding:5mm;
        display:grid;
        grid-template-columns:1fr 1fr;
        grid-template-rows:repeat(3,1fr);
        gap:3mm;
        box-sizing:border-box;
      }
      .page-break{page-break-after:always;break-after:page;}
      .label-cell{
        border:1.5px solid #000;
        padding:4px 8px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        overflow:hidden;
        page-break-inside:avoid;
      }
      @media print{
        body{padding:0;margin:0;}
        /* Fix 2026-06-22: reafirma o teto da imagem no print (o
           LABEL_PRINT_HARDENING zera o max-height de toda imagem via
           "body *"), senão a foto vaza da célula sobre o texto da etiqueta. */
        .label-cell{overflow:hidden !important;}
        .label-cell img{max-width:100% !important;max-height:100% !important;}
      }
      @page{size:A4 portrait;margin:0;}
      ${LABEL_PRINT_HARDENING}
    </style></head><body>
    ${pages.join('')}
  </body></html>`;
}

/** @deprecated Use buildBoxIdentificationHtml instead. */
export function printBoxLabels(items: LabelData[]) {
  const boxItems: BoxIdentificationData[] = items.map((item, idx) => ({
    orderNumber: '',
    refCode: item.refCode,
    refName: item.refName,
    color: item.color,
    mainMaterial: item.material || '',
    boxNumber: idx + 1,
    totalBoxes: items.length,
    senderName: 'SQUAD SHOES',
    senderCnpj: '',
    grade: item.sizes,
  }));
  const html = buildBoxIdentificationHtml(boxItems);
  // Legacy: try to open in new window
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}

/** Build HTML for Premium Hangtags (Etiquetas de Pendurar) */
export function buildHangtagHtml(labels: {
  refCode: string; refName: string; color: string;
  size: string; barcode: string; qrcode?: string;
  composition?: string; careSymbols?: string[];
  brandName?: string; logoUrl?: string;
}[], dimensions = { width: 50, height: 80 }): string {
  const { width: W, height: H } = dimensions;
  
  const labelHtml = labels.map((l, idx) => {
    return `
    <div class="hangtag-page">
      <div class="ht-shell">
        <div class="ht-top">
          ${l.logoUrl
            ? `<img src="${escapeHtml(l.logoUrl)}" class="ht-brand-logo" crossorigin="anonymous" />`
            : `<span class="ht-brand-name">${escapeHtml(l.brandName || 'SQUAD')}</span>`
          }
        </div>
        <div class="ht-body">
          <div class="ht-size-block">
            <span class="ht-size-label">TAMANHO</span>
            <div class="ht-size-circle">${escapeHtml(l.size)}</div>
          </div>
          <div class="ht-info">
            <p class="ht-info-row"><span class="ht-info-label">Mod.</span> <span class="ht-info-value">${escapeHtml(l.refName || l.refCode || '—')}</span></p>
            <p class="ht-info-row"><span class="ht-info-label">Cor</span> <span class="ht-info-value">${escapeHtml(l.color)}</span></p>
          </div>
          ${l.composition ? `<div class="ht-composition">${escapeHtml(l.composition || 'SINTÉTICO / TÊXTIL / BORRACHA')}</div>` : ''}
          ${(l.careSymbols || []).length > 0 ? `<div class="ht-care-icons">${(l.careSymbols || []).map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="ht-footer">
          <div class="ht-barcode"><svg id="bc-ht-${idx}"></svg></div>
          ${l.qrcode ? `<div class="ht-qr" id="qr-ht-${idx}"></div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const barcodeInits = labels.map((l, idx) => {
    if (!l.barcode) return '';
    const code = sanitizeBarcode(l.barcode);
    return `JsBarcode("#bc-ht-${idx}","${code}",{format:"CODE128",width:1,height:30,displayValue:true,fontSize:10,margin:0});`;
  }).join('\n');

  const qrcodeInits = labels.map((l, idx) => {
    if (!l.qrcode) return '';
    // QR encoda URL — preserva `:` `?` `=` `&` `#` (jsStringLiteral), só barcode CODE128 usa sanitizeBarcode.
    const qr = jsStringLiteral(l.qrcode);
    return `new QRCode(document.getElementById("qr-ht-${idx}"), { text: ${qr}, width: 50, height: 50, correctLevel: QRCode.CorrectLevel.H });`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;600;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#e8e8e8;font-family:'Inter Tight',system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .hangtag-page{
    width:${W}mm;height:${H}mm;background:#fff;margin:8px auto;
    overflow:hidden;position:relative;page-break-after:always;
    border:1px solid #000;box-shadow:0 2px 12px rgba(0,0,0,0.15);
  }
  @media print{.hangtag-page{margin:0;border:1px solid #000;box-shadow:none;}body{background:#fff;}}
  .ht-shell{display:flex;flex-direction:column;height:100%;}
  .ht-top{
    background:#000;color:#fff;
    padding:3.5mm 4mm 3mm;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
  }
  .ht-brand-name{
    font-family:'Anton',Impact,sans-serif;
    font-size:14pt;font-weight:400;letter-spacing:6px;text-transform:uppercase;line-height:1;
  }
  .ht-brand-logo{
    max-width:80%;max-height:10mm;object-fit:contain;
    filter:brightness(0) invert(1);
  }
  .ht-body{
    flex:1;display:flex;flex-direction:column;align-items:center;
    padding:3.5mm 4mm 2mm;gap:2.5mm;
  }
  .ht-size-block{display:flex;flex-direction:column;align-items:center;gap:1mm;}
  .ht-size-label{
    font-family:'JetBrains Mono',monospace;
    font-size:5.5pt;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#777;
  }
  .ht-size-circle{
    width:14mm;height:14mm;border:2px solid #000;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:'Anton',Impact,sans-serif;
    font-weight:400;font-size:18pt;line-height:1;
  }
  .ht-info{
    width:100%;border-top:0.5px solid #ddd;border-bottom:0.5px solid #ddd;
    padding:2mm 0;
  }
  .ht-info-row{font-size:7pt;line-height:1.6;text-align:center;}
  .ht-info-label{font-family:'JetBrains Mono',monospace;color:#888;font-weight:600;text-transform:uppercase;font-size:6pt;letter-spacing:0.12em;margin-right:0.5mm;}
  .ht-info-value{font-weight:900;color:#000;text-transform:uppercase;}
  .ht-composition{
    font-size:5.5pt;color:#555;line-height:1.5;text-align:center;
    background:#f5f5f5;border-radius:0.8mm;padding:1.5mm 2mm;width:100%;
  }
  .ht-care-icons{
    font-family:monospace;font-size:9pt;
    display:flex;justify-content:center;gap:1.5mm;flex-wrap:wrap;
  }
  .ht-footer{
    width:100%;display:flex;flex-direction:column;align-items:center;
    gap:1mm;padding:1.5mm 3mm 2mm;border-top:0.5px solid #eee;flex-shrink:0;
  }
  .ht-barcode svg{max-width:100%;}
  .ht-qr{margin-top:0.5mm;}
  .ht-qr canvas,.ht-qr img{margin:0 auto;}
  ${LABEL_PRINT_HARDENING}
</style>
</head><body>
  ${labelHtml}
${safeScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js')}
${safeScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js')}
${safeScriptBlock(`
var _htRetry=0;
function initHtBC(){
  // Só dispara quando AMBOS os CDNs (JsBarcode + QRCode) carregaram. Antes
  // rodava direto em window.onload sem retry — se o CDN demorasse, etiqueta
  // saía sem código de barras/QR (E-M4).
  if(typeof JsBarcode==='undefined'||typeof QRCode==='undefined'){
    _htRetry++;if(_htRetry>40){return;}setTimeout(initHtBC,150);return;
  }
  try{
    ${barcodeInits}
    ${qrcodeInits}
  }catch(e){}
}
initHtBC();
`)}
</body></html>`;
}
