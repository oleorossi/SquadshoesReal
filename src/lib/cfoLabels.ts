import type { CfoEntryType } from '@/types/cfo';

export const CFO_ENTRY_LABELS: Record<CfoEntryType, string> = {
  recebimento: 'Recebimento de cliente', material: 'Compra de material', despesa: 'Despesa operacional', aporte: 'Aporte de dinheiro', retirada: 'Retirada',
};
