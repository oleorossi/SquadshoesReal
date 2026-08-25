import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  SERVICE_ORDER_MATERIAL_COMPONENTS,
  SERVICE_ORDER_RETURN_SECTORS,
  REFERENCE_OUTSOURCE_SECTORS,
  hasValidServiceOrderMaterialComponents,
  isValidOutsourceCapacity,
  isValidOutsourceRate,
  type ServiceOrderMaterialComponent,
} from '@/lib/serviceOrderSectors';
import { normalizeSector } from '@/lib/sectors';
import { isOsActive } from '@/lib/osStatusMachine';

/**
 * Terceirizações cadastradas na ficha técnica de uma referência (technical_sheets).
 * Cada entrada configura uma atividade externa: prestador, capacidade, ponto de
 * retorno, componentes incluídos no cálculo e valor POR PAR.
 *
 * A configuração alimenta a seleção no PV e a prévia do fluxo explícito
 * "Gerar OS", que volta a calcular prazos e materiais no servidor ao confirmar.
 *
 * `(supabase as any)`: a tabela reference_terceirizacoes ainda não está no
 * types.ts gerado (regenerar depois) — segue o mesmo padrão de contractor_service_rates.
 */
export interface ReferenceTerceirizacao {
  id: string;
  reference_id: string;
  contractor_id: string;
  sector: string | null;
  capacity_pairs_per_day: number | null;
  return_before_sector: string | null;
  material_components: ServiceOrderMaterialComponent[];
  description: string;
  value_per_pair: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  contractors?: { id: string; name: string; trade_name: string | null } | null;
}

export interface ReferenceTerceirizacaoInput {
  reference_id: string;
  contractor_id: string;
  sector: string;
  capacity_pairs_per_day: number;
  return_before_sector: string;
  material_components: ServiceOrderMaterialComponent[];
  description: string;
  value_per_pair: number;
  active?: boolean;
}

const SELECT = '*, contractors(id, name, trade_name)';

const SERVICE_ORDER_SECTOR_VALUES = new Set<string>(
  REFERENCE_OUTSOURCE_SECTORS.map((option) => option.value),
);

const MATERIAL_COMPONENT_BY_KEY = new Map<string, ServiceOrderMaterialComponent>(
  SERVICE_ORDER_MATERIAL_COMPONENTS.map((option) => [normalizeOptionKey(option.value), option.value]),
);

function normalizeOptionKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Normaliza aliases/case para os rótulos exatos emitidos pelo motor. */
export function normalizeReferenceMaterialComponents(value: unknown): ServiceOrderMaterialComponent[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((component): component is string => typeof component === 'string')
    .map((component) => MATERIAL_COMPONENT_BY_KEY.get(normalizeOptionKey(component)))
    .filter((component): component is ServiceOrderMaterialComponent => !!component);
  return [...new Set(normalized)];
}

/** Persiste a grafia canônica da etapa interna, aceitando chaves/aliases legados. */
export function normalizeReferenceReturnSector(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const canonicalKey = normalizeSector(value);
  return SERVICE_ORDER_RETURN_SECTORS.find(
    (option) => normalizeSector(option.value) === canonicalKey,
  )?.value ?? value.trim();
}

function validateCreateInput(input: ReferenceTerceirizacaoInput) {
  if (!input.reference_id) throw new Error('Referência obrigatória.');
  if (!input.contractor_id) throw new Error('Selecione a contratada/prestador.');
  if (!SERVICE_ORDER_SECTOR_VALUES.has(input.sector)) {
    throw new Error('Selecione uma atividade válida.');
  }
  if (!isValidOutsourceCapacity(input.capacity_pairs_per_day)) {
    throw new Error('Capacidade deve ser um número inteiro entre 1 e 1.000.000 pares por dia.');
  }
  const normalizedReturnSector = normalizeReferenceReturnSector(input.return_before_sector);
  if (!normalizedReturnSector) {
    throw new Error('Selecione em qual etapa o serviço deve retornar.');
  }
  // A ordem viva pertence a sector_settings e é validada novamente no banco.
  // O formulário usa essa mesma fonte; não repetir aqui o fallback estático.
  const normalizedMaterialComponents = normalizeReferenceMaterialComponents(input.material_components);
  if (!hasValidServiceOrderMaterialComponents(normalizedMaterialComponents)) {
    throw new Error('Selecione ao menos um componente de material.');
  }
  if (!input.description.trim()) throw new Error('Informe a descrição do serviço.');
  if (!isValidOutsourceRate(input.value_per_pair)) {
    throw new Error('Valor por par deve ser maior que zero.');
  }
}

export function useReferenceTerceirizacoes(referenceId: string | null) {
  return useQuery({
    queryKey: ['reference_terceirizacoes', referenceId],
    enabled: !!referenceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select(SELECT)
        .eq('reference_id', referenceId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ReferenceTerceirizacao[];
    },
  });
}

