/**
 * Lista canônica de unidades de medida usadas em todo o sistema.
 * Mantém-se UMA fonte da verdade para diálogos de cadastro/edição
 * de produto e grupo, garantindo precisão nos cálculos de consumo.
 */

export interface MeasurementUnitOption {
  value: string;
  label: string;
  group: 'Peso' | 'Volume' | 'Comprimento' | 'Área' | 'Contagem';
}

export const CONSUMPTION_UNITS: MeasurementUnitOption[] = [
  // Peso
  { value: 'kg', label: 'Quilograma (kg)', group: 'Peso' },
  { value: 'g', label: 'Grama (g)', group: 'Peso' },
  { value: 'mg', label: 'Miligrama (mg)', group: 'Peso' },

  // Volume
  { value: 'L', label: 'Litro (L)', group: 'Volume' },
  { value: 'ml', label: 'Mililitro (ml)', group: 'Volume' },

  // Comprimento — IMPORTANTE: MTL (metro linear da NF-e) é equivalente a 'm',
  // NÃO confundir com ML (mililitro, volume — declarado acima). NF-e da SEFAZ
  // usa MTL pra metro linear; o sistema normaliza pra 'm' na importação.
  { value: 'm', label: 'Metro linear (m / MTL)', group: 'Comprimento' },
  { value: 'cm', label: 'Centímetro (cm)', group: 'Comprimento' },
  { value: 'mm', label: 'Milímetro (mm)', group: 'Comprimento' },

  // Área
  { value: 'm²', label: 'Metro quadrado (m²)', group: 'Área' },
  { value: 'dm²', label: 'Decímetro quadrado (dm²)', group: 'Área' },
  { value: 'cm²', label: 'Centímetro quadrado (cm²)', group: 'Área' },

  // Contagem
  { value: 'un', label: 'Unidade (un)', group: 'Contagem' },
  { value: 'par', label: 'Par', group: 'Contagem' },
  { value: 'cx', label: 'Caixa (cx)', group: 'Contagem' },
  { value: 'pc', label: 'Pacote (pc)', group: 'Contagem' },
  { value: 'rolo', label: 'Rolo', group: 'Contagem' },
  { value: 'folha', label: 'Folha', group: 'Contagem' },
  { value: 'chapa', label: 'Chapa', group: 'Contagem' },
  { value: 'jg', label: 'Jogo (jg)', group: 'Contagem' },
];

/** Lista somente os valores (compatível com Select). */
export const CONSUMPTION_UNIT_VALUES = CONSUMPTION_UNITS.map(u => u.value);

/** Agrupa por categoria — útil para Selects com optgroups. */
export const CONSUMPTION_UNITS_BY_GROUP = CONSUMPTION_UNITS.reduce<
  Record<string, MeasurementUnitOption[]>
>((acc, u) => {
  if (!acc[u.group]) acc[u.group] = [];
  acc[u.group].push(u);
  return acc;
}, {});

export function findUnitLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CONSUMPTION_UNITS.find(u => u.value === value)?.label ?? value;
}
