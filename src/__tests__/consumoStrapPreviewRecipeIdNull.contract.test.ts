import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101029700_consumo_strap_preview_recipe_id_null_not_omit.sql',
  ),
  'utf8',
);

/**
 * Overlay stale não pode omitir recipe_id — Zod do consumo canônico exige a chave.
 * Caso vivo: /imprimir-fichas → "strap_previews.N.recipe_id: Required".
 */
describe('consumo strap_preview: recipe_id null sem omitir chave', () => {
  it('marca 297 e seta recipe_id=null em vez de -', () => {
    expect(MIGRATION).toContain('consumo_strap_preview_recipe_id_null_not_omit_297');
    expect(MIGRATION).toMatch(
      /jsonb_build_object\(\s*'recipe_id'\s*,\s*NULL\s*\)/i,
    );
    expect(MIGRATION).not.toMatch(/v_preview\s*:=\s*v_preview\s*-\s*'recipe_id'/);
  });

  it('guarda rejeita corpo que ainda omite a chave', () => {
    expect(MIGRATION).toContain('ainda omite recipe_id');
    expect(MIGRATION).toContain("jsonb_build_object('recipe_id', NULL)");
  });
});
