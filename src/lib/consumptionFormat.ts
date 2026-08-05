/**
 * Formatação pt-BR das quantidades de consumo — DISPLAY-ONLY.
 *
 * Extraído de `MaterialConsumptionView` em 2026-08-05 porque agora três
 * superfícies formatam os MESMOS números: a tabela mestra, o trilho de decisão
 * e o PDF. Grafia diferente entre elas quebra a conferência de quem soma a
 * coluna na mão.
 */

/** Unidades que nunca têm casa decimal (não existe meio par nem meia caixa). */
const INTEGER_UNITS = new Set(['par', 'un', 'placa']);

export const formatQty = (value: number, unit: string): string => {
  const isInt = INTEGER_UNITS.has((unit || '').toLowerCase());
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: isInt ? 0 : 2,
  }).format(Number(value) || 0);
};

/** Rótulo curto da unidade. Mantém a grafia canônica de `docs/UNIDADES_E_CONVERSOES.md`. */
export const formatUnit = (unit: string): string => {
  const labels: Record<string, string> = {
    metro: 'm',
    m: 'm',
    'm²': 'm²',
    dm2: 'dm²',
    par: 'par',
    un: 'un',
    kg: 'kg',
    litro: 'L',
    placa: 'placa(s)',
  };
  return labels[unit] || unit || 'un';
};

export const pluralizeItens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;
