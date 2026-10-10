/**
 * Fila de Corte — look-ahead (specs/fila-corte-lookahead.md + sequencia-producao.md).
 * Candidatos = itens de PV Aprovado/Em Produção sem OP viva, com o setor da aba
 * no roteiro. Cabedal complexo só liberável após received_at_factory.
 * Ordem = sequência oficial (fechar PV → urgência → cor → ref).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  CORTE_LOOKAHEAD_SECTORS,
  corteLookaheadScore,
  freeQtyExcludingOtherOrders,
  pickProductForColor,
  pvCompletionPct,
  rankCorteLookaheadRows,
  remainingBillableValue,
  resolveCorteMaterialPins,
  resolveGroupIdByMaterialName,
  corteRequiredStockQty,
  sheetHasCorteSector,
  type CorteLookaheadChip,
  type CorteLookaheadSector,
} from '@/lib/corteLookahead';
import { isAtelierFactoryReady } from '@/lib/production/productionSequence';

export { CORTE_LOOKAHEAD_SECTORS };
export type { CorteLookaheadSector };

export const corteLookaheadKeys = {
  all: ['corte-lookahead'] as const,
  sector: (sector: string) => [...corteLookaheadKeys.all, sector] as const,
};

export interface CorteLookaheadRow {
  itemId: string;
  saleOrderId: string;
  orderNumber: string;
  clientName: string;
  referenceName: string;
  referenceCode: string | null;
  color: string | null;
  quantity: number;
  deliveryDeadline: string | null;
  liberable: boolean;
  chips: CorteLookaheadChip[];
  score: number;
  completionPct: number;
  productName: string | null;
  freeQty: number;
  requiredQty: number;
  createdAt: string;
}

interface SaleOrderLite {
  id: string;
  order_number: string;
  client_name: string;
  delivery_deadline: string | null;
  total: number;
  status: string;
  created_at: string;
}

interface SaleOrderItemLite {
  id: string;
  sale_order_id: string;
  reference_id: string | null;
  color: string | null;
  quantity: number;
  material_variant_id: string | null;
  created_at: string;
}

interface SheetLite {
  id: string;
  name: string;
  code: string | null;
  production_sectors: unknown;
  image_url: string | null;
  upper_consumption: number | null;
  upper_material: string | null;
  upper_material_product_id: string | null;
  upper_material_group_id: string | null;
  lining_consumption: number | null;
  lining_material: string | null;
  lining_material_product_id: string | null;
  lining_material_group_id?: string | null;
  insole_consumption: number | null;
  insole_material: string | null;
  insole_plate_product: string | null;
  insole_material_product_id?: string | null;
  insole_material_group_id?: string | null;
}

interface VariantLite {
  id: string;
  upper_material_product_id: string | null;
  upper_material_group_id: string | null;
  lining_material_product_id: string | null;
  lining_material_group_id: string | null;
  insole_material_product_id: string | null;
  insole_material_group_id: string | null;
}

interface ProductLite {
  id: string;
  name: string | null;
  group_id: string | null;
  color: string | null;
  active: boolean | null;
  quantity: number | null;
  unit: string | null;
}

const LIVE_OP_EXCLUDED = new Set(['Cancelada', 'Cancelado', 'Rascunho']);

const SHEET_SELECT = [
  'id',
  'name',
  'code',
  'production_sectors',
  'image_url',
  'upper_consumption',
  'upper_material',
  'upper_material_product_id',
  'upper_material_group_id',
  'lining_consumption',
  'lining_material',
  'lining_material_product_id',
  'insole_consumption',
  'insole_material',
  'insole_plate_product',
].join(', ');

async function fetchInChunks<T>(
  ids: string[],
  chunkSize: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await run(chunk);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

function consumptionForSector(sector: CorteLookaheadSector, sheet: SheetLite): number | null {
  switch (sector) {
    case 'Corte Cabedal':
      return sheet.upper_consumption;
    case 'Corte Forração':
      return sheet.lining_consumption;
    case 'Corte Palmilha':
      return sheet.insole_consumption;
    case 'Corte Fibra':
      return 0;
  }
}

function materialNameForSector(sector: CorteLookaheadSector, sheet: SheetLite): string | null {
  switch (sector) {
    case 'Corte Cabedal':
      return sheet.upper_material;
    case 'Corte Forração':
      return sheet.lining_material;
    case 'Corte Palmilha':
      return sheet.insole_material;
    case 'Corte Fibra':
      return null;
  }
}

async function loadCorteLookahead(sector: CorteLookaheadSector): Promise<CorteLookaheadRow[]> {
  const { data: saleOrdersRaw, error: soErr } = await supabase
    .from('sale_orders')
    .select('id, order_number, client_name, delivery_deadline, total, status, created_at')
    .in('status', ['Aprovado', 'Em Produção'])
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(2000);
  if (soErr) throw soErr;
  const saleOrders = (saleOrdersRaw ?? []) as SaleOrderLite[];
  if (saleOrders.length === 0) return [];

  const soById = new Map(saleOrders.map((s) => [s.id, s]));
  const soIds = saleOrders.map((s) => s.id);

  const items = await fetchInChunks<SaleOrderItemLite>(soIds, 200, (chunk) =>
    supabase
      .from('sale_order_items')
      .select('id, sale_order_id, reference_id, color, quantity, material_variant_id, created_at')
      .in('sale_order_id', chunk)
      .order('created_at', { ascending: true }),
  );
  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);
  const liveOps = await fetchInChunks<{ id: string; sale_order_item_id: string | null; status: string | null }>(
    itemIds,
    200,
    (chunk) =>
      supabase
        .from('orders')
        .select('id, sale_order_item_id, status')
        .in('sale_order_item_id', chunk)
        .is('deleted_at', null),
  );
  const itemsWithLiveOp = new Set(
    liveOps
      .filter((o) => o.sale_order_item_id && !LIVE_OP_EXCLUDED.has(String(o.status || '')))
      .map((o) => o.sale_order_item_id as string),
  );

  // Só refs com setor de rua que a ficha sustenta (mesma regra do gate no banco).
  const { data: atelierRaw, error: atelierErr } = await supabase.rpc(
    'list_atelier_gated_reference_ids' as never,
  );
  if (atelierErr) throw atelierErr;
  const atelierRefs = new Set(
    ((atelierRaw ?? []) as unknown as (string | { list_atelier_gated_reference_ids: string })[])
      .map((r) => (typeof r === 'string' ? r : r?.list_atelier_gated_reference_ids))
      .filter(Boolean) as string[],
  );

  // Pares do PV inteiro (todos os itens) — score / % completo.
  const pairsTotalBySo = new Map<string, number>();
  const pairsWithOpBySo = new Map<string, number>();
  for (const item of items) {
    const qty = Math.max(0, Number(item.quantity) || 0);
    pairsTotalBySo.set(item.sale_order_id, (pairsTotalBySo.get(item.sale_order_id) || 0) + qty);
    if (itemsWithLiveOp.has(item.id)) {
      pairsWithOpBySo.set(item.sale_order_id, (pairsWithOpBySo.get(item.sale_order_id) || 0) + qty);
    }
  }

  // Inclui refs do Ateliê — porta received_at_factory decide liberável (sequencia-producao).
  const candidates = items.filter(
    (item) => !itemsWithLiveOp.has(item.id) && item.reference_id,
  );
  if (candidates.length === 0) return [];

  const candidateItemIds = candidates.map((c) => c.id);
  const prepJobs = await fetchInChunks<{
    sale_order_item_id: string | null;
    pipeline_status: string | null;
    updated_at: string | null;
  }>(candidateItemIds, 200, (chunk) =>
    supabase
      .from('cabedal_prep_jobs' as never)
      .select('sale_order_item_id, pipeline_status, updated_at')
      .in('sale_order_item_id', chunk)
      .neq('pipeline_status', 'cancelled'),
  );
  const prepStatusByItem = new Map<string, { status: string; updatedAt: string }>();
  for (const job of prepJobs) {
    if (!job.sale_order_item_id) continue;
    const updatedAt = job.updated_at || '';
    const prev = prepStatusByItem.get(job.sale_order_item_id);
    if (!prev || updatedAt > prev.updatedAt) {
      prepStatusByItem.set(job.sale_order_item_id, {
        status: String(job.pipeline_status || ''),
        updatedAt,
      });
    }
  }

  const refIds = [...new Set(candidates.map((c) => c.reference_id!).filter(Boolean))];
  const sheets = await fetchInChunks<SheetLite>(refIds, 150, async (chunk) => {
    const { data, error } = await supabase
      .from('technical_sheets')
      .select(SHEET_SELECT)
      .in('id', chunk);
    return { data: (data as unknown as SheetLite[] | null), error };
  });
  const sheetById = new Map(sheets.map((s) => [s.id, s]));

  const sectorCandidates = candidates.filter((item) => {
    const sheet = sheetById.get(item.reference_id!);
    if (!sheet) return false;
    return sheetHasCorteSector(sheet.production_sectors, sector);
  });
  if (sectorCandidates.length === 0) return [];

  const variantIds = [
    ...new Set(sectorCandidates.map((c) => c.material_variant_id).filter((id): id is string => !!id)),
  ];
  const variants = variantIds.length
    ? await fetchInChunks<VariantLite>(variantIds, 150, (chunk) =>
        supabase
          .from('reference_material_variants')
          .select(
            'id, upper_material_product_id, upper_material_group_id, lining_material_product_id, lining_material_group_id, insole_material_product_id, insole_material_group_id',
          )
          .in('id', chunk),
      )
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const { data: groupsRaw, error: groupsErr } = await supabase
    .from('product_groups')
    .select('id, name')
    .limit(4000);
  if (groupsErr) throw groupsErr;
  const groups = (groupsRaw ?? []) as Array<{ id: string; name: string | null }>;

  const groupIds = new Set<string>();
  const productPinIds = new Set<string>();
  for (const item of sectorCandidates) {
    const sheet = sheetById.get(item.reference_id!)!;
    const variant = item.material_variant_id ? variantById.get(item.material_variant_id) : null;
    const pins = resolveCorteMaterialPins({ sector, sheet, variant: variant ?? null });
    const groupId = pins.groupId
      || resolveGroupIdByMaterialName(materialNameForSector(sector, sheet), groups);
    if (groupId) groupIds.add(groupId);
    if (pins.productId) productPinIds.add(pins.productId);
  }

  const PRODUCT_SELECT = 'id, name, group_id, color, active, quantity, unit';
  const products: ProductLite[] = [];
  if (groupIds.size > 0) {
    const byGroup = await fetchInChunks<ProductLite>([...groupIds], 80, (chunk) =>
      supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .in('group_id', chunk),
    );
    products.push(...byGroup);
  }
  const knownProductIds = new Set(products.map((p) => p.id));
  const missingPins = [...productPinIds].filter((id) => !knownProductIds.has(id));
  if (missingPins.length > 0) {
    const pinned = await fetchInChunks<ProductLite>(missingPins, 150, (chunk) =>
      supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .in('id', chunk),
    );
    products.push(...pinned);
  }

  type CsLite = {
    product_id: string | null;
    group_id: string | null;
    dimensions_width: number | null;
    dimensions_length: number | null;
    dimensions_unit: string | null;
  };
  const csProductIds = [...new Set(products.map((p) => p.id))];
  const csGroupIds = [...new Set(products.map((p) => p.group_id).filter((id): id is string => !!id))];
  const componentSheets: CsLite[] = [];
  if (csProductIds.length > 0) {
    const byPid = await fetchInChunks<CsLite>(csProductIds, 80, (chunk) =>
      supabase
        .from('component_sheets')
        .select('product_id, group_id, dimensions_width, dimensions_length, dimensions_unit')
        .in('product_id', chunk),
    );
    componentSheets.push(...byPid);
  }
  if (csGroupIds.length > 0) {
    const byGid = await fetchInChunks<CsLite>(csGroupIds, 80, (chunk) =>
      supabase
        .from('component_sheets')
        .select('product_id, group_id, dimensions_width, dimensions_length, dimensions_unit')
        .in('group_id', chunk),
    );
    componentSheets.push(...byGid);
  }

  const productIds = [...new Set(products.map((p) => p.id))];
  type ResRow = {
    product_id: string;
    quantity_reserved: number;
    quantity_consumed: number;
    status: string;
    orders: { sale_order_id: string | null } | { sale_order_id: string | null }[] | null;
  };
  const reservationRows = productIds.length
    ? await fetchInChunks<ResRow>(productIds, 100, async (chunk) => {
        // Join orders(sale_order_id) estoura a profundidade do tipagem gerada.
        const { data, error } = await supabase
          .from('material_reservations')
          .select('product_id, quantity_reserved, quantity_consumed, status, orders(sale_order_id)' as never)
          .in('product_id', chunk)
          .in('status', ['reserved', 'pending_reconciliation']);
        return { data: (data as unknown as ResRow[] | null), error };
      })
    : [];

  const reservations = reservationRows.map((r) => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return {
      productId: r.product_id,
      saleOrderId: ord?.sale_order_id ?? null,
      quantityReserved: Number(r.quantity_reserved) || 0,
      quantityConsumed: Number(r.quantity_consumed) || 0,
      status: r.status,
    };
  });

  const today = new Date();
  type RowMeta = {
    saleOrderId: string;
    orderNumber: string;
    clientName: string;
    referenceName: string;
    referenceCode: string | null;
    color: string | null;
    quantity: number;
    deliveryDeadline: string | null;
    productName: string | null;
    freeQty: number;
    requiredQty: number;
  };
  const metaById = new Map<string, RowMeta>();
  const deadlineByItemId: Record<string, string | null | undefined> = {};
  const rankInputs = sectorCandidates.map((item) => {
    const so = soById.get(item.sale_order_id)!;
    const sheet = sheetById.get(item.reference_id!)!;
    const variant = item.material_variant_id ? variantById.get(item.material_variant_id) : null;
    const pins = resolveCorteMaterialPins({ sector, sheet, variant: variant ?? null });
    const groupId = pins.groupId
      || resolveGroupIdByMaterialName(materialNameForSector(sector, sheet), groups);
    const product = pickProductForColor({
      products,
      productId: pins.productId,
      groupId,
      color: item.color,
    });

    const cs = product
      ? (componentSheets.find((s) => s.product_id === product.id)
        || (product.group_id
          ? componentSheets.find((s) => s.group_id === product.group_id
            && (Number(s.dimensions_width) > 0 || Number(s.dimensions_length) > 0))
          : null)
        || null)
      : null;
    const need = sector === 'Corte Fibra'
      ? { qty: product ? 0.01 : 0, incomplete: null as 'largura' | null }
      : corteRequiredStockQty({
          consumptionPerPair: consumptionForSector(sector, sheet),
          pairs: item.quantity,
          hasProduct: !!product,
          productUnit: product?.unit,
          componentSheet: cs,
        });
    const requiredQty = need.qty;
    const freeQty = product
      ? freeQtyExcludingOtherOrders({
          quantity: product.quantity,
          reservations,
          productId: product.id,
          ownSaleOrderId: item.sale_order_id,
        })
      : 0;

    const pairsTotal = pairsTotalBySo.get(item.sale_order_id) || 0;
    const pairsWithOp = pairsWithOpBySo.get(item.sale_order_id) || 0;
    const pairsWithoutOp = Math.max(0, pairsTotal - pairsWithOp);
    const remaining = remainingBillableValue({
      saleOrderTotal: Number(so.total) || 0,
      pairsWithoutOp,
      pairsTotalOnPv: pairsTotal,
    });
    const score = corteLookaheadScore({
      remainingBillableValue: remaining,
      deliveryDeadline: so.delivery_deadline,
      today,
    });
    const completionPct = pvCompletionPct({ pairsWithOp, pairsTotalOnPv: pairsTotal });

    let gapLabel: string | null = null;
    if (need.incomplete === 'largura') {
      gapLabel = 'Cadastro incompleto: largura da bobina';
    }
    if (sector === 'Corte Fibra' && !product) {
      gapLabel = 'Cadastro incompleto: material do setor';
    }

    const isComplex = atelierRefs.has(item.reference_id!);
    const atelierGate = isAtelierFactoryReady({
      isComplexReference: isComplex,
      pipelineStatus: prepStatusByItem.get(item.id)?.status ?? null,
    });
    let liberableBase = true;
    if (need.incomplete === 'largura') {
      liberableBase = false;
    }
    if (!atelierGate.ready) {
      liberableBase = false;
      gapLabel = atelierGate.blockReason || gapLabel;
    }

    metaById.set(item.id, {
      saleOrderId: so.id,
      orderNumber: so.order_number,
      clientName: so.client_name,
      referenceName: sheet.name,
      referenceCode: sheet.code,
      color: item.color,
      quantity: Math.max(0, Number(item.quantity) || 0),
      deliveryDeadline: so.delivery_deadline,
      productName: product?.name ?? null,
      freeQty,
      requiredQty,
    });
    deadlineByItemId[item.id] = so.delivery_deadline;

    return {
      itemId: item.id,
      createdAt: item.created_at || so.created_at,
      liberableBase,
      stock: {
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        freeQty,
        requiredQty,
      },
      score,
      completionPct,
      color: item.color,
      reference: sheet.code || sheet.name,
      dueDate: so.delivery_deadline,
      gapLabel,
    };
  });

  const ranked = rankCorteLookaheadRows(rankInputs, { deadlineByItemId, today });

  return ranked.map((r) => {
    const meta = metaById.get(r.itemId)!;
    return {
      itemId: r.itemId,
      saleOrderId: meta.saleOrderId,
      orderNumber: meta.orderNumber,
      clientName: meta.clientName,
      referenceName: meta.referenceName,
      referenceCode: meta.referenceCode,
      color: meta.color,
      quantity: meta.quantity,
      deliveryDeadline: meta.deliveryDeadline,
      liberable: r.liberable,
      chips: r.chips,
      score: r.score,
      completionPct: r.completionPct,
      productName: meta.productName,
      freeQty: meta.freeQty,
      requiredQty: meta.requiredQty,
      createdAt: r.createdAt,
    };
  });
}

export function useCorteLookahead(sector: CorteLookaheadSector) {
  return useQuery({
    queryKey: corteLookaheadKeys.sector(sector),
    queryFn: () => loadCorteLookahead(sector),
    staleTime: 30_000,
  });
}

export function useReleaseCorteLookahead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemIds: string[]) => {
      const { data, error } = await supabase.rpc(
        'release_corte_lookahead_items' as never,
        { p_item_ids: itemIds } as never,
      );
      if (error) throw error;
      const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      return {
        created: Number(raw.created) || 0,
        skipped: raw.skipped,
      };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['production_queue_detail'] });
      void qc.invalidateQueries({ queryKey: corteLookaheadKeys.all });
      const n = Number(data?.created) || 0;
      toast.success(
        n === 1
          ? '1 OP adiantada liberada na fila de Corte.'
          : `${n} OPs adiantadas liberadas na fila de Corte.`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Falha ao liberar adiantamento');
    },
  });
}
