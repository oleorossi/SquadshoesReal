/**
 * Gestão de OS de prestadores — só leitura.
 * Estorno (adjustment_kind reversal ou reverses_return_id) entra com sinal
 * negativo. Descarte (scrap) aparece no lançamento e não mexe no saldo físico.
 */

export type OsMovementKind = 'envio' | 'retorno' | 'estorno' | 'retrabalho' | 'descarte' | 'devolucao_sem_producao';
export type OsStreetStatus = 'na_rua' | 'recebido' | 'atrasado';
export type OsGroupBy = 'referencia_cor_prestador' | 'prestador' | 'pedido' | 'referencia';
export type OsPeriodPreset = 'hoje' | 'semana' | 'mes' | 'mes_anterior' | 'personalizado';

export interface OsRawMovement {
  id: string;
  source: 'dispatch' | 'return';
  at: string;
  serviceOrderId: string;
  osNumber: string;
  saleOrderNumber: string | null;
  reference: string;
  color: string | null;
  gradeLabel: string | null;
  contractorId: string | null;
  contractorName: string;
  internal: boolean;
  qtyDispatched: number;
  qtyGood: number;
  qtyDefect: number;
  qtyLoss: number;
  adjustmentKind: string | null;
  reversesReturnId: string | null;
  unitPrice: number;
  dueDate: string | null;
  payableAmount: number;
  payablePaid: number;
}

export interface OsLedgerLine {
  id: string;
  at: string;
  kind: OsMovementKind;
  serviceOrderId: string;
  osNumber: string;
  saleOrderNumber: string;
  reference: string;
  color: string;
  gradeLabel: string;
  contractorId: string | null;
  contractorName: string;
  internal: boolean;
  pairs: number;
  sent: number;
  received: number;
  defect: number;
  loss: number;
  value: number;
  payable: number;
  paid: number;
  dueDate: string | null;
  pending: number;
  status: OsStreetStatus;
}

export interface OsFilters {
  from: string;
  to: string;
  saleOrder: string;
  reference: string;
  color: string;
  contractorId: string;
  status: '' | OsStreetStatus;
}

export interface OsAggregateRow {
  key: string;
  label: string;
  reference: string;
  color: string;
  contractorName: string;
  saleOrderNumber: string;
  sent: number;
  received: number;
  pending: number;
  defect: number;
  payable: number;
  paid: number;
  avgReturnDays: number | null;
  lateCount: number;
  defectRate: number | null;
}

export function returnPhysicalSign(kind: string | null | undefined, reversesReturnId: string | null | undefined): number {
  if (reversesReturnId || kind === 'reversal') return -1;
  if (kind === 'scrap') return 0;
  return 1;
}

export function movementKind(raw: OsRawMovement): OsMovementKind {
  if (raw.source === 'dispatch') return 'envio';
  if (raw.reversesReturnId || raw.adjustmentKind === 'reversal') return 'estorno';
  if (raw.adjustmentKind === 'scrap') return 'descarte';
  if (raw.adjustmentKind === 'unproduced_return') return 'devolucao_sem_producao';
  if (raw.adjustmentKind === 'rework_return') return 'retrabalho';
  return 'retorno';
}

function n(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function osPendingByOrder(raws: readonly OsRawMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of raws) {
    const sign = raw.source === 'dispatch' ? 1 : returnPhysicalSign(raw.adjustmentKind, raw.reversesReturnId);
    const delta = raw.source === 'dispatch'
      ? n(raw.qtyDispatched)
      : -sign * (n(raw.qtyGood) + n(raw.qtyDefect) + n(raw.qtyLoss));
    map.set(raw.serviceOrderId, (map.get(raw.serviceOrderId) ?? 0) + delta);
  }
  return map;
}

export function osStatus(pending: number, dueDate: string | null, today: string): OsStreetStatus {
  if (pending <= 0.0001) return 'recebido';
  if (dueDate && dueDate < today) return 'atrasado';
  return 'na_rua';
}

