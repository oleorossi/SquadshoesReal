/**
 * Rótulo honesto do seletor de componente direto quando o product_id da ficha
 * não está na lista de produtos ATIVOS (inativo ou apagado).
 *
 * Sem isto o DirectComponentSelect mostra "Selecionar grupo…" em branco enquanto
 * o motor SQL ainda emite a linha no consumo (JOIN em products sem filtro active).
 */
export type DirectComponentResolveStatus = 'ok' | 'inactive' | 'missing';

export function resolveDirectComponentSelection(args: {
  value: string | null | undefined;
  /** Produto encontrado na query (pode ser inativo se a query o incluiu). */
  selected: { name?: string | null; color?: string | null; active?: boolean | null } | null | undefined;
  /** Snapshot gravado no JSONB da ficha (`product_name`). */
  fallbackLabel?: string | null;
}): { status: DirectComponentResolveStatus; label: string } {
  const value = (args.value || '').trim();
  if (!value) {
    return { status: 'ok', label: '' };
  }
  const selected = args.selected;
  if (selected && selected.active !== false) {
    const color = selected.color ? ` (${selected.color})` : '';
    return { status: 'ok', label: `${selected.name || 'Produto'}${color}` };
  }
  if (selected && selected.active === false) {
    const color = selected.color ? ` (${selected.color})` : '';
    const name = selected.name || args.fallbackLabel || 'Produto';
    return { status: 'inactive', label: `${name}${color} · inativo` };
  }
  const snap = (args.fallbackLabel || '').trim();
  return {
    status: 'missing',
    label: snap
      ? `${snap} · removido do estoque`
      : 'Produto removido do estoque',
  };
}
