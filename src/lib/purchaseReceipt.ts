/** Grade recebida agora. A soma tem que fechar a quantidade desta entrada. */
export function gradeReceiptIsValid(
  grade: Record<string, number> | null | undefined,
  quantity: number,
): { ok: true } | { ok: false; reason: string } {
  if (!grade) return { ok: true };
  const entries = Object.entries(grade).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0) return { ok: true };
  for (const [, value] of entries) {
    if (!Number.isFinite(value) || value < 0 || value !== Math.trunc(value)) {
      return { ok: false, reason: 'A grade só aceita inteiros não negativos.' };
    }
  }
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  if (Math.abs(sum - quantity) > 0.0001) {
    return { ok: false, reason: `A grade soma ${sum} e a quantidade recebida é ${quantity}.` };
  }
  return { ok: true };
}

/**
 * A mesma NF não entra duas vezes, nem pelo XML nem pelo botão.
 * Ligar a NF depois não gera outro crédito.
 */
export function invoiceReceiptDecision(input: {
  invoiceId: string | null;
  alreadyReceivedInvoiceId: string | null;
  mode: 'receive' | 'link';
}): { ok: true } | { ok: false; reason: string } {
  if (!input.invoiceId) return { ok: true };
  if (input.alreadyReceivedInvoiceId && input.alreadyReceivedInvoiceId === input.invoiceId) {
    return { ok: false, reason: 'Esta nota fiscal já deu entrada em estoque.' };
  }
  if (input.mode === 'link' && input.alreadyReceivedInvoiceId) {
    return { ok: false, reason: 'Esta ordem de compra já está ligada a outra nota.' };
  }
  return { ok: true };
}