/** Só as ativas — usada na seção de terceirização do item do PV. */
export function useActiveReferenceTerceirizacoes(referenceId: string | null) {
  return useQuery({
    queryKey: ['reference_terceirizacoes_active', referenceId],
    enabled: !!referenceId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .select(SELECT)
        .eq('reference_id', referenceId!)
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as ReferenceTerceirizacao[];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes'] });
  qc.invalidateQueries({ queryKey: ['reference_terceirizacoes_active'] });
  qc.invalidateQueries({ queryKey: ['pv_outsourceable_lines'] });
  qc.invalidateQueries({ queryKey: ['service_order_generation_gaps'] });
  qc.invalidateQueries({ queryKey: ['pv_terceirizacao_lines'] });
}

export function useCreateReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReferenceTerceirizacaoInput) => {
      validateCreateInput(input);
      const { data, error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .insert({
          reference_id: input.reference_id,
          contractor_id: input.contractor_id,
          sector: input.sector,
          capacity_pairs_per_day: input.capacity_pairs_per_day,
          return_before_sector: normalizeReferenceReturnSector(input.return_before_sector),
          material_components: normalizeReferenceMaterialComponents(input.material_components),
          description: input.description.trim(),
          value_per_pair: input.value_per_pair,
          active: input.active ?? true,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização adicionada à ficha.'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ReferenceTerceirizacaoInput> & { id: string; active?: boolean }) => {
      if (updates.sector !== undefined && !SERVICE_ORDER_SECTOR_VALUES.has(updates.sector)) {
        throw new Error('Selecione uma atividade válida.');
      }
      if (updates.capacity_pairs_per_day !== undefined &&
          !isValidOutsourceCapacity(updates.capacity_pairs_per_day)) {
        throw new Error('Capacidade deve ser um número inteiro entre 1 e 1.000.000 pares por dia.');
      }
      if (updates.return_before_sector !== undefined &&
          !normalizeReferenceReturnSector(updates.return_before_sector)) {
        throw new Error('Selecione em qual etapa o serviço deve retornar.');
      }
      // A relação temporal é validada pela UI com sector_settings e, de forma
      // autoritativa/race-safe, pelo trigger do banco.
      if (updates.material_components !== undefined &&
          !hasValidServiceOrderMaterialComponents(
            normalizeReferenceMaterialComponents(updates.material_components),
          )) {
        throw new Error('Selecione ao menos um componente de material.');
      }
      if (updates.description !== undefined && !updates.description.trim()) {
        throw new Error('Informe a descrição do serviço.');
      }
      if (updates.value_per_pair !== undefined &&
          !isValidOutsourceRate(updates.value_per_pair)) {
        throw new Error('Valor por par deve ser maior que zero.');
      }
      const payload: Record<string, unknown> = { ...updates };
      if (typeof payload.description === 'string') payload.description = payload.description.trim();
      if (typeof payload.return_before_sector === 'string') {
        payload.return_before_sector = normalizeReferenceReturnSector(payload.return_before_sector);
      }
      if (payload.material_components !== undefined) {
        payload.material_components = normalizeReferenceMaterialComponents(payload.material_components);
      }
      const { error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .update(payload)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização atualizada.'); },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Linhas de terceirização de um PV (card "Terceirizações" do detalhe).
 * Cada linha = (referência::cor) × terceirização MARCADA, com a qty agregada e a
 * OS já enviada (se houver). O status local é derivado: sem OS = "pendente envio";
 * OS cancelada = "cancelada"; senão = "enviada". A OS só nasce no ENVIO explícito.
 */
export interface PvTerceirizacaoLine {
  reference_id: string;
  color: string;
  ref_code: string | null;
  terceirizacao_id: string;
  contractor_id: string | null;
  contractor_name: string | null;
  description: string;
  value_per_pair: number;
  terceirizacao_active: boolean;
  qty: number;
  os_id: string | null;
  os_number: string | null;
  os_status: string | null;
  os_quantity: number | null;
  os_total: number | null;
}

export type LocalTerceirizacaoStatus = 'pendente_envio' | 'enviada' | 'cancelada';

export function localTerceirizacaoStatus(line: PvTerceirizacaoLine): LocalTerceirizacaoStatus {
  if (!line.os_id) return 'pendente_envio';
  const s = (line.os_status || '').trim().toLowerCase();
  if (s === 'cancelado' || s === 'cancelada' || s === 'cancelled') return 'cancelada';
  return 'enviada';
}

export function usePvTerceirizacaoLines(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['pv_terceirizacao_lines', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_pv_terceirizacao_lines', {
        p_sale_order_id: saleOrderId!,
      });
      if (error) throw error;
      return (data || []) as PvTerceirizacaoLine[];
    },
  });
}

function invalidatePvLines(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['pv_terceirizacao_lines'] });
  qc.invalidateQueries({ queryKey: ['pv_service_orders'] });
  qc.invalidateQueries({ queryKey: ['service_orders'] });
  qc.invalidateQueries({ queryKey: ['service_order_overview'] });
}

