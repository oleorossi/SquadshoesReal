import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101001000_integridade-cadastro-setor-solados.sql'),
  'utf8',
);
const HUB = readFileSync(resolve(__dirname, '../pages/SolesHub.tsx'), 'utf8');
const AVAILABILITY = readFileSync(resolve(__dirname, '../lib/soleAvailability.ts'), 'utf8');
const AUTO_PO = readFileSync(resolve(__dirname, '../lib/soleAutoPO.ts'), 'utf8');
const SALE_ORDER_FORM = readFileSync(resolve(__dirname, '../pages/SaleOrderForm.tsx'), 'utf8');

describe('integridade do cadastro do setor de solados', () => {
  it('salva o perfil inteiro de forma atômica e trava as variantes', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.update_sole_profile/);
    expect(SQL).toMatch(/ORDER BY p\.id\s+FOR UPDATE/);
    expect(SQL).toMatch(/supplier_lead_time_days = CASE/);
    expect(SQL).toMatch(/lead_time_days = CASE/);
    expect(SQL).toMatch(/unit = 'par'/);
    expect(SQL).toMatch(/lower\(btrim\(COALESCE\(p\.category, ''\)\)\) LIKE 'solado%'/);
  });

  it('altera somente o range do JSON vivo e não deixa ocultar saldo', () => {
    expect(SQL).toMatch(/v_grade := COALESCE\(v_row\.stock_grade/);
    expect(SQL).toMatch(/jsonb_set\(v_grade, '\{_size_from\}'/);
    expect(SQL).toMatch(/Não é possível retirar a numeração/);
    expect(SQL).not.toMatch(/stock_grade\s*=\s*p_profile/);
  });

  it('mantém preço, cor e SKU por variante e dados técnicos por modelo', () => {
    expect(SQL).toMatch(/WHERE p\.id = v_row\.id/);
    expect(SQL).toMatch(/unit_price = CASE[\s\S]*WHERE p\.id = p_product_id/);
  });

  it('expõe relatório acionável de gaps e divergências entre cores', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sole_sector_integrity_report/);
    expect(SQL).toMatch(/unidade diferente de par/);
    expect(SQL).toMatch(/range divergente entre cores/);
    expect(SQL).toMatch(/material\/composto ausente/);
  });

  it('a consulta do hub recarrega tudo que a tela permite editar', () => {
    for (const field of [
      'unit_price',
      'supplier_id',
      'supplier_lead_time_days',
      'sole_moq',
      'sole_material',
      'heel_height',
      'sole_technical_notes',
      'is_fachetado',
      'fachete_material_group_id',
    ]) {
      expect(HUB).toContain(field);
    }
  });
});

describe('necessidade de compra de solados', () => {
  it('consulta estoque por grade e desconta saldo ainda aberto das OCs', () => {
    expect(AVAILABILITY).toMatch(/stock_grade/);
    expect(AVAILABILITY).toMatch(/purchase_order_items/);
    expect(AVAILABILITY).toMatch(/received_quantity/);
    expect(AVAILABILITY).toMatch(/calculateGradeCoverage/);
    expect(AVAILABILITY).toMatch(/\['pending', 'approved', 'sent', 'parcial'\]/);
  });

  it('respeita o solado pinado na variante do item do PV', () => {
    expect(AVAILABILITY).toMatch(/resolve_sole_for_variant/);
    expect(AVAILABILITY).toMatch(/resolve_insole_material_for_variant/);
    expect(AVAILABILITY).toMatch(/material_variant_id/);
    expect(AUTO_PO).toMatch(/resolve_sole_for_variant/);
  });

  it('não ignora falta de palmilha quando o solado em si tem estoque', () => {
    expect(SALE_ORDER_FORM).toMatch(
      /soleCheck\.shortages\.length > 0 \|\| soleCheck\.insoleShortages\.length > 0/,
    );
  });

  it('a OC automática grava a falta por número, não a demanda total', () => {
    expect(AUTO_PO).toMatch(/poItemGrade: perSizeShortage/);
    expect(AUTO_PO).not.toMatch(/poItemGrade: grade,/);
  });
});
