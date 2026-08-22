import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  materialLabelKey,
  resolveMaterialLabels,
} from '@/lib/labelUtils';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20270101004300_material_variant_commercial_identity.sql');
const emitNfe = read('supabase/functions/emit-nfe/index.ts');
const emitNfeDevolucao = read('supabase/functions/emit-nfe-devolucao/index.ts');
const clickNotasIdentity = read('supabase/functions/_shared/clickNotasProductIdentity.ts');
const productForm = read('src/components/inventory/ProductFormDialog.tsx');
// Renomeado em 22/08/2026: o `MasterVariantDialog` virou painel da janela do
// grupo de estoque (`VariantListPanel`/`VariantBulkEditPanel`).
const masterVariant = read('src/components/inventory/VariantManagerPanel.tsx');
const materialVariants = read('src/components/technical-sheets/MaterialVariantsTab.tsx');
const labelProduction = read('src/components/label-system/LabelProductionTab.tsx');
const productDetail = read('src/pages/ProductDetail.tsx');

describe('identidade comercial da variante de material', () => {
  it('impõe SKU ativo e unicidade normalizada sem reescrever histórico', () => {
    expect(migration).toContain('reference_material_variants_active_sku_ck');
    expect(migration).toContain('lower(btrim(sku))');
    expect(migration).toContain('Não é possível criar a unicidade global de SKU');
    expect(migration).toContain('nenhum histórico será renomeado automaticamente');
    expect(migration).not.toMatch(/UPDATE\s+public\.reference_material_variants\s+SET\s+sku/iu);
    expect(materialVariants).toContain('findMaterialVariantSkuCollision');
    expect(materialVariants).toContain('SKU é obrigatório para variante ativa');
  });

  it('amarra BOM específico à variante da mesma ficha sem apagar em cascata', () => {
    expect(migration).toContain('sheet_materials_material_variant_same_sheet_fkey');
    expect(migration).toContain('FOREIGN KEY (material_variant_id, sheet_id)');
    expect(migration).toContain('REFERENCES public.reference_material_variants(id, reference_id)');
    const compositeFk = migration.split('sheet_materials_material_variant_same_sheet_fkey')[1]
      ?.split('COMMENT ON CONSTRAINT')[0] || '';
    expect(compositeFk).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('Há linhas de BOM específicas ligadas a variante de outra ficha');
  });

  it('amarra o item do PV à variante da mesma referência sem inferir correção histórica', () => {
    expect(migration).toContain('sale_order_items_material_variant_same_reference_fkey');
    expect(migration).toContain('FOREIGN KEY (material_variant_id, reference_id)');
    expect(migration).toContain('REFERENCES public.reference_material_variants(id, reference_id)');
    const compositeFk = migration.split('ADD CONSTRAINT sale_order_items_material_variant_same_reference_fkey')[1]
      ?.split('COMMENT ON CONSTRAINT')[0] || '';
    expect(compositeFk).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('há itens de PV com vínculo cruzado ou órfão');
    expect(migration).toContain('A migration não troca referência nem variante e não reescreve histórico.');
    const diagnostic = migration.split('há itens de PV com vínculo cruzado ou órfão')[0]
      ?.split('DO $$').at(-1) || '';
    expect(diagnostic).not.toMatch(/UPDATE\s+public\.sale_order_items/iu);
  });

  it('restringe escrita de variantes aos papéis canônicos de gestão do catálogo', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_insert_ref_mat_variants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_update_ref_mat_variants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_delete_ref_mat_variants"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_select"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_insert"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_update"');
    expect(migration).toContain('DROP POLICY IF EXISTS "approved_delete"');

    const firstNewPolicy = migration.indexOf('CREATE POLICY reference_material_variants_select_approved');
    for (const permissivePolicy of [
      '"approved_insert_ref_mat_variants"',
      '"approved_update_ref_mat_variants"',
      '"approved_delete_ref_mat_variants"',
      '"approved_select"',
      '"approved_insert"',
      '"approved_update"',
      '"approved_delete"',
    ]) {
      const dropAt = migration.indexOf(`DROP POLICY IF EXISTS ${permissivePolicy}`);
      expect(dropAt).toBeGreaterThan(-1);
      expect(dropAt).toBeLessThan(firstNewPolicy);
    }

    const selectPolicy = migration.split('CREATE POLICY reference_material_variants_select_approved')[1]
      ?.split('CREATE POLICY reference_material_variants_catalog_write')[0] || '';
    expect(selectPolicy).toContain('FOR SELECT TO authenticated');
    expect(selectPolicy).toContain('public.is_approved_user()');

    const writePolicy = migration.split('CREATE POLICY reference_material_variants_catalog_write')[1]
      ?.split('-- =============================================================================')[0] || '';
    expect(writePolicy).toContain('FOR ALL TO authenticated');
    expect(writePolicy).toContain('public.user_has_any_role');
    expect(writePolicy).toContain("ARRAY['admin'::text, 'gerente'::text]");
    expect(writePolicy).toContain('WITH CHECK');
    expect(writePolicy.match(/public\.is_approved_user\(\)/g)).toHaveLength(2);

    expect(migration).toContain("p.policyname::text <> ALL (ARRAY[");
    expect(migration).toContain("'reference_material_variants_select_approved'");
    expect(migration).toContain("'reference_material_variants_catalog_write'");
    expect(migration).toContain('Policies RLS inesperadas em reference_material_variants.');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.reference_material_variants\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE\n  ON TABLE public.reference_material_variants TO authenticated;',
    );
    expect(migration).toContain(
      'GRANT ALL ON TABLE public.reference_material_variants TO service_role;',
    );
  });

  it('normaliza código do fornecedor e distingue troca explícita A/001 → B/001', () => {
    expect(migration).toContain('supplier_color_code := NULLIF(btrim');
    expect(migration).toContain('products_supplier_color_code_requires_supplier_ck');
    expect(migration).toContain('NEW.supplier_id IS DISTINCT FROM OLD.supplier_id');
    expect(migration).toContain('BEFORE UPDATE OF supplier_color_code');
    expect(migration).toContain("'app.product_supplier_color_code_explicit_id'");
    expect(migration).toContain('v_code_was_explicit');
    expect(migration).toContain('AND COALESCE(');
    expect(migration).not.toContain('supplier_color_code_write_explicit');
    const markPosition = migration.indexOf('trg_aa_mark_product_supplier_color_code_explicit');
    const normalizePosition = migration.indexOf('trg_mm_normalize_product_supplier_color_code');
    const resetPosition = migration.indexOf('trg_zz_reset_product_supplier_color_code_explicit');
    expect(markPosition).toBeGreaterThan(-1);
    expect(normalizePosition).toBeGreaterThan(markPosition);
    expect(resetPosition).toBeGreaterThan(normalizePosition);
    expect(migration).not.toContain('UNIQUE (supplier_color_code)');
    expect(productForm).toContain('Código da cor no fornecedor');
    expect(productForm).toContain('supplier_color_code: null');
    expect(masterVariant).toContain('não é copiado pras outras variantes');
    expect(masterVariant).toContain('payload.supplier_color_code = null');
  });

  it('integra o código da cor no editor individual e limpa ao trocar fornecedor', () => {
    expect(productDetail).toContain('supplier_color_code: rest.supplier_color_code || null');
    expect(productDetail).toContain('Código da cor no fornecedor');
    expect(productDetail).toContain('supplier_color_code: null');
    expect(productDetail).toContain('Selecione o fornecedor antes de informar o código da cor.');
    expect(productDetail).toContain('disabled={!form.supplier_id}');
  });

  it('congela os quatro termos contratuais após aprovação sem bloquear updates operacionais', () => {
    const freeze = migration.split("IF TG_OP = 'UPDATE' AND NOT v_contract_editable THEN")[1]
      ?.split('END IF;')[0] || '';
    for (const field of ['reference_id', 'material_variant_id', 'color', 'unit_price']) {
      expect(freeze).toContain(field);
    }
    for (const operational of ['quantity', 'grade', 'fichas', 'qty_devolvida', 'observation']) {
      expect(freeze).not.toContain(`NEW.${operational}`);
    }
    expect(migration).toContain("IN ('Rascunho', 'Pendente')");
    expect(migration).toContain('NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id');
    expect(migration).toContain('O vínculo sale_order_id do item do PV é imutável.');
    expect(migration).toContain('NEW.material_variant_commercial_snapshot := OLD.material_variant_commercial_snapshot');
    expect(migration).toContain("material_variant_commercial_snapshot ? 'material_variant_id'");
    expect(migration).toContain("material_variant_commercial_snapshot ? 'unit_price'");
    expect(migration).toContain("'identity_source', 'legacy_current_catalog'");
    expect(migration).toContain("'historical_truth', 'unknown'");
  });

  it('reconstrói NCM/descrição efetivos na confirmação e não aciona efeitos colaterais', () => {
    expect(migration).toContain('build_material_variant_commercial_snapshot');
    expect(migration).toContain("'header_confirmation'");
    expect(migration).toContain("ELSE 'technical_sheets.ncm'");
    expect(migration).toContain(
      "ELSE 'technical_sheets.name+reference_material_variants.material_name+sale_order_items.color'",
    );
    expect(migration).toContain("NULLIF(btrim(COALESCE(v_variant.material_name, '')), '')");
    expect(migration).toContain('trg_aa_capture_material_variant_snapshots_on_confirmation');
    expect(migration).toContain('BEFORE UPDATE OF status');
    expect(migration).toMatch(
      /UPDATE public\.sale_order_items soi\s+SET material_variant_commercial_snapshot = soi\.material_variant_commercial_snapshot/iu,
    );

    for (const trigger of [
      'trg_sync_sale_order_total',
      'trg_mark_so_costs_dirty_from_item',
      'trg_mark_reservations_outdated_from_item',
      'trg_sync_orders_from_sale_order_item',
      'trg_enqueue_strap_demands_on_item_change',
    ]) {
      const updateTrigger = `${trigger}_on_update`;
      const definition = migration.split(`CREATE${trigger.includes('enqueue') ? ' CONSTRAINT' : ''} TRIGGER ${updateTrigger}`)[1]
        ?.split('EXECUTE FUNCTION')[0] || '';
      expect(definition).toContain('AFTER UPDATE');
      expect(definition).toContain('pg_trigger_depth() > 0');
      expect(definition).toContain('app.material_variant_snapshot_confirmation_order_id');
      expect(definition).toContain('app.material_variant_snapshot_review_item_id');
      expect(definition).toContain("to_jsonb(OLD) - 'material_variant_commercial_snapshot'");
      expect(definition).toContain("to_jsonb(NEW) - 'material_variant_commercial_snapshot'");
      expect(definition).toContain('= NEW.sale_order_id::text');
      expect(definition).toContain('= NEW.id::text');
    }

    for (const trigger of [
      'trg_sync_sale_order_total',
      'trg_mark_so_costs_dirty_from_item',
      'trg_mark_reservations_outdated_from_item',
      'trg_enqueue_strap_demands_on_item_change',
    ]) {
      const baseDefinition = migration.split(`CREATE${trigger.includes('enqueue') ? ' CONSTRAINT' : ''} TRIGGER ${trigger}\n`)[1]
        ?.split('EXECUTE FUNCTION')[0] || '';
      expect(baseDefinition).toContain('AFTER INSERT OR DELETE');
    }
    const syncOrdersBase = migration.split('CREATE TRIGGER trg_sync_orders_from_sale_order_item\n')[1]
      ?.split('EXECUTE FUNCTION')[0] || '';
    expect(syncOrdersBase).toContain('AFTER INSERT');

    const totalSplit = migration.split('-- O trigger de total não existe em todas as instalações legadas.')[1]
      ?.split('DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_item')[0] || '';
    expect(totalSplit).toContain("trigger_catalog.tgname = 'trg_sync_sale_order_total'");
    expect(totalSplit).toContain("to_regprocedure('public.fn_sync_sale_order_total()') IS NOT NULL");
    expect(totalSplit).toContain('IF v_original_enabled_mode IS NOT NULL');
    expect(totalSplit).toContain("WHEN 'R' THEN 'ENABLE REPLICA'");
    expect(totalSplit).toContain("WHEN 'A' THEN 'ENABLE ALWAYS'");
    expect(totalSplit).toContain("WHEN 'D' THEN 'DISABLE'");
    expect(migration).not.toMatch(
      /^DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public\.sale_order_items;$/mu,
    );
    expect(migration).not.toMatch(
      /^CREATE TRIGGER trg_sync_sale_order_total$/mu,
    );

    const backfillStart = migration.indexOf('WITH legacy_snapshots AS');
    const backfillEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.capture_sale_order_item_material_variant_snapshot');
    const backfillSection = migration.slice(0, backfillEnd);
    expect(backfillSection).toContain("FROM pg_catalog.pg_trigger trigger_catalog");
    expect(backfillSection).toContain("trigger_catalog.tgrelid = 'public.sale_order_items'::regclass");
    expect(backfillSection).toContain("trigger_catalog.tgenabled <> 'D'");
    expect(backfillSection).toContain('INTO v_enabled_trigger_names, v_enabled_trigger_modes');
    expect(backfillSection).toContain('array_agg(');
    expect(backfillSection).toContain("WHEN 'R' THEN 'ENABLE REPLICA'");
    expect(backfillSection).toContain("WHEN 'A' THEN 'ENABLE ALWAYS'");
    expect(backfillSection).not.toMatch(
      /ALTER TABLE public\.sale_order_items DISABLE TRIGGER trg_/u,
    );
    for (const trigger of [
      'trg_sync_sale_order_total',
      'trg_mark_so_costs_dirty_from_item',
      'trg_mark_reservations_outdated_from_item',
      'trg_sync_orders_from_sale_order_item',
      'trg_enqueue_strap_demands_on_item_change',
    ]) {
      expect(backfillSection).toContain(`'${trigger}'`);
    }
    expect(backfillSection.indexOf('FROM pg_catalog.pg_trigger trigger_catalog'))
      .toBeLessThan(backfillStart);
    expect(backfillSection.indexOf("'ALTER TABLE public.sale_order_items DISABLE TRIGGER %I'"))
      .toBeLessThan(backfillStart);
    expect(backfillSection.indexOf("'ALTER TABLE public.sale_order_items %s TRIGGER %I'"))
      .toBeGreaterThan(backfillStart);
  });

  it('só confirma variante ativa, da própria referência e com SKU, preservando backfill legado', () => {
    expect(migration).toContain('reference_material_variants_sku_length_ck');
    expect(migration).toContain('char_length(sku) <= 80');
    expect(migration).toContain('existem SKUs com mais de 80 caracteres');
    expect(migration).toContain('Nenhum SKU será truncado automaticamente');
    expect(materialVariants).toContain('maxLength={MATERIAL_VARIANT_SKU_MAX_LENGTH}');
    expect(materialVariants).toContain('no máximo ${MATERIAL_VARIANT_SKU_MAX_LENGTH} caracteres');

    const builder = migration.split(
      'CREATE OR REPLACE FUNCTION public.build_material_variant_commercial_snapshot(',
    )[1]?.split('COMMENT ON FUNCTION public.build_material_variant_commercial_snapshot')[0] || '';
    expect(builder).toContain("p_capture_reason <> 'migration_backfill_requires_review'");
    expect(builder).toContain('v_variant.reference_id IS DISTINCT FROM p_reference_id');
    expect(builder).toContain('NOT COALESCE(v_variant.active, false)');
    expect(builder).toContain("NULLIF(btrim(COALESCE(v_variant.sku, '')), '') IS NULL");

    const confirmation = migration.split(
      'CREATE OR REPLACE FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation()',
    )[1]?.split('COMMENT ON FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation')[0] || '';
    expect(confirmation).toContain('variante pertence a outra referência');
    expect(confirmation).toContain('variante inativa');
    expect(confirmation).toContain('variante sem SKU comercial');
    expect(confirmation).toContain('selecione uma variante ativa da própria referência com SKU cadastrado');
    expect(confirmation).toContain('o snapshot comercial final ficou sem SKU');

    const snapshotCheck = migration.split('ADD CONSTRAINT sale_order_items_material_variant_snapshot_ck')[1]
      ?.split('END;')[0] || '';
    expect(snapshotCheck).toContain("historical_truth}' = 'unknown'");
    expect(snapshotCheck).toContain("material_variant_commercial_snapshot ->> 'sku'");
    expect(snapshotCheck).toContain('char_length(btrim(COALESCE(');
    expect(snapshotCheck).toContain('))) <= 80');
  });

  it('oferece preview/CAS auditado para revisar legado sem consultar catálogo vivo', () => {
    const review = migration.split(
      'CREATE OR REPLACE FUNCTION public.review_legacy_material_variant_commercial_snapshot(',
    )[1]?.split('COMMENT ON FUNCTION public.review_legacy_material_variant_commercial_snapshot')[0] || '';

    expect(review).toContain('p_apply boolean DEFAULT false');
    expect(review).toContain("ARRAY['admin', 'gerente', 'comercial']");
    expect(review).toContain('NOT COALESCE(public.is_approved_user(), false)');
    expect(review).toContain('public.user_has_any_role');
    expect(review).toContain('char_length(v_reason) < 15');
    expect(review).toContain('char_length(v_sku) > 80');
    expect(review).toContain('O SKU atestado deve ter no máximo 80 caracteres.');
    expect(review).toContain('o snapshot legado não será truncado automaticamente.');
    expect(review).toContain('p_expected_snapshot IS DISTINCT FROM v_item.material_variant_commercial_snapshot');
    expect(review).toContain("'historical_truth', 'reviewed'");
    expect(review).toContain("'identity_source', 'explicit_commercial_review'");
    expect(review).toContain("'reviewed_by', auth.uid()");
    expect(review).toContain("'review_reason', v_reason");
    expect(review).toContain("'color', NULLIF(btrim(COALESCE(v_item.color, '')), '')");
    expect(review).toContain("'unit_price', v_item.unit_price");
    expect(review).toContain("'before', v_item.material_variant_commercial_snapshot");
    expect(review).toContain("'proposed', v_proposed_snapshot");
    expect(review).toContain("'next_step', CASE");
    expect(review).toContain("'app.material_variant_snapshot_review_item_id'");
    expect(review).toContain("supplied.key NOT IN ('material_name', 'sku', 'gtin', 'ncm', 'description')");
    expect(review).not.toContain('FROM public.reference_material_variants');
    expect(review).not.toContain('FROM public.technical_sheets');

    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(uuid, jsonb, jsonb, text, boolean)\n  FROM PUBLIC, anon;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(uuid, jsonb, jsonb, text, boolean)\n  TO authenticated;',
    );
  });

  it('mantém helpers de trigger fora da superfície RPC', () => {
    for (const helper of [
      'normalize_product_supplier_color_code',
      'mark_product_supplier_color_code_explicit',
      'reset_product_supplier_color_code_explicit',
      'normalize_reference_material_variant_sku',
      'capture_sale_order_item_material_variant_snapshot',
      'capture_material_variant_snapshots_on_sale_order_confirmation',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${helper}()`);
    }
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.build_material_variant_commercial_snapshot(uuid, uuid, text, numeric, text)',
    );
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('serializa produto ClickNotas por SKU antes do POST e falha fechado após resultado ambíguo', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.clicknotas_product_identity_registry');
    expect(migration).toContain('PRIMARY KEY (identity_kind, identity_key)');
    expect(migration).toContain("state text NOT NULL DEFAULT 'resolving'");
    expect(migration).toContain("state IN ('resolving', 'posting')");
    expect(migration).toContain("state IN ('retryable', 'reconcile_required', 'conflict')");
    expect(migration).toContain('uq_clicknotas_product_identity_provider_id');
    expect(migration).toContain('WHERE provider_id IS NOT NULL');

    const claim = migration.split(
      'CREATE OR REPLACE FUNCTION public.claim_clicknotas_product_identity(',
    )[1]?.split('CREATE OR REPLACE FUNCTION public.begin_clicknotas_product_post(')[0] || '';
    expect(claim).toContain('ON CONFLICT (identity_kind, identity_key) DO NOTHING');
    expect(claim).toContain('FOR UPDATE');
    expect(claim).toContain("v_kind = 'material_variant_sku'");
    expect(claim).toContain("v_row.state = 'posting'");
    expect(claim).toContain("SET state = 'reconcile_required'");
    expect(claim).toContain("'outcome', 'reconcile_required'");
    const takeover = claim.split('Somente resolving expirado')[1] || '';
    expect(takeover).toContain("SET state = 'resolving'");
    expect(takeover).not.toContain('technical_name =');

    const beginPost = migration.split(
      'CREATE OR REPLACE FUNCTION public.begin_clicknotas_product_post(',
    )[1]?.split('CREATE OR REPLACE FUNCTION public.complete_clicknotas_product_identity(')[0] || '';
    expect(beginPost).toContain("SET state = 'posting'");
    expect(beginPost).toContain('post_started_at = clock_timestamp()');
    expect(beginPost).toContain('owner_token IS DISTINCT FROM p_owner_token');
    expect(beginPost).toContain('lease_generation IS DISTINCT FROM p_lease_generation');

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.reconcile_clicknotas_product_identity(');
    expect(migration).toContain('reset_clicknotas_product_identity_after_verified_absence');
    expect(migration).toContain('Somente identidade reconcile_required pode ser liberada');
    expect(migration).toContain('REVOKE ALL ON TABLE public.clicknotas_product_identity_registry');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    for (const rpc of [
      'claim_clicknotas_product_identity(text, text, text, uuid, text, integer)',
      'begin_clicknotas_product_post(text, text, uuid, bigint)',
      'complete_clicknotas_product_identity(text, text, uuid, bigint, text)',
      'record_clicknotas_product_identity_outcome(text, text, uuid, bigint, text, text, integer)',
      'reconcile_clicknotas_product_identity(text, text, text, text, text, text)',
      'reset_clicknotas_product_identity_after_verified_absence(text, text, text, text)',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${rpc}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${rpc}`);
    }

    for (const edge of [emitNfe, emitNfeDevolucao]) {
      expect(edge).toContain("'material_variant_sku'");
      expect(edge).toContain("'claim_clicknotas_product_identity'");
      expect(edge).toContain("'begin_clicknotas_product_post'");
      expect(edge).toContain("'record_clicknotas_product_identity_outcome'");
      expect(edge).toContain("'reconcile_clicknotas_product_identity'");
      expect(edge).toContain("if (!lookup.ok || lookup.json?.status === 'error')");
      const claimAt = edge.indexOf("'claim_clicknotas_product_identity'");
      const beginAt = edge.indexOf("'begin_clicknotas_product_post'", claimAt);
      const postAt = edge.indexOf('gcFetch("/produtos", {', beginAt);
      expect(claimAt).toBeGreaterThan(-1);
      expect(beginAt).toBeGreaterThan(claimAt);
      expect(postAt).toBeGreaterThan(beginAt);
    }
    expect(emitNfe).toContain('const identityValue = hasMaterialVariant ? codigoNf : nomeProdutoCadastro');
    expect(emitNfeDevolucao).toContain('const identityValue = it.material_variant_id ? it.product_code : it.technical_product_name');
    expect(emitNfe).toContain('nome_produto: nomeProduto');
    expect(emitNfeDevolucao).toContain('nome_produto: it.product_name');
  });

  it('NF e devolução usam snapshot + preço do item, nunca variante viva', () => {
    expect(emitNfe).toContain('material_variant_commercial_snapshot');
    expect(emitNfe).toContain('Number(it.unit_price ?? 0)');
    expect(emitNfe).toContain('variant?.gtin');
    expect(emitNfe).toContain('hasMaterialVariant ? variant?.ncm');
    expect(emitNfe).toContain("? String(variant?.description || '')");
    expect(emitNfe).not.toContain('variant?.ncm || ts?.ncm');
    expect(emitNfe).not.toContain('reference_material_variants(');
    expect(emitNfe).not.toContain('unit_price_override');
    expect(emitNfe).toContain("provenance?.historical_truth === 'unknown'");
    expect(emitNfe).toContain('review_legacy_material_variant_commercial_snapshot');
    expect(emitNfe).toContain('p_apply=false (preview)');
    expect(emitNfe).toContain('O catálogo atual não será tratado como verdade histórica.');
    expect(emitNfe).toContain('buildClickNotasTechnicalProductName(desc, codigoNf)');
    expect(emitNfe).toContain('encodeURIComponent(nomeProdutoCadastro)');
    expect(emitNfe).toContain('resolveClickNotasProductIdentity(');
    expect(emitNfe).toContain('nomeProdutoCadastro,');
    expect(emitNfe).toContain("gcStatus = 'found_by_identity'");
    expect(emitNfe).toContain('Conflito de identidade no ClickNotas');
    expect(emitNfe).toContain('nome: technicalName');
    expect(emitNfe).toContain('nome_produto: nomeProduto');
    expect(emitNfe).toContain('codigo_produto: codigoNf');
    expect(emitNfe).not.toMatch(/foundList\.find\s*\(/u);

    expect(emitNfeDevolucao).toContain('material_variant_commercial_snapshot');
    expect(emitNfeDevolucao).toContain('Number(item.unit_price ?? 0)');
    expect(emitNfeDevolucao).toContain('gc_product_id: hasMaterialVariant');
    expect(emitNfeDevolucao).toContain('? originalGcProductId');
    expect(emitNfeDevolucao).toContain('product_code: productCode');
    expect(emitNfeDevolucao).toContain('product_name: productName');
    expect(emitNfeDevolucao).toContain('technical_product_name: technicalProductName');
    expect(emitNfeDevolucao).toContain('nfeOriginal.gc_request_payload?.produtos');
    expect(emitNfeDevolucao).toContain('originalIdentityMatches');
    expect(emitNfeDevolucao).toContain('originalCodeMatches.length === 1');
    expect(emitNfeDevolucao).toContain('resolveClickNotasProductIdentity(');
    expect(emitNfeDevolucao).toContain('it.technical_product_name,');
    expect(emitNfeDevolucao).toContain('nome: technicalName');
    expect(emitNfeDevolucao).toContain('Conflito de identidade no ClickNotas');
    expect(emitNfeDevolucao).toContain('if (!it.material_variant_id && it.ts_id)');
    expect(emitNfeDevolucao).toContain('nome_produto: it.product_name');
    expect(emitNfeDevolucao).toContain('codigo_produto: it.product_code');
    expect(emitNfeDevolucao).not.toContain('reference_material_variants(');
    expect(emitNfeDevolucao).not.toContain('unit_price_override');
    expect(emitNfeDevolucao).toContain("variant?.provenance?.historical_truth === 'unknown'");
    expect(emitNfeDevolucao).toContain('review_legacy_material_variant_commercial_snapshot');
    expect(emitNfeDevolucao).toContain('p_apply=false (preview)');
    expect(emitNfeDevolucao).toContain('O catálogo atual não será tratado como verdade histórica.');

    expect(clickNotasIdentity).toContain('buildClickNotasTechnicalProductName');
    expect(clickNotasIdentity).toContain('const suffix = ` [SKU:${sku}]`;');
    expect(clickNotasIdentity).toContain('CLICKNOTAS_PRODUCT_NAME_MAX_LENGTH - suffix.length');
    expect(clickNotasIdentity).toContain('candidateName(candidate) === normalizedName');
    expect(clickNotasIdentity).toContain('reason: "ambiguous_identity"');
    expect(clickNotasIdentity).not.toContain('candidate.codigo');
    expect(clickNotasIdentity).not.toContain('candidate.sku');
    expect(clickNotasIdentity).not.toMatch(/exactNameMatches\[0\].*exactNameMatches\.length\s*>\s*1/su);
  });

  it('etiqueta usa nomes congelados e não mistura snapshots históricos', async () => {
    const soft = {
      referenceId: 'ref-1',
      materialVariantId: 'variant-1',
      color: 'OFF WHITE',
      materialVariantCommercialSnapshot: { material_name: 'NAPA SOFT' },
    };
    const madri = {
      ...soft,
      materialVariantCommercialSnapshot: { material_name: 'NAPA MADRI' },
    };
    const labels = await resolveMaterialLabels([soft, madri]);
    expect(materialLabelKey(soft)).not.toBe(materialLabelKey(madri));
    expect(labels.get(materialLabelKey(soft))).toBe('NAPA SOFT');
    expect(labels.get(materialLabelKey(madri))).toBe('NAPA MADRI');
    expect(labelProduction).toContain('material_variant_commercial_snapshot');
    expect(labelProduction).toContain('materialNameFromCommercialSnapshot');
  });
});
