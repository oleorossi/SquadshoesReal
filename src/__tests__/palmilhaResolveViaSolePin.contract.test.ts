import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101028900_palmilha_resolve_via_sole_pin_sem_material.sql',
  ),
  'utf8',
);
const orderSrc = readFileSync(resolve(ROOT, 'src/lib/orderConsumption.ts'), 'utf8');
const bomSrc = readFileSync(resolve(ROOT, 'src/lib/bomConsumption.ts'), 'utf8');

describe('SQL — palmilha resolve via pin do solado com material vazio', () => {
  it('abre o gate de by_grade e check_stock para sole_group/primary_sole', () => {
    expect(migration).toContain('calculate_order_consumption_by_grade');
    expect(migration).toContain('check_stock_availability');
    expect(migration).toContain('OR v_sheet.sole_group_id IS NOT NULL');
    expect(migration).toContain('OR v_sheet.primary_sole_id IS NOT NULL');
    expect(migration).toContain('COALESCE(btrim(v_sheet.insole_material)');
  });

  it('smoke exige EVA 3MM em metro para G01 (não unresolved)', () => {
    expect(migration).toContain('4d188ffd-9a85-4a21-80a5-591ba83171ad');
    expect(migration).toContain("'G01'");
    expect(migration).toContain("source', '') = 'unresolved'");
    expect(migration).toContain("'m', 'metro'");
    expect(migration).toContain("(v_palm->>'required')::numeric");
  });
});

describe('TS — carrega SKU do pin placa_palmilha no escopo', () => {
  it('orderConsumption busca produtos/cs faltantes do fiber pin', () => {
    expect(orderSrc).toContain('missingFiberIds');
    expect(orderSrc).toContain('soleFiberPinBySole.values()');
    expect(orderSrc).toContain("fetchActiveProductsByGroupIds(client, [], missingFiberIds)");
  });

  it('bomConsumption espelha o carregamento do pin', () => {
    expect(bomSrc).toContain('missingFiberIds');
    expect(bomSrc).toContain('fichas de componentes da fibra pinada');
    expect(bomSrc).toContain('fetchScopedProductsOrThrow(supabase, [], missingFiberIds)');
  });
});
