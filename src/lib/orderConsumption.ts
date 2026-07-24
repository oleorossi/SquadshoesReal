import { supabase } from '@/integrations/supabase/client';
import {
  calculateGradeBasedDm2,
  calculateConsumptionWithUnit,
  isLinearWidthMissing,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
  convertToProductUnit,
  getPreferredComponentSheet as getPreferredComponentSheetFromCandidates,
  normalizeText,
  normalizeColorKey,
  LINEAR_UNITS,
} from '@/lib/materialConsumption';
import { calculateStrapConsumptionCm, resolveOrderStraps } from '@/lib/strapConsumption';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from '@/lib/packagingPairsPerBox';

/**
 * Motor CANÔNICO de consumo de materiais.
 *
 * Extração FIEL do cálculo que vivia inline em
 * `src/components/sale-orders/MaterialConsumptionDialog.tsx` (`loadConsumption`).
 * Agora é a fonte única usada por:
 *   - o modal "Consumo de Materiais" (por PEDIDO/PV — agrega todos os itens), e
 *   - a ficha do operador (por ORDEM DE PRODUÇÃO via `useBulkOrderConsumption`,
 *     onde 1 OP = 1 `sale_order_item` = referência + cor + grade).
 *
 * Antes a ficha puxava de um caminho SQL divergente (`calculate_order_consumption`),
 * o que produzia nomes/quantidades desalinhados vs. o modal. Religar os dois ao
 * MESMO motor garante paridade por construção.
 *
 * Regra de cálculo: ver CLAUDE.md → "Regra de cálculo de consumo de materiais
 * (CANÔNICA)". Em resumo: um valor armazenado como dm²/par (área) NUNCA é exibido
 * cru — converte pra unidade física pela LARGURA da ficha de componente (napa/couro
 * → metros lineares; placa → nº de placas). Itens lineares diretos sem ficha (tiras/
 * elásticos) já estão na unidade nativa e NÃO convertem. Palmilha = PLACA (base) +
 * FORRAÇÃO (napa do forro). Solado é por par, segmentado por numeração.
 *
 * ⚠ Este módulo calcula APENAS o consumo previsto. A disponibilidade em estoque
 * (verde/vermelho) é responsabilidade de quem exibe — vive no modal, pois depende
 * do momento da consulta e a ficha do operador não precisa dela.
 *
 * ⚠ O caminho SQL (`calculate_order_consumption*`) CONTINUA existindo para
 * custeio/MRP (agregação de compra) — fora do escopo deste motor de UI.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Linha de consumo no formato canônico (igual ao do modal). */
export type MaterialConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
  widthMissing?: boolean;
  /** Aviso não-bloqueante exibido pelo modal (ex.: solado fachetado sem specs
   *  de fachete). A linha entra mesmo com `totalQuantity` 0 só pra alertar que
   *  há consumo NÃO calculado por falta de cadastro. Espelha o
   *  `consumption_warning` do SQL `calculate_order_consumption_by_grade`. */
  warning?: string;
  /** Breakdown agregado por numeração (somado entre items que casam em
   *  grupo+cor+unidade). Usado pelo Solado pra mostrar totais reais por Nº. */
  sizeBreakdown?: Record<string, number>;
  /** Solado: id do produto-solado (por cor) resolvido. Permite ao modal puxar
   *  o `stock_grade` exato dessa variante, mesmo agrupando por MODELO (grupo)
   *  cujo nome difere do nome do produto (ex.: grupo "SOLADO 204" × produto
   *  "204 - CARAMELO"). Mesma cor sempre cai no mesmo produto dentro do grupo. */
  soleProductId?: string | null;
  /**
   * Família de material-base (napa) da linha, pra segmentar consumo por
   * cor × família — NAPA SOFT e NAPA MADRID não se juntam na mesma cor.
   * Regra de negócio: a base de uma TIRA artesanal segue a napa da FICHA
   * TÉCNICA da referência (cabedal/forro), não a base fixa da receita
   * (sem mistura dentro de uma referência). Só é preenchido em linha de
   * TIRA (`componentType === 'Tiras'`); nas linhas de napa DIRETA
   * (cabedal/forração) a própria `groupName` já é a família. Ver
   * `specs/tira-base-napa-por-ficha-tecnica.md`. */
  materialFamily?: string | null;
  /**
   * Produtos EXATOS que originaram a linha, quando o consumo veio de um cadastro
   * que já aponta o `product_id` (componentes diretos, BOM, itens-padrão do
   * solado). Existe pra a DISPONIBILIDADE ser medida no produto certo:
   * `consumptionRows.groupAvailable` media o estoque do GRUPO inteiro quando a
   * linha não tem cor, e a Fivela 12mm (estoque 1, reservado 1728) aparecia com
   * "em estoque 4.241" e check verde no PV-00147 — era o estoque do Binóculo
   * 10mm Strass, vizinho de grupo (COMPONENTES DIVERSOS). Vazio nas linhas
   * derivadas de grupo+cor (cabedal/forro/palmilha), que seguem no match por cor.
   */
  productIds?: string[];
};

/**
 * Item de consumo. Espelha EXATAMENTE o que o modal lê de `sale_order_items`
 * + join `technical_sheets`. Para a ficha do operador, montamos um destes por OP.
 */
export type ConsumptionItem = {
  reference_id: string;
  color: string | null;
  quantity: number;
  /** Grade BASE (por 1 ficha fechada). O total real vem de `quantity`. */
  grade?: Record<string, number> | null;
  fichas?: number | null;
  strap_colors?: any[] | null;
  /**
   * Variante de material do item do PV (`sale_order_items.material_variant_id`).
   * Quando presente, troca a ORIGEM do material por componente (cabedal/forro/
   * palmilha/solado + BOM), espelhando os resolvers SQL
   * `resolve_*_material_for_variant` (migration 20260907120500). A área (dm²/par)
   * permanece a da ficha — a variante só muda de QUAL grupo/produto o material sai.
   */
  material_variant_id?: string | null;
  /** Linha da ficha técnica (join `technical_sheets(...)`). */
  technical_sheets: any;
  /**
   * Modo de embalagem do PEDIDO (`sale_orders.packaging_mode`: colmeia /
   * individual / individual_master / individual_fitilho / individual_amarrado).
   * Quando presente e a ficha tem VÁRIAS caixas no BOM, o consumo mostra só a
   * caixa do modo escolhido. Opcional — callers que não sabem o modo (ex.: ficha
   * de operador por OP) passam undefined e o filtro não age.
   */
  packagingMode?: string | null;
};

/** Campos de resolução de uma variante de material (`reference_material_variants`).
 *  Precedência POR COMPONENTE (espelho dos resolvers SQL, mig 20260907120500):
 *  produto legado pinado > grupo da variante (+cor do PV) > pin da ficha > grupo da ficha. */
export type MaterialVariantResolution = {
  id: string;
  reference_id: string;
  upper_material_product_id: string | null;
  upper_material_group_id: string | null;
  upper_consumption_override: number | null;
  lining_material_product_id: string | null;
  lining_material_group_id: string | null;
  lining_consumption_override: number | null;
  insole_material_product_id: string | null;
  insole_material_group_id: string | null;
  insole_consumption_override: number | null;
  sole_material_product_id: string | null;
  sole_consumption_override: number | null;
};

/** Contexto compartilhado: as consultas e mapas que o cálculo precisa. */
export type ConsumptionContext = {
  materials: any[];
  allProducts: any[];
  productGroups: any[];
  componentSheets: any[];
  soleColorMap: Map<string, string>;
  palmilhaColorMap: Map<string, { color: string; productId: string | null }>;
  palmilhaDefaultMap: Map<string, { color: string; productId: string | null }>;
  liningColorMap: Map<string, string>;
  liningDefaultMap: Map<string, string>;
  sheetStrapsMap: Map<string, any[]>;
  /** sheet_id → sole_group_id (do solado vinculado à ficha). */
  sheetSoleGroupMap: Map<string, string>;
  /** sole_group_id → conjugações ativas (regras cabedal→cor-do-solado). */
  soleConjugationsByGroup: Map<string, Array<{ cabedal_color: string; palmilha_color: string; is_default: boolean }>>;
  /** (sheet_id::cor) → sole_group_id de mappings LEGADOS de
   *  technical_sheet_sole_colors SEM sole_product_id (P2 do resolve_sole_color:
   *  resolve pro produto do grupo com maior estoque). Opcional (testes antigos). */
  soleColorGroupMap?: Map<string, string>;
  /** sheet_id → primary_sole_id da ficha técnica (P3 do resolve_sole_color).
   *  Opcional (testes antigos). */
  sheetPrimarySoleMap?: Map<string, string>;
  /** sole_product_id → consumo de FACHETE por numeração (dm²/par), de
   *  `sole_technical_specs.fachete_lining_consumption_dm2`. Só solados fachetados. */
  facheteSpecBySole: Map<string, Record<string, number>>;
  /** sole_product_id → consumo do FORRO DO CABEDAL por numeração (dm²/par), de
   *  `sole_technical_specs.lining_consumption_dm2`. Fonte do consumo do forro
   *  (2026-07-01): a ficha do modelo só escolhe o grupo/cor; o consumo é por
   *  solado. Espelha o fallback `v_spec.lining_consumption_dm2` do SQL by_grade.
   *  Opcional (testes antigos constroem o contexto sem ele). */
  liningSpecBySole?: Map<string, Record<string, number>>;
  /** sole_product_id → PALMILHA PLACA por numeração (dm²/par), de
   *  `sole_technical_specs.insole_consumption_dm2`. Espelha o forro: a fonte da
   *  palmilha (placa) é o SOLADO por número, igual ao SQL by_grade (fallback
   *  `v_spec.insole_consumption_dm2`). Opcional. */
  insoleSpecBySole?: Map<string, Record<string, number>>;
  /** sole_product_id → PALMILHA FORRAÇÃO por numeração (dm²/par), de
   *  `sole_technical_specs.insole_lining_consumption_dm2`. Espelha o SQL
   *  (`v_spec.insole_lining_consumption_dm2`). Opcional. */
  insoleLiningSpecBySole?: Map<string, Record<string, number>>;
  /** (sheet_id::corPredominanteNormalizada) → lista de componentes por cor
   *  (opt-in via technical_sheets.component_colors_enabled). Espelha o gate SQL:
   *  quando a flag está ligada e há entrada pra a cor do pedido, esta lista
   *  SUBSTITUI direct_components. Opcional (testes antigos não constroem). */
  componentColorMap?: Map<string, Array<{ productId: string; quantityPerUnit: number }>>;
  /** variant_id → campos de resolução da variante de material do item do PV.
   *  Opcional (testes antigos e callers sem variante não constroem). */
  materialVariantsById?: Map<string, MaterialVariantResolution>;
  /** sole_product_id → itens-padrão do solado por numeração
   *  (`sole_standard_items_consumption`: colas/químicos com consumo POR NÚMERO,
   *  na unidade cadastrada — ex.: g/par). Espelha o ramo "Item padrão (solado)"
   *  do SQL by_grade: o motor TS emite essas linhas com o MESMO dedup anti-BOM
   *  (produto coberto pelo item-padrão sai do BOM/direct). Opcional (testes
   *  antigos não constroem). Auditoria F2-01. */
  soleStandardItemsBySole?: Map<string, Array<{ standardItemId: string; size: number; consumption: number; unit: string | null }>>;
};

/**
 * Colunas de `technical_sheets` que o motor lê — espelho EXATO do join usado
 * pelo modal (`sale_order_items → technical_sheets(...)`), com `id` a mais para
 * permitir o fetch standalone por referência (ficha do operador).
 *
 * ⚠ Mantenha em sincronia com o `select` do modal: alterar um lado exige o outro.
 * ⚠ TODA coluna lida via `sheet.*` em `computeConsumptionForItems` PRECISA estar
 *   aqui — se faltar, o campo chega `undefined` e a regra que depende dele vira
 *   no-op silencioso (o TS loose não acusa). `sole_drives_consumption` é o exemplo
 *   canônico: sem ela `suppressCabedalForracao` (=== true) nunca dispara e a
 *   "Forração" (cabedal) fantasma aparece junto da "Forração Palmilha" — mesma
 *   napa contada 2× — no modal e na ficha de Corte Forração (espelha o SQL
 *   by_grade, migration 20260911120000). Guardado por teste em
 *   `orderConsumption.test.ts`. (Nota: é uma string de `.select()` PostgREST —
 *   NÃO comentar dentro dela; PostgREST não entende comentários.)
 */
export const TECHNICAL_SHEET_CONSUMPTION_COLUMNS = `
  id,
  upper_material,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  lining_consumption_per_size,
  insole_material,
  insole_consumption,
  insole_has_lining,
  insole_ready_made,
  insole_lining_consumption,
  sole_material,
  sole_consumption,
  sole_color,
  sole_group_id,
  sole_drives_consumption,
  lining_accessories,
  components_accessories,
  direct_components,
  component_colors_enabled
`;

