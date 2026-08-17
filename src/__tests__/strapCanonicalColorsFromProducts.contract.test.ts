import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101004700_sync_canonical_colors_from_products.sql',
), 'utf8');
const EDITOR = readFileSync(resolve(
  ROOT,
  'src/components/artisanal-straps/ArtisanalStrapEditor.tsx',
), 'utf8');

describe('cores canônicas derivadas do cadastro de materiais', () => {
  it('sincroniza novas cores de produtos e cobre o estoque já cadastrado', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.sync_canonical_color_from_product()');
    expect(MIGRATION).toContain('AFTER INSERT OR UPDATE OF color, active, group_id, unit');
    expect(MIGRATION).toContain('INSERT INTO public.canonical_colors (name, active)');
    expect(MIGRATION).toContain('SELECT DISTINCT ON (public.normalize_strap_catalog_text(p.color))');
    expect(MIGRATION).toContain("p.unit = 'm'");
    expect(MIGRATION).toContain('ON CONFLICT (name_norm) DO UPDATE');
  });

  it('não promove automaticamente um produto para fonte oficial', () => {
    expect(MIGRATION).not.toContain('INSERT INTO public.base_material_color_official_products');
    expect(MIGRATION).not.toContain('designate_base_material_color_official_product');
  });

  it('faz o editor usar as cores registradas na napa-base', () => {
    expect(EDITOR).toContain('registeredBaseMaterialColorsForGroup');
    expect(EDITOR).toContain('Cadastrada na base');
    expect(EDITOR).not.toContain('Nenhuma cor tem napa oficial ativa nesta base');
  });
});
