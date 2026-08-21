import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION_PATH =
  'supabase/migrations/20270101006800_napa-base-elegivel-sem-sku-oficial.sql';
const migration = read(MIGRATION_PATH);
const drawer = read('src/components/sale-orders/StrapCatalogResolutionDrawer.tsx');
const hooks = read('src/hooks/useArtisanalStraps.ts');

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.search(/\n\$(fn\$|\$);/);
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 5);
}

describe('Napa-base elegivel sem SKU oficial ja designado', () => {
  it('nao exige designacao oficial por cor — o registro que o proprio save cria', () => {
    const fn = sqlFunction(migration, 'strap_base_group_is_eligible');

    // ESTA e a regressao: exigir base_material_color_official_products aqui e
    // circular (o registro e POR COR e nasce em
    // ensure_sale_order_internal_strap_intents), entao familia que nunca vendeu
    // tira nunca ficava selecionavel e o Comercial pinava a napa errada.
    expect(fn).not.toContain('base_material_color_official_products');
    // Largura util: perfil vigente OU derivavel do cadastro. Exigir o perfil
    // pronto rejeitaria napa que o writer aceitaria (ele materializa o perfil).
    expect(fn).toContain('public.base_material_width_profiles w');
    expect(fn).toContain("AND w.status = 'approved'");
    expect(fn).toContain('AND w.valid_to IS NULL');
    expect(fn).toContain('OR public.resolve_base_group_usable_width_mm(g.id) IS NOT NULL');
    // Sem SKU linear ativo nao ha napa para cortar tira.
    expect(fn).toContain("AND p.unit = 'm'");
    expect(fn).toContain('AND p.active');
    // Tira acabada nunca e a napa que a origina.
    expect(fn).toContain('public.artisanal_strap_variants v');
    expect(fn).toContain('NOT coalesce(g.is_artisanal_strap, false)');
    // Identidade nunca por nome.
    expect(fn).not.toMatch(/g\.name\s*(?:ilike|like|=)/i);
    expect(fn).not.toContain('LIMIT 1');
  });

  it('publica a mesma regra para a tela, com o que sustenta cada candidata', () => {
    const fn = sqlFunction(migration, 'list_strap_base_group_candidates');

    expect(fn).toContain('public.strap_base_group_is_eligible(g.id)');
    expect(fn).toContain('public.is_approved_user()');
    expect(fn).toContain('usable_width_mm');
    expect(fn).toContain('linear_sku_count');
    expect(fn).toContain('has_approved_width_profile');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.list_strap_base_group_candidates\(\) FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_strap_base_group_candidates\(\)\s+TO authenticated, service_role/,
    );
  });

  it('faz o writer do drawer aceitar exatamente o que a regra canonica aprova', () => {
    const fn = sqlFunction(migration, 'resolve_technical_strap_context_from_sale_order');

    expect(fn).toMatch(
      /IF v_requires_reference_base THEN[\s\S]*?NOT public\.strap_base_group_is_eligible\(p_base_group_id\)/,
    );
    expect(fn).toContain('IF p_base_group_id IS NULL');
    expect(fn).not.toContain('base_material_color_official_products');
    expect(fn).not.toContain('Napa-base sem perfil aprovado ou produto oficial ativo');
    // O resto do contrato da 20270101006200 continua de pe.
    expect(fn).toContain('SET strap_base_group_id = v_effective_base_group_id');
    expect(fn).toMatch(
      /v_effective_base_group_id\s*:=\s*p_base_group_id;[\s\S]*ELSE[\s\S]*v_effective_base_group_id\s*:=\s*NULL;/,
    );
  });

  it('realinha somente ficha cujo pin contradiz o material declarado nela', () => {
    // Sem pin de produto por UUID (que teria precedencia no resolvedor), com
    // linha reference_base viva e sem PV comprometido — snapshot comprometido
    // nao se reescreve por migration.
    expect(migration).toContain('ts.upper_material_product_id IS NULL');
    expect(migration).toContain('ts.lining_material_product_id IS NULL');
    expect(migration).toContain('AND declared.id <> ts.strap_base_group_id');
    expect(migration).toContain('AND public.strap_base_group_is_eligible(declared.id)');
    expect(migration).toMatch(
      /NOT EXISTS \([\s\S]*sale_order_items soi[\s\S]*so\.status IN \('Aprovado', 'Em Produção'\)/,
    );
    // Nao inventa napa: so aceita o nome declarado que resolve para um grupo.
    expect(migration).toContain('lower(btrim(declared.name)) = lower(btrim(coalesce(');
    expect(migration).toContain("lower(btrim(declared.name)) <> ''");
    // Rastreavel.
    expect(migration).toContain("'realign_technical_sheet_strap_base_group'");
    expect(migration).toContain('old_data');
  });

  it('faz o drawer listar as napas pelo servidor, nunca por produto oficial', () => {
    expect(hooks).toContain('export function useStrapBaseGroupCandidates(');
    expect(hooks).toContain("untypedSupabase.rpc('list_strap_base_group_candidates')");
    expect(hooks).toContain('export interface StrapBaseGroupCandidate {');

    expect(drawer).toContain('useStrapBaseGroupCandidates');
    expect(drawer).toContain('const eligibleBaseGroupIds = useMemo(');
    // A derivacao antiga (produto oficial ativo) nao pode voltar para o cliente.
    expect(drawer).not.toContain('official_products');
    expect(drawer).toMatch(
      /const groups = useMemo\(\s*\(\) => \[\.\.\.baseGroupCandidates\]/,
    );
  });
});
