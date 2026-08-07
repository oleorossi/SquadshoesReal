/**
 * Paridade numérica entre o motor TS do consumo exibido e o motor SQL usado
 * por custeio/MRP. Por padrão fica SKIP: requer acesso ao banco real.
 *
 * Este teste nasce intencionalmente VERMELHO em `CF 09 ` enquanto o escalar
 * divergir do cadastro por numeração. A migration de correção de dado é que
 * deve fazê-lo passar; não normalize nem esconda a divergência aqui.
 */
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabase as anonClient } from '@/integrations/supabase/client';
import {
  computeConsumptionForItems,
  fetchConsumptionContext,
  fetchTechnicalSheetsForConsumption,
  resolveMaterialProductCanonical,
  type ConsumptionContext,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';
import { validateConsumptionPayload, type ConsumptionLine } from '@/services/consumptionService';

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';
const REFERENCE_NAMES = ['CF 09 ', 'DS21', 'S-039'] as const;

/**
 * `technical_sheets` está sob a policy `technical_sheets_select_approved`, que
 * exige `is_approved_user()`. A chave publishable NÃO é um usuário aprovado, então
 * um SELECT anônimo volta 0 linhas **sem erro** — e o teste falharia na checagem de
 * fixture, vermelho por motivo ambiental em vez de por divergência de número.
 *
 * Para rodar de verdade, exporte `SUPABASE_SERVICE_ROLE_KEY`. Sem ela, o teste faz
 * skip dizendo o porquê, em vez de fingir um vermelho que não prova nada.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SERVICE_KEY
  ? createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
      SERVICE_KEY,
      { auth: { persistSession: false } },
    )
  : anonClient;
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

const aggregateTsByProduct = (
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
): { quantities: Map<string, number>; unresolved: MaterialConsumptionRow[] } => {
  const quantities = new Map<string, number>();
  const unresolved: MaterialConsumptionRow[] = [];

  for (const row of rows) {
    if (!(Number(row.totalQuantity) > 0)) continue;
    const productId = resolveTsProductId(row, ctx);
    if (!productId || (row.productIds?.length || 0) > 1) {
      unresolved.push(row);
      continue;
    }
    quantities.set(productId, (quantities.get(productId) || 0) + Number(row.totalQuantity));
  }

  return { quantities, unresolved };
};

const aggregateSqlByProduct = (rows: ConsumptionLine[]): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const row of rows) {
    if (!row.product_id || !(Number(row.required) > 0)) continue;
    quantities.set(row.product_id, (quantities.get(row.product_id) || 0) + Number(row.required));
  }
  return quantities;
};

(ENABLED ? describe : describe.skip)('consumo — paridade numérica TS × SQL', () => {
  it('compara referências reais por product_id com tolerância de 0,01', async (testCtx) => {
    const { data: references, error: referencesError } = await supabase
      .from('technical_sheets')
      .select('id, name')
      .in('name', [...REFERENCE_NAMES]);
    if (referencesError) throw referencesError;

    const foundNames = new Set((references || []).map(reference => reference.name));

    // RLS devolve 0 linhas SEM erro para quem não é usuário aprovado. Isso é
    // ambiente, não divergência — falhar aqui produziria um vermelho que continua
    // vermelho depois da correção de dado, e portanto não prova nada.
    if (foundNames.size === 0 && !SERVICE_KEY) {
      testCtx.skip(
        'technical_sheets exige is_approved_user(); exporte SUPABASE_SERVICE_ROLE_KEY para rodar a paridade de verdade.',
      );
      return;
    }

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
      fetchTechnicalSheetsForConsumption(referenceIds),
      fetchConsumptionContext(referenceIds),
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
          ts_required: row.totalQuantity,
          sql_required: null,
          material: row.materialName,
        });
      }

      const productIds = new Set([...ts.quantities.keys(), ...sql.keys()]);
      for (const productId of productIds) {
        const tsRequired = ts.quantities.get(productId) || 0;
        const sqlRequired = sql.get(productId) || 0;
        if (Math.abs(tsRequired - sqlRequired) > 0.01) {
          mismatches.push({
            reference: reference.name,
            product_id: productId,
            ts_required: tsRequired,
            sql_required: sqlRequired,
            delta: tsRequired - sqlRequired,
          });
        }
      }
    }

    expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
  });
});
