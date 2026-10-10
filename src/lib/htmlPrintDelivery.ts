import { isIosBrowser } from '@/lib/iosDevice';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';

/**
 * Entrega um documento HTML:
 * - iOS → PDF no servidor + overlay Compartilhar/Salvar
 * - demais → aba com auto-print (comportamento legado)
 */
export async function deliverHtmlDocument(
  html: string,
  opts: { filename: string; title: string; landscape?: boolean },
): Promise<boolean> {
  const withoutAutoPrint = html.replace(
    /<script\b[^>]*>[\s\S]*?window\.print\s*\([\s\S]*?<\/script>/gi,
    '',
  );

  if (isIosBrowser()) {
    return printHtmlAsPdf(withoutAutoPrint, {
      filename: opts.filename,
      title: opts.title,
      landscape: opts.landscape,
    });
  }

  const target = openPrintTab();
  if (!target) return false;
  try {
    const withPrint = withoutAutoPrint.includes('</body>')
      ? withoutAutoPrint.replace(
        '</body>',
        '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},150);};</script></body>',
      )
      : `${withoutAutoPrint}<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},150);};</script>`;
    target.document.write(withPrint);
    target.document.close();
    return true;
  } catch {
    return false;
  }
}
