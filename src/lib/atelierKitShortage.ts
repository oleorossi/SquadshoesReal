/**
 * Falta de material do kit do Ateliê (débito do corte com pending_qty > 0).
 * Fundo vermelho na Fila / Relatório — o lote continua na fila.
 */

export interface AtelierDebitLike {
  component?: string | null;
  pending_qty?: number | null;
  product_name?: string | null;
}

/** Qualquer linha do kit com falta após o corte. */
export function lotHasKitShortage(debits: readonly AtelierDebitLike[] | null | undefined): boolean {
  if (!debits?.length) return false;
  return debits.some((d) => Number(d.pending_qty) > 0);
}

export function kitShortageLabels(debits: readonly AtelierDebitLike[] | null | undefined): string[] {
  if (!debits?.length) return [];
  return debits
    .filter((d) => Number(d.pending_qty) > 0)
    .map((d) => {
      const name = d.product_name?.trim() || d.component || 'Material';
      const qty = Number(d.pending_qty);
      return Number.isFinite(qty) ? `${name} ${qty}` : name;
    });
}
