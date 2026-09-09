import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  executePurchaseOrderCommand,
  purchaseOrderLogicalKey,
} from '@/services/purchaseOrderCommandService';

export type PurchaseOrder = {
  id: string;
  order_number: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  total_value: number;
  freight_value?: number;
  freight_type?: string | null;
  payment_terms?: string | null;
  quotation_award_snapshot_id?: string | null;
  notes: string;
  auto_generated: boolean;
  promised_date: string | null;
  /** Comprar até: backward do faturamento (− lead produção − buffer − lead fornecedor). ≠ promised_date (ETA). */
  purchase_by_date: string | null;
  received_date: string | null;
  created_at: string;
  updated_at: string;
  /** PVs que contribuíram com itens pra esta OC (agregada — canal MRP/auto-PO). */
  linked_sale_order_ids?: string[] | null;
  /** Canal de origem: 'manual' | 'mrp' | 'per_pv' (migration 20260808120000). */
  source_type?: string | null;
  /** PVs que originaram a OC quando source_type='per_pv'. */
  source_pv_ids?: string[] | null;
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  box_type_id?: string | null;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  suggested_quantity: number;
  quantity: number;
  unit_price: number;
  unit: string;
  created_at: string;
  grade?: Record<string, number> | null;
  color?: string | null;
  /** Timestamp do crédito de estoque deste item (M6 — idempotência por item no
   *  retry de recebimento). NULL = ainda não creditado por completo. */
  received_at?: string | null;
  /** Quantidade já recebida (acumulada), na mesma unidade de `quantity`. Suporta
   *  recebimento parcial ("receber 8 de 10"). Fase C. */
  received_quantity?: number | null;
  product?: { name: string; sku: string; category: string; color?: string | null; stock_grade?: Record<string, any> | null };
};

export interface PurchaseOrderStockItemInput {
  product_id?: string | null;
  box_type_id?: string | null;
  quantity: number;
  unit_price: number;
  unit: string;
  current_stock?: number;
  min_stock?: number;
  max_stock?: number;
  grade?: Record<string, number> | null;
  color?: string | null;
}

function assertPurchaseOrderItem(item: PurchaseOrderStockItemInput): void {
  if (Boolean(item.product_id) === Boolean(item.box_type_id)) {
    throw new Error('Cada item da OC deve informar exatamente um produto ou uma embalagem.');
  }
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new Error('Quantidade inválida em item da OC.');
  }
  if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
    throw new Error('Preço unitário inválido em item da OC.');
  }
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase_orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PurchaseOrder[];
    },
  });
}

export function usePurchaseOrderItems(orderId: string | null) {
  return useQuery({
    queryKey: ['purchase_order_items', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('*, products(id, name, sku, category, color, stock_grade), box_types(id, nome, tipo, quantity, min_stock, unit_price, active)')
        .eq('purchase_order_id', orderId!);
      if (error) throw error;
      return (data || []).map((item: any) => ({
        ...item,
        product: item.products || (item.box_types ? {
          name: item.box_types.nome,
          sku: '',
          category: 'Embalagem',
          color: null,
          stock_grade: null,
        } : { name: '?', sku: '?', category: '?', color: null }),
        products: undefined,
        box_types: undefined,
      })) as PurchaseOrderItem[];
    },
  });
}

/** Tipo de conteúdo da OC, derivado das categorias dos itens. */
export type POContentType = 'solado' | 'material' | 'palmilha' | 'embalagem' | 'misto' | 'vazio';

/** Resumo dos itens de UMA OC, pra surfar especificidade na lista sem abrir o modal. */
export type PurchaseOrderItemSummary = {
  itemCount: number;
  items: Array<{
    productId: string;
    name: string;
    sku: string;
    category: string;
    color: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
  }>;
  /** Índice textual normalizado usado pelos filtros da listagem. */
  searchText: string;
  /** Nome do item representativo (solado quando houver, senão o primeiro). */
  label: string;
  color: string | null;
  contentType: POContentType;
  /** Detalhe do solado (quando a OC tem ao menos 1 item de solado). */
  sole: {
    model: string;
    color: string | null;
    /** Faixa de numeração quando a grade está distribuída (ex.: 34–40). */
    sizeFrom: number | null;
    sizeTo: number | null;
    totalPares: number;
    hasGrade: boolean;
  } | null;
};

