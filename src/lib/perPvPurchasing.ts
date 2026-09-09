/**
 * Canal "Compras por Pedido" — lógica PURA de agrupamento de materiais em OCs.
 *
 * Separado do MRP/ondas: aqui geramos OCs a partir de UM PV (ou de um conjunto
 * selecionado), uma OC por fornecedor + uma OC agrupada "Sem Fornecedor".
 *
 * A DEMANDA em si (consumo × pares, conversão dm²→física, desconto de
 * estoque/reserva) é calculada no banco pela RPC `compute_materials_per_pv`
 * (wrapper de `calculate_order_consumption` — o motor canônico de consumo, o
 * mesmo do modal "Consumo de Materiais", do MRP e das ondas). Este módulo só
 * recebe a lista de necessidades já calculada e a empacota em OCs — por isso é
 * 100% testável sem banco.
 */

import { roundUpToPurchaseMultiple } from '@/lib/purchaseMultiple';
import { rateGradeToTotal } from '@/lib/gradeDistribution';

/** Uma necessidade de material vinda da RPC compute_materials_per_pv. */
export interface PvMaterialNeed {
  /** Identidade de estoque XOR: material comum usa products; embalagem usa
   *  box_types diretamente, sem produto espelho/nome inferido. */
  material_id: string | null;
  box_type_id?: string | null;
  packaging_type?: string | null;
  product_name: string;
  unit: string;
  color?: string | null;
  /** Código do produto (`products.sku`). Nos materiais de componente/napa/cola
   *  esse campo já guarda o CÓDIGO DO FORNECEDOR (ex.: 8440418106 no binóculo,
   *  6835/6836 nas napas) — é o dado que faz o fornecedor separar o item certo.
   *  Enriquecido pela UI a partir do cadastro. */
  sku?: string | null;
  /** Descrição técnica do cadastro (`products.technical_name`). Carrega a
   *  especificação real que o nome curto não tem — acabamento, embalagem,
   *  bitola, classificação ONU (ex.: "ABS MARROM 12MM /DOURADO / +-1000PCS COM
   *  PREGO 6MM"). Enriquecida pela UI. */
  technical_name?: string | null;
  /** Necessidade BRUTA do(s) PV(s): consumo × pares (já convertido dm²→física). */
  needed_qty: number;
  /** Estoque líquido disponível (quantity − reserved_stock). Informativo. */
  stock_qty?: number | null;
  /** Falta líquida = max(0, needed − stock). Informativo. */
  shortage?: number | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  /** Custo padrão do produto (estimativa de preço da OC). */
  last_unit_price: number;
  is_artisanal?: boolean;
  /** Múltiplo de compra (embalagem): qtd arredonda pra cima. Enriquecido pela UI. */
  purchase_multiple?: number | null;
  /** Unidade de COMPRA do produto (ex.: 'placa') quando ≠ da unidade de estoque
   *  (`unit`, ex.: 'dm²'). Enriquecido pela UI a partir de products.purchase_unit.
   *  Vazio/igual a `unit` ⇒ sem conversão. */
  purchase_unit?: string | null;
  /** Fator estoque↔compra: quanto de `unit` cabe em 1 `purchase_unit` (ex.: 150
   *  dm²/placa). Enriquecido pela UI via effectiveConversionFactorStrict — MESMO
   *  fator que o recebimento da OC usa pra creditar estoque (round-trip exato).
   *  1 (ou ausente) ⇒ compra na própria unidade de estoque. */
  conversion_factor?: number | null;
  /** Grade do SOLADO por numeração (total de pares por número). Só vem preenchida
   *  nas linhas de solado; demais materiais vêm null. Exibida na OC como no
   *  consumo de materiais. */
  grade?: Record<string, number> | null;
  /** Falta líquida do solado por numeração, calculada contra stock_grade pela
   *  RPC específica de compra. Quando netOfStock=true, esta é a grade da OC. */
  shortage_grade?: Record<string, number> | null;
  /** Há OC/ROP ainda aberta para o mesmo produto. Exige confirmação consciente. */
  open_purchase_warning?: string | null;
  /** TRUE quando a cor pedida não tem produto cadastrado e o consumo caiu numa
   *  cor diferente (matched_by='color_mismatch'). GUARD: a OC marca a linha e
   *  bloqueia a geração até cadastrar a cor. */
  color_mismatch?: boolean | null;
  /** Aviso de conversão dm²→física (largura faltando na ficha de componente).
   *  Linhas com warning vêm com a parcela afetada FORA de needed_qty (senão a
   *  OC compraria ~100× em dm² cru); needed 0 + warning ⇒ resolver o cadastro
   *  da largura antes de comprar. Auditoria 2026-07-01. */
  conversion_warning?: string | null;
  /** Identidades estruturais opcionais. Versões novas do RPC podem devolvê-las;
   *  quando presentes, o canal per_pv deve excluir a linha sem interpretar nome. */
  strap_variant_id?: string | null;
  technical_strap_line_id?: string | null;
  finished_product_id?: string | null;
  product_group_id?: string | null;
}

