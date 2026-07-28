import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { canonicalStageOrder } from '@/components/production/worksheet/stageOrder';

// Canonical post-rename sector vocabulary — must match DEFAULT_OP_STAGES in
// src/hooks/useSaleOrders.ts and the migration 20260506120000_sector-rename-wave-stages.sql.
// The pre-rename names ('Corte', 'Forração', 'Costura') created stages that no
// Kanban column maps after the rename, hiding OPs from operators.
// 'Aviamento' é a grafia canônica desde 2026-07-01 (migration 20260902120000) —
// gravar 'Mesa' aqui recriava a grafia dupla que some das telas de setor.
// Fluxo canônico de 11 etapas após o split da Costura (mig 20261001120000).
// A ordem espelha `canonicalStageOrder`/SQL `canonical_stage_order` — não
// hardcodar números aqui (drift). 'Costura' única foi substituída por
// 'Costura Palmilha' + 'Costura Cabedal'.
const DEFAULT_STAGE_NAMES = [
  'Corte Palmilha',
  'Corte Forração',
  'Costura Palmilha',
  'Costura Cabedal',
  'Aviamento',
  'Silk',
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
];

/**
 * Resync all active OPs that reference a specific technical sheet.
 * Prefers the atomic SQL RPC `resync_op_atomic` (added in 20260504180000)
 * which runs each OP's resync in a single transaction with row locking.
 * Falls back to the legacy multi-step path if the RPC is unavailable
 * (e.g. ambiente legado sem a migration aplicada).
 */
