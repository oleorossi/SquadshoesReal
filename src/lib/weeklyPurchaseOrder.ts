/** Segunda-feira da semana de faturamento (ISO). Sem data, usa o dia de referência. */
export function purchaseWeekStart(billingWeek: string | null | undefined, today: string): string {
  const day = (billingWeek || today).slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return today.slice(0, 10);
  const dow = date.getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

/** Uma OC por fornecedor e semana. Rascunho. Não é chave de envio. */
export function weeklyPurchaseIdempotency(supplierKey: string, weekStart: string): string {
  return `auto_pv:outbox:${supplierKey}:week:${weekStart}`;
}

/**
 * Múltiplo sobe a quantidade. Mínimo de compra não altera o pedido:
 * só devolve o aviso quando a quantidade fica abaixo dele.
 */
export function minOrderWarning(input: {
  productName: string;
  quantity: number;
  minOrder: number | null | undefined;
  unit: string;
}): string | null {
  const min = Number(input.minOrder);
  if (!Number.isFinite(min) || min <= 0) return null;
  if (input.quantity >= min) return null;
  const qty = Number(input.quantity.toFixed(3));
  return `Mínimo de compra de ${input.productName} é ${min} ${input.unit} e não foi aplicado (pedido ${qty}).`;
}
