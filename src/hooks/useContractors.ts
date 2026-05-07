import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  // Artisanal production fields
  artisanal_recipe_id?: string | null;
  artisanal_output_name?: string | null;
  artisanal_output_color?: string | null;
  artisanal_output_meters?: number;
  artisanal_for_order_meters?: number;
  artisanal_for_stock_meters?: number;
  artisanal_base_color?: string | null;
  artisanal_stock_entry_done?: boolean;
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
      const { data, error } = await supabase
        .from('service_orders')
        .select('*, contractors(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as ServiceOrder[]).map(o => ({
        ...o,
        materials_sent: Array.isArray(o.materials_sent) ? o.materials_sent : [],
      }));
    },
  });
}

export function useCreateContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contractor: Partial<Contractor>) => {
      const { data, error } = await supabase.from('contractors').insert(contractor as any).select().single();
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
      const { error } = await supabase.from('contractors').update(updates as any).eq('id', id);
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
          `Não é possível excluir: há ${count} OS(s) vinculada(s). Inative o prestador em vez de excluir.`,
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
      qc.invalidateQueries({ queryKey: ['service_orders'] });
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
      const { data, error } = await supabase.from('service_orders').insert(order as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); toast.success('Ordem de serviço criada!'); },
    onError: (e: any) => toast.error(e.message),
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
        ...safe
      } = updates as any;
      if (safe.status === '') throw new Error('Status inválido.');
      // Block downgrading a 'Concluído' OS to an earlier state without going through
      // the explicit cancel flow (which reverses AP and artisanal stock).
      if (safe.status && safe.status !== 'Cancelado') {
        const { data: current, error: currErr } = await supabase.from('service_orders').select('status').eq('id', id).single();
        if (currErr) throw new Error(`Falha ao carregar OS: ${currErr.message}`);
        if (current?.status === 'Concluído') throw new Error('OS já concluída. Use a opção Cancelar para reverter.');
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); toast.success('Ordem de serviço atualizada!'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: os, error: fetchErr } = await supabase
        .from('service_orders')
        .select('artisanal_stock_entry_done')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (os?.artisanal_stock_entry_done) {
        throw new Error(
          'Não é possível excluir uma OS com saída já lançada. ' +
          'O estoque debitado não seria restaurado. Cancele a OS manualmente se necessário.'
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service_orders'] }); toast.success('Ordem de serviço removida!'); },
    onError: (e: any) => toast.error(e.message),
  });
}
