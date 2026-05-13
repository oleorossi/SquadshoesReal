import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NfeStatus = 'processando' | 'autorizada' | 'cancelada' | 'rejeitada' | 'erro';

export interface NfeEmitida {
  id: string;
  sale_order_id: string | null;
  company_id: string | null;
  ref_nfe: string;
  status: NfeStatus;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  xml_url: string | null;
  danfe_url: string | null;
  valor_total: number;
  data_emissao: string | null;
  motivo_rejeicao: string | null;
  protocolo: string | null;
  protocolo_cancelamento: string | null;
  cnpj_emitente: string | null;
  justificativa_cancelamento: string | null;
  data_cancelamento: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  cnpj: string;
  inscricao_estadual: string;
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  codigo_municipio: string;
  regime_tributario: string;
  serie_nfe: number;
  ambiente: string;
  certificate_path: string;
  natureza_operacao: string;
  cfop: string;
  is_primary: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── NF-e Emitidas ───────────────────────────────────────────────────────────

export function useNfeEmitidas(saleOrderId?: string) {
  return useQuery({
    queryKey: ['nfe_emitidas', saleOrderId],
    queryFn: async () => {
      let query = supabase
        .from('nfe_emitidas')
        .select('*')
        .order('created_at', { ascending: false });
      if (saleOrderId) query = query.eq('sale_order_id', saleOrderId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as NfeEmitida[];
    },
  });
}

export function useAllNfeEmitidas(filters?: { status?: string; search?: string; company_id?: string }) {
  return useQuery({
    queryKey: ['nfe_emitidas_all', filters],
    // staleTime=0 garante refetch ao montar — evita cache vencido depois de sync.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      let query = supabase
        .from('nfe_emitidas')
        .select('*, sale_orders!nfe_emitidas_sale_order_id_fkey(order_number, client_name, total)')
        .order('created_at', { ascending: false });
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.company_id) query = query.eq('company_id', filters.company_id);
      query = query.limit(500);
      const { data, error } = await query;
      if (error) {
        // Log com detalhes pra DevTools — facilita debug quando lista fica vazia.
        console.error('[useAllNfeEmitidas] error:', error);
        throw error;
      }
      console.info(`[useAllNfeEmitidas] ${data?.length ?? 0} NF-es carregadas`);
      return data || [];
    },
  });
}

// ─── Fiscal Config ───────────────────────────────────────────────────────────

export function useFiscalConfig() {
  return useQuery({
    queryKey: ['fiscal_config'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fiscal_config').select('*').limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
  });
}

export function useSaveFiscalConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: any) => {
      const { data: existing, error: selErr } = await supabase.from('fiscal_config').select('id').limit(1);
      if (selErr) throw new Error(`Falha ao consultar config fiscal existente: ${selErr.message}`);
      if (existing && existing.length > 0) {
        const { error } = await supabase.from('fiscal_config').update(config).eq('id', existing[0].id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fiscal_config').insert(config);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_config'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Configuração fiscal salva!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Companies ───────────────────────────────────────────────────────────────

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('active', true)
        .order('is_primary', { ascending: false })
        .order('razao_social');
      if (error) throw error;
      return (data || []) as Company[];
    },
  });
}