const isSoleCategory = (c?: string | null) => (c || '').toLowerCase().includes('solado');
const isPalmilhaCategory = (c?: string | null) => (c || '').toLowerCase().includes('palmilha');

/** Min/máx numérico das chaves da grade (suporta conjugadas "33/34"). */
function gradeSizeRange(grade?: Record<string, number> | null): { from: number | null; to: number | null } {
  const nums: number[] = [];
  for (const k of Object.keys(grade || {})) {
    if (k.startsWith('_')) continue;
    if (!(Number(grade![k]) > 0)) continue;
    for (const part of k.split('/')) {
      const n = parseInt(part, 10);
      if (Number.isFinite(n)) nums.push(n);
    }
  }
  if (nums.length === 0) return { from: null, to: null };
  return { from: Math.min(...nums), to: Math.max(...nums) };
}

/**
 * Resumo de itens por OC (em lote). Gêmeo read-only de usePurchaseOrderItems,
 * mas pra N ordens de uma vez — alimenta a coluna "Itens" + badge de tipo +
 * resumo de solado na LISTA de OC, sem precisar abrir o detalhe de cada uma.
 */
export function usePurchaseOrderItemSummaries(orderIds: string[]) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  return useQuery({
    queryKey: ['purchase_order_item_summaries', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('purchase_order_id, product_id, box_type_id, quantity, unit, unit_price, color, grade, products(name, sku, category, color), box_types(nome, tipo)')
        .in('purchase_order_id', ids);
      if (error) throw error;

      const byOrder = new Map<string, any[]>();
      for (const row of (data || []) as any[]) {
        const arr = byOrder.get(row.purchase_order_id) || [];
        arr.push(row);
        byOrder.set(row.purchase_order_id, arr);
      }

      const summaries = new Map<string, PurchaseOrderItemSummary>();
      for (const [orderId, items] of byOrder) {
        const normalizedItems = items.map((item) => ({
          ...item,
          stockIdentityId: item.product_id || item.box_type_id,
          stockEntity: item.products || (item.box_types ? {
            name: item.box_types.nome,
            sku: '',
            category: 'Embalagem',
            color: null,
          } : null),
        }));
        const cats = new Set(normalizedItems.map(i => ((i.stockEntity?.category || '') as string).toLowerCase()).filter(Boolean));
        const hasSole = normalizedItems.some(i => isSoleCategory(i.stockEntity?.category));
        const allSole = normalizedItems.length > 0 && normalizedItems.every(i => isSoleCategory(i.stockEntity?.category));
        const allPalmilha = normalizedItems.length > 0 && normalizedItems.every(i => isPalmilhaCategory(i.stockEntity?.category));
        const allPackaging = normalizedItems.length > 0 && normalizedItems.every(i => i.box_type_id != null);

        let contentType: POContentType = 'vazio';
        if (items.length === 0) contentType = 'vazio';
        else if (allSole) contentType = 'solado';
        else if (allPackaging) contentType = 'embalagem';
        else if (hasSole) contentType = 'misto';
        else if (allPalmilha) contentType = 'palmilha';
        else if (cats.size > 1) contentType = 'misto';
        else contentType = 'material';

        // Item representativo: o solado quando houver, senão o primeiro.
        const soleItem = normalizedItems.find(i => isSoleCategory(i.stockEntity?.category)) || null;
        const repItem = soleItem || normalizedItems[0];
        const repName = repItem?.stockEntity?.name || 'Item';
        const repColor = repItem?.color || repItem?.stockEntity?.color || null;

        let sole: PurchaseOrderItemSummary['sole'] = null;
        if (soleItem) {
          const grade = soleItem.grade as Record<string, number> | null;
          const hasGrade = !!grade && Object.keys(grade).some(k => !k.startsWith('_') && Number(grade[k]) > 0);
          const { from, to } = gradeSizeRange(grade);
          const totalFromGrade = Object.entries(grade || {})
            .filter(([k]) => !k.startsWith('_'))
            .reduce((s, [, v]) => s + (Number(v) || 0), 0);
          sole = {
            model: soleItem.stockEntity?.name || 'Solado',
            color: soleItem.color || soleItem.stockEntity?.color || null,
            sizeFrom: from,
            sizeTo: to,
            totalPares: hasGrade ? totalFromGrade : (Number(soleItem.quantity) || 0),
            hasGrade,
          };
        }

        summaries.set(orderId, {
          itemCount: items.length,
          items: normalizedItems.map(i => ({
            productId: i.stockIdentityId,
            name: i.stockEntity?.name || 'Item',
            sku: i.stockEntity?.sku || '',
            category: i.stockEntity?.category || '',
            color: i.color || i.stockEntity?.color || null,
            quantity: Number(i.quantity) || 0,
            unit: i.unit || '',
            unitPrice: Number(i.unit_price) || 0,
          })),
          searchText: normalizedItems.map(i => [i.stockEntity?.name, i.stockEntity?.sku, i.stockEntity?.category, i.color, i.stockEntity?.color].filter(Boolean).join(' ')).join(' '),
          label: repName,
          color: repColor,
          contentType,
          sole,
        });
      }
      return summaries;
    },
  });
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PurchaseOrder> }) => {
      const { data: current, error } = await supabase
        .from('purchase_orders')
        .select('updated_at')
        .eq('id', id)
        .single();
      if (error) throw error;
      const headerPatch: Record<string, unknown> = {};
      for (const key of [
        'supplier_id', 'supplier_name', 'notes', 'status', 'promised_date',
        'received_date', 'purchase_by_date', 'eta_days', 'expedite',
      ] as const) {
        if (key in data) headerPatch[key] = data[key];
      }
      const command = data.status === 'cancelled' ? 'cancel' : 'update';
      await executePurchaseOrderCommand({
        command,
        purchaseOrderId: id,
        expectedUpdatedAt: current.updated_at,
        payload: command === 'cancel' ? {} : { header_patch: headerPatch },
        logicalKey: purchaseOrderLogicalKey(command, id, JSON.stringify(headerPatch)),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      // MRP depende de POs abertas (qty em trânsito) — invalida pra não mostrar
      // sugestão velha após mudar/cancelar OC.
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      toast.success('Ordem de compra atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePurchaseOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { quantity?: number; unit_price?: number; grade?: Record<string, number> | null } }) => {
      if (data.quantity !== undefined && (!Number.isFinite(data.quantity) || data.quantity <= 0)) {
        throw new Error('Quantidade inválida em item da OC.');
      }
      if (data.unit_price !== undefined && (!Number.isFinite(data.unit_price) || data.unit_price < 0)) {
        throw new Error('Preço unitário inválido em item da OC.');
      }
      const { data: item, error: itemFetchErr } = await supabase
        .from('purchase_order_items')
        .select('purchase_order_id')
        .eq('id', id)
        .single();
      if (itemFetchErr || !item) throw new Error('Item de OC não encontrado.');
      const { data: po, error: poFetchErr } = await supabase
        .from('purchase_orders')
        .select('status, updated_at')
        .eq('id', item.purchase_order_id)
        .single();
      if (poFetchErr) throw poFetchErr;
      if (po && ['received', 'receiving', 'cancelled'].includes(po.status)) {
        throw new Error('Não é possível editar itens de uma OC já recebida, em recebimento ou cancelada.');
      }
      await executePurchaseOrderCommand({
        command: 'edit',
        purchaseOrderId: item.purchase_order_id,
        expectedUpdatedAt: po.updated_at,
        payload: { items: [{ item_id: id, ...data }] },
        logicalKey: purchaseOrderLogicalKey('edit-item', id, JSON.stringify(data)),
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('Item atualizado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: current, error } = await supabase
        .from('purchase_orders')
        .select('updated_at')
        .eq('id', id)
        .single();
      if (error) throw error;
      await executePurchaseOrderCommand({
        command: 'cancel',
        purchaseOrderId: id,
        expectedUpdatedAt: current.updated_at,
        payload: {},
        logicalKey: purchaseOrderLogicalKey('cancel', id),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      toast.success('Ordem de compra cancelada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function purchaseOrderIdempotencyKey(data: {
  supplier_name: string;
  supplier_id?: string | null;
  items: PurchaseOrderStockItemInput[];
}): string {
  const itemsKey = data.items
    .map(i => `${i.product_id ? `product:${i.product_id}` : `box:${i.box_type_id}`}:${i.quantity}:${i.unit_price}:${i.unit}`)
    .sort()
    .join('|');
  return `${data.supplier_id || data.supplier_name}::${itemsKey}`;
}

/**
 * Cria OU agrega numa OC ABERTA do mesmo fornecedor (status<>received/receiving/cancelled).
 * Itens com mesmo product_id+color têm quantidades somadas; sale_order_id é
 * appendado em linked_sale_order_ids[]. Use isso quando a criação for
 * automática (a partir de PV com shortage) — evita criar 1 OC por PV.
 *
 * Pra criação manual livre (1 OC explícita por clique), use useCreatePurchaseOrder.
 */
export function useUpsertOpenPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      supplier_id: string;
      supplier_name: string;
      sale_order_id: string | null;
      notes?: string;
      items: PurchaseOrderStockItemInput[];
    }) => {
      if (!data.supplier_id) throw new Error('supplier_id é obrigatório pra agrupar OC.');
      for (const it of data.items) assertPurchaseOrderItem(it);
      const { data: open, error } = await supabase
        .from('purchase_orders')
        .select('id, source_type')
        .eq('supplier_id', data.supplier_id)
        .not('status', 'in', '(received,receiving,cancelled)')
        .not('source_type', 'in', '(per_pv,strap_demand)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const logicalKey = purchaseOrderLogicalKey(
        'upsert-open',
        data.supplier_id,
        data.sale_order_id,
        data.items.map((item) => `${item.product_id || item.box_type_id}:${item.quantity}:${item.unit}`).sort().join('|'),
      );
      if (open?.id) {
        const result = await executePurchaseOrderCommand({
          command: 'append',
          purchaseOrderId: open.id,
          payload: {
            header_patch: {
              ...(data.notes ? { notes_append: data.notes } : {}),
              linked_sale_order_ids_add: data.sale_order_id ? [data.sale_order_id] : [],
              source_pv_ids_add: data.sale_order_id ? [data.sale_order_id] : [],
            },
            items: data.items,
            deduplicate_sale_order_id: data.sale_order_id,
          },
          logicalKey,
        });
        return result.purchase_order_id;
      }
      const result = await executePurchaseOrderCommand({
        command: 'create',
        payload: {
          header: {
            supplier_id: data.supplier_id,
            supplier_name: data.supplier_name,
            notes: data.notes || '',
            auto_generated: true,
            source_type: 'auto_pv',
            linked_sale_order_ids: data.sale_order_id ? [data.sale_order_id] : [],
            source_pv_ids: data.sale_order_id ? [data.sale_order_id] : [],
            idempotency_key: data.sale_order_id
              ? `auto_pv:${data.supplier_id}:${data.sale_order_id}`
              : null,
          },
          items: data.items,
          return_existing_on_idempotency: Boolean(data.sale_order_id),
        },
        logicalKey,
      });
      return result.purchase_order_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      toast.success('OC atualizada/criada — pedido vinculado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { supplier_name: string; supplier_id?: string | null; notes?: string; items: PurchaseOrderStockItemInput[] }) => {
      for (const it of data.items) assertPurchaseOrderItem(it);
      const total = data.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      if (!Number.isFinite(total) || total > 1e12) throw new Error('Total da OC fora de limite.');

      const idemKey = purchaseOrderIdempotencyKey(data);
      const result = await executePurchaseOrderCommand({
        command: 'create',
        payload: {
          header: {
            supplier_name: data.supplier_name,
            supplier_id: data.supplier_id || null,
            notes: data.notes || '',
            source_type: 'manual',
            idempotency_key: idemKey,
          },
          items: data.items,
        },
        logicalKey: purchaseOrderLogicalKey('create-manual', idemKey),
      });
      return result.purchase_order as unknown as PurchaseOrder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      toast.success('Ordem de compra criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}


/**
 * Pagamento por OC, derivado de `accounts_payable`. A OC não carrega vencimento
 * nem status de pagamento na própria linha — o vínculo real é o token
 * `[OC#<id>]` em `accounts_payable.notes` (escrito por createAPEntries). Aqui
 * fazemos UMA query (todas as AP com esse token), extraímos o uuid da OC e
 * agregamos por OC. Usado pelo relatório de custos (pago/a pagar + vencimento).
 */
export interface PurchaseOrderPayment {
  /** Tem ao menos uma conta a pagar (não-cancelada) vinculada. */
  hasPayable: boolean;
  /** Todas as parcelas não-canceladas estão pagas. */
  isPaid: boolean;
  /** Vencimento de referência: menor due_date pendente, senão o menor geral. */
  dueDate: string | null;
}

const OC_TOKEN_RE = /\[OC#([0-9a-fA-F-]{36})\]/;

export function usePurchaseOrderPayments() {
  return useQuery({
    queryKey: ['purchase_order_payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('amount, due_date, status, notes')
        .ilike('notes', '%[OC#%');
      if (error) throw error;
      // Acumula por OC, ignorando parcelas canceladas.
      const acc = new Map<string, { all: string[]; paidCount: number; total: number; pendingDue: string[]; allDue: string[] }>();
      for (const ap of (data || []) as any[]) {
        const m = OC_TOKEN_RE.exec(ap.notes || '');
        if (!m) continue;
        const id = m[1];
        const status = String(ap.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'cancelado' || status === 'estornado') continue;
        let e = acc.get(id);
        if (!e) { e = { all: [], paidCount: 0, total: 0, pendingDue: [], allDue: [] }; acc.set(id, e); }
        e.total += 1;
        const isPaid = status === 'paid' || status === 'pago';
        if (isPaid) e.paidCount += 1;
        if (ap.due_date) {
          e.allDue.push(ap.due_date);
          if (!isPaid) e.pendingDue.push(ap.due_date);
        }
      }
      const map = new Map<string, PurchaseOrderPayment>();
      for (const [id, e] of acc) {
        const dueList = e.pendingDue.length > 0 ? e.pendingDue : e.allDue;
        const dueDate = dueList.length > 0 ? dueList.slice().sort()[0] : null;
        map.set(id, {
          hasPayable: e.total > 0,
          isPaid: e.total > 0 && e.paidCount === e.total,
          dueDate,
        });
      }
      return map;
    },
    staleTime: 30_000,
  });
}

/** Resolve uuids → PV numbers ("PV-00001") em batch — usado em badges de OC/OS. */
export function useSaleOrderNumbersByIds(ids: string[] | null | undefined) {
  return useQuery({
    queryKey: ['sale_order_numbers_by_ids', (ids || []).slice().sort().join(',')],
    enabled: !!ids && ids.length > 0,
    queryFn: async () => {
      if (!ids || ids.length === 0) return [] as { id: string; order_number: string }[];
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number')
        .in('id', ids);
      if (error) throw error;
      return (data || []) as { id: string; order_number: string }[];
    },
    staleTime: 60_000,
  });
}

export function useCapacityDrivenLeadTimes() {
   return useQuery({
     queryKey: ['capacity_driven_lead_times'],
     queryFn: async () => {
       const { data, error } = await supabase
         .from('v_capacity_driven_lead_times' as any)
         .select('*');
       if (error) throw error;
       return (data || []) as any[];
     },
   });
 }
