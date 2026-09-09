import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getISODay, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchFinancialRows } from '@/lib/financialPagination';
import { isCfoDate } from '@/lib/cfoDates';
import { useCan } from '@/hooks/useAccessControl';
import type { CfoEntry, CfoEntryInput, CfoOrder, CfoOrderInput, CfoPlan, CfoPlanInput, CfoWeekInput, CfoWeekSaveInput } from '@/types/cfo';

interface CfoTable<Row, Input> {
  Row: { [Key in keyof Row]: Row[Key] };
  Insert: { [Key in keyof Input]: Input[Key] };
  Update: { [Key in keyof Input]?: Input[Key] };
  Relationships: [];
}

// Contrato local da migration CFO; o arquivo global de tipos é gerado.
interface CfoDatabase {
  public: {
    Tables: {
      cfo_planos: CfoTable<CfoPlan, CfoPlanInput>;
      cfo_pedidos: CfoTable<CfoOrder, CfoOrderInput>;
      cfo_lancamentos: CfoTable<CfoEntry, CfoEntryInput>;
      cfo_semanas: CfoTable<CfoWeekInput, CfoWeekSaveInput>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

const cfoDb = supabase as unknown as SupabaseClient<CfoDatabase>;
const queryTimes = { staleTime: 30_000, gcTime: 5 * 60_000 };

export interface CfoSaleOrder {
  id: string;
  order_number: string;
  client_name: string;
  total: number;
  delivery_date: string | null;
}

function throwCfoError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === '23503') throw new Error('O vínculo é inválido ou há lançamentos vinculados. Para preservar o histórico, cancele o pedido em vez de excluí-lo.');
  if (error.code === '42501') throw new Error('Seu acesso ao Financeiro não permite esta ação.');
  if (error.code === 'PGRST116') throw new Error('O registro não está mais disponível ou você não tem permissão para alterá-lo. Atualize a página.');
  if (error.code === '23514' || error.code === '23502' || error.code === '22003' || error.code === '22007' || error.code === '22008') {
    throw new Error('Confira datas e valores. O período deve ter até dois anos, e um lançamento realizado exige data e valor realizados.');
  }
  throw new Error('Não foi possível salvar a alteração no CFO. Tente novamente.');
}

function requirePermission(allowed: boolean) {
  if (!allowed) throw new Error('Seu acesso ao Financeiro não permite esta ação.');
}

function validateAmounts(values: (number | null)[]) {
  if (values.some(value => value !== null && !Number.isFinite(value))) {
    throw new Error('Preencha os valores com números válidos.');
  }
}

export function useCfoPlans() {
  const permission = useCan('/financeiro');
  return useQuery({
    queryKey: ['cfo-plans'],
    ...queryTimes,
    enabled: !permission.loading && permission.canView,
    queryFn: async () => {
      const rows = await fetchFinancialRows<CfoPlan>((from, to) => cfoDb.from('cfo_planos')
        .select('*', { count: 'exact' }).order('id').range(from, to));
      return rows.sort((a, b) => b.data_inicio.localeCompare(a.data_inicio) || a.nome.localeCompare(b.nome));
    },
  });
}

export function useCfoOrders(planId?: string | null) {
  const permission = useCan('/financeiro');
  return useQuery({
    queryKey: ['cfo-orders', planId],
    ...queryTimes,
    enabled: !!planId && !permission.loading && permission.canView,
    queryFn: async () => {
      const rows = await fetchFinancialRows<CfoOrder>((from, to) => cfoDb.from('cfo_pedidos')
        .select('*', { count: 'exact' }).eq('plano_id', planId!).order('id').range(from, to));
      return rows.sort((a, b) => a.entrega_em.localeCompare(b.entrega_em) || a.id.localeCompare(b.id));
    },
  });
}

export function useCfoEntries(planId?: string | null) {
  const permission = useCan('/financeiro');
  return useQuery({
    queryKey: ['cfo-entries', planId],
    ...queryTimes,
    enabled: !!planId && !permission.loading && permission.canView,
    queryFn: async () => {
      const rows = await fetchFinancialRows<CfoEntry>((from, to) => cfoDb.from('cfo_lancamentos')
        .select('*', { count: 'exact' }).eq('plano_id', planId!).order('id').range(from, to));
      return rows.sort((a, b) => a.data_prevista.localeCompare(b.data_prevista) || a.id.localeCompare(b.id));
    },
  });
}

export function useCfoSaleOrders() {
  const permission = useCan('/financeiro');
  return useQuery({
    queryKey: ['cfo-sale-orders'],
    ...queryTimes,
    enabled: !permission.loading && permission.canView,
    queryFn: () => fetchFinancialRows<CfoSaleOrder>((from, to) => supabase.from('sale_orders')
      .select('id, order_number, client_name, total, delivery_date:delivery_deadline', { count: 'exact' })
      .is('deleted_at', null).order('id').range(from, to)),
  });
}

export function useCfoWeeks(planId?: string | null) {
  const permission = useCan('/financeiro');
  return useQuery({
    queryKey: ['cfo-weeks', planId],
    ...queryTimes,
    enabled: !!planId && !permission.loading && permission.canView,
    queryFn: async () => {
      const rows = await fetchFinancialRows<CfoWeekInput>((from, to) => cfoDb.from('cfo_semanas')
        .select('*', { count: 'exact' }).eq('plano_id', planId!).order('id').range(from, to));
      return rows.sort((a, b) => a.semana_inicio.localeCompare(b.semana_inicio));
    },
  });
}

export function useSaveCfoWeek() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, ...input }: CfoWeekSaveInput) => {
      requirePermission(id ? permission.canEdit : permission.canCreate);
      if (!isCfoDate(input.semana_inicio) || getISODay(parseISO(input.semana_inicio)) !== 1) {
        throw new Error('Informe a segunda-feira que inicia a semana.');
      }
      if (!Number.isFinite(input.contas_semana) || input.contas_semana < 0
          || !Number.isFinite(input.reinvestimento) || input.reinvestimento < 0) {
        throw new Error('Informe os valores das contas da semana e do reinvestimento. Use zero quando não houver valor.');
      }
      if (input.pares_produzidos !== null && (!Number.isInteger(input.pares_produzidos)
          || input.pares_produzidos < 0 || input.pares_produzidos > 2_147_483_647)) {
        throw new Error('Informe uma quantidade inteira de pares entre zero e 2.147.483.647, ou deixe a produção em branco.');
      }
      const query = id ? cfoDb.from('cfo_semanas').update(input).eq('id', id).eq('plano_id', input.plano_id) : cfoDb.from('cfo_semanas').insert(input);
      const { data, error } = await query.select('*').single();
      if (error?.code === '23505') throw new Error('Esta semana já foi preenchida. Atualize a projeção para editar os valores salvos.');
      throwCfoError(error);
      return data as CfoWeekInput;
    },
    onSuccess: async (data) => {
      const queryKey = ['cfo-weeks', data.plano_id];
      qc.setQueryData<CfoWeekInput[]>(queryKey, current => [
        ...(current ?? []).filter(row => row.plano_id === data.plano_id
          && row.id !== data.id && row.semana_inicio !== data.semana_inicio),
        data,
      ].sort((a, b) => a.semana_inicio.localeCompare(b.semana_inicio)));
      await qc.invalidateQueries({ queryKey });
      toast.success('Valores da semana salvos!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSaveCfoPlan() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, ...input }: CfoPlanInput) => {
      requirePermission(id ? permission.canEdit : permission.canCreate);
      validateAmounts([input.saldo_inicial, input.reserva_minima]);
      const query = id ? cfoDb.from('cfo_planos').update(input).eq('id', id) : cfoDb.from('cfo_planos').insert(input);
      const { data, error } = await query.select('*').single();
      throwCfoError(error);
      return data as CfoPlan;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cfo-plans'] });
      toast.success('Planejamento salvo!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSaveCfoOrder() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, ...input }: CfoOrderInput) => {
      requirePermission(id ? permission.canEdit : permission.canCreate);
      validateAmounts([input.lucro_informado, input.receita_total]);
      const query = id ? cfoDb.from('cfo_pedidos').update(input).eq('id', id).eq('plano_id', input.plano_id) : cfoDb.from('cfo_pedidos').insert(input);
      const { data, error } = await query.select('*').single();
      throwCfoError(error);
      return data as CfoOrder;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cfo-orders', data.plano_id] });
      toast.success('Pedido salvo no planejamento!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSaveCfoEntry() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, ...input }: CfoEntryInput) => {
      requirePermission(id ? permission.canEdit : permission.canCreate);
      validateAmounts([input.valor_previsto, input.valor_realizado]);
      const query = id ? cfoDb.from('cfo_lancamentos').update(input).eq('id', id).eq('plano_id', input.plano_id) : cfoDb.from('cfo_lancamentos').insert(input);
      const { data, error } = await query.select('*').single();
      throwCfoError(error);
      return data as CfoEntry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cfo-entries', data.plano_id] });
      toast.success('Lançamento salvo!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Repetições são inseridas em uma transação; nenhum lançamento parcial fica salvo. */
export function useCreateCfoEntries() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async (inputs: CfoEntryInput[]) => {
      requirePermission(permission.canCreate);
      if (!inputs.length || inputs.length > 105 || inputs.some(input => input.id || input.plano_id !== inputs[0].plano_id)) {
        throw new Error('Informe de 1 a 105 lançamentos novos do mesmo planejamento.');
      }
      inputs.forEach(input => validateAmounts([input.valor_previsto, input.valor_realizado]));
      const { data, error } = await cfoDb.from('cfo_lancamentos').insert(inputs).select('*');
      throwCfoError(error);
      return data as CfoEntry[];
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cfo-entries', data[0].plano_id] });
      toast.success(data.length === 1 ? 'Lançamento salvo!' : `${data.length} lançamentos salvos!`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteCfoOrder() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, plano_id }: { id: string; plano_id: string }) => {
      requirePermission(permission.canDelete);
      const { data, error } = await cfoDb.from('cfo_pedidos').delete().eq('id', id).eq('plano_id', plano_id).select('*').single();
      throwCfoError(error);
      return data as CfoOrder;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cfo-orders', data.plano_id] });
      toast.success('Pedido excluído do planejamento!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteCfoEntry() {
  const qc = useQueryClient();
  const permission = useCan('/financeiro');
  return useMutation({
    mutationFn: async ({ id, plano_id }: { id: string; plano_id: string }) => {
      requirePermission(permission.canDelete);
      const { data, error } = await cfoDb.from('cfo_lancamentos').delete().eq('id', id).eq('plano_id', plano_id).select('*').single();
      throwCfoError(error);
      return data as CfoEntry;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['cfo-entries', data.plano_id] });
      toast.success('Lançamento excluído!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
