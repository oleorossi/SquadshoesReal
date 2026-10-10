/**
 * Entrega do PDF de etiqueta individual térmica (jsPDF client-side).
 *
 * O .zpl só serve no Gerenciador/DirectPrint da Elgin — o Windows não abre.
 * Este caminho devolve um PDF que o navegador abre e a impressora recebe
 * pelo driver (ajuste de posição/densidade incluso).
 *
 * No iOS cai no overlay canônico (`PdfDeliveryHost`); no desktop abre aba
 * ou baixa se o pop-up bloquear.
 */

import { deliverPdfBytes, isIosBrowser } from '@/lib/pdfDelivery';

export function pdfFileNameForThermalLabels(date = new Date()): string {
  return `etiquetas-${date.toISOString().slice(0, 10)}.pdf`;
}

function triggerPdfDownload(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export type ThermalPdfDeliveryResult = 'opened' | 'downloaded' | 'overlay';

/**
 * Entrega o PDF térmico.
 * - iOS: overlay canônico (`overlay`) — tela de ações (Compartilhar / Abrir no Safari).
 * - demais: abre aba (`opened`) ou download (`downloaded`).
 */
export async function openOrDownloadThermalLabelPdf(
  blob: Blob,
  fileName = pdfFileNameForThermalLabels(),
  opts?: { title?: string },
): Promise<ThermalPdfDeliveryResult> {
  if (isIosBrowser()) {
    // Response.arrayBuffer funciona onde Blob.arrayBuffer não existe (jsdom/vitest).
    const bytes = new Uint8Array(await new Response(blob).arrayBuffer());
    deliverPdfBytes(bytes, {
      filename: fileName,
      title: opts?.title || 'Etiquetas',
    });
    return 'overlay';
  }

  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) {
    // Mantém o blob vivo enquanto a aba carrega; revoga depois.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'opened';
  }

  triggerPdfDownload(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
