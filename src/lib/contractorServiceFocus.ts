export type ContractorServiceFocus = 'all' | 'costura_cabedal' | 'aviamento' | 'other';

export const CONTRACTOR_SERVICE_FOCUS_META: Record<
  Exclude<ContractorServiceFocus, 'other'>,
  { label: string; shortLabel: string; description: string }
> = {
  all: {
    label: 'Todos os serviços',
    shortLabel: 'Todos',
    description: 'Costura de cabedal, aviamento e serviços eventuais.',
  },
  costura_cabedal: {
    label: 'Costura de cabedal',
    shortLabel: 'Costura',
    description: 'Fechamento e preparação externa do cabedal.',
  },
  aviamento: {
    label: 'Aviamento',
    shortLabel: 'Aviamento',
    description: 'Aplicação externa de tiras, enfeites e acessórios.',
  },
};

function normalizeServiceText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Converte as chaves operacionais antigas (`costura`, `mesa`) e os rótulos
 * atuais em um recorte único usado pelo assistente e pelos relatórios.
 * Costura de palmilha não entra no foco principal de cabedal.
 */
export function getContractorServiceFocus(
  sector: string | null | undefined,
  label?: string | null,
): Exclude<ContractorServiceFocus, 'all'> {
  const sectorText = normalizeServiceText(sector);
  const combined = `${sectorText} ${normalizeServiceText(label)}`.trim();

  if (sectorText === 'mesa' || combined.includes('aviamento')) return 'aviamento';
  if (combined.includes('costura') && !combined.includes('palmilha')) return 'costura_cabedal';
  return 'other';
}

export function matchesContractorServiceFocus(
  focus: ContractorServiceFocus,
  sector: string | null | undefined,
  label?: string | null,
): boolean {
  return focus === 'all' || getContractorServiceFocus(sector, label) === focus;
}

export function contractorServicePriority(
  sector: string | null | undefined,
  label?: string | null,
): number {
  const focus = getContractorServiceFocus(sector, label);
  if (focus === 'costura_cabedal') return 0;
  if (focus === 'aviamento') return 1;
  return 2;
}
