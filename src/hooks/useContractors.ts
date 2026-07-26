import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isOsDone } from '@/lib/osStatusMachine';
import { stripSearchNorm } from '@/lib/searchUtils';
import { receiveServiceOrderFully } from '@/lib/serviceOrderStock';

export interface Contractor {
  id: string;
  name: string;
  trade_name: string;
  cnpj_cpf: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  service_type: string;
  notes: string;
  active: boolean;
  payment_days: number;
  created_at: string;
  updated_at: string;
}

export interface MaterialSent {
  material: string;
  color: string;
  meters: number;
  completed?: boolean;
}

export interface ServiceOrder {
  id: string;
  contractor_id: string;
  order_number: string;
  description: string;
  service_date: string;
  service_time: string;
  quantity: number;
  unit_price: number;
  total_value: number;
  status: string;
  notes: string;
  material_name: string;
  material_meters: number;
  material_color: string;
  materials_sent: MaterialSent[];
  receipt_number: string;
  receipt_generated_at: string | null;
  signed_photo_url: string | null;
  sale_order_id: string | null;
  // Array com todos os PVs vinculados (preenchido pelo upsert_open_service_order
  // quando uma OS é agregada de múltiplos PVs). Primary sale_order_id pode
  // ficar null em agregações — usar o primeiro do array como fallback.
  linked_sale_order_ids?: string[] | null;
  // Artisanal production fields
  artisanal_recipe_id?: string | null;
  artisanal_output_name?: string | null;
  artisanal_output_color?: string | null;
  artisanal_output_meters?: number;
  artisanal_for_order_meters?: number;
  artisanal_for_stock_meters?: number;
  artisanal_base_color?: string | null;
  artisanal_stock_entry_done?: boolean;
  // Fluxo de gargalos → OS terceirizada (migration 20260513210000):
  // pending_quote = OS criada do /gargalos, aguardando contratada responder.
  // quoted = prazo confirmado, OP desbloqueia pra Montagem.
  target_sector?: string | null;
  bottleneck_week?: string | null;
  order_id?: string | null;
  quoted_at?: string | null;
  quoted_deadline?: string | null;
  // Data real de entrega (ação rápida "Marcar como Entregue") — coluna criada
  // pela migration 20260722180000_service-orders-delivered-at. Até regenerar o
  // types.ts, updates desta coluna usam `(supabase as any)`.
  delivered_at?: string | null;
  // Terceirização integrada (gerada automaticamente a partir de um PV): vínculo
  // com o pedido de venda de origem. Diferente do legacy sale_order_id, não passa
  // por nenhum gating de produção — é só rastreabilidade/financeiro.
  source_sale_order_id?: string | null;
  source_sale_order_item_id?: string | null;
  source_terceirizacao_id?: string | null;
  source_item_key?: string | null;
  payment_due_date?: string | null;
  is_avulsa?: boolean | null;
  /** OS dividida entre prestadores — paga por RECEBIMENTO, não pelo fluxo normal. */
  dispatch_tracked?: boolean | null;
  /** Soft-archive da triagem de OS órfãs (P0.3, 2026-07). Preenchida = fora das listas default. */
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  contractors?: Contractor;
}

export function useContractors() {
  return useQuery({
    queryKey: ['contractors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Contractor[];
    },
  });
}

export function useServiceOrders() {
  return useQuery({
    queryKey: ['service_orders'],
    queryFn: async () => {
      // Paginação em blocos: o PostgREST corta em ~1000 linhas sem range e o
      // volume de OS cresce ~300/mês — sem isso as OS antigas sumiam em silêncio
      // da lista/planejamento (auditoria 2026-07-02).
      const PAGE = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += PAGE) {
        // ⚠ PERF (2026-07-26): o embed era `contractors(*)` — a linha COMPLETA do
        // prestador (endereço, documentos, dados bancários, campos de busca…)
        // repetida uma vez por OS. Com ~380 OS pra 6 prestadores, o mesmo registro
        // vinha centenas de vezes e sozinho dominava os 748 kB da resposta. Um grep
        // no repo inteiro mostra que só `name` e `trade_name` são lidos do embed.
        const { data, error } = await supabase
          .from('service_orders')
          .select('*, contractors(id, name, trade_name)')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return (all as unknown as ServiceOrder[]).map(o => ({
        ...o,
        materials_sent: Array.isArray(o.materials_sent) ? o.materials_sent : [],
      }));
    },
    // Sem staleTime próprio herdava os 60s globais e, com refetchOnMount ligado,
    // re-baixava a lista paginada inteira a cada volta pra tela. As mutations de OS
    // já invalidam ['service_orders'], então a correção por tempo é redundante.
    staleTime: 5 * 60 * 1000,
  });
}