/** Envia UMA linha pra terceirizados → cria/reativa a OS daquela terceirização. */
export function useSendTerceirizacaoOs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { saleOrderId: string; referenceId: string; color: string; terceirizacaoId: string }) => {
      const { data, error } = await (supabase as any).rpc('send_terceirizacao_os', {
        p_sale_order_id: p.saleOrderId,
        p_reference_id: p.referenceId,
        p_color: p.color || '',
        p_terceirizacao_id: p.terceirizacaoId,
        p_reactivate: true,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { action: string; os_id: string };
    },
    onSuccess: (res) => {
      invalidatePvLines(qc);
      if (res?.action === 'reactivated') toast.success('OS reenviada ao prestador.');
      else if (res?.action === 'exists') toast.info('Esta linha já tinha OS enviada.');
      else toast.success('Ordem de Serviço enviada ao prestador.');
    },
    onError: (e: any) => toast.error(translateSendError(e?.message)),
  });
}

/** Envia TODAS as linhas pendentes de envio de um PV de uma vez. */
export function useSendAllTerceirizacaoOs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderId: string) => {
      const { data, error } = await (supabase as any).rpc('send_all_terceirizacao_os', {
        p_sale_order_id: saleOrderId,
      });
      if (error) throw error;
      return data as { created: number; skipped: number };
    },
    onSuccess: (res) => {
      invalidatePvLines(qc);
      const created = Number(res?.created || 0);
      if (created > 0) toast.success(`${created} ${created === 1 ? 'OS enviada' : 'OS enviadas'} ao(s) prestador(es).`);
      else toast.info('Nenhuma linha pendente de envio.');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao enviar terceirizações.'),
  });
}

/** Cancela uma OS de terceirização (não "desenvia" — só cancela). */
export function useCancelTerceirizacaoOs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (osId: string) => {
      const { data: current, error: currentError } = await supabase
        .from('service_orders')
        .select('status')
        .eq('id', osId)
        .single();
      if (currentError) throw currentError;
      if (!isOsActive(current?.status)) {
        throw new Error('A OS já foi concluída ou cancelada. Recarregue o pedido.');
      }

      const { data: rows, error } = await supabase
        .from('service_orders')
        .update({ status: 'Cancelado' })
        .eq('id', osId)
        .eq('status', current.status)
        .select('id');
      if (error) throw error;
      if (!rows?.length) {
        throw new Error('A OS mudou enquanto você cancelava. Recarregue o pedido e confira o estado atual.');
      }
    },
    onSuccess: () => { invalidatePvLines(qc); toast.success('OS cancelada.'); },
    onError: (e: any) => toast.error(e?.message || 'Falha ao cancelar OS.'),
  });
}

/** Atualiza a qty da OS pra bater com a qty atual do item do PV. */
export function useUpdateTerceirizacaoOsQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (osId: string) => {
      const { data, error } = await (supabase as any).rpc('update_terceirizacao_os_qty', {
        p_service_order_id: osId,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { quantity: number; total: number };
    },
    onSuccess: () => { invalidatePvLines(qc); toast.success('OS atualizada com a nova quantidade.'); },
    onError: (e: any) => toast.error(translateSendError(e?.message)),
  });
}

function translateSendError(msg?: string): string {
  switch (msg) {
    case 'sale_order_cancelled': return 'PV está cancelado — não dá pra enviar.';
    case 'terceirizacao_not_found': return 'Terceirização não encontrada (foi removida da ficha?).';
    case 'line_not_marked': return 'Linha não está mais marcada no pedido.';
    case 'sale_order_not_found': return 'Pedido não encontrado.';
    case 'os_not_found': return 'OS não encontrada.';
    case 'not_pv_linked': return 'OS não é vinculada a um PV.';
    case 'os_not_active': return 'A quantidade só pode ser atualizada enquanto a OS estiver aberta.';
    case 'physical_history_exists': return 'A quantidade não pode mais ser alterada depois de um despacho ou retorno. Emita uma nova OS para o novo lote.';
    case 'not_legacy_integrated_service_order': return 'Esta OS usa o fluxo planejado por OP e deve ser ajustada pelo assistente de terceirização.';
    default: return msg || 'Falha ao enviar terceirização.';
  }
}

export function useDeleteReferenceTerceirizacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('reference_terceirizacoes')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(qc); toast.success('Terceirização removida.'); },
    onError: (e: any) => toast.error(e.message),
  });
}
