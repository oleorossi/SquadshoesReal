/**
 * Entrega do PDF de etiqueta individual térmica (jsPDF client-side).
 *
 * O .zpl só serve no Gerenciador/DirectPrint da Elgin — o Windows não abre.
 * Este caminho devolve um PDF que o navegador abre e a impressora recebe
 * pelo driver (ajuste de posição/densidade incluso).
 */

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

/** Abre o PDF numa aba; se o pop-up bloquear, cai no download. */
export async function openOrDownloadThermalLabelPdf(
  blob: Blob,
  fileName = pdfFileNameForThermalLabels(),
): Promise<'opened' | 'downloaded'> {
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
