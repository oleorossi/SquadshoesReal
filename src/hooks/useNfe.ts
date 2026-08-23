import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { syncFinancialRecords } from '@/hooks/useSaleOrders';

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
  /** ID interno da NF no ClickNotas — usado pra montar URL do painel
   *  quando precisamos abrir o DANFE/XML lá (a API REST do GC não devolve
   *  esses arquivos, só metadados). */
  provider_nfe_id: string | null;
  valor_total: number;
  data_emissao: string | null;
  motivo_rejeicao: string | null;
  protocolo: string | null;
  protocolo_cancelamento: string | null;
  cnpj_emitente: string | null;
  nome_destinatario: string | null;
  cnpj_destinatario: string | null;
  justificativa_cancelamento: string | null;
  data_cancelamento: string | null;
  /** Resposta completa do detalhe ClickNotas (/notas_fiscais_produtos/{id}).
   *  Fonte de dados pro DANFE renderizado no app (produtos, impostos, endereços).
   *  Não vem na listagem por padrão — carregado sob demanda via useNfeDetail. */
  gc_detail_response?: any;
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
  natureza_operacao: string;
  cfop: string;
  is_primary: boolean;
  active: boolean;
  /** ID da loja correspondente no ClickNotas. Garante que a NF-e
   *  seja emitida sob o CNPJ desta empresa (sem isso a emit-nfe usa a matriz). */
  gestaoclick_loja_id?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── NF-e Emitidas ───────────────────────────────────────────────────────────

/** Colunas da listagem = exatamente a interface NfeEmitida, MENOS
 *  `gc_detail_response` (que ela já marca como opcional e carregado sob demanda
 *  via useNfeDetail). O `select('*')` trazia junto os 4 jsonb de payload da SEFAZ
 *  — 23 kB em 64 linhas, sendo 16 kB só de gc_detail_response — que nenhum
 *  componente renderiza a partir da lista. */
const NFE_LIST_COLUMNS = [
  'id', 'sale_order_id', 'company_id', 'ref_nfe', 'status', 'numero', 'serie',
  'chave_acesso', 'xml_url', 'danfe_url', 'provider_nfe_id', 'valor_total',
  'data_emissao', 'motivo_rejeicao', 'protocolo', 'protocolo_cancelamento',
  'cnpj_emitente', 'nome_destinatario', 'cnpj_destinatario',
  'justificativa_cancelamento', 'data_cancelamento', 'created_at', 'updated_at',
].join(', ');

/**
 * NFs emitidas. Sem `saleOrderId` traz a tabela inteira — uso legítimo em
 * InvoicesSaidaTab, que quer mesmo todas.
 *
 * ⚠ Quem passa um id OPCIONAL (`selectedOrder?.id`) tem que passar `enabled`
 * junto: sem ele, o id `undefined` não vira `where` nenhum e a query varre a
 * tabela inteira em vez de não rodar (auditoria PV 07/08/2026 — em /sales isso
 * disparava uma varredura completa a cada abrir/fechar do dialog de detalhe,
 * porque a queryKey alterna entre [.., id] e [.., undefined]).
 */
export function useNfeEmitidas(saleOrderId?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['nfe_emitidas', saleOrderId],
    enabled: opts?.enabled ?? true,
    // staleTime=0 + refetchOnMount='always': mesma estratégia da useAllNfeEmitidas.
    // Sem isso, o card de NFs no PV ficava com cache vazio depois de emitir
    // (user via toast 'NF enviada' mas a lista local mostrava 'nenhuma NF').
    // ⚠ NÃO trocar por cache: o conserto da varredura é o `enabled`, não isto.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      let query = supabase
        .from('nfe_emitidas')
        .select(NFE_LIST_COLUMNS)
        .order('created_at', { ascending: false });
      if (saleOrderId) query = query.eq('sale_order_id', saleOrderId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as NfeEmitida[];
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
        .select(`${NFE_LIST_COLUMNS}, sale_orders!nfe_emitidas_sale_order_id_fkey(order_number, client_name, total)`)
        .order('created_at', { ascending: false });
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.company_id) query = query.eq('company_id', filters.company_id);
      query = query.limit(500);
      const { data, error } = await query;
      if (error) {
        console.error('[useAllNfeEmitidas] error:', error);
        throw error;
      }
      return data || [];
    },
  });
}

