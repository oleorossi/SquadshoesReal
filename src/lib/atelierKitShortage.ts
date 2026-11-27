/**
 * Falta de material do kit do Ateliê (débito do corte com pending_qty > 0).
 * Fundo vermelho na Fila / Relatório — o lote continua na fila.
 */

export interface AtelierDebitLike {
  component?: string | null;
  pending_qty?: number | null;
  product_name?: string | null;
  color?: string | null;
  unit?: string | null;
  available_qty?: number | null;
}

function formatKitQty(qty: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(qty);
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
      const name = [d.product_name?.trim(), d.color?.trim()].filter(Boolean).join(' ')
        || d.component?.trim()
        || 'Material';
      const qty = Number(d.pending_qty);
      const unit = d.unit?.trim();
      const qtyText = Number.isFinite(qty)
        ? `${formatKitQty(qty)}${unit ? ` ${unit}` : ''}`
        : '';
      const stock = d.available_qty == null
        ? ''
        : ` (estoque ${formatKitQty(Number(d.available_qty) || 0)}${unit ? ` ${unit}` : ''})`;
      return qtyText ? `${name}: faltam ${qtyText}${stock}` : name;
    });
}

export function kitShortageBlockMessage(debits: readonly AtelierDebitLike[] | null | undefined): string {
  const labels = kitShortageLabels(debits);
  if (labels.length === 0) {
    return 'O kit ainda não fechou. O envio espera o corte sem falta e os componentes prontos.';
  }
  return `O kit ainda não fechou: ${labels.join('; ')}. Você pode enviar com ressalva: o estoque que falta não será debitado.`;
}

/** Job já saiu do corte (foi para o prestador ou para a fábrica). */
export function atelierJobWasSent(job: { pipeline_status?: string | null }): boolean {
  const status = job.pipeline_status ?? '';
  return status !== '' && status !== 'awaiting_cut' && status !== 'cut' && status !== 'cancelled';
}