/** Mapas mínimos pra resolução canônica de solado (prioridade P0–P3 do
 *  resolve_sole_color SQL). Subconjunto de ConsumptionContext — exportado pra
 *  Lista de Separação (bomConsumption.ts) usar a MESMA cascata sem duplicar
 *  lógica (auditoria 2026-07-19, BOM-2). */
export type SoleResolutionMaps = {
  sheetSoleGroupMap: Map<string, string>;
  soleConjugationsByGroup: Map<string, Array<{ cabedal_color: string; palmilha_color: string; is_default: boolean }>>;
  soleColorMap: Map<string, string>;
  soleColorGroupMap?: Map<string, string>;
  sheetPrimarySoleMap?: Map<string, string>;
  allProducts: any[];
};

/** Normalização case/acento-insensitive ("Caramelo" = "CARAMELO", "Café" = "Cafe"). */
const normColorCanonical = (s: string | null | undefined): string =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Resolve produto-solado por (sheet_id, cor cabedal) — espelha a PRIORIDADE
 * CANÔNICA do resolve_sole_color vivo no banco (migration 20260706170000):
 *   P0  coligação de cor (sole_color_conjugations): match exato → default '*',
 *       produto do sole_group_id na cor-alvo com MAIOR estoque;
 *   P1  mapping explícito (technical_sheet_sole_colors com sole_product_id);
 *   P2  mapping legado sem produto (só sole_group_id) → maior estoque do grupo;
 *   P3  primary_sole_id da ficha técnica.
 * Fonte ÚNICA da cascata pro modal/fichas (computeConsumptionForItems) e pra
 * Lista de Separação (bomConsumption.ts).
 */
