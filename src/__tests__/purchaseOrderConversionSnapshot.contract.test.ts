import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const MIGRATION = read(
  'supabase/migrations/20270101015700_congelar_conversao_e_estado_oc.sql',
);
const LEGACY_SETUP = read(
  'supabase/tests/setup_purchase_order_conversion_boundary_legacy.sql',
);
const E2E = read(
  'supabase/tests/purchase_order_conversion_boundary_e2e.sql',
);

// Trava de estrutura para CI. A prova comportamental continua sendo o E2E SQL
// setup -> migration -> validation dentro de uma unica transacao com ROLLBACK.
describe('snapshot de conversao e fronteira financeira da OC — contrato 15700', () => {
  it('versiona a tupla integral e rejeita fator nao finito', () => {
    expect(MIGRATION).toContain(
      'ADD COLUMN IF NOT EXISTS generic_conversion_snapshot_version smallint',
    );
    expect(MIGRATION).toContain(
      'purchase_order_items_conversion_snapshot_tuple_157_ck',
    );
    expect(MIGRATION).toMatch(
      /generic_conversion_snapshot_version = 1[\s\S]*?product_id IS NOT NULL[\s\S]*?num_nonnulls\([\s\S]*?\) = 3/,
    );
    expect(MIGRATION).toContain(
      "conversion_rate_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')",
    );
    expect(MIGRATION).toContain('VALIDATE CONSTRAINT purchase_order_items_conversion_snapshot_tuple_157_ck');
  });

  it('congela novas linhas no servidor e nao interfere na OC de tira', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION private.tg_generic_po_item_conversion_snapshot_157()',
    );
    expect(MIGRATION).toMatch(
      /IF v_source_type = 'strap_demand' THEN\s+RETURN NEW;/,
    );
    expect(MIGRATION).toMatch(
      /NEW\.stock_unit_snapshot := v_stock_unit;[\s\S]*?NEW\.purchase_unit_snapshot := v_purchase_unit;[\s\S]*?NEW\.conversion_rate_snapshot := v_effective_factor;[\s\S]*?NEW\.generic_conversion_snapshot_version := 1;/,
    );
    expect(MIGRATION).toContain(
      'BEFORE INSERT ON public.purchase_order_items',
    );
    expect(MIGRATION).not.toMatch(
      /generic_conversion_snapshot_version\s+smallint\s+DEFAULT/i,
    );
  });

  it('mantem legado sem backfill e impede misturar quantidade ou unidade nova', () => {
    expect(MIGRATION).toContain(
      'Snapshot de linha legada nao pode ser preenchido implicitamente',
    );
    expect(MIGRATION).toContain(
      'Item legado sem conversao congelada: crie nova OC para alterar a quantidade',
    );
    expect(MIGRATION).toContain(
      'Item legado sem conversao congelada: crie nova OC para alterar a unidade',
    );
    expect(MIGRATION).not.toMatch(
      /UPDATE\s+public\.purchase_order_items[\s\S]{0,300}generic_conversion_snapshot_version\s*=\s*1/i,
    );
  });

  it('recebe por snapshot, declara fallback integral e fecha estados por allow-list', () => {
    expect(MIGRATION).toContain("v_conversion_snapshot_source := 'item_snapshot'");
    expect(MIGRATION).toContain("v_conversion_snapshot_source := 'legacy_live_product'");
    expect(MIGRATION).toMatch(
      /generic_conversion_snapshot_version IS NULL[\s\S]*?num_nonnulls\([\s\S]*?\) = 0/,
    );
    expect(MIGRATION).toContain(
      "v_po.status NOT IN ('approved', 'sent', 'parcial')",
    );
    expect(MIGRATION).toContain("'conversion_source', v_conversion_snapshot_source");
    expect(MIGRATION).toContain("'conversion_factor', v_factor");
    expect(MIGRATION).toContain("'stock_unit', v_receipt_stock_unit");
  });

  it('alinha o guard do cabecalho ao snapshot sem liberar artesanal ou box', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.tg_block_invalid_purchase_order_receipt()',
    );
    expect(MIGRATION).toMatch(
      /JOIN public\.products product ON product\.id = item\.product_id[\s\S]*?product\.is_artisanal IS TRUE/,
    );
    expect(MIGRATION).toMatch(
      /item\.generic_conversion_snapshot_version = 1[\s\S]*?product\.unit[\s\S]*?item\.stock_unit_snapshot[\s\S]*?item\.purchase_unit_snapshot/,
    );
    expect(MIGRATION).toMatch(
      /item\.generic_conversion_snapshot_version IS DISTINCT FROM 1[\s\S]*?product\.purchase_unit[\s\S]*?product\.purchase_order_unit/,
    );
    expect(MIGRATION).toContain("procedure.proconfig @> ARRAY['search_path=\"\"']::text[]");
  });

  it('congela credor e valor somente quando mudam e preserva deduplicacao', () => {
    expect(MIGRATION).toContain(
      'OC com conta a pagar nao permite alterar fornecedor, quantidade ou preco',
    );
    expect(MIGRATION).toContain(
      "(v_command = 'append' AND NOT v_skip_append)",
    );
    expect(MIGRATION).toMatch(
      /changed_item\.value \? 'quantity'[\s\S]*?IS DISTINCT FROM current_item\.quantity/,
    );
    expect(MIGRATION).toMatch(
      /changed_item\.value \? 'unit_price'[\s\S]*?IS DISTINCT FROM current_item\.unit_price/,
    );
    expect(MIGRATION).toContain(
      "payable.reference_type = 'purchase_order'",
    );
  });

  it('mantem setup e E2E transacionais sem desligar protecoes', () => {
    expect(LEGACY_SETUP).toContain('CREATE TEMP TABLE e2e_po157_legacy_fixture');
    expect(LEGACY_SETUP).toContain("('all_null'");
    expect(LEGACY_SETUP).toContain("('partial'");
    expect(LEGACY_SETUP).toContain(
      'Setup legado 15700 deve rodar antes da migration de snapshot',
    );
    expect(LEGACY_SETUP).toMatch(
      /SET CONSTRAINTS public\.trg_assert_strap_purchase_order_item_origin IMMEDIATE;[\s\S]*?SET CONSTRAINTS public\.trg_assert_strap_purchase_order_item_origin DEFERRED;/,
    );
    expect(E2E).toContain("'pg_temp.e2e_po157_legacy_fixture'");
    expect(E2E).toContain('SET LOCAL plpgsql.check_asserts = on');
    const validationPosition = E2E.lastIndexOf('SET CONSTRAINTS ALL IMMEDIATE;');
    expect(validationPosition).toBeGreaterThan(E2E.lastIndexOf('$test_purchase_order_conversion_boundary$;'));
    expect(validationPosition).toBeLessThan(E2E.lastIndexOf('ROLLBACK;'));
    expect(E2E.trimStart()).toContain('BEGIN;');
    expect(E2E.trimEnd()).toMatch(/ROLLBACK;$/);

    const fixtureSql = `${LEGACY_SETUP}\n${E2E}`;
    expect(fixtureSql).not.toMatch(/session_replication_role/i);
    expect(fixtureSql).not.toMatch(/(?:DISABLE|ENABLE)\s+TRIGGER/i);
  });
});
