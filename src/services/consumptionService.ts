// =============================================================================
// consumptionService.ts
// Porta TS única do motor SQL de consumo.
// Com grade válida: calculate_order_consumption_by_grade + scaleGradeToTotal
// (espelho de public.scale_grade_to_total). Sem grade: wrapper escalar,
// que no banco já delega ao by_grade.
// =============================================================================
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import { isUsableGrade, scaleGradeToTotal } from '@/lib/scaleGrade';

// ---------------------------------------------------------------------------
// SCHEMA DE VALIDAÇÃO (Zod)
// Reflete o JSONB retornado pela RPC `calculate_order_consumption`.
// Mantenha sincronizado com a função PL/pgSQL — mudanças aqui forçam
// atualização lá (e vice-versa). Os testes de schema travam o contrato.
// ---------------------------------------------------------------------------

/** Modos de débito permitidos no motor de consumo. */
export const DEBIT_MODES = ['hard', 'soft'] as const;

/** Fontes válidas reportadas pela hierarquia per-size → sole_spec → escalar.
 *  D12 fix: adicionados 'sole_standard_per_size' (emitido por
 *  calculate_order_consumption ao iterar sole_standard_items) e
 *  'direct_components' (emitido em casos sem sheet_materials), ambos
 *  presentes nas migrations 20260426120000+ mas ausentes deste whitelist. */
export const CONSUMPTION_SOURCES = [
  'sheet_per_size',
  'sole_spec',
  'sheet_materials',
  'primary_sole',
  'sole_standard_per_size',
  'direct_components',
  'component_color',
  // Padrão GLOBAL grupo+cor (component_color_defaults, mig 20260928121000):
  // componente da ficha re-colorido pela regra global no fallback de
  // direct_components. Sem este valor o Zod derruba o payload INTEIRO na
  // primeira ficha atingida por regra.
  'component_color_default',
  // Fontes emitidas pelo motor único `calculate_order_consumption_by_grade`
  // (o escalar delega a ele) confirmadas no banco vivo em 2026-07-08. Faltavam
  // aqui → o Zod REJEITARIA o payload inteiro (ConsumptionSchemaError) na
  // primeira ficha com variante de material, forração alternativa, fachete de
  // solado ou acessório de componente.
  'variant',
  'variant_sole',
  'lining_alt',
  'insole_lining',
  'sole_fachete',
  'component_accessory',
  // valores legados/auxiliares que o SQL pode emitir em casos antigos
  'fallback_default',
  'sole_driven_default',
  'fallback_average',
  // Linha de DIAGNÓSTICO (mig 20260925131000): componente que não resolve
  // produto — product_id NULL, required 0, consumption_warning explicando.
  // Antes a linha simplesmente não era emitida e o componente sumia calado.
  // Sem este valor no whitelist o Zod derrubaria o payload INTEIRO.
  'unresolved',
] as const;

export const ConsumptionLineSchema = z
  .object({
    component: z.string().min(1, 'component vazio'),
    // NULO permitido SÓ em linha de AVISO (required=0 + consumption_warning) —
    // o SQL emite legitimamente product_id NULL no ramo de solado fachetado sem
    // specs de fachete (source='sole_fachete'); exigir string derrubava o
    // payload INTEIRO com ConsumptionSchemaError (F2-10). O superRefine abaixo
    // preserva a rejeição pra qualquer outra linha sem product_id.
    product_id: z.string().min(1, 'product_id vazio').nullable(),
    product_name: z.string().min(1, 'product_name vazio'),
    color: z.string().nullable().optional(),
    consumption_per_unit: z
      .number({ invalid_type_error: 'consumption_per_unit deve ser number' })
      .nonnegative('consumption_per_unit não pode ser negativo'),
    required: z
      .number({ invalid_type_error: 'required deve ser number' })
      .nonnegative('required não pode ser negativo'),
    available: z
      .number({ invalid_type_error: 'available deve ser number' })
      .nonnegative('available não pode ser negativo'),
    stock_ok: z.boolean({ invalid_type_error: 'stock_ok deve ser boolean' }),
    debit_mode: z.enum(DEBIT_MODES, {
      errorMap: () => ({ message: `debit_mode deve ser um de: ${DEBIT_MODES.join(', ')}` }),
    }),
    source: z.enum(CONSUMPTION_SOURCES, {
      errorMap: () => ({
        message: `source deve ser um de: ${CONSUMPTION_SOURCES.join(', ')}`,
      }),
    }),
    matched_by: z.string().optional(),
    category: z.string().optional(),
    unit: z.string().optional(),
    conversion_warning: z.string().nullable().optional(),
  })
  // Postgres devolve numeric como string em alguns drivers — coercionamos
  // ANTES da validação para evitar falsos positivos quando isso acontece.
  .passthrough()
  .superRefine((line, ctx) => {
    if (line.product_id != null) return;
    const warning = (line as Record<string, unknown>).consumption_warning;
    const isWarningLine =
      Number(line.required) === 0 &&
      typeof warning === 'string' &&
      warning.trim().length > 0;
    if (!isWarningLine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['product_id'],
        message: 'product_id nulo só é permitido em linha de AVISO (required=0 + consumption_warning)',
      });
    }
  });