export async function resyncOPsForSheet(sheetId: string): Promise<{ totalResyncedOPs: number; errors: string[]; reservations?: { ops: number; inseridas: number; atualizadas: number; canceladas: number } }> {
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
            // Resync = reserva SOFT (igual à criação da OP). Sem isso o débito
            // era HARD e travava o resync com "Estoque insuficiente" quando a
            // tira (cortada do rolo) está com 0 no estoque. Falta vira ruptura.
            p_force_soft: true,
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
      // ⚠ Detecção ESTREITA de propósito: só considera "a própria resync_op_atomic
      // não existe" (PostgREST PGRST202, ou "does not exist" que CITE o nome dela).
      // ANTES bastava qualquer 'does not exist' / SQLSTATE 42883 — e um erro de
      // DENTRO da RPC (ex.: 'function unaccent(text) does not exist', também 42883)
      // era lido como "a RPC sumiu", disparando o fallback NÃO-atômico que apaga
      // estágios/reservas/consumos ANTES do re-débito. Quando o re-débito também
      // falhava, a OP ficava corrompida (0 estágios/0 reservas, invisível no kanban).
      // (bug 2026-07-01: unaccent em resolve_sole_color, corrigido em migration.)
      const rpcCode = String((rpcErr as any).code || '');
      const rpcMsg = String(rpcErr.message || '');
      const isMissingFn = rpcCode === 'PGRST202'
        || (/resync_op_atomic/i.test(rpcMsg) && /(does not exist|could not find)/i.test(rpcMsg));
      if (!isMissingFn) {
        // Erro real da RPC (ela RODOU e falhou) — propaga sem cair no fallback
        // destrutivo. A RPC é transacional: já deu rollback, a OP fica intacta.
        throw rpcErr;
      }
      // The fallback is non-atomic (SELECT-then-UPDATE on stock with no row lock)
      // and writes legacy sector names below. Surface a clear warning so operators
      // can apply the migration instead of relying on the unsafe path silently.
      console.warn(
        '[resyncOPs] Fallback non-atomic path activated — apply migration ' +
        '20260504180000_atomic-resync-ops-and-trigger-coverage.sql to enable atomic resync.',
      );

      // 1. Restaura grade do solado ANTES de apagar as reservas (passo 2): a
      // função viva (mig 20260721270000) lê material_reservations kind='sole_grade'
      // (metadata.effective_grade) — chamada depois do delete vira no-op e o
      // re-débito do passo 5 baixa uma stock_grade já decrementada (baldes 2×).
      const { error: soleGradeErr } = await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id } as any);
      if (soleGradeErr && !/does not exist|not found/i.test(soleGradeErr.message)) {
        throw soleGradeErr;
      }
      const soleGradeRestored = !soleGradeErr;

      // 1b. Reverse stock movements (escalar)
      const { data: movements } = await supabase
        .from('stock_movements')
        .select('product_id, quantity, description')
        .eq('order_id', op.id)
        .eq('movement_type', 'out');

      if (movements) {
        for (const mov of movements) {
          // restore_sole_grade_for_order credita stock_grade E quantity do solado —
          // estornar também o movimento de baixa do solado por grade creditaria o
          // escalar 2×. Cobre os DOIS prefixos que o débito por grade grava:
          // 'Debito Solado por grade%' (débito direto) e 'Conversão Solado por
          // grade%' (baixa via convert_reservation_to_out, caminho padrão das
          // OPs novas). (Se a função não existe no ambiente, mantém o estorno
          // escalar legado.)
          const desc = String((mov as any).description || '');
          if (soleGradeRestored &&
              (desc.startsWith('Debito Solado por grade') || desc.startsWith('Conversão Solado por grade'))) {
            continue;
          }
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
          // Resync = reserva SOFT (igual à criação da OP) — não trava com
          // "Estoque insuficiente" quando a tira está com 0 no estoque.
          p_force_soft: true,
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
        : DEFAULT_STAGE_NAMES;
      const rows = sectorNames.map((name: string, idx: number) => {
        const canonical = canonicalStageOrder(name);
        return {
          order_id: op.id,
          stage_name: name,
          // Numeração canônica (espelha o SQL); setor fora do mapa → posição
          // relativa no roteiro (idx+1) em vez do sentinel 99.
          stage_order: canonical === 99 ? idx + 1 : canonical,
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

  // ── Re-reserva de material das OPs ativas ("reeditar sempre") ─────────────
  // `resync_op_atomic` acima NÃO re-reserva material: não menciona
  // direct_components nem chama try_reserve_materials. Era o elo que faltava —
  // componente acrescentado à ficha depois da OP criada nunca era reservado e,
  // como a baixa na finalização converte RESERVA em stock_movements, saía da
  // fábrica sem débito (furo do PV-00145: 26 linhas, incluindo 2.208 pares de
  // solado; e Ilhós 51 no PV-00142, achado pelo mesmo diagnóstico).
  //
  // Escopo do RPC: COMPONENTE DIRETO só. É a classe que causou o furo e a única
  // onde a re-reserva automática é segura (a ficha fixa o product_id, unidade
  // nativa). Materiais resolvidos por GRUPO ficam de fora de propósito — o motor
  // de consumo e try_reserve_materials escolhem produtos diferentes dentro do
  // mesmo grupo (PLACA 1.0 EVA 3.0 × EVA 3MM), e inserir pelo id do consumo
  // dobraria a reserva. Esses seguem reportados em /diagnostics.
  //
  // Nunca mexe em reserva com quantity_consumed > 0 (material já separado).
  // Falha aqui NÃO derruba o resync: o resto já foi aplicado.
  let reservations: { ops: number; inseridas: number; atualizadas: number; canceladas: number } | undefined;
  try {
    // Cast no NOME da RPC (idioma do arquivo, ver resync_op_atomic acima) — a
    // função é nova e ainda não está nos tipos gerados.
    const { data: resData, error: resErr } = await supabase
      .rpc('resync_sheet_material_reservations' as any, { p_sheet_id: sheetId });
    if (resErr) {
      errors.push(`Re-reserva de material: ${resErr.message}`);
    } else if (resData) {
      const r = resData as Record<string, unknown>;
      reservations = {
        ops: Number(r.ops) || 0,
        inseridas: Number(r.inseridas) || 0,
        atualizadas: Number(r.atualizadas) || 0,
        canceladas: Number(r.canceladas) || 0,
      };
    }
  } catch (resCatch) {
    const msg = resCatch instanceof Error ? resCatch.message : 'falha inesperada';
    errors.push(`Re-reserva de material: ${msg}`);
  }

  return { totalResyncedOPs, errors, reservations };
}
