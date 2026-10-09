-- =============================================================================
-- PV: Comprar pronto (sku_acabado) sem variante Hub — só metragem + SKU estoque
-- =============================================================================
-- Pedido 0229 / grill: ao escolher Comprar pronto no PV, não exigir
-- artisanal_strap_variants. Congela buy_ready com finished_product_id; cria o
-- products da Cor Principal no grupo acabado se faltar; não enfileira demanda.
-- Marcador: strap_pv_sku_acabado_sem_variante_20270101031900
-- =============================================================================

-- 1) prepare: Cor Principal + find/INSERT product + freeze sem variante
DO $patch_prepare$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
      IF v_color_mode = 'follow_main' THEN
        v_line_color_id := v_color_id;
        v_line_color_name := v_color_name;
      ELSIF v_color_mode = 'select_on_order' THEN
        BEGIN
          v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Modelo % / %, %: cor invalida',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END;
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: selecione a cor no Pedido de Venda',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
        SELECT c.name INTO v_line_color_name
          FROM public.canonical_colors c
         WHERE c.id = v_line_color_id AND c.active
         FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modelo % / %, %: a cor selecionada nao existe ou esta inativa',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSE
        RAISE EXCEPTION 'Modelo % / %, %: politica de cor invalida',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      BEGIN
        v_identity_group_id := nullif(v_line ->> 'group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Grupo da tira pronta invalido';
      END;
      -- strap_pv_sku_group_id_error_context_20270101028500
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira pronta exige o grupo acabado (group_id) na ficha — use Fazer (fábrica) ou cadastre o grupo acabado na ficha técnica',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      IF v_line_color_id IS NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta exige uma cor canonica propria';
      END IF;
      PERFORM 1
        FROM public.artisanal_strap_variants av
        JOIN public.products p ON p.id = av.finished_product_id
       WHERE av.measure_id = v_measure_id
         AND av.base_group_id = v_identity_group_id
         AND av.color_id = v_line_color_id
         AND av.identity_basis = 'finished_product_group'
         AND av.status = 'active'
         AND av.purchase_enabled
         AND NOT av.internal_production_enabled
         AND p.active
         AND p.group_id = v_identity_group_id
         AND p.unit = 'm'
         AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id
       FOR SHARE OF av, p;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Tira comprada pronta nao possui variante comercial ativa exata';
      END IF;
      v_catalog := public.resolve_artisanal_strap_catalog(
        v_measure_id, v_identity_group_id, v_line_color_id,
        'buy_ready', 'finished_product_group'
      );
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id'
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
          'strap_variant_id', v_catalog ->> 'variant_id',
          'recipe_id', NULL,
          'base_product_id', NULL
        ),
        true
      );$old$;
  v_new text := $new$IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      -- strap_pv_sku_acabado_sem_variante_20270101031900
      -- Cor = Cor Principal (forração/cabedal do item); sem variante Hub.
      v_color_mode := 'follow_main';
      v_line_color_id := v_color_id;
      v_line_color_name := v_color_name;
      BEGIN
        v_identity_group_id := nullif(v_line ->> 'group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Grupo da tira pronta invalido';
      END;
      -- strap_pv_sku_group_id_error_context_20270101028500
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira pronta exige o grupo acabado (group_id) na ficha — use Fazer (fábrica) ou cadastre o grupo acabado na ficha técnica',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      IF v_line_color_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira comprada pronta exige a Cor Principal canonica do item',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      IF (
        SELECT count(*)::integer
          FROM public.products p
         WHERE p.active
           AND p.group_id = v_identity_group_id
           AND p.unit = 'm'
           AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id
      ) > 1 THEN
        RAISE EXCEPTION
          'Modelo % / %, %: ha mais de um SKU ativo da Cor Principal no grupo acabado',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      SELECT jsonb_build_object('finished_product_id', p.id)
        INTO v_catalog
        FROM public.products p
       WHERE p.active
         AND p.group_id = v_identity_group_id
         AND p.unit = 'm'
         AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id
       FOR SHARE OF p;
      IF NOT FOUND OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
        INSERT INTO public.products (
          id, name, sku, category, group_id, color,
          quantity, min_stock, unit, unit_price, location, active, is_artisanal,
          purchase_unit, conversion_rate, purchase_price,
          min_order_quantity, purchase_multiple, material_preparation_days
        )
        SELECT
          gen_random_uuid(),
          concat_ws(
            ' · ',
            coalesce(nullif(g.name, ''), 'TIRA'),
            nullif(v_line ->> 'base_group_name', ''),
            v_line_color_name
          ),
          'TP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)),
          coalesce(nullif(g.sector, ''), 'Tiras Artesanais'),
          v_identity_group_id,
          v_line_color_name,
          0, 0, 'm', 0, '', true, true,
          'm', 1, NULL, 1, 1, 2
        FROM public.product_groups g
        WHERE g.id = v_identity_group_id
        RETURNING jsonb_build_object('finished_product_id', id) INTO v_catalog;
        IF v_catalog IS NULL OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
          RAISE EXCEPTION 'Grupo acabado da tira pronta nao existe';
        END IF;
      END IF;
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id' - 'finished_product_id'
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
          'strap_variant_id', NULL,
          'finished_product_id', v_catalog ->> 'finished_product_id',
          'recipe_id', NULL,
          'base_product_id', NULL
        ),
        true
      );$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_sem_variante_20270101031900' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ramo sku_acabado do prepare nao encontrado (hits=%); recuse 31900',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_prepare$;

