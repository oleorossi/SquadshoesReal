import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { autoCreateSolePO } from '@/lib/soleAutoPO';
import { autoCreateMaterialPO } from '@/lib/materialAutoPO';
import { calculateFactoringDiscount } from '@/lib/factoringCalc';
import { isValidStatusTransition } from '@/lib/saleOrderStateMachine';

const DEFAULT_OP_STAGES = [
  { name: 'Corte Palmilha', order: 1 },
  { name: 'Corte Forração', order: 2 },
  { name: 'Mesa', order: 3 },
  { name: 'Silk', order: 4 },
  { name: 'Colagem', order: 5 },
  { name: 'Montagem', order: 6 },
  { name: 'Solagem', order: 7 },
  { name: 'Acabamento', order: 8 },
  { name: 'Expedição', order: 9 },
];

/**
 * Parse ISO billing-week string ('2026-W16') to the Monday date of that week.
 * Returns null if the format is unrecognised.
 */
function isoWeeksInYear(year: number): number {
  // ISO 8601: a year has 53 weeks if Dec 31 (or Jan 1) falls on Thursday
  const dec31 = new Date(Date.UTC(year, 11, 31));
  return (dec31.getUTCDay() + 6) % 7 >= 3 ? 53 : 52;
}

function parseBillingWeekToMonday(billingWeek: string): Date | null {
  const m = billingWeek.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const year = +m[1];
  const week = +m[2];
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  // ISO 8601: Jan 4 is always in week 1; isodow 1=Mon … 7=Sun
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isodow = (jan4.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - isodow);
  const result = new Date(week1Mon);
  result.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return result;
}


/**
 * Sync accounts_receivable when a sale order changes status, value, or quantity.
 * - Faturado: creates receivable if none exists, updates if already exists
 *   - With factoring: amount = PV discounted by compound interest based on payment_condition days
 *     from the delivery week end date; due_date = today + factoring receiving_days
 * - Cancelado: cancels linked receivables
 * - Value/qty changes: updates linked receivable amounts
 */
async function syncFinancialRecords(saleOrderId: string) {
  const must = (op: string, err: any) => { if (err) throw new Error(`${op}: ${err.message}`); };

  const { data: so, error: soErr } = await supabase
    .from('sale_orders')
    .select('*')
    .eq('id', saleOrderId)
    .single();
  if (soErr) throw new Error(`Falha ao carregar PV ${saleOrderId}: ${soErr.message}`);
  if (!so) return;

  // Fetch existing receivables linked to this sale order
  const { data: existingAR, error: arErr } = await supabase
    .from('accounts_receivable')
    .select('id, amount, status')
    .eq('sale_order_id', saleOrderId);
  must('Buscar contas a receber existentes', arErr);

  const total = Number(so.total) || 0;

  if (so.status === 'Cancelado') {
    if (existingAR && existingAR.length > 0) {
      const idsToCancel = existingAR.filter(ar => ar.status !== 'cancelled').map(ar => ar.id);
      if (idsToCancel.length > 0) {
        // .neq('status','received') prevents overwriting a concurrently-received
        // AR row — that income is real and must not be cancelled.
        const { error } = await supabase.from('accounts_receivable')
          .update({ status: 'cancelled' })
          .in('id', idsToCancel)
          .neq('status', 'received');
        must('Cancelar contas a receber', error);
      }
    }
    // Remove only unposted/draft revenue entries — confirmed/posted rows are the
    // SPED audit trail and must not be deleted (same guard as useDeleteSaleOrder).
    // A different code path (cancel-nfe) is responsible for clearing confirmed entries
    // through the proper fiscal cancellation workflow.
    const { error: delErr } = await supabase
      .from('financial_entries')
      .delete()
      .eq('reference_id', saleOrderId)
      .eq('reference_type', 'sale_order')
      .not('status', 'in', '(posted,paid,reconciled,confirmed)');
    must('Remover financial_entries de PV cancelado', delErr);
    return;
  }

  if (so.status === 'Faturado') {
    let dueDate = so.delivery_deadline || new Date().toISOString().split('T')[0];

    // If factoring is enabled, calculate discounted amount and due date
    let factoringDiscountedTotal = total;
    if (so.is_factoring && so.factoring_config_id) {
      const { data: factoringConfig } = await supabase
        .from('factoring_config')
        .select('receiving_days, monthly_interest_rate')
        .eq('id', so.factoring_config_id)
        .single();
      if (factoringConfig) {
        const factoringDate = new Date();
        factoringDate.setDate(factoringDate.getDate() + factoringConfig.receiving_days);
        dueDate = factoringDate.toISOString().split('T')[0];

        const { pv } = calculateFactoringDiscount({
          total,
          monthlyInterestRate: factoringConfig.monthly_interest_rate,
          paymentCondition: so.payment_condition,
          deliveryMonth: so.delivery_month,
          deliveryWeek: so.delivery_week,
          fallbackReceivingDays: factoringConfig.receiving_days,
        });
        factoringDiscountedTotal = pv;
      }
    }

    const arAmount = so.is_factoring ? factoringDiscountedTotal : total;
    const factoringDiscount = so.is_factoring ? (total - factoringDiscountedTotal) : 0;

    if (arAmount <= 0) {
      console.warn(`syncFinancialRecords: Faturado PV ${saleOrderId} has arAmount=${arAmount} — cancelling any existing AR to avoid ghost revenue.`);
      if (existingAR && existingAR.length > 0) {
        const idsToCancel = existingAR.filter((ar: any) => ar.status !== 'cancelled').map((ar: any) => ar.id);
        if (idsToCancel.length > 0) {
          await supabase.from('accounts_receivable').update({ status: 'cancelled' }).in('id', idsToCancel).neq('status', 'received');
        }
      }
      return;
    }

    // Only consider non-cancelled AR as "active". When a PV went Cancelado then
    // back to Faturado, all prior rows are cancelled — treat that as "no AR" so
    // a fresh row is inserted rather than silently skipping the update loop.
    const activeAR = existingAR ? existingAR.filter((ar: any) => ar.status !== 'cancelled') : [];

    if (activeAR.length > 0) {
      // Update existing receivable with current total
      for (const ar of activeAR) {
        if (ar.status !== 'received') {
          const { error } = await supabase.from('accounts_receivable').update({
            amount: arAmount,
            due_date: dueDate,
            client_name: so.client_name || '',
            client_cnpj: so.client_cnpj || '',
            description: `Pedido ${so.order_number || saleOrderId}${so.is_factoring ? ` (Factoring - Desc. R$${factoringDiscount.toFixed(2)})` : ''}`,
          }).eq('id', ar.id);
          must('Atualizar conta a receber existente', error);
        }
      }
    } else {
      // Create new receivable (no active non-cancelled AR exists)
      const { error } = await supabase.from('accounts_receivable').insert({
        sale_order_id: saleOrderId,
        client_name: so.client_name || '',
        client_cnpj: so.client_cnpj || '',
        description: `Pedido ${so.order_number || saleOrderId}${so.is_factoring ? ` (Factoring - Desc. R$${factoringDiscount.toFixed(2)})` : ''}`,
        category: 'venda',
        due_date: dueDate,
        amount: arAmount,
        amount_received: 0,
        status: 'pending',
      });
      must('Inserir conta a receber (Faturado)', error);
    }

    // Create financial entry for revenue tracking
    const { data: existingEntry, error: feErr } = await supabase
      .from('financial_entries')
      .select('id')
      .eq('reference_id', saleOrderId)
      .eq('reference_type', 'sale_order');
    must('Buscar financial_entries existentes', feErr);

    if (!existingEntry || existingEntry.length === 0) {
      const { error } = await supabase.from('financial_entries').insert({
        description: `Faturamento - ${so.client_name} - ${so.order_number || ''}`,
        amount: total,
        type: 'receita',
        entry_date: new Date().toISOString().split('T')[0],
        reference_id: saleOrderId,
        reference_type: 'sale_order',
        status: 'confirmed',
      });
      must('Inserir financial_entry de faturamento', error);
    } else {
      // Update existing entry amount
      const { error } = await supabase.from('financial_entries')
        .update({ amount: total, description: `Faturamento - ${so.client_name} - ${so.order_number || ''}` })
        .eq('reference_id', saleOrderId)
        .eq('reference_type', 'sale_order');
      must('Atualizar financial_entry de faturamento', error);
    }
    return;
  }

  // For Aprovado / Em Produção: create or update receivable
  if (so.status === 'Aprovado' || so.status === 'Em Produção') {
    const dueDate = so.delivery_deadline || new Date().toISOString().split('T')[0];
    // Only treat non-cancelled rows as "active" — all-cancelled means we must re-insert.
    const activeAR = (existingAR || []).filter(ar => ar.status !== 'cancelled');
    if (activeAR.length > 0) {
      const idsToUpdate = activeAR
        .filter(ar => ar.status !== 'received')
        .map(ar => ar.id);
      if (idsToUpdate.length > 0) {
        const { error } = await supabase.from('accounts_receivable').update({
          amount: total,
          due_date: dueDate,
          client_name: so.client_name || '',
          client_cnpj: so.client_cnpj || '',
          description: `PV ${so.order_number || saleOrderId} - ${so.client_name || ''}`,
        }).in('id', idsToUpdate);
        must('Atualizar contas a receber (Aprovado/Em Produção)', error);
      }
    } else if (total > 0) {
      const { error } = await supabase.from('accounts_receivable').insert({
        sale_order_id: saleOrderId,
        client_name: so.client_name || '',
        client_cnpj: so.client_cnpj || '',
        description: `PV ${so.order_number || saleOrderId} - ${so.client_name || ''}`,
        category: 'venda',
        due_date: dueDate,
        amount: total,
        amount_received: 0,
        status: 'pending',
      });
      must('Inserir conta a receber (Aprovado/Em Produção)', error);
    }
    return;
  }

  // For other statuses (Expedido, Concluído, etc.): sync amount AND due_date
  // so that delivery_deadline changes after Faturado are reflected in the AR
  // and the cash-flow forecast stays accurate.
  if (existingAR && existingAR.length > 0) {
    const newDueDate = so.delivery_deadline || null;
    for (const ar of existingAR) {
      if (ar.status !== 'received' && ar.status !== 'cancelled') {
        const updates: Record<string, any> = {};
        if (ar.amount !== total) updates.amount = total;
        if (newDueDate && ar.due_date !== newDueDate) updates.due_date = newDueDate;
        if (Object.keys(updates).length > 0) {
          const { error } = await supabase.from('accounts_receivable').update(updates).eq('id', ar.id);
          must('Atualizar conta a receber', error);
        }
      }
    }
  }
}

/**
 * After OPs are created and stock debited, check which products fell below min_stock.
 * Auto-generate Purchase Orders grouped by supplier to replenish to min_stock.
 */