export interface DraftPurchaseOrderItem {
  /** Exatamente um entre material_id e box_type_id deve estar preenchido. */
  material_id: string | null;
  box_type_id?: string | null;
  packaging_type?: string | null;
  product_name: string;
  unit: string;
  color: string | null;
  /** Código do produto — vai pra OC do fornecedor. Ver PvMaterialNeed.sku. */
  sku?: string | null;
  /** Descrição técnica — vai pra OC do fornecedor. Ver PvMaterialNeed.technical_name. */
  technical_name?: string | null;
  /** Quantidade a comprar (default = needed_qty bruto; editável na UI). */
  quantity: number;
  /** Decisão explícita do operador: true compra só a falta; false preserva o
   * estoque e permite comprar até a necessidade bruta atual. */
  net_of_stock: boolean;
  needed_qty: number;
  stock_qty: number;
  unit_price: number;
  purchase_multiple?: number | null;
  /** Excedente comprado a mais por arredondamento (múltiplo de compra OU inteiro
   *  da unidade contável). qtd − necessidade pré-arredondamento. 0 quando não
   *  houve. Exibido em azul. */
  rounding_surplus?: number;
  /** Grade do solado por numeração (total de pares). Só em linhas de solado. */
  grade?: Record<string, number> | null;
  /** Peso por numeração da falta líquida; usado só enquanto o draft é montado. */
  shortage_grade?: Record<string, number> | null;
  /** Cor pedida sem produto cadastrado (caiu noutra cor). Bloqueia a OC. */
  color_mismatch?: boolean;
  /** Aviso acionável vindo da RPC (ver PvMaterialNeed.conversion_warning).
   *  Presente ⇒ parte da necessidade ficou FORA de `needed_qty`: esta linha
   *  compra A MENOS do que o pedido consome até o cadastro ser corrigido. */
  conversion_warning?: string | null;
  /** Proveniência estrutural preservada até o último guard antes do INSERT. */
  strap_variant_id?: string | null;
  technical_strap_line_id?: string | null;
  finished_product_id?: string | null;
  product_group_id?: string | null;
}

/** Soma duas grades por numeração (chaves = números/conjugados). */
function mergeGrade(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!a && !b) return null;
  const out: Record<string, number> = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = (out[k] || 0) + (Number(v) || 0);
  return out;
}

export interface DraftPurchaseOrder {
  supplier_id: string | null;
  /** NO_SUPPLIER_LABEL quando supplier_id é null. */
  supplier_name: string;
  items: DraftPurchaseOrderItem[];
  total: number;
}

export const NO_SUPPLIER_LABEL = 'Sem Fornecedor';

export interface PerPvStrapIdentityGuard {
  canonicalFinishedProductIds: ReadonlySet<string>;
  canonicalStrapGroupIds: ReadonlySet<string>;
  legacyArtisanalProductIds: ReadonlySet<string>;
  productGroupByProductId: ReadonlyMap<string, string>;
}

interface PerPvStrapCatalogLike {
  variants?: Array<{ id?: string | null; finished_product_id?: string | null }>;
  groups?: Array<{ id?: string | null; is_artisanal_strap?: boolean | null }>;
  /** Produtos-base oficiais não são, por si, tira acabada: a mesma napa pode
   *  ser um material comum do calçado e não deve sumir do per_pv. */
  official_products?: Array<{ official_product_id?: string | null }>;
}

