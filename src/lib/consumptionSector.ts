/** Destinos selecionáveis na ficha. O destino não altera o momento da baixa. */
export const CONSUMPTION_SECTORS = [
  'Corte Fibra', 'Corte Forração', 'Corte Cabedal', 'Costura Palmilha',
  'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem',
  'Acabamento',
] as const;

export interface DirectComponentSectorLike {
  consumption_sector?: string | null;
}

/** Persiste o mesmo padrão que o formulário exibe, sem alterar os demais dados. */
export function normalizeDirectComponentSectors<T extends DirectComponentSectorLike>(
  components: T[] | null | undefined,
): Array<T & { consumption_sector: string }> {
  return (components || []).map((component) => ({
    ...component,
    consumption_sector: component.consumption_sector?.trim() || 'Aviamento',
  }));
}

export function matchesConsumptionSector(configured: string, requested: string): boolean {
  const sector = configured.trim();
  return sector === requested
    // Compatibilidade de snapshots anteriores à divisão da costura.
    || (sector === 'Costura' && ['Costura Palmilha', 'Costura Cabedal'].includes(requested));
}
