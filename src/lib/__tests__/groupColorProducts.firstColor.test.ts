/* eslint-disable @typescript-eslint/no-explicit-any -- dublê chainable do supabase-js */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comportamento — não texto — da 1ª cor de um grupo (spec grupo-cor-obrigatoria.md).
 *
 * O contrato antigo (`cabedalDublagem.contract.test.ts`) só conferia que a string
 * "Informe a unidade de estoque da primeira cor" EXISTIA no arquivo. Ela existia,
 * mas atrás de uma trava anterior ("O grupo ainda não tem item-modelo") que
 * devolvia erro antes — a rota era código morto e o teste ficava verde.
 */

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: any; columns?: string; filters: Array<[string, unknown]> }>,
  handler: (_call: any): { data?: any; error?: any } => ({ data: null, error: null }),
}));

vi.mock('@/integrations/supabase/client', () => {
  const makeQuery = (table: string) => {
    const call = { table, op: 'select', filters: [] as Array<[string, unknown]>, payload: undefined as any, columns: undefined as string | undefined };
    const q: any = {
      select: (columns?: string) => { if (call.op === 'select') call.columns = columns; return q; },
      insert: (payload: any) => { call.op = 'insert'; call.payload = payload; return q; },
      update: (payload: any) => { call.op = 'update'; call.payload = payload; return q; },
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => q,
      single: () => q,
      then: (resolve: any, reject: any) => {
        db.calls.push(call);
        return Promise.resolve(db.handler(call)).then(resolve, reject);
      },
    };
    return q;
  };
  return { supabase: { from: (table: string) => makeQuery(table) } };
});

vi.mock('@/lib/productSku', () => ({
  allocateUniqueSku: async (candidates: string[]) => candidates.find(Boolean) ?? 'SKU',
}));

import { createGroupColorProduct } from '@/lib/groupColorProducts';

const GROUP_ID = '42ef8dd6-2f6d-4230-a908-19d553f411ae';

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    is_artisanal_strap: false,
    is_family: false,
    shared_specs: false,
    is_bom_color_source: false,
    is_color_agnostic: false,
    sector: 'Cabedal',
    consumption_unit: null,
    dimensions_length: 0,
    dimensions_width: 1370,
    dimensions_thickness: 0,
    dimensions_unit: 'mm',
    ...overrides,
  };
}

/** Banco de um grupo: `group` = linha de product_groups; `products` = itens. */
function seed(group: Record<string, unknown>, products: any[] = []) {
  db.calls = [];
  db.handler = (call) => {
    if (call.table === 'product_groups' && call.op === 'select') return { data: group, error: null };
    if (call.table === 'product_groups' && call.op === 'update') return { data: null, error: null };
    if (call.table === 'products' && call.op === 'insert') return { data: null, error: null };
    if (call.table === 'products' && call.op === 'select') {
      if (call.columns === '*') return { data: products[0] ?? null, error: null };
      return { data: products, error: null };
    }
    return { data: null, error: null };
  };
}

const updates = () => db.calls.filter(c => c.table === 'product_groups' && c.op === 'update');
const inserts = () => db.calls.filter(c => c.table === 'products' && c.op === 'insert');

describe('createGroupColorProduct — primeira cor', () => {
  beforeEach(() => seed(groupRow()));

  it('grupo vazio em "Coleção de itens" + unidade → vira Linha com variantes e cria a cor', async () => {
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA ROOTS', color: 'PRETO', stockUnit: 'm' });

    expect(result).toMatchObject({ status: 'created', convertedToVariantLine: true });
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ shared_specs: true, consumption_unit: 'm' });
    // Guard contra conversão concorrente: só converte quem ainda é coleção.
    expect(updates()[0].filters).toEqual([['id', GROUP_ID], ['shared_specs', false]]);

    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].payload).toMatchObject({
      color: 'PRETO',
      unit: 'm',
      purchase_unit: 'm',
      calculation_method: 'meter',
      category: 'Cabedal',
      group_id: GROUP_ID,
      dimensions_width: 1370,
    });
  });

  it('preserva a unidade técnica que o grupo já tinha', async () => {
    seed(groupRow({ consumption_unit: 'dm²' }));
    await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA ROOTS', color: 'PRETO', stockUnit: 'm' });
    expect(updates()[0].payload).toEqual({ shared_specs: true, consumption_unit: 'dm²' });
  });

  it('grupo vazio sem unidade → pede a unidade, não grava nada', async () => {
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA ROOTS', color: 'PRETO' });
    expect(result.status).toBe('error');
    expect(result.error).toContain('Informe a unidade de estoque da primeira cor');
    expect(updates()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it('Linha com variantes vazia + unidade → cria sem converter (a trava "item-modelo" morreu)', async () => {
    seed(groupRow({ shared_specs: true, consumption_unit: 'm' }));
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA SOFT COM PU 600', color: 'OFF WHITE', stockUnit: 'm' });
    expect(result).toMatchObject({ status: 'created', convertedToVariantLine: false });
    expect(result.error ?? '').not.toContain('item-modelo');
    expect(updates()).toHaveLength(0);
    expect(inserts()).toHaveLength(1);
  });

  it('Linha com variantes vazia sem unidade → erro de unidade, não de item-modelo', async () => {
    seed(groupRow({ shared_specs: true, consumption_unit: 'm' }));
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA SOFT COM PU 600', color: 'OFF WHITE' });
    expect(result.status).toBe('error');
    expect(result.error).toContain('Informe a unidade de estoque da primeira cor');
  });

  it('"Coleção de itens" COM item → continua recusando, sem converter', async () => {
    seed(groupRow(), [{ id: 'p1', color: 'AZUL', unit: 'un', is_artisanal: false }]);
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'COMPONENTES DIVERSOS', color: 'PRETO', stockUnit: 'un' });
    expect(result.status).toBe('error');
    expect(result.error).toContain('Linha com variantes');
    expect(updates()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it('grupo sem cor (is_color_agnostic) → recusa mesmo vazio', async () => {
    seed(groupRow({ is_color_agnostic: true, sector: 'Palmilha' }));
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'FIBRA', color: 'PRETO', stockUnit: 'placa' });
    expect(result.status).toBe('error');
    expect(updates()).toHaveLength(0);
  });

  it('com item-modelo, herda a unidade dele e ignora a unidade informada', async () => {
    seed(groupRow({ shared_specs: true, consumption_unit: 'm' }), [
      { id: 'p1', color: 'AZUL', unit: 'm', purchase_unit: 'm', unit_price: 42, calculation_method: 'weight', sku: 'NAPA-AZUL', is_artisanal: false },
    ]);
    const result = await createGroupColorProduct({ groupId: GROUP_ID, groupName: 'NAPA SOFT', color: 'PRETO', stockUnit: 'kg' });
    expect(result.status).toBe('created');
    expect(inserts()[0].payload).toMatchObject({ unit: 'm', unit_price: 42, calculation_method: 'weight' });
  });
});