export function resolveSoleProductIdCanonical(
  refId: string,
  cabedalColor: string,
  maps: SoleResolutionMaps,
): string | null {
  const {
    sheetSoleGroupMap,
    soleConjugationsByGroup,
    soleColorMap,
    allProducts,
  } = maps;
  const soleColorGroupMap = maps.soleColorGroupMap ?? new Map<string, string>();
  const sheetPrimarySoleMap = maps.sheetPrimarySoleMap ?? new Map<string, string>();
  const normColor = normColorCanonical;
  const colorNorm = normColor(cabedalColor);

  // P0 — coligação de cor por sole_group_id da ficha.
  const soleGroupId = sheetSoleGroupMap.get(refId);
  if (soleGroupId && colorNorm) {
    const rules = soleConjugationsByGroup.get(soleGroupId) || [];
    let targetColor: string | null =
      rules.find(r => normColor(r.cabedal_color) === colorNorm)?.palmilha_color || null;
    if (!targetColor) targetColor = rules.find(r => r.is_default)?.palmilha_color || null;
    if (targetColor) {
      const targetNorm = normColor(targetColor);
      const candidates = (allProducts || [])
        .filter((x: any) => x.group_id === soleGroupId && normColor(x.color) === targetNorm)
        .sort((a: any, b: any) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
      if (candidates[0]) return candidates[0].id;
    }
  }

  // P1 — mapping explícito. Chave normalizada (NFD+lower) — consistente com o
  // build do soleColorMap; depois scan normalizado via normColor (≡ normalizeColorKey).
  const direct = soleColorMap.get(`${refId}::${normalizeColorKey(cabedalColor)}`);
  if (direct) return direct;
  for (const [k, v] of soleColorMap.entries()) {
    const sep = k.indexOf('::');
    if (sep < 0 || k.slice(0, sep) !== refId) continue;
    if (normColor(k.slice(sep + 2)) === colorNorm) return v;
  }

  // P2 — mapping legado sem sole_product_id → produto do grupo com maior estoque.
  let fallbackGroupId = soleColorGroupMap.get(`${refId}::${cabedalColor}`) || null;
  if (!fallbackGroupId) {
    for (const [k, v] of soleColorGroupMap.entries()) {
      const sep = k.indexOf('::');
      if (sep < 0 || k.slice(0, sep) !== refId) continue;
      if (normColor(k.slice(sep + 2)) === colorNorm) { fallbackGroupId = v; break; }
    }
  }
  if (fallbackGroupId) {
    const byStock = (allProducts || [])
      .filter((x: any) => x.group_id === fallbackGroupId)
      .sort((a: any, b: any) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
    if (byStock[0]) return byStock[0].id;
  }

  // P3 — primary_sole_id da ficha técnica (allProducts já filtra active=true).
  const primary = sheetPrimarySoleMap.get(refId);
  if (primary && (allProducts || []).some((x: any) => x.id === primary)) return primary;

  return null;
}

/**
 * Espelho TS de `resolve_material_product(grupo, cor)` (SQL vivo) — a cascata
 * canônica de escolha do PRODUTO dentro de um grupo:
 *   1. cor EXATA (case/acento-insensitive), maior estoque;
 *   2. cor contida no NOME do produto (partial_name), maior estoque;
 *   3. qualquer produto do grupo, maior estoque (color_mismatch/group_generic);
 * sem cor → maior estoque do grupo (group_fallback).
 * Usada pra alinhar a resolução de produto do motor TS (Palmilha/Fachete) ao
 * caminho SQL (custeio/débito/reserva) — auditoria F2-03/F2-09.
 */
export function resolveMaterialProductCanonical(
  groupName: string,
  color: string | null | undefined,
  allProducts: any[],
  productGroups: any[],
): any | null {
  if (!groupName) return null;
  const group = (productGroups || []).find((g: any) => g.name === groupName);
  if (!group) return null;
  const byStock = (allProducts || [])
    .filter((p: any) => p.group_id === group.id)
    .sort((a: any, b: any) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
  if (byStock.length === 0) return null;
  const colorNorm = normColorCanonical(color === '—' ? '' : color);
  if (colorNorm) {
    const exact = byStock.find((p: any) => normColorCanonical(p.color) === colorNorm);
    if (exact) return exact;
    const partial = byStock.find((p: any) => normColorCanonical(p.name).includes(colorNorm));
    if (partial) return partial;
  }
  return byStock[0];
}

/** Classifica um material de BOM (sheet_materials) num componentType. */
export const classifyBomMaterial = (groupName: string, productName: string, category: string): string => {
  const normalized = `${groupName} ${productName} ${category}`.toLowerCase();
  if (normalized.includes('cabedal') || normalized.includes('napa') || normalized.includes('velvet') || normalized.includes('couro')) return 'Cabedal';
  if (normalized.includes('solado')) return 'Solado';
  if (normalized.includes('palmilha') || normalized.includes('placa')) return 'Palmilha';
  if (normalized.includes('forração') || normalized.includes('forracao') || normalized.includes('forro')) return 'Forração';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('cola') || normalized.includes('adesivo')) return 'Químicos';
  if (normalized.includes('embalagem') || normalized.includes('caixa')) return 'Embalagem';
  return 'Outros';
};

/** Área da placa em dm² a partir das dimensões do grupo (mm por padrão). */
export const calcGroupPlateAreaDm2 = (group: any): number => {
  if (!group?.dimensions_length || !group?.dimensions_width) return 0;
  const unit = (group.dimensions_unit || 'mm').toLowerCase();
  let l = Number(group.dimensions_length);
  let w = Number(group.dimensions_width);
  if (unit === 'cm') { l *= 10; w *= 10; }
  if (unit === 'm') { l *= 1000; w *= 1000; }
  return (l * w) / 10000;
};

/** Unidades de ESTOQUE de área (canônica `dm²` + grafias legadas). Diferente de
 *  PLATE_UNITS (materialConsumption.ts), aqui `placa` fica DE FORA: estoque
 *  contado em placas compara em placas; estoque medido em área compara em dm². */
const AREA_STOCK_UNITS = new Set(['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']);
const isAreaStockUnit = (unit?: string | null): boolean =>
  AREA_STOCK_UNITS.has((unit || '').toLowerCase().trim());

/** Acumula uma linha no mapa, somando por (componentType, grupo, cor, unidade). */
const addConsumptionRow = (map: Map<string, MaterialConsumptionRow>, row: MaterialConsumptionRow) => {
  const totalQuantity = Number(row.totalQuantity) || 0;
  const groupName = row.groupName?.trim();
  if (!groupName) return;
  // Linhas SÓ de aviso (ex.: fachete sem specs) entram com qtd 0 pra alertar;
  // as demais linhas de qtd zero continuam descartadas como antes.
  if (totalQuantity <= 0 && !row.warning) return;

  const productUnit = row.productUnit?.trim() || 'un';
  const color = row.color?.trim() || '—';
  const materialName = row.materialName?.trim() || groupName;
  // O nome do material entra na chave: dois PRODUTOS diferentes do mesmo grupo,
  // cor e unidade são materiais distintos, não a mesma linha (PV-00147: "Binóculo
  // 10mm" e "Binóculo 10mm Strass", ambos COMPONENTES DIVERSOS/OURO LIGHT/un,
  // colapsavam numa linha só — somava 4+4 un/par e rotulava com o primeiro nome,
  // escondendo o segundo binóculo do modal e da ficha de operador). O mesmo
  // produto vindo de items/refs diferentes continua somando (nome idêntico).
  // A família entra na chave: mesma TIRA+cor cortada de napas diferentes
  // (NAPA SOFT × NAPA MADRID, conforme a ficha de cada referência) são linhas
  // distintas — sem isso colapsariam e a napa da minoria sumiria. Vazio nas
  // linhas de napa direta (a groupName já é a família) → chave inalterada.
  const materialFamily = (row.materialFamily || '').trim();
  const key = `${row.componentType}||${groupName}||${materialName}||${color}||${productUnit}||${materialFamily}`;
  const existing = map.get(key);

  if (existing) {
    existing.totalQuantity += totalQuantity;
    if (row.widthMissing) existing.widthMissing = true;
    if (row.warning && !existing.warning) existing.warning = row.warning;
    // Soma breakdown por numeração quando ambos têm (Solado).
    if (row.sizeBreakdown) {
      existing.sizeBreakdown = existing.sizeBreakdown || {};
      for (const [size, qty] of Object.entries(row.sizeBreakdown)) {
        existing.sizeBreakdown[size] = (existing.sizeBreakdown[size] || 0) + qty;
      }
    }
    // Mesma cor → mesma variante de produto; preserva o id já gravado.
    if (row.soleProductId && !existing.soleProductId) existing.soleProductId = row.soleProductId;
    // União dos produtos de origem (a linha pode somar o mesmo material vindo de
    // itens/refs diferentes) — a disponibilidade soma o estoque de todos eles.
    if (row.productIds?.length) {
      const merged = new Set(existing.productIds || []);
      for (const id of row.productIds) if (id) merged.add(id);
      existing.productIds = [...merged];
    }
    return;
  }

  map.set(key, {
    componentType: row.componentType,
    groupName,
    materialName,
    productUnit,
    color,
    totalQuantity,
    widthMissing: row.widthMissing,
    warning: row.warning,
    sizeBreakdown: row.sizeBreakdown,
    soleProductId: row.soleProductId,
    materialFamily: row.materialFamily || null,
    productIds: row.productIds?.length ? [...new Set(row.productIds.filter(Boolean))] : undefined,
  });
};

/**
 * Busca a linha de `technical_sheets` (colunas de consumo) por referência.
 * Usado pela ficha do operador, que parte de IDs de referência (não tem o join
 * que o modal ganha de graça via `sale_order_items`).
 */
export async function fetchTechnicalSheetsForConsumption(
  refIds: string[],
): Promise<Map<string, any>> {
  const unique = [...new Set(refIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await (supabase as any)
    .from('technical_sheets')
    .select(TECHNICAL_SHEET_CONSUMPTION_COLUMNS)
    .in('id', unique);
  if (error) throw error;
  const m = new Map<string, any>();
  for (const s of (data || []) as any[]) m.set(s.id, s);
  return m;
}

/**
 * Roda as consultas de contexto (idênticas às do modal) e monta os mapas de
 * resolução de cor (solado/palmilha/forro) + straps. Reutilizável por qualquer
 * caller (modal por PV ou ficha por OP).
 */
export async function fetchConsumptionContext(refIds: string[]): Promise<ConsumptionContext> {
  const unique = [...new Set(refIds.filter(Boolean))];

  const [{ data: materials, error: materialsError }, { data: allProducts }, { data: productGroups }, { data: componentSheets }, { data: sheetStrapData }, { data: soleColorMappings }, { data: palmilhaColorMappings }, { data: liningColorMappings }, { data: sheetSoleGroups }, { data: componentColorMappings }, { data: materialVariants }] = await Promise.all([
    supabase
      .from('sheet_materials')
      // `material_variant_id`: NULL = linha compartilhada (todas as variantes);
      // preenchido = linha específica/override daquela variante (semântica de
      // get_effective_bom, migration 20260525140000). O escopo é aplicado no
      // motor, por item.
      .select('sheet_id, product_id, group_id, quantity_per_unit, color, material_variant_id, products(name, unit, category, color), product_groups!sheet_materials_group_id_fkey(name)')
      .in('sheet_id', unique),
    supabase
      .from('products')
      // `unit` entrou pra resolução da unidade de ESTOQUE da palmilha (fix
      // auditoria motores 2026-07-01: linha em dm² quando o estoque é em dm²).
      // `category` entrou pra classificar os itens-padrão do solado (F2-01).
      .select('id, name, unit, color, category, group_id, quantity, reserved_stock, stock_grade, sole_classification, is_fachetado, fachete_material_group_id')
      .eq('active', true),
    supabase
      .from('product_groups')
      .select('id, name, dimensions_length, dimensions_width, dimensions_unit'),
    supabase
      .from('component_sheets')
      .select('product_id, dimensions_width, dimensions_length, dimensions_unit, yield_per_size, yield_per_sole, waste_pct, products!inner(group_id, name, color, unit)'),
    supabase
      .from('technical_sheets')
      .select('id, strap_colors')
      .in('id', unique),
    (supabase as any).from('technical_sheet_sole_colors').select('sheet_id, product_color, sole_product_id, sole_group_id').in('sheet_id', unique),
    (supabase as any).from('technical_sheet_palmilha_colors').select('sheet_id, cabedal_color, palmilha_color, palmilha_product_id').in('sheet_id', unique),
    (supabase as any).from('technical_sheet_lining_colors').select('sheet_id, cabedal_color, lining_color').in('sheet_id', unique),
    supabase.from('technical_sheets').select('id, sole_group_id, primary_sole_id').in('id', unique),
    (supabase as any).from('technical_sheet_component_colors').select('sheet_id, cabedal_color, product_id, quantity_per_unit').in('sheet_id', unique),
    // Variantes de material das fichas envolvidas — o motor resolve por item
    // (item.material_variant_id) com a MESMA precedência dos resolvers SQL.
    (supabase as any)
      .from('reference_material_variants')
      .select('id, reference_id, upper_material_product_id, upper_material_group_id, upper_consumption_override, lining_material_product_id, lining_material_group_id, lining_consumption_override, insole_material_product_id, insole_material_group_id, insole_consumption_override, sole_material_product_id, sole_consumption_override')
      .in('reference_id', unique),
  ]);

  if (materialsError) throw materialsError;

  // (sheet_id, cor do cabedal) → produto-solado específico
  const soleColorMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (m.sole_product_id) soleColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.product_color)}`, m.sole_product_id);
  }
  // Mappings LEGADOS sem sole_product_id (só sole_group_id) — P2 do
  // resolve_sole_color: o produto é escolhido pelo maior estoque do grupo.
  const soleColorGroupMap = new Map<string, string>();
  for (const m of (soleColorMappings || []) as any[]) {
    if (!m.sole_product_id && m.sole_group_id) soleColorGroupMap.set(`${m.sheet_id}::${m.product_color}`, m.sole_group_id);
  }
  // Chaves de cor com normalizeColorKey (case+acento) — toLowerCase puro deixava
  // "Café" ≠ "CAFE" escapar do mapeamento (auditoria 2026-07-19, COLOR-1).
  const palmilhaColorMap = new Map<string, { color: string; productId: string | null }>();
  for (const m of (palmilhaColorMappings || []) as any[]) {
    palmilhaColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.cabedal_color)}`, { color: m.palmilha_color, productId: m.palmilha_product_id });
  }
  const palmilhaDefaultMap = new Map<string, { color: string; productId: string | null }>();
  for (const m of (palmilhaColorMappings || []) as any[]) {
    if (m.cabedal_color === '__DEFAULT__') palmilhaDefaultMap.set(m.sheet_id, { color: m.palmilha_color, productId: m.palmilha_product_id });
  }

  const liningColorMap = new Map<string, string>();
  for (const m of (liningColorMappings || []) as any[]) {
    liningColorMap.set(`${m.sheet_id}::${normalizeColorKey(m.cabedal_color)}`, m.lining_color);
  }
  const liningDefaultMap = new Map<string, string>();
  for (const m of (liningColorMappings || []) as any[]) {
    if (m.cabedal_color === '__DEFAULT__') liningDefaultMap.set(m.sheet_id, m.lining_color);
  }

  // Componentes por cor (opt-in). Chave (sheet_id::corNormalizada) → lista de
  // {productId, quantityPerUnit}. normalizeColorKey = lower+sem-acento, igual ao
  // lower(btrim(unaccent(...))) do SQL — mantém a paridade do match de cor.
  const componentColorMap = new Map<string, Array<{ productId: string; quantityPerUnit: number }>>();
  for (const m of (componentColorMappings || []) as any[]) {
    if (!m.product_id) continue;
    const key = `${m.sheet_id}::${normalizeColorKey(m.cabedal_color)}`;
    const arr = componentColorMap.get(key) || [];
    arr.push({ productId: m.product_id, quantityPerUnit: Number(m.quantity_per_unit) || 0 });
    componentColorMap.set(key, arr);
  }

  // variant_id → campos de resolução da variante de material
  const materialVariantsById = new Map<string, MaterialVariantResolution>();
  for (const v of (materialVariants || []) as MaterialVariantResolution[]) {
    if (v?.id) materialVariantsById.set(v.id, v);
  }

  // reference_id → strap_colors da ficha
  const sheetStrapsMap = new Map<string, any[]>();
  for (const s of (sheetStrapData || [])) {
    if (Array.isArray((s as any).strap_colors)) sheetStrapsMap.set((s as any).id, (s as any).strap_colors as any[]);
  }

  // sheet_id → sole_group_id (pra resolver coligação)
  const sheetSoleGroupMap = new Map<string, string>();
  for (const s of (sheetSoleGroups || []) as any[]) {
    if (s.id && s.sole_group_id) sheetSoleGroupMap.set(s.id, s.sole_group_id);
  }

  // sheet_id → primary_sole_id (P3/último fallback do resolve_sole_color)
  const sheetPrimarySoleMap = new Map<string, string>();
  for (const s of (sheetSoleGroups || []) as any[]) {
    if (s.id && (s as any).primary_sole_id) sheetPrimarySoleMap.set(s.id, (s as any).primary_sole_id);
  }

  // Coligações cabedal → cor-do-solado por sole_group_id (regra independente
  // da sole_classification — mesmo fix do resolve_sole_color SQL).
  const soleConjugationsByGroup = new Map<
    string,
    Array<{ cabedal_color: string; palmilha_color: string; is_default: boolean }>
  >();
  const soleGroupIds = Array.from(new Set(sheetSoleGroupMap.values()));
  if (soleGroupIds.length > 0) {
    const { data: conjugations } = await (supabase as any)
      .from('sole_color_conjugations')
      .select('sole_group_id, cabedal_color, palmilha_color, is_default, active')
      .in('sole_group_id', soleGroupIds)
      .eq('active', true);
    for (const c of (conjugations || []) as any[]) {
      const arr = soleConjugationsByGroup.get(c.sole_group_id) || [];
      arr.push({ cabedal_color: c.cabedal_color, palmilha_color: c.palmilha_color, is_default: !!c.is_default });
      soleConjugationsByGroup.set(c.sole_group_id, arr);
    }
  }

  // Consumo de FACHETE por numeração (dm²/par) dos solados fachetados. Espelha
  // o caminho SQL de calculate_order_consumption (que adiciona o componente
  // "Fachete"): só carregamos as specs dos solados marcados is_fachetado.
  const facheteSpecBySole = new Map<string, Record<string, number>>();
  const fachetadoSoleIds = (allProducts || [])
    .filter((p: any) => p.is_fachetado)
    .map((p: any) => p.id);
  if (fachetadoSoleIds.length > 0) {
    const { data: facheteSpecs } = await (supabase as any)
      .from('sole_technical_specs')
      .select('sole_id, size, fachete_lining_consumption_dm2')
      .in('sole_id', fachetadoSoleIds);
    for (const r of (facheteSpecs || []) as any[]) {
      const v = Number(r.fachete_lining_consumption_dm2) || 0;
      if (v <= 0 || r.size == null) continue;
      const m = facheteSpecBySole.get(r.sole_id) || {};
      m[String(r.size)] = v;
      facheteSpecBySole.set(r.sole_id, m);
    }
  }

  // FORRO DO CABEDAL por numeração (dm²/par) vindo do SOLADO
  // (`sole_technical_specs.lining_consumption_dm2`). Fonte do consumo do forro
  // desde 2026-07-01: a ficha só escolhe o grupo/cor; o consumo é por solado.
  // `.gt(0)` limita às linhas realmente preenchidas (solado × numeração).
  const liningSpecBySole = new Map<string, Record<string, number>>();
  {
    const { data: liningSpecs } = await (supabase as any)
      .from('sole_technical_specs')
      .select('sole_id, size, lining_consumption_dm2')
      .gt('lining_consumption_dm2', 0);
    for (const r of (liningSpecs || []) as any[]) {
      const v = Number(r.lining_consumption_dm2) || 0;
      if (v <= 0 || r.size == null) continue;
      const m = liningSpecBySole.get(r.sole_id) || {};
      m[String(r.size)] = v;
      liningSpecBySole.set(r.sole_id, m);
    }
  }

  // PALMILHA (placa + forração) por numeração vinda do SOLADO
  // (`sole_technical_specs.insole_consumption_dm2` / `insole_lining_consumption_dm2`).
  // MESMA fonte da produção/ondas (SQL by_grade) — antes o modal usava o yield da
  // ficha de componente e divergia. Query SEPARADA da do forro: um solado pode ter
  // forro=0 e palmilha>0 (o `.gt(lining)` da query do forro excluiria essas linhas).
  const insoleSpecBySole = new Map<string, Record<string, number>>();
  const insoleLiningSpecBySole = new Map<string, Record<string, number>>();
  {
    const { data: insoleSpecs } = await (supabase as any)
      .from('sole_technical_specs')
      .select('sole_id, size, insole_consumption_dm2, insole_lining_consumption_dm2')
      .or('insole_consumption_dm2.gt.0,insole_lining_consumption_dm2.gt.0');
    for (const r of (insoleSpecs || []) as any[]) {
      if (r.size == null) continue;
      const iv = Number(r.insole_consumption_dm2) || 0;
      if (iv > 0) {
        const m = insoleSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = iv;
        insoleSpecBySole.set(r.sole_id, m);
      }
      const lv = Number(r.insole_lining_consumption_dm2) || 0;
      if (lv > 0) {
        const m = insoleLiningSpecBySole.get(r.sole_id) || {};
        m[String(r.size)] = lv;
        insoleLiningSpecBySole.set(r.sole_id, m);
      }
    }
  }

  // ITENS-PADRÃO do solado por numeração (sole_standard_items_consumption) —
  // F2-01: espelha o ramo "Item padrão (solado)" do SQL by_grade. Candidatos =
  // qualquer produto que a cascata de solado destas fichas possa resolver
  // (mappings explícitos, primary, produtos dos grupos de solado, pins de
  // variante) — mesma população que resolveSoleProductIdCanonical enxerga.
  const soleStandardItemsBySole = new Map<string, Array<{ standardItemId: string; size: number; consumption: number; unit: string | null }>>();
  {
    const candidateIds = new Set<string>();
    for (const pid of soleColorMap.values()) candidateIds.add(pid);
    for (const pid of sheetPrimarySoleMap.values()) candidateIds.add(pid);
    const candidateGroupIds = new Set<string>([
      ...sheetSoleGroupMap.values(),
      ...soleColorGroupMap.values(),
    ]);
    for (const p of (allProducts || []) as any[]) {
      if (p.group_id && candidateGroupIds.has(p.group_id)) candidateIds.add(p.id);
    }
    for (const v of materialVariantsById.values()) {
      if (v.sole_material_product_id) candidateIds.add(v.sole_material_product_id);
    }
    if (candidateIds.size > 0) {
      const { data: stdItems } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .select('sole_product_id, standard_item_id, size, consumption, unit')
        .in('sole_product_id', [...candidateIds])
        .gt('consumption', 0);
      for (const r of (stdItems || []) as any[]) {
        const cons = Number(r.consumption) || 0;
        if (cons <= 0 || r.size == null || !r.standard_item_id) continue;
        const arr = soleStandardItemsBySole.get(r.sole_product_id) || [];
        arr.push({ standardItemId: r.standard_item_id, size: Number(r.size), consumption: cons, unit: r.unit ?? null });
        soleStandardItemsBySole.set(r.sole_product_id, arr);
      }
    }
  }

  return {
    materials: materials || [],
    allProducts: allProducts || [],
    productGroups: productGroups || [],
    componentSheets: componentSheets || [],
    soleColorMap,
    palmilhaColorMap,
    palmilhaDefaultMap,
    liningColorMap,
    liningDefaultMap,
    sheetStrapsMap,
    sheetSoleGroupMap,
    soleConjugationsByGroup,
    soleColorGroupMap,
    sheetPrimarySoleMap,
    facheteSpecBySole,
    liningSpecBySole,
    insoleSpecBySole,
    insoleLiningSpecBySole,
    componentColorMap,
    materialVariantsById,
    soleStandardItemsBySole,
  };
}

