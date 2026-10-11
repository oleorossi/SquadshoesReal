/* eslint-disable @typescript-eslint/no-explicit-any -- dublê chainable do supabase-js */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  groupInserts: [] as any[],
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  groupInsertResult: { data: null as any, error: null as any },
  rpcResult: { data: true as any, error: null as any },
  productBatches: [] as any[][],
  batchResult: { success: true } as any,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      let payload: any;
      const q: any = {
        insert: (p: any) => { payload = p; return q; },
        select: () => q,
        single: () => q,
        then: (resolve: any, reject: any) => {
          if (table === 'product_groups') db.groupInserts.push(payload);
          return Promise.resolve(db.groupInsertResult).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: (fn: string, args: any) => {
      db.rpcCalls.push({ fn, args });
      return Promise.resolve(db.rpcResult);
    },
  },
}));

vi.mock('@/lib/stockCommand', () => ({
  createProductsWithStock: async (rows: any[]) => {
    db.productBatches.push(rows);
    return db.batchResult;
  },
}));

import {
  buildUniqueSkus,
  colorRequirement,
  createGroupWithColors,
  normalizeColorList,
} from '@/lib/createGroupWithColors';

const baseInput = {
  group: {
    name: 'napa roots',
    description: 'MATERIAL PRA CORTE A FIO',
    sector: 'Cabedal',
    auto_component_sheet: true,
    parent_group_id: null,
    dimensions_width: 1370,
    dimensions_unit: 'mm',
  },
  colors: ['preto', 'Off White', 'PRETO', ''],
  unit: 'm',
  unitPrice: 38.5,
  existingSkus: ['NAPAROOTS-PRETO'],
};

describe('colorRequirement — quem nasce com cor (decisão do dono, 11/10/2026)', () => {
  it.each([
    ['Cabedal', 'required'],
    ['Forração da Palmilha', 'required'],
    ['Solado', 'required'],
    ['Componente', 'ask'],
    ['Palmilha', 'none'],
    ['Cola / Químico', 'none'],
    ['Ferramentas', 'none'],
    ['Fôrma', 'none'],
    ['Material Base', 'none'],
    ['', 'none'],
  ])('%s → %s', (sector, expected) => {
    expect(colorRequirement({ sector, isFamily: false, isArtisanalStrap: false })).toBe(expected);
  });

  it('família técnica e tira acabada nunca recebem cor na criação', () => {
    expect(colorRequirement({ sector: 'Cabedal', isFamily: true, isArtisanalStrap: false })).toBe('none');
    expect(colorRequirement({ sector: 'Componente', isFamily: false, isArtisanalStrap: true })).toBe('none');
  });
});

describe('helpers', () => {
  it('normaliza cores: CAIXA ALTA, sem vazio, sem repetição por acento', () => {
    expect(normalizeColorList(['preto', ' Off White ', 'PRETO', '', 'Café', 'CAFE'])).toEqual(['PRETO', 'OFF WHITE', 'CAFÉ']);
  });

  it('SKU único contra o banco e dentro do próprio lote', () => {
    expect(buildUniqueSkus('NAPA ROOTS', ['PRETO', 'PRETO', 'OFF WHITE'], ['NAPAROOTS-PRETO']))
      .toEqual(['NAPAROOTS-PRETO-2', 'NAPAROOTS-PRETO-3', 'NAPAROOTS-OFFWHITE']);
  });
});

describe('createGroupWithColors', () => {
  beforeEach(() => {
    db.groupInserts = [];
    db.rpcCalls = [];
    db.productBatches = [];
    db.groupInsertResult = {
      data: { id: 'g-new', name: 'NAPA ROOTS', dimensions_width: 1370, dimensions_length: 0, dimensions_thickness: 0, dimensions_unit: 'mm' },
      error: null,
    };
    db.rpcResult = { data: true, error: null };
    db.batchResult = { success: true, results: [] };
  });

  it('cria o grupo como Linha com variantes e um SKU por cor, saldo 0', async () => {
    const group = await createGroupWithColors(baseInput);

    expect(group.id).toBe('g-new');
    expect(db.groupInserts[0]).toMatchObject({
      name: 'NAPA ROOTS',
      sector: 'Cabedal',
      shared_specs: true,
      consumption_unit: 'm',
      is_family: false,
      is_color_agnostic: false,
      dimensions_width: 1370,
    });
    const rows = db.productBatches[0];
    expect(rows.map((row: any) => row.name)).toEqual(['NAPA ROOTS - PRETO', 'NAPA ROOTS - OFF WHITE']);
    expect(rows.map((row: any) => row.sku)).toEqual(['NAPAROOTS-PRETO-2', 'NAPAROOTS-OFFWHITE']);
    expect(rows[0]).toMatchObject({
      group_id: 'g-new',
      unit: 'm',
      purchase_unit: 'm',
      conversion_rate: 1,
      calculation_method: 'meter',
      unit_price: 38.5,
      quantity: 0,
      dimensions_width: 1370,
      category: 'Cabedal',
    });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('lote falhou → desfaz o grupo recém-criado e explica', async () => {
    db.batchResult = { success: false, errors: [{ error: 'SKU_ALREADY_EXISTS' }] };

    await expect(createGroupWithColors(baseInput)).rejects.toThrow(/Nada foi gravado/);
    expect(db.rpcCalls).toEqual([{ fn: 'delete_empty_material_group', args: { p_group_id: 'g-new' } }]);
  });

  it('desfazer recusado (grupo já recebeu item) → avisa que o grupo ficou', async () => {
    db.batchResult = { success: false, errors: [{ error: 'X' }] };
    db.rpcResult = { data: false, error: null };

    await expect(createGroupWithColors(baseInput)).rejects.toThrow(/não foi removido/);
  });

  it('sem cor ou sem unidade → não toca no banco', async () => {
    await expect(createGroupWithColors({ ...baseInput, colors: [' ', ''] })).rejects.toThrow(/ao menos uma cor/);
    await expect(createGroupWithColors({ ...baseInput, unit: '' })).rejects.toThrow(/unidade/);
    expect(db.groupInserts).toHaveLength(0);
  });

  it('nome duplicado (23505) → mensagem clara, sem compensação', async () => {
    db.groupInsertResult = { data: null, error: { code: '23505', message: 'duplicate' } };
    await expect(createGroupWithColors(baseInput)).rejects.toThrow(/Já existe um grupo/);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.productBatches).toHaveLength(0);
  });
});
