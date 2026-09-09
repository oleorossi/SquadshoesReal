export interface InvoiceSummaryRow {
  status: string;
  total_value: number | string;
}

export interface OutgoingInvoiceSummaryRow {
  status: string;
  valor_total: number | string;
  tp_amb_sefaz: string | null;
}

function centsOf(value: number | string): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Uma nota possui valor ausente ou inválido. Confira o cadastro antes de usar o total.');
  }
  const amount = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Uma nota possui valor inválido. Confira o cadastro antes de usar o total.');
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('Valor da nota excede o limite de cálculo seguro.');
  return cents;
}

function addCents(total: number, value: number | string): number {
  const next = total + centsOf(value);
  if (!Number.isSafeInteger(next)) throw new Error('Total das notas excede o limite de cálculo seguro.');
  return next;
}

export function summarizeIncomingInvoices(rows: InvoiceSummaryRow[]) {
  let cents = 0;
  let count = 0;
  for (const row of rows) {
    if (row.status !== 'imported') continue;
    cents = addCents(cents, row.total_value);
    count++;
  }
  return { count, total: cents / 100 };
}

export function summarizeOutgoingInvoices(rows: OutgoingInvoiceSummaryRow[]) {
  let cents = 0;
  let count = 0;
  let processing = 0;
  let failed = 0;
  let unknownEnvironment = 0;
  for (const row of rows) {
    // Homologação identificada nunca compõe indicadores do financeiro.
    if (row.tp_amb_sefaz === '2') continue;
    if (row.status === 'autorizada') {
      cents = addCents(cents, row.valor_total);
      count++;
      // O legado não informa tpAmb. Não o reclassificamos como produção:
      // o card conta documentos autorizados e informa essa lacuna à parte.
      if (row.tp_amb_sefaz !== '1') unknownEnvironment++;
    } else if (row.status === 'processando') {
      processing++;
    } else if (row.status === 'erro' || row.status === 'rejeitada') {
      failed++;
    }
  }
  return { count, total: cents / 100, processing, failed, unknownEnvironment };
}

/** Período de emissão: data civil para entrada e limites locais para timestamps. */
export function invoiceSummaryPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1000) {
    throw new Error('Selecione um mês válido para consultar as notas.');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return {
    startDate,
    endDateExclusive,
    startTimestamp: new Date(`${startDate}T00:00:00`).toISOString(),
    endTimestampExclusive: new Date(`${endDateExclusive}T00:00:00`).toISOString(),
  };
}
