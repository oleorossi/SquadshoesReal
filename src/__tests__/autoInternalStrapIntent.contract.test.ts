import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101005500_auto_internal_strap_intent_from_pv.sql',
), 'utf8');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('PV — intenção automática de tira interna', () => {
  it('resolve texto somente por identidade canônica única ou alias aprovado', () => {
    const fn = sqlFunction('resolve_strap_canonical_color_id');

    expect(fn).toContain('c.name_norm = public.normalize_strap_catalog_text(p_label)');
    expect(fn).toContain("a.status = 'approved'");
    expect(fn).toContain('a.alias_norm = public.normalize_strap_catalog_text(p_label)');
    expect(fn).toContain('SELECT DISTINCT id FROM matches');
    expect(fn).toContain('CASE WHEN count(*) = 1');
    expect(fn).not.toContain('LIMIT 1');
  });

  it('deriva linhas e base no servidor e usa os mesmos locks dos writers canônicos', () => {
    const fn = sqlFunction('ensure_sale_order_internal_strap_intents');

    expect(fn).toContain('public.resolve_strap_base_group_id(');
    expect(fn).toContain('v_sheet.strap_colors');
    expect(fn).toContain("coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base')");
    expect(fn).toContain('p_expected_line_ids');
    expect(fn).toContain('v_expected_sorted IS DISTINCT FROM v_reference_sorted');
    expect(fn).toContain("'strap-official:'");
    expect(fn).toContain("'strap-variant:'");
    expect(fn).not.toContain('strap-pv-base-color:');
    expect(fn).not.toContain('strap-pv-intent:');
  });

  it('mantém o SKU físico pinado do cabedal e bloqueia conflito com o oficial', () => {
    const fn = sqlFunction('ensure_sale_order_internal_strap_intents');
    const resolver = sqlFunction('resolve_strap_base_group_id');
    const pinResolver = sqlFunction('resolve_strap_pinned_base_product_id');
    const upperProduct = pinResolver.indexOf('WHEN v_variant_upper_product_id IS NOT NULL');
    const upperGroup = pinResolver.indexOf('WHEN v_variant_upper_group_id IS NOT NULL');
    const liningProduct = pinResolver.indexOf('WHEN v_variant_lining_product_id IS NOT NULL');
    const liningGroup = pinResolver.indexOf('WHEN v_variant_lining_group_id IS NOT NULL');

    expect(upperProduct).toBeGreaterThanOrEqual(0);
    expect(upperProduct).toBeLessThan(upperGroup);
    expect(liningProduct).toBeLessThan(liningGroup);
    expect(fn).toContain('public.resolve_strap_pinned_base_product_id(');
    expect(pinResolver).toContain('v_sheet.upper_material_product_id');
    expect(pinResolver).toContain('WHEN v_sheet.upper_material_group_id IS NOT NULL THEN NULL');
    expect(pinResolver).toContain('WHEN v_sheet.strap_base_group_id IS NOT NULL THEN NULL');
    expect(pinResolver).toContain('v_sheet.lining_material_product_id');
    expect(fn).toContain('v_base_product.group_id IS DISTINCT FROM v_base_group_id');
    expect(fn).toContain('v_official.official_product_id IS DISTINCT FROM v_pinned_base_product_id');
    expect(fn).toContain('O SKU oficial da napa diverge do produto pinado no cabedal');
    expect(resolver).toContain('SELECT ts.upper_material_group_id');
    expect(resolver.indexOf('p.id = v.upper_material_product_id')).toBeLessThan(
      resolver.indexOf('SELECT upper_material_group_id FROM v'),
    );
  });

  it('só auto-oficializa um produto-base inequívoco e exige largura/receita aprovadas', () => {
    const fn = sqlFunction('ensure_sale_order_internal_strap_intents');

    expect(fn).toContain('SELECT count(*)::integer, (array_agg(p.id ORDER BY p.id))[1]');
    expect(fn).toContain('v_candidate_count = 0');
    expect(fn).toContain('v_candidate_count > 1');
    expect(fn).toContain('INSERT INTO public.base_material_color_official_products');
    expect(fn).toContain("status = 'approved'");
    expect(fn).toContain('valid_from <= now()');
    expect(fn).toContain('Nao existe conversao aprovada');
    expect(fn).not.toMatch(/FROM public\.products[\s\S]{0,300}LIMIT 1/);
  });

  it('cria somente a variante exata, interna, com produto acabado sem compra fictícia', () => {
    const fn = sqlFunction('ensure_sale_order_internal_strap_intents');

    expect(fn).toContain('av.measure_id = v_measure_id');
    expect(fn).toContain('av.base_group_id = v_base_group_id');
    expect(fn).toContain('av.color_id = p_color_id');
    expect(fn).toContain('INSERT INTO public.products');
    expect(fn).toContain("'m', 1, NULL, 1, 1, 2");
    expect(fn).toContain('INSERT INTO public.artisanal_strap_variants');
    expect(fn).toContain("0, 'internal', false");
    expect(fn).toContain("'reference_base', true");
    expect(fn).toContain("'active', NULL");
    expect(fn).toContain('public.resolve_artisanal_strap_catalog(');
    expect(fn).toContain("p_color_id, 'internal', 'reference_base'");
  });

  it('deriva identity_basis da ficha e não confia no snapshot enviado pelo cliente', () => {
    const fn = sqlFunction('prepare_sale_order_item_internal_straps');

    expect(fn).toContain("entry.value ->> 'technical_strap_line_id' = v_line_id::text");
    expect(fn).toContain("nullif(v_sheet_line ->> 'identity_basis', '')");
    expect(fn).toContain("'identity_basis', v_sheet_basis");
    expect(fn).toContain("'strap_type_id', v_strap_type_id");
    expect(fn).toContain("'measure_id', v_measure_id");
    expect(fn).toContain("'consumption', coalesce(v_sheet_line -> 'consumption'");
    expect(fn).toContain('v_item_all_ids IS DISTINCT FROM v_sheet_all_ids');
    expect(fn).toContain("'color', v_color_name, 'color_id', v_color_id");
    expect(fn).not.toMatch(/IF coalesce\(nullif\(v_line ->> 'identity_basis'/);
  });

  it('preserva histórico comprometido e deriva as duas origens prospectivas', () => {
    const fn = sqlFunction('prepare_sale_order_item_internal_straps');

    expect(fn).toContain('v_item_id IS NOT NULL');
    expect(fn).toContain('v_current_snapshot_complete');
    expect(fn).toContain("v_current_order_status IN ('Aprovado', 'Em Produção')");
    expect(fn).toContain("current_setting('app.strap_force_revalidate', true)");
    expect(fn).toContain('v_straps IS NOT DISTINCT FROM');
    expect(fn).toContain("'source_mode', 'internal'");
    expect(fn).toContain("'source_mode', 'buy_ready'");
    expect(fn).toContain("'base_product_id', v_ensured_line ->> 'base_product_id'");
    expect(fn).toContain("'finished_product_group'");
    expect(fn).toContain('public.resolve_artisanal_strap_catalog(');
  });

  it('valida no banco estrutura, origem, pin físico e receita exatos', () => {
    const fn = sqlFunction('tg_validate_sale_order_item_strap_color_alignment');

    expect(fn).toContain('v_expected_color_id := public.resolve_strap_canonical_color_id(NEW.color)');
    expect(fn).toContain("entry.value ->> 'technical_strap_line_id' = v_line_id::text");
    expect(fn).toContain('v_item_ids IS DISTINCT FROM v_sheet_ids');
    expect(fn).toContain("v_source_mode IS DISTINCT FROM 'internal'");
    expect(fn).toContain('av.measure_id = v_measure_id');
    expect(fn).toContain("av.status = 'active'");
    expect(fn).toContain('av.internal_production_enabled');
    expect(fn).toContain('op.official_product_id = v_source_base_product_id');
    expect(fn).toContain('op.official_product_id = v_pinned_base_product_id');
    expect(fn).toContain('r.id = v_source_recipe_id');
    expect(fn).toContain("v_source_mode IS DISTINCT FROM 'buy_ready'");
    expect(fn).toContain('coalesce(d.fulfilled_m, 0) > 0');
    expect(fn).toContain('Receita/produtos congelados nao podem mudar');
  });

  it('reconhece replay pelo payload cru e o mantém estritamente read-only', () => {
    const fn = sqlFunction('create_sale_order_atomic');
    const rawHash = fn.indexOf('v_raw_hash := public.strap_payload_hash');
    const existing = fn.indexOf('WHERE so.client_request_id = p_client_request_id');
    const prepare = fn.indexOf('public.prepare_sale_order_item_internal_straps');

    expect(rawHash).toBeGreaterThanOrEqual(0);
    expect(existing).toBeGreaterThan(rawHash);
    expect(prepare).toBeGreaterThan(existing);
    expect(fn).toContain("'create-sale-order:' || p_client_request_id::text");
    expect(fn).toContain("'idempotent_replay', true");
    expect(fn).not.toContain('public.enqueue_sale_order_strap_demands(');
    expect(fn).toContain('Replay do mesmo payload e estritamente read-only');
    expect(fn).toContain("item.value - 'id'");
    expect(fn).toContain("'strap-pv-auto-intent'");
    expect(fn).toContain('SET client_request_payload_hash = v_raw_hash');
    expect(fn).toContain('public.create_sale_order_atomic_pre_05500(');
  });

  it('prepara contexto, snapshot incompleto ou source alterado e rejeita id de outro PV', () => {
    const fn = sqlFunction('update_sale_order_with_teardown');

    expect(fn).toContain("'update_sale_order_with_teardown:' || p_order_id::text");
    expect(fn).toContain('v_should_prepare := v_item_id IS NULL');
    expect(fn).toContain("(v_item ->> 'color') IS DISTINCT FROM v_current.color");
    expect(fn).toContain("v_item ? 'strap_colors'");
    expect(fn).toContain("v_item ? 'strap_sourcing'");
    expect(fn).toContain('OR NOT v_snapshot_complete');
    expect(fn).toContain("'strap-pv-auto-intent'");
    expect(fn).toContain("'strap_sourcing_revision', v_expected_revision");
    expect(fn).toContain('v_expected_revision IS DISTINCT FROM');
    expect(fn).toContain("USING ERRCODE = '40001'");
    expect(fn).toContain('trg_enqueue_strap_demands_on_item_change_on_update');
    expect(fn).toContain('v_demand_relevant_change');
    expect(fn).toContain('Item % nao pertence ao PV informado');
    expect(fn).toContain('public.update_sale_order_with_teardown_pre_05500(');
  });

  it('mantém os helpers internos curtos e sem EXECUTE público', () => {
    expect(migration).toContain('create_sale_order_atomic_pre_05500');
    expect(migration).toContain('update_sale_order_with_teardown_pre_05500');
    expect(migration).not.toContain('before_internal_strap_intent_20270101005500');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.create_sale_order_atomic_pre_05500[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.update_sale_order_with_teardown_pre_05500[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.prepare_sale_order_item_internal_straps\(jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.set_sale_order_item_strap_sourcing\(uuid, integer, jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toContain('tg_prepare_sale_order_straps_before_confirmation');
    expect(migration).not.toContain("set_config('app.strap_force_revalidate', '1', true)");
    expect(migration).toContain('preview_sale_order_strap_demand_draft_pre_05500');
  });

  it('usa demanda/snapshot congelados no downstream sem re-resolver receita e napa históricas', () => {
    const fn = sqlFunction('preview_sale_order_strap_demand_draft');
    const enqueue = sqlFunction('enqueue_sale_order_strap_demands');

    expect(fn).toContain('public.preview_sale_order_strap_demand_draft_pre_05500(p_item)');
    expect(fn).toContain('FROM public.sale_order_strap_demands d');
    expect(fn).toContain('d.recipe_id IS NOT DISTINCT FROM v_selected_recipe_id');
    expect(fn).toContain('d.base_product_id IS NOT DISTINCT FROM v_selected_base_product_id');
    expect(fn).toContain("v_demand.identity_snapshot -> 'resolved'");
    expect(fn).toContain("'recipe_version', v_demand.recipe_version_snapshot");
    expect(fn).toContain("'confirmed_yield_m_per_m', v_demand.confirmed_yield_snapshot");
    expect(fn).toContain("'frozen_source_snapshot_stale'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand(');
    expect(enqueue).toContain('frozen_financial.sale_order_strap_demand_id');
    expect(enqueue).toContain("'captured_at', frozen_financial.created_at");
  });

  it('serializa revisões/jobs do mesmo PV e rejeita baixa física obsoleta', () => {
    const revision = sqlFunction('tg_assign_sale_order_strap_job_revision');
    const guard = sqlFunction('tg_guard_sale_order_strap_demand_revision');
    const claim = sqlFunction('claim_next_strap_demand_job');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_strap_demand_clocks');
    expect(migration).toContain('REVOKE ALL ON public.sale_order_strap_demand_clocks');
    expect(revision).toContain('public.sale_order_strap_demand_clocks.revision + 1');
    expect(revision).toContain('NEW.source_revision := v_revision');
    expect(guard).toContain('v_job_revision < coalesce(v_current_revision, 0)');
    expect(guard).toContain("j.status = 'processing'");
    expect(guard).toContain('v_previous.recipe_id IS DISTINCT FROM NEW.recipe_id');
    expect(guard).toContain('coalesce(v_previous.fulfilled_m, 0) > 0');
    expect(claim).toContain("'superseded_source_revision'");
    expect(claim).toContain('pg_try_advisory_xact_lock');
    expect(claim).toContain("active.status = 'processing'");
    expect(migration).toContain('Cutover de tiras encontrou backlog ativo');
    expect(migration).toContain('LOCK TABLE public.strap_demand_jobs IN EXCLUSIVE MODE');
    expect(migration).toContain('(max(j.source_revision) + 1)::integer');
    expect(sqlFunction('enqueue_sale_order_strap_demands')).toContain(
      "'sale_order:%s:event:%s'",
    );
  });

  it('fecha ordem de locks e publica um único evento depois do save completo', () => {
    const update = sqlFunction('update_sale_order_with_teardown');
    const statementLock = sqlFunction('tg_lock_strap_auto_intent_before_status_statement');
    const headerTrigger = sqlFunction('tg_enqueue_strap_demands_on_sale_order_confirm');

    expect(update.indexOf("'strap-pv-auto-intent'")).toBeLessThan(
      update.indexOf('FOR UPDATE'),
    );
    expect(update).toContain('SET CONSTRAINTS');
    expect(update).toContain('trg_enqueue_strap_demands_on_item_change_on_update');
    expect(update).toContain('public.enqueue_sale_order_strap_demands(');
    expect(statementLock).toContain("'strap-pv-auto-intent'");
    expect(statementLock).toContain('pg_try_advisory_xact_lock');
    expect(statementLock).toContain("ERRCODE = '40001'");
    expect(headerTrigger).toContain('public.sale_order_atomic_writer_contexts');
    expect(headerTrigger).not.toContain("current_setting('app.strap_order_writer_batch'");
    expect(migration).toContain('BEFORE UPDATE OF\n  sale_order_id, reference_id');
    expect(sqlFunction('tg_enqueue_strap_demands_on_item_change')).toContain(
      'NEW.quantity IS NOT DISTINCT FROM OLD.quantity',
    );
  });

  it('usa contexto privado nos writers e cobre insert confirmado e MUTEX legado', () => {
    const insertGuard = sqlFunction('tg_guard_confirmed_sale_order_insert');
    const enqueue = sqlFunction('enqueue_sale_order_strap_demands');
    const rowGuard = sqlFunction('tg_validate_sale_order_item_strap_color_alignment');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_atomic_writer_contexts');
    expect(migration).toContain('REVOKE ALL ON public.sale_order_atomic_writer_contexts');
    expect(insertGuard).toContain("context.operation = 'create'");
    expect(enqueue).toContain("nullif(btrim(coalesce(ts.upper_material, '')), '')");
    expect(enqueue).toContain("IS NOT NULL THEN '[]'::jsonb");
    expect(enqueue).toContain("'consumption_per_size', coalesce(");
    expect(enqueue).toContain("'measure_id', nullif(line.value ->> 'measure_id', '')");
    expect(rowGuard).toContain('public.sale_order_atomic_writer_contexts');
    expect(rowGuard).not.toContain("current_setting('app.strap_source_admin_override'");
    expect(rowGuard).toContain('v_is_private_override boolean := false');
    expect(rowGuard).toContain('NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id');
    expect(rowGuard).toContain('Item do PV nao pode ser movido para outro pedido');
    expect(rowGuard).toContain('NOT v_is_private_override AND EXISTS');
    const overrideContext = rowGuard.indexOf("context.operation = 'override'");
    const shapeValidation = rowGuard.indexOf('jsonb_typeof(coalesce(NEW.strap_colors');
    expect(overrideContext).toBeGreaterThanOrEqual(0);
    expect(shapeValidation).toBeGreaterThan(overrideContext);
    expect(rowGuard.slice(overrideContext, shapeValidation)).not.toContain('RETURN NEW');
    expect(rowGuard).toContain('public.strap_demand_has_external_commitment(d.id)');
  });
});