interface PerPvProductIdentityLike {
  id?: string | null;
  group_id?: string | null;
  is_artisanal?: boolean | null;
}

interface PerPvGroupIdentityLike {
  id?: string | null;
  is_artisanal_strap?: boolean | null;
}

function nonEmptyId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id || null;
}

/**
 * Compila apenas evidências estruturais. Nomes/SKUs nunca entram: um material
 * comum que contenha “tira” no texto deve continuar no canal per_pv.
 */
export function createPerPvStrapIdentityGuard({
  catalog,
  products = [],
  groups = [],
}: {
  catalog?: PerPvStrapCatalogLike | null;
  products?: PerPvProductIdentityLike[];
  groups?: PerPvGroupIdentityLike[];
}): PerPvStrapIdentityGuard {
  const canonicalFinishedProductIds = new Set<string>();
  const canonicalStrapGroupIds = new Set<string>();
  const legacyArtisanalProductIds = new Set<string>();
  const productGroupByProductId = new Map<string, string>();

  for (const variant of catalog?.variants || []) {
    const productId = nonEmptyId(variant.finished_product_id);
    if (productId) canonicalFinishedProductIds.add(productId);
  }
  for (const group of [...(catalog?.groups || []), ...groups]) {
    const groupId = nonEmptyId(group.id);
    if (groupId && group.is_artisanal_strap === true) canonicalStrapGroupIds.add(groupId);
  }
  for (const product of products) {
    const productId = nonEmptyId(product.id);
    const groupId = nonEmptyId(product.group_id);
    if (!productId) continue;
    if (groupId) productGroupByProductId.set(productId, groupId);
    if (product.is_artisanal === true) legacyArtisanalProductIds.add(productId);
  }
  return {
    canonicalFinishedProductIds,
    canonicalStrapGroupIds,
    legacyArtisanalProductIds,
    productGroupByProductId,
  };
}

export type PerPvPurchasableIdentity = Pick<DraftPurchaseOrderItem, 'material_id'> & Partial<Pick<
  PvMaterialNeed,
  'strap_variant_id' | 'technical_strap_line_id' | 'finished_product_id' | 'product_group_id'
>>;

export function isStructuralArtisanalStrapPurchaseItem(
  item: PerPvPurchasableIdentity,
  guard: PerPvStrapIdentityGuard,
) {
  const materialId = nonEmptyId(item.material_id);
  const variantId = nonEmptyId(item.strap_variant_id);
  const technicalLineId = nonEmptyId(item.technical_strap_line_id);
  const finishedProductId = nonEmptyId(item.finished_product_id);
  const groupId = nonEmptyId(item.product_group_id)
    || (materialId ? guard.productGroupByProductId.get(materialId) || null : null);
  return Boolean(
    technicalLineId
    // A própria coluna `strap_variant_id` é uma FK estrutural do domínio; se a
    // variante foi arquivada/está em revisão e sumiu do catálogo, ainda assim a
    // linha jamais volta para o canal genérico.
    || variantId
    // `finished_product_id` neste payload é o produto acabado resolvido pela
    // variante de tira, não um product_id genérico. A presença também fecha o
    // canal mesmo durante revisão/migração do catálogo.
    || finishedProductId
    || (materialId && guard.canonicalFinishedProductIds.has(materialId))
    || (materialId && guard.legacyArtisanalProductIds.has(materialId))
    || (groupId && guard.canonicalStrapGroupIds.has(groupId))
  );
}

export function partitionPerPvStrapPurchaseItems<T extends PerPvPurchasableIdentity>(
  items: T[],
  guard: PerPvStrapIdentityGuard,
) {
  const common: T[] = [];
  const straps: T[] = [];
  for (const item of items) {
    (isStructuralArtisanalStrapPurchaseItem(item, guard) ? straps : common).push(item);
  }
  return { common, straps };
}

/** Defesa final para qualquer caller do hook, inclusive fora do diálogo. */
export function excludeStrapsFromPerPvDrafts(
  drafts: DraftPurchaseOrder[],
  guard: PerPvStrapIdentityGuard,
) {
  const excluded: DraftPurchaseOrderItem[] = [];
  const commonDrafts = drafts.flatMap((draft) => {
    const partitioned = partitionPerPvStrapPurchaseItems(draft.items, guard);
    excluded.push(...partitioned.straps);
    if (partitioned.common.length === 0) return [];
    return [{
      ...draft,
      items: partitioned.common,
      total: round3(partitioned.common.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)),
    }];
  });
  return { drafts: commonDrafts, excluded };
}

