import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { DraftPurchaseOrder, PvMaterialNeed } from '@/lib/perPvPurchasing';

/**
 * Hooks do canal "Compras por Pedido" (OC por PV / por PVs selecionados).
 * Separado do MRP/ondas — ver src/lib/perPvPurchasing.ts e a migration
 * 20260808120000.
 */

/** Materiais necessários pra um conjunto de PVs (RPC compute_materials_per_pv). */
export function useMaterialsPerPv(pvIds: string[] | null | undefined) {
  const ids = (pvIds || []).filter(Boolean);
  return useQuery({
    queryKey: ['materials_per_pv', ids.slice().sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('compute_materials_per_pv', {
        p_pv_ids: ids,
      });
      if (error) throw error;
      return (data || []) as PvMaterialNeed[];
    },
  });
}

/** Lista as OCs do canal per_pv que contêm um PV específico (aba "Compras deste PV"). */
export function usePurchaseOrdersForPv(pvId: string | null | undefined) {
  return useQuery({
    queryKey: ['purchase_orders_per_pv', pvId],
    enabled: !!pvId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('*')
        .eq('source_type', 'per_pv')
        .contains('source_pv_ids', [pvId])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export interface GeneratePerPvInput {
  pvIds: string[];
  /** Números dos PVs ("PV-2026-00144") pra montar as notas automáticas. */
  pvNumbers?: string[];
  drafts: DraftPurchaseOrder[];
}

function perPvNotes(pvNumbers: string[] | undefined, pvIds: string[]): string {
  const labels = (pvNumbers && pvNumbers.length ? pvNumbers : pvIds).join(', ');
  return `Gerado a partir de ${labels} (Compras por Pedido)`;
}

/**
 * Cria as OCs do canal per_pv — uma por draft (fornecedor + "Sem Fornecedor").
 * Cada OC recebe source_type='per_pv', source_pv_ids e idempotency_key
 * determinístico (anti-double-click via trigger de 30s).
 */
export function useGeneratePerPvPurchaseOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pvIds, pvNumbers, drafts }: GeneratePerPvInput) => {
      const valid = drafts.filter((d) => d.items.length > 0);
      if (pvIds.length === 0) throw new Error('Nenhum PV informado.');
      if (valid.length === 0) throw new Error('Nenhum material a comprar para este(s) pedido(s).');
      for (const d of valid) {
        for (const it of d.items) {
          if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
            throw new Error(`Quantidade inválida em ${it.product_name}.`);
          }
          if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
            throw new Error(`Preço inválido em ${it.product_name}.`);
          }
        }
      }

      const notes = perPvNotes(pvNumbers, pvIds);
      const sortedPvKey = pvIds.slice().sort().join(',');
      const createdIds: string[] = [];

      for (const d of valid) {
        const total = d.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
        if (!Number.isFinite(total) || total > 1e12) throw new Error('Total da OC fora de limite.');
        const idemKey = `perpv::${sortedPvKey}::${d.supplier_id || 'none'}`;

        const { data: po, error } = await (supabase as any)
          .from('purchase_orders')
          .insert({
            supplier_id: d.supplier_id,
            supplier_name: d.supplier_name,
            notes,
            total_value: total,
            auto_generated: false,
            status: 'pending',
            source_type: 'per_pv',
            source_pv_ids: pvIds,
            idempotency_key: idemKey,
          })
          .select()
          .single();
        if (error) {
          if (error.code === '23505' && /idempotency/.test(error.message || '')) {
            throw new Error(
              'Estas OCs já foram geradas há menos de 30s para este(s) pedido(s). ' +
              'Confira em "Compras deste PV" antes de gerar de novo.',
            );
          }
          throw error;
        }

        const items = d.items.map((i) => ({
          purchase_order_id: po.id,
          product_id: i.material_id,
          quantity: i.quantity,
          suggested_quantity: i.quantity,
          unit_price: i.unit_price,
          unit: i.unit,
          current_stock: i.stock_qty,
          min_stock: 0,
          max_stock: 0,
          color: i.color ?? null,
        }));
        const { error: e2 } = await (supabase as any).from('purchase_order_items').insert(items);
        if (e2) {
          // Compensating delete — não deixa OC órfã sem itens.
          await (supabase as any).from('purchase_orders').delete().eq('id', po.id).eq('status', 'pending');
          throw e2;
        }
        createdIds.push(po.id as string);
      }

      return { createdIds, orderCount: createdIds.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_per_pv'] });
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      toast.success(
        `${res.orderCount} ordem(ns) de compra gerada(s) para o(s) pedido(s).`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
