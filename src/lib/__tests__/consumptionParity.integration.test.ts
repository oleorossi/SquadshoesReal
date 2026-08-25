/**
 * Paridade numérica entre o motor TS do consumo exibido e o motor SQL usado
 * por custeio/MRP. Por padrão fica SKIP: requer acesso ao banco real.
 *
 * Este teste nasce intencionalmente VERMELHO em `CF 09 ` enquanto o escalar
 * divergir do cadastro por numeração. A migration de correção de dado é que
 * deve fazê-lo passar; não normalize nem esconda a divergência aqui.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import {
  computeConsumptionForItems,
  fetchConsumptionContext,
  fetchTechnicalSheetsForConsumption,
  resolveMaterialProductCanonical,
  type ConsumptionContext,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';
import { validateConsumptionPayload, type ConsumptionLine } from '@/services/consumptionService';

// orderConsumption/consumptionService oferecem o singleton do browser como
// default, mas esta suíte sempre injeta o cliente service-role abaixo. O mock
// hoisted impede que o módulo gerado tente criar um anonClient sem publishable
// key durante a coleta do Vitest no CI.
vi.mock('@/integrations/supabase/client', () => ({ supabase: null }));

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';
const REFERENCE_NAMES = ['CF 09 ', 'DS21', 'S-039'] as const;

/**
 * `technical_sheets` exige usuário aprovado. Quando a integração é habilitada,
 * URL + service role são obrigatórias e a ausência falha explicitamente. Quando
 * está desabilitada, este módulo não instancia cliente algum — assim a suíte
 * normal pode ser coletada sem credenciais de banco/browser.
 */
let integrationClient: SupabaseClient<Database> | null = null;

function dbClient(): SupabaseClient<Database> {
  if (!ENABLED) {
    throw new Error('Cliente DB solicitado com RUN_DB_INTEGRATION desligado.');
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceRoleKey) {
    throw new Error(
      'RUN_DB_INTEGRATION=1 exige VITE_SUPABASE_URL (ou SUPABASE_URL) e '
        + 'SUPABASE_SERVICE_ROLE_KEY; a paridade não aceita cliente anônimo.',
    );
  }

  integrationClient ??= createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return integrationClient;
}
const FALLBACK_GRADE: Record<string, number> = {
  '34': 1,
  '35': 1,
  '36': 1,
  '37': 1,
  '38': 1,
  '39': 1,
};

const numericGradeFromSheet = (
  sheet: { upper_consumption_per_size?: unknown } | null | undefined,
): Record<string, number> => {
  const perSize = sheet?.upper_consumption_per_size;
  if (!perSize || typeof perSize !== 'object' || Array.isArray(perSize)) return FALLBACK_GRADE;
  const sizes = Object.entries(perSize)
    .filter(([size, consumption]) => !size.startsWith('_') && Number(consumption) > 0)
    .map(([size]) => size);
  return sizes.length > 0
    ? Object.fromEntries(sizes.map(size => [size, 1]))
    : FALLBACK_GRADE;
};

const resolveTsProductId = (
  row: MaterialConsumptionRow,
  ctx: ConsumptionContext,
): string | null => {
  if (row.soleProductId) return row.soleProductId;
  if (row.productIds?.length === 1) return row.productIds[0];

  const group = ctx.productGroups.find(candidate => candidate.name === row.groupName);
  const exactProduct = ctx.allProducts.find(product =>
    product.name === row.materialName && (!group || product.group_id === group.id));
  if (exactProduct) return exactProduct.id;

  return resolveMaterialProductCanonical(
    row.groupName,
    row.color,
    ctx.allProducts,
    ctx.productGroups,
  )?.id ?? null;
};

type ProductParityMetadata = {
  components: Set<string>;
  units: Set<string>;
  materials: Set<string>;
  sources: Set<string>;
};

const addMetadata = (
  metadata: Map<string, ProductParityMetadata>,
  productId: string,
  values: { component: string; unit?: string; material: string; source?: string },
) => {
  const current = metadata.get(productId) ?? {
    components: new Set<string>(),
    units: new Set<string>(),
    materials: new Set<string>(),
    sources: new Set<string>(),
  };
  current.components.add(values.component);
  if (values.unit) current.units.add(values.unit);
  current.materials.add(values.material);
  if (values.source) current.sources.add(values.source);
  metadata.set(productId, current);
};

const aggregateTsByProduct = (
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
): {
  quantities: Map<string, number>;
  metadata: Map<string, ProductParityMetadata>;
  unresolved: MaterialConsumptionRow[];
} => {
  const quantities = new Map<string, number>();
  const metadata = new Map<string, ProductParityMetadata>();
  const unresolved: MaterialConsumptionRow[] = [];

  for (const row of rows) {
    if (!(Number(row.totalQuantity) > 0)) continue;
    const productId = resolveTsProductId(row, ctx);
    if (!productId || (row.productIds?.length || 0) > 1) {
      unresolved.push(row);
      continue;
    }
    quantities.set(productId, (quantities.get(productId) || 0) + Number(row.totalQuantity));
    addMetadata(metadata, productId, {
      component: row.componentType,
      unit: row.productUnit,
      material: row.materialName,
    });
  }

  return { quantities, metadata, unresolved };
};

