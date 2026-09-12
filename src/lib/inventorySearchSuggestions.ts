import { searchMatchesAllTerms, rankBySearchScore } from '@/lib/searchUtils';
import type { SmartSearchSuggestion } from '@/components/ui/smart-search';

export interface InventorySearchGroup {
  name: string;
}

export interface InventorySearchProduct {
  name?: string | null;
  sku?: string | null;
  category?: string | null;
  color?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

/**
 * Sugestões do buscador de Estoque: Grupo / SKU / Nome / Categoria,
 * sem duplicar o nome do grupo na seção Nome.
 */
export function buildInventorySearchSuggestions(
  term: string,
  groups: InventorySearchGroup[],
  products: InventorySearchProduct[],
): SmartSearchSuggestion[] {
  const q = term.trim();
  if (!q) return [];

  const groupNames = new Set(
    groups.map((g) => (g.name || '').trim()).filter(Boolean),
  );
  const out: SmartSearchSuggestion[] = [];

  const groupHits = rankBySearchScore(
    groups.filter((g) => g.name && searchMatchesAllTerms(q, g.name)),
    q,
    (g) => g.name,
  );
  for (const g of groupHits) {
    out.push({ field: 'group', value: g.name });
  }

  const skuSeen = new Set<string>();
  const skuHits: SmartSearchSuggestion[] = [];
  for (const p of products) {
    const sku = (p.sku || '').trim();
    if (!sku || skuSeen.has(sku) || !searchMatchesAllTerms(q, sku)) continue;
    skuSeen.add(sku);
    const label = (p.color || p.name || '').trim();
    const qty = Number(p.quantity);
    const unit = (p.unit || '').trim();
    const qtyPart = Number.isFinite(qty) && qty !== 0
      ? `${qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`.trim()
      : '';
    const meta = [label, qtyPart].filter(Boolean).join(' · ') || undefined;
    skuHits.push({ field: 'sku', value: sku, meta });
  }
  out.push(...rankBySearchScore(skuHits, q, (s) => s.value));

  const nameSeen = new Set<string>();
  const nameHits: SmartSearchSuggestion[] = [];
  for (const p of products) {
    const name = (p.name || '').trim();
    if (!name || groupNames.has(name) || nameSeen.has(name)) continue;
    if (!searchMatchesAllTerms(q, name)) continue;
    nameSeen.add(name);
    nameHits.push({ field: 'name', value: name, meta: p.color || undefined });
  }
  out.push(...rankBySearchScore(nameHits, q, (s) => s.value));

  const catSeen = new Set<string>();
  const catHits: SmartSearchSuggestion[] = [];
  for (const p of products) {
    const category = (p.category || '').trim();
    if (!category || catSeen.has(category) || !searchMatchesAllTerms(q, category)) continue;
    catSeen.add(category);
    catHits.push({ field: 'category', value: category });
  }
  out.push(...rankBySearchScore(catHits, q, (s) => s.value));

  return out;
}
