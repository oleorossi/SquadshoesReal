import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import {
  classifyBomMaterial,
  type ConsumptionContext,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';
import {
  parseCanonicalStrapDemandPreview,
  replaceWithCanonicalStrapRows,
  type CanonicalStrapDemandPreview,
} from '@/lib/canonicalStrapDemandPreview';
import {
  annotateConsumptionAvailability,
  type ConsumptionRow,
} from '@/lib/consumptionRows';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

interface CanonicalConsumptionRpcResult {
  data: unknown;
  error: { message?: string } | null;
}

interface CanonicalConsumptionRpcClient {
  rpc: (
    name: string,
    params?: Record<string, unknown>,
  ) => PromiseLike<CanonicalConsumptionRpcResult>;
}

const canonicalConsumptionRpc = supabase as unknown as CanonicalConsumptionRpcClient;

const uuid = z.string().uuid();
const finiteNonNegative = z.number().finite().nonnegative();
const gradeSchema = z.record(
  z.union([z.number().finite().nonnegative(), z.string()]),
).nullable().superRefine((grade, ctx) => {
  for (const [key, value] of Object.entries(grade || {})) {
    if (key.startsWith('_')) continue;
    if (typeof value !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'quantidade da grade deve ser numérica',
      });
    }
  }
});

const lineBaseSchema = z.object({
  scope_key: uuid,
  scope_type: z.enum(['sale_order_item', 'production_order']),
  sale_order_id: uuid.nullable(),
  sale_order_item_id: uuid.nullable(),
  reference_id: uuid,
  quantity: z.number().finite().positive(),
  effective_grade: gradeSchema,
  component: z.string().min(1),
  product_name: z.string().min(1),
  product_unit: z.string().min(1),
  required: finiteNonNegative,
  available: finiteNonNegative.optional().default(0),
  stock_ok: z.boolean().optional().default(false),
  source: z.string().optional().nullable(),
  debit_mode: z.enum(['hard', 'soft']).optional().default('soft'),
  color: z.string().optional().nullable(),
  product_color: z.string().optional().nullable(),
  product_category: z.string().optional().nullable(),
  product_group_id: uuid.optional().nullable(),
  product_group_name: z.string().optional().nullable(),
  conversion_warning: z.string().optional().nullable(),
  consumption_warning: z.string().optional().nullable(),
  warning: z.string().optional().nullable(),
  matched_by: z.string().optional().nullable(),
});

const materialLineSchema = lineBaseSchema.extend({
  line_kind: z.literal('material'),
  product_id: uuid.nullable(),
}).superRefine((line, ctx) => {
  const warning = [line.warning, line.conversion_warning, line.consumption_warning]
    .some((value) => typeof value === 'string' && value.trim().length > 0);
  if (line.required > 0 && !line.product_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['product_id'],
      message: 'linha positiva do motor sem product_id',
    });
  }
  if (line.required === 0 && !line.product_id && !warning) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['warning'],
      message: 'linha sem identidade precisa explicar a pendência',
    });
  }
});

const packagingLineSchema = lineBaseSchema.extend({
  line_kind: z.literal('packaging'),
  box_type_id: uuid.nullable(),
  packaging_type: z.string().min(1),
  unit_price: finiteNonNegative.optional().default(0),
  supplier_id: uuid.optional().nullable(),
}).superRefine((line, ctx) => {
  if (line.required > 0 && !line.box_type_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['box_type_id'],
      message: 'embalagem positiva sem box_type_id',
    });
  }
  if (line.required === 0 && !line.box_type_id && !line.warning?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['warning'],
      message: 'embalagem sem identidade precisa explicar a pendência',
    });
  }
});

const canonicalLineSchema = z.union([
  materialLineSchema,
  packagingLineSchema,
]);

const strapPreviewSchema = z.object({
  scope_key: uuid,
  scope_type: z.enum(['sale_order_item', 'production_order']),
  sale_order_id: uuid,
  sale_order_item_id: uuid,
  line_ordinal: z.number().int().nonnegative(),
  technical_strap_line_id: uuid.nullable(),
  strap_variant_id: uuid.nullable(),
  source_mode: z.enum(['internal', 'buy_ready']).nullable(),
  gross_required_m: finiteNonNegative,
  recipe_id: uuid.nullable(),
  base_product_id: uuid.nullable(),
  finished_product_id: uuid.nullable(),
  blocking_reasons: z.array(z.unknown()),
  resolved: z.record(z.unknown()),
}).passthrough().superRefine((preview, ctx) => {
  if (!preview.technical_strap_line_id && preview.blocking_reasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['technical_strap_line_id'],
      message: 'preview sem linha técnica precisa explicar a pendência',
    });
  }
  if (preview.gross_required_m > 0
      && !preview.source_mode
      && preview.blocking_reasons.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_mode'],
      message: 'demanda positiva sem origem precisa explicar a pendência',
    });
  }
});

