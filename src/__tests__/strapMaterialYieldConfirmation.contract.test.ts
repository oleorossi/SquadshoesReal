import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read('supabase/migrations/20270101008800_confirmar-rendimento-tira-por-material.sql');
const hooks = read('src/hooks/useArtisanalStraps.ts');
const editor = read('src/components/artisanal-straps/ArtisanalStrapConversionEditor.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');
const stockEditor = read('src/components/artisanal-straps/ArtisanalStrapEditor.tsx');

describe('cadastro de rendimento de tira por material', () => {
  it('usa a largura física do estoque e aprova a confirmação em uma transação', () => {
    expect(migration).toContain('public.resolve_base_group_usable_width_mm(v_base_group_id)');
    expect(migration).toContain('public.ensure_base_material_width_profile(');
    expect(migration).toContain('public.save_artisanal_strap_conversion(v_payload, v_reason)');
    expect(migration).toContain('public.submit_artisanal_strap_recipe(v_recipe_id, v_reason)');
    expect(migration).toContain('public.approve_artisanal_strap_recipe(v_recipe_id, v_reason, now())');
    expect(migration).toContain("'color_scope', 'all'");
  });

  it('não aceita nem cria cor, produto ou variante de estoque', () => {
    expect(migration).toContain('Rendimento de tira nao aceita cor, produto ou variante de estoque');
    expect(migration).not.toContain('INSERT INTO public.products');
    expect(migration).not.toContain('public.save_artisanal_strap_variant(');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.confirm_artisanal_strap_material_conversion\(jsonb, text\)\s+FROM PUBLIC, anon/);
  });

  it('liga o formulário simples ao writer e restringe materiais à ficha do estoque', () => {
    expect(hooks).toContain("'confirm_artisanal_strap_material_conversion'");
    expect(editor).toContain('useStrapBaseGroupCandidates');
    expect(editor).toContain('Tipo de tira *');
    expect(editor).toContain('Material possível *');
    expect(editor).toContain('Medidas físicas do estoque');
    expect(editor).toContain('Confirmar rendimento e salvar');
  });

  it('mantém cor e variante fora da página de cadastro', () => {
    const catalogTab = hub.slice(hub.indexOf('function CatalogTab'), hub.indexOf('function RecipesTab'));
    expect(catalogTab).toContain('Tipos de tira e materiais possíveis');
    expect(catalogTab).not.toContain('Cores e nomes alternativos');
    expect(catalogTab).not.toContain('Produtos-base oficiais por cor');
  });

  it('expõe no estoque as modalidades produção interna e comprada pronta', () => {
    expect(stockEditor).toContain('Como esta tira entra no estoque? *');
    expect(stockEditor).toContain('Produção interna (artesanal)');
    expect(stockEditor).toContain('Comprada pronta');
    expect(stockEditor).toContain("value === 'internal' ? 'reference_base' : 'finished_product_group'");
    expect(stockEditor).toContain('internal_production_enabled: form.internalProductionEnabled');
    expect(stockEditor).toContain('identity_basis: form.identityBasis');
    expect(hub).toContain('Produção interna (artesanal) debita o material-base');
    expect(hub).toContain('como STRASS');
  });
});