export interface BuildOptions {
  /**
   * Quando true, a quantidade da OC = falta líquida (max(0, needed − stock)) e
   * itens totalmente cobertos por estoque são descartados. Quando false
   * (default), usa a necessidade BRUTA — comprar tudo que o pedido consome,
   * sem netar contra estoque (evita o double-count de reserved_stock do
   * próprio PV e é o comportamento esperado pra "comprar pra ESTE pedido").
   */
  netOfStock?: boolean;
}

/** Arredonda pra 3 casas, evitando lixo de ponto flutuante. */
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function colorKey(c: string | null | undefined): string {
  return (c ?? '').trim().toLowerCase();
}

export function perPvStockIdentity(item: {
  material_id?: string | null;
  box_type_id?: string | null;
}): { kind: 'product' | 'box_type'; id: string } | null {
  const productId = nonEmptyId(item.material_id);
  const boxTypeId = nonEmptyId(item.box_type_id);
  if ((productId === null) === (boxTypeId === null)) return null;
  return productId
    ? { kind: 'product', id: productId }
    : { kind: 'box_type', id: boxTypeId! };
}

export function perPvStockIdentityKey(item: {
  material_id?: string | null;
  box_type_id?: string | null;
}): string {
  const identity = perPvStockIdentity(item);
  return identity ? `${identity.kind}:${identity.id}` : 'invalid';
}

/**
 * Unidades de COMPRA contáveis (vendidas por inteiro) — a quantidade da OC
 * arredonda pra cima pro inteiro. Espelha DISCRETE_PURCHASE_UNITS de
 * materialAutoPO.ts. Materiais contínuos (m/dm²/kg/L) ficam fracionados.
 */
const DISCRETE_PURCHASE_UNITS = new Set([
  'un', 'unid', 'unidade', 'und', 'par', 'pares', 'placa', 'placas', 'chapa',
  'cx', 'caixa', 'rolo', 'rolos', 'pç', 'pc', 'peça', 'peca', 'dz', 'dúzia',
]);

function isDiscretePurchaseUnit(u: string | null | undefined): boolean {
  return DISCRETE_PURCHASE_UNITS.has((u ?? '').trim().toLowerCase());
}

/**
 * Empacota necessidades de material em OCs, uma por fornecedor + uma agrupada
 * "Sem Fornecedor".
 *
 * - Linhas com mesmo (material_id + cor) são MESCLADAS somando as quantidades
 *   (cobre o caso de 2 PVs com o mesmo material — a RPC já soma no banco, mas
 *   mesclamos de novo defensivamente).
 * - Agrupa por supplier_id; supplier_id null cai num único balde
 *   NO_SUPPLIER_LABEL.
 * - Ordena: fornecedores nomeados em ordem alfabética, "Sem Fornecedor" por
 *   último (a UI exibe o aviso dele no topo separadamente).
 */
