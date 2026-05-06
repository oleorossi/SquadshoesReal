import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { adjustStockSafe } from '@/lib/stockAdjustments';

// Canonical post-rename sector vocabulary — must match DEFAULT_OP_STAGES in
// src/hooks/useSaleOrders.ts and the migration 20260506120000_sector-rename-wave-stages.sql.
// The pre-rename names ('Corte', 'Forração', 'Costura') created stages that no
// Kanban column maps after the rename, hiding OPs from operators.
const DEFAULT_STAGES = [
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
 * Resync all active OPs that reference a specific technical sheet.
 * Prefers the atomic SQL RPC `resync_op_atomic` (added in 20260504180000)
 * which runs each OP's resync in a single transaction with row locking.
 * Falls back to the legacy multi-step path if the RPC is unavailable
 * (e.g. ambiente legado sem a migration aplicada).
 */
export async function resyncOPsForSheet(sheetId: string): Promise<{ totalResyncedOPs: number; errors: string[] }> {
  const { data: ops, error: opsErr } = await supabase
    .from('orders')
    .select('id, reference_id, quantity, status, color, grade, sale_order_id, order_number')
    .eq('reference_id', sheetId)
    .in('status', ['Reservado', 'Em Produção']);

  if (opsErr) throw opsErr;
  if (!ops || ops.length === 0) return { totalResyncedOPs: 0, errors: [] };

  // Fetch updated strap data from the technical sheet itself.
  // CRITICAL: capture the error. A silent SELECT failure (RLS / network) yielded
  // sheetStraps=[] and let the resync run with stale per-size strap consumption,
  // re-debiting wrong quantities of strap stock.
  const { data: sheetStrapData, error: sheetStrapErr } = await supabase
    .from('technical_sheets')
    .select('strap_colors')
    .eq('id', sheetId)
    .single();
  if (sheetStrapErr) throw new Error(`Falha ao carregar tiras da ficha técnica: ${sheetStrapErr.message}`);
  const sheetStraps: any[] = Array.isArray(sheetStrapData?.strap_colors) ? sheetStrapData.strap_colors : [];

  const soIds = [...new Set(ops.map(op => op.sale_order_id).filter(Boolean))];
  let soItems: any[] = [];
  if (soIds.length > 0) {
    // Capture the error so we don't silently lose per-PV item context (color/grade/strap_colors)
    // and end up debiting straps from the sheet baseline only.
    const { data: items, error: itemsErr } = await supabase
      .from('sale_order_items').select('*').in('sale_order_id', soIds);
    if (itemsErr) throw new Error(`Falha ao carregar itens dos PVs: ${itemsErr.message}`);
    soItems = items || [];
  }

  let totalResyncedOPs = 0;
  const errors: string[] = [];

  for (const op of ops) {
    try {
      // Try atomic RPC first (single transaction, row locked).
      const { error: rpcErr } = await supabase.rpc('resync_op_atomic' as any, {
        p_order_id: op.id,
      });
      if (!rpcErr) {
        // RPC handled stock estorno + re-débito + estágios atomicamente.
        // Ainda precisa lidar com tiras (lógica de merge entre sheet e
        // sale_order_item.strap_colors continua no TS por enquanto).
        const matchingItem = (soItems || []).find((i: any) => i.reference_id === op.reference_id && i.color === op.color);
        if (matchingItem?.strap_colors && Array.isArray(matchingItem.strap_colors) && (matchingItem.strap_colors as any[]).length > 0) {
          const mergedStraps = (matchingItem.strap_colors as any[]).map((itemStrap: any) => {
            const sheetStrap = sheetStraps.find((ss: any) => ss.id === itemStrap.id) || sheetStraps.find((ss: any) => ss.label === itemStrap.label);
            return sheetStrap
              ? { ...itemStrap, consumption: sheetStrap.consumption, consumption_per_size: sheetStrap.consumption_per_size }
              : itemStrap;
          });
          if (matchingItem.id) {
            await supabase.from('sale_order_items').update({ strap_colors: mergedStraps } as any).eq('id', matchingItem.id);
          }
          const opGradeForStraps = (op.grade as Record<string, number>) || {};
          const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
            p_strap_colors: mergedStraps,
            p_order_quantity: op.quantity,
            p_order_id: op.id,
            p_order_grade: (matchingItem as any).grade || (Object.keys(opGradeForStraps).length > 0 ? opGradeForStraps : null),
          } as any);
          if (strapErr) {
            errors.push(`OP ${op.order_number} — tiras: ${strapErr.message}`);
            toast.error(`Tiras — resync OP ${op.order_number}: ${strapErr.message}`);
          }
        }
        totalResyncedOPs++;
        continue;
      }

      // RPC ausente (ambiente sem migration 20260504180000) → fallback legado.
      const isMissingFn = String(rpcErr.message || '').toLowerCase().includes('does not exist')
        || String((rpcErr as any).code || '') === '42883';
      if (!isMissingFn) {
        // Erro real da RPC (não é "função não existe") — propaga sem cair no fallback
        throw rpcErr;
      }
      // The fallback is non-atomic (SELECT-then-UPDATE on stock with no row lock)
      // and writes legacy sector names below. Surface a clear warning so operators
      // can apply the migration instead of relying on the unsafe path silently.
      console.warn(
        '[resyncOPs] Fallback non-atomic path activated — apply migration ' +
        '20260504180000_atomic-resync-ops-and-trigger-coverage.sql to enable atomic resync.',
      );

      // 1. Reverse stock movements
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('product_id, quantity')
        .eq('order_id', op.id)
        .eq('movement_type', 'out');

      if (movements) {
        for (const mov of movements) {
          const { data: product } = await supabase
            .from('products')
            .select('quantity')
            .eq('id', mov.product_id)
            .single();
          if (!product) continue;

          const prevStock = Number(product.quantity);
          const newStock = prevStock + Number(mov.quantity);

          const result = await adjustStockSafe({
            productId: mov.product_id,
            expectedPrevious: prevStock,
            newQty: newStock,
            reason: 'Estorno automático - Atualização Ficha Técnica',
            orderId: op.id,
          });
          if (!result.success) {
            console.warn('[resyncOPs] fallback estorno failed for product', mov.product_id, result.errorMessage);
          }
        }
      }

      // 2. Delete old stages, reservations, consumptions
      await supabase.from('order_stages').delete().eq('order_id', op.id);
      await supabase.from('material_reservations').delete().eq('order_id', op.id);
      await supabase.from('production_consumptions').delete().eq('order_id', op.id);

      // 2b. Invalida snapshot da PV/item para forçar recálculo por grade na ficha técnica atualizada
      // (sem isso, hybrid_debit_stock_for_order reaproveita consumption_snapshot antigo)
      if (op.sale_order_id) {
        const matchingItemForSnap = (soItems || []).find((i: any) => i.reference_id === op.reference_id && i.color === op.color);
        const delQuery = supabase
          .from('technical_sheet_snapshots')
          .delete()
          .eq('sale_order_id', op.sale_order_id);
        if (matchingItemForSnap?.id) {
          await delQuery.eq('sale_order_item_id', matchingItemForSnap.id);
        } else {
          await delQuery.is('sale_order_item_id', null);
        }
      }

      // 3. Detach old stock movements
      await supabase.from('stock_movements').update({ order_id: null }).eq('order_id', op.id);

      // 3b. Restaura grade do solado (passo 1 só restaurou quantity total — sem
      // isso, o re-débito posterior cai sobre uma grade já decrementada).
      const { error: soleGradeErr } = await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id } as any);
      if (soleGradeErr && !/does not exist|not found/i.test(soleGradeErr.message)) {
        throw soleGradeErr;
      }

      // 4. Re-debit stock
      const opGrade = (op.grade as Record<string, number>) || {};
      const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
        p_reference_id: op.reference_id,
        p_order_quantity: op.quantity,
        p_color: op.color || '',
        p_order_id: op.id,
        p_order_grade: Object.keys(opGrade).length > 0 ? opGrade : null,
      } as any);
      if (debitErr) throw new Error(`Falha no re-débito de estoque (fallback): ${debitErr.message}`);

      // 5. Re-debit sole by grade
      const grade = (op.grade as Record<string, number>) || {};
      if (Object.keys(grade).length > 0) {
        const { error: soleErr } = await supabase.rpc('debit_sole_stock_by_grade', {
          p_reference_id: op.reference_id,
          p_order_id: op.id,
          p_color: op.color || '',
          p_order_grade: grade,
        } as any);
        if (soleErr) throw new Error(`Falha no re-débito de solado (fallback): ${soleErr.message}`);
      }

      // 6. Re-debit strap materials (using updated consumption from technical sheet)
      const matchingItem = (soItems || []).find((i: any) => i.reference_id === op.reference_id && i.color === op.color);
      if (matchingItem?.strap_colors && Array.isArray(matchingItem.strap_colors) && (matchingItem.strap_colors as any[]).length > 0) {
        // Merge: keep color selections from sale_order_item but update consumption from technical sheet
        const mergedStraps = (matchingItem.strap_colors as any[]).map((itemStrap: any) => {
          const sheetStrap = sheetStraps.find((ss: any) => ss.id === itemStrap.id) || sheetStraps.find((ss: any) => ss.label === itemStrap.label);
          if (sheetStrap) {
            return {
              ...itemStrap,
              consumption: sheetStrap.consumption,
              consumption_per_size: sheetStrap.consumption_per_size,
            };
          }
          return itemStrap;
        });

        // Also update the sale_order_item with the merged strap data for future consistency
        if (matchingItem.id) {
          await supabase.from('sale_order_items').update({ strap_colors: mergedStraps } as any).eq('id', matchingItem.id);
        }

        const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
          p_strap_colors: mergedStraps,
          p_order_quantity: op.quantity,
          p_order_id: op.id,
          p_order_grade: (matchingItem as any).grade || grade || null,
        } as any);
        if (strapErr) {
          console.error('Erro ao re-debitar tiras (resync):', strapErr.message);
          toast.error(`Tiras — resync OP ${op.order_number}: ${strapErr.message}`);
        }
      }

      // 7. Recreate stages from updated technical sheet
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
          status: 'pendente',
          quantity_total: op.quantity,
          quantity_processed: 0,
        };
      });
      await supabase.from('order_stages').insert(rows);

      totalResyncedOPs++;
    } catch (opErr: any) {
      errors.push(`OP ${op.id.substring(0, 8)}: ${opErr.message}`);
    }
  }

  return { totalResyncedOPs, errors };
}
