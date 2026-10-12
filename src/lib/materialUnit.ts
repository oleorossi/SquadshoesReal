/**
 * Resolve a UNIDADE DE CONSUMO de um material de ficha técnica.
 *
 * Fonte ÚNICA do rótulo das grades de consumo por numeração (Cabedal Material 1
 * e Materiais 2+), do toast de auto-preenchimento e de quem mais precise dizer
 * ao operador em que unidade digitar.
 *
 * REGRA (espelha o motor em `materialConsumption.ts` e o SQL
 * `get_material_conversion_info`): o número que o operador digita é
 *  - **dm²/par** quando o material é cortado de BOBINA (napa/couro/forro) — o
 *    motor divide pela largura do rolo pra chegar no metro linear;
 *  - **a unidade de estoque do item** quando o material é linear DIRETO
 *    (elástico, tira: material já pronto, SKU próprio, comprado por metro) — o
 *    motor NÃO converte;
 *  - **a unidade de estoque do item** para contagem/massa/volume (un, par, kg, L).
 *
 * ⚠ A largura sai da FICHA DE COMPONENTE do item (fallback: outra ficha do mesmo
 * grupo, e só então o grupo) — a MESMA cascata que o motor usa pra dividir. Ler
 * `product_groups.dimensions_width` como esta função fazia antes punha o rótulo
 * em desacordo com o cálculo: NAPA PALHA tem grupo 0 e ficha 1370, então a tela
 * dizia "m/par" enquanto o motor dividia por 137.
 */
import {
  LINEAR_UNITS,
  PLATE_UNITS,
  ROLL_WIDTH_FLOOR_MM,
} from '@/lib/materialConsumption';

/** Como o número gravado deve ser lido. */
export type ConsumptionBasis =
  /** cortado de bobina → dm²/par, o motor converte pela largura do rolo */
  | 'roll_area'
  /** item linear direto (tira/elástico) → já na unidade de estoque */
  | 'native_linear'
  /** contagem/massa/volume → já na unidade de estoque */
  | 'count'
  /** grupo/item não resolvido → caiu no storedUnit ou no default */
  | 'unknown';

export interface ResolvedConsumptionUnit {
  /** Rótulo da grade: 'dm²' | 'm' | 'un' | … */
  unit: string;
  basis: ConsumptionBasis;
  /** Largura efetiva lida, em mm (0 = não cadastrada). */
  widthMm: number;
  /** Unidade de estoque do item representativo ('' quando não há item). */
  productUnit: string;
}

const AREA_LABELS = ['dm²', 'm²', 'cm²'];

const norm = (value: unknown): string => (value ?? '').toString().trim().toLowerCase();

/** mm a partir de (valor, unidade) — mesma tabela de `convertDimensionToMm`. */
const toMm = (value: unknown, unit: unknown): number => {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  const u = norm(unit);
  if (u === 'cm') return n * 10;
  if (u === 'dm') return n * 100;
  if (u === 'm' || u === 'metro' || u === 'mt') return n * 1000;
  return n; // mm (ou vazio) — igual ao SQL
};

/**
 * Item que REPRESENTA o grupo. Prefere ativo e, entre os ativos, um de unidade
 * física (m/cm/placa): num grupo misto como NAPA SOFT + MASSABOX ('m' e 'un') é
 * a napa que define como o consumo do cabedal é digitado.
 */
const pickProduct = (groupId: string | undefined | null, products: any[]) => {
  if (!groupId) return null;
  const withUnit = (products || []).filter(
    (p: any) => p.group_id === groupId && norm(p.unit),
  );
  if (withUnit.length === 0) return null;
  const actives = withUnit.filter((p: any) => p.active !== false);
  const pool = actives.length > 0 ? actives : withUnit;
  const isPhysical = (p: any) => LINEAR_UNITS.has(norm(p.unit)) || PLATE_UNITS.has(norm(p.unit));
  return pool.find(isPhysical) || pool[0];
};

/** Largura em mm, na MESMA cascata do SQL: ficha do item → ficha do grupo → grupo. */
const resolveWidthMm = (group: any, product: any, componentSheets: any[]): number => {
  const sheets = componentSheets || [];

  const own = product ? sheets.find((cs: any) => cs.product_id === product.id) : null;
  const ownWidth = toMm(own?.dimensions_width, own?.dimensions_unit)
    || toMm(own?.dimensions_length, own?.dimensions_unit);
  if (ownWidth > 0) return ownWidth;

  for (const cs of sheets) {
    const sameGroup = cs.group_id === group?.id || cs.products?.group_id === group?.id;
    if (!sameGroup) continue;
    const w = toMm(cs.dimensions_width, cs.dimensions_unit)
      || toMm(cs.dimensions_length, cs.dimensions_unit);
    if (w > 0) return w;
  }

  return toMm(group?.dimensions_width, group?.dimensions_unit);
};

