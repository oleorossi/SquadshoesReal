/**
 * Separar um pedido do lote compartilhado. O corte debita a napa do lote
 * inteiro; o botão só aparece enquanto o lote está aberto e há outro job.
 */

export function atelierLiveJobs<T extends { pipeline_status?: string | null }>(
  jobs: readonly T[] | null | undefined,
): T[] {
  return (jobs ?? []).filter((job) => job.pipeline_status !== 'cancelled');
}

export function atelierJobCanSplit(
  job: { pipeline_status?: string | null },
  lot: { status?: string | null; jobs?: readonly { pipeline_status?: string | null }[] | null },
): boolean {
  if (job.pipeline_status !== 'awaiting_cut') return false;
  if (lot.status !== 'open') return false;
  return atelierLiveJobs(lot.jobs).length > 1;
}

export function atelierSplitConfirmMessage(
  job: { order_number?: string | null; sale_order_id?: string | null },
  lot: {
    lot_number?: string | null;
    jobs?: readonly {
      pipeline_status?: string | null;
      sale_order_id?: string | null;
      order_number?: string | null;
      sector?: string | null;
    }[] | null;
  },
): string {
  const number = (job.order_number ?? '').trim() || 'este pedido';
  const lotName = (lot.lot_number ?? '').trim() || 'lote atual';
  const siblings = atelierLiveJobs(lot.jobs).filter((row) => {
    if (job.sale_order_id && row.sale_order_id) return row.sale_order_id === job.sale_order_id;
    return (row.order_number ?? '').trim() === number;
  });
  const extra = siblings.length > 1
    ? ` Saem juntos os ${siblings.length} jobs deste pedido nesta cor.`
    : '';
  return `Separar ${number} num lote próprio? Ele sai de ${lotName}.${extra} O corte do lote antigo não debita a napa destes pares.`;
}
