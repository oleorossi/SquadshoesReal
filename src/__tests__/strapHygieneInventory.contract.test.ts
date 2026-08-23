import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION_PATH =
  'supabase/migrations/20270101008900_strap-hygiene-inventory-and-guards.sql';
const migration = read(MIGRATION_PATH);
const hub = read('src/pages/ArtisanalStraps.tsx');
const groupEditDialog = read('src/components/groups/GroupEditDialog.tsx');
const groupCreateDialog = read('src/components/groups/GroupCreateDialog.tsx');
const eligibility = read('supabase/migrations/20270101006800_napa-base-elegivel-sem-sku-oficial.sql');

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.search(/\n\$(fn\$|\$);/);
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 5);
}

describe('Higiene do cadastro de tiras — inventario e redes de seguranca', () => {
  it('publica os seis codigos de higiene sem escrever cadastro nem PV', () => {
    const fn = sqlFunction(migration, 'artisanal_strap_catalog_diagnostics');

    [
      'finished_strap_group_unflagged',
      'strap_component_sheet_looks_like_napa',
      'napa_width_inverted',
      'buy_ready_line_without_variant',
      'internal_recipe_missing',
      'missing_base_color_sku',
      'review_existing_variant',
      'create_variant_with_bundle',
    ].forEach((code) => expect(fn).toContain(code));

    expect(fn).not.toContain('UPDATE public.product_groups');
    expect(fn).not.toContain('UPDATE public.component_sheets');
    expect(fn).not.toContain('UPDATE public.sale_order_items');
    expect(fn).not.toContain('SET is_artisanal_strap');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.artisanal_strap_catalog_diagnostics\(\) FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.artisanal_strap_catalog_diagnostics\(\)\s+TO authenticated, service_role/,
    );
  });

  it('sugere grupo de tira acabada so no diagnostico — nunca na elegibilidade', () => {
    const candidate = sqlFunction(migration, 'strap_finished_group_is_hygiene_candidate');
    expect(candidate).toContain('artisanal_strap_types');
    expect(candidate).toContain('identity_group_id');
    expect(candidate).toContain("identity_basis = 'finished_product_group'");
    expect(candidate).toContain('coalesce(g.is_artisanal_strap, false) = false');
    expect(candidate).toContain('coalesce(g.is_family, false) = false');

    const eligible = sqlFunction(eligibility, 'strap_base_group_is_eligible');
    expect(eligible).not.toMatch(/g\.name\s*(?:ilike|like|=)/i);
    expect(eligible).not.toContain('name_norm');
    expect(eligible).toContain('NOT coalesce(g.is_artisanal_strap, false)');
    expect(eligible).not.toContain('strap_finished_group_is_hygiene_candidate');
  });

  it('recusa ficha de napa em grupo de tira e desliga auto_component_sheet', () => {
    const sheetGuard = sqlFunction(migration, 'tg_reject_napa_like_sheet_on_strap_group');
    expect(sheetGuard).toContain('is_artisanal_strap');
    expect(sheetGuard).toContain('>= 200');
    expect(sheetGuard).toContain('Ficha de componente com largura de napa');
    expect(sheetGuard).not.toContain('GREATEST');

    const groupGuard = sqlFunction(migration, 'tg_guard_artisanal_strap_group');
    expect(groupGuard).toContain('NEW.auto_component_sheet := false');
    expect(groupGuard).toContain('>= 200');
    expect(groupGuard).toContain('nao pode herdar ficha de componente com largura de napa');

    expect(migration).toContain('trg_reject_napa_like_sheet_on_strap_group');
    expect(migration).toContain('trg_guard_artisanal_strap_group');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF product_id, dimensions_width, dimensions_unit');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF is_artisanal_strap, auto_component_sheet');
  });

  it('converte dimensao para mm sem GREATEST e ignora palmilha no inventario invertido', () => {
    const dim = sqlFunction(migration, 'strap_hygiene_dimension_mm');
    expect(dim).toContain("WHEN 'mm'");
    expect(dim).toContain("WHEN 'cm'");
    expect(dim).toContain("WHEN 'm'");
    expect(dim).not.toContain('GREATEST');

    const diagnostics = sqlFunction(migration, 'artisanal_strap_catalog_diagnostics');
    expect(diagnostics).toContain("'Palmilha'");
    expect(diagnostics).toContain("'Forração da Palmilha'");
    expect(diagnostics).toContain('p.unit = \'m\'');
  });

  it('expoe checkbox em todo grupo-folha e painel de higiene no Hub', () => {
    expect(groupEditDialog).toContain('id="edit-is-artisanal-strap"');
    expect(groupEditDialog).toContain('Tira acabada (Hub)');
    expect(groupEditDialog).toContain('is_artisanal_strap: isContainer ? false : isArtisanalStrap');
    expect(groupEditDialog).toContain('!isContainer');
    expect(groupEditDialog).not.toMatch(/show\.artisanal && \(\s*<Checkbox/);

    expect(groupCreateDialog).toContain('id="is-artisanal-strap"');
    expect(groupCreateDialog).toContain('is_artisanal_strap: form.is_artisanal_strap');
    expect(groupCreateDialog).toContain('auto_component_sheet: form.is_artisanal_strap ? false : form.auto_component_sheet');
    expect(groupCreateDialog).toContain('disabled={form.is_artisanal_strap}');

    [
      'finished_strap_group_unflagged',
      'strap_component_sheet_looks_like_napa',
      'napa_width_inverted',
      'buy_ready_line_without_variant',
      'internal_recipe_missing',
      'missing_base_color_sku',
    ].forEach((code) => expect(hub).toContain(code));
    expect(hub).toContain('HYGIENE_ISSUE_CODES');
    expect(hub).toContain('Marcar como tira acabada');
    expect(hub).toContain('HIGIENE DO CADASTRO');
    expect(hub).toContain('is_artisanal_strap: true');
    expect(hub).toContain('otherCatalogIssues');
  });
});
