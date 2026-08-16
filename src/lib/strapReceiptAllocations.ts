export interface StrapReceiptContributionInput {
  contributionId: string;
  originType: 'sale_order' | 'stock_floor';
  remainingM: number;
  priority?: number | null;
}

export interface StrapReceiptAllocationInput {
  contribution_id: string;
  approved_m: number;
}

const EPSILON = 0.000001;

function roundMeters(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ordered(contributions: StrapReceiptContributionInput[]) {
  return [...contributions].sort((a, b) => (
    (a.originType === b.originType ? 0 : a.originType === 'sale_order' ? -1 : 1)
      || Number(a.priority ?? Number.MAX_SAFE_INTEGER) - Number(b.priority ?? Number.MAX_SAFE_INTEGER)
      || a.contributionId.localeCompare(b.contributionId)
  ));
}

export function expectedStrapReceiptAllocationM(
  approvedM: number,
  contributions: StrapReceiptContributionInput[],
) {
  const eligibleM = contributions.reduce((sum, contribution) => (
    sum + Math.max(0, Number(contribution.remainingM) || 0)
  ), 0);
  return roundMeters(Math.min(Math.max(0, approvedM), eligibleM));
}

/** Espelha a prioridade normativa do servidor, mas sempre retorna um payload
 * explícito para o operador enxergar e revisar antes de confirmar. */
export function suggestStrapReceiptAllocations(
  approvedM: number,
  contributions: StrapReceiptContributionInput[],
): StrapReceiptAllocationInput[] {
  let remaining = expectedStrapReceiptAllocationM(approvedM, contributions);
  const allocations: StrapReceiptAllocationInput[] = [];
  for (const contribution of ordered(contributions)) {
    if (remaining <= EPSILON) break;
    const take = roundMeters(Math.min(remaining, Math.max(0, Number(contribution.remainingM) || 0)));
    if (take <= 0) continue;
    allocations.push({ contribution_id: contribution.contributionId, approved_m: take });
    remaining = roundMeters(remaining - take);
  }
  return allocations;
}

export function validateStrapReceiptAllocations(
  approvedM: number,
  contributions: StrapReceiptContributionInput[],
  allocations: StrapReceiptAllocationInput[],
): string | null {
  const contributionMap = new Map(contributions.map((contribution) => [contribution.contributionId, contribution]));
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    if (seen.has(allocation.contribution_id)) return 'Uma contribuição não pode aparecer duas vezes.';
    seen.add(allocation.contribution_id);
    const contribution = contributionMap.get(allocation.contribution_id);
    if (!contribution) return 'A alocação contém uma contribuição que não pertence a esta linha.';
    const quantity = Number(allocation.approved_m);
    if (!Number.isFinite(quantity) || quantity <= 0) return 'Toda alocação enviada deve ser maior que zero.';
    if (quantity > Number(contribution.remainingM) + EPSILON) return 'Uma alocação excede o saldo aberto da contribuição.';
    total += quantity;
  }
  const expected = expectedStrapReceiptAllocationM(approvedM, contributions);
  if (Math.abs(total - expected) > EPSILON) {
    return `A alocação deve fechar ${expected.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m.`;
  }
  return null;
}
