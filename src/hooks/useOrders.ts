import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { searchNormOrFilter } from '@/lib/searchUtils';
import { warnPackagingDebit } from '@/lib/packagingDebitWarnings';

/**
 * Teto do recorte de `useOrders`. Exportado de propósito: quem renderiza a
 * lista compara `orders.length >= ORDERS_QUERY_LIMIT` pra AVISAR o usuário de
 * que o recorte mordeu — antes o único sinal era um console.warn em DEV, então
 * a pill "Todas" mentia em silêncio em produção (filtros, contagens e pills são
 * calculados sobre este recorte, não sobre a tabela inteira).
 */
export const ORDERS_QUERY_LIMIT = 1000;

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
  grade?: Record<string, number>;
  /** OBRIGATÓRIO: `orders.sale_order_id` é NOT NULL sem default e nenhum
   *  trigger BEFORE INSERT o preenche. Sem este campo no payload o INSERT
   *  estoura 23502 e a criação manual de OP nunca completa. */
  sale_order_id?: string;
};

type ProductionOrderCommand = 'create' | 'ensure_stages' | 'transition' | 'cancel' | 'delete';

async function executeProductionOrderCommand(
  command: ProductionOrderCommand,
  orderId: string | null,
  payload: Record<string, unknown> = {},
) {
  // Um UUID nasce uma vez por gesto do usuário e é reaproveitado pelo
  // Postgres caso a resposta da mesma chamada seja reentregue/reexecutada.
  const requestId = crypto.randomUUID();
  const { data, error } = await (supabase.rpc as any)('execute_production_order_command', {
    p_command: command,
    p_order_id: orderId,
    p_client_request_id: requestId,
    p_payload: payload,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error?.message || 'Comando de OP recusado pelo servidor.');
  return data as any;
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, technical_sheets(name, code, image_url, reference_color_variants(color, image_url))')
        .order('created_at', { ascending: false })
        .limit(ORDERS_QUERY_LIMIT);
      if (error) throw error;
      if (data && data.length >= ORDERS_QUERY_LIMIT && import.meta.env.DEV) console.warn(`useOrders: hit ${ORDERS_QUERY_LIMIT}-row ceiling — some orders may be missing`);
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
    packagingMode?: string | null,
    materialVariantId?: string | null,
  ) => {
    // strapColors vem de sale_order_items (com cor real escolhida pelo cliente),
    // não da ficha (que tem template sem cor). Sem isso a RPC não conseguia
    // detectar shortage de tiras → MaterialPurchaseConfirmDialog não abria pra
    // tiras → OS pra terceiro nunca era criada automaticamente.
    // Bug histórico até 2026-05-17.
    // packagingMode (auditoria 2026-07-01): sem ele a RPC contava as DUAS
    // caixas (colmeia + individual) quando a ficha tem ambas no BOM — mesma
    // regra de filter_caixa_by_packaging_mode usada no custeio.
    // materialVariantId (auditoria 2026-07-19, CONS-4): sem ele a RPC resolvia
    // os materiais com variante NULL — o badge avaliava o material da FICHA,
    // não o da variante escolhida no item do PV.
    const { data, error } = await supabase.rpc('check_stock_availability', {
      p_reference_id: referenceId,
      p_order_quantity: quantity,
      p_color: color || '',
      p_order_grade: grade ?? null,
      p_strap_colors: strapColors ?? null,
      p_packaging_mode: packagingMode ?? null,
      p_material_variant_id: materialVariantId ?? null,
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
      // `orders.sale_order_id` é NOT NULL no banco: OP avulsa não existe por
      // schema. Validar aqui troca o erro cru do Postgres (23502) por uma
      // mensagem acionável antes de qualquer débito de estoque.
      if (!form.sale_order_id) throw new Error('Selecione o Pedido de Venda — toda OP precisa estar vinculada a um PV.');
      const status = form.status_override || 'Reservado';
      const result = await executeProductionOrderCommand('create', null, {
        reference_id: form.reference_id,
        sale_order_id: form.sale_order_id,
        quantity: form.quantity,
        notes: form.notes || '',
        status,
        color: form.color || '',
        grade: form.grade || null,
        planned_start: form.planned_start || null,
        planned_delivery: form.planned_delivery || null,
        production_line: form.production_line || '',
        responsible: form.responsible || '',
      });
      if (status === 'Reservado') {
        warnPackagingDebit(
          result.materialization?.packaging,
          `OP ${result.order?.order_number || String(result.order_id).slice(0, 8)}`,
        );
      }
      return result.order;
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
    mutationFn: async ({ id, status, expectedStatus }: { id: string; status: string; expectedStatus?: string }) => {
      const command = status === 'Cancelada' ? 'cancel' : 'transition';
      return executeProductionOrderCommand(command, id, command === 'cancel'
        ? { expected_status: expectedStatus }
        : { target_status: status, expected_status: expectedStatus });
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
      // Cancelar OP libera as reservas no servidor; sem invalidar isto as telas
      // de reserva seguiam mostrando material reservado por OP já cancelada.
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
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
      const { data: currentOrders, error: currentError } = await supabase
        .from('orders')
        .select('id, status')
        .in('id', orderIds);
      if (currentError) throw new Error(`Falha ao carregar OPs: ${currentError.message}`);
      const statusById = new Map((currentOrders || []).map(order => [order.id, order.status]));
      const errors: Array<{ id: string; message: string }> = [];
      for (const id of orderIds) {
        try {
          const currentStatus = statusById.get(id);
          if (!currentStatus) throw new Error('OP não encontrada no recorte atual.');
          if (['Cancelada', 'Cancelado'].includes(currentStatus)) continue;
          await executeProductionOrderCommand('cancel', id, { expected_status: currentStatus });
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
      const { data: opRow, error: opErr } = await supabase
        .from('orders')
        .select('status')
        .eq('id', id)
        .single();
      if (opErr) throw new Error(`Falha ao carregar OP: ${opErr.message}`);
      return executeProductionOrderCommand('delete', id, { expected_status: opRow.status });
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

export function useEnsureOrderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      const results = [];
      for (const id of orderIds) {
        results.push(await executeProductionOrderCommand('ensure_stages', id));
      }
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
    },
    onError: (err: Error) => toast.error(`Erro ao criar etapas: ${err.message}`),
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
   previous_grade: Record<string, unknown> | null;
   new_grade: Record<string, unknown> | null;
   products: {
     name: string;
     sku: string;
     unit: string;
   } | null;
 }
 
export function useStockMovements(opts?: { search?: string; productId?: string }) {
  const search = (opts?.search ?? '').trim();
  const productId = opts?.productId;
  return useQuery({
    queryKey: ['stock_movements', productId ?? 'all', search],
    queryFn: async () => {
      // FK stock_movements.product_id → products.id NÃO existe no DB, então
      // o embed `products(...)` retorna erro "Could not find a relationship".
      // Fazemos 2 queries: 1) movements, 2) products dos product_ids únicos,
      // e fazemos o merge no client.
      //
      // Busca SERVER-SIDE (spec melhorias-busca-sistema R6): o histórico cresce
      // sem teto e o limit(500) escondia movimentações antigas da busca local.
      // Com termo, o banco filtra via search_norm (descrição/tipo/motivo/usuário)
      // OU por movimentos dos produtos cujo nome/sku/cor casa o termo.
      let q = supabase
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (productId) q = q.eq('product_id', productId) as typeof q;
      // Termo que normaliza pra vazio (só pontuação) ⇒ sem filtro — .or('')
      // viraria `or=()` = 400 no PostgREST (contrato do searchNormOrFilter).
      const norm = searchNormOrFilter(search);
      if (norm) {
        const orParts = [norm];
        const { data: prodMatches } = await supabase
          .from('products')
          .select('id')
          .or(norm)
          .limit(200);
        const matchedIds = (prodMatches ?? []).map((p: any) => p.id);
        if (matchedIds.length > 0) orParts.push(`product_id.in.(${matchedIds.join(',')})`);
        q = q.or(orParts.join(',')) as typeof q;
      }
      const { data, error } = await q;
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
        previous_grade: m.previous_grade && typeof m.previous_grade === 'object' ? m.previous_grade : null,
        new_grade: m.new_grade && typeof m.new_grade === 'object' ? m.new_grade : null,
        products: productsMap.get(m.product_id) || null,
      }));
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
