// =============================================================================
// consumptionService.ts
// Serviço único que chama calculate_order_consumption no Supabase.
// Frontend e backend usam a MESMA lógica (sem duplicação).
// =============================================================================
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

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
  // valores legados/auxiliares que o SQL pode emitir em casos antigos
  'fallback_default',
  'sole_driven_default',
  'fallback_average',
] as const;

export const ConsumptionLineSchema = z
  .object({
    component: z.string().min(1, 'component vazio'),
    product_id: z.string().min(1, 'product_id vazio'),
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
  .passthrough();

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
    // Notifica observadores globais (ex.: alerta no Dashboard).
    // Em ambientes sem `window` (SSR/teste node), o emit é silencioso.
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
  product_id: string;
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
  /** Aviso de get_material_conversion_info quando o material não tem largura
   *  cadastrada em component_sheets — o valor pode estar ~100x inflado. */
  conversion_warning?: string | null;
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
}): Promise<ConsumptionSummary> {
  const { referenceId, quantity, color, size, materialVariantId } = params;
  // p_material_variant_id agora ATIVO: a RPC SQL (mig 20260629210000) aplica
  // overrides de produto e consumo dm²/par dos 4 componentes principais
  // (cabedal/forro/palmilha/solado) quando variant_id é passado. Sem variant
  // (NULL) o comportamento é idêntico à versão anterior.
  const { data, error } = await supabase.rpc('calculate_order_consumption', {
    p_reference_id: referenceId,
    p_order_quantity: quantity,
    p_color: color ?? '',
    p_size: size ?? null,
    p_material_variant_id: materialVariantId ?? null,
  });

  if (error) {
    console.error('[consumptionService] erro:', error);
    throw new Error(`Erro ao calcular consumo: ${error.message}`);
  }

  // Validação de schema: trava regressões silenciosas vindas da RPC.
  // Em produção, capturamos e logamos o detalhe — o erro detalhado já vem
  // formatado via ConsumptionSchemaError.
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

/**
 * Item de um pedido com múltiplos SKUs (ex.: PV com várias referências e/ou
 * variações de cor/tamanho). Cada item dispara uma chamada à RPC de consumo.
 */
export type MultiSkuItem = {
  referenceId: string;
  quantity: number;
  color?: string | null;
  size?: number | null;
  /** Identificador opcional do item dentro do pedido (para rastreio). */
  itemKey?: string;
};

/**
 * Resultado agregado de um pedido multi-SKU. As linhas são consolidadas por
 * `product_id` (mesma matéria-prima usada por múltiplos SKUs vira UMA linha
 * com `required` somado) e o detalhamento por componente é preservado.
 */
export type MultiSkuConsumptionSummary = {
  /** Linhas agregadas por product_id (com required somado entre SKUs). */
  aggregatedLines: ConsumptionLine[];
  /** Soma de `required` de todas as linhas. */
  totalRequired: number;
  /** True se TODOS os materiais agregados têm estoque. */
  allStockOk: boolean;
  /** Linhas agregadas com falta. */
  missing: ConsumptionLine[];
  /** Resultados por SKU (na ordem dos itens recebidos), para inspeção. */
  perItem: Array<{ item: MultiSkuItem; summary: ConsumptionSummary }>;
  /** True se algum SKU foi resolvido por sole_spec. */
  soldDriven: boolean;
};

/**
 * Calcula consumo para múltiplos SKUs do mesmo pedido e agrega por material.
 *
 * Regras de agregação:
 *  • mesma `(product_id, color)` em vários SKUs → soma `required`;
 *  • `available` é o snapshot do estoque — preservamos o MENOR observado
 *    (a chamada paralela ao Supabase retorna o mesmo valor, mas defendemos
 *    contra mudanças entre chamadas);
 *  • `consumption_per_unit` perde sentido após agregação (cada SKU pode ter
 *    o seu) — devolvemos a média ponderada por `required` para diagnóstico;
 *  • `stock_ok` é recalculado: `required <= available` da linha agregada.
 *
 * IMPORTANT: agregamos por `(product_id, color)` porque a mesma matéria-prima
 * em cores diferentes é tratada como SKUs distintos no estoque.
 */
export async function calculateConsumptionMultiSku(
  items: MultiSkuItem[],
): Promise<MultiSkuConsumptionSummary> {
  // Execução PARALELA: cada SKU dispara uma chamada independente à RPC.
  // A agregação é determinística porque acontece DEPOIS do Promise.all
  // sobre uma ordem estável (a mesma do `items` recebido) — não há
  // condição de corrida na escrita do bucket.
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
