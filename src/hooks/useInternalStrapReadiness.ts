import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Cadastro que o save do PV exige das tiras `reference_base`, consultado ANTES
 * de o pedido ser montado.
 *
 * `create_sale_order_atomic` chama `ensure_sale_order_internal_strap_intents`
 * para cada item, incondicionalmente e antes de gravar qualquer linha. Quando
 * falta perfil de largura, SKU oficial da cor ou rendimento aprovado da napa, a
 * transação inteira aborta e o Comercial recebe o texto cru do `RAISE` — sem
 * saber qual dos itens travou. Este hook lê o MESMO caminho de resolução em
 * modo somente-leitura para a tela avisar por item.
 *
 * ⚠ PERF (editor PV): o form NÃO chama mais o RPC unitário por item. O painel
 * usa `useInternalStrapReadinessBatch` (1 round-trip) e cada item lê do mapa.
 * O hook unitário permanece pra telas/tests que diagnosticam uma tupla só.
 */
export interface InternalStrapReadinessIssue {
  code: string;
  message: string;
  technicalStrapLineId: string | null;
}

export interface InternalStrapReadiness {
  requiresReferenceBase: boolean;
  ready: boolean;
  baseGroupId: string | null;
  baseGroupName: string | null;
  colorId: string | null;
  colorName: string | null;
  issues: InternalStrapReadinessIssue[];
}

export interface InternalStrapReadinessInput {
  referenceId: string | null | undefined;
  materialVariantId?: string | null;
  color?: string | null;
}

export const READY_FALLBACK: InternalStrapReadiness = {
  requiresReferenceBase: false,
  ready: true,
  baseGroupId: null,
  baseGroupName: null,
  colorId: null,
  colorName: null,
  issues: [],
};

const str = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value);

function parseIssues(value: unknown): InternalStrapReadinessIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = (entry || {}) as Record<string, unknown>;
      return {
        code: String(record.code || 'cadastro_incompleto'),
        message: String(record.message || ''),
        technicalStrapLineId: str(record.technical_strap_line_id),
      };
    })
    .filter((issue) => !!issue.message);
}

export function parseInternalStrapReadiness(data: unknown): InternalStrapReadiness {
  const row = (data || {}) as Record<string, unknown>;
  // Ficha sem linha `reference_base` devolve o formato curto; tratá-la como
  // "pronta" evita alarme falso nas referências compradas prontas.
  if (row.requires_reference_base !== true) return READY_FALLBACK;

  const issues = parseIssues(row.issues);
  return {
    requiresReferenceBase: true,
    ready: row.ready === true && issues.length === 0,
    baseGroupId: str(row.base_group_id),
    baseGroupName: str(row.base_group_name),
    colorId: str(row.color_id),
    colorName: str(row.color_name),
    issues,
  };
}

/** Chave estável da tupla (ref|variant|color) — espelha o SQL batch. */
export function internalStrapReadinessKey(input: InternalStrapReadinessInput): string | null {
  if (!input.referenceId) return null;
  return [
    input.referenceId,
    input.materialVariantId || '',
    input.color || '',
  ].join('|');
}

export function useInternalStrapReadiness(input: InternalStrapReadinessInput, enabled = true) {
  return useQuery<InternalStrapReadiness>({
    queryKey: [
      'internal_strap_readiness',
      input.referenceId || null,
      input.materialVariantId || null,
      input.color || null,
    ],
    enabled: enabled && !!input.referenceId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    meta: { silentError: true },
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc('diagnose_sale_order_internal_strap_readiness', {
        p_reference_id: input.referenceId,
        p_material_variant_id: input.materialVariantId || null,
        p_color: input.color || null,
      });
      if (error) throw error;
      return parseInternalStrapReadiness(data);
    },
  });
}

/**
 * Um RPC para todas as tuplas únicas do editor. O painel chama; cada item
 * consulta `map.get(internalStrapReadinessKey(...))`.
 */
export function useInternalStrapReadinessBatch(
  inputs: InternalStrapReadinessInput[],
  enabled = true,
) {
  const uniquePayload = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{
      reference_id: string;
      material_variant_id: string | null;
      color: string | null;
    }> = [];
    for (const input of inputs) {
      const key = internalStrapReadinessKey(input);
      if (!key || !input.referenceId || seen.has(key)) continue;
      seen.add(key);
      items.push({
        reference_id: input.referenceId,
        material_variant_id: input.materialVariantId || null,
        color: input.color || null,
      });
    }
    items.sort((a, b) =>
      `${a.reference_id}|${a.material_variant_id || ''}|${a.color || ''}`.localeCompare(
        `${b.reference_id}|${b.material_variant_id || ''}|${b.color || ''}`,
      ));
    return items;
  }, [inputs]);

  const payloadKey = useMemo(
    () => uniquePayload.map((row) =>
      `${row.reference_id}|${row.material_variant_id || ''}|${row.color || ''}`).join(';'),
    [uniquePayload],
  );

  return useQuery<ReadonlyMap<string, InternalStrapReadiness>>({
    queryKey: ['internal_strap_readiness_batch', payloadKey],
    enabled: enabled && uniquePayload.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    meta: { silentError: true },
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc('diagnose_sale_order_internal_strap_readiness_batch', {
        p_items: uniquePayload,
      });
      if (error) throw error;

      const map = new Map<string, InternalStrapReadiness>();
      const row = (data || {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(row)) {
        map.set(key, parseInternalStrapReadiness(value));
      }
      // Tuplas pedidas mas ausentes no retorno → ready (não inventar alarme).
      for (const item of uniquePayload) {
        const key = `${item.reference_id}|${item.material_variant_id || ''}|${item.color || ''}`;
        if (!map.has(key)) map.set(key, READY_FALLBACK);
      }
      return map;
    },
  });
}
