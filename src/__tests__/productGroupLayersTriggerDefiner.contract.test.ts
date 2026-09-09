import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20270101014400_product_group_layers_trigger_definer.sql',
  'utf8',
);
const original = readFileSync(
  'supabase/migrations/20270101005400_cabedal_dublagem_groups_and_composition.sql',
  'utf8',
);
const dialog = readFileSync('src/components/groups/GroupEditDialog.tsx', 'utf8');

describe('salvar grupo não depende de GRANT de escrita em product_group_layers', () => {
  it('a 05400 criou a tabela só com SELECT para authenticated', () => {
    expect(original).toContain('REVOKE ALL ON TABLE public.product_group_layers FROM authenticated');
    expect(original).toContain('GRANT SELECT ON TABLE public.product_group_layers TO authenticated');
    expect(original).toContain('GRANT EXECUTE ON FUNCTION public.save_product_group_layers(uuid, jsonb) TO authenticated');
    expect(original).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON TABLE public\.product_group_layers TO authenticated/);
  });

  it('a 14300 promove os triggers que tocam camadas a SECURITY DEFINER', () => {
    expect(migration).toContain('fn_sync_upper_material_name_on_group_rename');
    expect(migration).toContain('fn_guard_referenced_group_stays_leaf');
    expect(migration).toContain('fn_validate_product_group_layer');
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_sync_upper_material_name_on_group_rename\(\)[\s\S]*SECURITY DEFINER/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_guard_referenced_group_stays_leaf\(\)[\s\S]*SECURITY DEFINER/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_validate_product_group_layer\(\)[\s\S]*SECURITY DEFINER/,
    );
    expect(migration).toContain('WHEN (NEW.name IS DISTINCT FROM OLD.name)');
    expect(migration).toContain('GRANT SELECT ON TABLE public.product_group_layers TO authenticated');
    expect(migration).toContain('REVOKE ALL ON TABLE public.product_group_layers FROM authenticated');
    // Trigger continua executável pelo dono da tabela — não revogar EXECUTE.
    expect(migration).not.toMatch(/REVOKE ALL ON FUNCTION public\.fn_sync_upper_material_name_on_group_rename/);
    expect(migration).not.toMatch(/REVOKE ALL ON FUNCTION public\.fn_guard_referenced_group_stays_leaf/);
    expect(migration).not.toMatch(/REVOKE ALL ON FUNCTION public\.fn_validate_product_group_layer/);
  });

  it('o diálogo de grupo continua gravando só product_groups — camadas ficam na RPC', () => {
    const save = dialog.split('const handleSave = async () => {')[1]?.split('const handleSaveProductName')[0] || '';
    expect(save).toContain('updateGroup.mutateAsync');
    expect(save).toContain('Erro ao salvar:');
    expect(save).not.toContain('product_group_layers');
    expect(save).not.toContain('save_product_group_layers');
  });
});
