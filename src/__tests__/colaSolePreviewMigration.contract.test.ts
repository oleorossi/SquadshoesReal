import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_VERSION = '20270101013650';
const MIGRATION_NAME = `${MIGRATION_VERSION}_corrigir_previa_consumo_colas_solado.sql`;
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations', MIGRATION_NAME),
  'utf8',
);

describe('migration da prévia de colas do solado — contrato SQL', () => {
  it('ocupa uma versão única entre o ledger remoto 13600 e a migration local 13700', () => {
    const sameVersion = readdirSync(resolve(ROOT, 'supabase/migrations'))
      .filter((name) => name.startsWith(`${MIGRATION_VERSION}_`));

    expect(sameVersion).toEqual([MIGRATION_NAME]);
  });

  it('inclui Item padrão (solado) no agregado canônico e trava a duplicidade do BOM', () => {
    expect(SQL).toContain(
      "'Fachete','Item padrão (solado)')",
    );
    expect(SQL).toContain(
      'v_emitted := array_append(v_emitted, v_spec.pid)',
    );
    expect(SQL).toContain('check_stock_inclui_item_padrao_solado');
    expect(SQL).toContain('check_stock_item_padrao_bloqueia_bom_duplicado');
  });

  it('remove somente a cópia sistêmica compartilhada da fonte aposentada', () => {
    expect(SQL).toMatch(
      /DELETE FROM public\.sheet_materials sm[\s\S]*?sm\.material_variant_id IS NULL[\s\S]*?sm\.notes, ''\)\) = 'Item padrão do solado'/,
    );
    expect(SQL).toContain('Item padrao global');
    expect(SQL).not.toMatch(/SET\s+quantity_per_unit\s*=/i);
    expect(SQL).toContain('v_remaining <> 0');
  });

  it('versiona COLA FORTE em 14 g/par por chaves naturais', () => {
    expect(SQL).toMatch(
      /UPDATE public\.sole_group_standard_items sgsi[\s\S]*?consumption_per_pair = 14,[\s\S]*?unit = 'g'/,
    );
    expect(SQL).toContain("material.sku = '0000568.00000.00000'");
    expect(SQL).toContain("sole_group.name = 'SOLADO 01'");
    expect(SQL).toContain('cola_forte_14g_versionada');
  });

  it('trava numericamente g→kg no caso vivo NL02-NL01', () => {
    expect(SQL).toContain('v_pvc_required IS DISTINCT FROM 40.31424');
    expect(SQL).toContain('v_forte_required IS DISTINCT FROM 24.192');
    expect(SQL).toContain('v_hotmelt_required IS DISTINCT FROM 17.28');
  });

  it('preserva SECURITY DEFINER/search_path e não concede a RPC ao anon', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION[\s\S]*?check_stock_availability\(uuid,integer,text,jsonb,jsonb,text,uuid\)[\s\S]*?FROM PUBLIC, anon;/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*?check_stock_availability\(uuid,integer,text,jsonb,jsonb,text,uuid\)[\s\S]*?TO authenticated, service_role;/,
    );
    const grants = SQL.match(/^GRANT\s+[\s\S]*?;/gim) || [];
    expect(grants.some((statement) => /\banon\b/i.test(statement))).toBe(false);
    expect(SQL).toContain("v_definition NOT ILIKE '%STABLE%SECURITY DEFINER%'");
    expect(SQL).toContain("SET search_path TO ''public'', ''extensions''");
  });
});