/**
 * Carrega o detalhe completo (gc_detail_response) de uma NF sob demanda — usado
 * pelo visualizador de DANFE. A listagem não traz esse JSON pra ficar leve; aqui
 * buscamos a linha única quando o viewer abre.
 */
export function useNfeDetail(nfeId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['nfe_detail', nfeId],
    enabled: !!nfeId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nfe_emitidas')
        .select('id, gc_detail_response')
        .eq('id', nfeId!)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; gc_detail_response: any } | null;
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

      // Fetch direto: controle total sobre a leitura do body de erro.
      const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL;
      const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/emit-nfe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ sale_order_id: so.id, company_id: payload.companyId }),
      });

      const txt = await res.text();
      let nfeData: any = null;
      try { nfeData = JSON.parse(txt); } catch { /* não-JSON */ }

      if (!res.ok) {
        const realMsg = nfeData?.error || nfeData?.message || txt || `HTTP ${res.status} ao emitir NF avulsa`;
        console.error('[emit-nfe avulsa] HTTP', res.status, nfeData || txt);
        throw new Error(typeof realMsg === 'string' ? realMsg : JSON.stringify(realMsg));
      }
      if (nfeData?.error) throw new Error(String(nfeData.error));
      return { sale_order_id: so.id, ...nfeData };
    },
    onSuccess: async (data: { sale_order_id?: string }) => {
      toast.success('NF Avulsa enviada para processamento!');
      // Auditoria fiscal C2: reconhece receita + AR na autorização da NF avulsa
      // (o gate em syncFinancialRecords só cria se a NF estiver autorizada).
      // Antes, a NF avulsa criava PV 'Faturado' sem receita — mesmo gap do useEmitNfe.
      if (data?.sale_order_id) {
        try {
          await syncFinancialRecords(data.sale_order_id);
          qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
          qc.invalidateQueries({ queryKey: ['financial_entries'] });
        } catch (e) {
          console.error('[useEmitStandaloneNfe] reconhecimento de receita falhou:', e);
        }
      }
    },
    onError: (err: Error) => toast.error(`Erro ao emitir NF Avulsa: ${err.message}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
    },
  });
}

// ─── Preview (dry-run) ───────────────────────────────────────────────────────

export interface NfePreviewProduto {
  descricao: string;
  codigo?: string;
  ncm: string;
  cfop: string;
  origem?: 'industrial' | 'revenda';
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total: number;
  /** Marca (xMarca) deste item = silk do solado, ou 'Squad Shoes' (fallback). */
  marca?: string;
  gc_status: 'cached' | 'found_by_name' | 'pending_create';
  gc_id: string | null;
}

export interface NfePreviewResponse {
  dry_run: true;
  payload: any;
  preview: {
    ref_nfe: string;
    revision: number;
    emitente: {
      razao_social: string | null;
      nome_fantasia: string | null;
      cnpj: string;
      inscricao_estadual: string;
      uf: string;
      cidade: string | null;
      serie_nfe: string | number;
      ambiente: string | null;
    };
    destinatario: {
      tipo_pessoa: 'PJ' | 'PF';
      nome: string;
      documento: string;
      ie_status: 'contribuinte' | 'isento';
      ie_valor: string;
      endereco: string;
      numero: string;
      complemento: string | null;
      bairro: string;
      cidade: string;
      uf: string;
      cep: string;
      telefone: string | null;
      email: string | null;
      gc_id: string | null;
    };
    operacao: {
      natureza_operacao: string;
      cfop: string;
      cfop_kind?: 'industrial' | 'revenda';
      cfop_interstate: boolean;
      modelo: string;
      finalidade: string;
      tipo_emissao: string;
      indicador_presenca: string;
      indicador_final: string;
      tipo_nf: string;
      marca_xmarca: string;
    };
    produtos: NfePreviewProduto[];
    totais: {
      soma_itens: number;
      total_pedido: number;
      /** Frete do PV — NÃO compõe a NF; exibido só como info (lançado no financeiro). */
      valor_frete?: number;
      qtd_itens: number;
      qtd_pares: number;
    };
    transporte: {
      modalidade_frete: string;
      transportador: {
        nome?: string;
        cnpj?: string;
        inscricao_estadual?: string;
        endereco?: string;
        cidade?: string;
        estado?: string;
      } | null;
      qtd_volumes: string;
      especie: string;
      peso_bruto_kg: string | null;
      peso_liquido_kg: string | null;
      /** false = bloco calculado só pra expedição; a API do ClickNotas não
       *  aceita campo de transporte/volume/peso (auditoria 31/07/2026). */
      enviado_a_sefaz?: boolean;
      observacao?: string;
      /** nº de volumes veio do default de 12 pares/caixa, sem caixa cadastrada */
      volumes_estimado_cego?: boolean;
      /** peso veio do fallback cego de 0,5 kg/par */
      peso_estimado_cego?: boolean;
    };
    pagamento: Array<{
      numero: string;
      forma: string;
      vencimento: string;
      valor: number;
    }>;
    informacoes_complementares: string | null;
    warnings: string[];
  };
}

/**
 * Roda emit-nfe com dry_run=true: valida tudo, computa peso/volumes/pagamento
 * e devolve o payload + preview formatado pro EmitDialog renderizar a tela
 * de conferência. Não emite nada no ClickNotas. Toast NÃO é disparado em
 * sucesso (UI renderiza inline); erros caem em toast.error normalmente.
 */
export function usePreviewNfe() {
  return useMutation<NfePreviewResponse, Error, { saleOrderId: string; companyId?: string; firstDueDate?: string | null }>({
    mutationFn: async ({ saleOrderId, companyId, firstDueDate }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

      const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL;
      const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/emit-nfe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ sale_order_id: saleOrderId, company_id: companyId, dry_run: true, first_due_date: firstDueDate ?? null }),
      });
      const txt = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { /* não-JSON */ }

      if (!res.ok) {
        const realMsg = parsed?.error || parsed?.message || txt || `HTTP ${res.status} ao gerar preview`;
        throw new Error(typeof realMsg === 'string' ? realMsg : JSON.stringify(realMsg));
      }
      if (parsed?.error) throw new Error(String(parsed.error));
      if (!parsed?.dry_run) throw new Error('Resposta inesperada do servidor (preview).');
      return parsed as NfePreviewResponse;
    },
    onError: (err: Error) => toast.error(`Não foi possível gerar preview: ${err.message}`),
  });
}

export function useEmitNfe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderId, companyId, firstDueDate }: { saleOrderId: string; companyId?: string; firstDueDate?: string | null }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

      // Fetch direto pra ter controle total sobre a leitura do body.
      // supabase-js .invoke() consome o Response no construtor do
      // FunctionsHttpError e depois fica difícil ler error.context.json().
      const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL;
      const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/emit-nfe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ sale_order_id: saleOrderId, company_id: companyId, first_due_date: firstDueDate ?? null }),
      });

      // Tenta JSON, depois texto. Sempre mostra a mensagem REAL do edge fn.
      const txt = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { /* não-JSON */ }

      if (!res.ok) {
        const realMsg = parsed?.error || parsed?.message || txt || `HTTP ${res.status} ao emitir NF-e`;
        console.error('[emit-nfe] HTTP', res.status, parsed || txt);
        throw new Error(typeof realMsg === 'string' ? realMsg : JSON.stringify(realMsg));
      }
      if (parsed?.error) throw new Error(String(parsed.error));
      return parsed;
    },
    onSuccess: async (data: any, variables: { saleOrderId: string; companyId?: string; firstDueDate?: string | null }) => {
      // numero mora em data.nfe.numero (o topo da resposta NÃO tem `numero`).
      const numero = data?.nfe?.numero ? `NF #${data.nfe.numero}` : 'NF-e';
      if (data?.reconciliation_needed) {
        toast.warning(
          `NF-e aceita pelo ClickNotas${data.provider_nfe_id ? ` (id ${data.provider_nfe_id})` : ''} mas falhou ao salvar no banco. Reconcilie manualmente no painel ClickNotas.`,
          { duration: 12000 }
        );
      } else if (data?.ambiente_warning) {
        // Ambiente errado (homologação x produção) — risco fiscal real. Avisa
        // em destaque e por bastante tempo (o operador precisa agir).
        toast.warning(data.ambiente_warning, { duration: 20000 });
      } else if (data?.transmit_warning) {
        // NF cadastrada mas NÃO transmitida (envio automático ignorado + /emitir
        // sem permissão) — NÃO é sucesso, o operador acha que emitiu e não emitiu.
        toast.warning(data.transmit_warning, { duration: 20000 });
      } else {
        // Toast com link pro menu de NF: alguns operadores ficavam no PV e
        // achavam que a NF não aparecia (cache estale + olhavam só o card
        // local do PV). Botão 'Abrir menu' navega direto pra lista global.
        const ambSuffix = data?.ambiente === 'homologacao'
          ? ' · ⚠ HOMOLOGAÇÃO (sem valor fiscal)'
          : '';
        toast.success(`${numero} emitida e salva no menu de NF!${ambSuffix}`, {
          duration: 8000,
          action: {
            label: 'Abrir menu →',
            onClick: () => { window.location.href = '/nfe'; },
          },
        });
      }
      // Auditoria fiscal C2: reconhece receita + AR na AUTORIZAÇÃO da NF-e.
      // Antes, o caminho fiscal só fazia UPDATE status='Faturado' e NADA criava
      // receita (os PVs com NF autorizada ficavam com receita zero). O gate em
      // syncFinancialRecords garante que só cria se a NF estiver 'autorizada' —
      // se ficou 'processando', não cria (espera a autorização via sync/cron).
      try {
        // Faturamento antecipado: persiste a 1ª data escolhida no PV ANTES de
        // gerar as contas a receber, pra que o computeARSchedule (dentro de
        // syncFinancialRecords, que relê o PV) ancore as parcelas na mesma data
        // das duplicatas da NF. Sem data escolhida, não toca a coluna.
        if (variables.firstDueDate) {
          await (supabase as any)
            .from('sale_orders')
            .update({ nfe_first_due_date: variables.firstDueDate })
            .eq('id', variables.saleOrderId);
        }
        await syncFinancialRecords(variables.saleOrderId);
        qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
        qc.invalidateQueries({ queryKey: ['financial_entries'] });
      } catch (e) {
        console.error('[useEmitNfe] reconhecimento de receita pós-autorização falhou:', e);
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

/**
 * URL do visualizador público de DANFE/XML — meudanfe.com.br aceita a
 * chave de acesso e exibe DANFE renderizado + botão de download de XML/PDF.
 * A API do ClickNotas não expõe esses arquivos, então abrimos o viewer público
 * em nova aba e o usuário baixa pelos botões de lá.
 */
export function buildMeudanfeUrl(chaveAcesso: string): string {
  const clean = chaveAcesso.replace(/\D/g, '');
  return `https://www.meudanfe.com.br/consulta/${clean}`;
}

/**
 * "Baixa" DANFE / XML — na prática abre meudanfe.com.br em nova aba pra que
 * o usuário clique em Baixar lá. A API do ClickNotas não fornece esses
 * arquivos via endpoint próprio (probamos exaustivamente: 404 em todas as
 * variantes de path), então usamos o viewer público que opera direto sobre a
 * chave de acesso autorizada na SEFAZ.
 */
export function useDownloadNfeFile() {
  return useMutation({
    mutationFn: async ({ chave, format }: {
      chave: string | null | undefined;
      format: 'danfe' | 'xml';
    }) => {
      if (!chave) {
        throw new Error('Chave de acesso ainda não disponível — aguarde autorização da SEFAZ ou clique em "Verificar status".');
      }
      const url = buildMeudanfeUrl(chave);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      // Auditoria A12: fallback clipboard quando popup é bloqueado. Antes só
      // mostrava erro genérico — operador não sabia que podia colar link.
      if (!win) {
        try {
          await navigator.clipboard.writeText(url);
          return { format, popupBlocked: true, url };
        } catch {
          throw new Error(`Pop-up bloqueado pelo navegador. Copie e cole no navegador: ${url}`);
        }
      }
      return { format, popupBlocked: false, url };
    },
    onError: (err: Error) => toast.error(err.message),
    onSuccess: ({ format, popupBlocked, url }) => {
      if (popupBlocked) {
        toast.success('Pop-up bloqueado — link copiado pra área de transferência. Cole no navegador (Ctrl+V).', {
          duration: 8000,
          action: {
            label: 'Abrir agora',
            onClick: () => { window.location.href = url; },
          },
        });
      } else {
        toast.success(`Visualizador aberto — clique em "Baixar ${format === 'danfe' ? 'PDF' : 'XML'}" na nova aba.`);
      }
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

// Importa NF-es emitidas direto no painel do ClickNotas pro nosso DB. Necessário
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
      const msg = `${data.created} ${data.created === 1 ? 'importada' : 'importadas'}, ${data.updated} ${data.updated === 1 ? 'atualizada' : 'atualizadas'}`
        + (errCount > 0 ? ` · ${errCount} ${errCount === 1 ? 'erro' : 'erros'}` : '');
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
 *
 * Auditoria A2: gera idempotency_key UUID por tentativa. Se o request falha
 * (timeout, rede) e o operador retenta, o edge function reconhece a chave
 * idêntica e retorna o resultado original — bloqueia devolução duplicada
 * (cada retry criava nfe_devolucoes + 2× redução de AR).
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
      // crypto.randomUUID() padrão moderno — suporte universal navegadores recentes
      const idempotency_key = (globalThis.crypto as any)?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { data, error } = await supabase.functions.invoke('emit-nfe-devolucao', {
        body: {
          nfe_original_id: payload.nfeOriginalId,
          itens: payload.itens,
          motivo: payload.motivo.trim(),
          idempotency_key,
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
      // Fetch direto (não .invoke): o cancel-nfe responde 422 quando a SEFAZ/
      // ClickNotas RECUSA o cancelamento, com o motivo REAL em provider_response.
      // O .invoke() esconde isso atrás de "Edge Function returned a non-2xx
      // status code" (o corpo fica em error.context, que ele não lê). Aqui lemos
      // o corpo e mostramos a causa real. (Mesmo padrão de useEmitNfe.)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
      const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL;
      const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-nfe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ nfe_id: nfeId, justificativa }),
      });
      const txt = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { /* resposta não-JSON */ }

      if (!res.ok || parsed?.success === false) {
        const pr = parsed?.provider_response;
        const prMsg = pr?.mensagem
          || (Array.isArray(pr?.erros) ? pr.erros.join('; ') : pr?.erros)
          || (typeof pr === 'string' ? pr : null);
        const realMsg = parsed?.error || prMsg || parsed?.message || txt
          || `HTTP ${res.status} ao cancelar NF-e`;
        console.error('[cancel-nfe] HTTP', res.status, parsed || txt);
        throw new Error(typeof realMsg === 'string' ? realMsg : JSON.stringify(realMsg));
      }
      if (parsed?.error) throw new Error(String(parsed.error));
      return parsed;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas_all'] });
      // O cancelamento reverte PV + duplicatas + lançamentos financeiros no
      // servidor, mas só as queries de NF-e eram invalidadas: o PV seguia
      // exibido como "Faturado" e as duplicatas canceladas continuavam somando
      // no financeiro. Mesma lista de `useRevertInvoicedSaleOrder.onSuccess`.
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['nfe_devolucoes'] });
      if (data?.partial_cleanup_warning) {
        toast.warning(`NF-e cancelada, mas houve aviso financeiro: ${data.partial_cleanup_warning}`);
      } else {
        toast.success('NF-e cancelada com sucesso!');
      }
    },
    onError: (err: Error) => toast.error(`Erro ao cancelar NF-e: ${err.message}`),
  });
}