export function useSaveCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (company: Partial<Company> & { id?: string }) => {
      const { id, created_at, updated_at, ...data } = company as any;
      if (id) {
        const { error } = await supabase.from('companies').update(data).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('companies').insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Empresa salva com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Also clear is_primary so an inactive row doesn't block the
      // uq_companies_single_primary index and leave the system with no active primary.
      const { error } = await supabase.from('companies').update({ active: false, is_primary: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Empresa removida.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useSetPrimaryCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Clear all primaries first (brief window with zero primary is safer than
      // two primaries — emit-nfe falls back to fiscal_config when none found).
      const { error: clearErr } = await supabase
        .from('companies')
        .update({ is_primary: false })
        .eq('active', true);
      if (clearErr) throw clearErr;
      // Set the new primary — add .eq('active', true) so an inactive company
      // can never become primary (emit-nfe queries active+primary; an inactive
      // primary row produces a "no active primary" fallback to fiscal_config).
      const { data: set, error } = await supabase
        .from('companies')
        .update({ is_primary: true })
        .eq('id', id)
        .eq('active', true)
        .select('id');
      if (error) throw error;
      if (!set || set.length === 0) {
        throw new Error('Empresa inativa — ative-a antes de definir como principal.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Empresa principal definida!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Emit / Status / Cancel ──────────────────────────────────────────────────

export interface StandaloneNfeItem {
  product_id: string;
  color: string;
  quantity: number;
  unit_price: number;
  grade: Record<string, number>;
}

export interface StandaloneNfePayload {
  clientId: string;
  companyId?: string;
  items: StandaloneNfeItem[];
  notes?: string;
}

// Cria PV is_standalone_nfe=true com items via product_id e dispara emit-nfe.
// emit-nfe edge function já foi adaptada (commit b8b1...): lê de products
// quando reference_id é NULL.
export function useEmitStandaloneNfe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: StandaloneNfePayload) => {
      if (!payload.clientId) throw new Error('Selecione um cliente');
      if (payload.items.length === 0) throw new Error('Adicione ao menos um item');
      if (payload.items.some(i => !i.product_id || i.quantity <= 0 || i.unit_price <= 0)) {
        throw new Error('Itens devem ter produto, quantidade e preço > 0');
      }

      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('id, razao_social, cnpj')
        .eq('id', payload.clientId)
        .maybeSingle();
      if (clientErr || !clientRow) throw new Error('Cliente não encontrado');

      const total = payload.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const orderNumber = `NF-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

      const { data: so, error: soErr } = await supabase
        .from('sale_orders')
        .insert({
          order_number: orderNumber,
          client_order_number: orderNumber,
          client_id: clientRow.id,
          client_name: clientRow.razao_social,
          client_cnpj: clientRow.cnpj,
          status: 'Faturado',
          total,
          is_standalone_nfe: true,
          nfe_required: true,
          notes: payload.notes || 'NF Avulsa — emitida diretamente sem PV de produção.',
        } as any)
        .select('id')
        .single();
      if (soErr || !so) throw new Error(`Erro ao criar PV avulso: ${soErr?.message}`);

      const itemRows = payload.items.map(i => ({
        sale_order_id: so.id,
        product_id: i.product_id,
        color: i.color || null,
        quantity: i.quantity,
        unit_price: i.unit_price,
        grade: i.grade,
        fichas: i.quantity,
      }));
      const { error: itemsErr } = await supabase.from('sale_order_items').insert(itemRows as any);
      if (itemsErr) {
        await supabase.from('sale_orders').delete().eq('id', so.id);
        throw new Error(`Erro ao criar itens: ${itemsErr.message}`);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
      const { data: nfeData, error: nfeErr } = await supabase.functions.invoke('emit-nfe', {
        body: { sale_order_id: so.id, company_id: payload.companyId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // Idem useEmitNfe: prioriza mensagem real do body antes do HTTP error genérico.
      if (nfeData?.error) throw new Error(nfeData.error);
      if (nfeErr) {
        let realMsg: string | null = null;
        const ctx = (nfeErr as any).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) realMsg = String(body.error);
            else if (typeof body === 'string') realMsg = body;
          } catch { /* não-JSON */ }
        }
        if (!realMsg && ctx && typeof ctx.text === 'function') {
          try {
            const txt = await ctx.text();
            if (txt) realMsg = txt.slice(0, 500);
          } catch { /* ignore */ }
        }
        if (realMsg) throw new Error(realMsg);
        throw new Error((nfeErr as any).message || 'Erro desconhecido ao emitir NF avulsa');
      }
      return { sale_order_id: so.id, ...nfeData };
    },
    onSuccess: () => {
      toast.success('NF Avulsa enviada para processamento!');
    },
    onError: (err: Error) => toast.error(`Erro ao emitir NF Avulsa: ${err.message}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
    },
  });
}

export function useEmitNfe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderId, companyId }: { saleOrderId: string; companyId?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
      const { data, error } = await supabase.functions.invoke('emit-nfe', {
        body: { sale_order_id: saleOrderId, company_id: companyId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // Em non-2xx, supabase-js seta error = FunctionsHttpError (mensagem
      // genérica "non-2xx status code") MAS data ainda traz o body parsed.
      // Checa data.error primeiro pra mostrar a mensagem REAL da edge fn.
      if (data?.error) throw new Error(data.error);
      if (error) {
        // FunctionsHttpError tem error.context (Response). Lê o body antes de
        // desistir e mostrar mensagem genérica. NÃO usa try/throw aninhado
        // (o throw interno cai no próprio catch e se perde silenciosamente).
        let realMsg: string | null = null;
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) realMsg = String(body.error);
            else if (typeof body === 'string') realMsg = body;
          } catch { /* não-JSON; tenta texto */ }
        }
        if (!realMsg && ctx && typeof ctx.text === 'function') {
          try {
            const txt = await ctx.text();
            if (txt) realMsg = txt.slice(0, 500);
          } catch { /* ignore */ }
        }
        if (realMsg) throw new Error(realMsg);
        throw new Error((error as any).message || 'Erro desconhecido ao emitir NF-e');
      }
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.reconciliation_needed) {
        toast.warning(
          `NF-e aceita pelo Focus NFe (ref ${data.focus_ref ?? ''}) mas falhou ao salvar no banco. Reconcilie manualmente no painel Focus NFe.`,
          { duration: 12000 }
        );
      } else {
        toast.success('NF-e enviada para processamento!');
      }
    },
    onError: (err: Error) => toast.error(`Erro ao emitir NF-e: ${err.message}`),
    // Invalidate on both success AND error: emit-nfe inserts a 'rejeitada' row
    // even on SEFAZ rejection so the operator can see it without a manual refresh.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    },
  });
}