async function generateAutoPurchaseOrders(saleOrderNumber: string, systemOrderNumber?: string, clientOrderNumber?: string) {
  // Find all products below min_stock
  const { data: lowProducts, error: lowErr } = await supabase
    .from('products')
    .select('id, name, sku, quantity, min_stock, max_stock, unit, unit_price, group_id, category, is_artisanal')
    .eq('active', true)
    .gt('min_stock', 0);
  if (lowErr || !lowProducts) return;

  const needsRestock = lowProducts.filter(p => p.quantity < p.min_stock && !p.is_artisanal);
  if (needsRestock.length === 0) return;

  // Get group IDs to find suppliers
  const groupIds = [...new Set(needsRestock.map(p => p.group_id).filter(Boolean))] as string[];

  // Fetch first supplier for each group
  let supplierMap = new Map<string, { supplier_id: string; supplier_name: string }>();
  if (groupIds.length > 0) {
    const { data: suppliers } = await supabase
      .from('group_suppliers')
      .select('id, group_id, supplier_name')
      .in('group_id', groupIds);
    if (suppliers) {
      for (const s of suppliers) {
        if (!supplierMap.has(s.group_id)) {
          supplierMap.set(s.group_id, { supplier_id: s.id, supplier_name: s.supplier_name });
        }
      }
    }
  }

  // Group products by supplier
  const bySupplier = new Map<string, { supplier_name: string; supplier_id: string; items: typeof needsRestock }>();

  for (const p of needsRestock) {
    const sup = p.group_id ? supplierMap.get(p.group_id) : null;
    const key = sup?.supplier_id || '__sem_fornecedor';
    const name = sup?.supplier_name || 'Sem Fornecedor';
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { supplier_name: name, supplier_id: sup?.supplier_id || '', items: [] });
    }
    bySupplier.get(key)!.items.push(p);
  }

  // Build detailed notes with order traceability
  const noteParts: string[] = ['Gerada automaticamente'];
  if (systemOrderNumber) noteParts.push(`PV Sistema: ${systemOrderNumber}`);
  if (clientOrderNumber) noteParts.push(`Pedido Cliente: ${clientOrderNumber}`);
  if (!systemOrderNumber && !clientOrderNumber) noteParts.push(`Pedido ${saleOrderNumber}`);
  const notes = noteParts.join(' | ');

  // Reuse existing pending POs per supplier or create new ones
  let createdCount = 0;
  let updatedCount = 0;

  // Fetch all pending auto-generated POs to check for reuse
  const { data: existingPOs } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id, supplier_name, total_value')
    .eq('status', 'pending')
    .eq('auto_generated', true);

  const pendingPOMap = new Map<string, { id: string; total_value: number }>();
  if (existingPOs) {
    for (const po of existingPOs) {
      if (po.supplier_id) {
        pendingPOMap.set(po.supplier_id, { id: po.id, total_value: po.total_value });
      }
    }
  }

  for (const [supplierKey, group] of bySupplier) {
    const poItems = group.items.map(p => {
      const deficit = Math.max(0, p.min_stock - p.quantity);
      return {
        product_id: p.id,
        quantity: deficit,
        suggested_quantity: deficit,
        unit_price: p.unit_price,
        unit: p.unit,
        current_stock: p.quantity,
        min_stock: p.min_stock,
        max_stock: p.max_stock || 0,
      };
    }).filter(i => i.quantity > 0);

    if (poItems.length === 0) continue;

    const totalValue = poItems.reduce((s, i) => s + i.quantity * (i.unit_price || 0), 0);
    const existingPO = group.supplier_id ? pendingPOMap.get(group.supplier_id) : null;

    if (existingPO) {
      // Use upsert_po_item_atomic per item — locks PO header and updates total_value
      // atomically, preventing the race where two concurrent approvals for the same
      // supplier corrupt shared item rows or leave total_value stale.
      for (const item of poItems) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         existingPO.id,
          p_product_id:    item.product_id,
          p_qty_delta:     item.quantity,
          p_unit_price:    item.unit_price,
          p_unit:          item.unit,
          p_current_stock: item.current_stock,
          p_min_stock:     item.min_stock,
          p_max_stock:     item.max_stock || 0,
        });
        if (rpcErr) {
          console.error('Erro ao upsert item OC existente:', rpcErr.message);
        }
      }
      // Keep notes in sync (total_value updated by RPC above)
      await supabase.from('purchase_orders').update({ notes }).eq('id', existingPO.id);
      updatedCount++;
    } else {
      // Create new PO; total_value starts at 0 and is accumulated by upsert_po_item_atomic.
      const { data: po, error: poErr } = await supabase.from('purchase_orders').insert({
        supplier_name: group.supplier_name,
        supplier_id: group.supplier_id || null,
        notes,
        total_value: 0,
        auto_generated: true,
      }).select('id').single();

      if (poErr || !po) continue;

      let anyItemFailed = false;
      for (const item of poItems) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         po.id,
          p_product_id:    item.product_id,
          p_qty_delta:     item.quantity,
          p_unit_price:    item.unit_price,
          p_unit:          item.unit,
          p_current_stock: item.current_stock,
          p_min_stock:     item.min_stock,
          p_max_stock:     item.max_stock || 0,
        });
        if (rpcErr) {
          console.error('Erro ao inserir item OC nova:', rpcErr.message);
          anyItemFailed = true;
        }
      }
      if (anyItemFailed) {
        // If all items failed the header has no items — delete the orphan header.
        const { count } = await supabase
          .from('purchase_order_items')
          .select('id', { count: 'exact', head: true })
          .eq('purchase_order_id', po.id);
        if (!count) {
          await supabase.from('purchase_orders').delete().eq('id', po.id);
          continue;
        }
        toast.warning(`OC criada parcialmente — verifique a OC ${po.id.slice(0, 8)}`);
      }

      if (group.supplier_id) {
        pendingPOMap.set(group.supplier_id, { id: po.id, total_value: totalValue });
      }
      createdCount++;
    }
  }

  const msgs: string[] = [];
  if (createdCount > 0) msgs.push(`${createdCount} nova(s) OC criada(s)`);
  if (updatedCount > 0) msgs.push(`${updatedCount} OC existente(s) atualizada(s)`);
  if (msgs.length > 0) {
    toast.info(msgs.join(' e ') + ' para repor estoque');
  }
}

export type PackagingMode = 'individual_amarrado' | 'individual_master' | 'colmeia';

export const PACKAGING_MODE_LABELS: Record<PackagingMode, string> = {
  individual_amarrado: 'Caixa Individual + Amarrado',
  individual_master: 'Caixa Individual + Caixa Master',
  colmeia: 'Caixa Colméia',
};

export type SaleOrderFormData = {
  client_name: string;
  client_cnpj: string;
  client_contact: string;
  client_order_number: string;
  representative: string;
  payment_condition: string;
  delivery_deadline: string;
  delivery_week: string;
  delivery_month: string;
  notes: string;
  status: string;
  nfe: string;
  remessa: string;
  is_factoring: boolean;
  factoring_config_id: string;
  packaging_mode: PackagingMode;
};

export type SaleOrderItemFormData = {
  reference_id: string;
  color: string;
  grade: Record<string, number>;
  unit_price: number;
  quantity: number;
  fichas?: number;
  strap_colors?: { id: string; label: string; color: string }[];
  observation?: string | null;
  material_variant_id?: string | null;
};

