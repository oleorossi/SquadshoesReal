-- =============================================================================
-- Strass (finished_product_group) em Comprar pronto: sem variante Hub
-- =============================================================================
-- Spec: specs/tira-comprar-pronto-so-registra.md D4/D8/R7/R8
-- Marcador: strap_strass_comprar_pronto_sem_variante_20270101045600
--
-- Antes: o ELSE finished_product_group do prepare exigia artisanal_strap_variants
--   ativa exata e congelava strap_variant_id — bloqueava save sem cadastro Hub.
-- Agora: resolve SKU por (grupo da identidade + cor canônica); se faltar, cria
--   products com estoque 0 sob app.artisanal_strap_catalog_write='1' (grupos
--   is_artisanal_strap disparam o guard legado). Congela finished_product_id +
--   gross_required_m; strap_variant_id NULL. Ambiguidade (>1 SKU ativo) → RAISE.
-- Alinhamento: valida o SKU congelado no grupo/cor, sem variante.
-- =============================================================================

-- ── 1. Writer (prepare ELSE finished_product_group) ─────────────────────────
DO $patch_writer$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$ELSE
      BEGIN
        v_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
        v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Cor/grupo invalido na tira comprada pronta';
      END;
      IF v_line_color_id IS NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta exige uma cor canonica propria';
      END IF;
      SELECT c.name INTO v_line_color_name
        FROM public.canonical_colors c
       WHERE c.id = v_line_color_id AND c.active
       FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cor da tira comprada pronta esta inativa'; END IF;

      -- O PV congela a variante comercial ativa exata; nunca inventa o
      -- produto/fornecedor/valor da tira comprada pronta.
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
      );
    END IF;$old$;
  v_new text := $new$ELSE
      -- strap_strass_comprar_pronto_sem_variante_20270101045600
      -- finished_product_group (strass): sem variante Hub. Acha/cria SKU do
      -- grupo+cor com estoque 0 (token de catalogo) e congela finished_product_id
      -- + gross_required_m (spec tira-comprar-pronto-so-registra D4/D8).
      BEGIN
        v_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
        v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Cor/grupo invalido na tira comprada pronta';
      END;
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira de grupo acabado exige identity_group_id na ficha',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      IF v_line_color_id IS NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta exige uma cor canonica propria';
      END IF;
      SELECT c.name INTO v_line_color_name
        FROM public.canonical_colors c
       WHERE c.id = v_line_color_id AND c.active
       FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cor da tira comprada pronta esta inativa'; END IF;
      IF (
        SELECT count(*)::integer
          FROM public.products p
         WHERE p.active
           AND p.group_id = v_identity_group_id
           AND p.unit = 'm'
           AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id
      ) > 1 THEN
        RAISE EXCEPTION
          'Modelo % / %, %: ha mais de um SKU ativo da cor no grupo acabado',
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
        BEGIN
          PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
          INSERT INTO public.products (
            id, name, sku, category, group_id, color,
            quantity, min_stock, unit, unit_price, location, active, is_artisanal,
            purchase_unit, conversion_rate, purchase_price,
            min_order_quantity, purchase_multiple, material_preparation_days
          )
          SELECT
            gen_random_uuid(),
            concat_ws(' · ', coalesce(nullif(g.name, ''), 'TIRA'), v_line_color_name),
            'TP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)),
            coalesce(nullif(g.sector, ''), 'Tiras'),
            v_identity_group_id,
            v_line_color_name,
            0, 0, 'm', 0, '', true, false,
            'm', 1, NULL, 1, 1, 2
          FROM public.product_groups g
          WHERE g.id = v_identity_group_id
          RETURNING jsonb_build_object('finished_product_id', id) INTO v_catalog;
          PERFORM set_config('app.artisanal_strap_catalog_write', '', true);
        EXCEPTION WHEN OTHERS THEN
          PERFORM set_config('app.artisanal_strap_catalog_write', '', true);
          RAISE;
        END;
        IF v_catalog IS NULL OR nullif(v_catalog ->> 'finished_product_id', '') IS NULL THEN
          RAISE EXCEPTION 'Grupo acabado da tira comprada pronta nao existe';
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
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name'
          - 'gross_required_m')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
          'strap_variant_id', NULL,
          'finished_product_id', v_catalog ->> 'finished_product_id',
          'recipe_id', NULL,
          'base_product_id', NULL,
          'gross_required_m', round(public.calculate_strap_line_required_m(
            v_line,
            coalesce(
              nullif(p_item ->> 'quantity', '')::numeric,
              coalesce(nullif(p_item ->> 'fichas', '')::numeric, 1) * coalesce((
                SELECT sum(g.value::numeric)
                  FROM jsonb_each_text(CASE WHEN jsonb_typeof(p_item -> 'grade') = 'object'
                    THEN p_item -> 'grade' ELSE '{}'::jsonb END) g
                 WHERE g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              ), 0)
            ),
            coalesce(p_item -> 'grade', '{}'::jsonb)
          ), 4)
        ),
        true
      );
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_strass_comprar_pronto_sem_variante_20270101045600' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'prepare: ELSE finished_product_group nao encontrado/unico (hits=%); revise 45600',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_strass_comprar_pronto_sem_variante_20270101045600' IN v_def) = 0 THEN
    RAISE EXCEPTION 'prepare: marcador 45600 nao gravado';
  END IF;
  IF position('Tira comprada pronta nao possui variante comercial ativa exata' IN v_def) > 0 THEN
    RAISE EXCEPTION 'prepare: ainda exige variante Hub no ramo finished';
  END IF;
  IF position('app.artisanal_strap_catalog_write' IN v_def) = 0 THEN
    RAISE EXCEPTION 'prepare: INSERT de SKU strass sem token de catalogo';
  END IF;
