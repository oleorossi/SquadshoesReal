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

/**
 * Formas de entrada. São LOOSE de propósito: chegam do React Query sobre as
 * tabelas do Supabase (tipos gerados) e dos fixtures de teste, e esta função só
 * lê este punhado de campos. Tipar o que se lê evita o `any` sem acoplar ao
 * schema inteiro.
 */
export interface GroupLike {
  id?: string | null;
  name?: string | null;
  consumption_unit?: string | null;
  dimensions_width?: number | string | null;
  dimensions_length?: number | string | null;
  dimensions_unit?: string | null;
}

export interface ProductLike {
  id?: string | null;
  group_id?: string | null;
  unit?: string | null;
  active?: boolean | null;
}

export interface ComponentSheetLike {
  product_id?: string | null;
  group_id?: string | null;
  dimensions_width?: number | string | null;
  dimensions_length?: number | string | null;
  dimensions_unit?: string | null;
  products?: { group_id?: string | null } | null;
}

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
const pickProduct = (groupId: string | undefined | null, products: ProductLike[]): ProductLike | null => {
  if (!groupId) return null;
  const withUnit = (products || []).filter(p => p.group_id === groupId && norm(p.unit));
  if (withUnit.length === 0) return null;
  const actives = withUnit.filter(p => p.active !== false);
  const pool = actives.length > 0 ? actives : withUnit;
  const isPhysical = (p: ProductLike) => LINEAR_UNITS.has(norm(p.unit)) || PLATE_UNITS.has(norm(p.unit));
  return pool.find(isPhysical) || pool[0];
};

const sheetWidthMm = (cs: ComponentSheetLike | null | undefined): number =>
  toMm(cs?.dimensions_width, cs?.dimensions_unit) || toMm(cs?.dimensions_length, cs?.dimensions_unit);

/**
 * Larguras em mm, na MESMA cascata do SQL: ficha do item → fichas do grupo → grupo.
 *
 * Devolve a representativa E se ALGUMA ficha do grupo tem largura de bobina.
 *
 * ⚠ `anyRoll` existe porque o rótulo é UM POR GRUPO e o débito é POR SKU. Numa
 * família com ficha nova em 25 mm e ficha legada em 1370 (acontece: as 26 fichas
 * de TIRA OVERLOCK 5MM estão em 1370 mm), escolher a representativa pela ordem do
 * array faria a tela afirmar "sem conversão" num grupo onde metade das cores
 * divide por 137 — e `useProducts` ordena por `updated_at DESC`, então a ordem
 * MUDA sozinha. Com `anyRoll`, a dúvida cai para o lado seguro (dm², o status quo).
 */
const resolveWidths = (
  group: GroupLike | null,
  product: ProductLike | null,
  componentSheets: ComponentSheetLike[],
): { widthMm: number; anyRoll: boolean } => {
  const sheets = componentSheets || [];
  const ofGroup = sheets.filter(cs => cs.group_id === group?.id || cs.products?.group_id === group?.id);
  const own = product ? sheets.find(cs => cs.product_id === product.id) : null;

  const anyRoll = [own, ...ofGroup].some(cs => cs && sheetWidthMm(cs) >= ROLL_WIDTH_FLOOR_MM);

  const ownWidth = sheetWidthMm(own);
  if (ownWidth > 0) return { widthMm: ownWidth, anyRoll };
  for (const cs of ofGroup) {
    const w = sheetWidthMm(cs);
    if (w > 0) return { widthMm: w, anyRoll };
  }
  return { widthMm: toMm(group?.dimensions_width, group?.dimensions_unit), anyRoll };
};