export const ConsumptionResponseSchema = z.array(ConsumptionLineSchema);

/**
 * Erro detalhado emitido quando o JSONB da RPC não bate com o schema.
 * Inclui o índice da linha e o caminho do campo inválido para facilitar
 * o diagnóstico em produção.
 */
export class ConsumptionSchemaError extends Error {
  readonly issues: Array<{ path: string; message: string; received?: unknown }>;
  readonly raw: unknown;

  constructor(zodError: z.ZodError, raw: unknown) {
    const issues = zodError.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
      received: (i as z.ZodIssue & { received?: unknown }).received,
    }));
    const summary = issues
      .slice(0, 5)
      .map((i) => `• ${i.path}: ${i.message}`)
      .join('\n');
    const remaining = issues.length - 5;
    const more = remaining > 0 ? `\n…e mais ${remaining} ${remaining === 1 ? 'problema' : 'problemas'}.` : '';
    super(
      `RPC calculate_order_consumption retornou JSONB inválido ` +
        `(${issues.length} ${issues.length === 1 ? 'problema' : 'problemas'}):\n${summary}${more}`,
    );
    this.name = 'ConsumptionSchemaError';
    this.issues = issues;
    this.raw = raw;
  }
}

/**
 * Coerciona campos que o Postgres pode devolver como string mas o schema
 * espera number (numeric/decimal). Não inventa valores: se a coerção falhar,
 * o Zod emite o erro padrão.
 */
function coerceLine(line: unknown): unknown {
  if (!line || typeof line !== 'object') return line;
  const o = { ...(line as Record<string, unknown>) };
  for (const k of ['consumption_per_unit', 'required', 'available'] as const) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      o[k] = Number(v);
    }
  }
  return o;
}

/**
 * Valida o payload bruto da RPC. Lança `ConsumptionSchemaError` com mensagens
 * detalhadas quando algum campo está faltando ou tem tipo inválido.
 */
export function validateConsumptionPayload(raw: unknown): ConsumptionLine[] {
  const arr = Array.isArray(raw) ? raw.map(coerceLine) : raw;
  const parsed = ConsumptionResponseSchema.safeParse(arr);
  if (!parsed.success) {
    const err = new ConsumptionSchemaError(parsed.error, raw);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(
          new CustomEvent('consumption-schema-error', { detail: err }),
        );
      } catch {
        // ignora erros de evento (jsdom muito antigo etc.)
      }
    }
    throw err;
  }
  return parsed.data as ConsumptionLine[];
}

export type ConsumptionLine = {
  component: string;
  /** null SÓ em linha de AVISO (required=0 + consumption_warning) — ver schema. */
  product_id: string | null;
  product_name: string;
  color?: string | null;
  consumption_per_unit: number;
  required: number;
  available: number;
  stock_ok: boolean;
  debit_mode: 'hard' | 'soft';
  source: string;
  matched_by?: string;
  category?: string;
  unit?: string;
  conversion_warning?: string | null;
  consumption_warning?: string | null;
};

export type ConsumptionSummary = {
  lines: ConsumptionLine[];
  totalRequired: number;
  allStockOk: boolean;
  missing: ConsumptionLine[];
  soldDriven: boolean;
};