const responseSchema = z.object({
  version: z.literal(1),
  engine: z.literal('calculate_order_consumption_by_grade'),
  lines: z.array(canonicalLineSchema),
  strap_previews: z.array(strapPreviewSchema),
});

export type CanonicalConsumptionLine = z.infer<typeof canonicalLineSchema>;
export type CanonicalConsumptionReport = z.infer<typeof responseSchema>;

export class CanonicalConsumptionReportError extends Error {
  readonly issues: Array<{ path: string; message: string }>;
  readonly raw: unknown;

  constructor(error: z.ZodError, raw: unknown) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    super(
      `RPC de consumo canônico devolveu payload inválido: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'CanonicalConsumptionReportError';
    this.issues = issues;
    this.raw = raw;
  }
}

export function validateCanonicalConsumptionReport(
  raw: unknown,
): CanonicalConsumptionReport {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new CanonicalConsumptionReportError(parsed.error, raw);
  return parsed.data;
}

const uniqueIds = (ids: string[] | null | undefined): string[] =>
  [...new Set((ids || []).map((id) => id.trim()).filter(Boolean))].sort();

export async function fetchCanonicalConsumptionReport(params: {
  saleOrderIds?: string[];
  orderIds?: string[];
}): Promise<CanonicalConsumptionReport> {
  const saleOrderIds = uniqueIds(params.saleOrderIds);
  const orderIds = uniqueIds(params.orderIds);
  if ((saleOrderIds.length > 0) === (orderIds.length > 0)) {
    throw new Error('Informe exatamente um escopo de consumo: PVs ou OPs.');
  }

  const { data, error } = await canonicalConsumptionRpc.rpc(
    'calculate_consumption_report_batch',
    {
      p_sale_order_ids: saleOrderIds.length > 0 ? saleOrderIds : null,
      p_order_ids: orderIds.length > 0 ? orderIds : null,
    },
  );
  if (error) throw new Error(error.message || 'Falha ao calcular consumo canônico.');
  return validateCanonicalConsumptionReport(data);
}

const formatCanonicalWarning = (value: string): string => {
  const prefix = 'material_color_not_registered:';
  if (!value.startsWith(prefix)) return value;
  const [component = 'Material', color = 'cor solicitada'] = value
    .slice(prefix.length)
    .split(':');
  return `${component} · ${color}: não existe SKU dessa cor no grupo físico.`;
};

const warningText = (line: CanonicalConsumptionLine): string | undefined => {
  const values = [line.warning, line.conversion_warning, line.consumption_warning]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .map(formatCanonicalWarning);
  return values.length > 0 ? [...new Set(values)].join(' · ') : undefined;
};

const componentType = (line: CanonicalConsumptionLine): string => {
  const raw = line.component.trim();
  const normalized = raw.toLowerCase();
  if (raw === 'BOM' || raw === 'Componente Direto' || raw === 'Item padrão (solado)') return raw;
  if (normalized.includes('forração palmilha') || normalized.includes('forracao palmilha')) {
    return 'Forração Palmilha';
  }
  if (normalized.includes('forração') || normalized.includes('forracao') || normalized.includes('lining')) {
    return 'Forração';
  }
  if (normalized.includes('fachete')) return 'Fachete';
  if (normalized.includes('palmilha')) return 'Palmilha';
  if (normalized === 'solado' || normalized.includes('primary_sole')) return 'Solado';
  if (normalized.includes('cabedal')) return 'Cabedal';
  if (normalized.includes('tira')) return 'Tiras';
  if (normalized.includes('embalagem')) return 'Embalagem';

  return classifyBomMaterial(
    line.product_group_name || '',
    line.product_name,
    line.product_category || raw,
  );
};

const mergeGrade = (
  target: Record<string, number> | undefined,
  source: Record<string, number | string> | null,
): Record<string, number> | undefined => {
  if (!source) return target;
  const result = { ...(target || {}) };
  for (const [size, quantity] of Object.entries(source)) {
    if (size.startsWith('_') || typeof quantity !== 'number' || !(quantity > 0)) continue;
    result[size] = (result[size] || 0) + quantity;
  }
  return Object.keys(result).length > 0 ? result : target;
};

/**
 * Adapta fatos SQL ao shape visual. Não calcula consumo: `totalQuantity` é
 * sempre o `required` devolvido pela RPC; a grade é apenas breakdown do solado.
 */
export function adaptCanonicalConsumptionLines(
  lines: CanonicalConsumptionLine[],
  scopeKeys?: ReadonlySet<string>,
): MaterialConsumptionRow[] {
  const grouped = new Map<string, MaterialConsumptionRow>();

  for (const line of lines) {
    if (scopeKeys && !scopeKeys.has(line.scope_key)) continue;
    const component = componentType(line);
    const packaging = line.line_kind === 'packaging';
    const groupName = packaging
      ? 'Embalagem'
      : line.product_group_name?.trim() || line.product_name.trim();
    const materialName = line.product_name.trim();
    const color = (line.color || line.product_color || '—').trim() || '—';
    const unit = line.product_unit.trim();
    const warning = warningText(line);
    const productId = !packaging ? line.product_id : null;
    const boxTypeId = packaging ? line.box_type_id : null;
    const key = [
      component,
      productId || '',
      boxTypeId || '',
      groupName,
      materialName,
      color,
      unit,
    ].join('::');
    const existing = grouped.get(key);
    const grade = component === 'Solado' ? line.effective_grade : null;

    if (existing) {
      existing.totalQuantity += line.required;
      existing.sizeBreakdown = mergeGrade(existing.sizeBreakdown, grade);
      existing.productIds = [...new Set([
        ...(existing.productIds || []),
        ...(productId ? [productId] : []),
      ])];
      existing.boxTypeIds = [...new Set([
        ...(existing.boxTypeIds || []),
        ...(boxTypeId ? [boxTypeId] : []),
      ])];
      if (warning) {
        existing.warning = [...new Set([
          ...(existing.warning ? existing.warning.split(' · ') : []),
          warning,
        ])].join(' · ');
      }
      continue;
    }

    grouped.set(key, {
      componentType: component,
      groupName,
      materialName,
      productUnit: unit,
      color,
      totalQuantity: line.required,
      widthMissing: !!line.conversion_warning
        && /largura|dimens(?:ão|ao)/i.test(line.conversion_warning),
      warning,
      sizeBreakdown: mergeGrade(undefined, grade),
      soleProductId: component === 'Solado' ? productId : null,
      productIds: productId ? [productId] : [],
      boxTypeIds: boxTypeId ? [boxTypeId] : [],
    });
  }

  return [...grouped.values()].filter(
    (row) => row.totalQuantity > 0 || !!row.warning,
  );
}

export type ScopedCanonicalStrapPreview = {
  scopeKey: string;
  preview: CanonicalStrapDemandPreview;
};

export function canonicalStrapPreviews(
  report: CanonicalConsumptionReport,
  scopeKeys?: ReadonlySet<string>,
): ScopedCanonicalStrapPreview[] {
  return report.strap_previews
    .filter((raw) => !scopeKeys || scopeKeys.has(raw.scope_key))
    .map((raw) => ({
      scopeKey: raw.scope_key,
      preview: parseCanonicalStrapDemandPreview(raw as unknown as Record<string, unknown>),
    }));
}

const emptyContext = (allProducts: unknown[] = []): ConsumptionContext => ({
  allProducts,
  productGroups: [],
  componentSheets: [],
  materials: [],
  boxTypes: [],
} as unknown as ConsumptionContext);

export function applyCanonicalStrapsForPresentation(
  rows: MaterialConsumptionRow[],
  previews: CanonicalStrapDemandPreview[],
): MaterialConsumptionRow[] {
  return replaceWithCanonicalStrapRows(rows, emptyContext(), previews);
}

async function loadStockContext(
  lines: CanonicalConsumptionLine[],
  previews: ScopedCanonicalStrapPreview[],
): Promise<ConsumptionContext> {
  const productIds = new Set<string>();
  const boxTypeIds = new Set<string>();
  for (const line of lines) {
    if (line.line_kind === 'material' && line.product_id) productIds.add(line.product_id);
    if (line.line_kind === 'packaging' && line.box_type_id) boxTypeIds.add(line.box_type_id);
  }
  for (const { preview } of previews) {
    if (preview.finishedProductId) productIds.add(preview.finishedProductId);
  }

  const [productsResult, boxesResult] = await Promise.all([
    productIds.size > 0
      ? supabase
        .from('products')
        .select('id, name, unit, color, category, group_id, quantity, reserved_stock, stock_grade')
        .in('id', [...productIds])
      : Promise.resolve({ data: [], error: null }),
    boxTypeIds.size > 0
      ? supabase
        .from('box_types')
        .select('id, nome, quantity, unit_price, supplier_id, active')
        .in('id', [...boxTypeIds])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (boxesResult.error) throw boxesResult.error;

  return {
    ...emptyContext(productsResult.data || []),
    boxTypes: boxesResult.data || [],
  } as unknown as ConsumptionContext;
}

export async function materializeCanonicalConsumptionReport(
  report: CanonicalConsumptionReport,
  scopeKeys?: ReadonlySet<string>,
): Promise<{ rows: ConsumptionRow[]; artisanalStrapRows: ArtisanalStrapCutRow[] }> {
  const scopedLines = scopeKeys
    ? report.lines.filter((line) => scopeKeys.has(line.scope_key))
    : report.lines;
  const scopedPreviews = canonicalStrapPreviews(report, scopeKeys);
  const rows = adaptCanonicalConsumptionLines(scopedLines);
  const ctx = await loadStockContext(scopedLines, scopedPreviews);
  return annotateConsumptionAvailability(
    rows,
    ctx,
    scopedPreviews.map(({ preview }) => preview),
  );
}