/** Visão geral por OS (view v_service_order_overview): pagamento (AP) + saldo de
 *  recebimento parcial. Devolve um Map keyed por service_order_id pra merge O(1)
 *  na lista de OS sem mexer no query principal (useServiceOrders). */
export interface ServiceOrderOverview {
  service_order_id: string;
  accounts_payable_id: string | null;
  payment_status: string | null; // 'pending' | 'paid' | null (sem AP)
  payable_amount: number | null;
  payment_due_date: string | null;
  payment_date: string | null;
  has_payable: boolean;
  is_paid: boolean;
  qty_sent: number | null;
  qty_returned_good: number | null;
  qty_returned_defect: number | null;
  qty_loss: number | null;
  qty_in_field: number | null;
  /** Defeito que ainda pode voltar ao prestador (não sucateado). */
  qty_defect_pending_rework?: number | null;
  /** Perda + sucata: o que a OS não entrega sem reposição de material. */
  qty_short?: number | null;
  last_return_at: string | null;
}

export function useServiceOrderOverview() {
  return useQuery({
    queryKey: ['service_order_overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_service_order_overview' as any)
        .select('*');
      if (error) throw error;
      const map = new Map<string, ServiceOrderOverview>();
      for (const row of (data as unknown as ServiceOrderOverview[])) {
        map.set(row.service_order_id, row);
      }
      return map;
    },
  });
}

