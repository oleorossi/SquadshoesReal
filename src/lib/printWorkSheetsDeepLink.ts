/**
 * Deep-links de /imprimir-fichas.
 *
 * Os cartões de fardo são calculados no cliente a partir da grade da OP
 * (sem escrita no banco). `format=fardo` abre a prévia já no formato Fardo,
 * com os cartões da Palmilha prontos para recortar.
 */

export type PrintWorkSheetsFormat = 'fardo' | 'montador' | 'caixa';

export function parsePrintFormatParam(
  raw: string | null | undefined,
): PrintWorkSheetsFormat | null {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'fardo' || v === 'cartao' || v === 'cartao-fisico' || v === 'cartão') {
    return 'fardo';
  }
  if (v === 'montador') return 'montador';
  if (v === 'caixa' || v === 'caixa-transporte') return 'caixa';
  return null;
}

/** Caminho direto: prévia dos cartões de palmilha da(s) OP(s), já prontos. */
export function fardoPrintPath(orderIds: readonly string[]): string {
  const ids = orderIds.map((id) => String(id).trim()).filter(Boolean).join(',');
  return `/imprimir-fichas?orderIds=${ids}&sectors=${encodeURIComponent('Palmilha')}&format=fardo`;
}

/** Caminho direto: prévia dos cartões de caixa de palmilha da(s) OP(s), já prontos. */
export function caixaPrintPath(orderIds: readonly string[]): string {
  const ids = orderIds.map((id) => String(id).trim()).filter(Boolean).join(',');
  return `/imprimir-fichas?orderIds=${ids}&sectors=${encodeURIComponent('Palmilha')}&format=caixa`;
}
