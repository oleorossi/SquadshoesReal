import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';

type CreateOrderData = {
  reference_id: string;
  quantity: number;
  notes: string;
  color?: string;
  planned_start?: string;
  planned_delivery?: string;
  production_line?: string;
  responsible?: string;
  status_override?: string;
  packaging_type?: string;
  packaging_product_id?: string;
  packaging_quantity?: number;
  grade?: Record<string, number>;
};

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, technical_sheets(name, code, image_url, reference_color_variants(color, image_url))')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      if (data && data.length === 1000 && import.meta.env.DEV) console.warn('useOrders: hit 1000-row ceiling — some orders may be missing');
      return data;
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useCheckStockAvailability() {
  return async (
    referenceId: string,
    quantity: number,
    color?: string,
    grade?: Record<string, number> | null,
    strapColors?: any[] | null,
  ) => {
    // strapColors vem de sale_order_items (com cor real escolhida pelo cliente),
    // não da ficha (que tem template sem cor). Sem isso a RPC não conseguia
    // detectar shortage de tiras → MaterialPurchaseConfirmDialog não abria pra
    // tiras → OS pra terceiro nunca era criada automaticamente.
    // Bug histórico até 2026-05-17.
    const { data, error } = await supabase.rpc('check_stock_availability', {
      p_reference_id: referenceId,
      p_order_quantity: quantity,
      p_color: color || '',
      p_order_grade: grade ?? null,
      p_strap_colors: strapColors ?? null,
    } as any);
    if (error) throw error;
    return data as Array<{
      product_id: string;
      product_name: string;
      required: number;
      available: number;
      sufficient: boolean;
    }>;
  };
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: CreateOrderData) => {
      if (!Number.isFinite(form.quantity) || form.quantity <= 0) throw new Error('Quantidade deve ser um número positivo.');
      const status = form.status_override || 'Reservado';
      const shouldDebit = status === 'Reservado';

      const { data, error } = await supabase
        .from('orders')
        .insert(sanitizeUuidFields({
          reference_id: form.reference_id,
          quantity: form.quantity,
          notes: form.notes,
          status,
          color: form.color || '',
          grade: form.grade || null,
          planned_start: form.planned_start || null,
          planned_delivery: form.planned_delivery || null,
          production_line: form.production_line || '',
          responsible: form.responsible || '',
          packaging_type: form.packaging_type || '',
          packaging_product_id: form.packaging_product_id || null,
          packaging_quantity: form.packaging_quantity || 0,
        }) as any)
        .select()
        .single();
      if (error) throw error;

      if (shouldDebit) {
        // Compensating cleanup: if any debit step fails, the OP we just inserted
        // would be orphaned (no stock movements). Delete it to keep DB consistent.
        const cleanupOrphan = async (cause: string): Promise<never> => {
          await supabase.from('orders').delete().eq('id', data.id);
          throw new Error(cause);
        };

        const { error: rpcError } = await supabase.rpc('hybrid_debit_stock_for_order', {
          p_reference_id: form.reference_id,
          p_order_quantity: form.quantity,
          p_color: form.color || '',
          p_order_id: data.id,
          p_order_grade: form.grade && Object.keys(form.grade).length > 0 ? form.grade : null,
          p_force_soft: true,
        } as any);
        if (rpcError) await cleanupOrphan(`Débito de estoque falhou: ${rpcError.message}`);

        // Debit sole stock by grade (per size)
        if (form.grade && Object.keys(form.grade).length > 0) {
          const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
            p_reference_id: form.reference_id,
            p_order_id: data.id,
            p_color: form.color || '',
            p_order_grade: form.grade,
            p_force_soft: true,
          } as any);
          if (soleError) {
            // hybrid debit already committed — restore it before cleanup.
            await supabase.rpc('restore_product_stocks_for_order', { p_order_id: data.id } as any);
            await cleanupOrphan(`Débito de solado falhou: ${soleError.message}`);
          }
        }

        // Debit packaging from stock atomically (RPC locks the product row).
        if (form.packaging_product_id && form.packaging_quantity && form.packaging_quantity > 0) {
          const { error: pkgErr } = await supabase.rpc('debit_packaging_for_order_atomic' as any, {
            p_order_id: data.id,
            p_packaging_product_id: form.packaging_product_id,
            p_quantity: form.packaging_quantity,
            p_packaging_type: form.packaging_type || null,
          });
          if (pkgErr) {
            // Canonical rollback order: release reservations → sole grade → product stocks
            await (supabase.rpc as any)('release_order_reservations', { p_order_id: data.id });
            await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: data.id });
            await supabase.rpc('restore_product_stocks_for_order', { p_order_id: data.id } as any);
            await cleanupOrphan(`Débito de embalagem falhou: ${pkgErr.message}`);
          }
        }
      }

      // Create production stages atomically — only for OPs that will enter
      // production (Reservado). Rascunho OPs are drafts: no stock debited,
      // no Kanban visibility needed. Adding stages to Rascunho would let
      // operators drag them through the Kanban with zero stock movements.
      if (status === 'Rascunho') return data;

      // Create production stages atomically inside the same mutation so a
      // network drop between "OP inserted" and "createStages.mutate" never
      // leaves a stageless OP. Callers no longer need to chain createStages.
      // Ordem canônica pós PR1-PR3: prep paralelo (Palmilha/Forração/Aviamento)
      // → Costura (PR2) → restantes sequenciais. "Mesa" foi renomeado pra "Aviamento".
      const DEFAULT_SECTOR_NAMES = [
        'Corte Palmilha', 'Corte Forração', 'Aviamento', 'Costura', 'Silk',
        'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
      ];
      const { data: sheet } = await supabase
        .from('technical_sheets')
        .select('production_sectors')
        .eq('id', form.reference_id)
        .single();
      const sectorNames = (Array.isArray(sheet?.production_sectors) && sheet.production_sectors.length > 0)
        ? sheet.production_sectors.map(String)
        : DEFAULT_SECTOR_NAMES;
      const stageRows = sectorNames.map((name: string, idx: number) => ({
        order_id: data.id, stage_name: name, stage_order: idx + 1,
        status: 'pendente', quantity_total: form.quantity, quantity_processed: 0,
      }));
      const { error: stagesErr } = await supabase.from('order_stages').insert(stageRows);
      if (stagesErr) {
        // Stage insert failed — run full canonical cleanup so OP never lingers stageless.
        // CRITICAL: cannot swallow restore errors. If a restore fails AND we delete the
        // order, stock is debited with no order to restore against — permanent inventory
        // loss. Track failures and refuse to delete the order if any restore failed,
        // so the operator can investigate manually.
        const restoreFailures: string[] = [];

        const { error: relErr } = await (supabase.rpc as any)('release_order_reservations', { p_order_id: data.id });
        if (relErr && !/does not exist|not found/i.test(relErr.message)) {
          restoreFailures.push(`release_order_reservations: ${relErr.message}`);
        }

        const { error: soleErr } = await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: data.id });
        if (soleErr) restoreFailures.push(`restore_sole_grade_for_order: ${soleErr.message}`);

        const { error: prodErr } = await supabase.rpc('restore_product_stocks_for_order', { p_order_id: data.id } as any);
        if (prodErr) restoreFailures.push(`restore_product_stocks_for_order: ${prodErr.message}`);

        if (restoreFailures.length === 0) {
          await supabase.from('orders').delete().eq('id', data.id);
          throw new Error(`Falha ao criar etapas de produção: ${stagesErr.message}`);
        }

        // Restore failed — leave OP in 'Cancelada' state with notes for manual recovery.
        // Do NOT delete: the order_id is the only handle to retry restoration.
        await supabase.from('orders').update({
          status: 'Cancelada',
          notes: `Falha ao criar etapas (${stagesErr.message}); estorno parcial: ${restoreFailures.join('; ')}. Investigação manual necessária.`,
        }).eq('id', data.id);
        throw new Error(
          `Falha ao criar etapas e estorno parcial falhou — OP ${data.id} marcada como Cancelada para investigação. ` +
          `Etapas: ${stagesErr.message}. Estorno: ${restoreFailures.join('; ')}.`
        );
      }

      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      const msg = vars.status_override === 'Rascunho'
        ? 'OP salva como rascunho (sem baixa de estoque)'
        : 'OP criada e estoque debitado!';
      toast.success(msg);
    },
    onError: (err: Error) => toast.error(`Erro ao lançar OP: ${err.message}`),
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Always fetch current status — needed for both the downgrade guard and
      // the stock-restore logic when cancelling.
      // CRITICAL: capture the error. A silent SELECT failure (RLS / network) made
      // currentStatus default to '', which let the downgrade-guard skip and ran
      // 'Cancelada' restore RPCs against a row that may not have had stock debited.
      const { data: current, error: currErr } = await supabase
        .from('orders').select('status, sale_order_id').eq('id', id).single();
      if (currErr) throw new Error(`Falha ao carregar OP: ${currErr.message}`);
      const currentStatus = current?.status ?? '';

      // Block downgrades from in-production states: the OP's material was
      // already debited. Forcing 'Cancelada' triggers the proper stock restore;
      // jumping to 'Rascunho'/'Pendente' would leave inventory permanently depleted.
      const IN_PRODUCTION = ['Em Produção', 'Reservado', 'Concluída', 'Finalizado'];
      const DOWNGRADE_TARGETS = ['Rascunho', 'Pendente'];
      if (IN_PRODUCTION.includes(currentStatus) && DOWNGRADE_TARGETS.includes(status)) {
        throw new Error(
          `Não é possível retornar para "${status}" após "${currentStatus}". Use "Cancelada" para estornar o estoque.`
        );
      }

      if (status === 'Cancelada') {
        // [3] Block cancellation when the parent PV is already billed/shipped/concluded.
        // Restoring stock for a billed PV creates ghost revenue (AR without inventory backing).
        if (current?.sale_order_id) {
          const { data: parentSo, error: parentErr } = await supabase.from('sale_orders').select('status').eq('id', current.sale_order_id).single();
          if (parentErr) throw new Error(`Falha ao verificar PV vinculado: ${parentErr.message}`);
          if (parentSo?.status && ['Faturado', 'Expedido', 'Concluído'].includes(parentSo.status)) {
            throw new Error('OP vinculada a PV faturado — cancele a NF-e e o PV antes de cancelar a OP.');
          }
        }

        // Include 'Finalizado' — OPs can reach Finalizado (all sectors done) before
        // the PV is billed; cancelling them must still reverse their stock movements.
        const HAD_STOCK_STATUSES = ['Reservado', 'Em Produção', 'Concluída', 'Finalizado'];
        const hadStock = currentStatus && HAD_STOCK_STATUSES.includes(currentStatus);

        // Atomic claim BEFORE restore RPCs: prevents double-click / concurrent-tab
        // from running restore_sole_grade_for_order twice (non-idempotent — it would
        // double-credit per-size sole buckets).
        const { data: claimed, error: claimErr } = await supabase
          .from('orders')
          .update({ status: 'Cancelada' })
          .eq('id', id)
          .eq('status', currentStatus)
          .select('id');
        if (claimErr) throw claimErr;
        if (!claimed || claimed.length === 0) {
          throw new Error('Status alterado simultaneamente por outro usuário — recarregue.');
        }

        // Revert the claim if any restore RPC fails so the operator can retry.
        const revertClaim = () =>
          supabase.from('orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelada');

        if (hadStock) {
          const { error: relErr } = await (supabase.rpc as any)('release_order_reservations', { p_order_id: id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            await revertClaim();
            throw new Error(`Falha ao liberar reservas: ${relErr.message}`);
          }

          const { error: soleErr } = await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: id });
          if (soleErr) {
            await revertClaim();
            throw new Error(`Falha ao estornar grade de solado: ${soleErr.message}`);
          }

          const { error: stockErr } = await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: id });
          if (stockErr) {
            await revertClaim();
            throw new Error(`Falha ao estornar estoque: ${stockErr.message}`);
          }
        }
        // Status already set by the atomic claim above — skip the generic update below.
        return;
      }

      const { data: claimed, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', id)
        .eq('status', currentStatus)
        .select('id');
      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        throw new Error('Status alterado simultaneamente por outro usuário — recarregue.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      toast.success('Status da OP atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Cancela em lote todas as OPs em produção avançada de um PV.
 * Usado pelo CancelOpsAndEditDialog quando o usuário confirma "cancelar todas
 * e editar" — libera o guard de useUpdateSaleOrder pra que o save prossiga.
 *
 * Cada OP é processada sequencialmente (não em paralelo) porque os RPCs de
 * estorno tocam tabelas compartilhadas (sole_size_grade buckets, products.stock).
 */
export function useCancelOrdersBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      const errors: Array<{ id: string; message: string }> = [];
      for (const id of orderIds) {
        try {
          const { data: current, error: currErr } = await supabase
            .from('orders').select('status, sale_order_id, order_number').eq('id', id).single();
          if (currErr) throw new Error(`Falha ao carregar OP: ${currErr.message}`);
          const currentStatus = current?.status ?? '';
          if (currentStatus === 'Cancelada') continue;

          const HAD_STOCK_STATUSES = ['Reservado', 'Em Produção', 'Concluída', 'Finalizado'];
          const hadStock = HAD_STOCK_STATUSES.includes(currentStatus);

          // Atomic claim — mesma técnica do useUpdateOrderStatus pra evitar
          // double-restore por concorrência.
          const { data: claimed, error: claimErr } = await supabase
            .from('orders').update({ status: 'Cancelada' })
            .eq('id', id).eq('status', currentStatus).select('id');
          if (claimErr) throw claimErr;
          if (!claimed || claimed.length === 0) {
            throw new Error('Status alterado simultaneamente — recarregue.');
          }

          if (hadStock) {
            const { error: relErr } = await (supabase.rpc as any)('release_order_reservations', { p_order_id: id });
            if (relErr && !/does not exist|not found/i.test(relErr.message)) {
              await supabase.from('orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelada');
              throw new Error(`release_order_reservations: ${relErr.message}`);
            }
            const { error: soleErr } = await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: id });
            if (soleErr) {
              await supabase.from('orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelada');
              throw new Error(`restore_sole_grade_for_order: ${soleErr.message}`);
            }
            const { error: stockErr } = await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: id });
            if (stockErr) {
              await supabase.from('orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelada');
              throw new Error(`restore_product_stocks_for_order: ${stockErr.message}`);
            }
          }
        } catch (e: any) {
          errors.push({ id, message: e?.message || String(e) });
        }
      }
      if (errors.length > 0) {
        throw new Error(
          `Falha ao cancelar ${errors.length}/${orderIds.length} OPs: ` +
          errors.map(e => `${e.id.slice(0, 8)}: ${e.message}`).join(' | '),
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Fetch current OP status to guard against spurious restores.
      // Rascunho and Cancelada OPs never had stock debited — calling restore RPCs
      // on them would inflate sole-grade buckets (restore_sole_grade_for_order is NOT idempotent).
      // CRITICAL: capture the error. A silent SELECT failure made opRow null,
      // which made hadStock=false and skipped the stock estorno entirely on a real OP.
      const { data: opRow, error: opErr } = await supabase.from('orders').select('status, sale_order_id').eq('id', id).single();
      if (opErr) throw new Error(`Falha ao carregar OP: ${opErr.message}`);
      const hadStock = opRow && !['Rascunho', 'Cancelada'].includes(opRow.status);

      // [3] Block deletion when the parent PV is already billed/shipped/concluded.
      if (opRow?.sale_order_id) {
        const { data: parentSo, error: parentErr } = await supabase.from('sale_orders').select('status').eq('id', opRow.sale_order_id).single();
        if (parentErr) throw new Error(`Falha ao verificar PV vinculado: ${parentErr.message}`);
        if (parentSo?.status && ['Faturado', 'Expedido', 'Concluído'].includes(parentSo.status)) {
          throw new Error('OP vinculada a PV faturado — cancele a NF-e e o PV antes de excluir a OP.');
        }
      }

      if (hadStock) {
        // Atomic claim: transition to 'Cancelada' now so a concurrent cancel
        // (useUpdateOrderStatus) or double-click on delete can't also call
        // restore_sole_grade_for_order (NOT idempotent — double-call double-credits
        // per-size sole buckets). The .eq('status', opRow.status) predicate ensures
        // only one thread wins; the loser gets a 0-row result and bails out.
        const { data: claimed, error: claimErr } = await supabase
          .from('orders')
          .update({ status: 'Cancelada' })
          .eq('id', id)
          .eq('status', opRow.status)
          .select('id');
        if (claimErr) throw claimErr;
        if (!claimed || claimed.length === 0) {
          throw new Error('OP foi cancelada por outra operação — recarregue.');
        }

        // Release MRP reservations FIRST: this RPC marks material_reservations
        // as 'cancelled' and DELETES reservation_batches. Skipping it leaves
        // reservation_batches orphaned in DB after the explicit DELETE below.
        // Tolerate "function does not exist" for legacy environments.
        const { error: relErr } = await (supabase.rpc as any)('release_order_reservations', { p_order_id: id });
        if (relErr && !/does not exist|not found/i.test(relErr.message)) {
          throw new Error(`Falha ao liberar reservas da OP: ${relErr.message}`);
        }

        // Restore sole stock_grade per size before reverting quantity movements.
        // CRITICAL: must check errors. If restore fails and we proceed to delete the OP,
        // the stock reversal is permanently lost (no way to know how much was originally debited).
        const { error: soleErr } = await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: id });
        if (soleErr) throw new Error(`Falha ao estornar grade de solado: ${soleErr.message}`);

        const { error: stockErr } = await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: id });
        if (stockErr) throw new Error(`Falha ao estornar estoque: ${stockErr.message}`);
      }

      // Clean up dependencies (order matters: detach movements before deleting OP).
      const { error: stagesErr } = await supabase.from('order_stages').delete().eq('order_id', id);
      if (stagesErr) throw new Error(`Falha ao remover etapas da OP: ${stagesErr.message}`);

      const { error: consErr } = await supabase.from('production_consumptions').delete().eq('order_id', id);
      if (consErr) throw new Error(`Falha ao remover consumos da OP: ${consErr.message}`);

      const { error: resErr } = await supabase.from('material_reservations').delete().eq('order_id', id);
      if (resErr) throw new Error(`Falha ao remover reservas da OP: ${resErr.message}`);

      const { error: detachErr } = await supabase.from('stock_movements').update({ order_id: null }).eq('order_id', id);
      if (detachErr) throw new Error(`Falha ao desvincular movimentos: ${detachErr.message}`);

      const { error } = await supabase.from('orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      toast.success('OP excluída com estorno de estoque!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

 export interface StockMovementWithProduct {
   id: string;
   product_id: string;
   movement_type: string;
   quantity: number;
   previous_stock: number;
   new_stock: number;
   description: string | null;
   created_at: string;
   user_email: string | null;
   order_id: string | null;
  lot_number: string | null;
  responsible: string | null;
   products: {
     name: string;
     sku: string;
     unit: string;
   } | null;
 }
 
export function useStockMovements() {
  return useQuery({
    queryKey: ['stock_movements'],
    queryFn: async () => {
      // FK stock_movements.product_id → products.id NÃO existe no DB, então
      // o embed `products(...)` retorna erro "Could not find a relationship".
      // Fazemos 2 queries: 1) movements, 2) products dos product_ids únicos,
      // e fazemos o merge no client.
      const { data, error } = await supabase
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      const productIds = [...new Set((data || []).map((m: any) => m.product_id).filter(Boolean))];
      const productsMap = new Map<string, { name: string; sku: string; unit: string }>();
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, sku, unit')
          .in('id', productIds);
        (prods || []).forEach((p: any) => productsMap.set(p.id, { name: p.name, sku: p.sku, unit: p.unit }));
      }

      return (data || []).map((m: any) => ({
        id: m.id,
        product_id: m.product_id,
        movement_type: m.movement_type,
        quantity: m.quantity,
        previous_stock: m.previous_stock,
        new_stock: m.new_stock,
        created_at: m.created_at,
        description: m.description || null,
        user_email: m.user_email || null,
        order_id: m.order_id || null,
        lot_number: m.lot_number || null,
        responsible: m.responsible || null,
        products: productsMap.get(m.product_id) || null,
      }));
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