export function buildLedger(raws: readonly OsRawMovement[], today: string): OsLedgerLine[] {
  const pending = osPendingByOrder(raws);
  return raws.map((raw) => {
    const sign = raw.source === 'dispatch' ? 1 : returnPhysicalSign(raw.adjustmentKind, raw.reversesReturnId);
    const unproduced = raw.source === 'return' && raw.adjustmentKind === 'unproduced_return';
    const sent = raw.source === 'dispatch' ? n(raw.qtyDispatched) : 0;
    const received = raw.source === 'return' && !unproduced ? sign * n(raw.qtyGood) : 0;
    const defect = raw.source === 'return' && !unproduced ? sign * n(raw.qtyDefect) : 0;
    const loss = raw.source === 'return' && !unproduced ? sign * n(raw.qtyLoss) : 0;
    const open = pending.get(raw.serviceOrderId) ?? 0;
    const status = osStatus(open, raw.dueDate, today);
    return {
      id: raw.id,
      at: raw.at.slice(0, 10),
      kind: movementKind(raw),
      serviceOrderId: raw.serviceOrderId,
      osNumber: raw.osNumber,
      saleOrderNumber: raw.saleOrderNumber || '—',
      reference: raw.reference || '—',
      color: raw.color || '—',
      gradeLabel: raw.gradeLabel || '—',
      contractorId: raw.contractorId,
      contractorName: raw.internal ? 'Produção interna' : (raw.contractorName || 'Prestador'),
      internal: raw.internal,
      pairs: sent || (unproduced ? sign * n(raw.qtyGood) : received + defect + loss),
      sent,
      received,
      defect,
      loss,
      value: unproduced ? 0 : received * n(raw.unitPrice),
      payable: unproduced || raw.source !== 'return' ? 0 : sign * n(raw.payableAmount),
      paid: unproduced || raw.source !== 'return' ? 0 : sign * n(raw.payablePaid),
      dueDate: raw.dueDate,
      pending: open,
      status,
    };
  }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.osNumber.localeCompare(b.osNumber, 'pt-BR')));
}

export function filterLedger(lines: readonly OsLedgerLine[], filters: OsFilters): OsLedgerLine[] {
  const order = filters.saleOrder.trim().toLowerCase();
  const reference = filters.reference.trim().toLowerCase();
  const color = filters.color.trim().toLowerCase();
  return lines.filter((line) => {
    if (filters.from && line.at < filters.from) return false;
    if (filters.to && line.at > filters.to) return false;
    if (order && !line.saleOrderNumber.toLowerCase().includes(order)) return false;
    if (reference && !line.reference.toLowerCase().includes(reference)) return false;
    if (color && !line.color.toLowerCase().includes(color)) return false;
    if (filters.contractorId && line.contractorId !== filters.contractorId && !(filters.contractorId === 'interno' && line.internal)) return false;
    if (filters.status && line.status !== filters.status) return false;
    return true;
  });
}

