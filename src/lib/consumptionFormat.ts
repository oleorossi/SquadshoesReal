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
  const key = (unit || '').toLowerCase().trim();
  const labels: Record<string, string> = {
    metro: 'm',
    metros: 'm',
    m: 'm',
    cm: 'cm',
    mm: 'mm',
    'm²': 'm²',
    m2: 'm²',
    dm2: 'dm²',
    'dm²': 'dm²',
    par: 'par',
    un: 'un',
    kg: 'kg',
    g: 'g',
    litro: 'L',
    l: 'L',
    ml: 'ml',
    placa: 'placa(s)',
  };
  return labels[key] || unit || 'un';
};

/** Rótulo de preço na unidade de consumo (ex.: R$/kg, R$/m) — evita ler como "por peça". */
export const formatPricePerUnit = (price: number, unit: string, formatCurrency: (n: number) => string): string =>
  `${formatCurrency(price)}/${formatUnit(unit)}`;

export const pluralizeItens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/**
 * Texto da coluna "Aplicação" do consumo. Vazio quando ele só repetiria o
 * Grupo — as colas do item padrão do solado têm `materialName === groupName`
 * e a célula saía "COLA PVC" ao lado de "COLA PVC" (medido 12/10/2026).
 *
 * Fonte ÚNICA da tela (`MaterialConsumptionView`) e do PDF
 * (`materialConsumptionReport`): no PDF a coluna inteira some quando o bloco
 * todo fica vazio, e essa decisão tem de usar exatamente o mesmo critério que
 * a célula — senão o PDF esconde a coluna enquanto a tela ainda escreve nela.
 */
export const consumptionApplicationText = (
  applications: Array<string | null | undefined>,
  groupName: string,
): string => {
  const text = applications.filter(Boolean).join(' + ').trim();
  if (!text) return '';
  const norm = (value: string) => value
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return norm(text) === norm(groupName || '') ? '' : text;
};
