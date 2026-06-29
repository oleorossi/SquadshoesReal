/**
 * Resolve a unidade de consumo de um material a partir do nome do grupo.
 *
 * Espelha a lógica de `getUnitForGroupName` (TechnicalSheets.tsx): a fonte da
 * verdade é a unidade do PRODUTO ativo do grupo; material de ÁREA cortado de
 * bobina (produto linear m/cm COM largura na ficha de componente) tem o consumo
 * gravado em dm²/par → rótulo 'dm²'. Senão usa unidade do produto, depois
 * consumption_unit do grupo, depois dimensions_unit.
 *
 * Usado pela aba de Escalonamento pra saber se o DXF (que dá dm²) mapeia DIRETO
 * (material de área) ou se o valor base precisa ser informado em outra unidade.
 */

// Sinônimos lineares canônicos+legados (alinhado com toCanonical em
// nfUnitConversion.ts e CANONICAL_UNIT_LABELS em unitLabels.ts): m/cm + as
// grafias proibidas metro/metros/mt/mts que produtos legados ainda podem ter.
const LINEAR_LABELS = ['m', 'cm', 'metro', 'metros', 'mt', 'mts'];

export function resolveGroupUnit(
  groupName: string | null | undefined,
  groups: any[],
  products: any[],
  storedUnit?: string,
): string {
  if (!groupName?.trim()) return storedUnit?.trim() || 'un';
  const g: any = (groups || []).find((x: any) => (x.name || '').trim() === groupName.trim());
  const prod: any = g
    ? (products || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim()) ||
      (products || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim())
    : null;
  const prodUnit = (prod?.unit || '').toString().trim();
  const width = Number(g?.dimensions_width) || 0;
  // Área cortada de bobina (napa/couro/forro): produto linear COM largura → dm²/par.
  if (width > 0 && LINEAR_LABELS.includes(prodUnit.toLowerCase())) return 'dm²';
  if (prodUnit) return prodUnit;
  const consumption = ((g?.consumption_unit) || '').toString().trim();
  if (consumption) return consumption;
  if (storedUnit?.trim()) return storedUnit.trim();
  const dims = ((g?.dimensions_unit) || '').toString().trim();
  if (dims) return dims;
  return 'un';
}

/** É unidade de ÁREA? (o DXF dá dm² → mapeia direto pro consumo). */
export function isAreaUnit(unit: string | null | undefined): boolean {
  return ['dm²', 'dm2', 'm²', 'm2', 'cm²', 'cm2'].includes((unit || '').toLowerCase());
}