export function buildPerPvPurchaseOrders(
  needs: PvMaterialNeed[],
  opts: BuildOptions = {},
): DraftPurchaseOrder[] {
  const netOfStock = opts.netOfStock ?? false;

  // 1) Mescla por (tipo de identidade + UUID + cor).
  const merged = new Map<string, DraftPurchaseOrderItem & { supplier_id: string | null; supplier_name: string | null; conversion_factor: number; purchase_unit: string | null }>();
  for (const n of needs) {
    if (!n) continue;
    const identity = perPvStockIdentity(n);
    if (!identity) continue;
    const key = `${identity.kind}:${identity.id}::${colorKey(n.color)}`;
    const needed = Number(n.needed_qty) || 0;
    const stock = Number(n.stock_qty) || 0;
    const price = Number(n.last_unit_price) || 0;
    const existing = merged.get(key);
    if (existing) {
      existing.needed_qty = round3(existing.needed_qty + needed);
      existing.stock_qty = round3(existing.stock_qty + stock);
      // mantém o maior preço conhecido (mais conservador pra estimativa)
      existing.unit_price = Math.max(existing.unit_price, price);
      existing.grade = mergeGrade(existing.grade, n.grade);
      existing.shortage_grade = mergeGrade(existing.shortage_grade, n.shortage_grade);
      existing.color_mismatch = !!existing.color_mismatch || !!n.color_mismatch;
      // Basta UM aviso pra linha estar comprometida — guarda o primeiro (a RPC
      // já agrega por (produto, cor), então na prática só há um).
      existing.conversion_warning = existing.conversion_warning || (n.conversion_warning ?? null);
      existing.strap_variant_id = existing.strap_variant_id || n.strap_variant_id || null;
      existing.technical_strap_line_id = existing.technical_strap_line_id || n.technical_strap_line_id || null;
      existing.finished_product_id = existing.finished_product_id || n.finished_product_id || null;
      existing.product_group_id = existing.product_group_id || n.product_group_id || null;
    } else {
      merged.set(key, {
        material_id: identity.kind === 'product' ? identity.id : null,
        box_type_id: identity.kind === 'box_type' ? identity.id : null,
        packaging_type: n.packaging_type ?? null,
        product_name: n.product_name,
        unit: n.unit || 'un',
        color: (n.color ?? null) || null,
        sku: n.sku ?? null,
        technical_name: n.technical_name ?? null,
        quantity: 0, // definido abaixo
        net_of_stock: netOfStock,
        needed_qty: round3(needed),
        stock_qty: round3(stock),
        unit_price: price,
        purchase_multiple: n.purchase_multiple ?? null,
        purchase_unit: n.purchase_unit ?? null,
        conversion_factor: Number(n.conversion_factor) > 0 ? Number(n.conversion_factor) : 1,
        grade: n.grade ?? null,
        shortage_grade: n.shortage_grade ?? null,
        color_mismatch: !!n.color_mismatch,
        conversion_warning: n.conversion_warning ?? null,
        strap_variant_id: n.strap_variant_id ?? null,
        technical_strap_line_id: n.technical_strap_line_id ?? null,
        finished_product_id: n.finished_product_id ?? null,
        product_group_id: n.product_group_id ?? null,
        supplier_id: n.supplier_id ?? null,
        supplier_name: n.supplier_name ?? null,
      });
    }
  }

  // 2) Converte estoque→compra, define quantidade a comprar e descarta zeros.
  const items: (DraftPurchaseOrderItem & { supplier_id: string | null; supplier_name: string | null })[] = [];
  for (const it of merged.values()) {
    // Conversão estoque→compra (ex.: PLACA EVA: 10.333 dm² ÷ 150 = 69 placas).
    // O fator é o MESMO do recebimento da OC (effectiveConversionFactorStrict),
    // então a OC sai na unidade que o fornecedor vende e o crédito de estoque no
    // recebimento (qtd × fator) volta exato à unidade de estoque. Sem isto a OC
    // saía em dm² e o recebimento creditava 150× a mais.
    const factor = Number(it.conversion_factor) > 0 ? Number(it.conversion_factor) : 1;
    const usePurchaseUnit = factor !== 1 && !!it.purchase_unit;
    const displayUnit = usePurchaseUnit ? (it.purchase_unit as string) : it.unit;
    const neededP = round3(it.needed_qty / factor);
    const stockP = round3(it.stock_qty / factor);
    const priceP = round3(it.unit_price * factor);

    const qtyRaw = netOfStock ? Math.max(0, round3(neededP - stockP)) : neededP;
    // Múltiplo de compra (embalagem): arredonda pra cima (ex.: 187 → 200 c/ 50).
    let qty = roundUpToPurchaseMultiple(qtyRaw, it.purchase_multiple);
    // Unidade contável (un/par/placa…): não dá pra comprar fração → inteiro.
    if (isDiscretePurchaseUnit(displayUnit)) qty = Math.ceil(round3(qty));
    // Linha zerada NÃO vira item de OC: uma ordem com quantidade 0 não é
    // comprável — o fornecedor não tem o que separar e o recebimento não tem o
    // que creditar. É o caso da tira artesanal BLOQUEADA pelo motor único
    // (`resolve_strap_stock_lines.block_reason` sobe em `conversion_warning`
    // com needed_qty 0): não se compra nada até o cadastro ser resolvido.
    // ⚠ Por isso a linha some daqui — e some CALADA se a UI não ler
    // `conversion_warning` do `needs` cru. `collectPvNeedWarnings` existe pra
    // esse fim: é a UI que mostra a linha bloqueada como AVISO, não como item.
    if (qty <= 0) continue;
    // Excedente do arredondamento — exibido em azul na coluna "A comprar".
    const rounding_surplus = round3(Math.max(0, qty - qtyRaw));
    items.push({
      ...it,
      unit: displayUnit,
      needed_qty: neededP,
      stock_qty: stockP,
      unit_price: priceP,
      quantity: qty,
      // A grade persistida precisa fechar com a quantidade REAL da OC (falta
      // líquida + múltiplo), não com a demanda bruta devolvida pela RPC. Sem
      // este rateio o recebimento de solado trava em soma(grade) != quantity.
      grade: rateGradeToTotal(
        netOfStock && it.shortage_grade ? it.shortage_grade : it.grade,
        qty,
      ),
      rounding_surplus,
    });
  }

  // 3) Agrupa por fornecedor.
  const groups = new Map<string, DraftPurchaseOrder>();
  for (const it of items) {
    const gid = it.supplier_id ?? '__none__';
    let g = groups.get(gid);
    if (!g) {
      g = {
        supplier_id: it.supplier_id,
        supplier_name: it.supplier_id ? (it.supplier_name || 'Fornecedor') : NO_SUPPLIER_LABEL,
        items: [],
        total: 0,
      };
      groups.set(gid, g);
    }
    g.items.push({
      material_id: it.material_id,
      box_type_id: it.box_type_id ?? null,
      packaging_type: it.packaging_type ?? null,
      product_name: it.product_name,
      unit: it.unit,
      color: it.color,
      sku: it.sku ?? null,
      technical_name: it.technical_name ?? null,
      quantity: it.quantity,
      net_of_stock: it.net_of_stock,
      needed_qty: it.needed_qty,
      stock_qty: it.stock_qty,
      unit_price: it.unit_price,
      purchase_multiple: it.purchase_multiple,
      rounding_surplus: it.rounding_surplus,
      grade: it.grade ?? null,
      color_mismatch: !!it.color_mismatch,
      conversion_warning: it.conversion_warning ?? null,
      strap_variant_id: it.strap_variant_id ?? null,
      technical_strap_line_id: it.technical_strap_line_id ?? null,
      finished_product_id: it.finished_product_id ?? null,
      product_group_id: it.product_group_id ?? null,
    });
  }

  // 4) Totais + ordenação interna + ordenação de baldes.
  const result = Array.from(groups.values());
  for (const g of result) {
    g.items.sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR'));
    g.total = round3(g.items.reduce((s, i) => s + i.quantity * i.unit_price, 0));
  }
  result.sort((a, b) => {
    if (a.supplier_id === null) return 1; // "Sem Fornecedor" por último
    if (b.supplier_id === null) return -1;
    return a.supplier_name.localeCompare(b.supplier_name, 'pt-BR');
  });
  return result;
}

