import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV-00239 / SP130 TRASEIRA: ficha 120 cm/par × item congelado 42.
 * Consumo batch já overlaya; item/demanda só realinham se propagate rodar.
 * 455 fecha o buraco: portão aceita Comercial + trigger no save da ficha +
 * repair one-shot.
 */
const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101045500_strap_structure_consumption_wins_open_pvs.sql',
  ),
  'utf8',
);
const PROPAGATE = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101029200_propagate_sheet_straps_to_open_pvs.sql',
  ),
  'utf8',
);
const RESOLVE = readFileSync(
  resolve(ROOT, 'src/lib/strapConsumption.ts'),
  'utf8',
);

describe('strap structure consumption wins on open/confirmed PVs', () => {
  it('455 cria portão único e inclui Comercial', () => {
    expect(MIGRATION).toContain('strap_structure_consumption_wins_open_pvs_455');
    expect(MIGRATION).toContain('private.can_propagate_sheet_straps');
    expect(MIGRATION).toContain("app.strap_propagate_rpc");
    expect(MIGRATION).toContain("session_user IN ('postgres', 'supabase_admin')");
    expect(MIGRATION).toMatch(
      /ARRAY\s*\[\s*'admin'\s*,\s*'gerente'\s*,\s*'producao'\s*,\s*'comercial'\s*\]/,
    );
  });

  it('455 grava consumption/cps sem prepare (não exige ator de auditoria)', () => {
    expect(MIGRATION).toContain('strap_line_requires_recipe_revalidate');
    expect(MIGRATION).toContain('strap_colors_require_recipe_revalidate');
    expect(MIGRATION).toContain('strap_line_same_except_consumption');
    expect(MIGRATION).toContain('consumption/cps sozinho: ficha vence sem prepare');
    expect(MIGRATION).toContain('app.command_actor_id');
    expect(MIGRATION).toContain('sale_order_item_strap_context_reference_id');
  });

  it('455 não revalida buy_ready legado em UPDATE só de cm', () => {
    expect(MIGRATION).toContain('tg_validate_sale_order_item_strap_color_alignment');
    expect(MIGRATION).toContain('private.strap_line_same_except_consumption');
    expect(MIGRATION).toContain('finished_product_id pré-453');
  });

  it('455 patcha propagate e auto_resync para o portão novo', () => {
    expect(MIGRATION).toContain('propagate_sheet_straps_to_open_pvs');
    expect(MIGRATION).toContain('auto_resync_unstarted_ops_for_sheet');
    expect(MIGRATION).toContain('NOT private.can_propagate_sheet_straps()');
  });

  it('455 instala trigger AFTER UPDATE OF strap_colors', () => {
    expect(MIGRATION).toContain('tg_propagate_sheet_straps_on_structure_change');
    expect(MIGRATION).toContain('trg_propagate_sheet_straps_on_structure_change');
    expect(MIGRATION).toContain('AFTER UPDATE OF strap_colors ON public.technical_sheets');
    expect(MIGRATION).toContain("set_config('app.strap_propagate_rpc', '1', true)");
    expect(MIGRATION).toContain('propagate_sheet_straps_to_open_pvs(NEW.id)');
  });

  it('455 repara PV-00239 TRASEIRA 42→120 e re-enfileira demanda', () => {
    expect(MIGRATION).toContain('PV-00239');
    expect(MIGRATION).toContain('1143c918-90f0-4eaf-9826-0831892930ca');
    expect(MIGRATION).toContain('ae07ee32-bf58-4fd9-88ae-e782d92d1f43');
    expect(MIGRATION).toContain("'120'");
    expect(MIGRATION).toContain('enqueue_sale_order_strap_demands');
  });

  it('292 já overlaya consumption da ficha no merge (preview do Consumo)', () => {
    expect(PROPAGATE).toContain("'consumption', v_sheet_line -> 'consumption'");
    expect(PROPAGATE).toContain('v_overlay_structure := true');
  });

  it('resolveOrderStraps de snapshot UUID ainda é o item (demanda depende do persist)', () => {
    // Documenta a assimetria: TS não overlaya cm da ficha em snapshot
    // canônico — por isso o repair/trigger no item é load-bearing.
    expect(RESOLVE).toContain('return itemStraps.map((strap) => ({ ...strap }))');
  });
});
