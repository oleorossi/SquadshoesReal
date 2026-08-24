import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const retireLegacyWriters = read(
  'supabase/migrations/20270101009400_retire_legacy_stock_debit_overloads.sql',
);
const lockFinancialCosts = read(
  'supabase/migrations/20270101009500_lock_financial_cost_writes.sql',
);
const canonicalSizeLookup = read(
  'supabase/migrations/20270101009600_canonical_size_consumption_lookup.sql',
);
const requireNewSheetRouting = read(
  'supabase/migrations/20270101009700_require_routing_on_new_technical_sheets.sql',
);
const technicalSheetsPage = read('src/pages/TechnicalSheets.tsx');

describe('Migrations pós-cutover — pacote seguro de 24/08/2026', () => {
  it('remove apenas os três writers legados depois de validar os substitutos', () => {
    expect(retireLegacyWriters).toContain(
      'debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)',
    );
    expect(retireLegacyWriters).toContain(
      'debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)',
    );
    expect(retireLegacyWriters).toContain(
      'debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)',
    );
    expect(retireLegacyWriters).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.debit_sole_stock_by_grade\(uuid,uuid,text,jsonb\)/,
    );
    expect(retireLegacyWriters).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.debit_strap_stock\(jsonb,integer,uuid,jsonb\)/,
    );
    expect(retireLegacyWriters).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.debit_packaging_for_order\(uuid,uuid,uuid,integer,text\)/,
    );
    expect(retireLegacyWriters).toContain(
      'p_force_soft precisa terminar em DEFAULT false',
    );
    expect(retireLegacyWriters).not.toMatch(/DROP FUNCTION[^;]+CASCADE/i);
  });

  it('retira privilégios estruturais e limita escrita financeira a admin/gerente', () => {
    expect(lockFinancialCosts).toContain('REVOKE ALL PRIVILEGES ON TABLE');
    expect(lockFinancialCosts).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE',
    );
    expect(lockFinancialCosts).toContain('financial_cost_read_approved');
    expect(lockFinancialCosts).toContain('financial_cost_insert_admin_manager');
    expect(lockFinancialCosts).toContain('financial_cost_update_admin_manager');
    expect(lockFinancialCosts).toContain('financial_cost_delete_admin_manager');
    expect(lockFinancialCosts).not.toMatch(
      /\n\s*FOR ALL\s*\n\s*TO authenticated/,
    );
    expect(lockFinancialCosts).toContain("ARRAY['admin'::text, 'gerente'::text]");
    expect(lockFinancialCosts).toContain('[rbac:create_production_sector:v1]');
    expect(lockFinancialCosts).toContain("USING ERRCODE = ''42501''");
    expect(lockFinancialCosts).not.toMatch(
      /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\./i,
    );
  });

  it('centraliza matching individual/conjugado e elimina overloads de consumo', () => {
    expect(canonicalSizeLookup).toContain(
      'CREATE OR REPLACE FUNCTION public.pick_consumption_for_size',
    );
    expect(canonicalSizeLookup).toContain(
      'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)',
    );
    expect(canonicalSizeLookup).toContain(
      'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)',
    );
    expect(canonicalSizeLookup).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.calculate_order_consumption_by_grade\(uuid,jsonb,text\)/,
    );
    expect(canonicalSizeLookup).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.calculate_order_consumption\(uuid,numeric,text,integer\)/,
    );
    expect(canonicalSizeLookup).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.check_stock_availability\(uuid,integer,text,jsonb\)/,
    );
    expect(canonicalSizeLookup).toContain('esperadas 10 chamadas ao helper');
    expect(canonicalSizeLookup).toContain('esperado 32, obtido %');
    expect(canonicalSizeLookup).toContain('esperado 0.32, obtido %');
    expect(canonicalSizeLookup).toContain(
      "coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0",
    );
    expect(canonicalSizeLookup).toContain(
      'Self-test preview: fallback escalar/matching por numeração incompleto',
    );
    expect(canonicalSizeLookup).toContain(
      'grade integralmente zero retornou %',
    );
    expect(canonicalSizeLookup).toContain(
      'Self-test wrapper escalar: delegação ao motor por grade ausente',
    );
    expect(canonicalSizeLookup).not.toMatch(/DROP FUNCTION[^;]+CASCADE/i);
  });

  it('protege somente fichas novas e não ativa a baixa por setor', () => {
    expect(requireNewSheetRouting).toContain("NEW.status_ficha := 'rascunho'");
    expect(requireNewSheetRouting).toContain(
      'NEW.consumption_routing_required := true',
    );
    expect(requireNewSheetRouting).toContain(
      'OLD.consumption_routing_required',
    );
    expect(requireNewSheetRouting).toContain(
      'O roteamento obrigatório desta ficha não pode ser desativado.',
    );
    expect(requireNewSheetRouting).toContain(
      "NEW.status_ficha NOT IN ('validada', 'publicada')",
    );
    expect(requireNewSheetRouting).toContain(
      "nullif(btrim(sm.consumption_sector), '') IS NULL",
    );
    expect(requireNewSheetRouting).toContain(
      "NEW.component_consumption_sectors ->> 'fibra'",
    );
    expect(requireNewSheetRouting).toContain(
      "NEW.component_consumption_sectors ->> 'forracao_palmilha'",
    );
    expect(requireNewSheetRouting).toContain(
      "NEW.component_consumption_sectors ->> 'cabedal'",
    );
    expect(requireNewSheetRouting).toContain(
      "NEW.component_consumption_sectors ->> 'solado'",
    );
    expect(requireNewSheetRouting).toContain(
      "jsonb_array_elements(\n        coalesce(NEW.direct_components, '[]'::jsonb)",
    );
    expect(requireNewSheetRouting).toContain(
      'trg_enforce_released_sheet_material_routing',
    );
    expect(
      requireNewSheetRouting.match(/pg_advisory_xact_lock/g),
    ).toHaveLength(2);
    expect(requireNewSheetRouting).not.toMatch(
      /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\./i,
    );
    expect(requireNewSheetRouting).not.toMatch(
      /material_reservations|order_stages|production_sector_material_debits|debit_reserved_materials_for_sector/,
    );
  });

  it('não promete na UI uma baixa por setor que ainda não foi ativada', () => {
    expect(technicalSheetsPage).not.toContain(
      'A baixa é registrada no início do setor selecionado.',
    );
    expect(technicalSheetsPage).not.toMatch(
      /baixa.{0,30}in[ií]cio.{0,30}(?:deste |do )?setor/i,
    );
    expect(technicalSheetsPage).toContain(
      'O roteamento é obrigatório para liberar fichas novas.',
    );
    expect(technicalSheetsPage).toContain(
      'Setor físico responsável pelo consumo deste material.',
    );
  });
});