/** Uma necessidade que a RPC devolveu com aviso — a UI precisa mostrar. */
export interface PvNeedWarning {
  material_id: string | null;
  box_type_id?: string | null;
  product_name: string;
  color: string | null;
  unit: string;
  /** Quanto ainda entra na OC. 0 ⇒ a linha nem vira item (bloqueio total). */
  needed_qty: number;
  message: string;
}

/**
 * Extrai os avisos acionáveis que a RPC `compute_materials_per_pv` devolve em
 * `conversion_warning` — a MESMA mensagem já formatada pelo banco.
 *
 * Existe porque `buildPerPvPurchaseOrders` descarta a linha de quantidade 0 (ver
 * comentário lá): sem isto, a tira artesanal bloqueada por falta de napa
 * desaparecia da tela sem UMA palavra de explicação, e a OC saía comprando a
 * menos. Duas origens hoje:
 *   • tira artesanal `in_house` sem napa na família+cor / sem receita /
 *     rendimento zerado (`resolve_strap_stock_lines.block_reason`);
 *   • conversão dm²→unidade física sem largura na ficha de componente.
 *
 * Ordena pelo mais grave (bloqueio total primeiro) e depois por nome.
 */
export function collectPvNeedWarnings(needs: PvMaterialNeed[]): PvNeedWarning[] {
  const seen = new Set<string>();
  const out: PvNeedWarning[] = [];
  for (const n of needs || []) {
    const message = (n?.conversion_warning ?? '').trim();
    if (!message) continue;
    const key = `${perPvStockIdentityKey(n)}::${colorKey(n.color)}::${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      material_id: n.material_id,
      box_type_id: n.box_type_id ?? null,
      product_name: n.product_name,
      color: (n.color ?? null) || null,
      unit: n.unit || 'un',
      needed_qty: round3(Number(n.needed_qty) || 0),
      message,
    });
  }
  out.sort((a, b) =>
    (a.needed_qty > 0 ? 1 : 0) - (b.needed_qty > 0 ? 1 : 0)
    || a.product_name.localeCompare(b.product_name, 'pt-BR'));
  return out;
}

/** OCs/ROPs abertas são um risco diferente de cadastro incompleto: o operador
 *  pode prosseguir, mas precisa reconhecer conscientemente a compra já existente. */
export function collectOpenPurchaseWarnings(needs: PvMaterialNeed[]): PvNeedWarning[] {
  const seen = new Set<string>();
  const out: PvNeedWarning[] = [];
  for (const n of needs || []) {
    const message = (n?.open_purchase_warning ?? '').trim();
    if (!message) continue;
    const key = `${perPvStockIdentityKey(n)}::${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      material_id: n.material_id,
      box_type_id: n.box_type_id ?? null,
      product_name: n.product_name,
      color: (n.color ?? null) || null,
      unit: n.unit || 'un',
      needed_qty: round3(Number(n.needed_qty) || 0),
      message,
    });
  }
  return out.sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR'));
}