export async function calculateConsumption(params: {
  referenceId: string;
  quantity: number;
  color?: string | null;
  size?: number | null;
  materialVariantId?: string | null;
  /**
   * Grade do item/OP. Presente e válida → motor único
   * `calculate_order_consumption_by_grade` (escalada p/ `quantity` via
   * `scaleGradeToTotal`, idempotente se a grade já for absoluta).
   * Ausente → wrapper escalar (grade sintética de 1 numeração).
   */
  grade?: Record<string, number> | null;
}): Promise<ConsumptionSummary> {
  const { referenceId, quantity, color, size, materialVariantId, grade } = params;
  const rpc = isUsableGrade(grade)
    ? supabase.rpc('calculate_order_consumption_by_grade', {
        p_reference_id: referenceId,
        p_grade: scaleGradeToTotal(grade, quantity),
        p_color: color ?? '',
        p_material_variant_id: materialVariantId ?? null,
      })
    : supabase.rpc('calculate_order_consumption', {
        p_reference_id: referenceId,
        p_order_quantity: quantity,
        p_color: color ?? '',
        p_size: size ?? null,
        p_material_variant_id: materialVariantId ?? null,
      });
  const { data, error } = await rpc;

  if (error) {
    console.error('[consumptionService] erro:', error);
    throw new Error(`Erro ao calcular consumo: ${error.message}`);
  }

  const lines = validateConsumptionPayload((data as unknown) ?? []);
  const missing = lines.filter((l) => !l.stock_ok);
  const totalRequired = lines.reduce((acc, l) => acc + Number(l.required || 0), 0);
  const soldDriven = lines.some((l) => l.source === 'sole_spec');

  return { lines, totalRequired, allStockOk: missing.length === 0, missing, soldDriven };
}

export function groupByComponent(lines: ConsumptionLine[]): Record<string, ConsumptionLine[]> {
  return lines.reduce((acc, line) => {
    (acc[line.component] ??= []).push(line);
    return acc;
  }, {} as Record<string, ConsumptionLine[]>);
}

export function validateConsumption(summary: ConsumptionSummary): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  for (const line of summary.missing) {
    errors.push(
      `${line.component} — ${line.product_name}: precisa ${line.required.toFixed(2)}, ` +
      `tem ${line.available.toFixed(2)} em estoque`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export type MultiSkuItem = {
  referenceId: string;
  quantity: number;
  color?: string | null;
  size?: number | null;
  materialVariantId?: string | null;
  grade?: Record<string, number> | null;
  itemKey?: string;
};

export type MultiSkuConsumptionSummary = {
  aggregatedLines: ConsumptionLine[];
  totalRequired: number;
  allStockOk: boolean;
  missing: ConsumptionLine[];
  perItem: Array<{ item: MultiSkuItem; summary: ConsumptionSummary }>;
  soldDriven: boolean;
};

export async function calculateConsumptionMultiSku(
  items: MultiSkuItem[],
): Promise<MultiSkuConsumptionSummary> {
  const summaries = await Promise.all(items.map((item) => calculateConsumption(item)));
  const perItem = items.map((item, i) => ({ item, summary: summaries[i] }));

  const bucket = new Map<string, ConsumptionLine & { _weightedSum: number; _weightTotal: number }>();
  let soldDriven = false;

  for (const { summary } of perItem) {
    if (summary.soldDriven) soldDriven = true;
    for (const line of summary.lines) {
      const key = `${line.product_id}::${line.color ?? ''}`;
      const existing = bucket.get(key);
      if (existing) {
        existing.required += Number(line.required || 0);
        existing.available = Math.min(existing.available, Number(line.available || 0));
        existing._weightedSum += Number(line.consumption_per_unit || 0) * Number(line.required || 0);
        existing._weightTotal += Number(line.required || 0);
      } else {
        bucket.set(key, {
          ...line,
          required: Number(line.required || 0),
          available: Number(line.available || 0),
          _weightedSum: Number(line.consumption_per_unit || 0) * Number(line.required || 0),
          _weightTotal: Number(line.required || 0),
        });
      }
    }
  }

  const aggregatedLines: ConsumptionLine[] = [...bucket.values()].map(
    ({ _weightedSum, _weightTotal, ...rest }) => ({
      ...rest,
      consumption_per_unit: _weightTotal > 0 ? _weightedSum / _weightTotal : rest.consumption_per_unit,
      stock_ok: rest.required <= rest.available,
    }),
  );

  const missing = aggregatedLines.filter((l) => !l.stock_ok);
  const totalRequired = aggregatedLines.reduce((acc, l) => acc + Number(l.required || 0), 0);

  return {
    aggregatedLines,
    totalRequired,
    allStockOk: missing.length === 0,
    missing,
    perItem,
    soldDriven,
  };
}
