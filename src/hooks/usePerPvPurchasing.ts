import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  createPerPvStrapIdentityGuard,
  excludeStrapsFromPerPvDrafts,
  type DraftPurchaseOrder,
  type PvMaterialNeed,
} from '@/lib/perPvPurchasing';

interface UntypedRpcResult {
  data: unknown;
  error: { message?: string } | null;
}

interface UntypedRpcClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedRpcResult>;
}

interface PerPvCatalogIdentityPayload {
  variants?: Array<{ id?: string | null; finished_product_id?: string | null }>;
  groups?: Array<{ id?: string | null; is_artisanal_strap?: boolean | null }>;
}

const untypedRpc = supabase as unknown as UntypedRpcClient;

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
      const { data, error } = await untypedRpc.rpc('compute_materials_per_pv', {
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
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('source_type', 'per_pv')
        .contains('source_pv_ids', [pvId])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
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

async function loadPerPvStrapIdentityGuard(drafts: DraftPurchaseOrder[]) {
  const materialIds = [...new Set(
    drafts.flatMap((draft) => draft.items.map((item) => item.material_id.trim())).filter(Boolean),
  )];
  if (materialIds.length === 0) {
    throw new Error('Nenhum produto válido foi informado para validar esta compra.');
  }

  const [catalogResult, productsResult] = await Promise.all([
    untypedRpc.rpc('list_artisanal_strap_catalog', { p_include_archived: true }),
    supabase
      .from('products')
      .select('id, group_id, is_artisanal')
      .in('id', materialIds),
  ]);
  if (catalogResult.error) {
    throw new Error(`Não foi possível validar o catálogo canônico de tiras: ${catalogResult.error.message || 'erro desconhecido'}. Nenhuma OC foi gerada.`);
  }
  if (productsResult.error) {
    throw new Error(`Não foi possível validar a identidade dos materiais: ${productsResult.error.message}. Nenhuma OC foi gerada.`);
  }

  const productRows = productsResult.data || [];
  const foundProductIds = new Set(productRows.map((product) => product.id));
  const missingProductIds = materialIds.filter((id) => !foundProductIds.has(id));
  if (missingProductIds.length > 0) {
    throw new Error('Há materiais sem identidade de produto válida. Nenhuma OC foi gerada; recalcule o pedido e tente novamente.');
  }

  const groupIds = [...new Set(productRows.map((product) => product.group_id).filter((id): id is string => !!id))];
  const groupsResult = groupIds.length > 0
    ? await supabase
      .from('product_groups')
      .select('id, is_artisanal_strap')
      .in('id', groupIds)
    : { data: [], error: null };
  if (groupsResult.error) {
    throw new Error(`Não foi possível validar os grupos dos materiais: ${groupsResult.error.message}. Nenhuma OC foi gerada.`);
  }
  const foundGroupIds = new Set((groupsResult.data || []).map((group) => group.id));
  if (groupIds.some((id) => !foundGroupIds.has(id))) {
    throw new Error('Há materiais com grupo indisponível para validação. Nenhuma OC foi gerada; recarregue os cadastros.');
  }

  return createPerPvStrapIdentityGuard({
    catalog: catalogResult.data as PerPvCatalogIdentityPayload,
    products: productRows,
    groups: groupsResult.data || [],
  });
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
      if (pvIds.length === 0) throw new Error('Nenhum PV informado.');
      const submitted = drafts.filter((draft) => draft.items.length > 0);
      if (submitted.length === 0) throw new Error('Nenhum material a comprar para este(s) pedido(s).');

      // Segunda barreira, imediatamente antes de qualquer INSERT. O diálogo já
      // separa as tiras, mas outros callers do hook não podem depender da UI.
      // A classificação usa somente IDs/flags estruturais e falha fechada se o
      // catálogo ou a identidade exata de algum produto não puder ser lida.
      const strapIdentityGuard = await loadPerPvStrapIdentityGuard(submitted);
      const filtered = excludeStrapsFromPerPvDrafts(submitted, strapIdentityGuard);
      const valid = filtered.drafts;
      if (valid.length === 0) {
        if (filtered.excluded.length > 0) {
          throw new Error('Este pedido contém somente tiras neste canal. Elas seguem o motor automático em Tiras Artesanais; nenhuma OC por pedido foi gerada.');
        }
        throw new Error('Nenhum material a comprar para este(s) pedido(s).');
      }
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

        const { data: po, error } = await supabase
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
        const { error: e2 } = await supabase.from('purchase_order_items').insert(items);
        if (e2) {
          // Compensating delete — não deixa OC órfã sem itens.
          await supabase.from('purchase_orders').delete().eq('id', po.id).eq('status', 'pending');
          throw e2;
        }
        createdIds.push(po.id as string);
      }

      return {
        createdIds,
        orderCount: createdIds.length,
        excludedStrapItemCount: filtered.excluded.length,
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_per_pv'] });
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      toast.success(
        `${res.orderCount} ordem(ns) de compra gerada(s) para o(s) pedido(s).`,
      );
      if (res.excludedStrapItemCount > 0) {
        toast.info(
          `${res.excludedStrapItemCount} item(ns) de tira não entrou(aram) nestas OCs e segue(m) no motor automático de tiras.`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
