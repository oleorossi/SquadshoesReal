import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_PATH =
  'supabase/migrations/20270101006300_perfil-largura-napa-base-automatico.sql';
const migration = readFileSync(resolve(ROOT, MIGRATION_PATH), 'utf8');
const legacyIntentMigration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101005500_auto_internal_strap_intent_from_pv.sql',
), 'utf8');

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.search(/\n\$(fn\$|\$);/);
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 5);
}

describe('Napa-base — perfil de largura materializado do cadastro', () => {
  it('deriva a largura SOMENTE do cadastro e devolve NULL quando ambigua', () => {
    const fn = sqlFunction(migration, 'resolve_base_group_usable_width_mm');

    expect(fn).toContain('public.strap_material_product_width_mm(p.id)');
    // Ausencia e divergencia sao os dois motivos de NULL. Sem eles a funcao
    // arbitraria uma largura, que e exatamente o que nao pode acontecer.
    expect(fn).toContain('WHEN count(*) FILTER (WHERE width_mm IS NULL) > 0 THEN NULL');
    expect(fn).toContain('WHEN count(DISTINCT width_mm) <> 1 THEN NULL');
    // Produto acabado de tira nunca e napa-base (mesma regra do gatilho oficial).
    expect(fn).toContain('public.artisanal_strap_variants v');
    // Nenhum atalho que escolha "uma" largura entre varias.
    expect(fn).not.toContain('LIMIT 1');
    expect(fn).not.toMatch(/coalesce\s*\([^)]*,\s*\d+\s*\)/);
  });

  it('so cria perfil quando NAO existe vigente e nunca supersede/suspende nada', () => {
    const fn = sqlFunction(migration, 'ensure_base_material_width_profile');

    expect(fn).toContain("'strap-width:' || p_base_group_id::text");
    expect(fn).toContain("AND wp.status = 'approved'");
    expect(fn).toContain('AND wp.valid_to IS NULL');
    expect(fn).toContain('IF FOUND THEN\n    RETURN v_profile;');
    expect(fn).toContain('public.resolve_base_group_usable_width_mm(p_base_group_id)');
    // Trocar largura invalida receitas aprovadas; isso e prerrogativa de
    // approve_base_material_width_profile. Aqui a largura nasce igual a
    // cadastrada, entao nada pode ser superseded/suspended.
    expect(fn).not.toContain("'superseded'");
    expect(fn).not.toContain("'suspended'");
    expect(fn).not.toContain('UPDATE public.artisanal_strap_recipes');
    expect(fn).not.toContain('UPDATE public.base_material_width_profiles');
    // Assinatura de aprovacao exigida pelo CHECK da tabela.
    expect(fn).toContain('approved_by');
    expect(fn).toContain('valid_from');
    expect(fn).toContain('A criacao do perfil de largura exige usuario autenticado');
  });

  it('o writer do PV materializa o perfil ANTES de designar o SKU oficial', () => {
    const fn = sqlFunction(migration, 'ensure_sale_order_internal_strap_intents');

    const ensureWidth = fn.indexOf('public.ensure_base_material_width_profile(');
    const officialLookup = fn.indexOf('FROM public.base_material_color_official_products op');
    const officialInsert = fn.indexOf('INSERT INTO public.base_material_color_official_products');

    expect(ensureWidth).toBeGreaterThanOrEqual(0);
    expect(officialLookup).toBeGreaterThan(ensureWidth);
    expect(officialInsert).toBeGreaterThan(ensureWidth);
  });

  it('a redefinicao do writer preserva as garantias travadas na 05500', () => {
    const next = sqlFunction(migration, 'ensure_sale_order_internal_strap_intents');
    const previous = sqlFunction(
      legacyIntentMigration, 'ensure_sale_order_internal_strap_intents',
    );

    // O corpo novo e o antigo mais a chamada do perfil — nada mais. Sem isto,
    // uma copia manual poderia perder um lock, uma guarda ou um RAISE sem que
    // nenhum teste existente percebesse (os da 05500 leem o arquivo antigo).
    const stripped = next.replace(
      / {2}-- O perfil de largura util[\s\S]*?\n {2}PERFORM public\.ensure_base_material_width_profile\(\n {4}v_base_group_id, v_actor_id, v_reason\n {2}\);\n\n/,
      '',
    );
    expect(stripped).toBe(previous);
  });

  it('o diagnostico do PV e somente-leitura e cobre as tres lacunas de cadastro', () => {
    const fn = sqlFunction(migration, 'diagnose_sale_order_internal_strap_readiness');

    expect(fn).toContain('STABLE');
    expect(fn).not.toMatch(/\bINSERT INTO\b/);
    expect(fn).not.toMatch(/\bUPDATE public\./);
    expect(fn).not.toMatch(/\bDELETE FROM\b/);
    // Espelha o writer: mesma resolucao de napa-base, cor e pin.
    expect(fn).toContain('public.resolve_strap_base_group_id(');
    expect(fn).toContain('public.resolve_strap_canonical_color_id(');
    expect(fn).toContain('public.resolve_strap_pinned_base_product_id(');
    for (const code of [
      'largura_util_indisponivel',
      'napa_cor_inexistente',
      'napa_cor_ambigua',
      'rendimento_nao_cadastrado',
      'linha_sem_medida_canonica',
      'napa_base_indefinida',
      'cor_nao_canonica',
    ]) {
      expect(fn).toContain(`'${code}'`);
    }

    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION\s+public\.diagnose_sale_order_internal_strap_readiness\(uuid, uuid, text\)\s+TO authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.diagnose_sale_order_internal_strap_readiness\(uuid, uuid, text\)\s+FROM PUBLIC, anon/,
    );
  });

  it('o backfill so alcanca napa-base viva e com largura inequivoca', () => {
    const backfill = migration.slice(migration.lastIndexOf('-- Backfill restrito'));

    expect(backfill).toContain("'reference_base'");
    expect(backfill).toContain('public.resolve_strap_base_group_id(');
    expect(backfill).toContain('public.resolve_base_group_usable_width_mm(g.id) IS NOT NULL');
    expect(backfill).toContain('public.ensure_base_material_width_profile(');
    // Nenhuma escrita direta na tabela de perfis, em produtos ou em receitas.
    expect(backfill).not.toContain('INSERT INTO public.base_material_width_profiles');
    expect(backfill).not.toContain('UPDATE public.products');
    expect(backfill).not.toContain('INSERT INTO public.artisanal_strap_recipes');
  });

  it('a migration inteira nao inventa rendimento nem cria receita', () => {
    // O rendimento (m de tira por m de napa) e dado de engenharia do dono.
    expect(migration).not.toContain('INSERT INTO public.artisanal_strap_recipes');
    expect(migration).not.toContain('confirmed_yield_m_per_m');
    expect(migration).not.toContain('transformation_cost_per_m');
  });
});
