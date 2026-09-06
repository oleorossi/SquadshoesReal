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

interface Input {
  referenceId: string | null | undefined;
  materialVariantId?: string | null;
  color?: string | null;
}

const READY_FALLBACK: InternalStrapReadiness = {
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

export function useInternalStrapReadiness(input: Input, enabled = true) {
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
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc('diagnose_sale_order_internal_strap_readiness', {
        p_reference_id: input.referenceId,
        p_material_variant_id: input.materialVariantId || null,
        p_color: input.color || null,
      });
      if (error) throw error;

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
    },
  });
}