export function useSaleOrders() {
  return useQuery({
    queryKey: ['sale_orders'],
    queryFn: async () => {
      // Cap to the most recent 1000 sale orders to avoid loading the
      // entire historical base on every dashboard/list mount.
      const { data, error } = await supabase
        .from('sale_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;

      // Enrich with client_number from clients table
      const clientIds = [...new Set((data || []).map((so: any) => so.client_id).filter(Boolean))];
      let clientNumberMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, client_number')
          .in('id', clientIds);
        if (clients) {
          clientNumberMap = Object.fromEntries(clients.map((c: any) => [c.id, c.client_number]));
        }
      }

      return (data || []).map((so: any) => ({
        ...so,
        client_number: clientNumberMap[so.client_id] || null,
      }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useSaleOrderItems(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['sale_order_items', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*, technical_sheets(name, code)')
        .eq('sale_order_id', saleOrderId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useSaleOrderAllItems() {
  return useQuery({
    queryKey: ['sale_order_items_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*');
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, items, client_id, representative_id, commission_value, packaging_product_id, packaging_quantity }: { order: SaleOrderFormData; items: SaleOrderItemFormData[]; client_id?: string | null; representative_id?: string | null; commission_value?: number; packaging_product_id?: string | null; packaging_quantity?: number }) => {
      const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      const insertData: any = { ...order, total };
      // Sync billing_week from delivery_month + delivery_week
      if (order.delivery_month && order.delivery_week) {
        insertData.billing_week = `${order.delivery_month}-${order.delivery_week}`;
      } else if (order.delivery_week) {
        insertData.billing_week = order.delivery_week;
      }
      if (client_id !== undefined) insertData.client_id = client_id || null;
      if (!insertData.delivery_deadline) insertData.delivery_deadline = null;
      if (!insertData.factoring_config_id) insertData.factoring_config_id = null;
      if (representative_id) insertData.representative_id = representative_id; else if (representative_id === '') insertData.representative_id = null;
      if (commission_value !== undefined) insertData.commission_value = commission_value;
      if (packaging_product_id) insertData.packaging_product_id = packaging_product_id; else insertData.packaging_product_id = null;
      if (packaging_quantity !== undefined) insertData.packaging_quantity = packaging_quantity;

      // Sanitize: replace empty strings with null for all UUID-type fields
      const uuidFields = ['client_id', 'representative_id', 'factoring_config_id', 'packaging_product_id', 'economic_group_id'];
      for (const f of uuidFields) {
        if (insertData[f] === '') insertData[f] = null;
      }

      const { data, error } = await supabase
        .from('sale_orders')
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;

      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('sale_order_items')
          .insert(items.map(i => ({ ...i, sale_order_id: data.id, grade: i.grade })));
        if (itemsError) {
          // Rollback: remove the parent order so we don't leave an empty/orphan PV
          const { error: cleanupErr } = await supabase.rpc('delete_empty_sale_order', { p_sale_order_id: data.id } as any);
          if (cleanupErr) {
            console.error('[useCreateSaleOrder] Falha ao remover pedido órfão:', cleanupErr.message, 'sale_order_id:', data.id);
          }
          throw itemsError;
        }
      }

      // Auto-sync financial records
      await syncFinancialRecords(data.id);

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      // Profitability aggregate may have shifted with the new order's revenue.
      qc.invalidateQueries({ queryKey: ['profitability'] });
      toast.success('Pedido de venda criado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSaleOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Validate transition before touching the DB
      const { data: current, error: fetchError } = await supabase
        .from('sale_orders')
        .select('status')
        .eq('id', id)
        .single();
      if (fetchError) throw fetchError;

      const currentStatus: string = current.status;
      if (!isValidStatusTransition(currentStatus, status)) {
        throw new Error(
          `Transição de status inválida: ${currentStatus} → ${status}`
        );
      }

      // Require an authorized NF-e before marking as Expedido — without one,
      // physical goods would leave the warehouse with no fiscal document.
      if (status === 'Expedido') {
        const { data: authNfe } = await supabase
          .from('nfe_emitidas')
          .select('id')
          .eq('sale_order_id', id)
          .eq('status', 'autorizada')
          .limit(1);
        if (!authNfe || authNfe.length === 0) {
          throw new Error(
            'Não é possível marcar como Expedido sem NF-e autorizada. Emita e autorize a NF-e antes de expedir.'
          );
        }
      }

      // Block cancellation when there is an authorized/processing NF-e — the
      // fiscal document would become orphaned (FK ON DELETE SET NULL on
      // nfe_emitidas.sale_order_id). User must cancel the NF-e first.
      if (status === 'Cancelado') {
        const { data: blockingNfe, error: blockingNfeErr } = await supabase
          .from('nfe_emitidas')
          .select('id, status, ref_nfe')
          .eq('sale_order_id', id)
          .in('status', ['autorizada', 'processando', 'cancelando']);
        if (blockingNfeErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeErr.message}`);
        if (blockingNfe && blockingNfe.length > 0) {
          const refs = blockingNfe.map((n: any) => n.ref_nfe || n.id).join(', ');
          throw new Error(
            `Não é possível cancelar: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
            `Cancele a NF-e antes (até 24h após emissão) ou inutilize a numeração.`
          );
        }
      }

      // Atomic conditional update: predicate .eq('status', currentStatus) ensures
      // only one concurrent call wins the transition. A second call (double-click,
      // two browser tabs) would find the status already changed and get 0 rows back.
      const { data: claimed, error } = await supabase
        .from('sale_orders')
        .update({ status })
        .eq('id', id)
        .eq('status', currentStatus)
        .select('id');
      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        throw new Error('Status alterado simultaneamente por outro usuário — recarregue o pedido.');
      }

      // Quando sai de produção (volta para Aprovado, Pendente, etc.), reverter OPs
      const NON_PRODUCTION_STATUSES = ['Pendente', 'Aprovado', 'Rascunho'];
      if (NON_PRODUCTION_STATUSES.includes(status)) {
        const { data: linkedOps, error: linkedOpsErr } = await supabase
          .from('orders')
          .select('id, status')
          .eq('sale_order_id', id);
        if (linkedOpsErr) throw new Error(`Falha ao carregar OPs: ${linkedOpsErr.message}`);

        if (linkedOps && linkedOps.length > 0) {
          const activeOps = linkedOps.filter(op => op.status === 'Em Produção');
          if (activeOps.length > 0) {
            const opIds = activeOps.map(op => op.id);
            const { error: revertErr } = await supabase
              .from('orders')
              .update({ status: 'Reservado', updated_at: new Date().toISOString() })
              .in('id', opIds);
            if (revertErr) throw new Error(`Falha ao reverter OPs para Reservado: ${revertErr.message}`);
          }
        }
      }

      // Quando "Cancelado", cancelar OPs vinculadas e RESTAURAR ESTOQUE
      if (status === 'Cancelado') {
        // Revert the PV claim so the operator can retry if any post-claim step fails.
        const revertPvClaim = async () => {
          await supabase.from('sale_orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelado');
        };

        const { data: linkedOps, error: linkedOpsErr } = await supabase
          .from('orders')
          .select('id, status')
          .eq('sale_order_id', id);
        if (linkedOpsErr) {
          await revertPvClaim();
          throw new Error(`Falha ao carregar OPs vinculadas: ${linkedOpsErr.message}`);
        }

        if (linkedOps && linkedOps.length > 0) {
          // Warn if any OP is Finalizado — that implies the PV was Faturado and a NF-e
          // may already have been issued. The restore still runs (idempotent RPC), but the
          // operator should cancel the NF-e before cancelling the PV to avoid ghost revenue.
          const finalizadoOps = linkedOps.filter(op => op.status === 'Finalizado');
          if (finalizadoOps.length > 0) {
            toast.warning(
              `Atenção: ${finalizadoOps.length} OP(s) já estão Finalizadas. ` +
              'Cancele a NF-e correspondente antes de cancelar este PV para evitar inconsistência fiscal.',
              { duration: 8000 },
            );
          }

          // 1) Restaura estoque debitado por cada OP (release reservas + restore movimentos).
          //    Reservas pode não existir em ambientes antigos — tolerado. Restore é obrigatório.
          for (const op of linkedOps) {
            if (op.status === 'Cancelada') continue;
            // Rascunho OPs never had stock debited — skip restore to avoid spurious errors
            const hadStock = !['Rascunho', 'Cancelada'].includes(op.status);
            if (!hadStock) continue;
            const { error: relErr } = await supabase.rpc('release_order_reservations', { p_order_id: op.id } as any);
            if (relErr && !/does not exist|not found/i.test(relErr.message)) {
              await revertPvClaim();
              throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
            }
            // Sole grade per-size MUST be restored before product stocks — otherwise
            // the conjugated bucket counters stay depleted and future orders see
            // wrong availability per size.
            const { error: soleErr } = await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id } as any);
            if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
              await revertPvClaim();
              throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
            }
            const { error: restoreErr } = await supabase.rpc('restore_product_stocks_for_order', { p_order_id: op.id } as any);
            if (restoreErr) {
              await revertPvClaim();
              throw new Error(`Falha ao restaurar estoque da OP ${op.id} no cancelamento: ${restoreErr.message}`);
            }
          }

          // 2) Marca OPs como Cancelada
          const opIds = linkedOps.map(op => op.id);
          const { error: cancelOpsErr } = await supabase
            .from('orders')
            .update({ status: 'Cancelada', updated_at: new Date().toISOString() })
            .in('id', opIds);
          if (cancelOpsErr) {
            await revertPvClaim();
            throw new Error(`Falha ao cancelar OPs vinculadas: ${cancelOpsErr.message}`);
          }

          // 2b) Limpa dados de produção das OPs. Filtra apenas OPs que não eram
          // Cancelada ANTES desta transição para preservar o histórico de auditoria
          // de OPs já canceladas anteriormente (production_consumptions é trilha de auditoria).
          const newlyCancelledOpIds = linkedOps
            .filter(op => op.status !== 'Cancelada')
            .map(op => op.id);
          if (newlyCancelledOpIds.length > 0) {
            const { error: stagesDelErr } = await supabase.from('order_stages').delete().in('order_id', newlyCancelledOpIds);
            if (stagesDelErr) { await revertPvClaim(); throw new Error(`Falha ao remover etapas: ${stagesDelErr.message}`); }
            const { error: consDelErr } = await supabase.from('production_consumptions').delete().in('order_id', newlyCancelledOpIds);
            if (consDelErr) { await revertPvClaim(); throw new Error(`Falha ao remover consumos: ${consDelErr.message}`); }
            const { error: resDelErr } = await supabase.from('material_reservations').delete().in('order_id', newlyCancelledOpIds);
            if (resDelErr) { await revertPvClaim(); throw new Error(`Falha ao remover reservas: ${resDelErr.message}`); }
          }
        }

        // 3) Limpa MRP suggestions do PV cancelado para não poluir o dashboard MRP.
        await supabase.from('mrp_suggestions').delete().eq('sale_order_id', id);

        // 4) Sincroniza contas a receber / financial_entries (cancela AR e remove ghost revenue).
        // Wrapped in try/catch: if AR sync fails, the PV is already Cancelado and
        // stock is already restored — retrying the entire mutation would fail the
        // atomic claim. Surface as a warning so the operator can reconcile manually.
        try {
          await syncFinancialRecords(id);
        } catch (finErr: any) {
          console.error('syncFinancialRecords failed on PV cancel:', finErr);
          toast.warning(
            `Cancelamento concluído, mas sincronização financeira falhou: ${finErr.message}. ` +
            'Verifique as contas a receber manualmente.',
            { duration: 10000 },
          );
        }
      }

      // Quando "Em Produção", sincronizar OPs vinculadas
      if (status === 'Em Produção') {
        const { data: allLinkedOps, error: allLinkedOpsErr } = await supabase
          .from('orders')
          .select('id, reference_id, quantity, status, sale_order_item_id')
          .eq('sale_order_id', id)
          .neq('status', 'Cancelada');
        if (allLinkedOpsErr) throw new Error(`Falha ao carregar OPs vinculadas: ${allLinkedOpsErr.message}`);

        // Only advance Reservado OPs — Rascunho OPs never had stock debited so
        // bumping them to Em Produção without running the debit pipeline would
        // produce ghost OPs with no material consumption on the shop floor.
        const opsToUpdate = (allLinkedOps || []).filter(op => op.status === 'Reservado');
        // [6] Exclude Rascunho OPs from existingItemOpIds — they never had stock debited
        // and must not block creation of a properly-debited Em Produção OP for the same item.
        const existingItemOpIds = new Set(
          (allLinkedOps || [])
            .filter((op: any) => op.status !== 'Rascunho')
            .map((op: any) => op.sale_order_item_id)
            .filter(Boolean)
        );

        // Create OPs for items not yet covered (handles initial creation and partial-failure recovery)
        {
          const { data: pvItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
          if (pvItems && pvItems.length > 0) {
            // Hoist sale-order-level fetches out of the per-item loop
            const soDeadline = await supabase.from('sale_orders').select('delivery_deadline, billing_week, packaging_mode').eq('id', id).single();
            const deadline = soDeadline.data?.delivery_deadline;
            const pkgMode2 = (soDeadline.data as any)?.packaging_mode || 'individual_amarrado';
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const deadlineDate = deadline ? new Date(deadline) : null;
            const daysUntil = deadlineDate ? Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000) : 0;
            const isAhead = daysUntil > 14;

            // Batch-fetch all technical sheets needed by these items
            const refIds2 = [...new Set(pvItems.map(i => i.reference_id).filter(Boolean))];
            const { data: sheetsForEm } = await supabase
              .from('technical_sheets')
              .select('id, production_sectors')
              .in('id', refIds2);
            const sheetMap2 = new Map((sheetsForEm || []).map((s: any) => [s.id, s]));

            for (const item of pvItems) {
              if (!item.reference_id || existingItemOpIds.has(item.id)) continue;
              const grade = item.grade as Record<string, number> | null;
              const fichas = (item as any).fichas || 1;
              const scaledGrade: Record<string, number> = {};
              if (grade) {
                for (const [size, qty] of Object.entries(grade)) {
                  const val = (Number(qty) || 0) * fichas;
                  if (val > 0) scaledGrade[size] = val;
                }
              }

              const { data: createdOp, error: opError } = await supabase.from('orders').insert({
                reference_id: item.reference_id,
                quantity: item.quantity,
                color: item.color || '',
                grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
                sale_order_id: id,
                sale_order_item_id: item.id,
                notes: 'Gerada automaticamente - Em Produção',
                status: 'Em Produção',
                item_observation: (item as any).observation || null,
                planned_delivery: deadline || null,
                is_ahead_of_schedule: isAhead,
              }).select('id, reference_id, quantity').single();

              if (opError) {
                console.error('Erro ao criar OP (Em Produção):', opError.message);
                toast.warning(`Falha ao criar OP para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${opError.message}`);
              } else if (createdOp) {
                // Critical debit: if this fails we cancel the OP so it doesn't have stages but no stock movement.
                // supabase.rpc() resolves to { data, error } — it does NOT throw on RPC errors,
                // so try/catch is wrong here. Use the { error } destructuring pattern.
                let criticalDebitFailed = false;
                const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
                  p_reference_id: item.reference_id,
                  p_order_quantity: item.quantity,
                  p_color: item.color || '',
                  p_order_id: createdOp.id,
                  p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || null),
                } as any);
                if (debitErr) {
                  console.error('Erro ao debitar estoque (Em Produção):', debitErr.message);
                  criticalDebitFailed = true;
                  await supabase.from('orders').update({ status: 'Cancelada', notes: `Cancelada — falha no débito: ${debitErr.message}` }).eq('id', createdOp.id);
                  toast.warning(`OP cancelada — débito de estoque falhou para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${debitErr.message}`);
                }

                if (!criticalDebitFailed) {
                  const secondaryDebitErrors: string[] = [];

                  // Automatic stock out based on Technical Sheet (BOM)
                  const { error: stockOutErr } = await supabase.rpc('process_order_stock_out', {
                    p_order_id: createdOp.id,
                    p_product_id: item.reference_id,
                    p_quantity: item.quantity
                  } as any);
                  if (stockOutErr) {
                    console.error('Erro ao processar stock out (Em Produção):', stockOutErr.message);
                    secondaryDebitErrors.push(`stock-out: ${stockOutErr.message}`);
                  }

                  if (Object.keys(scaledGrade).length > 0) {
                    const { error: soleErr } = await supabase.rpc('debit_sole_stock_by_grade', {
                      p_reference_id: item.reference_id,
                      p_order_id: createdOp.id,
                      p_color: item.color || '',
                      p_order_grade: scaledGrade,
                    } as any);
                    if (soleErr) {
                      console.error('Erro ao debitar solado (Em Produção):', soleErr.message);
                      // Attempt auto-PO for sole shortage so the operator has a tracked
                      // replenishment to re-approve against once stock arrives.
                      let autoPoNote = '';
                      try {
                        const po = await autoCreateSolePO({
                          referenceId: item.reference_id,
                          orderId: createdOp.id,
                          color: item.color || '',
                          grade: scaledGrade,
                          orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                        });
                        if (po) {
                          toast.warning(
                            `Solado insuficiente — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}). Reaprovar a OP após recebimento.`,
                            { duration: 8000 },
                          );
                          autoPoNote = ` (OC ${po.poNumber} criada — reaprovar após recebimento)`;
                        }
                      } catch (poErr: any) {
                        console.error('Erro ao gerar OC de solado (Em Produção):', poErr?.message);
                      }
                      // Sole debit failure ALWAYS cancels the OP. Allowing the OP to advance
                      // "Em Produção" without sole debited (because an auto-PO was created)
                      // produced silent inventory drift: nothing tied the incoming stock
                      // to this OP, so a concurrent OP could consume it.
                      secondaryDebitErrors.push(`solado: ${soleErr.message}${autoPoNote}`);
                    }
                  }
                  // Debit strap materials (Em Produção path)
                  const strapColorsEm = (item as any).strap_colors;
                  if (strapColorsEm && Array.isArray(strapColorsEm) && strapColorsEm.length > 0) {
                    const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
                      p_strap_colors: strapColorsEm,
                      p_order_quantity: item.quantity,
                      p_order_id: createdOp.id,
                      p_order_grade: (item as any).grade || null,
                    } as any);
                    if (strapErr) {
                      console.error('Erro ao debitar tiras (Em Produção):', strapErr.message);
                      secondaryDebitErrors.push(`tiras: ${strapErr.message}`);
                    }
                  }
                  // Debit packaging
                  const { error: pkgErr } = await supabase.rpc('debit_packaging_for_order', {
                    p_sale_order_id: id,
                    p_order_id: createdOp.id,
                    p_reference_id: item.reference_id,
                    p_order_quantity: item.quantity,
                    p_packaging_mode: pkgMode2,
                  } as any);
                  if (pkgErr) {
                    console.error('Erro embalagem:', pkgErr.message);
                    secondaryDebitErrors.push(`embalagem: ${pkgErr.message}`);
                  }

                  // If any secondary debit failed, restore and cancel the OP so it
                  // doesn't stay 'Em Produção' with under-debited stock (silent inventory
                  // corruption). The operator can re-approve once the shortage is resolved.
                  if (secondaryDebitErrors.length > 0) {
                    await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                    await supabase.from('orders').update({
                      status: 'Cancelada',
                      notes: `Cancelada — débitos parciais falharam: ${secondaryDebitErrors.join('; ')}`,
                    }).eq('id', createdOp.id);
                    toast.error(`OP cancelada — débitos parciais falharam: ${secondaryDebitErrors.join('; ')}`, { duration: 10000 });
                    continue;
                  }
                  // Create stages (use pre-fetched sheet map)
                  const sheetData = sheetMap2.get(item.reference_id);
                  const DEFAULT_STAGES = DEFAULT_OP_STAGES;
                  const sectors = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                    ? sheetData.production_sectors.map((x: any) => String(x))
                    : DEFAULT_STAGES.map(s => s.name);
                  const rows = sectors.map((name: string, idx: number) => {
                    const ds = DEFAULT_STAGES.find(s => s.name === name);
                    return {
                      order_id: createdOp.id, stage_name: name,
                      stage_order: ds?.order || idx + 1, status: 'pendente',
                      quantity_total: item.quantity, quantity_processed: 0,
                    };
                  });
                  const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
                  if (stgInsErr) {
                    // Falha ao criar etapas: cleanup + continue para não abortar
                    // o loop e deixar OPs subsequentes sem processar.
                    console.error('Erro ao criar etapas (Em Produção):', stgInsErr.message);
                    await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                    await supabase.from('orders').update({
                      status: 'Cancelada',
                      notes: `Cancelada — falha ao criar etapas: ${stgInsErr.message}`,
                    }).eq('id', createdOp.id);
                    toast.error(`OP ${createdOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
                    continue;
                  }
                }
              }
            }
          }
        }
        if (opsToUpdate.length > 0) {
          const opIds = opsToUpdate.map(op => op.id);
          await supabase.from('orders')
            .update({ status: 'Em Produção', updated_at: new Date().toISOString() })
            .in('id', opIds);
          // Create stages for OPs missing them
          const { data: existingStages } = await supabase.from('order_stages').select('order_id').in('order_id', opIds);
          const opsWithStages = new Set((existingStages || []).map(s => s.order_id));
          const opsNeedingStages = opsToUpdate.filter(op => !opsWithStages.has(op.id));
          if (opsNeedingStages.length > 0) {
            const refIds = [...new Set(opsNeedingStages.map(op => op.reference_id))];
            const { data: sheetsData } = await supabase.from('technical_sheets').select('id, production_sectors').in('id', refIds);
            const sectorsMap = new Map<string, string[]>();
            sheetsData?.forEach((s: any) => {
              const sectors = Array.isArray(s.production_sectors) && s.production_sectors.length > 0
                ? s.production_sectors.map((x: any) => String(x))
                : DEFAULT_OP_STAGES.map(s => s.name);
              sectorsMap.set(s.id, sectors);
            });
            const DEFAULT_STAGES = DEFAULT_OP_STAGES;
            const recoveryStageErrors: string[] = [];
            for (const op of opsNeedingStages) {
              const sectorNames = sectorsMap.get(op.reference_id) || DEFAULT_STAGES.map(s => s.name);
              const rows = sectorNames.map((name: string, idx: number) => {
                const ds = DEFAULT_STAGES.find(s => s.name === name);
                return {
                  order_id: op.id, stage_name: name,
                  stage_order: ds?.order || idx + 1, status: 'pendente',
                  quantity_total: op.quantity, quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
              if (stgInsErr) {
                // Path de recovery: a OP já existia e o estoque já foi processado
                // num momento anterior. Não restaurar — apenas registrar a falha
                // e seguir para que outras OPs possam ter suas etapas criadas.
                console.error(`Erro ao criar etapas (recovery OP ${op.id.slice(0, 8)}):`, stgInsErr.message);
                recoveryStageErrors.push(`${op.id.slice(0, 8)}: ${stgInsErr.message}`);
              }
            }
            if (recoveryStageErrors.length > 0) {
              toast.error(`Falha ao criar etapas em ${recoveryStageErrors.length} OP(s): ${recoveryStageErrors.join('; ')}`, { duration: 10000 });
            }
          }
        }
      }

      // Quando "Aprovado", criar OPs, debitar materiais com estoque e gerar MRP para faltas
      if (status === 'Aprovado') {
        const { data: soData } = await supabase.from('sale_orders').select('order_number').eq('id', id).single();
        const soNumber = soData?.order_number || id;

        const { data: existingOps } = await supabase.from('orders').select('id, sale_order_item_id').eq('sale_order_id', id).neq('status', 'Cancelada');
        const existingItemOps = new Set((existingOps || []).map((op: any) => op.sale_order_item_id).filter(Boolean));
        {
          const { data: pvItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
          if (pvItems && pvItems.length > 0) {
            // Hoist sale-order-level fetches out of the per-item loop
            const { data: soForPkg } = await supabase.from('sale_orders').select('packaging_mode').eq('id', id).single();
            const pkgMode = (soForPkg as any)?.packaging_mode || 'individual_amarrado';

            // Batch-fetch all technical sheets (name, code, sectors) for this PV's items
            const refIdsAprov = [...new Set(pvItems.map((i: any) => i.reference_id).filter(Boolean))];
            const { data: sheetsAprov } = await supabase
              .from('technical_sheets')
              .select('id, name, code, production_sectors')
              .in('id', refIdsAprov);
            const sheetMapAprov = new Map((sheetsAprov || []).map((s: any) => [s.id, s]));

            const DEFAULT_STAGES = DEFAULT_OP_STAGES;

            // Collect MRP suggestions to batch-insert after the loop
            const mrpSuggestions: any[] = [];
            let totalShortageCount = 0;

            for (const item of pvItems) {
              if (!item.reference_id || existingItemOps.has(item.id)) continue;
              const grade = item.grade as Record<string, number> | null;
              const fichas = (item as any).fichas || 1;
              const scaledGrade: Record<string, number> = {};
              if (grade) {
                for (const [size, qty] of Object.entries(grade)) {
                  const val = (Number(qty) || 0) * fichas;
                  if (val > 0) scaledGrade[size] = val;
                }
              }

              // Check stock availability BEFORE creating OP (pass grade for per-size calculation)
              const effectiveGrade = Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || null);
              const { data: stockCheck } = await supabase.rpc('check_stock_availability', {
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_color: item.color || '',
                p_order_grade: effectiveGrade,
              } as any);

              const shortages = (stockCheck || []).filter((s: any) => !s.sufficient);

              // Create OP with status Reservado
              const { data: createdOp, error: opError } = await supabase.from('orders').insert({
                reference_id: item.reference_id,
                quantity: item.quantity,
                color: item.color || '',
                grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
                sale_order_id: id,
                sale_order_item_id: item.id,
                notes: 'Gerada automaticamente - Aprovação PV',
                status: 'Reservado',
                item_observation: (item as any).observation || null,
              }).select('id, reference_id, quantity').single();

              if (opError || !createdOp) {
                console.error('Erro ao criar OP na aprovação:', opError?.message);
                continue;
              }

              // Debit stock (hybrid: reserves soft, debits hard for consumables)
              // supabase.rpc() resolves to { data, error } — does NOT throw on RPC errors.
              const { error: debitErrAprov } = await supabase.rpc('hybrid_debit_stock_for_order', {
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_color: item.color || '',
                p_order_id: createdOp.id,
                p_order_grade: effectiveGrade,
              } as any);
              if (debitErrAprov) {
                console.error('Erro ao debitar estoque (Aprovado):', debitErrAprov.message);
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — falha no débito: ${debitErrAprov.message}`,
                }).eq('id', createdOp.id);
                toast.warning(`OP cancelada — débito de estoque falhou para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${debitErrAprov.message}`);
                continue;
              }

              const secondaryDebitErrorsAprov: string[] = [];

              // Automatic stock out based on Technical Sheet (BOM)
              const { error: stockOutErrAprov } = await supabase.rpc('process_order_stock_out', {
                p_order_id: createdOp.id,
                p_product_id: item.reference_id,
                p_quantity: item.quantity
              } as any);
              if (stockOutErrAprov) {
                console.error('Erro ao processar stock out (Aprovado):', stockOutErrAprov.message);
                secondaryDebitErrorsAprov.push(`stock-out: ${stockOutErrAprov.message}`);
              }

              // Debit sole stock by grade
              if (Object.keys(scaledGrade).length > 0) {
                const { error: soleErrAprov } = await supabase.rpc('debit_sole_stock_by_grade', {
                  p_reference_id: item.reference_id,
                  p_order_id: createdOp.id,
                  p_color: item.color || '',
                  p_order_grade: scaledGrade,
                } as any);
                if (soleErrAprov) {
                  console.error('Erro ao debitar solado (Aprovado):', soleErrAprov.message);
                  let solePOHandledAprov = false;
                  try {
                    const po = await autoCreateSolePO({
                      referenceId: item.reference_id,
                      orderId: createdOp.id,
                      color: item.color || '',
                      grade: scaledGrade,
                      orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                    });
                    if (po) {
                      toast.warning(
                        `Solado insuficiente — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}).`,
                        { duration: 8000 },
                      );
                      solePOHandledAprov = true;
                    }
                  } catch (poErr: any) {
                    console.error('Erro ao gerar OC de solado (Aprovado):', poErr?.message);
                  }
                  if (!solePOHandledAprov) {
                    secondaryDebitErrorsAprov.push(`solado: ${soleErrAprov.message}`);
                  }
                }
              }

              // Debit strap materials
              const strapColors = (item as any).strap_colors;
              if (strapColors && Array.isArray(strapColors) && strapColors.length > 0) {
                const { error: strapErrAprov } = await supabase.rpc('debit_strap_stock', {
                  p_strap_colors: strapColors,
                  p_order_quantity: item.quantity,
                  p_order_id: createdOp.id,
                  p_order_grade: (item as any).grade || null,
                } as any);
                if (strapErrAprov) {
                  console.error('Erro ao debitar tiras (Aprovado):', strapErrAprov.message);
                  secondaryDebitErrorsAprov.push(`tiras: ${strapErrAprov.message}`);
                }
              }

              // Debit packaging (use hoisted pkgMode)
              const { error: pkgErrAprov } = await supabase.rpc('debit_packaging_for_order', {
                p_sale_order_id: id,
                p_order_id: createdOp.id,
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_packaging_mode: pkgMode,
              } as any);
              if (pkgErrAprov) {
                console.error('Erro ao debitar embalagem (Aprovado):', pkgErrAprov.message);
                secondaryDebitErrorsAprov.push(`embalagem: ${pkgErrAprov.message}`);
              }

              if (secondaryDebitErrorsAprov.length > 0) {
                await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — débitos parciais falharam: ${secondaryDebitErrorsAprov.join('; ')}`,
                }).eq('id', createdOp.id);
                toast.error(`OP cancelada — débitos parciais falharam: ${secondaryDebitErrorsAprov.join('; ')}`, { duration: 10000 });
                continue;
              }

              // Collect MRP suggestions (batch insert after loop)
              if (shortages.length > 0) {
                const sheetInfo = sheetMapAprov.get(item.reference_id);
                totalShortageCount += shortages.length;
                for (const shortage of shortages) {
                  const shortageQty = Math.max(0, (shortage as any).required - (shortage as any).available);
                  if (shortageQty <= 0) continue;
                  mrpSuggestions.push({
                    suggestion_type: 'purchase',
                    product_id: (shortage as any).product_id || null,
                    product_name: (shortage as any).product_name || 'Material',
                    sale_order_id: id,
                    order_id: createdOp.id,
                    required_quantity: (shortage as any).required,
                    available_quantity: (shortage as any).available,
                    shortage_quantity: shortageQty,
                    priority: 'rush',
                    due_date: null,
                    notes: `Falta de material para ${(sheetInfo as any)?.name || 'Ref'} (${(sheetInfo as any)?.code || ''}) - PV ${soNumber}`,
                  });
                }
              }

              // Create production stages (use pre-fetched sheet map)
              const sheetData = sheetMapAprov.get(item.reference_id);
              const sectors = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                ? sheetData.production_sectors.map((x: any) => String(x))
                : DEFAULT_STAGES.map(s => s.name);
              const rows = sectors.map((name: string, idx: number) => {
                const ds = DEFAULT_STAGES.find(s => s.name === name);
                return {
                  order_id: createdOp.id, stage_name: name,
                  stage_order: ds?.order || idx + 1, status: 'pendente',
                  quantity_total: item.quantity, quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
              if (stgInsErr) {
                // Falha ao criar etapas: a OP já teve estoque debitado.
                // Em vez de fazer throw e abortar o loop (deixando OPs anteriores
                // criadas + esta OP sem etapas), seguimos o mesmo padrão de
                // débitos secundários acima (linhas 1205-1215): estorna estoque,
                // cancela esta OP e continua processando os demais itens.
                console.error('Erro ao criar etapas (Aprovado):', stgInsErr.message);
                await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — falha ao criar etapas: ${stgInsErr.message}`,
                }).eq('id', createdOp.id);
                toast.error(`OP ${createdOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
                continue;
              }
            }

            // Batch-insert all MRP suggestions collected during the loop
            if (mrpSuggestions.length > 0) {
              await supabase.from('mrp_suggestions').insert(mrpSuggestions as any);

              // Auto-create POs for materials lacking stock (grouped by product_id to avoid duplicates)
              const seenProductIds = new Set<string>();
              let autoPOCount = 0;
              for (const s of mrpSuggestions) {
                if (!s.product_id || seenProductIds.has(s.product_id)) continue;
                seenProductIds.add(s.product_id);
                try {
                  const po = await autoCreateMaterialPO({
                    productId: s.product_id,
                    productName: s.product_name || 'Material',
                    shortageQty: s.shortage_quantity,
                    orderRef: soNumber,
                  });
                  if (po) {
                    autoPOCount++;
                    toast.warning(
                      `Material insuficiente: "${s.product_name}" — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}).`,
                      { duration: 8000 },
                    );
                  } else {
                    toast.warning(
                      `Material insuficiente: "${s.product_name}" — fornecedor não encontrado. Verifique manualmente.`,
                      { duration: 8000 },
                    );
                  }
                } catch (poErr: any) {
                  console.error('Erro ao gerar OC de material:', poErr?.message);
                }
              }
              if (autoPOCount === 0 && totalShortageCount > 0) {
                toast.warning(`${totalShortageCount} material(is) com estoque insuficiente — verifique fornecedores.`);
              }
            }
          }

          // Auto-generate purchase orders for materials below min_stock
          // Fetch client order number for traceability
          const { data: soClientData } = await supabase.from('sale_orders').select('client_order_number').eq('id', id).single();
          await generateAutoPurchaseOrders(soNumber, soNumber, soClientData?.client_order_number || undefined);
        }
      }

      // Quando faturado, dar baixa (finalizar) todas as OPs vinculadas (exceto as já canceladas)
      if (status === 'Faturado') {
        const { data: linkedOps, error: faturadoLinkedErr } = await supabase
          .from('orders')
          .select('id, status')
          .eq('sale_order_id', id)
          .neq('status', 'Cancelada');
        if (faturadoLinkedErr) throw new Error(`Falha ao carregar OPs vinculadas para faturamento: ${faturadoLinkedErr.message}`);

        if (linkedOps && linkedOps.length > 0) {
          // Warn when OPs that never went through Kanban are being force-finalized.
          const reservadoOps = linkedOps.filter(op => op.status === 'Reservado');
          if (reservadoOps.length > 0) {
            toast.warning(
              `${reservadoOps.length} OP(s) ainda em Reservado serão finalizadas automaticamente. ` +
              'Verifique se a produção já foi concluída antes de faturar.',
              { duration: 8000 },
            );
            // [1] Convert soft reservations to hard debits for Reservado OPs being
            // force-finalized. Without this, reserved_stock stays permanently inflated
            // for materials that were only soft-reserved (never converted by Kanban entry).
            for (const op of reservadoOps) {
              const { error: convErr } = await (supabase as any).rpc('convert_reservation_to_out', { p_order_id: op.id });
              if (convErr) console.warn(`convert_reservation_to_out failed for OP ${op.id}:`, convErr.message);
            }
          }

          const opIds = linkedOps.map(op => op.id);

          const { error: opsError } = await supabase
            .from('orders')
            .update({ status: 'Finalizado' })
            .in('id', opIds);
          if (opsError) throw opsError;

          // Use complete_order_stages_bulk (Grupo 21) so quantity_processed is set
          // to quantity_total — plain UPDATE misses this, breaking CapacityPlanning
          // and OrderStagesPipeline ("0/N concluído" for Faturado orders).
          const { data: openStages } = await supabase
            .from('order_stages')
            .select('order_id, stage_name')
            .in('order_id', opIds)
            .in('status', ['pendente', 'em_andamento']);
          if (openStages && openStages.length > 0) {
            const byOrder = new Map<string, string[]>();
            for (const s of openStages) {
              if (!byOrder.has(s.order_id)) byOrder.set(s.order_id, []);
              byOrder.get(s.order_id)!.push(s.stage_name);
            }
            for (const [opId, stageNames] of byOrder) {
              const { error: bulkErr } = await (supabase as any).rpc('complete_order_stages_bulk', {
                p_order_id: opId,
                p_stage_names: stageNames,
              });
              if (bulkErr) {
                console.error(`complete_order_stages_bulk failed for OP ${opId}:`, bulkErr.message);
                toast.warning(`OP ${opId.slice(0, 8)} finalizada mas etapas não atualizadas — execute resync manual.`);
              }
            }
          }
        }
      }

      // Onda de produção individual: cria e inicia onda quando PV vai para Em Produção
      if (status === 'Em Produção') {
        const { error: waveErr } = await (supabase as any).rpc('create_solo_wave', { p_sale_order_id: id });
        if (waveErr) {
          console.error('Onda de produção não criada:', waveErr.message);
          toast.warning(
            `Onda de produção não criada automaticamente — crie manualmente em Ondas. Erro: ${waveErr.message}`,
            { duration: 8000 },
          );
        }
      }

      // Auto-sync financial records
      await syncFinancialRecords(id);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      if (vars.status === 'Em Produção') {
        qc.invalidateQueries({ queryKey: ['waves'] });
        qc.invalidateQueries({ queryKey: ['sector-board'] });
      }
      const msg = vars.status === 'Aprovado'
        ? 'Pedido aprovado — OPs criadas e estoque processado!'
        : vars.status === 'Em Produção'
          ? 'Pedido em produção — onda de setores iniciada!'
          : vars.status === 'Faturado'
            ? 'Pedido faturado e OPs finalizadas!'
            : 'Status atualizado!';
      toast.success(msg);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, order, items, client_id, representative_id, commission_value, packaging_product_id, packaging_quantity }: { id: string; order: SaleOrderFormData; items: SaleOrderItemFormData[]; client_id?: string | null; representative_id?: string | null; commission_value?: number; packaging_product_id?: string | null; packaging_quantity?: number }) => {
      const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      const updateData: any = { ...order, total };
      if (client_id !== undefined) updateData.client_id = client_id || null;
      if (!updateData.delivery_deadline) updateData.delivery_deadline = null;
      if (representative_id) updateData.representative_id = representative_id; else updateData.representative_id = null;
      if (commission_value !== undefined) updateData.commission_value = commission_value;
      if (packaging_product_id !== undefined) updateData.packaging_product_id = packaging_product_id || null;
      if (packaging_quantity !== undefined) updateData.packaging_quantity = packaging_quantity;

      // Sanitize: replace empty strings with null for all UUID-type fields
      const uuidFields = ['client_id', 'representative_id', 'factoring_config_id', 'packaging_product_id', 'economic_group_id'];
      for (const f of uuidFields) {
        if (updateData[f] === '') updateData[f] = null;
      }

      // 0a. Bloqueia edição se alguma OP vinculada estiver em produção avançada.
      // Editar PV deleta+recria OPs — se já houve corte/costura, a edição
      // descarta material e mão-de-obra. Force o usuário a cancelar/clonar.
      const PRODUCTION_ADVANCED_STATUSES = ['Em Produção', 'Concluída', 'Finalizado'];
      const { data: opsInProduction, error: opsInProductionErr } = await supabase
        .from('orders')
        .select('id, status, order_number')
        .eq('sale_order_id', id)
        .in('status', PRODUCTION_ADVANCED_STATUSES);
      if (opsInProductionErr) throw new Error(`Falha ao verificar OPs em produção: ${opsInProductionErr.message}`);
      if (opsInProduction && opsInProduction.length > 0) {
        const opNumbers = opsInProduction.map(op => op.order_number || op.id.substring(0, 8)).join(', ');
        throw new Error(`Não é possível editar: existem OPs em produção (${opNumbers}). Cancele as OPs ou crie um novo PV.`);
      }

      // 0b. Fiscal guard: a PV with authorized/processing NF-e cannot be edited
      // either — the NF-e was issued for the EXACT items present at emission
      // time. Editing items now would diverge the SEFAZ record from the
      // physical order. Force user to cancel NF-e first or clone the PV.
      const { data: blockingNfe, error: blockingNfeEditErr } = await supabase
        .from('nfe_emitidas')
        .select('id, status, ref_nfe')
        .eq('sale_order_id', id)
        .in('status', ['autorizada', 'processando', 'cancelando']);
      if (blockingNfeEditErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeEditErr.message}`);
      if (blockingNfe && blockingNfe.length > 0) {
        const refs = blockingNfe.map(n => n.ref_nfe || n.id).join(', ');
        throw new Error(
          `Não é possível editar: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
          `Cancele a NF-e antes ou crie um novo PV.`,
        );
      }

      // 1. Fetch existing OPs BEFORE the atomic update so we can tear them down after.
      const { data: existingOPs, error: existingOpsError } = await supabase
        .from('orders')
        .select('id, reference_id, quantity, status')
        .eq('sale_order_id', id);
      if (existingOpsError) throw existingOpsError;

      const existingOpIds = (existingOPs || []).map(op => op.id);

      // Guard against saving an order with no items — the RPC would DELETE all
      // existing items and leave an empty order with total=0, silently zeroing AR.
      if (!items || items.length === 0) {
        throw new Error('Não é possível salvar um pedido sem itens.');
      }

      // 2. Tear down existing OPs BEFORE the atomic items replace.
      //    If we did the reverse (items first, then teardown), a teardown failure
      //    would leave old OPs in DB while the PV's items were already replaced —
      //    creating OPs with stale references and no matching sale_order_items.
      //    All OPs at this point are Reservado or earlier (enforced by guard 0a).
      //    Sole grade restoration must precede product restoration — otherwise
      //    conjugated per-size buckets stay depleted (silent stock corruption).
      if (existingOPs && existingOPs.length > 0) {
        for (const op of existingOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets (restore_sole_grade_for_order is NOT idempotent).
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          // release_order_reservations cleans reservation_batches (no FK CASCADE);
          // must run before the stock restores to maintain canonical order.
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }

        const { error: stagesError } = await supabase
          .from('order_stages')
          .delete()
          .in('order_id', existingOpIds);
        if (stagesError) throw stagesError;

        const { error: consumptionsError } = await supabase
          .from('production_consumptions')
          .delete()
          .in('order_id', existingOpIds);
        if (consumptionsError) throw consumptionsError;

        const { error: detachMovementsError } = await supabase
          .from('stock_movements')
          .update({ order_id: null })
          .in('order_id', existingOpIds);
        if (detachMovementsError) throw detachMovementsError;

        const { error: deleteOpsError } = await supabase
          .from('orders')
          .delete()
          .in('id', existingOpIds);
        if (deleteOpsError) throw deleteOpsError;
      }

      // 3. Atomic header + items replace — single SQL transaction with SELECT FOR UPDATE.
      // OPs are already gone so the replace cannot leave orphaned OP→item references.
      const itemsPayload = items.map(i => ({
        reference_id: i.reference_id || null,
        color: i.color ?? '',
        quantity: i.quantity ?? 0,
        unit_price: i.unit_price ?? 0,
        grade: i.grade ?? {},
        fichas: i.fichas ?? 1,
        observation: i.observation ?? null,
        material_variant_id: (i as any).material_variant_id ?? null,
      }));
      // Strip status from p_header: status transitions must go through
      // useUpdateSaleOrderStatus which enforces the state machine. Including
      // status here would let the edit form bypass all status-change guards.
      const { status: _discardedStatus, ...headerForRpc } = updateData as any;
      const { data: rpcOut, error: rpcErr } = await (supabase as any).rpc('update_sale_order_atomic', {
        p_order_id: id,
        p_header: headerForRpc,
        p_items: itemsPayload,
      });
      if (rpcErr) throw rpcErr;
      const insertedIds: string[] = ((rpcOut as any)?.inserted_item_ids as string[] | undefined) || [];
      // Re-hydrate the same shape the older code returned so downstream MRP loop matches by index.
      const insertedItems: { id: string; reference_id: string; color: string | null; quantity: number | null }[] =
        insertedIds.map((newId, idx) => ({
          id: newId,
          reference_id: items[idx]?.reference_id || '',
          color: items[idx]?.color ?? null,
          quantity: items[idx]?.quantity ?? null,
        }));

      // 4. Recreate OPs if status is Aprovado or Em Produção (regardless of whether OPs existed before)
      if (order.status === 'Aprovado' || order.status === 'Em Produção') {
        // Fetch billing_week, packaging_mode AND canonical status from the DB.
        // Using order.status (form state) for opStatus would allow the form to inject
        // a different status (e.g. Em Produção) while the DB is still at Aprovado.
        const { data: soMrpData } = await supabase
          .from('sale_orders')
          .select('billing_week, packaging_mode, status')
          .eq('id', id)
          .single();
        const billingWeekStr: string | null = (soMrpData as any)?.billing_week || (updateData as any)?.billing_week || null;
        const pkgModeUpd: string = (soMrpData as any)?.packaging_mode || (updateData as any)?.packaging_mode || 'individual_amarrado';
        // [5] Use canonical DB status so form-supplied status can't bypass state machine.
        const canonicalStatus: string = (soMrpData as any)?.status || order.status;
        let mrpPoCount = 0;

        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          if (!item.reference_id) continue;

          // Match to the inserted item by index to get the DB id
          const matchedItem = insertedItems[idx];

          // Scale grade by fichas to get actual quantities per size
          const fichas = item.fichas || 1;
          const scaledGrade: Record<string, number> = {};
          if (item.grade) {
            for (const [size, qty] of Object.entries(item.grade)) {
              const val = (Number(qty) || 0) * fichas;
              if (val > 0) scaledGrade[size] = val;
            }
          }

          const opStatus = canonicalStatus === 'Em Produção' ? 'Em Produção' : 'Reservado';
          const { data: newOp, error: opError } = await supabase.from('orders').insert({
            reference_id: item.reference_id,
            quantity: item.quantity,
            color: item.color || '',
            grade: scaledGrade,
            sale_order_id: id,
            sale_order_item_id: matchedItem?.id || null,
            notes: 'Atualizada automaticamente do PV',
            status: opStatus,
            item_observation: item.observation || null,
          }).select().single();

          if (opError) {
            console.error('Erro ao recriar OP:', opError.message);
            continue;
          }

          // MRP: call try_reserve_materials BEFORE hard debit so it sees pre-debit stock
          // and can generate POs for any shortfall. Track which POs were created
          // so we can release reservations and surface a clear failure if the
          // hard debit later refuses to commit.
          let mrpReservedForOp = false;
          if (newOp?.id && item.reference_id) {
            let productionDate: string | null = null;
            if (billingWeekStr) {
              const monday = parseBillingWeekToMonday(billingWeekStr);
              if (monday) {
                // Materials needed ~14 days before billing week (rough production window)
                const prodStart = new Date(monday.getTime() - 14 * 86400000);
                productionDate = prodStart.toISOString().split('T')[0];
              }
            }
            const totalOrderQty = Object.keys(scaledGrade).length > 0
              ? Object.values(scaledGrade).reduce((s, v) => s + Number(v), 0)
              : item.quantity;
            const { data: mrpResult, error: mrpErr } = await (supabase as any).rpc('try_reserve_materials', {
              p_order_id: newOp.id,
              p_reference_id: item.reference_id,
              p_order_quantity: totalOrderQty,
              p_color: item.color || '',
              p_production_date: productionDate,
              p_permit_partial: true,
              p_consider_safety_stock: true,
              p_priority: billingWeekStr ? 'rush' : 'normal',
              p_allow_expedite: false,
              p_consolidate_po: true,
            });
            if (mrpErr) {
              console.error('MRP reservation failed for OP', newOp.id, mrpErr);
              await (supabase as any).rpc('release_order_reservations', { p_order_id: newOp.id }).catch(() => {});
              toast.warning(
                `MRP não pôde reservar materiais para OP ${(newOp as any).order_number || newOp.id.slice(0, 8)}: ` +
                `${mrpErr.message ?? 'erro'}. Verifique o MRP.`,
              );
            } else {
              if (mrpResult?.purchase_orders?.length > 0) {
                mrpPoCount += (mrpResult.purchase_orders as any[]).length;
              }
              mrpReservedForOp = true;
            }
          }

          // Debit stock for new OP. If this fails after MRP already reserved
          // materials and possibly created consolidated POs, release the
          // reservation so the OP doesn't stay "half-reserved" forever, and
          // surface the error to the user instead of silently continuing.
          const { error: debitError } = await supabase.rpc('hybrid_debit_stock_for_order', {
            p_reference_id: item.reference_id,
            p_order_quantity: item.quantity,
            p_color: item.color || '',
            p_order_id: newOp?.id || null,
            p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : null,
          } as any);
          if (debitError) {
            if (mrpReservedForOp && newOp?.id) {
              await (supabase as any).rpc('release_order_reservations', { p_order_id: newOp.id }).catch(() => {});
            }
            throw new Error(`Falha ao debitar estoque para OP ${newOp?.id?.slice(0, 8) ?? '?'}: ${debitError.message}`);
          }

          // Debit sole stock by grade (per size)
          if (scaledGrade && Object.keys(scaledGrade).length > 0 && newOp?.id) {
            const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
              p_reference_id: item.reference_id,
              p_order_id: newOp.id,
              p_color: item.color || '',
              p_order_grade: scaledGrade,
            } as any);
            if (soleError) {
              console.error('Erro ao debitar solado:', soleError.message);
              // Await so two concurrent items targeting the same supplier serialise
              // through autoCreateSolePO's accumulation logic (was fire-and-forget).
              try {
                const po = await autoCreateSolePO({
                  referenceId: item.reference_id,
                  orderId: newOp.id,
                  color: item.color || '',
                  grade: scaledGrade,
                  orderRef: `PV ${String(id).slice(0, 8)}`,
                });
                if (po) toast.warning(`Solado insuficiente — OC ${po.poNumber} criada automaticamente (${po.supplierName}).`, { duration: 8000 });
              } catch (poErr) {
                console.error('Falha ao criar OC automática de solado:', poErr);
              }
            }
          }

          // Debit strap materials
          if (item.strap_colors && item.strap_colors.length > 0) {
            const { error: strapError } = await supabase.rpc('debit_strap_stock', {
              p_strap_colors: item.strap_colors,
              p_order_quantity: item.quantity,
              p_order_id: newOp?.id || null,
              p_order_grade: item.grade || null,
            } as any);
            if (strapError) {
              console.error('Erro ao debitar tiras:', strapError.message);
              toast.error(`Tiras — OP criada mas debito falhou: ${strapError.message}`);
            }
          }

          // BOM stock out (consumables per technical sheet) — mirrors Aprovado branch
          if (newOp?.id) {
            const { error: bomErr } = await supabase.rpc('process_order_stock_out', {
              p_order_id: newOp.id,
              p_product_id: item.reference_id,
              p_quantity: item.quantity,
            } as any);
            if (bomErr) console.error('Erro ao processar BOM stock out (update PV):', bomErr.message);
          }

          // Packaging debit — mirrors Aprovado branch; packaging_mode hoisted above loop
          if (newOp?.id) {
            const { error: pkgUpdErr } = await (supabase as any).rpc('debit_packaging_for_order', {
              p_sale_order_id: id,
              p_order_id: newOp.id,
              p_reference_id: item.reference_id,
              p_order_quantity: item.quantity,
              p_packaging_mode: pkgModeUpd,
            });
            if (pkgUpdErr) console.error('Erro ao debitar embalagem (update PV):', pkgUpdErr.message);
          }

          // Create production stages from technical sheet sectors
          if (newOp) {
            const DEFAULT_STAGES = DEFAULT_OP_STAGES;
            const { data: sheetData } = await supabase
              .from('technical_sheets')
              .select('production_sectors')
              .eq('id', item.reference_id)
              .single();
            const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
              ? sheetData.production_sectors.map((x: any) => String(x))
              : DEFAULT_STAGES.map(s => s.name);
            const stages = sectorNames.map((name: string, idx: number) => {
              const ds = DEFAULT_STAGES.find(s => s.name === name);
              return {
                order_id: newOp.id,
                stage_name: name,
                stage_order: ds?.order || idx + 1,
                status: 'pendente',
                quantity_total: item.quantity,
                quantity_processed: 0,
                observations: '',
                defects: '',
              };
            });
            const { error: stgInsErr2 } = await supabase.from('order_stages').insert(stages);
            if (stgInsErr2) {
              // Falha ao criar etapas no fluxo de update do PV: a OP recém-criada
              // já teve débitos processados acima. Restaura e cancela esta OP,
              // continua com os demais itens.
              console.error('Erro ao criar etapas (update PV):', stgInsErr2.message);
              await (supabase.rpc as any)('release_order_reservations', { p_order_id: newOp.id });
              await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: newOp.id });
              await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: newOp.id });
              await supabase.from('orders').update({
                status: 'Cancelada',
                notes: `Cancelada — falha ao criar etapas: ${stgInsErr2.message}`,
              }).eq('id', newOp.id);
              toast.error(`OP ${newOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr2.message}`, { duration: 10000 });
              continue;
            }
          }
        }

        // Auto-generate purchase orders for materials below min_stock
        const { data: soForPO } = await supabase.from('sale_orders').select('order_number, client_order_number').eq('id', id).single();
        await generateAutoPurchaseOrders(
          soForPO?.order_number || id,
          soForPO?.order_number || undefined,
          soForPO?.client_order_number || order.client_order_number || undefined
        );

        // Show consolidated MRP notification if POs were generated
        if (mrpPoCount > 0) {
          toast.info(
            `MRP: ${mrpPoCount} OC(s) gerada(s) automaticamente — material insuficiente detectado.`,
            { duration: 7000 }
          );
        }
      }

      // Auto-sync financial records after edit
      await syncFinancialRecords(id);

      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      // Cost snapshot may be stale: items, prices or grades may have changed and
      // calculate_order_cost wasn't re-invoked during the mutation. Invalidate
      // both order-cost (per-PV detail) and profitability (aggregated view) so
      // the next read recomputes against the new items.
      qc.invalidateQueries({ queryKey: ['order-cost'] });
      qc.invalidateQueries({ queryKey: ['profitability'] });
      toast.success('Pedido atualizado e OPs sincronizadas!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Resync all active OPs from their technical sheets.
 * Reverses stock, deletes stages, recreates OPs with updated BOM and production sectors.
 */
export function useResyncOPsFromSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Get all active sale orders with OPs
      const { data: activeOrders, error: soErr } = await supabase
        .from('sale_orders')
        .select('id, status')
        .in('status', ['Aprovado', 'Em Produção']);
      if (soErr) throw soErr;
      if (!activeOrders || activeOrders.length === 0) throw new Error('Nenhum pedido ativo encontrado');

      let totalResyncedOPs = 0;
      const errors: string[] = [];

      for (const so of activeOrders) {
        try {
          // Get existing OPs for this sale order
          const { data: existingOPs } = await supabase
            .from('orders')
            .select('id, reference_id, quantity, status, color, grade, sale_order_id')
            .eq('sale_order_id', so.id)
            .in('status', ['Reservado', 'Em Produção']);
          
          if (!existingOPs || existingOPs.length === 0) continue;

          // Get sale_order_items to recover strap_colors
          const { data: soItems } = await supabase
            .from('sale_order_items')
            .select('*')
            .eq('sale_order_id', so.id);

          for (const op of existingOPs) {
            try {
              const opStatus = op.status;

              // 1. Reverse stock atomically via RPC (canonical order: reservations → sole → products).
              //    release_order_reservations MUST run first to avoid orphaning reservation_batches.
              const { error: relRestErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
              if (relRestErr && !/does not exist|not found/i.test(relRestErr.message)) {
                throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relRestErr.message}`);
              }
              //    Restore conjugated sole buckets before product stocks — see useUpdateSaleOrder for rationale.
              const { error: soleRestErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
              if (soleRestErr && !/does not exist|not found/i.test(soleRestErr.message)) {
                throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleRestErr.message}`);
              }
              const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
              if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);

              // 2. Delete old stages
              await supabase.from('order_stages').delete().eq('order_id', op.id);

              // 3. Delete old reservations
              await supabase.from('material_reservations').delete().eq('order_id', op.id);

              // 4. Delete old production consumptions
              await supabase.from('production_consumptions').delete().eq('order_id', op.id);

              // 5. Detach old stock movements
              await supabase.from('stock_movements').update({ order_id: null }).eq('order_id', op.id);

              // 6. Re-debit stock with current technical sheet
              const opGrade = (op.grade as Record<string, number>) || {};
              const { error: debitError } = await supabase.rpc('hybrid_debit_stock_for_order', {
                p_reference_id: op.reference_id,
                p_order_quantity: op.quantity,
                p_color: op.color || '',
                p_order_id: op.id,
                p_order_grade: Object.keys(opGrade).length > 0 ? opGrade : null,
              } as any);
              if (debitError) {
                console.error('Erro ao re-debitar estoque OP:', op.id, debitError.message);
              }

              // 7. Re-debit sole stock by grade
              const grade = (op.grade as Record<string, number>) || {};
              if (Object.keys(grade).length > 0) {
                const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
                  p_reference_id: op.reference_id,
                  p_order_id: op.id,
                  p_color: op.color || '',
                  p_order_grade: grade,
                } as any);
                if (soleError) {
                  console.error('Erro ao re-debitar solado:', op.id, soleError.message);
                  try {
                    const po = await autoCreateSolePO({
                      referenceId: op.reference_id,
                      orderId: op.id,
                      color: op.color || '',
                      grade,
                      orderRef: (op as any).order_number || String(op.id).slice(0, 8),
                    });
                    if (po) toast.warning(`Solado insuficiente — OC ${po.poNumber} criada automaticamente (${po.supplierName}).`, { duration: 8000 });
                  } catch (poErr) {
                    console.error('Falha ao criar OC automática de solado:', poErr);
                  }
                }
              }

              // 8. Re-debit strap materials
              const matchingItem = soItems?.find(i => i.reference_id === op.reference_id && i.color === op.color);
              if (matchingItem?.strap_colors && Array.isArray(matchingItem.strap_colors) && (matchingItem.strap_colors as any[]).length > 0) {
                const { error: strapError } = await supabase.rpc('debit_strap_stock', {
                  p_strap_colors: matchingItem.strap_colors,
                  p_order_quantity: op.quantity,
                  p_order_id: op.id,
                  p_order_grade: (matchingItem as any).grade || (op as any).grade || null,
                } as any);
                if (strapError) {
                  console.error('Erro ao re-debitar tiras:', op.id, strapError.message);
                  toast.error(`Tiras — re-débito OP ${(op as any).order_number || op.id}: ${strapError.message}`);
                }
              }

              // 9. Recreate stages from technical sheet
              const DEFAULT_STAGES = DEFAULT_OP_STAGES;
              const { data: sheetData } = await supabase
                .from('technical_sheets')
                .select('production_sectors')
                .eq('id', op.reference_id)
                .single();
              const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                ? sheetData.production_sectors.map((x: any) => String(x))
                : DEFAULT_STAGES.map(s => s.name);
              const rows = sectorNames.map((name: string, idx: number) => {
                const ds = DEFAULT_STAGES.find(s => s.name === name);
                return {
                  order_id: op.id,
                  stage_name: name,
                  stage_order: ds?.order || idx + 1,
                  status: opStatus === 'Em Produção' ? 'pendente' : 'pendente',
                  quantity_total: op.quantity,
                  quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
                  if (stgInsErr) throw new Error(`Falha ao criar etapas da OP: ${stgInsErr.message}`);

              totalResyncedOPs++;
            } catch (opErr: any) {
              errors.push(`OP ${op.id.substring(0, 8)}: ${opErr.message}`);
            }
          }
        } catch (soError: any) {
          errors.push(`PV ${so.id.substring(0, 8)}: ${soError.message}`);
        }
      }

      return { totalResyncedOPs, errors };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      const msg = `${result.totalResyncedOPs} OPs resincronizadas com fichas técnicas atualizadas!`;
      toast.success(msg);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} erro(s) durante resync`, { description: result.errors.slice(0, 3).join('\n') });
      }
    },
    onError: (err: Error) => toast.error(`Erro na resincronização: ${err.message}`),
  });
}

