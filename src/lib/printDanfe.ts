// printDanfe — imprime / salva como PDF um nó já renderizado do DanfeView.
import { applyPrintSandbox } from '@/lib/htmlUtils';
//
// Usa um <iframe> oculto em vez de window.open: não é bloqueado por
// pop-up blocker e isola o conteúdo do resto do app (o DanfeView usa só
// inline styles, então o outerHTML reproduz fiel no iframe). O código de
// barras (SVG do JsBarcode) já está no DOM e é capturado pelo outerHTML.

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;600;700;800&family=JetBrains+Mono&display=swap';

export function printDanfeNode(node: HTMLElement | null, title = 'DANFE'): void {
  if (!node) return;
  const iframe = document.createElement('iframe');
  applyPrintSandbox(iframe); // T6: HTML de impressão sem <script> (ver htmlUtils)
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  } as CSSStyleDeclaration);
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  const safeTitle = title.replace(/[<>]/g, '');
  doc.open();
  doc.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title>` +
    `<link href="${FONTS_HREF}" rel="stylesheet">` +
    `<style>` +
    `@page{size:A4;margin:8mm}` +
    `html,body{margin:0;padding:0;background:#fff;` +
    `-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `</style></head><body>${node.outerHTML}</body></html>`
  );
  doc.close();

  const cleanup = () => { try { iframe.remove(); } catch { /* noop */ } };
  const doPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // remove depois que o diálogo de impressão foi disparado
      setTimeout(cleanup, 1500);
    }
  };

  // dá um tempo pras fontes carregarem antes de imprimir
  if (iframe.contentWindow && 'requestAnimationFrame' in iframe.contentWindow) {
    setTimeout(doPrint, 450);
  } else {
    setTimeout(doPrint, 600);
  }
}