const aggregateSqlByProduct = (rows: ConsumptionLine[]): {
  quantities: Map<string, number>;
  metadata: Map<string, ProductParityMetadata>;
} => {
  const quantities = new Map<string, number>();
  const metadata = new Map<string, ProductParityMetadata>();
  for (const row of rows) {
    if (!row.product_id || !(Number(row.required) > 0)) continue;
    quantities.set(row.product_id, (quantities.get(row.product_id) || 0) + Number(row.required));
    addMetadata(metadata, row.product_id, {
      component: row.component,
      unit: row.unit,
      material: row.product_name,
      source: row.source,
    });
  }
  return { quantities, metadata };
};

(ENABLED ? describe : describe.skip)('consumo — paridade numérica TS × SQL', () => {
  it('compara referências reais por product_id com tolerância de 0,01', async () => {
    const supabase = dbClient();
    const { data: references, error: referencesError } = await supabase
      .from('technical_sheets')
      .select('id, name')
      .in('name', [...REFERENCE_NAMES]);
    if (referencesError) throw referencesError;

    const foundNames = new Set((references || []).map(reference => reference.name));

    expect(
      REFERENCE_NAMES.filter(name => !foundNames.has(name)),
      'As fixtures de paridade precisam continuar apontando para referências reais.',
    ).toEqual([]);

    const referenceIds = (references || []).map(reference => reference.id);
    const [{ data: orders, error: ordersError }, sheetMap, ctx] = await Promise.all([
      supabase
        .from('orders')
        .select('reference_id, color')
        .in('reference_id', referenceIds)
        .order('created_at', { ascending: false }),
      fetchTechnicalSheetsForConsumption(referenceIds, supabase),
      fetchConsumptionContext(referenceIds, supabase),
    ]);
    if (ordersError) throw ordersError;

    const colorByReference = new Map<string, string>();
    for (const order of orders || []) {
      if (order.reference_id && !colorByReference.has(order.reference_id)) {
        colorByReference.set(order.reference_id, order.color || '');
      }
    }

    const mismatches: Array<Record<string, unknown>> = [];

    for (const reference of references || []) {
      const sheet = sheetMap.get(reference.id);
      expect(sheet, `Ficha ${reference.name} não carregada pelo motor TS`).toBeTruthy();
      const grade = numericGradeFromSheet(sheet);
      const quantity = Object.values(grade).reduce((sum, value) => sum + Number(value), 0);
      const color = colorByReference.get(reference.id) || '';

      const tsRows = computeConsumptionForItems([{
        reference_id: reference.id,
        color,
        quantity,
        grade,
        fichas: null,
        material_variant_id: null,
        technical_sheets: sheet,
      }], ctx);

      const { data: sqlPayload, error: sqlError } = await supabase.rpc(
        'calculate_order_consumption_by_grade',
        {
          p_reference_id: reference.id,
          p_grade: grade,
          p_color: color,
          p_material_variant_id: null,
        },
      );
      if (sqlError) throw sqlError;
      const sqlRows = validateConsumptionPayload((sqlPayload as unknown) ?? []);

      const ts = aggregateTsByProduct(tsRows, ctx);
      const sql = aggregateSqlByProduct(sqlRows);
      for (const row of ts.unresolved) {
        mismatches.push({
          reference: reference.name,
          product_id: null,
          ts_component: row.componentType,
          ts_unit: row.productUnit,
          ts_required: row.totalQuantity,
          sql_required: null,
          material: row.materialName,
        });
      }

      const productIds = new Set([...ts.quantities.keys(), ...sql.quantities.keys()]);
      for (const productId of productIds) {
        const tsRequired = ts.quantities.get(productId) || 0;
        const sqlRequired = sql.quantities.get(productId) || 0;
        if (Math.abs(tsRequired - sqlRequired) > 0.01) {
          const tsMeta = ts.metadata.get(productId);
          const sqlMeta = sql.metadata.get(productId);
          mismatches.push({
            reference: reference.name,
            product_id: productId,
            product_name: ctx.allProducts.find(product => product.id === productId)?.name ?? null,
            ts_components: [...(tsMeta?.components ?? [])],
            sql_components: [...(sqlMeta?.components ?? [])],
            ts_units: [...(tsMeta?.units ?? [])],
            sql_units: [...(sqlMeta?.units ?? [])],
            ts_materials: [...(tsMeta?.materials ?? [])],
            sql_materials: [...(sqlMeta?.materials ?? [])],
            sql_sources: [...(sqlMeta?.sources ?? [])],
            ts_required: tsRequired,
            sql_required: sqlRequired,
            delta: tsRequired - sqlRequired,
          });
        }
      }
    }

    expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
  }, 30_000);
});
