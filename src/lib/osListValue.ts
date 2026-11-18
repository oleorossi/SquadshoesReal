/**
 * Valor mostrado na lista de OS.
 * O cabeçalho é o contratado (pares enviados × tarifa). O devido é a soma
 * das contas que nasceram dos pares aceitos. Quando divergem, o previsto fica
 * ao lado.
 */

export interface OsListValue {
  /** null = ainda não há valor (mostra "A definir"). */
  primary: number | null;
  forecast: number | null;
}

export function osListValue(input: {
  contracted: number;
  hasPayable: boolean;
  payableAmount: number | null | undefined;
}): OsListValue {
  const contracted = Number(input.contracted);
  const contractedValue = Number.isFinite(contracted) ? contracted : 0;
  if (input.hasPayable && input.payableAmount != null && Number.isFinite(Number(input.payableAmount))) {
    const due = Number(input.payableAmount);
    const forecast = Math.abs(due - contractedValue) > 0.009 ? contractedValue : null;
    return { primary: due, forecast };
  }
  if (contractedValue === 0) return { primary: null, forecast: null };
  return { primary: contractedValue, forecast: null };
}