export interface PerPvDraftSummary {
  supplierCount: number;    // OCs com fornecedor
  hasNoSupplier: boolean;   // existe balde "Sem Fornecedor"?
  orderCount: number;       // total de OCs que serão criadas
  itemCount: number;        // total de itens (linhas)
  noSupplierItemCount: number;
  total: number;            // valor estimado somado
  /** Nº de itens com cor não cadastrada (caíram noutra cor) — GUARD bloqueia gerar. */
  colorMismatchCount: number;
}

export function summarizePerPvDrafts(drafts: DraftPurchaseOrder[]): PerPvDraftSummary {
  const noSupplier = drafts.find((d) => d.supplier_id === null);
  return {
    supplierCount: drafts.filter((d) => d.supplier_id !== null).length,
    hasNoSupplier: !!noSupplier,
    orderCount: drafts.length,
    itemCount: drafts.reduce((s, d) => s + d.items.length, 0),
    noSupplierItemCount: noSupplier ? noSupplier.items.length : 0,
    total: round3(drafts.reduce((s, d) => s + d.total, 0)),
    colorMismatchCount: drafts.reduce((s, d) => s + d.items.filter((i) => i.color_mismatch).length, 0),
  };
}

/**
 * Embalagem canônica (`box_types`) não possui o balde operacional "Sem
 * Fornecedor": a fronteira atômica exige o fornecedor cadastrado no próprio
 * tipo de embalagem. Materiais de `products` continuam podendo formar a OC
 * manual sem fornecedor, portanto a guarda precisa discriminar a identidade.
 */
export function collectPerPvPackagingWithoutSupplier(
  drafts: DraftPurchaseOrder[],
): DraftPurchaseOrderItem[] {
  return drafts.flatMap((draft) => draft.supplier_id === null
    ? draft.items.filter((item) => perPvStockIdentity(item)?.kind === 'box_type')
    : []);
}

/**
 * Predicado canônico do canal — uma OC pertence ao "Compras por Pedido"?
 * Defensivo: trata source_type ausente/null como NÃO per_pv (OCs legadas e do
 * MRP continuam visíveis no menu tradicional).
 */
export function isPerPvPurchaseOrder(po: { source_type?: string | null } | null | undefined): boolean {
  return !!po && po.source_type === 'per_pv';
}
