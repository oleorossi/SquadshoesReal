/**
 * Derives a product category from its group name.
 * This unifies the old hardcoded CATEGORIES with the dynamic product_groups.
 */
export function deriveCategoryFromGroup(groupName: string | null | undefined): string {
  if (!groupName) return 'Componente';
  const n = groupName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (n.includes('solado') || n.includes('sola')) return 'Solado';
  if (n.includes('cabedal') || n.includes('napa') || n.includes('couro') || n.includes('velvet') || n.includes('tecido')) return 'Cabedal';
  if (n.includes('palmilha') || n.includes('placa de palmilha') || n.includes('placa palmilha')) return 'Palmilha';
  if (n.includes('forro') || n.includes('forracao') || n.includes('forração')) return 'Forração da Palmilha';
  if (n.includes('cola') || n.includes('quimico') || n.includes('químico') || n.includes('primer') || n.includes('halogenante')) return 'Cola / Químico';
  if (n.includes('ferramenta') || n.includes('navalha') || n.includes('faca')) return 'Ferramentas';
  if (n.includes('forma') || n.includes('fôrma')) return 'Fôrma';

  return 'Componente';
}
