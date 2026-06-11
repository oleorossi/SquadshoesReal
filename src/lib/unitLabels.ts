/**
 * Rótulo CANÔNICO de unidade pra exibição (auditoria visual 11/06/2026).
 *
 * O motor de consumo (`orderConsumption.ts`) usa 'metro' como token interno
 * de unidade linear, e produtos legados ainda podem ter grafias proibidas
 * ('metros', 'mt', 'unid', 'chapa'...). As fichas de operador imprimiam o
 * token cru em uppercase ("16.2 METRO"). Este helper converte qualquer
 * grafia pra lista canônica de `docs/UNIDADES_E_CONVERSOES.md` SEM alterar
 * o valor interno usado em comparações/chaves de agregação.
 */
const CANONICAL_UNIT_LABELS: Record<string, string> = {
  // linear
  m: 'm', metro: 'm', metros: 'm', mt: 'm', mts: 'm',
  cm: 'cm', mm: 'mm',
  // área
  'dm²': 'dm²', dm2: 'dm²', 'm²': 'm²', m2: 'm²', 'cm²': 'cm²', cm2: 'cm²',
  // contagem
  un: 'un', unid: 'un', unidade: 'un', unidades: 'un', und: 'un',
  par: 'par', pares: 'par',
  // placa
  placa: 'placa', placas: 'placa', chapa: 'placa', chapas: 'placa',
  // massa
  kg: 'kg', g: 'g', gr: 'g', grama: 'g', gramas: 'g',
  // volume
  l: 'L', litro: 'L', litros: 'L', ml: 'ml',
};

export function formatUnitLabel(unit?: string | null, fallback = 'un'): string {
  const v = (unit || '').trim();
  if (!v) return fallback;
  return CANONICAL_UNIT_LABELS[v.toLowerCase()] ?? v;
}
