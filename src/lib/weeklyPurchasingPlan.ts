 import { format, parseISO, addDays, isTuesday, nextTuesday, isBefore, startOfDay } from 'date-fns';
import { convertDm2ToLinearMeters, convertDm2ToPlates, isLinearWidthMissing, type ComponentSheetCandidate } from './materialConsumption';
import { classifyBomMaterial } from './orderConsumption';
import { caixaCollectiveTypeFromName, shouldShowCaixaForMode, type CollectiveType } from './packagingPairsPerBox';

/**
 * Chave do mapa de datas-limite de compra (view purchase_projection_timeline).
 * Compartilhada entre o motor e a tela pra casar OP×material.
 */
export function buyByKey(orderId: string, productId: string): string {
  return `${orderId}::${productId}`;
}

export interface WeeklyOrder {
  id: string;
  reference_id: string;
  quantity: number;
  planned_start: string | null;
  planned_delivery: string | null;
  created_at: string;
  grade?: Record<string, number> | null;
  /**
   * Modo de embalagem do PEDIDO (sale_orders.packaging_mode do PV da OP).
   * Usado pra filtrar caixas ALTERNATIVAS do BOM (colmeia × individual) —
   * sem ele o plano soma as duas e infla a compra de embalagem.
   */
  packaging_mode?: string | null;
}

export interface SheetMaterial {
  sheet_id: string;
  product_id: string;
  quantity_per_unit: number;
  products: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    category?: string | null;
    quantity: number;
    min_stock?: number;
    reserved_stock?: number;
    safety_stock?: number;
    supplier_lead_time_days?: number;
    lead_time_days?: number;
    unit_price: number;
    is_artisanal?: boolean;
  } | null;
}

export interface MaterialPlanRow {
  materialId: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  currentStock: number;
  minStock: number;
  virtualStock: number;
  weeklyPurchases: Record<string, number>;
  totalToBuy: number;
  estimatedCost: number;
}

export interface WeeklyPlanResult {
  sortedWeeks: string[];
  plan: MaterialPlanRow[];
}

/**
 * Calcula a quantidade necessária na UNIDADE FÍSICA do produto.
 *
 * Auditoria 2026-07-01 (achado A — parity com by_grade/modal): o consumo do BOM
 * usa SEMPRE o ESCALAR `quantity_per_unit` (por par), igual ao motor canônico
 * (orderConsumption.ts) e ao lado SQL (`calculate_order_consumption_by_grade`).
 * Antes este plano lia `sheet_materials.consumption_per_size` — a MESMA fonte
 * do bug da cola 5000× (valores gravados por cluster/agregado, não por par) —
 * e a projeção de compra explodia nos materiais afetados.
 *
 * A5 (auditoria): material de ÁREA cortado de bobina/placa (napa/couro/forro) tem o
 * consumo armazenado em dm²/par e precisa ser convertido pela LARGURA da ficha de
 * componente (regra canônica) — antes o valor cru era multiplicado pelo preço (R$/m),
 * inflando ~137×. Item linear DIRETO sem ficha (tira/elástico) já está na unidade
 * nativa e NÃO converte. As funções convertDm2To* aplicam a perda (waste_pct da ficha).
 */
function calculateRequiredAmount(
  mat: SheetMaterial,
  order: WeeklyOrder,
  cs: ComponentSheetCandidate | null
): number {
  const wastePct = Number(cs?.waste_pct) || 0;

  // Total bruto na unidade de CONSUMO armazenada (dm²/par p/ material de área)
  const rawTotal = order.quantity * (Number(mat.quantity_per_unit) || 0);

  const unit = (mat.products?.unit || '').toLowerCase();
  const isLinear = ['m', 'metro', 'metros', 'cm'].includes(unit);
  const isPlate = unit === 'placa' || unit === 'chapa';

  // Área → metros lineares (÷ largura da ficha) quando o produto é linear e a ficha tem largura.
  if (isLinear && cs && !isLinearWidthMissing(cs, unit)) {
    return convertDm2ToLinearMeters(rawTotal, cs);
  }
  // Área → placas quando o produto é placa.
  if (isPlate && cs) {
    return convertDm2ToPlates(rawTotal, cs);
  }
  // Linear direto / contagem / sem ficha: já na unidade nativa, só aplica perda.
  return rawTotal * (1 + wastePct / 100);
}