export function useCreateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractor: Partial<Contractor>) => {
      const { data, error } = await supabase.from('contractors').insert(stripSearchNorm(contractor) as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contractors'] }); toast.success('Terceirizado cadastrado!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Contractor> & { id: string }) => {
      const { error } = await supabase.from('contractors').update(stripSearchNorm(updates) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contractors'] }); toast.success('Terceirizado atualizado!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: refuse delete if linked service_orders exist.
      // The FK is ON DELETE CASCADE which would silently wipe all OSes,
      // bypassing the artisanal-stock-entry protection in useDeleteServiceOrder.
      const { count, error: countErr } = await supabase
        .from('service_orders')
        .select('id', { count: 'exact', head: true })
        .eq('contractor_id', id);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        throw new Error(
          `Não é possível excluir: há ${count} ${count === 1 ? 'OS vinculada' : 'OSs vinculadas'}. Inative o prestador em vez de excluir.`,
        );
      }
      const { error } = await supabase.from('contractors').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contractors'] }); toast.success('Terceirizado removido!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Cria OU agrega numa OS ABERTA do mesmo contractor+recipe+output_color
 * (status<>Concluído/Cancelado e stock_entry_done=false). Soma forOrder e
 * appenda sale_order_id em linked_sale_order_ids. Use quando a criação for
 * automática a partir de shortage de PV.
 */
export function useUpsertOpenServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      contractor_id: string;
      artisanal_recipe_id: string;
      output_name: string;
      output_color: string;
      base_color?: string;
      for_order_meters: number;
      for_stock_meters: number;
      total_meters: number;
      base_product_name: string;
      base_meters_send: number;
      sale_order_id: string | null;
      unit_price: number;
    }) => {
      if (!p.contractor_id || !p.artisanal_recipe_id) throw new Error('contractor + recipe obrigatórios.');
      const { data: soId, error } = await (supabase as any).rpc('upsert_open_service_order', {
        p_contractor_id: p.contractor_id,
        p_artisanal_recipe_id: p.artisanal_recipe_id,
        p_output_name: p.output_name,
        p_output_color: p.output_color,
        p_base_color: p.base_color || p.output_color,
        p_for_order_meters: p.for_order_meters,
        p_for_stock_meters: p.for_stock_meters,
        p_total_meters: p.total_meters,
        p_base_product_name: p.base_product_name,
        p_base_meters_send: p.base_meters_send,
        p_sale_order_id: p.sale_order_id,
        p_unit_price: p.unit_price,
      });
      if (error) throw error;
      return soId as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      toast.success('OS atualizada/criada — pedido vinculado.');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCreateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: Partial<ServiceOrder>) => {
      if (order.unit_price !== undefined && (!Number.isFinite(Number(order.unit_price)) || Number(order.unit_price) < 0)) throw new Error('Preço unitário deve ser um número não-negativo.');
      if (order.quantity !== undefined && (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0)) throw new Error('Quantidade deve ser um número positivo.');
      const { data, error } = await supabase.from('service_orders').insert(stripSearchNorm(order) as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço criada!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Tarifa vigente (R$/par) de uma contratada para um setor — pré-preenche o preço
 *  da OS manual. Lê a linha de `contractor_service_rates` sem `valid_to` (a atual).
 *  queryKey começa em 'contractor_rate' → ContractorRatesDialog invalida ao cadastrar. */
export function useContractorSectorRate(contractorId: string | null | undefined, sector: string | null | undefined) {
  return useQuery({
    queryKey: ['contractor_rate', contractorId ?? null, sector ?? null],
    enabled: !!contractorId && !!sector,
    staleTime: 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase as any)
        .from('contractor_service_rates')
        .select('price_per_pair')
        .eq('contractor_id', contractorId)
        .eq('sector', sector)
        .is('valid_to', null)
        .order('valid_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.price_per_pair) : null;
    },
  });
}

export function useUpdateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ServiceOrder> & { id: string }) => {
      // Strip server-managed flags that gate deletion/stock guards so a user
      // cannot flip artisanal_stock_entry_done=false to bypass the useDeleteServiceOrder
      // guard that prevents deleting an OS whose stock entry was already committed.
      const {
        artisanal_stock_entry_done: _sed,
        receipt_generated_at: _rga,
        receipt_number: _rn,
        order_number: _on,
        search_norm: _sn, // coluna GENERATED (mig 20260911180000) — write com ela = erro
        ...safe
      } = updates as any;
      if (safe.status === '') throw new Error('Status inválido.');
      // Guarda de OS finalizada. Cobre TODAS as grafias de "concluída" ('Concluído',
      // 'received', 'finalizado'...) via isOsDone — antes o check era `=== 'Concluído'`
      // e vazava as OS finalizadas pelo fluxo de gargalos (auditoria 2026-07-02).
      if (safe.status && safe.status !== 'Cancelado') {
        const { data: current, error: currErr } = await supabase
          .from('service_orders').select('status, unit_price, total_value').eq('id', id).single();
        if (currErr) throw new Error(`Falha ao carregar OS: ${currErr.message}`);
        if (isOsDone(current?.status)) {
          // Editar valor de OS finalizada dessincroniza a conta a pagar (o trigger
          // só sincroniza AP 'pending'; se já foi paga, o valor pago diverge).
          const priceChanged =
            (safe.unit_price !== undefined && Math.abs(Number(safe.unit_price) - Number(current?.unit_price ?? 0)) > 0.005) ||
            (safe.total_value !== undefined && Math.abs(Number(safe.total_value) - Number(current?.total_value ?? 0)) > 0.005);
          if (priceChanged) throw new Error('OS já finalizada — cancele e reemita para alterar valores (editar agora dessincronizaria a conta a pagar).');
          // Rebaixar status de OS finalizada só pelo fluxo de Cancelar.
          if (!isOsDone(safe.status)) throw new Error('OS já concluída. Use a opção Cancelar para reverter.');
        }
      }
      // Atomic claim when transitioning to Concluído: prevent double AP/stock debit
      // if two browser tabs save simultaneously from a stale 'Pendente' cache.
      let q = supabase.from('service_orders').update(safe).eq('id', id);
      if (safe.status === 'Concluído') {
        q = (q as any).not('status', 'in', '("Concluído","Cancelado")');
      }
      const { data: rows, error } = await (q as any).select('id');
      if (error) throw error;
      if (safe.status === 'Concluído' && (!rows || rows.length === 0)) {
        throw new Error('OS já concluída ou cancelada — recarregue a página.');
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço atualizada!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: os, error: fetchErr } = await supabase
        .from('service_orders')
        .select('artisanal_stock_entry_done, status, materials_sent')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (os?.artisanal_stock_entry_done) {
        throw new Error(
          'Não é possível excluir uma OS com saída já lançada. ' +
          'O estoque debitado não seria restaurado. Cancele a OS manualmente se necessário.'
        );
      }
      // #10: Bloqueia exclusão quando há histórico de envio/retorno (pares na rua):
      // o FK ON DELETE CASCADE apagaria o ledger de dispatches/returns em silêncio,
      // perdendo a rastreabilidade dos pares em campo. Oriente a cancelar.
      // (supabase as any): service_order_dispatches ainda não está no types.ts
      // gerado (criada via migration MCP) — mesmo padrão do ServiceOrderDispatchDialog.
      const [dispRes, retRes] = await Promise.all([
        (supabase as any).from('service_order_dispatches').select('id', { count: 'exact', head: true }).eq('service_order_id', id),
        (supabase as any).from('service_order_returns').select('id', { count: 'exact', head: true }).eq('service_order_id', id),
      ]);
      if (dispRes.error) throw new Error(`Falha ao verificar envios da OS: ${dispRes.error.message}`);
      if (retRes.error) throw new Error(`Falha ao verificar retornos da OS: ${retRes.error.message}`);
      if ((dispRes.count || 0) > 0 || (retRes.count || 0) > 0) {
        throw new Error(
          'Não é possível excluir: esta OS tem envios/retornos registrados (pares na rua). ' +
          'Cancele a OS em vez de excluir para preservar o histórico.'
        );
      }
      // #8: Bloqueia exclusão quando há materiais debitados e a OS não foi cancelada
      // (a exclusão não restitui o estoque). Cancele primeiro — o cancelamento estorna
      // os materiais — e então exclua.
      const mats = Array.isArray(os?.materials_sent) ? (os!.materials_sent as any[]) : [];
      const hasDebitedMaterials = mats.some(m => m && Number(m.meters) > 0);
      if (hasDebitedMaterials && os?.status !== 'Cancelado') {
        throw new Error(
          'Não é possível excluir: esta OS tem materiais debitados do estoque. ' +
          'Cancele a OS primeiro (o cancelamento estorna os materiais) e depois exclua.'
        );
      }
      // Block deletion if there's an active AP linked to this service order.
      // Deleting would orphan the financial record.
      // CRITICAL: capture the error. A silent SELECT failure (RLS / network) yielded
      // existingAP===null, bypassing the guard and leaving an orphan AP after the OS delete.
      const { data: existingAP, error: apErr } = await supabase
        .from('accounts_payable')
        .select('id')
        .eq('reference_type', 'service_order')
        .eq('reference_id', id)
        .neq('status', 'cancelled')
        .limit(1);
      if (apErr) throw new Error(`Falha ao verificar conta a pagar vinculada: ${apErr.message}`);
      if (existingAP && existingAP.length > 0) {
        throw new Error(
          'Não é possível excluir: existe uma conta a pagar vinculada a esta OS. ' +
          'Cancele a conta a pagar antes de excluir a OS.'
        );
      }
      const { error } = await supabase.from('service_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); qc.invalidateQueries({ queryKey: ['service_order_overview'] }); toast.success('Ordem de serviço removida!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * P0.3 (2026-07): recebimento TOTAL em lote — insere um retorno com o saldo na
 * rua de cada OS selecionada. A cadeia EXISTENTE faz o resto:
 * tg_apply_service_order_return → status 'Concluído' → tg_create_ap_for_service_order
 * → conta a pagar pelos pares bons (com guarda FÁBRICA payment_days≥999 e
 * anti-duplicata). Perda/defeito usa o ServiceOrderReturnDialog individual —
 * o lote assume retorno 100% bom (caso comum da triagem).
 * OS divididas (dispatch_tracked) são puladas: exigem retorno por prestador.
 */
export function useBulkReceiveServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orders: Array<Pick<ServiceOrder, 'id' | 'order_number' | 'quantity' | 'dispatch_tracked'>>) => {
      let ok = 0;
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const o of orders) {
        try {
          if (o.dispatch_tracked) { skipped.push(o.order_number); continue; }
          // Mesmo caminho único dos recebimentos individuais (registra retorno,
          // triggers fecham a OS e pagam por pares bons).
          const { skipped: noBalance } = await receiveServiceOrderFully(o.id, {
            fallbackQuantity: Number(o.quantity ?? 0),
          });
          if (noBalance) { skipped.push(o.order_number); continue; }
          ok++;
        } catch (e: any) {
          console.error('Receber em lote falhou na OS', o.order_number, e);
          failed.push(o.order_number);
        }
      }
      return { ok, skipped, failed };
    },
    onSuccess: ({ ok, skipped, failed }) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_history_orders'] });
      const parts = [`${ok} OS recebida(s) — conta a pagar gerada pelos pares bons.`];
      if (skipped.length > 0) parts.push(`${skipped.length} pulada(s) (dividida ou sem saldo): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);
      if (failed.length > 0) parts.push(`falhou em: ${failed.join(', ')}`);
      (failed.length > 0 ? toast.warning : toast.success)(parts.join(' '));
    },
    onError: (e: any) => toast.error(`Falha no recebimento em lote: ${e.message}`),
  });
}

/**
 * P0.3 (2026-07): arquiva OS da triagem (soft-archive via archived_at — NÃO é um
 * status: grafia desconhecida normalizaria pra Pendente em osStatusMachine).
 * Some das listagens default; histórico preservado; reversível via SQL.
 */
export function useArchiveServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase as any)
        .from('service_orders')
        .update({ archived_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n: number) => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['service_order_overview'] });
      toast.success(`${n} OS arquivada(s) — use "Mostrar arquivadas" pra revê-las.`);
    },
    onError: (e: any) => toast.error(`Falha ao arquivar: ${e.message}`),
  });
}
