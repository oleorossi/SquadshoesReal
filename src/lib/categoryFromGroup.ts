/**
 * Derives a product category from its group name.
 * This unifies the old hardcoded CATEGORIES with the dynamic product_groups.
 *
 * MIRROR DA FUNÇÃO SQL `derive_category_from_group_name(text)` aplicada no
 * DB via trigger BEFORE INSERT `tg_products_auto_category` em products.
 * Manter sincronizado: mudar aqui = mudar lá também (migration). O trigger
 * é a defesa final que garante products.category NUNCA seja NULL (resolve
 * "null value in column category" definitivamente, mesmo se algum code
 * path frontend esquecer).
 */
export function deriveCategoryFromGroup(groupName: string | null | undefined): string {
  if (!groupName) return 'Componente';
  const n = groupName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Solado: 'solado', 'sola' (palavra inteira), e tipos de salto comuns
  // (saltinho/anabela/plataforma/tamanco) — heurística pra grupos cujo nome
  // descreve o tipo de salto em vez de literalmente "solado".
  if (
    n.includes('solado') || /\bsola\b/.test(n) ||
    n.includes('saltinho') || n.includes('salto') ||
    n.includes('anabela') || n.includes('plataforma') || n.includes('tamanco')
  ) return 'Solado';
  if (n.includes('cabedal') || n.includes('napa') || n.includes('couro') || n.includes('velvet') || n.includes('tecido')) return 'Cabedal';
  if (n.includes('palmilha') || n.includes('placa de palmilha') || n.includes('placa palmilha')) return 'Palmilha';
  if (n.includes('forro') || n.includes('forracao') || n.includes('forração')) return 'Forração da Palmilha';
  if (n.includes('cola') || n.includes('quimico') || n.includes('químico') || n.includes('primer') || n.includes('halogenante')) return 'Cola / Químico';
  if (n.includes('ferramenta') || n.includes('navalha') || n.includes('faca')) return 'Ferramentas';
  if (n.includes('forma') || n.includes('fôrma')) return 'Fôrma';

  return 'Componente';
}
