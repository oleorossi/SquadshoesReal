/**
 * Setor/categoria de um grupo de material.
 *
 * Modelo NOVO (2026-06-29): o setor é EXPLÍCITO em `product_groups.sector`
 * (= products.category canônico). A dedução por nome (deriveCategoryFromGroup)
 * deixou de governar — vale só como SUGESTÃO ao criar um grupo novo e como
 * fallback de segurança quando `sector` ainda está vazio. A migration
 * 20260629140000 fez o backfill e o trigger de category passou a ler o setor
 * do grupo; mover o grupo de setor cascateia pra products.category no banco.
 */

/**
 * Setores oferecidos no seletor "Mover para outro setor". `value` é o
 * products.category canônico (CATEGORIES em src/types/inventory.ts); `label` é
 * o rótulo amigável das abas do Estoque. Ordem espelha as abas.
 */
export const SECTOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Cabedal',              label: 'Cabedal' },
  { value: 'Forração da Palmilha', label: 'Forração' },
  { value: 'Palmilha',             label: 'Palmilha' },
  { value: 'Cola / Químico',       label: 'Químicos' },
  { value: 'Componente',           label: 'Componentes' },
  { value: 'Embalagem',            label: 'Embalagem' },
  { value: 'Solado',               label: 'Solado' },
  { value: 'Ferramentas',          label: 'Ferramentas' },
  { value: 'Fôrma',                label: 'Fôrma' },
] as const;

/** Rótulo amigável de um valor de setor (category). Fallback: o próprio valor. */
export function sectorLabel(sector: string | null | undefined): string {
  if (!sector) return '—';
  return SECTOR_OPTIONS.find(o => o.value === sector)?.label ?? sector;
}

/**
 * Setor efetivo de um grupo: o explícito (`sector`) vence; se ainda vazio
 * (grupo legado sem backfill / recém-criado), cai na sugestão por nome.
 */
export function sectorOfGroup(group: { sector?: string | null; name?: string | null } | null | undefined): string {
  const s = (group?.sector ?? '').trim();
  if (s) return s;
  return deriveCategoryFromGroup(group?.name);
}

/**
 * Sugere uma categoria a partir do NOME do grupo. Antes governava a categoria
 * dos produtos via trigger; agora é só SUGESTÃO inicial (cadastro de grupo) e
 * fallback de `sectorOfGroup` quando `product_groups.sector` está vazio.
 *
 * Ainda espelha `derive_category_from_group_name(text)` no DB (usada no backfill
 * one-time e como semente). Manter sincronizado se mexer na heurística.
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
