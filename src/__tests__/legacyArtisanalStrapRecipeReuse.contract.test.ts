import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101005100_reaproveitar_receitas_tiras_legadas.sql'),
  'utf8',
);

describe('reaproveitamento atômico das receitas anteriores de tiras', () => {
  it('valida todas as permissões antes da primeira escrita', () => {
    const manage = migration.indexOf("assert_artisanal_strap_capability('manage_strap_catalog')");
    const approve = migration.indexOf("assert_artisanal_strap_capability('approve_strap_recipe')");
    const resolveMigration = migration.indexOf("assert_artisanal_strap_capability('resolve_strap_migration')");
    const firstWrite = migration.indexOf('public.save_base_material_width_profile(');

    expect(manage).toBeGreaterThan(0);
    expect(approve).toBeGreaterThan(manage);
    expect(resolveMigration).toBeGreaterThan(approve);
    expect(firstWrite).toBeGreaterThan(resolveMigration);
  });

  it('aprova largura e receita antes de congelar o vínculo legado', () => {
    const saveWidth = migration.indexOf('public.save_base_material_width_profile(');
    const approveWidth = migration.indexOf('public.approve_base_material_width_profile(');
    const saveConversion = migration.indexOf('public.save_artisanal_strap_conversion(');
    const submitRecipe = migration.indexOf('public.submit_artisanal_strap_recipe(');
    const approveRecipe = migration.indexOf('public.approve_artisanal_strap_recipe(');
    const resolveLegacy = migration.indexOf('public.resolve_legacy_artisanal_recipe_migration(');

    expect(saveWidth).toBeLessThan(approveWidth);
    expect(approveWidth).toBeLessThan(saveConversion);
    expect(saveConversion).toBeLessThan(submitRecipe);
    expect(submitRecipe).toBeLessThan(approveRecipe);
    expect(approveRecipe).toBeLessThan(resolveLegacy);
  });

  it('preserva o fato antigo e expõe somente a operação autenticada', () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.artisanal_recipes/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.artisanal_recipes/i);
    expect(migration).toContain('Reaproveitar receita anterior sempre cria uma nova versao canonica');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated, service_role');
  });
});

