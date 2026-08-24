/**
 * Contrato: default hierárquico de prestador + kit de material na OS.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101009400_os_default_hierarquico_e_kit_material.sql'),
  'utf8',
);

describe('OS default hierárquico + kit de material', () => {
  it('define resolve_os_default_contractor com a hierarquia item → ficha → service_type', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_os_default_contractor/);
    expect(SQL).toContain("source := 'item_intent'");
    expect(SQL).toContain("source := 'reference_catalog'");
    expect(SQL).toContain("source := 'service_type'");
    expect(SQL).toContain('outsourced_sectors');
    expect(SQL).toContain('reference_terceirizacoes');
    expect(SQL).toMatch(/service_type ILIKE/);
  });

  it('monta kit de material pela ficha sem debitar estoque', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.build_os_material_kit/);
    expect(SQL).toContain('sheet_materials');
    expect(SQL).toContain('consumption_sector');
    expect(SQL).toContain('Não debita estoque');
    expect(SQL).toContain("origem', 'kit da ficha");
  });

  it('get_pv_outsourceable_lines usa resolve_os_default_contractor', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.get_pv_outsourceable_lines/);
    expect(SQL).toContain('resolve_os_default_contractor(m.id, m.sector)');
  });

  it('create_op_service_order grava materials_sent do kit', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.create_op_service_order/);
    expect(SQL).toContain('build_os_material_kit');
    expect(SQL).toContain('materials_sent');
    expect(SQL).toContain('material_name');
    expect(SQL).toContain('material_meters');
  });
});
