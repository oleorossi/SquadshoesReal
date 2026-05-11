import { escapeHtml } from './htmlUtils';

/**
 * Generates printable box labels (rótulos caixa externa), individual labels (etiquetas caixa individual)
 * and brand hangtags (etiquetas de marca/penduricalhos).
 * Based on industrial standard (Beira Rio / Molekinha pattern)
 * 
 * These functions return HTML strings — rendering is handled by the caller.
 */

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
  recipientCnpj?: string;
  recipientNumber?: string;
  recipientCode?: string;
  recipientAddress?: string;
  recipientCity?: string;
  recipientUf?: string;
  transporter?: string;
  clientOrderNumber?: string;
  shoeCategory?: string;
  mainMaterial?: string;
  grade: { size: string; qty: number }[];
  barcode?: string;
  imageUrl?: string;
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

/** Build HTML string for box identification labels (rótulo caixa externa)
 *
 * Layout no estilo Molekinha/Beira-Rio:
 *   Topo:    Logo + Barcode  |  QR  +  Bloco Cliente
 *   Sub:     Remessa/Talões  |  Rót Rem/Ped/Ped.Rem
 *   Stats:   Lote · Corrugado · Fáb · Grade · Total
 *   Mid:     Mod/Cor/Descrição  |  Imagem  |  Tamanho-grande
 *   Grade:   Tam: 29 30 31 32 ...  /  Qtd: 1 1 1 1 ...
 *   Rodapé:  Endereço remetente · CGC · Página X/Y
 *
 * Regra: campo vazio → linha/célula NÃO renderiza (em vez de aparecer "—").
 */