export function resolveConsumptionUnit(
  groupName: string | null | undefined,
  groups: any[],
  products: any[],
  componentSheets: any[] = [],
  opts?: { groupId?: string | null; storedUnit?: string | null },
): ResolvedConsumptionUnit {
  const stored = (opts?.storedUnit ?? '').toString().trim();
  const byId = opts?.groupId ? (groups || []).find((g: any) => g.id === opts.groupId) : null;
  const key = norm(groupName);
  const group: any = byId || (key ? (groups || []).find((g: any) => norm(g.name) === key) : null);

  if (!group) {
    return { unit: stored || 'un', basis: 'unknown', widthMm: 0, productUnit: '' };
  }

  const product: any = pickProduct(group.id, products);
  const productUnit = (product?.unit ?? '').toString().trim();
  const pu = norm(productUnit);
  const widthMm = resolveWidthMm(group, product, componentSheets);
  const consUnit = norm(group.consumption_unit).replace(/2/g, '²');
  const declaredArea = AREA_LABELS.includes(consUnit);
  const hasRollDims = Number(group.dimensions_length) > 0;

  // Produto já vendido em placa/área: o número É área.
  if (PLATE_UNITS.has(pu)) {
    return { unit: productUnit, basis: 'roll_area', widthMm, productUnit };
  }

  if (LINEAR_UNITS.has(pu)) {
    // Cadastro que declara área explicitamente vence a heurística de largura.
    if (declaredArea) return { unit: 'dm²', basis: 'roll_area', widthMm, productUnit };

    // Largura de BOBINA → o consumo é dm²/par (napa/couro/forro). NÃO muda.
    if (widthMm >= ROLL_WIDTH_FLOOR_MM) {
      return { unit: 'dm²', basis: 'roll_area', widthMm, productUnit };
    }

    // Largura da PRÓPRIA peça → item linear direto, já na unidade de estoque.
    if (widthMm > 0) {
      return { unit: productUnit, basis: 'native_linear', widthMm, productUnit };
    }

    // Sem largura nenhuma: o comprimento de rolo é o que resta pra distinguir
    // napa descadastrada (segue dm², com o aviso âmbar de largura faltando) de
    // fita nativa. NÃO rotular napa sem largura como 'm': o valor gravado é dm².
    if (hasRollDims) return { unit: 'dm²', basis: 'roll_area', widthMm: 0, productUnit };
    return { unit: productUnit, basis: 'native_linear', widthMm: 0, productUnit };
  }

  // Contagem/massa/volume: a unidade vem do ITEM, não do consumption_unit do
  // grupo — que pode divergir (ELÁSTICO SARJA: grupo 'm', produto 'un', e o
  // operador digitava metro num item vendido por unidade).
  if (productUnit) return { unit: productUnit, basis: 'count', widthMm, productUnit };
  if (consUnit) return { unit: (group.consumption_unit || '').toString().trim(), basis: 'count', widthMm, productUnit };
  if (stored) return { unit: stored, basis: 'unknown', widthMm, productUnit };
  // ⚠ `dimensions_unit` NÃO entra como fallback. Ela é unidade de DIMENSÃO FÍSICA
  // (largura de bobina, espessura, diâmetro) e o default da coluna é 'mm', então
  // ela devolvia "mm" como se fosse unidade de consumo em todo grupo sem item —
  // exatamente o tipo de mentira que esta função existe pra impedir. 'un' é o
  // default honesto: diz "não sei", e não um número de régua.
  return { unit: 'un', basis: 'unknown', widthMm, productUnit };
}

/** Atalho pros call sites que só querem o rótulo. */
export const resolveGroupUnit = (
  groupName: string | null | undefined,
  groups: any[],
  products: any[],
  storedUnit?: string,
  componentSheets: any[] = [],
): string =>
  resolveConsumptionUnit(groupName, groups, products, componentSheets, { storedUnit }).unit;

/** É unidade de ÁREA? (o DXF dá dm² → mapeia direto pro consumo). */
export function isAreaUnit(unit: string | null | undefined): boolean {
  return ['dm²', 'dm2', 'm²', 'm2', 'cm²', 'cm2'].includes((unit || '').toLowerCase());
}
