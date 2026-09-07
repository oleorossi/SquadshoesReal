/**
 * Motor de rateio de OS por OP × setor × prestador.
 *
 * Regras:
 * - soma das parcelas ativas + rascunhos ≤ quantidade da OP
 * - o que sobra fica na fábrica (sem OS)
 * - cada prestador aparece no máximo uma vez por OP×setor no rascunho
 * - total R$ = Σ (qtd × tarifa)
 */

export interface OsAllocationDraft {
  /** Chave estável da parcela: orderId::sector::contractorId */
  key: string;
  orderId: string;
  sector: string;
  contractorId: string;
  quantity: number;
  unitPrice: number;
}

export interface OsExistingAllocation {
  osId: string;
  osNumber?: string | null;
  contractorId: string;
  contractorName?: string | null;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  status: string;
  createdAt?: string | null;
  serviceDate?: string | null;
  dispatchedAt?: string | null;
}

export interface OsAllocationBreakdown {
  orderQuantity: number;
  existingQuantity: number;
  draftQuantity: number;
  factoryQuantity: number;
  remainingForDrafts: number;
  draftTotalValue: number;
  existingTotalValue: number;
  totalOutsourcedValue: number;
  overAllocated: boolean;
  overflow: number;
}

export function allocationKey(orderId: string, sector: string, contractorId: string): string {
  return `${orderId}::${sector}::${contractorId}`;
}

export function sumActiveQuantities(rows: Array<{ quantity: number }>): number {
  return rows.reduce((sum, row) => sum + Math.max(0, Math.trunc(Number(row.quantity) || 0)), 0);
}

export function computeOsAllocationBreakdown(input: {
  orderQuantity: number;
  existing: Array<{ quantity: number; unitPrice?: number; totalValue?: number }>;
  drafts: Array<{ quantity: number; unitPrice: number }>;
}): OsAllocationBreakdown {
  const orderQuantity = Math.max(0, Math.trunc(Number(input.orderQuantity) || 0));
  const existingQuantity = sumActiveQuantities(input.existing);
  const draftQuantity = sumActiveQuantities(input.drafts);
  const allocated = existingQuantity + draftQuantity;
  const overflow = Math.max(0, allocated - orderQuantity);
  const factoryQuantity = Math.max(0, orderQuantity - allocated);
  const remainingForDrafts = Math.max(0, orderQuantity - existingQuantity);

  const existingTotalValue = input.existing.reduce((sum, row) => {
    if (row.totalValue != null && Number.isFinite(Number(row.totalValue))) {
      return sum + Number(row.totalValue);
    }
    return sum + Math.max(0, Number(row.quantity) || 0) * Math.max(0, Number(row.unitPrice) || 0);
  }, 0);

  const draftTotalValue = input.drafts.reduce(
    (sum, row) => sum + Math.max(0, Number(row.quantity) || 0) * Math.max(0, Number(row.unitPrice) || 0),
    0,
  );

  return {
    orderQuantity,
    existingQuantity,
    draftQuantity,
    factoryQuantity,
    remainingForDrafts,
    draftTotalValue,
    existingTotalValue,
    totalOutsourcedValue: existingTotalValue + draftTotalValue,
    overAllocated: overflow > 0,
    overflow,
  };
}

export function validateOsAllocationDrafts(input: {
  orderQuantity: number;
  existing: Array<{ quantity: number; contractorId?: string }>;
  drafts: OsAllocationDraft[];
}): { ok: true } | { ok: false; reason: string } {
  const contractorIds = new Set<string>();
  for (const draft of input.drafts) {
    if (!draft.contractorId) {
      return { ok: false, reason: 'Cada parcela precisa de um prestador.' };
    }
    if (contractorIds.has(draft.contractorId)) {
      return { ok: false, reason: 'O mesmo prestador não pode aparecer duas vezes no rateio desta OP/atividade.' };
    }
    contractorIds.add(draft.contractorId);

    const qty = Number(draft.quantity);
    if (!Number.isFinite(qty) || qty <= 0 || qty !== Math.trunc(qty)) {
      return { ok: false, reason: 'Quantidade da parcela deve ser um inteiro de pares maior que zero.' };
    }
    if (!Number.isFinite(Number(draft.unitPrice)) || Number(draft.unitPrice) <= 0) {
      return { ok: false, reason: 'Tarifa por par deve ser maior que zero.' };
    }
  }

  const breakdown = computeOsAllocationBreakdown(input);
  if (breakdown.overAllocated) {
    return {
      ok: false,
      reason: `Rateio excede a OP em ${breakdown.overflow.toLocaleString('pt-BR')} pares (fábrica + prestadores).`,
    };
  }

  return { ok: true };
}

/** Agrupa linhas do ledger por prestador para o painel do PV. */
export function groupLedgerByContractor<T extends {
  contractorId: string;
  contractorName?: string | null;
  quantity: number;
  totalValue: number;
}>(rows: T[]): Array<{
  contractorId: string;
  contractorName: string;
  quantity: number;
  totalValue: number;
  rows: T[];
}> {
  const map = new Map<string, {
    contractorId: string;
    contractorName: string;
    quantity: number;
    totalValue: number;
    rows: T[];
  }>();

  for (const row of rows) {
    const id = row.contractorId || 'sem-prestador';
    const current = map.get(id) || {
      contractorId: id,
      contractorName: row.contractorName || 'Prestador',
      quantity: 0,
      totalValue: 0,
      rows: [],
    };
    current.quantity += Math.max(0, Number(row.quantity) || 0);
    current.totalValue += Math.max(0, Number(row.totalValue) || 0);
    current.rows.push(row);
    map.set(id, current);
  }

  return [...map.values()].sort((a, b) => a.contractorName.localeCompare(b.contractorName, 'pt-BR'));
}
