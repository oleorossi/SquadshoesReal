/**
 * Classificação grosseira de material do BOM por nome/categoria.
 * Extraído de orderConsumption pra callers de produção (weekly, planning)
 * não importarem o motor de consumo legado.
 */
export function classifyBomMaterial(
  groupName: string,
  productName: string,
  category: string,
): string {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
  if (
    normalized.includes('cabedal')
    || normalized.includes('napa')
    || normalized.includes('velvet')
    || normalized.includes('couro')
  ) return 'Cabedal';
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (
    normalized.includes('forração')
    || normalized.includes('forracao')
    || normalized.includes('forro')
  ) return 'Forração';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Outros';
}
