/**
 * Identidade compacta do cartão do Ateliê: pedido, referência, cor e pares.
 * Um lote ou uma OS com várias combinações vira uma linha por combinação.
 */

export interface AtelierIdentityLine {
  orderNumber: string;
  reference: string;
  color: string;
  pairs: number;
}

export function atelierIdentityLabel(line: AtelierIdentityLine): string {
  const pairs = Math.max(0, Math.trunc(Number(line.pairs) || 0));
  return `${line.orderNumber} · ${line.reference} · ${line.color} · ${pairs}p`;
}

export function atelierJobIdentityLine(
  job: { order_number?: string | null; pairs?: number | null },
  lot: { reference_code?: string | null; color?: string | null },
): AtelierIdentityLine {
  return {
    orderNumber: (job.order_number ?? '').trim() || 'Sem PV',
    reference: (lot.reference_code ?? '').trim() || 'Sem referência',
    color: (lot.color ?? '').trim() || 'Sem cor',
    pairs: Math.max(0, Math.trunc(Number(job.pairs) || 0)),
  };
}

export function atelierLotIdentityLines(lot: {
  reference_code?: string | null;
  color?: string | null;
  pairs?: number | null;
  orders?: readonly { order_number?: string | null; pairs?: number | null }[] | null;
  jobs?: readonly { order_number?: string | null; pairs?: number | null; pipeline_status?: string | null }[] | null;
}): AtelierIdentityLine[] {
  const reference = (lot.reference_code ?? '').trim() || 'Sem referência';
  const color = (lot.color ?? '').trim() || 'Sem cor';
  const orders = (lot.orders ?? []).filter((order) => (order.order_number ?? '').trim());
  if (orders.length > 0) {
    return orders.map((order) => ({
      orderNumber: (order.order_number ?? '').trim(),
      reference,
      color,
      pairs: Math.max(0, Math.trunc(Number(order.pairs) || 0)),
    }));
  }
  const byOrder = new Map<string, number>();
  for (const job of lot.jobs ?? []) {
    if (job.pipeline_status === 'cancelled') continue;
    const number = (job.order_number ?? '').trim() || 'Sem PV';
    byOrder.set(number, (byOrder.get(number) || 0) + Math.max(0, Math.trunc(Number(job.pairs) || 0)));
  }
  if (byOrder.size === 0) {
    return [{
      orderNumber: 'Sem PV',
      reference,
      color,
      pairs: Math.max(0, Math.trunc(Number(lot.pairs) || 0)),
    }];
  }
  return [...byOrder.entries()].map(([orderNumber, pairs]) => ({
    orderNumber,
    reference,
    color,
    pairs,
  }));
}