export function generateWeeklyPurchasingPlan(
  orders: WeeklyOrder[],
  sheetMaterials: SheetMaterial[],
  componentSheets: Array<ComponentSheetCandidate & { product_id: string }> = [],
  // Datas-limite de compra (ISO) por OP×material vindas da view
  // purchase_projection_timeline (cronograma reverso = entrega − setores − buffer −
  // lead do fornecedor). Quando presente, é a âncora de QUANDO comprar. Use buyByKey().
  buyByDates: Map<string, string> = new Map()
): WeeklyPlanResult {
  const weeklyDemands: Record<string, Record<string, number>> = {};

  // A5: ficha de componente por produto — fonte da LARGURA (conversão dm²→unidade física) e da perda.
  const csByProduct = new Map<string, ComponentSheetCandidate>();
  for (const cs of componentSheets) {
    if (cs && (cs as any).product_id) csByProduct.set((cs as any).product_id, cs);
  }

  const materialsBySheet = new Map<string, SheetMaterial[]>();
  for (const sm of sheetMaterials) {
    const arr = materialsBySheet.get(sm.sheet_id) || [];
    arr.push(sm);
    materialsBySheet.set(sm.sheet_id, arr);
  }

  // Achado A (auditoria 2026-07-01): a ficha pode listar VÁRIAS caixas no BOM
  // (colmeia + individual) como ALTERNATIVAS — o pedido escolhe UMA via
  // packaging_mode. Pré-varre os tipos de caixa presentes por ficha pra o
  // filtro (shouldShowCaixaForMode, o MESMO helper do modal de consumo) só
  // agir quando há alternativa real. Sem isso o plano somava as duas caixas.
  const caixaTypesBySheet = new Map<string, Set<CollectiveType>>();
  for (const sm of sheetMaterials) {
    const p = sm.products;
    if (!p) continue;
    if (classifyBomMaterial('', p.name || '', p.category || '') !== 'Embalagem') continue;
    const t = caixaCollectiveTypeFromName(p.name);
    if (!t) continue;
    let set = caixaTypesBySheet.get(sm.sheet_id);
    if (!set) { set = new Set(); caixaTypesBySheet.set(sm.sheet_id, set); }
    set.add(t);
  }

  const productMap = new Map<string, SheetMaterial['products']>();
  for (const sm of sheetMaterials) {
    if (sm.products && !productMap.has(sm.product_id)) {
      productMap.set(sm.product_id, sm.products);
    }
  }

  const today = startOfDay(new Date());

  for (const order of orders) {
    const prodDateStr = order.planned_start || order.planned_delivery || order.created_at;
    const fallbackProdDate = prodDateStr ? parseISO(prodDateStr) : null;

    const materials = materialsBySheet.get(order.reference_id) || [];
    for (const mat of materials) {
      if (!mat.products || mat.products.is_artisanal) continue;

      // Achado A: caixa de embalagem que NÃO é a do packaging_mode do pedido
      // é alternativa não usada — pula (só quando há ≥2 tipos na mesma ficha).
      if (
        order.packaging_mode &&
        classifyBomMaterial('', mat.products.name || '', mat.products.category || '') === 'Embalagem' &&
        !shouldShowCaixaForMode(
          mat.products.name,
          order.packaging_mode,
          caixaTypesBySheet.get(order.reference_id) || new Set<CollectiveType>(),
        )
      ) continue;

      // A5: a perda + a largura vêm da ficha de COMPONENTE do produto (não da reference_id).
      const cs = csByProduct.get(mat.product_id) || null;
      const requiredAmount = calculateRequiredAmount(mat, order, cs);
      if (requiredAmount <= 0) continue;

      // QUANDO comprar (just-in-time) — chegar pouco antes da produção, sem ficar parado:
      //   1ª escolha: data-limite reverse-scheduled da view purchase_projection_timeline
      //     (entrega cliente − cronograma de setores em paralelo − buffer material − lead
      //      time do fornecedor). Robusta: ancora no delivery_deadline do PV.
      //   Fallback: data de produção da OP (planned_start, só ~49% preenchido) − lead time
      //     do material. Antes a demanda caía na semana da PRODUÇÃO (comprava tarde) ou em
      //     created_at (passado) quando planned_start faltava — timing furado em ~metade.
      const vkey = buyByKey(order.id, mat.product_id);
      let buyDate: Date | null = buyByDates.has(vkey) ? parseISO(buyByDates.get(vkey)!) : null;
      if (!buyDate && fallbackProdDate) {
        const leadDays = mat.products.supplier_lead_time_days ?? mat.products.lead_time_days ?? 0;
        buyDate = leadDays > 0 ? addDays(fallbackProdDate, -leadDays) : fallbackProdDate;
      }
      if (!buyDate) continue;

      // Compra já vencida (data no passado) → próxima terça acionável: comprar agora.
      const effectiveBuyDate = isBefore(buyDate, today) ? today : buyDate;
      const targetTuesday = isTuesday(effectiveBuyDate) ? effectiveBuyDate : nextTuesday(effectiveBuyDate);
      const weekKey = format(targetTuesday, 'dd/MM/yyyy');

      if (!weeklyDemands[weekKey]) weeklyDemands[weekKey] = {};
      if (!weeklyDemands[weekKey][mat.product_id]) {
        weeklyDemands[weekKey][mat.product_id] = 0;
      }
      weeklyDemands[weekKey][mat.product_id] += requiredAmount;
    }
  }

  const sortedWeeks = Object.keys(weeklyDemands).sort((a, b) => {
    const [d1, m1, y1] = a.split('/');
    const [d2, m2, y2] = b.split('/');
    return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
  });

  const planMap = new Map<string, MaterialPlanRow>();

  productMap.forEach((prod, id) => {
    planMap.set(id, {
      materialId: id,
      name: prod!.name,
      sku: prod!.sku || '',
      unit: prod!.unit || 'un',
      unitPrice: prod!.unit_price || 0,
      currentStock: prod!.quantity || 0,
      minStock: prod!.min_stock || 0,
      // Estoque virtual inicial = bruto − mínimo − segurança (estoque LIVRE real).
      // NÃO subtrai reserved_stock de propósito: o plano é orientado por DEMANDA das
      // OPs ativas (Reservado + Em Produção), e reserved_stock representa justamente o
      // material já reservado por ESSAS MESMAS OPs. Subtrair os dois = dupla-contagem
      // (descontava o material da disponibilidade E recontava como demanda da OP),
      // inflando a compra. A depleção pela demanda das OPs é o único redutor.
      // (Auditoria 2026-06-06: overlap real era 1 produto, mas vira dupla-compra real
      // assim que as reservas voltam a sincronizar com as OPs ativas.)
      virtualStock: Math.max(0, (prod!.quantity || 0) - (prod!.min_stock || 0) - (prod!.safety_stock || 0)),
      weeklyPurchases: {},
      totalToBuy: 0,
      estimatedCost: 0,
    });
  });

  for (const week of sortedWeeks) {
    for (const [materialId, demand] of Object.entries(weeklyDemands[week])) {
      const row = planMap.get(materialId);
      if (!row) continue;

      const available = row.virtualStock;
      if (available >= demand) {
        row.virtualStock -= demand;
        row.weeklyPurchases[week] = 0;
      } else {
        const toBuy = demand - available;
        row.weeklyPurchases[week] = toBuy;
        row.virtualStock = 0;
        row.totalToBuy += toBuy;
        row.estimatedCost += toBuy * row.unitPrice;
      }
    }
  }

  const plan = Array.from(planMap.values()).filter(
    (r) => r.totalToBuy > 0 || Object.values(r.weeklyPurchases).some((v) => v > 0)
  );

  plan.sort((a, b) => b.totalToBuy - a.totalToBuy);

  return { sortedWeeks, plan };
}
