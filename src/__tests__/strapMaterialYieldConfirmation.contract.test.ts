import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read('supabase/migrations/20270101008800_confirmar-rendimento-tira-por-material.sql');
const batchMigration = read('supabase/migrations/20270101014550_cadastrar_multiplos_materiais_tira.sql');
const pluralWriter = batchMigration.slice(
  batchMigration.indexOf('CREATE OR REPLACE FUNCTION public.save_artisanal_strap_material_conversions'),
  batchMigration.indexOf(
    'REVOKE ALL ON FUNCTION public.save_artisanal_strap_material_conversions',
  ),
);
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

describe('cadastro de rendimento de tira para vários materiais', () => {
  it('expõe um writer plural que recebe o array de materiais de uma única medida', () => {
    expect(batchMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_material_conversions',
    );
    expect(batchMigration).toContain("v_materials := p_payload -> 'materials'");
    expect(batchMigration).toContain(
      "jsonb_typeof(v_materials) IS DISTINCT FROM 'array'",
    );
    expect(batchMigration).toContain('jsonb_array_elements');
    expect(hooks).toContain("'save_artisanal_strap_material_conversions'");
    expect(editor).toContain('Adicionar outro material');
  });

  it('rejeita bases repetidas e preserva a ordem informada no resultado', () => {
    expect(batchMigration).toContain('v_base_group_id = ANY (v_seen_base_group_ids)');
    expect(batchMigration).toContain('Material-base repetido no lote');
    expect(batchMigration).toContain('WITH ORDINALITY');
    expect(batchMigration).toContain(
      "ORDER BY (entry.value ->> 'base_group_id')::uuid, entry.ordinality",
    );
    expect(batchMigration).toMatch(/jsonb_agg\([\s\S]*ORDER BY result_order\.ordinality/);
  });

  it('não permite reutilizar recipe.id e evita a inversão conversion → width', () => {
    expect(batchMigration).toContain("(v_validation.material -> 'recipe') ? 'id'");
    expect(batchMigration).toContain('Cadastro em lote nao aceita recipe.id');
    expect(pluralWriter).toContain('strap-material-confirm:');
    expect(pluralWriter).toContain("'strap-width:' || v_base_group_id::text");
    expect(pluralWriter).toMatch(
      /base_material_width_profiles profile[\s\S]*FOR UPDATE;[\s\S]*FOR v_row IN/,
    );
    expect(pluralWriter).not.toMatch(
      /pg_advisory_xact_lock\(hashtextextended\(\s*'strap-conversion:/,
    );
    expect(batchMigration).toContain("'new_material_only', true");
  });

  it('impõe material novo sob o lock canônico e valida identidades ativas/elegíveis', () => {
    expect(batchMigration).toContain('public.strap_base_group_is_eligible(v_base_group_id)');
    expect(batchMigration).toContain("'strap-type-identity:' || v_type_name_norm");
    expect(batchMigration).toContain(
      'v_measure_width_identity := pg_catalog.trim_scale(v_measure_width_mm)::text',
    );
    expect(batchMigration).toContain(
      "'strap-measure-identity:' || v_type_id::text || ':' || v_measure_width_identity",
    );
    expect(batchMigration).toContain("'strap-recipe:' || v_measure_id::text");
    expect(batchMigration).toContain("recipe.status NOT IN ('superseded', 'archived')");
    expect(batchMigration).toMatch(
      /IF v_require_new_material AND NOT v_type\.active THEN\s+RAISE EXCEPTION 'Familia da conversao deve estar ativa'/,
    );
    expect(batchMigration).toMatch(
      /IF v_require_new_material AND NOT v_measure\.active THEN\s+RAISE EXCEPTION 'Medida da conversao deve estar ativa'/,
    );
    expect(batchMigration).toContain(
      'Material-base ja possui receita vigente ou em elaboracao',
    );
  });

  it('reutiliza a identidade criada no primeiro material e separa confirmação de rascunho', () => {
    expect(batchMigration).toMatch(/v_type_id\s*:=\s*nullif\([^;]*type_id[^;]*\)::uuid/i);
    expect(batchMigration).toMatch(/v_measure_id\s*:=\s*nullif\([^;]*measure_id[^;]*\)::uuid/i);
    expect(batchMigration).toMatch(/jsonb_build_object\(\s*'id'\s*,\s*v_type_id\s*\)/i);
    expect(batchMigration).toMatch(/jsonb_build_object\(\s*'id'\s*,\s*v_measure_id\s*\)/i);
    expect(batchMigration).toContain('IF coalesce(p_confirm, false) THEN');
    expect(batchMigration).toContain('public.confirm_artisanal_strap_material_conversion(');
    expect(batchMigration).toContain('public.save_artisanal_strap_conversion(');
  });

  it('não amplia o lote para cor, produto ou variante e mantém os grants mínimos', () => {
    expect(batchMigration).not.toContain('INSERT INTO public.products');
    expect(batchMigration).not.toContain('public.save_artisanal_strap_variant(');
    expect(batchMigration).toMatch(/nao aceita cor, produto ou variante/i);
    expect(batchMigration).toContain("'$.**.canonical_color_id'");
    expect(batchMigration).toContain("'$.**.material_variant_id'");
    expect(batchMigration).toContain("'$.**.official_product_id'");
    expect(batchMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.save_artisanal_strap_material_conversions\(jsonb, text, boolean\)\s+FROM PUBLIC, anon/,
    );
    expect(batchMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.save_artisanal_strap_material_conversions\(jsonb, text, boolean\)\s+TO authenticated, service_role/,
    );
  });

  it('inclui autoteste transacional sem resíduos e restrito ao service_role', () => {
    expect(batchMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.run_artisanal_strap_material_conversions_self_test()',
    );
    expect(batchMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.run_artisanal_strap_material_conversions_self_test\(\)[\s\S]*?SECURITY INVOKER/,
    );
    expect(batchMigration).toContain("ERRCODE = 'ZX001'");
    expect(batchMigration).toContain('artisanal_strap_recipes_yield_ck');
    expect(batchMigration).toContain('fixtures do lote positivo nao foram desfeitas');
    expect(batchMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.run_artisanal_strap_material_conversions_self_test\(\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(batchMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.run_artisanal_strap_material_conversions_self_test\(\)\s+TO service_role/,
    );
    expect(batchMigration).toContain(
      'v_self_test := public.run_artisanal_strap_material_conversions_self_test()',
    );
    expect(batchMigration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