export function useCheckNfeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nfeId: string) => {
      const { data, error } = await supabase.functions.invoke('nfe-status', {
        body: { nfe_id: nfeId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      toast.success('Status da NF-e atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// Importa NF-es emitidas direto no painel da GestaoClick pro nosso DB. Necessário
// quando a NF foi gerada fora do nosso sistema (painel web do provedor) — sem
// isso, ela não aparece na aba "NF-es Emitidas" e bloqueia CC-e por aqui.
export function useSyncNfeFromProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-nfe-from-provider', { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        success: boolean;
        pages_fetched: number;
        total_seen: number;
        created: number;
        updated: number;
        errors: Array<{ provider_id: string | null; error: string }>;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      const errCount = data.errors?.length || 0;
      const msg = `${data.created} importada(s), ${data.updated} atualizada(s)`
        + (errCount > 0 ? ` · ${errCount} erro(s)` : '');
      if (errCount > 0) toast.warning(msg);
      else toast.success(`Sincronização concluída: ${msg}`);
    },
    onError: (err: Error) => toast.error(`Erro na sincronização: ${err.message}`),
  });
}

// Prazo legal SEFAZ para cancelamento gratuito de NF-e: 24h após autorização.
// Após esse prazo, o cancelamento normal é rejeitado e exige carta de correção.
export const NFE_CANCEL_DEADLINE_HOURS = 24;

export function getNfeCancelHoursLeft(dataEmissao: string | null | undefined): number | null {
  if (!dataEmissao) return null;
  // Ensure the string is interpreted as UTC — Supabase returns ISO strings that
  // may lack a Z suffix on some columns, causing local-time misinterpretation.
  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(dataEmissao)
    ? dataEmissao
    : dataEmissao + 'Z';
  const emitted = new Date(normalized);
  if (isNaN(emitted.getTime())) return null;
  const elapsedMs = Date.now() - emitted.getTime();
  const remainingMs = NFE_CANCEL_DEADLINE_HOURS * 3600 * 1000 - elapsedMs;
  return remainingMs / 3600000;
}

/**
 * Emite NF-e de devolução (entrada modelo 55, finalidade 4) referenciando a
 * NF de saída original. Usado quando a janela de 24h pra cancelar passou.
 * Após autorizada, mercadoria volta ao estoque + AR ajustado proporcionalmente.
 */
export function useEmitNfeDevolucao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      nfeOriginalId: string;
      itens: Array<{ sale_order_item_id: string; qty: number }>;
      motivo: string;
    }) => {
      if (!payload.motivo || payload.motivo.trim().length < 15) {
        throw new Error('Motivo deve ter ao menos 15 caracteres.');
      }
      if (!payload.itens || payload.itens.length === 0) {
        throw new Error('Informe ao menos 1 item a devolver.');
      }
      const { data, error } = await supabase.functions.invoke('emit-nfe-devolucao', {
        body: {
          nfe_original_id: payload.nfeOriginalId,
          itens: payload.itens,
          motivo: payload.motivo.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      qc.invalidateQueries({ queryKey: ['nfe_devolucoes'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      if (data?.partial_cleanup_warning) {
        toast.warning(`NF de devolução emitida, mas: ${data.partial_cleanup_warning}`, { duration: 8000 });
      } else if (data?.success) {
        toast.success(`NF de devolução autorizada! Chave: ${data?.devolucao?.chave_acesso?.slice(-6) || '—'}`);
      } else {
        toast.warning('NF de devolução cadastrada mas não autorizada — verifique status.');
      }
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Lista NFs de devolução vinculadas a uma NF original (ou todas).
 */
export function useNfeDevolucoes(nfeOriginalId?: string) {
  return useQuery({
    queryKey: ['nfe_devolucoes', nfeOriginalId || 'all'],
    queryFn: async () => {
      let q = (supabase as any).from('nfe_devolucoes').select('*').order('created_at', { ascending: false });
      if (nfeOriginalId) q = q.eq('nfe_original_id', nfeOriginalId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

export function useCancelNfe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nfeId, justificativa, dataEmissao }: { nfeId: string; justificativa: string; dataEmissao?: string | null }) => {
      // Validação de prazo no frontend (cliente). O backend deve revalidar.
      if (dataEmissao) {
        const hoursLeft = getNfeCancelHoursLeft(dataEmissao);
        if (hoursLeft !== null && hoursLeft <= 0) {
          throw new Error(`Prazo de cancelamento expirado (${NFE_CANCEL_DEADLINE_HOURS}h após autorização). Use carta de correção ou inutilização.`);
        }
      }
      // Justificativa exigida pela SEFAZ — mínimo 15 caracteres.
      if (!justificativa || justificativa.trim().length < 15) {
        throw new Error('Justificativa deve ter no mínimo 15 caracteres.');
      }
      const { data, error } = await supabase.functions.invoke('cancel-nfe', {
        body: { nfe_id: nfeId, justificativa },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      if (data?.partial_cleanup_warning) {
        toast.warning(`NF-e cancelada, mas houve aviso financeiro: ${data.partial_cleanup_warning}`);
      } else {
        toast.success('NF-e cancelada com sucesso!');
      }
    },
    onError: (err: Error) => toast.error(`Erro ao cancelar NF-e: ${err.message}`),
  });
}