END
$patch_writer$;

-- ── 2. Alinhamento: SKU do grupo/cor, sem variante ──────────────────────────
DO $patch_alignment$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$ELSE
      IF v_identity_group_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Tira de grupo acabado exige origem fixa buy_ready';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants av
          JOIN public.products finished ON finished.id = av.finished_product_id
         WHERE av.id = v_source_variant_id
           AND av.measure_id = v_measure_id
           AND av.base_group_id = v_identity_group_id
           AND av.color_id = v_line_color_id
           AND av.identity_basis = 'finished_product_group'
           AND av.status = 'active'
           AND av.purchase_enabled
           AND NOT av.internal_production_enabled
           AND finished.active
           AND finished.group_id = v_identity_group_id
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'Variante comprada pronta nao corresponde a medida/grupo/cor da ficha';
      END IF;
    END IF;$old$;
  v_new text := $new$ELSE
      -- strap_strass_comprar_pronto_sem_variante_20270101045600
      -- Strass: buy_ready + SKU acabado do grupo/cor; sem variante Hub.
      IF v_identity_group_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL
         OR v_source_variant_id IS NOT NULL THEN
        RAISE EXCEPTION 'Tira de grupo acabado exige origem buy_ready com SKU acabado e sem variante Hub';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.products finished
         WHERE finished.id = nullif(v_source ->> 'finished_product_id', '')::uuid
           AND finished.active
           AND finished.group_id = v_identity_group_id
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'SKU acabado da tira comprada pronta nao corresponde a grupo/cor da ficha';
      END IF;
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_strass_comprar_pronto_sem_variante_20270101045600' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'alinhamento: ELSE finished nao encontrado/unico (hits=%); revise 45600',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_strass_comprar_pronto_sem_variante_20270101045600' IN v_def) = 0 THEN
    RAISE EXCEPTION 'alinhamento: marcador 45600 nao gravado';
  END IF;
  IF position('Variante comprada pronta nao corresponde a medida/grupo/cor da ficha' IN v_def) > 0 THEN
    RAISE EXCEPTION 'alinhamento: ainda exige variante Hub no ramo finished';
  END IF;
END
$patch_alignment$;

COMMENT ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb) IS
  'Prepara tiras do item do PV. reference_base + sku_acabado (Comprar pronto de napa) so registra cor + metros (45300). finished_product_group (strass) acha/cria SKU do grupo+cor sem variante Hub e congela finished_product_id + gross_required_m (45600 / spec tira-comprar-pronto-so-registra D4/D8).';
