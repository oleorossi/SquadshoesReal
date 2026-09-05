import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20270101005050_resolve_s039_strap_catalog.sql');
const autoIntentMigration = read('supabase/migrations/20270101005500_auto_internal_strap_intent_from_pv.sql');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const strapReconciler = read('src/lib/reconcileStrapSnapshots.ts');
const drawer = read('src/components/sale-orders/StrapCatalogResolutionDrawer.tsx');
const editor = read('src/components/artisanal-straps/ArtisanalStrapEditor.tsx');
const createDialog = read('src/components/sale-orders/CreateStrapProductDialog.tsx');
const hooks = read('src/hooks/useArtisanalStraps.ts');
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const saleOrders = read('src/pages/SaleOrders.tsx');
const mobileNewOrder = read('src/pages/mobile/MobileNewOrder.tsx');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir na migration`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  expect(start, `${startMarker} deve existir`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} deve existir depois de ${startMarker}`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

const occurrences = (source: string, token: string) => source.split(token).length - 1;

describe('S-039 — resolução canônica das tiras', () => {
  it('adiciona à ficha um FK próprio e indexado para o grupo-base sem cor', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.technical_sheets[\s\S]*ADD COLUMN IF NOT EXISTS strap_base_group_id uuid[\s\S]*REFERENCES public\.product_groups\(id\) ON DELETE RESTRICT/,
    );
    expect(migration).toContain('technical_sheets_strap_base_group_idx');
    expect(migration).toContain('ON public.technical_sheets (strap_base_group_id)');
    expect(migration).toContain('tg_guard_technical_sheet_strap_base_group()');
    expect(migration).toContain("assert_artisanal_strap_capability('resolve_strap_migration')");
    expect(migration).toContain("current_setting('app.strap_change_reason', true)");
    expect(migration).toContain('BEFORE UPDATE OF strap_base_group_id ON public.technical_sheets');
    expect(migration).toMatch(
      /CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet[\s\S]*AFTER UPDATE OF[\s\S]*strap_base_group_id[\s\S]*tg_mark_so_costs_dirty_from_sheet\(\)/,
    );
  });

  it('resolve a base por UUID na precedência variante > grupo da ficha > pins, sem texto', () => {
    const resolver = sqlFunction('resolve_strap_base_group_id');
    const precedence = [
      '(SELECT upper_material_group_id FROM v)',
      'p.id = v.upper_material_product_id',
      '(SELECT lining_material_group_id FROM v)',
      'p.id = v.lining_material_product_id',
      '(SELECT main_material_group_id FROM v)',
      '(SELECT strap_base_group_id FROM s)',
      'p.id = s.upper_material_product_id',
      'p.id = s.lining_material_product_id',
    ].map((token) => resolver.indexOf(token));

    expect(precedence.every((position) => position >= 0)).toBe(true);
    expect([...precedence].sort((left, right) => left - right)).toEqual(precedence);
    expect(resolver).toContain('rmv.reference_id = p_reference_id');
    expect(resolver).toContain('coalesce(rmv.active, true)');
    expect(resolver).not.toMatch(/ts\.(?:upper|lining)_material(?!_product_id)/);
    expect(resolver).not.toContain('product_groups');
    expect(resolver).not.toContain('btrim(');
    expect(resolver).not.toContain('.name');
  });

  it('faz a correção inteira em uma RPC auditável, protegida e fechada sobre todas as linhas', () => {
    const rpc = sqlFunction('resolve_technical_strap_context_from_sale_order');

    expect(rpc).toContain('LANGUAGE plpgsql');
    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain("assert_artisanal_strap_capability('resolve_strap_migration')");
    expect(rpc).toContain('require_strap_change_reason(p_reason)');
    expect(rpc).toContain('p_expected_updated_at timestamptz');
    expect(rpc).toMatch(/FROM public\.technical_sheets ts[\s\S]*FOR UPDATE/);
    expect(rpc).toContain('v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at');
    expect(rpc).toContain('A ficha mudou desde a abertura do Estoque');
    expect(rpc).toContain('jsonb_array_length(p_lines) <> v_expected_count');
    expect(rpc).toContain("count(DISTINCT (entry ->> 'ordinal')::integer)");
    expect(rpc).toContain('Cada linha de tira deve aparecer exatamente uma vez');
    expect(rpc).toContain('v_ordinal < 0 OR v_ordinal >= v_expected_count');
    expect(rpc).toContain('FOR v_choice IN SELECT value FROM jsonb_array_elements(p_lines)');
    expect(rpc).toContain('resolve_technical_strap_line_migration(v_map_id, v_measure_id, v_reason)');
    expect(rpc).toContain("w.status = 'approved'");
    expect(rpc).toContain("o.status = 'active'");
    expect(rpc).toContain('v_existing_measure_id IS NOT NULL');
    expect(rpc).toContain('v_existing_type_id = v_strap_type_id');
    expect(rpc).toContain('technical_strap_line_id, status, resolution_reason');
    expect(rpc).toContain('SET strap_base_group_id = p_base_group_id');
    expect(rpc).toContain("'resolve_technical_strap_context_from_sale_order'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_technical_strap_context_from_sale_order\([\s\S]*?FROM PUBLIC/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_technical_strap_context_from_sale_order\([\s\S]*?TO authenticated/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_technical_strap_context_from_sale_order\([\s\S]*?TO authenticated, service_role/,
    );
  });

  it('faz bootstrap conservador: não cria produto e reutiliza exatamente os quatro SKUs validados', () => {
    const bootstrap = section('DO $bootstrap$', '$bootstrap$;');
    const reusedProductIds = [
      'b46cd0dc-1a85-4330-ab72-0bb8a4329cfc',
      '57123283-6883-4297-981a-08d850a210b2',
      '5e09e941-7552-408e-bcf9-de143c389d77',
      'd22cc2fc-14de-495d-8d08-70595e91c4aa',
    ];

    expect(bootstrap).not.toMatch(/INSERT INTO public\.products\b/);
    expect(new Set(reusedProductIds).size).toBe(4);
    reusedProductIds.forEach((productId) => expect(bootstrap).toContain(productId));
    expect(bootstrap).toContain("'reused_products', jsonb_build_array(");
    expect(bootstrap).toContain('o pin de forracao nao pode ser apagado');
    expect(bootstrap).not.toContain('SET lining_material_product_id = NULL');
    const enrichedStart = bootstrap.indexOf('v_enriched := (v_line');
    const enrichedLine = bootstrap.slice(
      enrichedStart,
      bootstrap.indexOf('v_lines := jsonb_set', enrichedStart),
    );
    expect(bootstrap).toContain("v_enriched := (v_line - 'color_id')");
    expect(enrichedLine).not.toMatch(/jsonb_build_object\([\s\S]*'color_id'/);
  });

  it('materializa 2 oficiais, 2 receitas e 4 variantes para OFF WHITE e COGUMELO', () => {
    const bootstrap = section('DO $bootstrap$', '$bootstrap$;');

    expect(occurrences(
      bootstrap,
      'INSERT INTO public.base_material_color_official_products',
    )).toBe(2);
    expect(occurrences(bootstrap, 'INSERT INTO public.artisanal_strap_recipes')).toBe(2);
    expect(occurrences(bootstrap, 'INSERT INTO public.artisanal_strap_variants')).toBe(4);
    expect(bootstrap).toContain("'reference_base', true");
    expect(bootstrap).toContain('product.min_stock IN (0, 50)');
    expect(bootstrap).toContain('Produtos acabados da S-039 mudaram desde a auditoria');
    expect(migration).toContain('Piso legado dos produtos acabados nao foi transferido para as variantes');
    expect(bootstrap).toContain('OFF WHITE');
    expect(bootstrap).toContain('COGUMELO');
    expect(bootstrap).toContain('aa38faa7-fd07-42a4-afe3-d2dd94d22d5d');
    expect(bootstrap).toContain('1f5b09b8-974f-448e-8166-ff3f261867fc');
  });

  it('atribui o bootstrap ao administrador explícito, sem escolher um ator por conveniência', () => {
    const bootstrap = section('DO $bootstrap$', '$bootstrap$;');

    expect(bootstrap).toContain(
      "v_actor_id constant uuid := '49371f4d-641f-466d-be26-686ef57743ec'",
    );
    expect(bootstrap).toContain('p.id = v_actor_id');
    expect(bootstrap).toContain('p.approved');
    expect(bootstrap).toContain("ur.role = 'admin'::public.app_role");
    expect(bootstrap).not.toMatch(/SELECT[\s\S]{0,160}FROM public\.user_roles[\s\S]{0,80}LIMIT 1/);
    expect(bootstrap).toContain("'strap_catalog_bootstrap_approved_by_request'");
  });

  it('expõe CTA protegido no PV e abre o drawer de estoque sem restaurar o lote legado', () => {
    expect(itemForm).toContain("strapCatalog?.capabilities.resolve_strap_migration");
    expect(itemForm).toContain('Corrigir no estoque');
    expect(itemForm).toContain('Solicite a correção ao administrador.');
    expect(itemForm).toContain('setStrapResolutionOpen(true)');
    expect(itemForm).toContain('<StrapCatalogResolutionDrawer');
    expect(itemForm).toContain('const reconciled = reconcileEditableStrapSnapshots({');
    expect(itemForm).toContain("onUpdate(index, 'strap_colors', reconciled.lines)");
    expect(itemForm).toContain("onUpdate(index, 'strap_sourcing', reconciled.sourcing)");
    expect(strapReconciler).toContain('const snapshotById = new Map');
    expect(strapReconciler).toContain("nextSourcing = setStrapSourcing(nextSourcing, lineId, null)");
    const resolvedCallbackStart = itemForm.indexOf('onResolved={(strapColors)');
    const resolvedCallbackEnd = itemForm.indexOf('          }}\n        />', resolvedCallbackStart);
    expect(resolvedCallbackStart).toBeGreaterThanOrEqual(0);
    expect(resolvedCallbackEnd).toBeGreaterThan(resolvedCallbackStart);
    expect(itemForm.slice(resolvedCallbackStart, resolvedCallbackEnd)).not.toContain('invalidateQueries');
    expect(itemForm).not.toContain('Cadastrar todas');

    expect(drawer).toContain('<Sheet');
    expect(drawer).toContain('Corrigir contexto das tiras');
    expect(drawer).toContain('requiresReferenceBase');
    expect(drawer).toMatch(/requiresReferenceBase\s*\?\s*\([\s\S]*Napa-base da referência/);
    expect(drawer).toContain('Medidas por linha técnica');
    expect(drawer).toContain('useResolveTechnicalStrapContext()');
    expect(drawer).toContain('.flatMap((group) => group.ordinals.map((ordinal) => ({');
    expect(drawer).toContain('.sort((a, b) => a.ordinal - b.ordinal)');
    expect(drawer).toContain('p_expected_updated_at: referenceUpdatedAt');
    // A elegibilidade da napa-base era derivada aqui de perfil de largura +
    // produto oficial ATIVO. Exigir o produto oficial no cliente é circular
    // (o registro é POR COR e nasce no save do PV) e chegou a reduzir o
    // seletor a UMA napa, pinando fichas na família errada — 20270101006800
    // moveu a regra para o servidor (`strap_base_group_is_eligible`).
    expect(drawer).toContain('useStrapBaseGroupCandidates');
    expect(drawer).toContain('const eligibleBaseGroupIds = useMemo(');
    expect(drawer).not.toContain('official_products');
    expect(drawer).not.toContain('Cadastrar todas');

    expect(hooks).toContain("'resolve_technical_strap_context_from_sale_order'");
    expect(hooks).toContain("toast.success('Ficha técnica corrigida. Snapshots de pedidos já comprometidos foram preservados.')");
  });

  it('mantém o editor de catálogo seguro fora do fluxo automático do PV', () => {
    expect(editor).toContain('activateOnCreate?: boolean');
    expect(createDialog).toContain("const activateOnCreate = (origin === 'pv' || (!origin && Boolean(referenceId)))");
    expect(createDialog).toMatch(
      /const contextualBaseGroupId = isUuid\(groupId\)[\s\S]*?entry\.base_group_id === groupId && entry\.status === 'active'/,
    );
    expect(createDialog).toContain('const contextualColorId = resolvedColorIds.length === 1 ? resolvedColorIds[0] : null');
    expect(createDialog).toMatch(
      /const activateOnCreate =[\s\S]*?&& !variantId[\s\S]*?&& isUuid\(measureId\)[\s\S]*?&& Boolean\(contextualBaseGroupId\)[\s\S]*?&& Boolean\(contextualColorId\)[\s\S]*?&& !needsReview/,
    );
    expect(createDialog).toContain('activateOnCreate={activateOnCreate}');

    expect(editor).toContain('activateOnCreate = false');
    expect(editor).toContain("(mode === 'create' && activateOnCreate)");
    expect(editor).toMatch(
      /status:[\s\S]*?\(mode === 'create' && activateOnCreate\)[\s\S]*?\? 'active'[\s\S]*?: variant\?\.status \|\| 'review_required'/,
    );
    expect(editor).toContain('onSaved?.(result.variant_id, result, form.colorId)');
    expect(createDialog).toContain('colorId: savedColorId');
    expect(itemForm).not.toContain('<CreateStrapProductDialog');
    expect(itemForm).not.toContain("from './CreateStrapProductDialog'");
  });

  it('materializa cor, variante e origem somente na transação atômica do save', () => {
    expect(itemForm).toContain('A identidade exata pela napa-base e a origem de estoque serão materializadas na mesma transação do salvamento.');
    expect(itemForm).toContain('Produção interna automática');
    expect(itemForm).not.toContain('usePrepareSaleOrderInternalStraps');
    expect(autoIntentMigration).toContain('public.prepare_sale_order_item_internal_straps(item.value - \'id\')');
    expect(autoIntentMigration).toContain('public.create_sale_order_atomic_pre_05500(');
    expect(autoIntentMigration).toContain("'source_mode', 'internal'");
    expect(autoIntentMigration).toContain("'base_product_id', v_ensured_line ->> 'base_product_id'");
    expect(autoIntentMigration).toContain('tg_prepare_sale_order_straps_before_confirmation');
    expect(itemForm).toContain("qc.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] })");
    expect(itemForm).toContain("qc.invalidateQueries({ queryKey: ['strap_stock_lines_preview'] })");
    expect(hooks).toContain("queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] })");
  });

  it('faz reference_base follow_main seguir o cabedal e mantém as demais cores independentes', () => {
    expect(itemForm).toContain('const canonicalStrapColorByKey = useMemo(() => {');
    expect(itemForm).toContain("alias.status === 'approved'");
    expect(itemForm).toContain('if (ids.size !== 1) return');
    expect(itemForm).toContain("|| strapColorMode(presentation) !== 'follow_main') return strap");
    expect(itemForm).toContain('const targetColor = canonicalMainStrapColor?.name || item.color.trim()');
    expect(itemForm).toContain('return { ...strap, color: targetColor, color_id: targetColorId }');
    expect(itemForm).toContain("if (strapIdentityBasis(strap) === 'reference_base') return strap");
    expect(itemForm).toContain('strapColorsForIdentity(');
    expect(itemForm).toContain('.some((color) => color.id === canonical.id)');
    expect(itemForm).toContain('return { ...strap, color: canonical.name, color_id: canonical.id }');
    expect(itemForm).toContain('cor do cabedal');
    expect(itemForm).toContain('Comprada pronta · origem fixa');
    expect(itemForm).toContain('Object.entries(candidate).every(');
    expect(itemForm).not.toContain('JSON.stringify(current) === JSON.stringify(candidate)');
  });

  it('preserva snapshot histórico intocado e deriva as duas origens somente no servidor', () => {
    expect(itemForm).toContain('const preserveHistoricalIdentity = preserveCommittedStrapSnapshot');
    expect(itemForm).toContain('&& !mainColorChanged');
    expect(itemForm).toContain("frozen.source_mode === 'buy_ready'");
    expect(itemForm).toContain('isUuid(frozen.recipe_id) && isUuid(frozen.base_product_id)');
    expect(itemForm).toContain('&& frozen?.color_id === strap.color_id');
    expect(itemForm).toContain('if (preserveHistoricalIdentity) return strap');
    expect(saleOrderHooks).not.toContain('export function listarTirasSemOrigem');
    expect(saleOrderForm).not.toContain('listarTirasSemOrigem');
    expect(saleOrders).not.toContain('listarTirasSemOrigem');
    expect(mobileNewOrder).not.toContain('missingStrapSourcingLineIds');
    expect(mobileNewOrder).toContain('mobileFinishedStrapIdentityIssues(items)');
    expect(mobileNewOrder).toContain('mobileSelectableStrapManifestIssues(item, manifestEntry)');
    expect(mobileNewOrder).toContain('O writer atômico');
  });
});
