import { supabase } from '@/integrations/supabase/client';
import { fetchFinancialRows } from '@/lib/financialPagination';
import { assertSettlementDate } from '@/lib/financialSettlement';
import { summarizeFinancialCash, type FinancialCashMovement } from '@/lib/financialCash';

interface PageResult<T> { data: T[] | null; error: unknown; count: number | null }

export interface FinancialCashCmvMovement {
  id: string;
  effective_on: string | null;
  amount_signed: number;
  legacy: boolean;
}

export interface FinancialCmvPending {
  id: string;
  receivable_id: string;
  sale_order_id: string;
  effective_on: string;
  received_amount: number;
}

export async function fetchFinancialCmvPending(startDate: string, endDate: string): Promise<FinancialCmvPending[]> {
  periodFilter(startDate, endDate);
  return fetchFinancialRows<FinancialCmvPending>((from, to) => supabase
    .from('financial_settlement_cmv_pending' as never)
    .select('id:settlement_event_id,receivable_id,sale_order_id,effective_on,received_amount', { count: 'exact' })
    .gte('effective_on', startDate).lte('effective_on', endDate)
    .order('settlement_event_id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<PageResult<FinancialCmvPending>>);
}

function periodFilter(startDate: string, endDate: string) {
  assertSettlementDate(startDate, '9999-12-31');
  assertSettlementDate(endDate, '9999-12-31');
  if (startDate > endDate) throw new Error('Período financeiro inválido.');
  return `and(effective_on.gte.${startDate},effective_on.lte.${endDate}),effective_on.is.null`;
}

/** Cast local até regenerar os tipos do banco; as colunas são verificadas no contrato SQL. */
export async function fetchFinancialCashMovements(startDate: string, endDate: string): Promise<FinancialCashMovement[]> {
  const filter = periodFilter(startDate, endDate);
  const rows = await fetchFinancialRows<FinancialCashMovement>((from, to) => supabase
    .from('financial_cash_movements' as never)
    .select('id,kind,account_id,effective_on,amount_signed,category,legacy', { count: 'exact' })
    .or(filter)
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<PageResult<FinancialCashMovement>>);
  // Valida a fonte inteira antes de liberar qualquer total ou sinal de fonte vazia.
  summarizeFinancialCash(rows, 'payable', startDate, endDate);
  summarizeFinancialCash(rows, 'receivable', startDate, endDate);
  return rows;
}

export async function fetchFinancialCashCmvMovements(startDate: string, endDate: string): Promise<FinancialCashCmvMovement[]> {
  const filter = periodFilter(startDate, endDate);
  const rows = await fetchFinancialRows<FinancialCashCmvMovement>((from, to) => supabase
    .from('financial_cash_cmv_movements' as never)
    .select('id,effective_on,amount_signed,legacy', { count: 'exact' })
    .or(filter)
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<PageResult<FinancialCashCmvMovement>>);
  summarizeFinancialCash(rows.map(row => ({ ...row, kind: 'receivable', account_id: row.id, category: 'cmv' })), 'receivable', startDate, endDate);
  return rows;
}
