import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101041700_rendimento-de-tira-em-lote-por-medida.sql',
);
const writer = read('src/lib/confirmArtisanalStrapMeasureYield.ts');
const control = read('src/components/artisanal-straps/MeasureYieldControl.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');
const core = read('supabase/migrations/20270101003000_artisanal_straps_catalog_core.sql');

const body = migration.slice(
  migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.confirm_artisanal_strap_measure_yield_for_all',
  ),
  migration.indexOf(
    'REVOKE ALL ON FUNCTION public.confirm_artisanal_strap_measure_yield_for_all',
  ),
);

describe('rendimento de tira em lote por medida', () => {
  it('delega a gravação ao writer canônico de uma napa, sem reimplementar receita', () => {
    expect(body).toContain('public.confirm_artisanal_strap_material_conversion(');
    // Nenhuma escrita direta na tabela de receitas: versionamento, supersede e
    // aprovação continuam morando no writer singular.
    expect(body).not.toContain('INSERT INTO public.artisanal_strap_recipes');
    expect(body).not.toContain('UPDATE public.artisanal_strap_recipes');
    expect(body).not.toContain('public.save_artisanal_strap_recipe(');
  });

  it('valida o lote INTEIRO antes da primeira escrita', () => {
    const validation = body.indexOf('Passada 1');
    const application = body.indexOf('Passada 2');
    expect(validation).toBeGreaterThan(-1);
    expect(application).toBeGreaterThan(validation);

    // O teto conferido na passada 1 usa a MESMA largura que o writer vai
    // resolver na hora de gravar — conferir o snapshot antigo deixaria passar
    // um lote que estoura no CHECK da versão nova.
    const firstPass = body.slice(validation, application);
    expect(firstPass).toContain('public.resolve_base_group_usable_width_mm(v_row.base_group_id)');
    expect(firstPass).toContain('floor(v_width / v_effective_band)');
    expect(firstPass).toContain('Nada foi alterado.');

    // A chamada que escreve só aparece depois da validação.
    expect(
      body.indexOf('public.confirm_artisanal_strap_material_conversion('),
    ).toBeGreaterThan(application);
  });

  it('preserva executor, prestador e mão de obra de cada receita', () => {
    // `save_artisanal_strap_recipe` grava esses três campos direto do que
    // recebe quando p_id é NULL (versão nova) e ainda exige custo NOT NULL —
    // omitir qualquer um viraria napa de prestador em napa de fábrica.
    expect(core).toContain('Custo de transformacao obrigatorio na nova receita');

    // Os três são LIDOS da receita vigente na passada 1...
    for (const column of [
      'executor_type',
      'default_contractor_id',
      'transformation_cost_per_m',
    ]) {
      expect(body).toContain(`recipe.${column}`);
    }
    // ...e REPASSADOS na passada 2, em vez de ficarem no default do writer.
    expect(body).toContain("'executor_type', v_target ->> 'executor_type'");
    expect(body).toContain("'default_contractor_id', v_target ->> 'default_contractor_id'");
    expect(body).toContain(
      "'transformation_cost_per_m', (v_target ->> 'transformation_cost_per_m')::numeric",
    );
  });

  it('alcança só as receitas vigentes e aceita escopo parcial', () => {
    expect(body).toContain("recipe.status = 'approved'");
    expect(body).toContain('recipe.valid_to IS NULL');
    expect(body).toContain('v_scope IS NULL OR recipe.base_group_id = ANY (v_scope)');
    expect(body).toContain('Nenhum material vigente nesta medida para aplicar o rendimento');
  });

  it('recusa cor, produto, variante e edição de receita individual', () => {
    expect(body).toContain('Rendimento em lote nao aceita cor, produto ou variante de estoque');
    expect(body).toContain('Rendimento em lote nao aceita recipe.id');
    expect(body).not.toContain('INSERT INTO public.products');
  });

  it('exige as duas capabilities e fecha o grant', () => {
    expect(body).toContain("public.assert_artisanal_strap_capability('manage_strap_catalog')");
    expect(body).toContain("public.assert_artisanal_strap_capability('approve_strap_recipe')");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_artisanal_strap_measure_yield_for_all\(uuid, jsonb, text\)\s+FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_artisanal_strap_measure_yield_for_all\(uuid, jsonb, text\)\s+TO authenticated, service_role/,
    );
  });

  it('o lote de materiais NOVOS continua recusando receita existente', () => {
    // O writer plural antigo é para cadastrar material novo; é por isso que
    // este lote precisou existir. Se ele algum dia aceitar recipe.id, os dois
    // passam a competir pelo mesmo caminho.
    const batch = read('supabase/migrations/20270101014550_cadastrar_multiplos_materiais_tira.sql');
    expect(batch).toContain('Cadastro em lote nao aceita recipe.id');
    expect(batch).toContain("'new_material_only', true");
  });

  it('liga a tela ao writer com as duas capabilities', () => {
    expect(writer).toContain("'confirm_artisanal_strap_measure_yield_for_all'");
    expect(control).toContain('confirmArtisanalStrapMeasureYield');
    expect(hub).toContain('<MeasureYieldControl');
    expect(hub).toContain('catalog.capabilities.manage_strap_catalog === true');
    expect(hub).toContain('catalog.capabilities.approve_strap_recipe === true');
  });

  it('a tela reidrata pela composição da lista, não pela identidade do array', () => {
    // Mesma armadilha do VariantManagerPanel: `[recipes]` cru apagaria o
    // formulário a cada refetch do React Query.
    expect(control).toContain('recipesSignature');
    expect(control).not.toMatch(/useEffect\([^]*?\}, \[open, recipes\]\)/);
  });
});
