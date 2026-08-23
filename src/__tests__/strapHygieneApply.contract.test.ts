import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION_PATH =
  'supabase/migrations/20270101008600_strap-hygiene-apply-owner-lists.sql';
const migration = read(MIGRATION_PATH);

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.search(/\n\$(fn\$|\$);/);
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 5);
}

describe('Higiene de tiras — aplicar listas confirmadas pelo dono (F2+F3)', () => {
  it('usa allowlist nominada, sem LIKE operacional e sem reescrever PV', () => {
    [
      'TIRA OVERLOCK 5MM',
      'TIRA CHATA 8MM',
      'TIRA CHATA 25MM',
      'TIRA CHATA COSTURADA 11MM',
      'TIRA STRASS 6MM',
      'TIRA STRASS 15MM',
      'MEIA CANA 10MM',
      'NAPA SOFT',
      'NAPA SANTORINE',
      'GLOW METALIC',
      'NAPA SUDANI',
    ].forEach((name) => expect(migration).toContain(name));

    expect(migration).not.toContain('NAPA MADRID');
    expect(migration).not.toContain('DUBLAGEM');
    expect(migration).not.toMatch(/UPDATE public\.sale_order_items/);
    expect(migration).not.toMatch(/UPDATE public\.technical_sheets/);
    expect(migration).not.toContain('calculate_order_consumption');
    expect(migration).not.toMatch(/GREATEST\s*\(/i);
    expect(migration).toContain('normalize_strap_catalog_text');
    expect(migration).toContain('Grupo confirmado pelo dono nao encontrado como folha');
    expect(migration).toContain('INTO STRICT');
  });

  it('apaga ficha de napa na tira antes de marcar a flag', () => {
    const deleteAt = migration.indexOf('delete_napa_like_strap_component_sheet');
    const flagAt = migration.indexOf("SET is_artisanal_strap = true");
    expect(deleteAt).toBeGreaterThan(0);
    expect(flagAt).toBeGreaterThan(deleteAt);
    expect(migration).toContain('>= 200');
    expect(migration).toContain("og.kind = 'strap'");
    expect(migration).toContain('DELETE FROM public.component_sheets');
  });

  it('espelha 1370 mm so nas quatro napas com ficha ja em 1370', () => {
    expect(migration).toContain("og.kind = 'napa'");
    expect(migration).toContain('p.unit = \'m\'');
    expect(migration).toContain('target_width_mm');
    expect(migration).toContain('1370');
    expect(migration).not.toContain('PALMILHA');
    expect(migration).toContain('mirror_napa_product_width');
  });

  it('marca TRANCA so via candidato de higiene por UUID', () => {
    expect(migration).toContain("normalize_strap_catalog_text('TRANÇA')");
    expect(migration).toContain('strap_finished_group_is_hygiene_candidate');
    expect(migration).toContain('hygiene_candidate_uuid');
    expect(migration).not.toMatch(/SET is_artisanal_strap = true[\s\S]*TRANÇA[\s\S]*LIKE/i);
  });

  it('heranca de ficha de componente ignora grupo de tira acabada', () => {
    const inherit = sqlFunction(migration, 'tg_inherit_component_sheet_on_product');
    expect(inherit).toContain('coalesce(v_group.is_artisanal_strap, false)');
    expect(inherit).toContain('RETURN NEW');
    expect(inherit).not.toMatch(/g\.name\s*(?:ilike|like|=)/i);
    expect(inherit).not.toContain('GREATEST');

    const sync = sqlFunction(migration, 'tg_sync_component_sheet_on_product_group_change');
    expect(sync).toContain('coalesce(v_group.is_artisanal_strap, false)');
    expect(sync).toContain('SET group_id = NEW.group_id');
  });

  it('prova que Overlock deixa de ser napa-base', () => {
    expect(migration).toContain('strap_base_group_is_eligible(v_overlock_id)');
    expect(migration).toContain('TIRA OVERLOCK 5MM ainda aparece como napa-base depois da flag');
    expect(migration).toContain('Ainda existe ficha de napa em grupo de tira acabada');
  });
});