export function buildBoxIdentificationHtml(items: BoxIdentificationData[]): string {
  const labels = items.map((item, idx) => {
    const totalPairs = item.totalPairsInRemessa ?? item.grade.reduce((sum, s) => sum + s.qty, 0);
    const corrugadoPairs = item.grade.reduce((sum, s) => sum + s.qty, 0);

    // Tamanhos da grade renderizados como divs flex (NÃO usar <table>).
    // Tabelas em HTML têm regras próprias de page-break que ignoram o
    // break-inside:avoid do pai — foi o que causou a quebra entre TAM
    // e QTD vista em produção. Divs flex respeitam o avoid normalmente.
    const gradeCellWidth = item.grade.length > 0 ? `${100 / item.grade.length}%` : '0%';
    const gradeHead = item.grade.map(s =>
      `<div style="flex:1;text-align:center;padding:3px 4px;font-size:13px;font-weight:900;color:#000;">${s.size}</div>`
    ).join('');
    const gradeRow = item.grade.map(s =>
      `<div style="flex:1;text-align:center;padding:3px 4px;font-size:17px;font-weight:900;color:#000;">${s.qty}</div>`
    ).join('');
    void gradeCellWidth;

    const barcodeId = `box-bc-${idx}`;

    // Helpers de renderização condicional. Quando o valor é "falsy" (null,
    // undefined, '', 0), a célula INTEIRA é omitida (em vez de aparecer vazia).
    const fieldRow = (label: string, val: string | number | undefined, opts: { bold?: boolean; big?: boolean } = {}) => {
      if (val === undefined || val === null || val === '' || val === 0) return '';
      const bigStyle = opts.big ? 'font-size:18px;font-weight:900;' : 'font-weight:700;';
      const boldStyle = opts.bold ? 'font-weight:700;' : '';
      // label em #222 (cinza muito escuro) + bold pra ler bem em impressão.
      // Antes era #555 que sumia no toner.
      return `<div style="display:flex;gap:6px;line-height:1.3;${boldStyle}">
        <span style="color:#222;font-size:10px;font-weight:700;min-width:54px;">${label}</span>
        <span style="color:#000;${bigStyle}">${escapeHtml(String(val))}</span>
      </div>`;
    };

    const recipientBlock = [
      item.recipientCode ? fieldRow('Cliente:', item.recipientCode) : '',
      item.recipientAddress ? fieldRow('Endereço:', item.recipientAddress) : '',
      item.recipientCity ? fieldRow('Cidade:', item.recipientCity) : '',
      item.recipientUf ? fieldRow('UF:', item.recipientUf) : '',
      item.transporter ? fieldRow('Transp:', item.transporter) : '',
    ].filter(Boolean).join('');

    const pedidoLine = item.clientOrderNumber
      ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #555;display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
          <span style="font-size:11px;color:#000;font-weight:800;">Pedido:</span>
          <span style="font-size:20px;font-weight:900;letter-spacing:0.5px;color:#000;">${escapeHtml(item.clientOrderNumber)}</span>
        </div>`
      : '';

    // Bloco esquerdo do topo (logo + barcode) — altura limitada
    const headerLeft = `
      <div style="flex:1;padding:5px 10px;display:flex;flex-direction:column;justify-content:center;border-right:1.5px solid #000;overflow:hidden;">
        <p style="margin:0;font-size:16px;font-weight:900;letter-spacing:2px;text-transform:lowercase;line-height:1;">squad<span style="font-weight:400;">shoes</span></p>
        ${item.barcode ? `
          <svg id="${barcodeId}" style="margin-top:2px;max-width:100%;max-height:14mm;"></svg>
        ` : ''}
      </div>`;

    // Bloco direito do topo (QR + cliente)
    const headerRight = `
      <div style="width:88mm;padding:4px 8px;display:flex;gap:6px;align-items:flex-start;overflow:hidden;">
        <div style="width:16mm;height:16mm;flex-shrink:0;background:#fff;border:1px solid #555;display:flex;align-items:center;justify-content:center;font-size:7px;color:#333;text-align:center;line-height:1.1;font-weight:700;">
          ${item.clientOrderNumber || item.orderNumber}<br/>QR
        </div>
        <div style="flex:1;font-size:10px;color:#000;line-height:1.3;overflow:hidden;">
          ${recipientBlock || '<span style="color:#555;font-size:10px;font-style:italic;font-weight:600;">Sem dados do destinatário</span>'}
          ${pedidoLine}
        </div>
      </div>`;

    // Linha de identificadores secundários (Remessa, Talões, Rótulo, NF-e).
    // "Rót. Rem." era o mesmo valor de "Rót. Pedido" — removido a pedido
    // do usuário pra não duplicar a informação.
    // Labels em #222 + bold pra serem legíveis na impressão; valores em
    // preto puro + 12px bold.
    const subInfoCells = [
      item.remessa ? `<div style="padding:3px 10px;border-right:1px solid #000;"><strong style="font-size:10px;color:#222;font-weight:700;">Remessa:</strong> <span style="font-size:12px;font-weight:800;color:#000;margin-left:4px;">${escapeHtml(item.remessa)}</span></div>` : '',
      item.taloes ? `<div style="padding:3px 10px;border-right:1px solid #000;"><strong style="font-size:10px;color:#222;font-weight:700;">Talões:</strong> <span style="font-size:12px;font-weight:800;color:#000;margin-left:4px;">${item.taloes}</span></div>` : '',
      `<div style="padding:3px 10px;border-right:1px solid #000;"><strong style="font-size:10px;color:#222;font-weight:700;">Rót. Pedido:</strong> <span style="font-size:12px;font-weight:800;color:#000;margin-left:4px;">${item.boxNumber}/${item.totalBoxes}</span></div>`,
      item.nfe ? `<div style="padding:3px 10px;"><strong style="font-size:10px;color:#222;font-weight:700;">NF-e:</strong> <span style="font-size:12px;font-weight:800;color:#000;margin-left:4px;">${escapeHtml(item.nfe)}</span></div>` : '',
    ].filter(Boolean).join('');

    // Linha de stats (Lote, Corrugado, Fáb, OP, Total) — mesma regra: tudo
    // legível com label cinza-muito-escuro e valor preto bold.
    const statsCells = [
      item.lote ? `<div style="padding:3px 10px;border-right:1px solid #555;"><strong style="font-size:10px;color:#222;font-weight:700;">Lote:</strong> <span style="font-size:11px;font-weight:800;color:#000;margin-left:4px;">${escapeHtml(item.lote)}</span></div>` : '',
      `<div style="padding:3px 10px;border-right:1px solid #555;"><strong style="font-size:10px;color:#222;font-weight:700;">Corrugado:</strong> <span style="font-size:12px;font-weight:900;color:#000;margin-left:4px;">${corrugadoPairs} PRS</span></div>`,
      item.fab ? `<div style="padding:3px 10px;border-right:1px solid #555;"><strong style="font-size:10px;color:#222;font-weight:700;">Fáb:</strong> <span style="font-size:11px;font-weight:800;color:#000;margin-left:4px;">${escapeHtml(item.fab)}</span></div>` : '',
      `<div style="padding:3px 10px;border-right:1px solid #555;"><strong style="font-size:10px;color:#222;font-weight:700;">OP:</strong> <span style="font-size:11px;font-weight:800;color:#000;margin-left:4px;">${escapeHtml(item.orderNumber)}</span></div>`,
      `<div style="padding:3px 10px;"><strong style="font-size:10px;color:#222;font-weight:700;">Total:</strong> <span style="font-size:12px;font-weight:900;color:#000;margin-left:4px;">${totalPairs}</span></div>`,
    ].filter(Boolean).join('');

    // Bloco do produto: descrição + imagem + tamanho-grande.
    // Layout adaptativo: como o destinatário pode vir vazio (PV sem cliente),
    // a referência, cor e categoria sobem em peso/tamanho pra ocupar o
    // espaço disponível sem ficar desproporcional.
    // Cores: tudo preto puro ou cinza-muito-escuro (#222) — sem cinzas
    // claros que somem no toner laser/térmico.
    const productLeft = `
      <div style="flex:1;padding:10px 14px;display:flex;flex-direction:column;justify-content:center;gap:6px;">
        ${item.refCode ? `
          <div style="display:flex;align-items:baseline;gap:8px;line-height:1;">
            <span style="font-size:12px;color:#222;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">Ref.</span>
            <span style="font-size:26px;font-weight:900;letter-spacing:0.5px;color:#000;">${escapeHtml(item.refCode)}</span>
          </div>` : ''}
        ${item.color ? `
          <div style="display:flex;align-items:baseline;gap:8px;line-height:1;">
            <span style="font-size:12px;color:#222;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">Cor</span>
            <span style="font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#000;">${escapeHtml(item.color)}</span>
          </div>` : ''}
        ${item.shoeCategory ? `
          <div style="display:flex;align-items:baseline;gap:8px;line-height:1;">
            <span style="font-size:12px;color:#222;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">Tipo</span>
            <span style="font-size:15px;font-weight:700;color:#000;text-transform:uppercase;">${escapeHtml(item.shoeCategory)}</span>
          </div>` : ''}
        ${item.refName && item.refName !== item.refCode ? `
          <div style="font-size:11px;color:#222;font-weight:600;line-height:1.2;text-transform:uppercase;letter-spacing:0.3px;">${escapeHtml(item.refName)}</div>` : ''}
        ${item.strapsLabel ? `<div style="font-size:10px;color:#000;font-weight:600;line-height:1.2;"><strong>TIRAS:</strong> ${escapeHtml(item.strapsLabel.replace(/\|/g, ' — ').replace(/:/g, ': '))}</div>` : ''}
        ${item.mainMaterial ? `<div style="font-size:10px;color:#222;font-weight:600;font-style:italic;text-transform:uppercase;line-height:1.2;">${escapeHtml(item.mainMaterial)}</div>` : ''}
      </div>`;

    const sizeRangeBig = item.sizeRangeLabel
      ? `<div style="width:30mm;display:flex;align-items:center;justify-content:center;border-left:1px solid #444;">
          <span style="font-size:34px;font-weight:900;line-height:1;letter-spacing:-1.5px;color:#000;">${escapeHtml(item.sizeRangeLabel)}</span>
        </div>` : '';

    const productImage = item.imageUrl ? `
      <div style="width:34mm;border-left:1px solid #444;padding:3px;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden;">
        <img src="${item.imageUrl}" crossorigin="anonymous" style="max-width:30mm;max-height:58mm;width:auto;height:auto;object-fit:contain;" onerror="this.style.display='none'" />
      </div>` : '';

    // Rodapé: endereço remetente + CGC + página
    const footerParts = [
      item.senderAddress ? escapeHtml(item.senderAddress) : '',
      item.senderCnpj ? `CGC: ${escapeHtml(item.senderCnpj)}` : '',
      (item.pageNumber && item.pageTotal) ? `Página ${item.pageNumber} de ${item.pageTotal}` : '',
    ].filter(Boolean).join(' · ');

    // Alturas hardcoded em cada seção. Total = 135mm = altura do label-box.
    // Sem flex:1 (que cresceria indefinidamente). Cada caixa tem altura
    // exata + overflow:hidden — o engine de impressão não tem mais como
    // empurrar conteúdo pra outra página A4.
    return `
      <div class="label-box">
        <div style="height:30mm;display:flex;border-bottom:1.5px solid #000;overflow:hidden;">
          ${headerLeft}
          ${headerRight}
        </div>
        <div style="height:7mm;display:flex;border-bottom:1px solid #000;overflow:hidden;">
          ${subInfoCells}
        </div>
        <div style="height:7mm;display:flex;border-bottom:1px solid #000;background:#f5f5f5;overflow:hidden;">
          ${statsCells}
        </div>
        <div style="height:65mm;display:flex;border-bottom:1px solid #000;overflow:hidden;">
          ${productLeft}
          ${productImage}
          ${sizeRangeBig}
        </div>
        ${item.grade.length > 0 ? `
        <div class="grade-block" style="height:18mm;padding:3px 10px;border-bottom:1px solid #000;overflow:hidden;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column;justify-content:center;gap:2px;">
          <div style="display:flex;align-items:center;">
            <div style="width:48px;font-size:11px;color:#000;font-weight:800;padding-right:8px;text-transform:uppercase;letter-spacing:0.4px;">Tam.</div>
            <div style="flex:1;display:flex;">${gradeHead}</div>
          </div>
          <div style="display:flex;align-items:center;">
            <div style="width:48px;font-size:11px;color:#000;font-weight:800;padding-right:8px;text-transform:uppercase;letter-spacing:0.4px;">Qtd.</div>
            <div style="flex:1;display:flex;">${gradeRow}</div>
          </div>
        </div>` : '<div style="height:18mm;border-bottom:1px solid #000;"></div>'}
        <div class="footer-block" style="height:8mm;padding:3px 10px;font-size:9.5px;color:#000;font-weight:600;text-align:center;overflow:hidden;display:flex;align-items:center;justify-content:center;">${footerParts || '&nbsp;'}</div>
      </div>`;
  });

  // Group labels in pairs (2 per A4 page) — uma folha A4 = 2 caixas.
  // Ex.: 100 caixas → 50 folhas. Math.ceil cobre o caso ímpar (última
  // folha com 1 só).
  const pages: string[] = [];
  for (let i = 0; i < labels.length; i += 2) {
    const first = labels[i];
    const second = labels[i + 1] || '';
    const isLastPage = i + 2 >= labels.length;
    pages.push(`<div class="page-container${!isLastPage ? ' page-break' : ''}">${first}${second}</div>`);
  }
  const totalPages = Math.ceil(labels.length / 2);

  // Build barcode init script
  const barcodeInits = items.map((item, idx) => {
    if (!item.barcode) return '';
    const bc = item.barcode.replace(/"/g, '\\"');
    const fmtCode = item.barcode.length === 13 ? 'EAN13' : 'CODE128';
    return `try{JsBarcode("#box-bc-${idx}","${bc}",{format:"${fmtCode}",width:1.6,height:40,displayValue:true,fontSize:12,margin:3,font:"monospace"});}catch(e){try{JsBarcode("#box-bc-${idx}","${bc}",{format:"CODE128",width:1.6,height:40,displayValue:true,fontSize:12,margin:3,font:"monospace"});}catch(e2){}}`;
  }).filter(Boolean).join('\n');

  // Collect unique image URLs for preloading
  const uniqueImageUrls = [...new Set(items.map(i => i.imageUrl).filter(Boolean))];
  const preloadLinks = uniqueImageUrls.map(u => `<link rel="preload" as="image" href="${u}" crossorigin="anonymous" />`).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Rótulo de Identificação de Caixa</title>
${preloadLinks}
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,Helvetica,sans-serif;color:#000;padding:16px 10px;background:#e8e8e8;}
@media print{body{background:#fff;padding:0;}}
.label-box{
  width:100%;font-family:Arial,Helvetica,sans-serif;color:#000;
  border:1.5px solid #000;padding:0;box-sizing:border-box;
  display:flex;flex-direction:column;
  /* Belt-and-suspenders: TODA forma de break-inside disponível */
  page-break-inside:avoid !important;
  break-inside:avoid-page !important;
  border-radius:0.5mm;overflow:hidden;height:135mm;
}
/* Cada bloco interno respeita seu espaço. break-inside:avoid em tudo
   pra qualquer sub-elemento que tenta quebrar (ex.: grade-block) ficar
   inteiro na mesma página do label. */
.label-box > *{overflow:hidden;page-break-inside:avoid;break-inside:avoid;}
.page-container{
  width:198mm;margin:0 auto 8mm;display:flex;flex-direction:column;gap:3mm;box-sizing:border-box;
}
.page-container.page-break{break-after:page;page-break-after:always;}
/* page-container sem .page-break (= a última) NÃO tem break-after, evitando
   folha em branco. Não usamos :last-child porque o print-footer fica DEPOIS
   no DOM (mesmo escondido no print). */
.page-container:not(.page-break){break-after:avoid;page-break-after:avoid;margin-bottom:0;}
.print-footer{
  max-width:190mm;margin:24px auto 12px;padding:18px 24px;
  background:#fff;border:1px solid #d4d4d4;border-radius:6px;
  font-family:Arial,Helvetica,sans-serif;text-align:center;
  box-shadow:0 1px 3px rgba(0,0,0,0.05);
}
.print-footer__title{font-size:12px;font-weight:700;color:#111;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;}
.print-footer__sub{font-size:11px;color:#555;margin-bottom:14px;}
.print-footer__btn{
  display:inline-block;padding:9px 22px;background:#0f172a;color:#fff;
  text-decoration:none;border:none;border-radius:4px;cursor:pointer;
  font-size:12px;font-weight:600;letter-spacing:0.3px;font-family:inherit;
}
.print-footer__btn:hover{background:#1e293b;}
.print-footer__btn--ghost{background:#fff;color:#0f172a;border:1px solid #0f172a;margin-left:8px;}
.print-footer__btn--ghost:hover{background:#f5f5f5;}
@media print{
  body{padding:0;margin:0;}
  /* A4 portrait = 297mm. Com @page margin 5mm × 2 = 287mm úteis.
     Soma das seções hardcoded do label = 135mm (30+7+7+65+18+8).
     2 labels × 135mm + 3mm gap = 273mm. page-container = 275mm
     pra dar 2mm de "respiro" final. */
  .page-container{width:100%;height:275mm;margin:0;}
  .label-box{height:135mm;}
  /* Tudo dentro do label respeita break-inside em print também */
  .label-box,
  .label-box *{
    page-break-inside:avoid !important;
    break-inside:avoid !important;
  }
  /* Footer tem que sumir COMPLETAMENTE em impressão (sem ocupar nem layout
     nem fluxo de página). Várias regras em conjunto pra fechar todos os
     caminhos: display:none deveria bastar, mas alguns navegadores ainda
     reservam quebra de página, então zeramos tudo. */
  .print-footer,
  .print-footer *{
    display:none !important;
    visibility:hidden !important;
    height:0 !important;
    max-height:0 !important;
    width:0 !important;
    max-width:0 !important;
    margin:0 !important;
    padding:0 !important;
    border:0 !important;
    page-break-before:avoid !important;
    page-break-inside:avoid !important;
    page-break-after:avoid !important;
    break-before:avoid !important;
    break-inside:avoid !important;
    break-after:avoid !important;
  }
}
@page{size:A4;margin:5mm 6mm;}
</style>
</head><body>${pages.join('')}
<div class="print-footer">
  <p class="print-footer__title">${labels.length} etiqueta${labels.length === 1 ? '' : 's'} · ${totalPages} folha${totalPages === 1 ? '' : 's'} A4</p>
  <p class="print-footer__sub">Cada folha A4 imprime 2 etiquetas (= 2 caixas). Confira o layout antes de mandar pra impressão.</p>
  <a class="print-footer__btn" href="javascript:window.print()">Imprimir agora</a>
  <a class="print-footer__btn print-footer__btn--ghost" href="javascript:window.close()">Voltar e ajustar</a>
</div>
${safeScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js')}
${safeScriptBlock(`
var _bcRetry=0;
function initBC(){
  if(typeof JsBarcode==='undefined'){_bcRetry++;if(_bcRetry>40){console.warn('JsBarcode CDN timeout');return;}setTimeout(initBC,150);return;}
  ${barcodeInits}
}
initBC();

// Wait for all images to load before allowing print
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
  fontSizeSize: 15,
  fontSizePed: 5.5,
  imgWidthMm: 12,
  imgHeightMm: 16,
  leftColumnMm: 20,
  rightColumnMm: 24,
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
  const gapCount = (hasLeftColumn ? 1 : 0) + (hasRightColumn ? 1 : 0);
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
    const displayReference = l.refName || l.refCode || '—';
    // Code shown in header if header is enabled; fallback to info column otherwise
    const detailReference = !showHeader && c.showCode && l.refCode && l.refCode !== displayReference ? l.refCode : '';

    const hasHeader = showHeader && !!l.refCode;
    const thisShellTopMm = hasHeader ? shellTopMm : safePadY;

    const headerHtml = hasHeader ? `
      <header class="lbl-hdr">
        <span class="lbl-hdr-code">${escapeHtml(l.refCode)}</span>
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
        ${hasLeftColumn ? `<div class="label-left${c.showImage && c.showSize ? ' has-size' : ''}">
          ${c.showSize ? `<div class="label-size-box"><span class="sz-nr">Nº</span>${l.size || '—'}</div>` : ''}
          ${c.showImage ? `<div class="label-image-frame">${l.imageUrl
            ? `<img src="${l.imageUrl}" class="label-img" crossorigin="anonymous" onerror="this.onerror=null;this.style.display='none'" />`
            : `<img src="${logoUrl}" class="label-img" crossorigin="anonymous" alt="Logo" />`}</div>` : ''}
        </div>` : ''}

        <div class="label-info">
          <p class="info-reference">${escapeHtml(displayReference)}</p>
          ${detailReference ? `<p class="info-code">${escapeHtml(detailReference)}</p>` : ''}
          <p class="info-color"><span class="color-dot">▪</span>${escapeHtml(l.color || '—')}${l.strapsLabel ? ` <span class="info-straps">| ${escapeHtml(l.strapsLabel.replace(/\|/g, ' · ').replace(/:/g, ': '))}</span>` : ''}${!showHeader && l.qty ? ` <strong class="info-qty">×${l.qty}</strong>` : ''}</p>
          ${c.showMaterial && l.mainMaterial ? `<p class="info-material">${escapeHtml(l.mainMaterial)}</p>` : ''}
          ${c.showPedido && l.clientOrderNumber ? `<p class="info-pedido">PED. ${escapeHtml(l.clientOrderNumber)}</p>` : ''}
          ${!showHeader && c.showCategory && l.shoeCategory ? `<p class="info-category">${escapeHtml(l.shoeCategory)}</p>` : ''}
        </div>

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
    const code = l.barcode.replace(/"/g, '\\"');
    return `try{var el=document.querySelector("#bc-${idx}");JsBarcode(el,"${code}",{format:"CODE128",width:0.8,height:${barcodeHeightPx},displayValue:false,margin:0});if(el){el.removeAttribute("width");el.removeAttribute("height");el.style.width="100%";el.style.height="auto";}}catch(e){}`;
  }).filter(Boolean).join('\n');

  const cols: string[] = [];
  if (hasLeftColumn) cols.push(`${leftColumnMm}mm`);
  cols.push(`1fr`);
  if (hasRightColumn) cols.push(`${rightColumnMm}mm`);
  const gridCols = cols.join(' ');

  // Collect unique image URLs for preloading
  const uniqueImageUrls = [...new Set(labels.map(l => l.imageUrl).filter(Boolean))];
  const preloadLinks = uniqueImageUrls.map(u => `<link rel="preload" as="image" href="${u}" crossorigin="anonymous" />`).join('\n');

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
  .label-left{
    height:100%;
    min-width:0;
    max-width:100%;
    display:grid;
    align-items:center;
    overflow:hidden;
  }
  .label-left.has-size{
    grid-template-columns:1fr auto;
    column-gap:0.8mm;
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
    width:${Math.max(sizeBoxWidthMm, 9).toFixed(1)}mm;
    padding:0.8mm 0.5mm;
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
  .color-dot{
    display:inline-block;
    margin-right:0.5mm;
    font-size:${+(3.5 * scaleH).toFixed(1)}pt;
    line-height:1;
    vertical-align:middle;
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
    ${hasLeftColumn ? 'border-left:0.22mm solid #000;' : ''}
    ${hasRightColumn ? 'border-right:0.22mm solid #000;' : ''}
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
    .print-setup-notice{display:none !important;}
  }
  @page{size:${W}mm ${H}mm;margin:0;}
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

  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (i > 0) doc.addPage([W, H], W >= H ? 'landscape' : 'portrait');

    // Outer border
    doc.setLineWidth(0.3);
    doc.setDrawColor(0);
    doc.rect(0.2, 0.2, W - 0.4, H - 0.4);

    // ─── Header (black band) ───
    if (l.refCode) {
      doc.setFillColor(0, 0, 0);
      doc.rect(0, 0, W, headerH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7 * scale);
      const refCodeText = (l.refCode || '').toUpperCase();
      const headerLeftX = padX;
      const headerTextY = headerH / 2 + (7 * scale) * 0.35 / 2.83;
      doc.text(fitText(refCodeText, W * 0.55), headerLeftX, headerTextY, { baseline: 'middle' });
      const headerRight = l.shoeCategory ? l.shoeCategory.toUpperCase() : (l.qty ? `× ${l.qty} PAR` : '');
      if (headerRight) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5 * scale);
        doc.text(fitText(headerRight, W * 0.4), W - padX, headerTextY, { baseline: 'middle', align: 'right' });
      }
      doc.setTextColor(0, 0, 0);
    }

    // ─── Body layout: size box | info | barcode ───
    const bodyTop = (l.refCode ? headerH : 0) + padY;
    const bodyBottom = H - footerH - padY * 0.5;
    const bodyH = bodyBottom - bodyTop;

    const sizeBoxW = Math.min(W * 0.16, 14);
    const sizeBoxX = padX;
    const sizeBoxY = bodyTop;

    const barcodeW = Math.min(W * 0.32, 32);
    const barcodeX = W - padX - barcodeW;

    const infoX = sizeBoxX + sizeBoxW + 1.2;
    const infoW = barcodeX - infoX - 1.2;

    // Size box
    if (l.size) {
      doc.setFillColor(0, 0, 0);
      doc.roundedRect(sizeBoxX, sizeBoxY, sizeBoxW, bodyH, 0.8, 0.8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(2.5 * scale);
      doc.text('Nº', sizeBoxX + sizeBoxW / 2, sizeBoxY + bodyH * 0.25, { align: 'center', baseline: 'middle' });
      doc.setFont('helvetica', 'bold');
      const sizeFontPt = Math.min(bodyH * 2.5, sizeBoxW * 1.6);
      doc.setFontSize(sizeFontPt);
      const sizeText = (l.size || '—').slice(0, 6);
      doc.text(sizeText, sizeBoxX + sizeBoxW / 2, sizeBoxY + bodyH * 0.62, { align: 'center', baseline: 'middle' });
      doc.setTextColor(0, 0, 0);
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
    const colorText = '■ ' + (l.color || '—').toUpperCase() + (l.qty ? `   ×${l.qty}` : '');
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

    // Vertical separator before barcode
    doc.setLineWidth(0.15);
    doc.setDrawColor(0);
    doc.line(barcodeX - 0.6, bodyTop + 0.5, barcodeX - 0.6, bodyBottom - 0.5);

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

  // Left zone: size box (~18% width)
  const sizeBoxW = Math.round(W * 0.18);
  const sizeBoxH = innerH;
  // Info zone starts after size box + divider gap
  const infoX = padX + sizeBoxW + Math.round(2.5 * dpMm);
  // Right zone: barcode (~34% width)
  const barcodeW = Math.round(W * 0.34);
  const barcodeX = W - padX - barcodeW;
  const infoW = barcodeX - infoX - Math.round(2 * dpMm);

  // Barcode height: leave ~1.5mm headroom at top and bottom
  const barcodeH = innerH - Math.round(1 * dpMm);

  // Font heights (dots): scale proportionally to innerH
  const sizeFont  = Math.round(innerH * 0.72); // dominant size number
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
    const refName  = zplAscii(l.refName  || l.refCode  || '').slice(0, 32);
    const color    = zplAscii(l.color    || '').slice(0, 28);
    const material = zplAscii(l.mainMaterial || '').slice(0, 28);
    const sizeVal  = zplAscii(l.size     || '').slice(0, 6);
    const barcode  = (l.barcode || l.refCode || '').replace(/[^\x20-\x7E]/g, '').slice(0, 50);

    return [
      '^XA',
      `^PW${W}`,        // print width
      `^LL${H}`,        // label length
      `^LH0,0`,         // label home (origin)
      `^CI28`,          // encoding: UTF-8

      // ── Size box border ──
      `^FO${padX},${padY}^GB${sizeBoxW},${sizeBoxH},2,B,2^FS`,

      // ── Size number (centered in box) ──
      `^FO${padX + 2},${sizeCenterY}^A0N,${sizeFont},${fw(sizeFont)}^FD${sizeVal}^FS`,

      // ── Vertical divider before barcode ──
      `^FO${barcodeX - Math.round(2 * dpMm)},${padY}^GB2,${sizeBoxH},2^FS`,

      // ── Reference name ──
      refName  ? `^FO${infoX},${rowY(0.04)}^A0N,${refFont},${fw(refFont)}^FD${refName}^FS`   : '',

      // ── Color ──
      color    ? `^FO${infoX},${rowY(0.36)}^A0N,${colorFont},${fw(colorFont)}^FD${color}^FS` : '',

      // ── Material ──
      material ? `^FO${infoX},${rowY(0.62)}^A0N,${matFont},${fw(matFont)}^FD${material}^FS`  : '',

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
              <div style="text-align:center;margin-bottom:3px;">
                <img src="${item.imageUrl}" crossorigin="anonymous" style="max-width:60px;max-height:35px;object-fit:contain;filter:grayscale(100%);" onerror="this.parentElement.style.display='none'" />
              </div>
            ` : ''}
            <div style="text-align:center;margin-bottom:2px;">
              <p style="margin:0;font-size:11px;font-weight:bold;text-transform:uppercase;line-height:1.1;">${escapeHtml(item.refName)}</p>
              ${item.refCode ? `<p style="margin:0;font-size:8px;color:#555;">REF: ${escapeHtml(item.refCode)}</p>` : ''}
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
        padding:6px 10px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        overflow:hidden;
        page-break-inside:avoid;
      }
      @media print{
        body{padding:0;margin:0;}
      }
      @page{size:A4 portrait;margin:0;}
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
            ? `<img src="${l.logoUrl}" class="ht-brand-logo" crossorigin="anonymous" />`
            : `<span class="ht-brand-name">${escapeHtml(l.brandName || 'SQUAD')}</span>`
          }
        </div>
        <div class="ht-body">
          <div class="ht-size-block">
            <span class="ht-size-label">TAMANHO</span>
            <div class="ht-size-circle">${escapeHtml(l.size)}</div>
          </div>
          <div class="ht-info">
            <p class="ht-info-row"><span class="ht-info-label">Mod.</span> <span class="ht-info-value">${escapeHtml(l.refCode)}</span></p>
            <p class="ht-info-row"><span class="ht-info-label">Cor</span> <span class="ht-info-value">${escapeHtml(l.color)}</span></p>
          </div>
          ${l.composition ? `<div class="ht-composition">${escapeHtml(l.composition || 'SINTÉTICO / TÊXTIL / BORRACHA')}</div>` : ''}
          ${(l.careSymbols || []).length > 0 ? `<div class="ht-care-icons">${(l.careSymbols || []).map(s => `<span>${s}</span>`).join('')}</div>` : ''}
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
    return `JsBarcode("#bc-ht-${idx}","${l.barcode}",{format:"CODE128",width:1,height:30,displayValue:true,fontSize:10,margin:0});`;
  }).join('\n');

  const qrcodeInits = labels.map((l, idx) => {
    if (!l.qrcode) return '';
    return `new QRCode(document.getElementById("qr-ht-${idx}"), { text: "${l.qrcode}", width: 50, height: 50, correctLevel: QRCode.CorrectLevel.H });`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#e8e8e8;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
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
    font-size:13pt;font-weight:900;letter-spacing:4px;text-transform:uppercase;line-height:1;
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
    font-size:5.5pt;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#777;
  }
  .ht-size-circle{
    width:14mm;height:14mm;border:2px solid #000;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-weight:900;font-size:15pt;line-height:1;
  }
  .ht-info{
    width:100%;border-top:0.5px solid #ddd;border-bottom:0.5px solid #ddd;
    padding:2mm 0;
  }
  .ht-info-row{font-size:7pt;line-height:1.6;text-align:center;}
  .ht-info-label{color:#888;font-weight:500;text-transform:uppercase;font-size:6pt;margin-right:0.5mm;}
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
</style>
</head><body>
  ${labelHtml}
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    window.onload = function() {
      ${barcodeInits}
      ${qrcodeInits}
    }
  </script>
</body></html>`;
}
