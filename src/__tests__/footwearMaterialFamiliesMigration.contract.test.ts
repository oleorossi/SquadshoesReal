import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101006100_explicit-footwear-material-families.sql'),
  'utf8',
);

describe('famílias e variantes de materiais calçadistas — contrato SQL', () => {
  it('mantém família explícita mesmo vazia e bloqueia itens diretos', () => {
    expect(SQL).toMatch(/add column if not exists is_family boolean not null default false/i);
    expect(SQL).toMatch(/fn_guard_product_group_is_leaf/);
    expect(SQL).toMatch(/coalesce\(g\.is_family, false\)/);
    expect(SQL).toMatch(/fn_guard_group_parent/);
  });

  it('serializa produto e vínculo de filho pelo lock exclusivo do grupo, sem inversão com a FK', () => {
    expect(SQL).toMatch(/fn_guard_product_group_is_leaf[\s\S]*for update;/);
    expect(SQL).toMatch(/fn_guard_group_parent[\s\S]*for update;/);
    expect(SQL).toMatch(/before insert or update of group_id, unit on public\.products/);
    expect(SQL).not.toMatch(/group-membership:/);
  });

  it('sincroniza dimensões somente para os produtos que ainda pertencem ao grupo', () => {
    expect(SQL).toMatch(/insert into public\.component_sheets[\s\S]*from public\.products p[\s\S]*where p\.group_id = p_group_id/);
    expect(SQL).toMatch(/where p\.id = cs\.product_id[\s\S]*and p\.group_id = p_group_id/);
    expect(SQL).not.toMatch(/greatest\s*\(/i);
  });

  it('cria ficha técnica também para a primeira variante do grupo', () => {
    expect(SQL).toMatch(/tg_inherit_component_sheet_on_product/);
    expect(SQL).toMatch(/if coalesce\(v_group\.dimensions_width, 0\) > 0/);
    expect(SQL).toMatch(/on conflict \(product_id\) do nothing/);
  });

  it('realinha a ficha quando o SKU muda de grupo', () => {
    expect(SQL).toMatch(/tg_sync_component_sheet_on_product_group_change/);
    expect(SQL).toMatch(/after update of group_id on public\.products/);
    expect(SQL).toMatch(/if v_width > 0 then[\s\S]*set group_id = new\.group_id,[\s\S]*dimensions_width = v_width/);
    expect(SQL).toMatch(/else[\s\S]*set group_id = new\.group_id[\s\S]*where product_id = new\.id/);
  });

  it('compensa grupo vazio sob row lock, sem janela de check-then-delete', () => {
    expect(SQL).toMatch(/delete_empty_material_group/);
    expect(SQL).toMatch(/where id = p_group_id[\s\S]*for update/);
    expect(SQL).toMatch(/exists \(select 1 from public\.products where group_id = p_group_id\)/);
  });

  it('rejeita dimensões negativas ou não finitas', () => {
    expect(SQL).toMatch(/p_length::text in \('NaN', 'Infinity', '-Infinity'\)/);
    expect(SQL).toMatch(/p_thickness < 0/);
  });

  it('trava cor duplicada só em linha técnica e fecha a corrida ao ativar o modelo', () => {
    expect(SQL).toMatch(/g\.shared_specs/);
    expect(SQL).toMatch(/g\.is_bom_color_source/);
    expect(SQL).toMatch(/fn_guard_group_color_variant_model/);
    expect(SQL).toMatch(/fn_guard_unique_active_group_color[\s\S]*for share;[\s\S]*group-color:/);
    expect(SQL.match(/group-color:/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('preserva o hardening de search_path nas funções substituídas', () => {
    expect(SQL.match(/set search_path = public, pg_temp/g)?.length).toBeGreaterThanOrEqual(8);
  });
});