export function aggregateOs(lines: readonly OsLedgerLine[], groupBy: OsGroupBy): OsAggregateRow[] {
  const groups = new Map<string, OsLedgerLine[]>();
  for (const line of lines) {
    const key = groupKey(line, groupBy);
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const sent = sum(group, 'sent');
    const received = sum(group, 'received');
    const defect = sum(group, 'defect');
    const loss = sum(group, 'loss');
    const returns = group.filter((line) => line.kind !== 'envio');
    const leads = returnDays(group);
    const lateOrders = new Set(group.filter((line) => line.status === 'atrasado').map((line) => line.serviceOrderId));
    const base = received + defect;
    return {
      key,
      label: groupLabel(first, groupBy),
      reference: groupBy === 'prestador' || groupBy === 'pedido' ? '' : first.reference,
      color: groupBy === 'referencia_cor_prestador' ? first.color : '',
      contractorName: groupBy === 'pedido' || groupBy === 'referencia' ? '' : first.contractorName,
      saleOrderNumber: groupBy === 'pedido' ? first.saleOrderNumber : '',
      sent,
      received,
      pending: sent - received - defect - loss,
      defect,
      payable: sum(returns, 'payable'),
      paid: sum(returns, 'paid'),
      avgReturnDays: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
      lateCount: lateOrders.size,
      defectRate: base > 0 ? defect / base : null,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export function osTotals(rows: readonly OsAggregateRow[]) {
  const sent = rows.reduce((s, r) => s + r.sent, 0);
  const received = rows.reduce((s, r) => s + r.received, 0);
  const pending = rows.reduce((s, r) => s + r.pending, 0);
  const defect = rows.reduce((s, r) => s + r.defect, 0);
  const payable = rows.reduce((s, r) => s + r.payable, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  return { sent, received, pending, defect, payable, paid };
}

function groupKey(line: OsLedgerLine, groupBy: OsGroupBy): string {
  if (groupBy === 'prestador') return line.contractorId ?? (line.internal ? 'interno' : line.contractorName);
  if (groupBy === 'pedido') return line.saleOrderNumber;
  if (groupBy === 'referencia') return line.reference;
  return `${line.reference}|${line.color}|${line.contractorId ?? line.contractorName}`;
}

function groupLabel(line: OsLedgerLine, groupBy: OsGroupBy): string {
  if (groupBy === 'prestador') return line.contractorName;
  if (groupBy === 'pedido') return line.saleOrderNumber;
  if (groupBy === 'referencia') return line.reference;
  return `${line.reference} · ${line.color} · ${line.contractorName}`;
}

function sum(lines: readonly OsLedgerLine[], key: 'sent' | 'received' | 'defect' | 'loss' | 'payable' | 'paid'): number {
  return lines.reduce((total, line) => total + line[key], 0);
}

function returnDays(lines: readonly OsLedgerLine[]): number[] {
  const byOrder = new Map<string, { sent?: string; back?: string }>();
  for (const line of lines) {
    const slot = byOrder.get(line.serviceOrderId) ?? {};
    if (line.kind === 'envio' && (!slot.sent || line.at < slot.sent)) slot.sent = line.at;
    if (line.kind !== 'envio' && line.received > 0 && (!slot.back || line.at < slot.back)) slot.back = line.at;
    byOrder.set(line.serviceOrderId, slot);
  }
  const days: number[] = [];
  for (const slot of byOrder.values()) {
    if (!slot.sent || !slot.back || slot.back < slot.sent) continue;
    const start = Date.parse(`${slot.sent}T00:00:00`);
    const end = Date.parse(`${slot.back}T00:00:00`);
    days.push(Math.round((end - start) / 86400000));
  }
  return days;
}

export function periodBounds(preset: OsPeriodPreset, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  if (preset === 'personalizado') return { from: custom?.from || today, to: custom?.to || today };
  if (preset === 'hoje') return { from: today, to: today };
  if (preset === 'semana') {
    const [y, m, d] = today.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const monday = new Date(date);
    const dow = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - dow);
    return { from: iso(monday), to: today };
  }
  if (preset === 'mes_anterior') {
    const [y, m] = today.split('-').map(Number);
    const start = new Date(y, m - 2, 1);
    const end = new Date(y, m - 1, 0);
    return { from: iso(start), to: iso(end) };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function osCsv(rows: readonly OsAggregateRow[]): string {
  const header = ['grupo', 'enviados', 'recebidos', 'pendentes', 'defeito', 'a pagar', 'pago', 'prazo medio dias', 'atrasos', 'pct defeito'];
  const lines = rows.map((row) => [
    row.label,
    row.sent,
    row.received,
    row.pending,
    row.defect,
    row.payable,
    row.paid,
    row.avgReturnDays == null ? '' : row.avgReturnDays.toFixed(1),
    row.lateCount,
    row.defectRate == null ? '' : (row.defectRate * 100).toFixed(1),
  ].map(csvCell).join(';'));
  const totals = osTotals(rows);
  lines.push(['TOTAL', totals.sent, totals.received, totals.pending, totals.defect, totals.payable, totals.paid, '', '', ''].map(csvCell).join(';'));
  return `\uFEFF${header.join(';')}\n${lines.join('\n')}\n`;
}

export function osSheetRows(rows: readonly OsAggregateRow[]): (string | number)[][] {
  const body = rows.map((row) => [
    row.label, row.sent, row.received, row.pending, row.defect, row.payable, row.paid,
    row.avgReturnDays ?? '', row.lateCount, row.defectRate == null ? '' : Number((row.defectRate * 100).toFixed(1)),
  ]);
  const totals = osTotals(rows);
  body.push(['TOTAL', totals.sent, totals.received, totals.pending, totals.defect, totals.payable, totals.paid, '', '', '']);
  return [['Grupo', 'Enviados', 'Recebidos', 'Pendentes', 'Defeito', 'A pagar', 'Pago', 'Prazo médio (dias)', 'Atrasos', '% defeito'], ...body];
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[;"\n]/.test(text)) return `"${text.split('"').join('""')}"`;
  return text;
}

export const OS_KIND_LABEL: Record<OsMovementKind, string> = {
  envio: 'Envio',
  retorno: 'Retorno',
  estorno: 'Estorno',
  retrabalho: 'Retrabalho',
  descarte: 'Descarte',
  devolucao_sem_producao: 'Devolução sem produção',
};

export const OS_STATUS_LABEL: Record<OsStreetStatus, string> = {
  na_rua: 'Na rua',
  recebido: 'Recebido',
  atrasado: 'Atrasado',
};