export function useDeleteSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // 0. Fiscal guard: a sale order with an authorized/processing NF-e cannot
      // be deleted — once SEFAZ accepts the NF-e it is permanent and any
      // cancellation must go through the dedicated cancel-nfe flow within 24h.
      // Deleting the sale_order would orphan the NF-e (FK is ON DELETE SET NULL)
      // and break audit trail for tax inspection.
      const { data: blockingNfe, error: blockingNfeDelErr } = await supabase
        .from('nfe_emitidas')
        .select('id, status, ref_nfe')
        .eq('sale_order_id', id)
        .in('status', ['autorizada', 'processando', 'cancelando']);
      if (blockingNfeDelErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeDelErr.message}`);
      if (blockingNfe && blockingNfe.length > 0) {
        const refs = blockingNfe.map(n => n.ref_nfe || n.id).join(', ');
        throw new Error(
          `Não é possível excluir: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
          `Cancele a NF-e antes (até 24h após emissão) ou inutilize a numeração.`,
        );
      }

      // 1. Reverse stock and delete linked OPs FIRST — if stock restore fails, abort
      //    before touching financial records so the retry doesn't find AR already cancelled.
      const { data: linkedOPs, error: linkedOPsErr } = await supabase
        .from('orders')
        .select('id, status')
        .eq('sale_order_id', id);
      if (linkedOPsErr) throw new Error(`Falha ao carregar OPs vinculadas: ${linkedOPsErr.message}`);

      if (linkedOPs && linkedOPs.length > 0) {
        const opIds = linkedOPs.map(op => op.id);

        for (const op of linkedOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets (restore_sole_grade
          // is NOT idempotent: it always credits the OP's grade back).
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          // release_order_reservations cleans reservation_batches (no FK CASCADE).
          // Canonical order: release reservations → sole grade → product stocks.
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }

        // Delete stages, consumptions, reservations
        const { error: stgDelErr } = await supabase.from('order_stages').delete().in('order_id', opIds);
        if (stgDelErr) throw new Error(`Falha ao remover etapas: ${stgDelErr.message}`);
        const { error: cnsDelErr } = await supabase.from('production_consumptions').delete().in('order_id', opIds);
        if (cnsDelErr) throw new Error(`Falha ao remover consumos: ${cnsDelErr.message}`);
        const { error: resDelErr } = await supabase.from('material_reservations').delete().in('order_id', opIds);
        if (resDelErr) throw new Error(`Falha ao remover reservas: ${resDelErr.message}`);

        // Detach stock movements then delete OPs
        const { error: movUpdErr } = await supabase.from('stock_movements').update({ order_id: null }).in('order_id', opIds);
        if (movUpdErr) throw new Error(`Falha ao desvincular movimentos de estoque: ${movUpdErr.message}`);
        const { error: opsDelErr } = await supabase.from('orders').delete().in('id', opIds);
        if (opsDelErr) throw new Error(`Falha ao excluir OPs: ${opsDelErr.message}`);
      }

      // 2. Cancel linked financial records — after stock restore succeeds so a
      //    retry after failure doesn't find AR already cancelled with stock still debited.
      const { error: arCancelErr } = await supabase.from('accounts_receivable').update({ status: 'cancelled' }).eq('sale_order_id', id).neq('status', 'received');
      if (arCancelErr) throw new Error(`Falha ao cancelar contas a receber: ${arCancelErr.message}`);
      // Refuse to delete a PV whose revenue is already booked (SPED audit trail).
      // cancel-nfe already guards the same invariant; this closes the direct-delete path.
      const { count: bookedFeCount, error: bookedFeErr } = await supabase
        .from('financial_entries')
        .select('id', { count: 'exact', head: true })
        .eq('reference_id', id)
        .eq('reference_type', 'sale_order')
        .in('status', ['posted', 'paid', 'reconciled', 'confirmed']);
      if (bookedFeErr) throw new Error(`Falha ao verificar lançamentos financeiros: ${bookedFeErr.message}`);
      if ((bookedFeCount ?? 0) > 0) {
        throw new Error('PV tem lançamentos financeiros já confirmados — cancele a NF-e e o PV em vez de excluir.');
      }
      const { error: feDelErr } = await supabase.from('financial_entries').delete()
        .eq('reference_id', id).eq('reference_type', 'sale_order')
        .not('status', 'in', '(posted,paid,reconciled,confirmed)');
      if (feDelErr) throw new Error(`Falha ao remover lançamentos financeiros: ${feDelErr.message}`);

      // 3. Delete MRP suggestions and sale order items then the sale order
      const { error: mrpDelErr } = await supabase.from('mrp_suggestions').delete().eq('sale_order_id', id);
      if (mrpDelErr) throw new Error(`Falha ao remover sugestões MRP: ${mrpDelErr.message}`);
      const { error: soiDelErr } = await supabase.from('sale_order_items').delete().eq('sale_order_id', id);
      if (soiDelErr) throw new Error(`Falha ao remover itens do pedido: ${soiDelErr.message}`);
      const { error } = await supabase.from('sale_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success('Pedido e OPs vinculadas excluídos com estorno de estoque!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// resyncOPsForSheet moved to src/lib/resyncOPs.ts
export { resyncOPsForSheet } from '@/lib/resyncOPs';

/**
 * Resync OPs for a single sale order from its current items.
 * Reverses stock, deletes old OPs, recreates from sale_order_items.
 */
export function useResyncOPsFromPV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderId: string) => {
      const { data: so, error: soErr } = await supabase
        .from('sale_orders')
        .select('id, status, packaging_mode')
        .eq('id', saleOrderId)
        .single();
      if (soErr || !so) throw new Error('Pedido não encontrado');
      if (so.status !== 'Aprovado' && so.status !== 'Em Produção') {
        throw new Error('Só é possível resincronizar pedidos Aprovados ou Em Produção');
      }

      // 1. Get current PV items
      const { data: pvItems, error: itemsErr } = await supabase
        .from('sale_order_items')
        .select('*')
        .eq('sale_order_id', saleOrderId);
      if (itemsErr) throw itemsErr;
      if (!pvItems || pvItems.length === 0) throw new Error('Pedido sem itens');

      // 2. Get existing OPs
      const { data: existingOPs } = await supabase
        .from('orders')
        .select('id, reference_id, quantity, status')
        .eq('sale_order_id', saleOrderId);
      const existingOpIds = (existingOPs || []).map(op => op.id);

      // 3. Reverse stock atomically via RPC, then delete old OPs.
      //    Canonical order: release_order_reservations → sole grade → product stocks.
      if (existingOPs && existingOPs.length > 0) {
        for (const op of existingOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets.
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }
        await supabase.from('order_stages').delete().in('order_id', existingOpIds);
        await supabase.from('production_consumptions').delete().in('order_id', existingOpIds);
        await supabase.from('material_reservations').delete().in('order_id', existingOpIds);
        await supabase.from('stock_movements').update({ order_id: null }).in('order_id', existingOpIds);
        await supabase.from('orders').delete().in('id', existingOpIds);
      }

      // 4. Recreate OPs from PV items
      const opStatus = so.status === 'Em Produção' ? 'Em Produção' : 'Reservado';
      let created = 0;
      const DEFAULT_STAGES = DEFAULT_OP_STAGES;

      for (const item of pvItems) {
        if (!item.reference_id) continue;
        const fichas = (item as any).fichas || 1;
        const grade = item.grade as Record<string, number> | null;
        const scaledGrade: Record<string, number> = {};
        if (grade) {
          for (const [size, qty] of Object.entries(grade)) {
            const val = (Number(qty) || 0) * fichas;
            if (val > 0) scaledGrade[size] = val;
          }
        }

        const { data: newOp, error: opError } = await supabase.from('orders').insert({
          reference_id: item.reference_id,
          quantity: item.quantity,
          color: item.color || '',
          grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
          sale_order_id: saleOrderId,
          sale_order_item_id: item.id,
          notes: 'Resincronizada do PV',
          status: opStatus,
          item_observation: (item as any).observation || null,
        }).select().single();
        if (opError || !newOp) continue;

        const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
          p_reference_id: item.reference_id,
          p_order_quantity: item.quantity,
          p_color: item.color || '',
          p_order_id: newOp.id,
          p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : null,
        } as any);
        if (debitErr) {
          const opNum = (newOp as any).order_number || newOp.id;
          console.error(`Erro ao debitar estoque (resync) OP ${opNum}:`, debitErr.message);
          toast.error(`Estoque — OP ${opNum}: ${debitErr.message}`);
        }

        if (Object.keys(scaledGrade).length > 0) {
          const { error: soleDebitErr } = await supabase.rpc('debit_sole_stock_by_grade', {
            p_reference_id: item.reference_id,
            p_order_id: newOp.id,
            p_color: item.color || '',
            p_order_grade: scaledGrade,
          } as any);
          if (soleDebitErr) {
            const opNum = (newOp as any).order_number || newOp.id;
            console.error(`Erro ao debitar solado (resync) OP ${opNum}:`, soleDebitErr.message);
            toast.error(`Solado — OP ${opNum}: ${soleDebitErr.message}`);
            // Mirror useUpdateSaleOrder: attempt auto-PO so sole shortage is covered.
            try {
              const po = await autoCreateSolePO({
                referenceId: item.reference_id,
                orderId: newOp.id,
                color: item.color || '',
                grade: scaledGrade,
                orderRef: (newOp as any).order_number || newOp.id,
              });
              if (po) toast.info(`OC de solado ${po.accumulated ? 'acumulada' : 'criada'}: ${po.poNumber} (${po.supplierName})`);
            } catch (poErr: any) {
              console.error('Erro ao criar OC de solado (resync):', poErr?.message);
            }
          }
        }

        if ((item as any).strap_colors && Array.isArray((item as any).strap_colors) && (item as any).strap_colors.length > 0) {
          const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
            p_strap_colors: (item as any).strap_colors,
            p_order_quantity: item.quantity,
            p_order_id: newOp.id,
            p_order_grade: grade || null,
          } as any);
          if (strapErr) {
            console.error('Erro ao debitar tiras (resync):', strapErr.message);
            toast.error(`Tiras — OP ${(newOp as any).order_number || ''}: ${strapErr.message}`);
          }
        }

        // Debit packaging — mirrors Em Produção and Aprovado branches
        const { error: pkgErr } = await (supabase as any).rpc('debit_packaging_for_order', {
          p_sale_order_id: saleOrderId,
          p_order_id: newOp.id,
          p_reference_id: item.reference_id,
          p_order_quantity: item.quantity,
          p_packaging_mode: so.packaging_mode || 'individual_amarrado',
        });
        if (pkgErr) console.error('Erro embalagem (resync):', pkgErr.message);

        const { data: sheetData } = await supabase
          .from('technical_sheets')
          .select('production_sectors')
          .eq('id', item.reference_id)
          .single();
        const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
          ? sheetData.production_sectors.map((x: any) => String(x))
          : DEFAULT_STAGES.map(s => s.name);
        const rows = sectorNames.map((name: string, idx: number) => {
          const ds = DEFAULT_STAGES.find(s => s.name === name);
          return {
            order_id: newOp.id, stage_name: name,
            stage_order: ds?.order || idx + 1, status: 'pendente',
            quantity_total: item.quantity, quantity_processed: 0,
          };
        });
        const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
        if (stgInsErr) {
          // Falha ao criar etapas no resync: cleanup e continua com os
          // demais itens em vez de abortar todo o resync.
          console.error('Erro ao criar etapas (resync):', stgInsErr.message);
          await (supabase.rpc as any)('release_order_reservations', { p_order_id: newOp.id });
          await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: newOp.id });
          await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: newOp.id });
          await supabase.from('orders').update({
            status: 'Cancelada',
            notes: `Cancelada — falha ao criar etapas (resync): ${stgInsErr.message}`,
          }).eq('id', newOp.id);
          toast.error(`OP ${newOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
          continue;
        }
        created++;
      }

      return { created, deleted: existingOpIds.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success(`OPs resincronizadas! ${result.deleted} removida(s), ${result.created} recriada(s).`);
    },
    onError: (err: Error) => toast.error(`Erro ao resincronizar: ${err.message}`),
  });
}

export function useBulkSyncFinancial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: orders, error } = await supabase
        .from('sale_orders')
        .select('id')
        .in('status', ['Aprovado', 'Em Produção', 'Faturado']);
      if (error) throw error;
      if (!orders) return 0;
      for (const o of orders) {
        await syncFinancialRecords(o.id);
      }
      return orders.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      toast.success(`Sincronização financeira concluída para ${count} pedidos!`);
    },
    onError: (err: Error) => toast.error(`Erro na sincronização: ${err.message}`),
  });
}
