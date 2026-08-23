import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101008500_herdar-material-forracao-nas-tiras.sql'),
  'utf8',
);
const PIN_MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101008600_alinhar-pin-tira-com-forracao.sql'),
  'utf8',
);
const WRITER_MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101008700_proteger-heranca-forracao-no-writer-de-tiras.sql'),
  'utf8',
);
const SHEETS = readFileSync(resolve(ROOT, 'src/pages/TechnicalSheets.tsx'), 'utf8');
const VARIANTS = readFileSync(
  resolve(ROOT, 'src/components/technical-sheets/MaterialVariantsTab.tsx'),
  'utf8',
);

describe('tiras sem cabedal herdam a Forração', () => {
  it('materializa o UUID somente no caso reference_base', () => {
    expect(MIGRATION).toContain('NOT coalesce(NEW.has_straps, false)');
    expect(MIGRATION).toContain("nullif(btrim(NEW.upper_material), '') IS NOT NULL");
    expect(MIGRATION).toContain("'reference_base'");
    expect(MIGRATION).toContain('NEW.strap_base_group_id := v_lining_group_id');
    expect(MIGRATION).toContain('NEW.strap_base_group_id := NULL');
  });

  it('pin de produto da Forração vence o nome exato do grupo', () => {
    const sync = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining'),
      MIGRATION.indexOf('DROP TRIGGER IF EXISTS trg_sync_technical_sheet_strap_base_from_lining_insert'),
    );
    expect(sync.indexOf('NEW.lining_material_product_id'))
      .toBeLessThan(sync.indexOf('lower(btrim(NEW.lining_material))'));
    expect(sync).toContain('lower(btrim(g.name))');
  });

  it('mantém o resolvedor operacional UUID-only e condiciona o principal à cascata da Forração', () => {
    const resolver = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id'),
      MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.resolve_strap_base_group_id'),
    );
    expect(resolver).toContain('straps_follow_lining');
    expect(resolver).toContain('coalesce(s.variant_drives_lining, false)');
    expect(resolver).not.toContain('lower(');
    expect(resolver).not.toContain('public.product_groups');
  });

  it('alinha também o SKU pinado à Forração efetiva', () => {
    expect(PIN_MIGRATION).toContain('v_straps_follow_lining');
    expect(PIN_MIGRATION).toContain('v_variant_lining_product_id');
    expect(PIN_MIGRATION).toContain('coalesce(v_sheet.variant_drives_lining, false)');
    expect(PIN_MIGRATION).toContain('v_sheet.lining_material_product_id');
    expect(PIN_MIGRATION).not.toContain('lower(');
  });

  it('não reescreve pedidos, demandas, reservas nem snapshots históricos', () => {
    expect(MIGRATION).not.toMatch(/UPDATE\s+public\.(sale_order|sale_order_strap_demands|material_reservations|strap_demand_snapshots)/i);
  });

  it('o backfill repetido não toca fichas já alinhadas', () => {
    const backfill = MIGRATION.slice(
      MIGRATION.indexOf('UPDATE public.technical_sheets ts'),
      MIGRATION.indexOf('-- Se todas as tiras sao produtos acabados'),
    );
    expect(backfill).toContain('ts.strap_base_group_id IS DISTINCT FROM coalesce(');
  });

  it('preserva o guard contra pin manual antes do trigger derivado', () => {
    expect('trg_guard_technical_sheet_strap_base_group_update'
      .localeCompare('trg_sync_technical_sheet_strap_base_from_lining_update')).toBeLessThan(0);
    expect(MIGRATION).not.toContain('app.artisanal_strap_catalog_write');
  });

  it('fecha também o writer administrativo e mantém a invalidação completa', () => {
    expect(WRITER_MIGRATION).toContain('tg_validate_technical_sheet_strap_base_from_lining');
    expect(WRITER_MIGRATION).toContain('NEW.strap_base_group_id IS DISTINCT FROM v_expected_group_id');
    expect('trg_guard_technical_sheet_strap_base_group_update'
      .localeCompare('trg_reject_divergent_strap_base_from_lining_update')).toBeLessThan(0);
    expect('trg_reject_divergent_strap_base_from_lining_update'
      .localeCompare('trg_sync_technical_sheet_strap_base_from_lining_update')).toBeLessThan(0);

    const syncTrigger = WRITER_MIGRATION.slice(
      WRITER_MIGRATION.indexOf('CREATE TRIGGER trg_sync_technical_sheet_strap_base_from_lining_update'),
      WRITER_MIGRATION.indexOf('COMMENT ON TRIGGER'),
    );
    expect(syncTrigger).toContain('strap_base_group_id');
    const dirtyTrigger = WRITER_MIGRATION.slice(
      WRITER_MIGRATION.indexOf('CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet'),
      WRITER_MIGRATION.indexOf('COMMIT;'),
    );
    expect(dirtyTrigger).toContain('upper_material_group_id');
    expect(dirtyTrigger).toContain('variant_drives_lining');
  });

  it('explica a regra na própria ficha', () => {
    expect(SHEETS).toContain('Forração é o material principal da referência');
    expect(SHEETS).toContain('também será usada como napa-base das tiras');
    expect(SHEETS).toContain('Napa-base definida pela referência');
  });

  it('não mostra a regra para tiras prontas e evita estado velho entre ficha e variantes', () => {
    expect(SHEETS).toContain("strapIdentityBasis(line) === 'reference_base'");
    expect(SHEETS).toContain("nextTab === 'variants' && dirty");
    expect(SHEETS).toContain("queryKey: ['sheet_variant_cascade', sheet.id]");
    expect(VARIANTS).toContain("strapIdentityBasis(line) === 'reference_base'");
    expect(VARIANTS).toContain('strap_colors');
  });

  it('a prévia de duplicação preserva o pin visual da Forração', () => {
    const duplicateStart = VARIANTS.indexOf('const handleOpenDuplicateDialog');
    const duplicate = VARIANTS.slice(duplicateStart, duplicateStart + 1_500);
    expect(duplicate).toContain('lining_material_product_id: source.lining_material_product_id');
  });
});