/**
 * Núcleo do cálculo: itera os itens (cada um = 1 OP/`sale_order_item`) e produz
 * as linhas de consumo agregadas por (componentType, grupo, cor, unidade).
 *
 * Extração VERBATIM do loop de `loadConsumption` do modal — qualquer mudança de
 * regra deve passar pelos testes de paridade (`orderConsumption.test.ts`).
 */
export function computeConsumptionForItems(
  items: ConsumptionItem[],
  ctx: ConsumptionContext,
): MaterialConsumptionRow[] {
  const {
    componentSheets,
    productGroups,
    allProducts,
    materials,
    soleColorMap,
    palmilhaColorMap,
    palmilhaDefaultMap,
    liningColorMap,
    liningDefaultMap,
    sheetStrapsMap,
    sheetSoleGroupMap,
    soleConjugationsByGroup,
    facheteSpecBySole,
  } = ctx;

  // Mapas opcionais (testes antigos constroem o contexto sem eles).
  const soleColorGroupMap = ctx.soleColorGroupMap ?? new Map<string, string>();
  const sheetPrimarySoleMap = ctx.sheetPrimarySoleMap ?? new Map<string, string>();
  const liningSpecBySole = ctx.liningSpecBySole ?? new Map<string, Record<string, number>>();
  const insoleSpecBySole = ctx.insoleSpecBySole ?? new Map<string, Record<string, number>>();
  const insoleLiningSpecBySole = ctx.insoleLiningSpecBySole ?? new Map<string, Record<string, number>>();
  const componentColorMap = ctx.componentColorMap ?? new Map<string, Array<{ productId: string; quantityPerUnit: number }>>();
  const materialVariantsById = ctx.materialVariantsById ?? new Map<string, MaterialVariantResolution>();
  const soleStandardItemsBySole = ctx.soleStandardItemsBySole
    ?? new Map<string, Array<{ standardItemId: string; size: number; consumption: number; unit: string | null }>>();

  // Normalização case/acento-insensitive ("Caramelo" = "CARAMELO", "Café" = "Cafe").
  const normColor = (s: string | null | undefined): string =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Resolve produto-solado por (sheet_id, cor cabedal) — cascata canônica
  // P0–P3 extraída pra resolveSoleProductIdCanonical (exportada; reuso na
  // Lista de Separação — bomConsumption.ts). Comportamento idêntico ao closure
  // que vivia aqui (travado por orderConsumption.test.ts).
  const resolveSoleProductId = (refId: string, cabedalColor: string): string | null =>
    resolveSoleProductIdCanonical(refId, cabedalColor, {
      sheetSoleGroupMap,
      soleConjugationsByGroup,
      soleColorMap,
      soleColorGroupMap,
      sheetPrimarySoleMap,
      allProducts,
    });

  const getComponentSheetsForGroup = (groupName: string) => {
    const normalizedGroup = normalizeText(groupName);
    return (componentSheets || []).filter((cs: any) => {
      const prod = cs.products as any;
      if (!prod?.group_id) return false;
      const group = (productGroups || []).find((g: any) => g.id === prod.group_id);
      return normalizeText(group?.name) === normalizedGroup;
    });
  };

  const getPreferredGroupSheet = (
    groupName: string,
    {
      color,
      mode = 'any',
      preferYield = false,
    }: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
  ) => getPreferredComponentSheetFromCandidates(getComponentSheetsForGroup(groupName), { color, mode, preferYield });

  // Ficha de conversão dm²→física com a MESMA ordem do SQL
  // (get_material_conversion_info): a ficha de componente do PRODUTO
  // resolvido/pinado vence quando tem dimensões; só sem ela cai na preferência
  // por cor dentro do grupo. Antes o TS ignorava a cs do pin e casava só por
  // cor — perda (waste_pct)/largura divergiam do custeio/débito (F2-04).
  const getConversionSheetForProduct = (
    productId: string | null | undefined,
    groupName: string,
    opts: { color?: string; mode?: 'any' | 'linear' | 'plate'; preferYield?: boolean } = {},
  ) => {
    if (productId) {
      const own = (componentSheets || []).find((c: any) => c.product_id === productId);
      if (own && (Number(own.dimensions_width) > 0 || Number(own.dimensions_length) > 0)) return own;
    }
    return getPreferredGroupSheet(groupName, opts);
  };

  // Tamanhos da grade do item SEM valor por numeração no mapa de specs — usados
  // pro aviso `fallback_average` (contrato SQL: tamanho sem spec cai no ESCALAR
  // da ficha e a linha sai com consumption_warning; F2-02).
  const sizesMissingFromSpec = (item: ConsumptionItem, perSize: Record<string, number>): string[] => {
    const grade = (item as any).grade as Record<string, number> | null | undefined;
    if (!grade || typeof grade !== 'object') return [];
    const missing: string[] = [];
    for (const [k, v] of Object.entries(grade)) {
      if (k.startsWith('_') || !((Number(v) || 0) > 0)) continue;
      if (!((Number(perSize[k]) || 0) > 0)) missing.push(k);
    }
    return missing;
  };
  const fallbackAverageWarning = (missing: string[]): string =>
    `Tamanhos usando a média escalar da ficha (sem consumo por numeração): ${missing.join(', ')}`;

  // Helper: o grupo (por nome) contém algum produto que casa na cor?
  const groupHasColor = (groupName: string, color: string): boolean => {
    if (!groupName || !color || color === '—') return false;
    const normalizedColor = color.toLowerCase().trim();
    const group = (productGroups || []).find((g: any) => g.name === groupName);
    if (!group) return false;

    return (allProducts || []).some((p: any) => {
      if (p.group_id !== group.id) return false;
      const pName = (p.name || '').toLowerCase();
      const pColor = (p.color || '').toLowerCase();

      if (pColor === normalizedColor || pName === normalizedColor) return true;
      const afterDelimiter = pName.includes(':') ? pName.split(':').pop()?.trim() : pName.includes('-') ? pName.split('-').pop()?.trim() : '';
      if (afterDelimiter && afterDelimiter === normalizedColor) return true;
      if (pColor.length > 3 && normalizedColor.length > 3) {
        if (normalizedColor.includes(pColor) || pColor.includes(normalizedColor)) return true;
      }
      return false;
    });
  };

  // Conta produtos por grupo (ranking de fallback).
  const countGroupProducts = (groupName: string): number => {
    const group = (productGroups || []).find((g: any) => g.name === groupName);
    if (!group) return 0;
    return (allProducts || []).filter((p: any) => p.group_id === group.id).length;
  };

  const resolveOption = (
    mainGroup: string, mainConsumption: number,
    alternatives: any[], orderColor: string,
  ): { group: string; consumption: number } | null => {
    // Try main first
    if (mainGroup && mainConsumption > 0) {
      if (!orderColor || orderColor === '—' || groupHasColor(mainGroup, orderColor)) {
        return { group: mainGroup, consumption: mainConsumption };
      }
    }
    // Try alternatives
    for (const alt of alternatives) {
      const altGroup = alt.material?.trim();
      const altConsumption = Number(alt.consumption) || 0;
      if (altGroup && altConsumption > 0 && groupHasColor(altGroup, orderColor)) {
        return { group: altGroup, consumption: altConsumption };
      }
    }
    // Fallback: grupo com mais variantes (mais provável de carregar a cor)
    const candidates = [
      ...(mainGroup && mainConsumption > 0 ? [{ group: mainGroup, consumption: mainConsumption }] : []),
      ...alternatives.filter((a: any) => a.material?.trim() && (Number(a.consumption) || 0) > 0).map((a: any) => ({ group: a.material.trim(), consumption: Number(a.consumption) })),
    ];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => countGroupProducts(b.group) - countGroupProducts(a.group));
    return candidates[0];
  };

  const consumptionMap = new Map<string, MaterialConsumptionRow>();

  for (const item of items) {
    const orderColor = item.color || '—';
    const itemQuantity = Number(item.quantity) || 0;
    const sheet = item.technical_sheets as any;

    // ── Variante de material do item (sale_order_items.material_variant_id) ──
    // Espelha os resolvers SQL (mig 20260907120500): por componente, o produto
    // legado pinado vem ANTES do grupo da variante; ambos vêm antes da resolução
    // da ficha. A ÁREA (dm²/par, per-size) permanece a da ficha — a variante só
    // troca a ORIGEM do material (grupo/produto), e portanto a largura usada na
    // conversão dm²→m passa a ser a da ficha de componente do grupo DA VARIANTE.
    const variant = item.material_variant_id
      ? materialVariantsById.get(item.material_variant_id)
      : undefined;
    const groupNameById = (gid: string | null | undefined): string =>
      gid ? ((productGroups || []).find((g: any) => g.id === gid)?.name || '') : '';
    /** Pin de produto da variante (se ativo em allProducts) + nome do grupo efetivo. */
    const variantComponent = (
      pid: string | null | undefined,
      gid: string | null | undefined,
    ): { pin: any | null; groupName: string } => {
      const pin = pid ? (allProducts || []).find((p: any) => p.id === pid) || null : null;
      const groupName = pin ? groupNameById(pin.group_id) : groupNameById(gid);
      return { pin, groupName };
    };
    const upperVariant = variant
      ? variantComponent(variant.upper_material_product_id, variant.upper_material_group_id)
      : { pin: null, groupName: '' };
    const liningVariant = variant
      ? variantComponent(variant.lining_material_product_id, variant.lining_material_group_id)
      : { pin: null, groupName: '' };
    const insoleVariant = variant
      ? variantComponent(variant.insole_material_product_id, variant.insole_material_group_id)
      : { pin: null, groupName: '' };
    const upperVariantDriven = !!(upperVariant.pin || upperVariant.groupName);
    const liningVariantDriven = !!(liningVariant.pin || liningVariant.groupName);
    const insoleVariantDriven = !!(insoleVariant.pin || insoleVariant.groupName);
    // Solado da variante: pin direto (resolve_sole_for_variant no SQL).
    const variantSolePid = variant?.sole_material_product_id
      && (allProducts || []).some((p: any) => p.id === variant.sole_material_product_id)
      ? variant.sole_material_product_id
      : null;
    /** Resolução de solado DESTE item: pin da variante > cascata canônica. */
    const resolveSoleForItem = (): string | null =>
      variantSolePid ?? resolveSoleProductId(item.reference_id, orderColor);

    // Cabedal: resolve which option matches the order color
    const allCabedalAccessories = Array.isArray(sheet?.components_accessories)
      ? (sheet.components_accessories as any[]).filter((e: any) => e.material && !e.id)
      : [];
    const upperAlts = allCabedalAccessories.filter((e: any) => !e.mandatory);
    const mandatoryCabedalMaterials = allCabedalAccessories.filter((e: any) => e.mandatory === true);
    // Variante dirige o cabedal: o grupo vem DELA (pin legado > grupo) e a
    // resolução por alternativas de cor da ficha NÃO se aplica (espelha o SQL,
    // onde 'variant'/'variant_group' retornam antes de qualquer fallback). O
    // consumo segue o da ficha, exceto override LEGADO explícito da variante.
    const upperMatch = upperVariantDriven
      ? {
          group: upperVariant.groupName || (sheet?.upper_material || ''),
          consumption: variant?.upper_consumption_override != null
            ? Number(variant.upper_consumption_override) || 0
            : (Number(sheet?.upper_consumption) || 0),
        }
      : resolveOption(
          sheet?.upper_material || '', Number(sheet?.upper_consumption) || 0,
          upperAlts, orderColor,
        );
    if (upperMatch) {
      const isPrincipal = upperVariantDriven || upperMatch.group === (sheet?.upper_material || '');
      // Pin de SKU calculado ANTES da ficha de conversão: a cs do produto
      // pinado dirige largura/perda quando existir (ordem do SQL — F2-04).
      const upperPin = upperVariant.pin
        || (isPrincipal && (sheet as any)?.upper_material_product_id
          ? (allProducts || []).find((p: any) => p.id === (sheet as any).upper_material_product_id && p.active)
          : null);
      const upperSheet = getConversionSheetForProduct(upperPin?.id, upperMatch.group, { color: orderColor, mode: 'linear', preferYield: true });
      const altRecord = isPrincipal ? null : upperAlts.find((a: any) => a.material === upperMatch.group);
      // Override LEGADO da variante substitui o escalar E suprime o per-size da
      // ficha (é um consumo explícito). Sem override, o per-size da ficha segue
      // valendo mesmo com variante (a variante troca material, não geometria).
      const hasLegacyUpperOverride = upperVariantDriven && variant?.upper_consumption_override != null;
      const overridePerSize = hasLegacyUpperOverride
        ? null
        : isPrincipal
          ? (sheet?.upper_consumption_per_size && Object.keys(sheet.upper_consumption_per_size).length > 0 ? sheet.upper_consumption_per_size : null)
          : (altRecord?.consumption_per_size && Object.keys(altRecord.consumption_per_size).length > 0 ? altRecord.consumption_per_size : null);
      const { total: upperTotal } = calculateConsumptionWithUnit(item, upperMatch.consumption, upperSheet, 'metro', overridePerSize);
      // Pin de SKU (acima): o da VARIANTE (produto legado) prevalece; senão o
      // da ficha (Material 1). Quando fixado + ativo, o débito SQL baixa ESSE
      // produto (resolve_upper_material_for_variant → 'variant'/'sheet_pin') e
      // a conversão dm²→m usa a cs DELE (F2-04).
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal',
        groupName: upperMatch.group,
        materialName: upperPin?.name || 'Cabedal',
        productUnit: 'metro',
        color: orderColor,
        totalQuantity: upperTotal,
        widthMissing: isLinearWidthMissing(upperSheet, 'm'),
      });
    }

    // Materiais mandatórios do cabedal — sempre consumidos, independente da cor
    for (const mandMat of mandatoryCabedalMaterials) {
      const mandConsumption = Number(mandMat.consumption) || 0;
      if (!mandMat.material || mandConsumption <= 0) continue;
      // Item fixado (product_id) → exibe o nome do produto exato (o débito SQL
      // debita esse item; ver debit_stock_for_order). Sem pino, mantém o rótulo.
      const pinnedProd = mandMat.product_id
        ? (allProducts || []).find((p: any) => p.id === mandMat.product_id)
        : null;
      // Conversão dm²→m pela cs do produto PINADO quando houver (ordem do SQL:
      // get_material_conversion_info do pin — F2-04; caso vivo: NAPA ONÇA com
      // waste próprio ≠ da cs casada por cor do grupo).
      const mandSheet = getConversionSheetForProduct(pinnedProd?.id, mandMat.material, { color: orderColor, mode: 'linear', preferYield: true });
      const mandOverride = (mandMat.consumption_per_size && Object.keys(mandMat.consumption_per_size).length > 0)
        ? mandMat.consumption_per_size
        : null;
      const { total: mandTotal } = calculateConsumptionWithUnit(item, mandConsumption, mandSheet, 'metro', mandOverride);
      addConsumptionRow(consumptionMap, {
        componentType: 'Cabedal',
        groupName: mandMat.material,
        materialName: pinnedProd?.name || mandMat.label || 'Material Fixo',
        productUnit: 'metro',
        color: orderColor,
        totalQuantity: mandTotal,
        widthMissing: isLinearWidthMissing(mandSheet, 'm'),
      });
    }

    // Forro: resolve which option matches the order color
    const liningAlts = Array.isArray(sheet?.lining_accessories) ? sheet.lining_accessories as any[] : [];
    // Variante dirige o forro: mesmo racional do cabedal (pin legado > grupo da
    // variante; consumo da ficha, salvo override legado explícito).
    const liningMatch = liningVariantDriven
      ? {
          group: liningVariant.groupName || (sheet?.lining_material || ''),
          consumption: variant?.lining_consumption_override != null
            ? Number(variant.lining_consumption_override) || 0
            : (Number(sheet?.lining_consumption) || 0),
        }
      : resolveOption(
          sheet?.lining_material || '', Number(sheet?.lining_consumption) || 0,
          liningAlts, orderColor,
        );
    // Anti-duplicidade FORRAÇÃO (cabedal × palmilha) — espelha
    // calculate_order_consumption_by_grade (migration 20260911120000): quando o
    // solado DIRIGE o forro de PALMILHA (insole_lining_consumption_dm2) e NÃO tem
    // forro de cabedal (lining_consumption_dm2 nulo), o lining_material/
    // lining_consumption da ficha É o forro da palmilha — não existe forro de
    // cabedal. Suprime a "Forração" (cabedal) pra não contar a mesma napa 2×; a
    // "Forração Palmilha" (abaixo) segue intacta. Só dispara com
    // sole_drives_consumption=true (idem SQL) — fichas de calçado fechado (forro
    // real, sem forro-de-palmilha no solado) não são afetadas.
    const soleForLiningId = resolveSoleForItem();
    const suppressCabedalForracao = sheet?.sole_drives_consumption === true
      && Object.values(insoleLiningSpecBySole.get(soleForLiningId || '') || {}).some((v) => Number(v) > 0)
      && !Object.values(liningSpecBySole.get(soleForLiningId || '') || {}).some((v) => Number(v) > 0);
    // Pin de SKU do forro (variante > ficha) — hoisted: dirige a ficha de
    // conversão (F2-04) do Forro E da Forração Palmilha abaixo.
    const isPrincipalLining = !!liningMatch && (liningVariantDriven || liningMatch.group === (sheet?.lining_material || ''));
    const liningPin = liningVariant.pin
      || (isPrincipalLining && (sheet as any)?.lining_material_product_id
        ? (allProducts || []).find((p: any) => p.id === (sheet as any).lining_material_product_id && p.active)
        : null);
    if (liningMatch && !suppressCabedalForracao) {
      const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || liningDefaultMap.get(item.reference_id) || orderColor;
      const liningSheet = getConversionSheetForProduct(liningPin?.id, liningMatch.group, { color: mappedLiningColor, mode: 'linear', preferYield: true });
      const soleProductId = resolveSoleForItem();
      const liningAltRecord = isPrincipalLining ? null : liningAlts.find((a: any) => a.material === liningMatch.group);
      // FORRAÇÃO ALTERNATIVA (lining_accessories): consumo por número da própria
      // ficha (é escolha do modelo). A PRINCIPAL não usa mais per_size da ficha.
      const liningOverride = isPrincipalLining
        ? null
        : (liningAltRecord?.consumption_per_size && Object.keys(liningAltRecord.consumption_per_size).length > 0 ? liningAltRecord.consumption_per_size : null);
      // FONTE DO CONSUMO DO FORRO DO CABEDAL (principal) = o SOLADO, por numeração
      // (`sole_technical_specs.lining_consumption_dm2`, dm²/par). A ficha só escolhe
      // grupo/cor. Espelha o fachete (dm²→metro pela largura da ficha do material)
      // e o fallback `v_spec.lining_consumption_dm2` do SQL by_grade. Prioridade
      // idêntica ao SQL: solado → escalar `lining_consumption` (per_size da ficha
      // saiu — o grid foi removido; 0 fichas tinham valor). (2026-07-01)
      // Override LEGADO da variante é consumo explícito → ignora o per-size do
      // solado e usa o escalar já embutido em liningMatch.consumption.
      const hasLegacyLiningOverride = liningVariantDriven && variant?.lining_consumption_override != null;
      const liningSolePerSize = (isPrincipalLining && !hasLegacyLiningOverride) ? (liningSpecBySole.get(soleProductId || '') || {}) : {};
      const liningSoleVals = Object.values(liningSolePerSize).filter((v) => Number(v) > 0) as number[];
      const liningWidthMissing = isLinearWidthMissing(liningSheet, 'm');
      let liningTotal: number;
      let liningWarning: string | undefined;
      if (isPrincipalLining && liningSoleVals.length > 0) {
        // sheet=null → usa o override PURO em dm² (não trata como metro); depois
        // converte dm²→metro pela largura da ficha do material (igual fachete).
        // Tamanho SEM spec no solado cai no ESCALAR da ficha (contrato SQL
        // by_grade / fallback_average — F2-02), NÃO mais na média×multiplicador.
        const liningDm2 = calculateGradeBasedDm2(item, liningMatch.consumption, null, liningSolePerSize, soleProductId);
        liningTotal = liningWidthMissing ? liningDm2 : convertDm2ToLinearMeters(liningDm2, liningSheet);
        const missing = sizesMissingFromSpec(item, liningSolePerSize);
        if (missing.length > 0 && liningMatch.consumption > 0) liningWarning = fallbackAverageWarning(missing);
      } else {
        liningTotal = calculateConsumptionWithUnit(item, liningMatch.consumption, liningSheet, 'metro', liningOverride, soleProductId).total;
      }
      addConsumptionRow(consumptionMap, {
        componentType: 'Forração',
        groupName: liningMatch.group,
        materialName: liningPin?.name || 'Forração',
        productUnit: 'metro',
        color: mappedLiningColor,
        totalQuantity: liningTotal,
        widthMissing: liningWidthMissing,
        warning: liningWarning,
      });
    }

    // Palmilha = PLACA (base) + FORRAÇÃO (napa do forro). Pulada INTEIRA quando
    // a palmilha é pronta (insole_ready_made ou solado classificado
    // palmilha_pronta) — espelha o ramo SQL: pronta = não debita nada.
    const soleProductIdForInsole = resolveSoleForItem();
    const insoleSoleProd = soleProductIdForInsole ? (allProducts || []).find((p: any) => p.id === soleProductIdForInsole) : null;
    const isPalmilhaPronta = (sheet?.insole_ready_made === true)
      || ((insoleSoleProd as any)?.sole_classification === 'palmilha_pronta');

    if (!isPalmilhaPronta) {
      const palmMapping = palmilhaColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || palmilhaDefaultMap.get(item.reference_id);
      // Variante dirige a palmilha: grupo da variante substitui o da ficha; pin
      // de produto da variante prevalece sobre o pin do mapping de cor (espelha
      // resolve_insole_material_for_variant: variant.product_id > variant.group_id
      // > resolução da ficha).
      const insoleGroupName = insoleVariantDriven
        ? (insoleVariant.groupName || sheet?.insole_material || '')
        : (sheet?.insole_material || '');
      const insoleGroup = (productGroups || []).find((g: any) => g.name === insoleGroupName);
      const palmColor = palmMapping?.color || '—';
      const palmProductId = insoleVariant.pin?.id || palmMapping?.productId;

      // PLACA (base): produto específico (unidade) ou material convertido a placas.
      //
      // FIX auditoria motores 2026-07-01 (a): a linha sai na unidade de ESTOQUE
      // do produto de palmilha quando ela é conhecida e é de ÁREA. O produto
      // vivo de placa (PLACA 1.0 EVA) tem `unit='dm²'` — débito e estoque
      // operam em dm²; emitir "≈11,2 placas" contra um estoque de ~1.684,8 dm²
      // invalidava a comparação verde/vermelho do modal (150×). Em dm² a linha
      // compara 1:1 com `products.quantity`. A equivalência em placas fica
      // derivável na UI (dm² ÷ área da placa do grupo) — NÃO vai como sufixo no
      // materialName porque várias OPs agregam na mesma linha e o texto
      // congelaria o valor da primeira. 'par' segue valendo pra palmilha pronta
      // comprada por par; 'placa' segue quando o estoque é contado em placas ou
      // a unidade é desconhecida (comportamento legado).
      const pinnedPalmProduct = palmProductId
        ? (allProducts || []).find((p: any) => p.id === palmProductId)
        : null;
      // Produto de palmilha RESOLVIDO como no SQL (F2-03): pin do mapping/
      // variante > resolve_material_product (cor exata > cor no nome > maior
      // estoque do grupo). A cor de resolução espelha v_palmilha_color do
      // by_grade: cor do pedido, exceto quando insole_has_lining=false (aí o
      // mapping de cor da palmilha dirige). Antes o TS escolhia só a FICHA de
      // componente "plate" do grupo e podia apontar produto/unidade diferentes
      // do que débito/reserva/custeio (SQL) baixam.
      const palmResolveColor = sheet?.insole_has_lining === false
        ? (palmMapping?.color || orderColor)
        : orderColor;
      const resolvedPalmProduct = pinnedPalmProduct
        || resolveMaterialProductCanonical(insoleGroupName, palmResolveColor, allProducts || [], productGroups || []);
      // Ficha de conversão: cs do produto resolvido primeiro (F2-04), senão a
      // preferida do grupo em modo placa (comportamento anterior).
      const insoleSheet = getConversionSheetForProduct(resolvedPalmProduct?.id, insoleGroupName, { mode: 'plate', preferYield: true });
      // PALMILHA PLACA por numeração vinda do SOLADO (sole_technical_specs.insole_consumption_dm2),
      // espelhando o Forro e a produção/ondas: quando o solado tem valores, o consumo (dm²) vem
      // deles por número (ESCALAR da ficha como fallback POR TAMANHO — contrato
      // SQL/fallback_average, F2-02) e a ficha de componente é usada SÓ pra
      // conversão dm²→placa. Sem valores no solado → caminho antigo (yield da
      // ficha de componente, fallback escalar FLAT — sem multiplicador).
      // Override LEGADO da variante (consumo explícito) suprime o per-size do
      // solado e substitui o escalar da ficha.
      const hasLegacyInsoleOverride = insoleVariantDriven && variant?.insole_consumption_override != null;
      const insoleScalarConsumption = hasLegacyInsoleOverride
        ? (Number(variant?.insole_consumption_override) || 0)
        : (Number(sheet?.insole_consumption) || 0);
      const insoleSolePerSize = hasLegacyInsoleOverride ? {} : (insoleSpecBySole.get(soleProductIdForInsole || '') || {});
      const insoleSoleVals = Object.values(insoleSolePerSize).filter((v) => Number(v) > 0) as number[];
      const computeInsoleDm2 = () => insoleSoleVals.length > 0
        ? calculateGradeBasedDm2(item, insoleScalarConsumption, null, insoleSolePerSize, soleProductIdForInsole)
        : calculateGradeBasedDm2(item, insoleScalarConsumption, insoleSheet, undefined, soleProductIdForInsole);
      // Aviso de fallback (tamanho sem spec → escalar), espelho do
      // consumption_warning/fallback_average do SQL. Mantido visível na UI.
      const insoleMissing = insoleSoleVals.length > 0 ? sizesMissingFromSpec(item, insoleSolePerSize) : [];
      const insoleWarning = (insoleMissing.length > 0 && insoleScalarConsumption > 0)
        ? fallbackAverageWarning(insoleMissing)
        : undefined;
      // Unidade de estoque = a do produto RESOLVIDO (pin > resolve canônico);
      // fallback: unidade do produto da ficha de componente. null = desconhecida
      // → preserva o caminho legado (placa).
      const palmStockUnit: string | null = (resolvedPalmProduct?.unit as string | undefined)
        || (((insoleSheet as any)?.products as any)?.unit as string | undefined)
        || null;
      const palmRowColor = resolvedPalmProduct?.color || palmColor;

      if (isAreaStockUnit(palmStockUnit)) {
        // Estoque em ÁREA: emite em dm² COM a perda de corte (waste_pct) da
        // ficha de conversão — contrato do SQL (que aplica ×(1+waste) na linha
        // Palmilha incondicionalmente) e da Lista de Separação. Antes o modal
        // emitia CRU e divergia dos dois na primeira ficha com waste>0 (F2-08).
        const insoleDm2 = computeInsoleDm2();
        const insoleWastePct = Number((insoleSheet as any)?.waste_pct) || 0;
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: resolvedPalmProduct?.name || 'Palmilha',
          productUnit: 'dm2',
          color: palmRowColor,
          totalQuantity: insoleDm2 * (1 + insoleWastePct / 100),
          warning: insoleWarning,
        });
      } else if (palmStockUnit && LINEAR_UNITS.has(palmStockUnit.toLowerCase().trim())) {
        // Estoque LINEAR (ex.: rolo EVA 3MM em metros): converte dm²→m pela
        // largura da cs do produto resolvido (grupo como fallback) — espelha o
        // SQL (resolve produto → get_material_conversion_info). Antes o TS
        // emitia dm² da placa enquanto o débito baixava metros do rolo (F2-03).
        const insoleDm2 = computeInsoleDm2();
        const linSheet = getConversionSheetForProduct(resolvedPalmProduct?.id, insoleGroupName, {
          color: palmRowColor !== '—' ? palmRowColor : undefined,
          mode: 'linear',
          preferYield: true,
        });
        const linWidthMissing = isLinearWidthMissing(linSheet as any, 'm');
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: resolvedPalmProduct?.name || 'Palmilha',
          productUnit: linWidthMissing ? 'dm2' : 'metro',
          color: palmRowColor,
          totalQuantity: linWidthMissing ? insoleDm2 : convertDm2ToLinearMeters(insoleDm2, linSheet as any),
          widthMissing: linWidthMissing,
          warning: insoleWarning,
        });
      } else if (palmProductId) {
        // Palmilha pronta comprada por PAR (produto pinado no mapping de cor).
        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: pinnedPalmProduct?.name || 'Palmilha',
          productUnit: 'par',
          color: pinnedPalmProduct?.color || palmColor,
          totalQuantity: itemQuantity,
        });
      } else {
        const insoleDm2 = computeInsoleDm2();
        const groupPlateArea = calcGroupPlateAreaDm2(insoleGroup);
        // Aplica waste_pct também no caminho que usa dimensões do grupo, p/ paridade
        // com convertDm2ToPlates() (fallback) e com bomConsumption.ts (Lista de
        // Separação) — antes o modal divergia da Lista no nº de placas (auditoria
        // 2026-06-14, Área 2).
        const insoleWastePct = Number(insoleSheet?.waste_pct) || 0;
        const insolePlates = groupPlateArea > 0
          ? (insoleDm2 / groupPlateArea) * (1 + insoleWastePct / 100)
          : convertDm2ToPlates(insoleDm2, insoleSheet);

        addConsumptionRow(consumptionMap, {
          componentType: 'Palmilha',
          groupName: insoleGroupName,
          materialName: 'Palmilha',
          productUnit: 'placa',
          color: palmColor,
          totalQuantity: insolePlates,
          warning: insoleWarning,
        });
      }

      // FORRAÇÃO da palmilha: napa do forro (lining_material) que cobre a placa.
      // Linha linear ADICIONAL (mesma napa do Forro do cabedal). Só quando há
      // forro (insole_has_lining) e área de forração da palmilha > 0.
      const insoleLiningCons = Number(sheet?.insole_lining_consumption) || 0;
      // Forração da palmilha usa a MESMA napa do forro RESOLVIDO (pick-one):
      // variante > grupo eleito pelo resolveOption (alternativa quando a
      // principal não tem a cor) > lining_material cru. O SQL resolve as duas
      // linhas pelo MESMO v_lining_pid (grupo alternativo incluso) — usar o
      // lining_material cru aqui mandava cortar a napa ERRADA quando o forro
      // era alternativo (F2-09).
      const liningGroupForPalm = liningVariantDriven
        ? (liningVariant.groupName || sheet?.lining_material || '')
        : (liningMatch?.group || sheet?.lining_material || '');
      // FORRAÇÃO da palmilha por numeração vinda do SOLADO
      // (sole_technical_specs.insole_lining_consumption_dm2), espelhando o Forro e a
      // produção/ondas (SQL by_grade).
      const insoleLiningSolePerSize = insoleLiningSpecBySole.get(soleProductIdForInsole || '') || {};
      const insoleLiningSoleVals = Object.values(insoleLiningSolePerSize).filter((v) => Number(v) > 0) as number[];
      // Emite quando há consumo escalar OU o solado tem valores por número — senão a
      // forração-de-palmilha dirigida pelo solado nunca sairia se o escalar fosse 0.
      if ((insoleLiningCons > 0 || insoleLiningSoleVals.length > 0) && liningGroupForPalm && sheet?.insole_has_lining !== false) {
        const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || liningDefaultMap.get(item.reference_id) || orderColor;
        // Mesma ficha de conversão do Forro do cabedal: cs do pin primeiro
        // (F2-04), grupo por cor como fallback — o SQL converte as duas linhas
        // pela MESMA get_material_conversion_info(v_lining_pid).
        const forrSheet = getConversionSheetForProduct(liningPin?.id, liningGroupForPalm, { color: mappedLiningColor, mode: 'linear', preferYield: true });
        const forrWidthMissing = isLinearWidthMissing(forrSheet, 'm');
        // Solado com valores: dm² por número dele; tamanho SEM spec cai no
        // ESCALAR da ficha (contrato SQL/fallback_average — F2-02) com aviso.
        // Sem valores → caminho antigo (escalar flat).
        let forrTotal: number;
        let forrWarning: string | undefined;
        if (insoleLiningSoleVals.length > 0) {
          const forrDm2 = calculateGradeBasedDm2(item, insoleLiningCons, null, insoleLiningSolePerSize, soleProductIdForInsole);
          forrTotal = forrWidthMissing ? forrDm2 : convertDm2ToLinearMeters(forrDm2, forrSheet);
          const missing = sizesMissingFromSpec(item, insoleLiningSolePerSize);
          if (missing.length > 0 && insoleLiningCons > 0) forrWarning = fallbackAverageWarning(missing);
        } else {
          forrTotal = calculateConsumptionWithUnit(item, insoleLiningCons, forrSheet, 'metro', undefined, soleProductIdForInsole).total;
        }
        // componentType DISTINTO 'Forração Palmilha' (não 'Palmilha'): é FORRO
        // cortado no setor Corte Forração, não placa do Corte Palmilha. O
        // roteamento por setor (filterConsumptionForSector) depende disso.
        if (forrTotal > 0 || forrWarning) addConsumptionRow(consumptionMap, {
          componentType: 'Forração Palmilha',
          groupName: liningGroupForPalm,
          materialName: 'Forração Palmilha',
          productUnit: 'metro',
          color: mappedLiningColor,
          totalQuantity: forrTotal,
          widthMissing: forrWidthMissing,
          warning: forrWarning,
        });
      }
    }

    // Solado: pin da VARIANTE primeiro (resolve_sole_for_variant no SQL); senão
    // resolução canônica (P0 conjugação → P1 mapping explícito → P2 mapping
    // legado por grupo/maior estoque → P3 primary_sole_id), com match de cor
    // case/acento-insensitive. Toda a ordem vive em resolveSoleForItem/
    // resolveSoleProductId — espelho do backend.
    const soleProductIdResolved: string | null = resolveSoleForItem();
    const soleProduct = soleProductIdResolved
      ? (allProducts || []).find((p: any) => p.id === soleProductIdResolved)
      : null;
    const soleColor = soleProduct?.color || orderColor || sheet?.sole_color || '—';

    // Agrupa o solado pelo MODELO (product_group), não pelo nome do produto.
    // Vários produtos do mesmo modelo embutem a cor no nome (ex.: grupo
    // "SOLADO 204" → "204 - CARAMELO" / "204 - Preto"); usar o nome do produto
    // quebraria o mesmo solado em blocos separados. Com o nome do grupo, todas
    // as cores do modelo caem no MESMO solado, somadas por cor. Fallback pro
    // nome do produto e depois pro texto sheet.sole_material quando não há
    // produto/grupo resolvido. (Pedido user 2026-06-07.)
    const soleGroup = soleProduct?.group_id
      ? (productGroups || []).find((g: any) => g.id === soleProduct.group_id)
      : null;
    const soleGroupName = soleGroup?.name || soleProduct?.name || sheet?.sole_material || '';

    // Breakdown de numerações escalado pro TOTAL real do item.
    // Largest remainder (regra canônica de exibição por numeração) — o
    // Math.round por tamanho podia somar ±N pares vs itemQuantity (ex.:
    // 7 tamanhos × multiplier 2,5 → 31 ou 29 pares pra um item de 30).
    const grade = (item as any).grade as Record<string, number> | null | undefined;
    let scaledBreakdown: Record<string, number> = {};
    if (grade && typeof grade === 'object') {
      // Mantém numerações conjugadas (ex: "33/34") — só descarta meta (_size_*).
      const isSize = (k: string) => !k.startsWith('_');
      const baseGrade: Record<string, number> = {};
      for (const [size, qty] of Object.entries(grade)) {
        if (isSize(size) && (Number(qty) || 0) > 0) baseGrade[size] = Number(qty) || 0;
      }
      const baseSum = Object.values(baseGrade).reduce((s, v) => s + v, 0);
      if (baseSum > 0) {
        scaledBreakdown = scaleGradeWithLargestRemainder(baseGrade, itemQuantity / baseSum, itemQuantity);
        for (const size of Object.keys(scaledBreakdown)) {
          if (!(scaledBreakdown[size] > 0)) delete scaledBreakdown[size];
        }
      }
    }

    addConsumptionRow(consumptionMap, {
      componentType: 'Solado',
      groupName: soleGroupName,
      // materialName usado só como fallback se sizeBreakdown vier vazio.
      materialName: 'Solado',
      productUnit: 'par',
      color: soleColor,
      // FIX auditoria motores 2026-07-01 (b): default 1 par/par. Com `|| 0`,
      // `sole_consumption` 0/null zerava o total e addConsumptionRow APAGAVA o
      // solado do modal/ficha — enquanto SQL/débito ignoram o campo e baixam
      // 1 par por par (banco vivo 2026-07-02: 7 fichas com 0, 38 com 1, 1 com
      // 2). 1 par/par é o CANÔNICO; o multiplicador > 1 é preservado porque a
      // ficha STX usa 2 (⚠ o débito SQL não aplica o multiplicador — a linha
      // do modal fica conservadora, nunca menor que o débito real).
      // Override da variante (unidades de solado/par, raro ≠ 1) prevalece
      // sobre o sole_consumption da ficha.
      totalQuantity: ((variant?.sole_consumption_override != null
        ? Number(variant.sole_consumption_override)
        : Number(sheet?.sole_consumption)) || 1) * itemQuantity,
      sizeBreakdown: Object.keys(scaledBreakdown).length > 0 ? scaledBreakdown : undefined,
      soleProductId: soleProductIdResolved,
    });

    // FACHETE — forração EXTRA do salto fachetado. Espelha o ramo de
    // calculate_order_consumption (SQL): só pra solado `is_fachetado`, com consumo
    // em dm²/par POR NUMERAÇÃO vindo de sole_technical_specs.fachete_lining_consumption_dm2.
    // Material = grupo do fachete (sole.fachete_material_group_id) ou, na falta,
    // o lining_material da ficha. Converte dm²→metro pela largura da ficha de
    // componente do material de forração (mesma regra dos outros itens de área).
    // ⚠ Antes o motor de UI NÃO calculava fachete → modal/ficha subcontavam a
    // forração desses solados vs. o custeio/MRP (SQL). (Auditoria 2026-06-09.)
    if ((soleProduct as any)?.is_fachetado && soleProductIdResolved) {
      const facheteGroupId = (soleProduct as any).fachete_material_group_id;
      const facheteGroupName = facheteGroupId
        ? ((productGroups || []).find((g: any) => g.id === facheteGroupId)?.name || '')
        : '';
      const facheteMaterialName = facheteGroupName || (sheet?.lining_material || '');
      const fachetePerSize = facheteSpecBySole.get(soleProductIdResolved) || {};
      const facheteVals = Object.values(fachetePerSize).filter((v) => Number(v) > 0) as number[];
      if (facheteMaterialName && facheteVals.length > 0) {
        const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || liningDefaultMap.get(item.reference_id) || orderColor;
        // Produto do fachete resolvido como no SQL (resolve_material_product do
        // grupo do fachete) e conversão pela cs DELE quando houver (F2-04).
        const facheteProd = resolveMaterialProductCanonical(facheteMaterialName, mappedLiningColor, allProducts || [], productGroups || []);
        const facheteSheet = getConversionSheetForProduct(facheteProd?.id, facheteMaterialName, { color: mappedLiningColor, mode: 'linear', preferYield: true });
        const avgFachete = facheteVals.reduce((a, b) => a + b, 0) / facheteVals.length;
        // sheet null força o uso PURO do override (valores em dm²/par); não usa o
        // yield linear da napa — senão trataria dm² como metros (~100× errado).
        // Tamanho SEM spec de fachete contribui ZERO + aviso (contrato SQL:
        // v_warn_fachete_sizes — F2-02), não mais média×multiplicador. Item sem
        // grade preserva o legado (média × quantidade).
        const facheteGradeEntries = Object.entries(((item as any).grade || {}) as Record<string, number>)
          .filter(([k, v]) => !k.startsWith('_') && (Number(v) || 0) > 0);
        const facheteDm2 = facheteGradeEntries.length > 0
          ? calculateGradeBasedDm2(item, 0, null, fachetePerSize, soleProductIdResolved)
          : calculateGradeBasedDm2(item, avgFachete, null, fachetePerSize, soleProductIdResolved);
        const facheteMissing = facheteGradeEntries.length > 0 ? sizesMissingFromSpec(item, fachetePerSize) : [];
        const facheteWarning = facheteMissing.length > 0
          ? `Tamanhos sem consumo de fachete: ${facheteMissing.join(', ')}`
          : undefined;
        const widthMissing = isLinearWidthMissing(facheteSheet, 'm');
        const facheteTotal = widthMissing ? facheteDm2 : convertDm2ToLinearMeters(facheteDm2, facheteSheet);
        addConsumptionRow(consumptionMap, {
          componentType: 'Fachete',
          groupName: facheteMaterialName,
          materialName: 'Fachete',
          productUnit: widthMissing ? 'dm2' : 'metro',
          color: mappedLiningColor,
          totalQuantity: facheteTotal,
          widthMissing,
          warning: facheteWarning,
        });
      } else {
        // Solado fachetado SEM consumo de fachete cadastrado. Espelha o
        // `consumption_warning` do SQL (calculate_order_consumption_by_grade):
        // antes a UI simplesmente OMITIA a linha → a forração EXTRA do salto
        // sumia silenciosamente e o operador subcortava o forro. Agora emite uma
        // linha de alerta (qtd 0, neutra) pra tornar o gap visível até alguém
        // cadastrar `sole_technical_specs.fachete_lining_consumption_dm2`.
        const mappedLiningColor = liningColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || liningDefaultMap.get(item.reference_id) || orderColor;
        addConsumptionRow(consumptionMap, {
          componentType: 'Fachete',
          groupName: facheteMaterialName || 'Fachete',
          materialName: 'Fachete',
          productUnit: 'dm2',
          color: mappedLiningColor,
          totalQuantity: 0,
          warning: 'Solado fachetado sem consumo de fachete cadastrado — a forração extra do salto NÃO entrou no cálculo. Cadastre o consumo por numeração em Materiais → Solado (fachete_lining_consumption_dm2).',
        });
      }
    }

    // ── ITENS-PADRÃO do solado (sole_standard_items_consumption) — F2-01 ─────
    // Espelha o ramo "Item padrão (solado)" do SQL by_grade: químicos/colas com
    // consumo POR NUMERAÇÃO na unidade cadastrada (ex.: g/par), convertidos pra
    // unidade de ESTOQUE do produto (convert_to_product_unit) e com o MESMO
    // dedup anti-BOM (produto coberto sai do BOM/direct — v_covered_product_ids).
    // Antes o motor TS só enxergava o BOM da ficha: picking/modal e custeio/
    // débito (SQL) descreviam consumos contraditórios do mesmo pedido (HOTMELT
    // 1000× na OP-2026-01142). A taxonomia de exibição segue a do motor
    // (classifyBomMaterial → cola vira 'Químicos'), preservando o roteamento
    // por setor das fichas de operador.
    const stdCoveredProductIds = new Set<string>();
    {
      const stdItemsForSole = soleProductIdResolved
        ? (soleStandardItemsBySole.get(soleProductIdResolved) || [])
        : [];
      if (stdItemsForSole.length > 0 && Object.keys(scaledBreakdown).length > 0) {
        const stdAcc = new Map<string, { required: number; unit: string | null }>();
        for (const [sizeKey, pairs] of Object.entries(scaledBreakdown)) {
          // Numeração conjugada ("33/34") casa pelo primeiro número — mesmo
          // split_part(key,'/',1)::int do SQL.
          const sizeInt = parseInt(String(sizeKey).split('/')[0], 10);
          if (!Number.isFinite(sizeInt) || !(pairs > 0)) continue;
          for (const std of stdItemsForSole) {
            if (std.size !== sizeInt) continue;
            const a = stdAcc.get(std.standardItemId) || { required: 0, unit: std.unit };
            a.required += std.consumption * pairs;
            stdAcc.set(std.standardItemId, a);
          }
        }
        for (const [pid, a] of stdAcc.entries()) {
          if (!(a.required > 0)) continue;
          const prod = (allProducts || []).find((p: any) => p.id === pid);
          if (!prod) continue;
          const stdGroupName = (productGroups || []).find((g: any) => g.id === prod.group_id)?.name
            || prod.category || prod.name || 'Outros';
          const converted = convertToProductUnit(a.required, a.unit, prod.unit);
          addConsumptionRow(consumptionMap, {
            componentType: classifyBomMaterial(stdGroupName, prod.name || '', prod.category || ''),
            groupName: stdGroupName,
            materialName: prod.name || stdGroupName,
            productUnit: converted != null ? (prod.unit || a.unit || 'un') : (a.unit || prod.unit || 'un'),
            color: prod.color || '—',
            totalQuantity: converted != null ? converted : a.required,
            // Unidades incompatíveis (ex.: g→m): mantém a qtd crua + aviso,
            // igual ao conversion_warning do SQL.
            warning: converted == null
              ? `Unidade do item-padrão (${a.unit || '?'}) incompatível com a unidade do produto (${prod.unit || '?'}) — quantidade NÃO convertida; cadastre a unidade correta`
              : undefined,
          });
          stdCoveredProductIds.add(pid);
        }
      }
    }

    // Família de napa da tira = napa da FICHA TÉCNICA da referência (cabedal
    // primeiro, forro como fallback — nas fichas de sandália o cabedal costuma
    // ficar vazio e a napa vive em lining_material). Regra do usuário: a tira
    // segue o material da referência, sem mistura. NÃO é variant-aware ainda
    // (igual ao split do Corte Forração) — variante de napa por cor fica pra
    // depois. Ver specs/tira-base-napa-por-ficha-tecnica.md.
    const refNapaFamily = ((sheet?.upper_material || '').toString().trim())
      || ((sheet?.lining_material || '').toString().trim())
      || null;
    const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const sheetStraps: any[] = sheetStrapsMap.get(item.reference_id) || [];
    const resolvedStraps = resolveOrderStraps(itemStraps, sheetStraps);
    for (const strap of resolvedStraps) {
      const strapConsumptionCm = calculateStrapConsumptionCm(strap, {
        grade: (item as any).grade || {},
        quantity: itemQuantity,
        fichas: (item as any).fichas,
      });

      addConsumptionRow(consumptionMap, {
        componentType: 'Tiras',
        groupName: strap.group_name || strap.label || 'Tira',
        materialName: strap.label || strap.group_name || 'Tira',
        productUnit: 'metro',
        color: strap.color || orderColor,
        totalQuantity: strapConsumptionCm / 100,
        materialFamily: refNapaFamily,
      });
    }

    // Componentes Diretos (technical_sheets.direct_components) — itens cadastrados
    // direto na ficha (ex: BINÓCULO 6MM com qty=8/par) que NÃO vivem no BOM
    // (sheet_materials). Antes de 2026-06-06 esse caminho era ignorado pelo
    // motor — direct_components só era lido em calculate_order_consumption SQL,
    // gerando inconsistência: ficha pedia 8 binóculos/par e o modal/ficha de
    // operador mostrava só o que vinha do BOM (qty=1 em outras refs).
    // Componentes por cor (opt-in) OU direct_components (fallback). Espelha o
    // gate do SQL (calculate_order_consumption_by_grade): com component_colors_enabled
    // ligado e mapeamento pra a cor do pedido, a lista POR COR substitui
    // direct_components por completo (cada cor lista tudo). Sem flag, ou cor sem
    // mapeamento, cai em direct_components.
    const hasOrderColor = !!orderColor && orderColor !== '—';
    const perColorComponents = (hasOrderColor && sheet?.component_colors_enabled)
      ? componentColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`)
      : undefined;
    const usedPerColorComponents = !!(perColorComponents && perColorComponents.length > 0);
    const directComponents = usedPerColorComponents
      ? perColorComponents.map((r) => ({ product_id: r.productId, quantity: r.quantityPerUnit }))
      : (Array.isArray(sheet?.direct_components) ? sheet.direct_components : []);
    // Ficha com "componentes por cor" LIGADO mas SEM mapeamento pra a cor deste
    // item: o fallback usa a lista GERAL, que costuma listar TODAS as variantes de
    // cor do mesmo ornamento — e o par passa a consumir uma de cada. Foi o que
    // aconteceu no PV-00147/DS22: só OFF WHITE estava mapeado, e o item CAPUCCINO
    // caiu no fallback puxando ABS MARROM (8/par) + ABS TURQUEZA AZUL (8/par) =
    // 16 ornamentos/par, inflando o ABS MARROM pra 4.608 (2.304 legítimos do OFF
    // WHITE + 2.304 indevidos do CAPUCCINO). Não dá pra ADIVINHAR qual variante é
    // a certa — quem sabe é o cadastro. Então mantemos o número (paridade com o
    // SQL, que faz o mesmo fallback e já gravou as reservas) e MARCAMOS a linha,
    // pra o modal parar de mostrar consumo inflado como se fosse normal.
    const unmappedColorFallback = hasOrderColor
      && !!sheet?.component_colors_enabled
      && !usedPerColorComponents
      && Array.isArray(sheet?.direct_components)
      && sheet.direct_components.length > 0;
    const unmappedColorWarning = unmappedColorFallback
      ? `Cor "${orderColor}" sem mapeamento em Componentes por Cor desta ficha — consumo caiu na lista geral e pode estar somando variantes de cor que não vão neste par. Cadastre a cor em Materiais → Componentes por Cor.`
      : undefined;
    const directProductIds = new Set<string>();
    for (const dc of directComponents) {
      const pid = (dc as any)?.product_id;
      const qtyPerPair = Number((dc as any)?.quantity) || 0;
      if (!pid || qtyPerPair <= 0) continue;
      // Produto já coberto pelo item-padrão do solado → dedup (F2-01, espelha
      // o v_covered_product_ids do SQL — o item-padrão é a fonte).
      if (stdCoveredProductIds.has(pid)) continue;
      const prod = (allProducts || []).find((p: any) => p.id === pid);
      if (!prod) continue;
      directProductIds.add(pid);
      const groupName = (productGroups || []).find((g: any) => g.id === prod.group_id)?.name
        || prod.category || (dc as any)?.product_name || prod.name || 'Componente';
      const totalQty = qtyPerPair * itemQuantity;
      addConsumptionRow(consumptionMap, {
        componentType: classifyBomMaterial(groupName, prod.name || '', prod.category || ''),
        groupName,
        materialName: prod.name || (dc as any)?.product_name || 'Componente',
        productUnit: prod.unit || (dc as any)?.unit || 'un',
        color: prod.color || '—',
        totalQuantity: totalQty,
        productIds: [pid],
        warning: unmappedColorWarning,
      });
    }

    const specGroupsWithConsumption = new Map<string, number>();
    // Grupo EFETIVO de palmilha (variante > ficha) — o dedup do BOM abaixo tem
    // que casar com o grupo que a linha de Palmilha realmente usou.
    const effectiveInsoleGroupName = insoleVariantDriven
      ? (insoleVariant.groupName || sheet?.insole_material || '')
      : (sheet?.insole_material || '');
    if (upperMatch?.group) specGroupsWithConsumption.set(upperMatch.group.toLowerCase(), upperMatch.consumption);
    if (liningMatch?.group) specGroupsWithConsumption.set(liningMatch.group.toLowerCase(), liningMatch.consumption);
    if (effectiveInsoleGroupName && (Number(sheet?.insole_consumption) || 0) > 0) specGroupsWithConsumption.set(effectiveInsoleGroupName.toLowerCase(), Number(sheet.insole_consumption));
    if (sheet?.sole_material && (Number(sheet?.sole_consumption) || 0) > 0) specGroupsWithConsumption.set(String(sheet.sole_material).toLowerCase(), Number(sheet.sole_consumption));

    // BOM efetivo do item (semântica get_effective_bom, mig 20260525140000):
    // linha com material_variant_id NULL = compartilhada (vale pra todas as
    // variantes); linha da variante DESTE item entra e, quando repete o
    // product_id de uma compartilhada, PREVALECE (override); linha de OUTRA
    // variante fica de fora. Sem variante no item → só as compartilhadas.
    const sheetBomLines = (materials || []).filter((material: any) => material.sheet_id === item.reference_id);
    const itemVariantId = item.material_variant_id || null;
    const variantBomLines = itemVariantId
      ? sheetBomLines.filter((m: any) => m.material_variant_id === itemVariantId)
      : [];
    const variantBomProductIds = new Set(variantBomLines.map((m: any) => m.product_id));
    const itemMaterials = [
      ...sheetBomLines.filter((m: any) => !m.material_variant_id && !variantBomProductIds.has(m.product_id)),
      ...variantBomLines,
    ];

    // Embalagem: a ficha pode listar VÁRIAS caixas no BOM (colmeia + individual)
    // como ALTERNATIVAS. Quando o pedido define um packaging_mode, mostra só a
    // caixa do modo escolhido — senão addConsumptionRow somaria as duas no grupo
    // "EMBALAGEM" (qtd inflada) e rotularia com a primeira. Pré-varre os tipos de
    // caixa presentes nesta ficha pra o filtro só agir quando há alternativa.
    const itemPackagingMode = item.packagingMode;
    const presentCaixaTypes = new Set<CollectiveType>();
    if (itemPackagingMode) {
      for (const m of itemMaterials) {
        const p = m.products as any;
        if (!p) continue;
        const gName = (m.product_groups as any)?.name || p.category || p.name || '';
        if (classifyBomMaterial(gName, p.name || '', p.category || '') !== 'Embalagem') continue;
        const t = caixaCollectiveTypeFromName(p.name);
        if (t) presentCaixaTypes.add(t);
      }
    }

    for (const material of itemMaterials) {
      const product = material.products as any;
      const group = material.product_groups as any;
      if (!product) continue;

      const groupName = group?.name || product.category || product.name || 'Outros';
      const groupKey = groupName.toLowerCase();
      const specHasGroup = specGroupsWithConsumption.has(groupKey);

      // Skip se já foi adicionado por direct_components (mesmo product_id).
      // Antes, BINÓCULO 6MM cadastrado em direct_components do S-039 ficava
      // somando com BINÓCULO 6MM do BOM da DS12, gerando duplicação. Direct
      // tem prioridade — BOM é fallback pra materiais não declarados direto.
      if (directProductIds.has(material.product_id)) continue;
      // Skip se o produto veio do ITEM-PADRÃO do solado (F2-01) — mesmo dedup
      // do SQL (v_covered_product_ids): o BOM homônimo NÃO soma por cima.
      if (stdCoveredProductIds.has(material.product_id)) continue;

      // Solado NUNCA vem do BOM por área: o caminho da ficha (sole_consumption
      // por par, com numeração/conjugação/estoque) é a fonte única do solado.
      // Quando um produto-solado (categoria "Solado") é listado também no BOM —
      // ex.: PV-00141 tinha o produto "01" no sheet_materials da ref —, ele cai
      // em classifyBomMaterial='Solado' mas o dedup por nome de grupo não casava
      // ("solado" ≠ "01"), criando um bloco de Solado fantasma (1248 "pares"
      // além dos 1668 reais da matriz por numeração). Pula sempre que a ficha
      // define um solado; sem solado na ficha, o BOM segue como fallback.
      const bomComponentType = classifyBomMaterial(groupName, product.name || '', product.category || '');

      // Embalagem com modo definido: pula a caixa que NÃO é a do packaging_mode
      // do pedido (só quando há alternativas reais na ficha — ver pré-varredura).
      if (bomComponentType === 'Embalagem'
        && !shouldShowCaixaForMode(product.name, itemPackagingMode, presentCaixaTypes)) continue;

      const isSoleBom = normalizeText(product.category) === 'solado'
        || bomComponentType === 'Solado';
      // `soleGroupName` não-vazio = a ficha RESOLVEU um solado (mapping/
      // coligação/primary) mesmo sem sole_material/sole_consumption — com o
      // default de 1 par/par (fix (b) acima), a linha da ficha passou a existir
      // nesses casos e o BOM duplicaria o solado sem esta condição extra.
      const sheetHasSole = String(sheet?.sole_material || '').trim().length > 0
        || (Number(sheet?.sole_consumption) || 0) > 0
        || soleGroupName.trim().length > 0;
      if (isSoleBom && sheetHasSole) continue;

      // Materiais coloridos do BOM (cabedal/forração/tiras) cadastrados numa COR
      // fixa que não é a do pedido são sobras de outra colorway — ex.: PV-00141
      // (NUDE) tinha NAPA SANTORINE/ABACATE e NAPA SOFT/ADOCICADO (cabedal) e
      // ainda "Tira chata 8mm: COBRE", "Tira chata 25mm: Caramelo/Off White" e
      // "Tira chata 8mm: Ouro Light" (tiras) no sheet_materials da ref, todas em
      // cores que não estão no pedido NUDE. Pula quando a cor explícita do
      // material não casa com a do pedido nem com a do forro mapeado. Materiais
      // sem cor (cola, aviamentos, embalagem, tira genérica) não entram na regra.
      // O caminho CANÔNICO de tiras (strap_colors JSONB da ficha, onde se declara
      // cor de contraste proposital) é tratado acima e NÃO passa por aqui — só o
      // BOM legado é filtrado. (Decisão user 2026-06-07; tiras add 2026-06-07.)
      if ((bomComponentType === 'Cabedal' || bomComponentType === 'Forração' || bomComponentType === 'Tiras') && orderColor && orderColor !== '—') {
        const matColor = normalizeText(material.color || product.color);
        if (matColor) {
          const itemLiningColor = liningColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`)
            || liningDefaultMap.get(item.reference_id) || orderColor;
          const acceptable = [orderColor, itemLiningColor].map((c) => normalizeText(c)).filter(Boolean);
          const matches = acceptable.some((c) =>
            c === matColor || (c.length > 3 && matColor.length > 3 && (c.includes(matColor) || matColor.includes(c))));
          if (!matches) continue;
        }
      }

      if (specHasGroup) {
        const bomType = classifyBomMaterial(groupName, product.name || '', product.category || '');
        const isUpperGroup = upperMatch?.group?.toLowerCase() === groupKey;
        const isLiningGroup = liningMatch?.group?.toLowerCase() === groupKey;
        const isInsoleGroup = effectiveInsoleGroupName.toLowerCase() === groupKey;
        const isSoleGroup = sheet?.sole_material?.toLowerCase() === groupKey;
        const shouldSkip = (isUpperGroup && bomType === 'Cabedal') ||
                           (isLiningGroup && bomType === 'Forração') ||
                           (isInsoleGroup && (bomType === 'Palmilha' || product.category?.toLowerCase().includes('palmilha'))) ||
                           (isSoleGroup && bomType === 'Solado');
        if (shouldSkip) continue;
      }

      // Dedup adicional pra Palmilha duplicada: se o produto é categoria Palmilha
      // OU o classifyBom retorna Palmilha, E o caminho do insole spec já
      // adicionou a placa (palmProductId em palmilhaColorMap), SKIPA o BOM —
      // senão a mesma placa aparece em 2 linhas (PLACA(S) + DM²).
      const bomTypeForDedup = classifyBomMaterial(groupName, product.name || '', product.category || '');
      if (bomTypeForDedup === 'Palmilha') {
        const palmMap = palmilhaColorMap.get(`${item.reference_id}::${normalizeColorKey(orderColor)}`) || palmilhaDefaultMap.get(item.reference_id);
        if (palmMap?.productId && palmMap.productId === material.product_id) continue;
        // Caminho legacy (sem mapping explícito) — sheet.insole_material aponta
        // pro mesmo grupo: skipa pra evitar PLACA + DM² duplicada.
        if (!palmMap?.productId && sheet?.insole_material && groupKey === String(sheet.insole_material).toLowerCase()) {
          continue;
        }
      }

      let productUnit = product.unit || 'un';
      const unitLc = productUnit.toLowerCase();
      // Set canônico (materialConsumption) — a lista inline omitia 'm linear'
      // e o item nessa unidade não convertia dm²→m no caminho BOM (UNIT-1).
      const isLinearUnit = LINEAR_UNITS.has(unitLc);
      const rawQty = (Number(material.quantity_per_unit) || 0) * itemQuantity;
      let totalQty = rawQty;
      let widthMissing = false;

      // Materiais de ÁREA cortados de bobina (napa/couro): têm ficha de componente
      // e quantity_per_unit está em dm²/par. Converter para metros lineares pela
      // largura — senão aparece ~100× inflado. Tiras/itens sem ficha passam direto.
      const cs = (componentSheets || []).find((c: any) => c.product_id === material.product_id) || null;
      if (isLinearUnit && cs) {
        if (!isLinearWidthMissing(cs as any, productUnit)) {
          totalQty = convertDm2ToLinearMeters(rawQty, cs as any);
          productUnit = 'metro';
        } else {
          // tem ficha de área mas sem largura → NÃO dá pra converter dm²→metro.
          // Mantém o valor em dm² (regra canônica do CLAUDE.md) e marca aviso; a
          // UI deixa a linha neutra (não compara com estoque). Antes fazia dm²/100
          // (cm) ou mantinha dm² rotulando como 'metro' — número até ~100× errado.
          widthMissing = true;
          totalQty = rawQty;
          productUnit = 'dm2';
        }
      } else if (unitLc === 'cm') {
        totalQty = rawQty / 100;
        productUnit = 'metro';
      }

      addConsumptionRow(consumptionMap, {
        componentType: classifyBomMaterial(groupName, product.name || '', product.category || ''),
        groupName,
        materialName: product.name || groupName,
        productUnit,
        // Cor da LINHA do BOM quando houver; senão a cor própria do produto.
        // Sem o fallback, um componente sem cor na linha (ex.: BINÓCULO 6MM no
        // BOM da DS12) virava cor "—" e NÃO consolidava com a mesma peça vinda
        // de direct_components (cor "DOURADO" do produto, ex.: S-039) — o mesmo
        // binóculo aparecia em 2 linhas. (PV-00141.)
        color: material.color || product.color || '—',
        totalQuantity: totalQty,
        widthMissing,
        productIds: material.product_id ? [material.product_id] : undefined,
      });
    }
  }

  return Array.from(consumptionMap.values());
}
