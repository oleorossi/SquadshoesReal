/**
 * Confirma ação em massa quando há itens selecionados fora do filtro atual.
 * Retorna true se o usuário confirmou (ou se não há ocultos).
 */
export function confirmIfHiddenSelection(opts: {
  totalSelected: number;
  hiddenSelectedCount: number;
  entityLabel: string;
  actionLabel: string;
}): boolean {
  const { totalSelected, hiddenSelectedCount, entityLabel, actionLabel } = opts;
  if (hiddenSelectedCount <= 0) return true;
  const plural = totalSelected === 1 ? entityLabel : `${entityLabel}s`;
  return window.confirm(
    `${actionLabel} ${totalSelected} ${plural} (${hiddenSelectedCount} fora do filtro atual)?`,
  );
}
