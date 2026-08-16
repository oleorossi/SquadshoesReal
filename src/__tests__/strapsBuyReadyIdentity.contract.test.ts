import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101004400_straps_buy_ready_identity.sql',
), 'utf8');
const STRAP_HOOK = readFileSync(resolve(ROOT, 'src/hooks/useArtisanalStraps.ts'), 'utf8');
const STRAP_EDITOR = readFileSync(resolve(
  ROOT,
  'src/components/artisanal-straps/ArtisanalStrapEditor.tsx',
), 'utf8');
const STRAP_PAGE = readFileSync(resolve(ROOT, 'src/pages/ArtisanalStraps.tsx'), 'utf8');

function between(startMarker: string, endMarker: string) {
  const start = MIGRATION.indexOf(startMarker);
  const end = MIGRATION.indexOf(endMarker, start + startMarker.length);
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
}

describe('Tiras compradas prontas — identidade de catálogo e PV', () => {
  it('adiciona capacidade e base de identidade com shape estrutural fechado', () => {
    expect(MIGRATION).toContain("ADD COLUMN identity_basis text NOT NULL DEFAULT 'reference_base'");
    expect(MIGRATION).toContain('ADD COLUMN internal_production_enabled boolean NOT NULL DEFAULT true');
    expect(MIGRATION).toContain('artisanal_strap_variants_identity_basis_ck');
    expect(MIGRATION).toContain('artisanal_strap_variants_finished_group_shape_ck');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()');
    expect(MIGRATION).toContain('Linha tecnica comprada pronta exige identity_group_id existente');
    expect(MIGRATION).toMatch(
      /identity_basis <> 'finished_product_group'[\s\S]*NOT internal_production_enabled[\s\S]*purchase_enabled[\s\S]*min_stock_replenishment_mode = 'buy_ready'/,
    );
  });

  it('separa capacidade interna e compra pronta na disponibilidade', () => {
    const source = between(
      'CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_source_availability(',
      'CREATE OR REPLACE FUNCTION public.assert_artisanal_strap_variant_activation',
    );
    expect(source).toContain('v_variant.internal_production_enabled');
    expect(source).toContain("v_variant.identity_basis = 'reference_base'");
    expect(source).toContain("'internal_production_disabled'");
    expect(source).toContain("'identity_group_id'");
    expect(source).toContain("'base_product_id', CASE WHEN v_variant.identity_basis = 'reference_base'");
    expect(source).toContain("'recipe_id', CASE WHEN v_variant.identity_basis = 'reference_base'");
  });

  it('mantém writer legado e oferece writer explícito para a nova identidade', () => {
    const identityWriter = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_variant(\n  p_measure_id uuid,\n  p_base_group_id uuid,\n  p_color_id uuid,\n  p_finished_product_id uuid,\n  p_min_stock_m numeric,\n  p_min_stock_replenishment_mode text,\n  p_purchase_enabled boolean,\n  p_identity_basis text,',
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_variant(\n  p_measure_id uuid,\n  p_base_group_id uuid,\n  p_color_id uuid,\n  p_finished_product_id uuid,\n  p_min_stock_m numeric,\n  p_min_stock_replenishment_mode text,\n  p_purchase_enabled boolean,\n  p_status text DEFAULT',
    );
    const legacyWriter = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_variant(\n  p_measure_id uuid,\n  p_base_group_id uuid,\n  p_color_id uuid,\n  p_finished_product_id uuid,\n  p_min_stock_m numeric,\n  p_min_stock_replenishment_mode text,\n  p_purchase_enabled boolean,\n  p_status text DEFAULT',
      '-- -----------------------------------------------------------------------------\n-- 4. Resolver de catalogo',
    );
    expect(identityWriter).toContain('identity_basis, internal_production_enabled');
    expect(legacyWriter).toContain("v_identity_basis text := 'reference_base'");
    expect(legacyWriter).toContain('SELECT identity_basis, internal_production_enabled');
  });

  it('resolver de cinco argumentos fixa buy_ready e wrapper antigo preserva reference_base', () => {
    const resolver = between(
      '-- 4. Resolver de catalogo: 5 argumentos + wrapper legado reference_base',
      '-- 5. Bundle: caminho legado intacto',
    );
    expect(resolver).toContain('p_identity_basis text');
    expect(resolver).toContain("v_effective_source := 'buy_ready'");
    expect(resolver).toContain('Origem interna bloqueada: internal_production_disabled');
    expect(resolver).toContain("AND identity_basis = p_identity_basis");
    expect(resolver).toContain("p_source_mode, 'reference_base'");
    expect(resolver).toMatch(
      /'base_product_id', CASE WHEN v_effective_source = 'buy_ready' THEN NULL/,
    );
    expect(resolver).toMatch(
      /'recipe_id', CASE WHEN v_effective_source = 'buy_ready' THEN NULL/,
    );
  });

  it('bundle exige grupo acabado, proíbe receita e mantém o produto não artesanal', () => {
    const bundle = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(',
      '-- 6. Preview do PV',
    );
    expect(bundle).toContain("v_identity_basis = 'reference_base'");
    expect(bundle).toContain('save_artisanal_strap_catalog_bundle_reference_base_legacy');
    expect(bundle).toContain('finished_product_group exige identity_group_id');
    expect(bundle).toContain('Tira comprada pronta nao aceita receita interna');
    expect(bundle).toContain('v_product.group_id IS DISTINCT FROM v_identity_group_id');
    expect(bundle).toContain('is_artisanal = false');
    expect(bundle).toContain("'finished_product_group',\n    false,");
    expect(bundle).toContain('v_is_nominal_strass AND v_identity_basis <>');
    expect(bundle.indexOf('v_is_nominal_strass AND v_identity_basis <>'))
      .toBeLessThan(bundle.indexOf('save_artisanal_strap_catalog_bundle_reference_base_legacy'));
  });

  it('bundle grava a cor canônica no produto e impede drift depois do vínculo', () => {
    const bundle = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(',
      '-- 6. Preview do PV',
    );
    expect(bundle).toContain('SELECT c.name INTO v_canonical_color_name');
    expect(bundle).toMatch(/group_id, color, quantity/);
    expect(bundle).toContain('v_identity_group_id,\n      v_canonical_color_name,');
    expect(bundle.match(/color = v_canonical_color_name/g)?.length).toBe(2);
    const productGate = between(
      'CREATE OR REPLACE FUNCTION public.tg_enforce_buy_ready_strass_product()',
      'CREATE OR REPLACE FUNCTION public.tg_audit_artisanal_strap_finished_product()',
    );
    expect(productGate).toContain("v.identity_basis = 'finished_product_group'");
    expect(productGate).toContain('NEW.group_id IS DISTINCT FROM v.base_group_id');
    expect(productGate).toContain(
      'public.normalize_strap_catalog_text(NEW.color) IS DISTINCT FROM c.name_norm',
    );
    expect(productGate).not.toContain('supplier_color_code');
    expect(MIGRATION).toContain('BEFORE INSERT OR UPDATE OF group_id, color, is_artisanal');

    const canonicalColorSync = between(
      'CREATE OR REPLACE FUNCTION public.tg_sync_finished_product_canonical_color()',
      'CREATE OR REPLACE FUNCTION public.tg_reject_finished_group_strap_recipe()',
    );
    expect(canonicalColorSync).toContain('NEW.name IS NOT DISTINCT FROM OLD.name');
    expect(canonicalColorSync).toContain('SET color = NEW.name');
    expect(canonicalColorSync).toContain("v.identity_basis = 'finished_product_group'");
    expect(canonicalColorSync).toContain("'app.artisanal_strap_catalog_write', '1'");
    expect(canonicalColorSync).toContain('app.strap_change_correlation_id');
    expect(canonicalColorSync).not.toContain('supplier_color_code');
    expect(MIGRATION).toContain('AFTER UPDATE OF name\n  ON public.canonical_colors');
    expect(MIGRATION).toContain(
      'public.normalize_strap_catalog_text(p.color) IS DISTINCT FROM c.name_norm',
    );
  });

  it('persiste supplier_color_code sem confundir ausência da chave com valor explícito', () => {
    const bundle = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(',
      '-- 6. Preview do PV',
    );
    expect(bundle).toMatch(/supplier_id, supplier_color_code, purchase_unit/);
    expect(bundle).toContain("IF v_product_payload ? 'supplier_color_code' THEN");
    expect(bundle).toMatch(
      /SET name = CASE[\s\S]*supplier_id = CASE[\s\S]*supplier_color_code = nullif\([\s\S]*ELSE[\s\S]*Sem a chave, supplier_color_code nao aparece no target-list[\s\S]*supplier_id = CASE/,
    );
    expect(bundle).toContain("btrim(coalesce(v_product_payload ->> 'supplier_color_code', ''))");
    expect(bundle).toContain('save_artisanal_strap_catalog_bundle_reference_base_legacy');
    expect(bundle).toContain("v_legacy_result ->> 'finished_product_id'");

    const listing = between(
      'CREATE OR REPLACE FUNCTION public.list_artisanal_strap_catalog(',
      '-- -----------------------------------------------------------------------------\n-- 3. Writer de variante',
    );
    expect(listing).toContain("'supplier_color_code', p.supplier_color_code");
    expect(STRAP_HOOK).toContain('supplier_color_code?: string | null;');
    expect(STRAP_HOOK).toContain("untypedSupabase.rpc('list_artisanal_strap_catalog'");
    expect(STRAP_EDITOR).toContain("supplierColorCode: product?.supplier_color_code || ''");
    expect(STRAP_EDITOR).toContain('supplier_color_code: form.supplierColorCode.trim() || null');
  });

  it('audita cor/código/fornecedor vinculados com ator e correlação sem evento em no-op', () => {
    const audit = between(
      'CREATE OR REPLACE FUNCTION public.tg_audit_artisanal_strap_finished_product()',
      'CREATE OR REPLACE FUNCTION public.tg_reject_finished_group_strap_recipe()',
    );
    expect(audit).toContain("current_setting('app.strap_change_correlation_id', true)");
    expect(audit).toContain("'correlation_id', v_correlation_id, 'actor_id', auth.uid()");
    expect(audit).toContain('supplier_id, supplier_color_code');
    expect(audit).toContain('group_id, color, active');
    expect(audit).toContain('WHEN (OLD.* IS DISTINCT FROM NEW.*)');
  });

  it('preview lê a identidade da ficha, rejeita internal e congela o snapshot', () => {
    const preview = between(
      'CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(',
      '-- 7. Backfill conservador',
    );
    expect(preview).toContain('FROM public.technical_sheets ts');
    expect(preview).toContain("e.value ->> 'technical_strap_line_id' = v_line_id::text");
    expect(preview).toContain("'technical_identity_snapshot_stale'");
    expect(preview).toContain("'identity_group_missing'");
    expect(preview).toContain("'internal_production_disabled'");
    expect(preview).toContain("v_source := 'buy_ready'");
    expect(preview).toContain(
      'v_measure_id, v_base_group_id, v_color_id, v_source, v_identity_basis',
    );
    expect(preview).toContain("'identity_basis', v_identity_basis");
    expect(preview).toContain("'identity_group_id', CASE WHEN v_identity_basis = 'finished_product_group'");
    expect(preview).toContain("'base_required_m', CASE WHEN v_source = 'internal'");
  });

  it('backfill usa somente UUIDs explícitos, não inventa catálogo e não reescreve PV histórico', () => {
    const groupIds = [
      'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
      '6e43bbda-0f1f-412c-8d4a-ec009114530d',
    ];
    const productIds = [
      '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
      'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
      '9028a544-5de5-4798-a37b-edc3b51e82f3',
      '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
      'e7056d1b-28a3-462a-b3af-f28d298194b8',
      '6e958e62-fc9d-4bdd-be01-43561adc5b36',
      'd47aaf48-644c-473d-b903-8f289270555b',
    ];
    groupIds.forEach((id) => expect(MIGRATION).toContain(id));
    productIds.forEach((id) => expect(MIGRATION).toContain(id));
    const preBackfill = MIGRATION.slice(0, MIGRATION.indexOf('-- 7. Backfill conservador'));
    const backfill = between('-- 7. Backfill conservador', '-- O produto fisico e conhecido');
    expect(preBackfill).not.toMatch(
      /^UPDATE public\.artisanal_strap_variants[\s\S]*?^\s+SET identity_basis = 'finished_product_group'/m,
    );
    expect(backfill).toMatch(
      /SET identity_basis = 'finished_product_group',[\s\S]*internal_production_enabled = false,[\s\S]*purchase_enabled = true,[\s\S]*min_stock_replenishment_mode = 'buy_ready'/,
    );
    expect(backfill).toContain('p.group_id = v.base_group_id');
    expect(backfill).toContain('array_agg(DISTINCT resolved.color_id ORDER BY resolved.color_id)');
    expect(backfill).toContain('FROM public.artisanal_strap_recipes r');
    const exactProductBackfill = between(
      '-- Quando produto/grupo/variante/cor resolvem univocamente pelos UUIDs',
      '-- Receita que ja estava cadastrada nesses grupos deixa de ser operacional',
    );
    expect(exactProductBackfill).toContain('v_previous_catalog_write text := current_setting(');
    expect(exactProductBackfill).toContain(
      "PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);",
    );
    expect(exactProductBackfill.indexOf("PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);"))
      .toBeLessThan(exactProductBackfill.indexOf('UPDATE public.products p'));
    expect(exactProductBackfill).toContain(
      "'app.artisanal_strap_catalog_write', coalesce(v_previous_catalog_write, ''), true",
    );
    expect(MIGRATION).toContain("'buy_ready_strap_product'");
    expect(MIGRATION).toContain('sem variante canonica; resolver tipo, medida e cor por UUID');
    expect(MIGRATION).not.toMatch(/UPDATE\s+public\.sale_order_items/i);
    expect(MIGRATION).not.toMatch(/(?:lower|upper)\s*\(\s*(?:p\.)?name\s*\)/i);
    expect(MIGRATION).not.toMatch(/\bILIKE\b/i);
  });

  it('falha fechado se os sete produtos e dois grupos nominais não existirem exatamente', () => {
    expect(MIGRATION).toContain('IF v_group_count <> 2 THEN');
    expect(MIGRATION).toContain('IF v_product_count <> 7 THEN');
    expect(MIGRATION).toContain('os 7 produtos UUID explicitos devem existir e pertencer aos 2 grupos decididos');
  });

  it('receitas terminais coexistem, operacionais são suspensas/bloqueadas e não impedem backfill exato', () => {
    const validator = between(
      'CREATE OR REPLACE FUNCTION public.validate_artisanal_strap_variant(',
      'CREATE OR REPLACE FUNCTION public.tg_sync_artisanal_strap_finished_product()',
    );
    expect(validator).toContain("r.status NOT IN ('superseded', 'suspended', 'archived')");
    const recipeGate = between(
      'CREATE OR REPLACE FUNCTION public.tg_reject_finished_group_strap_recipe()',
      'CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()',
    );
    expect(recipeGate).toContain("TG_OP = 'INSERT'");
    expect(recipeGate).toContain("NEW.status NOT IN ('superseded', 'suspended', 'archived')");
    const backfill = between('-- 7. Backfill conservador', '-- Vínculo canônico existente');
    expect(backfill).toContain("AND status IN ('draft', 'pending_approval', 'approved')");
    expect(backfill).toMatch(
      /NOT EXISTS \([\s\S]*FROM public\.artisanal_strap_recipes r[\s\S]*r\.status NOT IN \('superseded', 'suspended', 'archived'\)/,
    );
  });

  it('backfill ambíguo preserva status e motivo de variante archived', () => {
    const ambiguous = between('-- Vínculo canônico existente', '-- Ate este ponto');
    expect(ambiguous).toContain("status = CASE WHEN v.status = 'archived'");
    expect(ambiguous).toContain("THEN 'archived' ELSE 'review_required' END");
    expect(ambiguous).toContain("review_reason = CASE WHEN v.status = 'archived'");
    expect(ambiguous).toContain('THEN v.review_reason');
    const reviewInsert = between(
      "INSERT INTO public.artisanal_strap_migration_review_items (\n  entity_type, legacy_id, status, reason, candidates\n)\nSELECT\n  'buy_ready_strap_product'",
      '-- O diagnostico legado publicava ri.id como entity_id',
    );
    expect(reviewInsert).toContain("v.status IS DISTINCT FROM 'archived'");
  });

  it('bundle resolve de forma auditada e idempotente a review exata sem tocar fatos terminais', () => {
    const bundle = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(',
      '-- 6. Preview do PV',
    );
    expect(bundle).toContain('v_requires_identity_transition');
    expect(bundle).toContain("'app.buy_ready_strap_identity_transition'");
    expect(bundle).toContain("assert_artisanal_strap_capability('resolve_strap_migration')");
    expect(bundle).toContain("ri.entity_type = 'buy_ready_strap_product'");
    expect(bundle).toContain("ri.status = 'review_required'");
    expect(bundle).toContain("SET status = 'resolved'");
    expect(bundle).toContain("'buy_ready_strap_product_review', v_review.id, 'reconcile'");
    expect(bundle).toContain("v_variant.status = 'active'");
    expect(bundle).toContain('PERFORM public.assert_artisanal_strap_variant_activation(v_variant_id)');
    expect(bundle).toContain("d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')");
    expect(bundle).toContain("bi.status NOT IN ('completed', 'cancelled')");
    expect(bundle).not.toMatch(/UPDATE\s+public\.sale_order_items/i);
    expect(MIGRATION).toContain("'resolution_operation', 'save_artisanal_strap_catalog_bundle'");
    expect(MIGRATION).toContain("'safe_transition_supported'");

    const trigger = between(
      'CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_variant()',
      '-- O produto fisico e conhecido',
    );
    expect(trigger).toContain('v_controlled_review_transition');
    expect(trigger).toContain("OLD.status = 'review_required'");
    expect(trigger).toContain("NEW.identity_basis = 'finished_product_group'");
    expect(trigger).toContain('AND NOT v_controlled_review_transition');
  });

  it('projeta somente a review administrativa no catálogo e preserva disponibilidade real', () => {
    const projection = between(
      'CREATE OR REPLACE FUNCTION public.buy_ready_strap_review_projection(',
      '-- O override final de 03050 montava products campo a campo',
    );
    expect(projection).toContain("v_variant.status <> 'review_required'");
    expect(projection).toContain("ri.entity_type = 'buy_ready_strap_product'");
    expect(projection).toContain("'administrative_projection', true");
    expect(projection).toContain("'persisted_identity_basis', v_variant.identity_basis");
    expect(projection).toContain("'persisted_base_group_id', v_variant.base_group_id");
    expect(projection).toContain("'identity_basis', 'finished_product_group'");
    expect(projection).toContain("'base_group_id', v_product.group_id");
    expect(projection).toContain('public.artisanal_strap_variant_has_open_commitments(v_variant.id)');
    expect(projection.indexOf('public.artisanal_strap_variant_has_open_commitments(v_variant.id)'))
      .toBeLessThan(projection.indexOf("IF v_variant.identity_basis = 'reference_base' AND EXISTS"));
    expect(projection).not.toContain("'source_availability'");

    const listing = between(
      'CREATE OR REPLACE FUNCTION public.list_artisanal_strap_catalog(',
      '-- -----------------------------------------------------------------------------\n-- 3. Writer de variante',
    );
    expect(listing).toMatch(
      /to_jsonb\(v\)[\s\S]*coalesce\(projection\.data[\s\S]*'source_availability', public\.resolve_artisanal_strap_source_availability\(v\.id\)/,
    );
    expect(listing).toContain("'persisted_color', p.color");
    expect(listing).toContain("'persisted_active', p.active");
    expect(listing).toContain("THEN projection.data ->> 'projected_product_color' ELSE p.color END");
    expect(listing).toContain("CASE WHEN projection.data IS NOT NULL THEN true ELSE p.active END");
    expect(listing).toMatch(
      /ri\.entity_type = 'buy_ready_strap_product'[\s\S]*ri\.legacy_id = p\.id::text[\s\S]*ri\.candidates ->> 'product_id' = p\.id::text/,
    );

    expect(STRAP_EDITOR).toContain('const selectedIdentityBasis = selectedVariant?.identity_basis');
    expect(STRAP_EDITOR).toContain('selectedVariant?.base_group_id || baseGroupId ||');
    expect(STRAP_EDITOR).toContain('selectedVariant?.color_id || colorId ||');
    expect(STRAP_EDITOR).toContain('measure: form.measureId');
    expect(STRAP_EDITOR).toContain('color_id: form.colorId');
    expect(STRAP_EDITOR).toContain('finished_product_id: form.finishedProductId || undefined');
    expect(STRAP_EDITOR).toContain('identity_group_id: form.identityBasis === \'finished_product_group\'');
  });

  it('torna o diagnóstico buy_ready acionável sem confundir review UUID com variante', () => {
    const diagnostics = between(
      'CREATE OR REPLACE FUNCTION public.artisanal_strap_catalog_diagnostics()',
      '-- Nenhum UPDATE de sale_order_items',
    );
    expect(diagnostics).toContain("WHEN ri.entity_type='buy_ready_strap_product' AND projection.data IS NOT NULL");
    expect(diagnostics).toContain("'review_id',ri.id");
    expect(diagnostics).toContain("'review_existing_variant'");
    expect(diagnostics).toContain("'create_variant_with_bundle'");
    expect(diagnostics).toContain("'manual_creation_requires_explicit_type_and_measure',v.id IS NULL");
    expect(diagnostics).toContain('public.buy_ready_strap_review_projection(v.id)');
    expect(diagnostics).toContain("ri.legacy_id=v.finished_product_id::text");
    expect(STRAP_PAGE).toContain('const variant = catalog.variants.find((item) => item.id === issue.entity_id)');
    expect(STRAP_PAGE).toContain("migrationEntityType === 'buy_ready_strap_product'");
    expect(STRAP_PAGE).toContain("issue.details?.action_required === 'create_variant_with_bundle'");
    expect(STRAP_PAGE).toContain("issue.details?.action_required === 'clear_operational_blockers_before_review'");
    expect(STRAP_PAGE).toContain('Concilie ou encerre as demandas, lotes e compras abertas');
    expect(STRAP_PAGE).toContain("openEditor({ mode: 'review', variantId: variant.id })");
    expect(STRAP_PAGE).toContain("identityBasis: 'finished_product_group'");
    expect(STRAP_PAGE).toContain('finishedProductId: requiredFinishedProductId');
    expect(STRAP_PAGE).toContain('baseGroupId: requiredIdentityGroupId');
    expect(STRAP_PAGE).toContain('buyReadyReviewId');
    expect(STRAP_PAGE).toContain('catalog.capabilities.resolve_strap_migration');
    expect(STRAP_EDITOR).toContain("identityBasis === 'finished_product_group' ? finishedProductId : null");
    expect(STRAP_EDITOR).toContain('const exactBuyReadyProductPrefill = mode === \'create\'');
    expect(STRAP_EDITOR).toContain('product.id === finishedProductId && product.group_id === baseGroupId');
    expect(STRAP_EDITOR).toContain('product.active !== false || product.id === form.finishedProductId');
    expect(STRAP_EDITOR).toMatch(
      /availableIdentityColors = form\.identityBasis === 'finished_product_group'[\s\S]*exactBuyReadyProductPrefill[\s\S]*catalog\.colors[\s\S]*\.filter\(\(item\) => item\.active\)/,
    );
    expect(STRAP_EDITOR).toContain('&& !exactBuyReadyProductPrefill\n      && canonicalStrapColorForProduct');
    expect(STRAP_EDITOR).toContain('Selecione explicitamente a família, a medida e a cor canônica');
    expect(STRAP_EDITOR).toContain("form.identityBasis === 'finished_product_group' && !exactBuyReadyProductPrefill");
    expect(STRAP_EDITOR).toMatch(
      /status: \(mode === 'review' && variant\) \|\| exactBuyReadyProductPrefill[\s\S]*\? 'active'/,
    );
    expect(STRAP_PAGE).toContain('Cadastrar tira comprada');
  });

  it('bloqueia ativação com review comprometida e job interno congelado após a transição', () => {
    const validator = between(
      'CREATE OR REPLACE FUNCTION public.validate_artisanal_strap_variant(',
      'CREATE OR REPLACE FUNCTION public.tg_sync_artisanal_strap_finished_product()',
    );
    expect(validator).toContain("v_variant.status = 'active'");
    expect(validator).toContain("ri.entity_type = 'buy_ready_strap_product'");
    expect(validator).toContain('public.artisanal_strap_variant_has_open_commitments(v_variant.id)');
    expect(validator).toContain('nao pode ser ativada enquanto a review possui compromissos');

    const frozenJobGate = between(
      'CREATE OR REPLACE FUNCTION public.tg_enforce_strap_internal_source_capability()',
      '-- O produto fisico e conhecido',
    );
    expect(frozenJobGate).toContain("'strap-variant-capability:' || NEW.strap_variant_id::text");
    expect(frozenJobGate).toContain('FOR KEY SHARE');
    expect(frozenJobGate).toContain("NEW.source_mode IS DISTINCT FROM 'internal'");
    expect(frozenJobGate).toContain("v_variant.identity_basis <> 'reference_base'");
    expect(frozenJobGate).toContain("USING ERRCODE = '40001'");
    expect(frozenJobGate.match(/CREATE TRIGGER trg_enforce_strap_internal_source_capability/g)?.length).toBe(2);
    expect(frozenJobGate).toContain('CREATE OR REPLACE FUNCTION public.tg_enforce_strap_job_source_capability()');
    expect(frozenJobGate).toContain('BEFORE INSERT OR UPDATE OF payload');
    expect(frozenJobGate).toContain('Payload de job interno ficou obsoleto');
    expect(frozenJobGate).toContain("j.status IN ('queued', 'retry', 'processing', 'dead_letter')");
    expect(frozenJobGate).toContain('FOR UPDATE SKIP LOCKED');
    expect(frozenJobGate).toContain("SET status = 'cancelled'");
    expect(frozenJobGate).toContain("j.status = 'processing'");
    expect(frozenJobGate).toContain("SET status = 'review_required'");
    expect(MIGRATION).toContain("'strap-variant-capability:' || p_id::text");
    expect(MIGRATION).toContain("'strap-variant-capability:' || v_requested_variant_id::text");

    const bundle = between(
      'CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(',
      '-- 6. Preview do PV',
    );
    expect(bundle).toContain("j.status IN ('queued', 'retry', 'processing', 'dead_letter')");
    expect(bundle).toContain('FOR UPDATE NOWAIT');
    expect(bundle).toContain("'cancelled_reason', 'buy_ready_identity_transition'");
    expect(bundle).toContain('public.enqueue_sale_order_strap_demands(');
    expect(bundle).toContain("'replacement_enqueued', true");
    expect(bundle).toContain("'replacement_variant_ids'");
    expect(bundle).toContain("jsonb_build_array(v_variant.id::text)");
    expect(bundle).toContain("'replacement_jobs'");
    expect(bundle).toContain("ELSE 'buy_ready_identity_resolved'");
    expect(bundle).not.toContain("SET status = 'dead_letter'");

    const workerFailureGuard = between(
      'CREATE OR REPLACE FUNCTION public.tg_cancel_stale_internal_strap_job_failure()',
      '-- Job processing pode deter sua propria linha',
    );
    expect(workerFailureGuard).toContain("OLD.status = 'processing' AND NEW.status IN ('retry', 'dead_letter')");
    expect(workerFailureGuard).toContain("OLD.status = 'dead_letter' AND NEW.status = 'retry'");
    expect(workerFailureGuard).toContain("NEW.status := 'cancelled'");
    expect(workerFailureGuard).toContain("'cancelled_by_worker_guard', true");
    expect(workerFailureGuard).toContain("'attempted_failure_status', v_attempted_status");
    expect(workerFailureGuard).toContain('stale_variant_ids');
    expect(workerFailureGuard).toContain('CREATE TRIGGER trg_audit_stale_internal_strap_job_cancellation');
    expect(workerFailureGuard).toContain('CREATE TRIGGER trg_suppress_stale_strap_job_retry_audit');
    expect(workerFailureGuard).toContain("NEW.action IN ('retry', 'dead_letter')");
    expect(workerFailureGuard).toContain('RETURN NULL');
    expect(frozenJobGate).toContain("j.status IN ('queued', 'retry', 'processing', 'dead_letter')");
    expect(frozenJobGate).toContain("'cancelled_from_status', stale.previous_status");
    expect(frozenJobGate).toContain("'cancelled_last_error', stale.previous_last_error");
    const exactBackfill = between(
      '-- Variantes que ja possuem a identidade estrutural inequivoca sao convertidas.',
      '-- Vínculo canônico existente',
    );
    expect(exactBackfill.match(
      /j\.status IN \('queued', 'retry', 'processing', 'dead_letter'\)/g,
    )?.length).toBe(2);
    expect(exactBackfill).toContain("line.value ->> 'strap_variant_id' = v.id::text");
    expect(MIGRATION).toContain('WITH inspectable_jobs AS MATERIALIZED');
    expect(MIGRATION).toContain("candidate.status IN ('queued', 'retry', 'dead_letter')");
    expect(MIGRATION).toContain('Job internal obsoleto permaneceu em queued/retry/dead_letter');
  });

  it('preserva facts, bloqueia mutação insegura e fecha ACL dos helpers', () => {
    const trigger = between(
      'CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_variant()',
      '-- O produto fisico e conhecido',
    );
    expect(trigger).toContain('NEW.identity_basis IS DISTINCT FROM OLD.identity_basis');
    expect(trigger).toContain('Capacidade produtiva nao pode mudar com compromissos operacionais abertos');
    expect(trigger).toContain('sale_order_strap_demands');
    expect(trigger).toContain('strap_production_batch_items');
    expect(MIGRATION).toContain("'strap-recipe-identity:'");
    expect(MIGRATION).toContain('Validator de variante nao pode executar BEFORE INSERT');
    expect(MIGRATION).toContain('FROM PUBLIC, anon, authenticated');
    expect(MIGRATION).toContain("has_function_privilege(\n       'anon'");
    expect(MIGRATION).not.toMatch(/^BEGIN;$/m);
    expect(MIGRATION).not.toMatch(/^COMMIT;$/m);
  });

  it('fecha nominalmente os UUIDs STRASS contra writer legado, receita e is_artisanal', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.is_buy_ready_strass_identity(');
    expect(MIGRATION).toContain('STRASS por UUID explicito exige identity_basis=finished_product_group');
    expect(MIGRATION).toContain('Nova variante STRASS por UUID explicito exige finished_product_group');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.tg_enforce_buy_ready_strass_product()');
    expect(MIGRATION).toContain('Produto STRASS por UUID explicito deve permanecer is_artisanal=false');
    const recipeGuard = between(
      'CREATE OR REPLACE FUNCTION public.tg_reject_finished_group_strap_recipe()',
      'CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()',
    );
    expect(recipeGuard).toContain('public.is_buy_ready_strass_identity(NULL, NEW.base_group_id)');
    expect(recipeGuard).toContain("NEW.status NOT IN ('superseded', 'suspended', 'archived')");
    expect(recipeGuard).toContain('BEFORE INSERT OR UPDATE');
    expect(MIGRATION).toContain(
      'Linha STRASS por UUID explicito exige finished_product_group e identity_group_id exato',
    );
    expect(MIGRATION).toContain('Gate nominal STRASS permite somente compra pronta');
  });
});
