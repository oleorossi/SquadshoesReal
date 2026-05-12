/**
 * Hooks de gestão 360° do grupo econômico — usado pela página
 * /grupos-economicos/:id (EconomicGroupDetail). Cobre: KPIs, crédito
 * consolidado (com aging), contatos, notas, anexos, audit log.
 *
 * Separado do useClients.ts pra não inflar o módulo principal de clientes;
 * essas queries só carregam quando a página detail está aberta.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Tipos ──────────────────────────────────────────────────────────────

export type ContactRole = 'Comprador' | 'Financeiro' | 'Logística' | 'Diretor' | 'Comercial' | 'Suporte' | 'Outro';
export type NoteType = 'geral' | 'reunião' | 'ligação' | 'email' | 'visita' | 'whatsapp' | 'incidente' | 'oportunidade';

export interface EconomicGroupKpis {
  economic_group_id: string;
  group_name: string;
  orders_12m: number;
  revenue_12m: number;
  avg_ticket: number;
  avg_days_to_pay: number;
  share_of_wallet_pct: number;
  last_order_at: string | null;
}

export interface EconomicGroupCredit {
  economic_group_id: string;
  group_name: string;
  credit_limit: number;
  total_clients: number;
  total_matriz: number;
  ar_open_total: number;
  ar_a_vencer: number;
  ar_atraso_0_30: number;
  ar_atraso_30_60: number;
  ar_atraso_60_90: number;
  ar_atraso_90_mais: number;
  credit_available: number;
}

export interface EconomicGroupContact {
  id: string;
  economic_group_id: string;
  role: ContactRole;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface EconomicGroupNote {
  id: string;
  economic_group_id: string;
  content: string;
  note_type: NoteType;
  created_at: string;
  created_by: string | null;
}

export interface EconomicGroupAttachment {
  id: string;
  economic_group_id: string;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  description: string | null;
  created_at: string;
  created_by: string | null;
}

export interface EconomicGroupAuditEntry {
  id: string;
  economic_group_id: string;
  changed_at: string;
  changed_by: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
}

// ─── Single group fetch ─────────────────────────────────────────────────

export function useEconomicGroupById(id: string | undefined) {
  return useQuery({
    queryKey: ['economic_group', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('economic_groups')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

// ─── KPIs + Crédito ─────────────────────────────────────────────────────

export function useEconomicGroupKpis(id: string | undefined) {
  return useQuery({
    queryKey: ['v_economic_group_kpis', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupKpis | null> => {
      const { data, error } = await (supabase as any)
        .from('v_economic_group_kpis')
        .select('*')
        .eq('economic_group_id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useEconomicGroupCredit(id: string | undefined) {
  return useQuery({
    queryKey: ['v_economic_group_credit', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupCredit | null> => {
      const { data, error } = await (supabase as any)
        .from('v_economic_group_credit')
        .select('*')
        .eq('economic_group_id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ─── Clientes do grupo ──────────────────────────────────────────────────

export function useEconomicGroupClients(id: string | undefined) {
  return useQuery({
    queryKey: ['clients_by_group', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('clients')
        .select('id, razao_social, nome_fantasia, cnpj, cidade, estado, telefone, email, is_matriz, credit_limit, commercial_block, active')
        .eq('economic_group_id', id)
        .order('is_matriz', { ascending: false })
        .order('razao_social');
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Pedidos do grupo (via JOIN clients) ────────────────────────────────

export function useEconomicGroupOrders(id: string | undefined) {
  return useQuery({
    queryKey: ['sale_orders_by_group', id],
    enabled: !!id,
    queryFn: async () => {
      // Fetch client IDs do grupo, depois sale_orders desses clientes.
      // Não dá pra JOIN direto em sale_orders pq não tem economic_group_id lá.
      const { data: clients } = await (supabase as any)
        .from('clients')
        .select('id, razao_social')
        .eq('economic_group_id', id);
      const clientIds = (clients || []).map((c: any) => c.id);
      if (clientIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('sale_orders')
        .select('id, order_number, client_id, client_name, status, total, delivery_deadline, created_at, nfe')
        .in('client_id', clientIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── AR consolidada (lista de boletos abertos do grupo) ────────────────

export function useEconomicGroupAR(id: string | undefined) {
  return useQuery({
    queryKey: ['ar_by_group', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: clients } = await (supabase as any)
        .from('clients')
        .select('id')
        .eq('economic_group_id', id);
      const clientIds = (clients || []).map((c: any) => c.id);
      if (clientIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('accounts_receivable')
        .select('id, sale_order_id, client_id, client_name, description, due_date, amount, amount_received, status, payment_date, installment_number, total_installments')
        .in('client_id', clientIds)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Contatos ───────────────────────────────────────────────────────────

export function useEconomicGroupContacts(id: string | undefined) {
  return useQuery({
    queryKey: ['economic_group_contacts', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupContact[]> => {
      const { data, error } = await (supabase as any)
        .from('economic_group_contacts')
        .select('*')
        .eq('economic_group_id', id)
        .order('is_primary', { ascending: false })
        .order('role')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });
}

export function useUpsertEconomicGroupContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contact: Partial<EconomicGroupContact> & { economic_group_id: string }) => {
      if (contact.id) {
        const { id, ...rest } = contact;
        const { error } = await (supabase as any)
          .from('economic_group_contacts')
          .update(rest)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('economic_group_contacts')
          .insert(contact);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['economic_group_contacts', vars.economic_group_id] });
      toast.success('Contato salvo');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteEconomicGroupContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, groupId }: { id: string; groupId: string }) => {
      const { error } = await (supabase as any).from('economic_group_contacts').delete().eq('id', id);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_contacts', groupId] });
      toast.success('Contato removido');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Notas (CRM-style) ──────────────────────────────────────────────────

export function useEconomicGroupNotes(id: string | undefined) {
  return useQuery({
    queryKey: ['economic_group_notes', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupNote[]> => {
      const { data, error } = await (supabase as any)
        .from('economic_group_notes')
        .select('*')
        .eq('economic_group_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCreateEconomicGroupNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, content, type }: { groupId: string; content: string; type: NoteType }) => {
      const { error } = await (supabase as any)
        .from('economic_group_notes')
        .insert({ economic_group_id: groupId, content, note_type: type });
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_notes', groupId] });
      toast.success('Nota registrada');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteEconomicGroupNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, groupId }: { id: string; groupId: string }) => {
      const { error } = await (supabase as any).from('economic_group_notes').delete().eq('id', id);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_notes', groupId] });
      toast.success('Nota removida');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Anexos ─────────────────────────────────────────────────────────────

export function useEconomicGroupAttachments(id: string | undefined) {
  return useQuery({
    queryKey: ['economic_group_attachments', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupAttachment[]> => {
      const { data, error } = await (supabase as any)
        .from('economic_group_attachments')
        .select('*')
        .eq('economic_group_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useUploadEconomicGroupAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, file, description }: { groupId: string; file: File; description?: string }) => {
      // Sanitiza nome: remove acentos/espaços pra evitar 400 do Storage com keys exóticas
      const safeName = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]/g, '_');
      const path = `${groupId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from('economic-group-attachments').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('economic-group-attachments').getPublicUrl(path);
      const { error } = await (supabase as any)
        .from('economic_group_attachments')
        .insert({
          economic_group_id: groupId,
          file_url: pub.publicUrl,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          description: description || null,
        });
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_attachments', groupId] });
      toast.success('Anexo enviado');
    },
    onError: (err: Error) => toast.error(`Erro no upload: ${err.message}`),
  });
}

export function useDeleteEconomicGroupAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, groupId }: { id: string; groupId: string }) => {
      const { error } = await (supabase as any).from('economic_group_attachments').delete().eq('id', id);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_attachments', groupId] });
      toast.success('Anexo removido');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Audit log ──────────────────────────────────────────────────────────

export function useEconomicGroupAuditLog(id: string | undefined) {
  return useQuery({
    queryKey: ['economic_group_audit_log', id],
    enabled: !!id,
    queryFn: async (): Promise<EconomicGroupAuditEntry[]> => {
      const { data, error } = await (supabase as any)
        .from('economic_group_audit_log')
        .select('*')
        .eq('economic_group_id', id)
        .order('changed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Update grupo (com TODOS campos novos) ──────────────────────────────

export function useUpdateEconomicGroupFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      // Limpa strings vazias → null pra UUIDs e numerics
      const cleaned: Record<string, any> = { ...data };
      for (const k of Object.keys(cleaned)) {
        if (cleaned[k] === '') cleaned[k] = null;
      }
      const { error } = await (supabase as any).from('economic_groups').update(cleaned).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['economic_groups'] });
      qc.invalidateQueries({ queryKey: ['economic_group', vars.id] });
      qc.invalidateQueries({ queryKey: ['economic_group_audit_log', vars.id] });
      toast.success('Grupo atualizado');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Helper: marcar matriz (1 por grupo) ────────────────────────────────

export function useSetClientAsMatriz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, groupId }: { clientId: string; groupId: string }) => {
      // Tira matriz de todos os outros clientes do grupo
      const { error: clearErr } = await (supabase as any)
        .from('clients')
        .update({ is_matriz: false })
        .eq('economic_group_id', groupId);
      if (clearErr) throw clearErr;
      // Marca este como matriz
      const { error } = await (supabase as any)
        .from('clients')
        .update({ is_matriz: true })
        .eq('id', clientId);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['clients_by_group', groupId] });
      qc.invalidateQueries({ queryKey: ['v_economic_group_credit', groupId] });
      toast.success('Matriz definida');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Helper: defaults comerciais (precedência cliente > grupo) ──────────

export interface ClientCommercialDefaults {
  price_list_id: string | null;
  payment_condition: string | null;
  factoring_config_id: string | null;
  modalidade_frete: string | null;
  transport_company_id: string | null;
  discount_pct: number;
  credit_limit: number;
  block_new_orders: boolean;
  block_reason: string | null;
  inherited_from: string;
}

export function useClientCommercialDefaults(clientId: string | undefined) {
  return useQuery({
    queryKey: ['client_commercial_defaults', clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientCommercialDefaults | null> => {
      const { data, error } = await (supabase as any).rpc('get_client_commercial_defaults', { p_client_id: clientId });
      if (error) throw error;
      return data?.[0] || null;
    },
    staleTime: 60_000,
  });
}
