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

/** Materiais necessários pra compra de um conjunto de PVs. A RPC é um wrapper
 * do motor canônico que acrescenta netting de solado por grade e OCs abertas. */
export function useMaterialsPerPv(pvIds: string[] | null | undefined) {
  const ids = (pvIds || []).filter(Boolean);
  return useQuery({
    queryKey: ['materials_per_pv', ids.slice().sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await untypedRpc.rpc('compute_per_pv_purchase_needs_v2', {
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
  /** UUID estável da tentativa. Retry da mesma tentativa reutiliza o UUID; uma
   *  nova compra deliberada recebe outro. */
  requestId: string;
  allowExistingOpenPurchases: boolean;
  drafts: DraftPurchaseOrder[];
}

async function loadPerPvStrapIdentityGuard(drafts: DraftPurchaseOrder[]) {
  const materialIds = [...new Set(
    drafts.flatMap((draft) => draft.items
      .map((item) => item.material_id?.trim() || '')
      .filter(Boolean)),
  )];
  if (materialIds.length === 0) {
    // Lote exclusivamente de box_types: não existe identidade products para
    // consultar nem risco de cair no canal artesanal de tiras.
    return createPerPvStrapIdentityGuard({ products: [], groups: [] });
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
 * Cria as OCs do canal per_pv numa única RPC transacional. O banco pré-valida o
 * lote inteiro, grava cabeçalhos + itens e mantém um recibo durável por requestId.
 */
export function useGeneratePerPvPurchaseOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pvIds, requestId, allowExistingOpenPurchases, drafts }: GeneratePerPvInput) => {
      if (pvIds.length === 0) throw new Error('Nenhum PV informado.');
      if (!requestId) throw new Error('Identificador da tentativa indisponível; reabra a geração.');
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
          throw new Error('Este pedido contém somente tiras neste canal. Elas seguem o motor automático em Tiras; nenhuma OC por pedido foi gerada.');
        }
        throw new Error('Nenhum material a comprar para este(s) pedido(s).');
      }
      for (const d of valid) {
        for (const it of d.items) {
          if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
            throw new Error(`Quantidade inválida em ${it.product_name}.`);
          }
          if (!Number.isFinite(it.unit_price) || it.unit_price <= 0) {
            throw new Error(`Informe um preço maior que zero em ${it.product_name}. Nenhuma OC foi gerada.`);
          }
        }
      }

      const rpcDrafts = valid.map((draft) => ({
        supplier_id: draft.supplier_id,
        supplier_name: draft.supplier_name,
        items: draft.items.map((item) => ({
          material_id: item.material_id,
          box_type_id: item.box_type_id ?? null,
          quantity: item.quantity,
          net_of_stock: item.net_of_stock,
          unit_price: item.unit_price,
          unit: item.unit,
          current_stock: item.stock_qty,
          color: item.color ?? null,
          grade: item.grade ?? null,
        })),
      }));

      const { data, error } = await untypedRpc.rpc('create_per_pv_purchase_orders_atomic', {
        p_pv_ids: pvIds,
        p_drafts: rpcDrafts,
        p_request_id: requestId,
        p_allow_existing_open: allowExistingOpenPurchases,
      });
      if (error) throw new Error(error.message || 'Não foi possível gerar as OCs por pedido.');

      const payload = (data && typeof data === 'object' ? data : {}) as {
        created_ids?: unknown;
        order_count?: unknown;
        replayed?: unknown;
      };
      const createdIds = Array.isArray(payload.created_ids)
        ? payload.created_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (createdIds.length === 0) {
        throw new Error('O banco não devolveu as OCs geradas; nenhuma confirmação foi assumida.');
      }

      return {
        createdIds,
        orderCount: Number(payload.order_count) || createdIds.length,
        replayed: payload.replayed === true,
        excludedStrapItemCount: filtered.excluded.length,
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_per_pv'] });
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      qc.invalidateQueries({ queryKey: ['materials_per_pv'] });
      toast.success(res.replayed
        ? `${res.orderCount} ordem(ns) já haviam sido geradas nesta tentativa.`
        : `${res.orderCount} ordem(ns) de compra gerada(s) para o(s) pedido(s).`);
      if (res.excludedStrapItemCount > 0) {
        toast.info(
          `${res.excludedStrapItemCount} item(ns) de tira não entrou(aram) nestas OCs e segue(m) no motor automático de tiras.`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