export function resolveConsumptionUnit(
  groupName: string | null | undefined,
  groups: GroupLike[],
  products: ProductLike[],
  componentSheets: ComponentSheetLike[] = [],
  opts?: { groupId?: string | null; storedUnit?: string | null },
): ResolvedConsumptionUnit {
  const stored = (opts?.storedUnit ?? '').toString().trim();
  const byId = opts?.groupId ? (groups || []).find(g => g.id === opts.groupId) : null;
  const key = norm(groupName);
  const group: GroupLike | null = byId || (key ? (groups || []).find(g => norm(g.name) === key) : null) || null;

  if (!group) {
    return { unit: stored || 'un', basis: 'unknown', widthMm: 0, productUnit: '' };
  }

  const product = pickProduct(group.id, products);
  const productUnit = (product?.unit ?? '').toString().trim();
  const pu = norm(productUnit);
  const { widthMm, anyRoll } = resolveWidths(group, product, componentSheets);

  // Produto vendido em PLACA/área: o consumo é digitado em dm²/par e o motor
  // divide pela ÁREA da placa (`convertDm2ToPlates` = largura × comprimento).
  // O rótulo é 'dm²', NÃO 'placa' — rotular 'placa' faria o operador digitar
  // placas num campo que o motor lê como área.
  if (PLATE_UNITS.has(pu)) {
    return { unit: 'dm²', basis: 'roll_area', widthMm, productUnit };
  }

  if (LINEAR_UNITS.has(pu)) {
    // Item linear direto exige certeza: TODA largura conhecida do grupo tem de
    // estar abaixo do piso. Qualquer outro caso cai em dm² — que é o status quo
    // e o que o motor faz.
    //
    // ⚠ Sem largura em lugar nenhum (`widthMm === 0`) é CADASTRO INCOMPLETO, não
    // fita: o motor devolve o valor cru marcado `widthMissing` e o CLAUDE.md manda
    // manter dm² com o aviso âmbar. Rotular 'm' aqui faria a tela dizer "sem
    // conversão" enquanto o motor grita "largura faltando, ~100× inflado".
    //
    // ⚠ NÃO reintroduzir um ramo por `consumption_unit`: o SQL
    // `get_material_conversion_info` não lê essa coluna, então qualquer decisão
    // baseada nela diverge do motor — e `consumption_unit` é 'm' tanto na napa
    // quanto no elástico, ou seja, não distingue nada.
    if (widthMm > 0 && widthMm < ROLL_WIDTH_FLOOR_MM && !anyRoll) {
      return { unit: productUnit, basis: 'native_linear', widthMm, productUnit };
    }
    return { unit: 'dm²', basis: 'roll_area', widthMm, productUnit };
  }

  // Contagem/massa/volume: a unidade vem do ITEM, não do consumption_unit do
  // grupo — que pode divergir (ELÁSTICO SARJA: grupo 'm', produto 'un', e o
  // operador digitava metro num item vendido por unidade).
  if (productUnit) return { unit: productUnit, basis: 'count', widthMm, productUnit };
  const consUnit = (group.consumption_unit || '').toString().trim();
  if (consUnit) return { unit: consUnit, basis: 'count', widthMm, productUnit };
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
  groups: GroupLike[],
  products: ProductLike[],
  storedUnit?: string,
  componentSheets: ComponentSheetLike[] = [],
): string =>
  resolveConsumptionUnit(groupName, groups, products, componentSheets, { storedUnit }).unit;

/** É unidade de ÁREA? (o DXF dá dm² → mapeia direto pro consumo). */
export function isAreaUnit(unit: string | null | undefined): boolean {
  return ['dm²', 'dm2', 'm²', 'm2', 'cm²', 'cm2'].includes((unit || '').toLowerCase());
}

/**
 * Unidade do campo `component_sheets.yield_per_size` (tela Materiais → Ficha de
 * Componente, aba "Consumo/Par").
 *
 * É OUTRO campo e OUTRA semântica que o `*_consumption` da ficha técnica — por
 * isso não passa por `resolveConsumptionUnit`. Espelha o ramo do motor em
 * `calculateConsumptionWithUnit`:
 *
 *   const isLinear = LINEAR_UNITS.has(products.unit)
 *   if (isLinear && yieldHasData && !hasDm2Override) → os yields JÁ estão na
 *       unidade linear do item (m ou cm) e saem como 'metro'
 *   senão → o total é tratado como dm² (placa/área)
 *
 * Ou seja: para item linear a unidade é a DO ITEM; só fora disso é dm².
 *
 * ⚠ A tela dizia "Consumo por Par (dm²)" fixo. Para item linear isso mentia:
 * o operador digitava achando que era área e o motor lia como metro. Medido em
 * 12/10/2026 na ficha EC111 (cabedal NEW VELVET, largura 1370 mm, yield 36):
 * o motor devolvia 36 m/par onde 36 dm² seriam 0,2628 m/par — 137× (decisão do
 * dono: o rótulo é que estava errado, a unidade exibida sai do item).
 */
export function resolveYieldUnit(productUnit: string | null | undefined): string {
  const raw = (productUnit ?? '').toString().trim();
  return LINEAR_UNITS.has(norm(raw)) ? raw : 'dm²';
}