-- 2) guard: aceita finished_product_id sem variante (só sku_acabado)
DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      IF (v_color_mode = 'follow_main' AND (
            v_expected_color_id IS NULL
            OR v_line_color_id IS DISTINCT FROM v_expected_color_id
          ))
         OR (v_color_mode = 'select_on_order' AND v_line_color_id IS NULL)
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Tira pronta exige origem buy_ready e variante comercial ativa';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants av
          JOIN public.products finished ON finished.id = av.finished_product_id
         WHERE av.id = v_source_variant_id
           AND av.measure_id = v_measure_id
           AND av.base_group_id = nullif(v_line ->> 'group_id', '')::uuid
           AND av.color_id = v_line_color_id
           AND av.identity_basis = 'finished_product_group'
           AND av.status = 'active'
           AND av.purchase_enabled
           AND NOT av.internal_production_enabled
           AND finished.active
           AND finished.group_id = nullif(v_line ->> 'group_id', '')::uuid
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'Variante comprada pronta nao corresponde a medida/grupo/cor da ficha';
      END IF;$old$;
  v_new text := $new$IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      -- strap_pv_sku_acabado_sem_variante_20270101031900
      IF v_expected_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_expected_color_id
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL
         OR v_source_variant_id IS NOT NULL THEN
        RAISE EXCEPTION 'Tira pronta exige origem buy_ready com SKU acabado e Cor Principal';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.products finished
         WHERE finished.id = nullif(v_source ->> 'finished_product_id', '')::uuid
           AND finished.active
           AND finished.group_id = nullif(v_line ->> 'group_id', '')::uuid
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'SKU acabado da tira pronta nao corresponde a grupo/cor da ficha';
      END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_sem_variante_20270101031900' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ramo sku_acabado do guard nao encontrado (hits=%); recuse 31900',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_guard$;

-- 3) identidade pré-demanda: buy_ready + finished_product_id sem variante
DO $patch_committed$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_old text := $old$  IF COALESCE(v_source_mode, '') NOT IN ('internal', 'buy_ready')
     OR v_variant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  END IF;
  SELECT variant.finished_product_id,
         variant.measure_id,
         variant.base_group_id,
         variant.color_id,
         variant.identity_basis
    INTO v_finished_product_id,
         v_variant_measure_id,
         v_variant_base_group_id,
         v_variant_color_id,
         v_variant_identity_basis
    FROM public.artisanal_strap_variants variant
   WHERE variant.id = v_variant_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Variante congelada da tira nao existe mais'
    );
  END IF;$old$;
  v_new text := $new$  -- strap_pv_sku_acabado_sem_variante_20270101031900
  IF COALESCE(v_source_mode, '') NOT IN ('internal', 'buy_ready') THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  END IF;
  IF v_source_mode = 'buy_ready'
     AND v_variant_id IS NULL
     AND public.try_parse_uuid(v_selection ->> 'finished_product_id') IS NOT NULL THEN
    SELECT product.id,
           public.try_parse_uuid(v_selection ->> 'color_id'),
           product.group_id,
           'finished_product_group'
      INTO v_finished_product_id,
           v_variant_color_id,
           v_variant_base_group_id,
           v_variant_identity_basis
      FROM public.products product
     WHERE product.id = public.try_parse_uuid(v_selection ->> 'finished_product_id')
       AND product.active
       AND product.unit = 'm';
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'SKU acabado congelado da tira pronta nao existe mais'
      );
    END IF;
    v_variant_measure_id := NULL;
  ELSIF v_variant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  ELSE
    SELECT variant.finished_product_id,
           variant.measure_id,
           variant.base_group_id,
           variant.color_id,
           variant.identity_basis
      INTO v_finished_product_id,
           v_variant_measure_id,
           v_variant_base_group_id,
           v_variant_color_id,
           v_variant_identity_basis
      FROM public.artisanal_strap_variants variant
     WHERE variant.id = v_variant_id;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'Variante congelada da tira nao existe mais'
      );
    END IF;
  END IF;$new$;
  v_hits integer;
BEGIN
  SELECT p.oid::regprocedure
    INTO v_fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND p.proname = 'resolve_committed_strap_identity'
   LIMIT 1;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'private.resolve_committed_strap_identity ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_sem_variante_20270101031900' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Gate variante de resolve_committed_strap_identity nao encontrado (hits=%); recuse 31900',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_committed$;

-- 4) enqueue: nao gera demanda/compra para buy_ready sem variante (Q11-A)
DO $patch_enqueue$
DECLARE
  v_fn regprocedure := 'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure;
  v_def text;
  v_old text := $old$    FROM private.preview_sale_order_strap_demand_operational(p_sale_order_id) p;$old$;
  v_new text := $new$    -- strap_pv_sku_acabado_sem_variante_20270101031900
    -- Comprar pronto do PV (sem variante Hub): só metragem/estoque no consumo;
    -- nao enfileira demanda nem compra automatica.
    FROM private.preview_sale_order_strap_demand_operational(p_sale_order_id) p
   WHERE NOT (
     p.source_mode = 'buy_ready'
     AND p.strap_variant_id IS NULL
   );$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.enqueue_sale_order_strap_demands(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'enqueue_sale_order_strap_demands ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_sem_variante_20270101031900' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'FROM operacional do enqueue nao encontrado (hits=%); recuse 31900',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_enqueue$;
