-- =============================================================================
-- PV: tira artesanal pode ser comprada pronta (fornecedor) no escolhe_no_pv
-- =============================================================================
-- Sintoma: Meia Cana 10 mm (identity_basis=reference_base, Hub=escolhe_no_pv)
-- só oferecia Fábrica | Prestador. "Tira pronta" não abria cadastro de
-- fornecedor; o writer ainda materializava remessa de napa.
--
-- Esta migration NÃO muda origem_padrao do Hub. Só honra pv_origem=sku_acabado
-- no snapshot do item: source_mode=buy_ready + variante finished_product_group
-- no group_id da ficha (SKU acabado da tira), sem receita/napa.
-- Marcador: strap_pv_sku_acabado_fornecedor_20270101024000
-- =============================================================================

DO $patch_prepare$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old_snapshot text := $old_snapshot$
          WHEN 'reference_base' THEN
            v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'internal'
            AND coalesce(v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'recipe_id', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND coalesce(v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'base_product_id', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          WHEN 'finished_product_group' THEN
$old_snapshot$;
  v_new_snapshot text := $new_snapshot$
          WHEN 'reference_base' THEN
            CASE
              WHEN line.value ->> 'pv_origem' = 'sku_acabado' THEN
                v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'buy_ready'
              ELSE
                v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'internal'
                AND coalesce(v_current.strap_sourcing
                      -> (line.value ->> 'technical_strap_line_id') ->> 'recipe_id', '')
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                AND coalesce(v_current.strap_sourcing
                      -> (line.value ->> 'technical_strap_line_id') ->> 'base_product_id', '')
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            END
          WHEN 'finished_product_group' THEN
$new_snapshot$;
  v_old_loop text := $old_loop$
    IF v_sheet_basis = 'reference_base' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
$old_loop$;
  v_new_loop text := $new_loop$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    IF v_sheet_basis = 'reference_base'
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
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION 'Tira pronta exige o grupo acabado (group_id) na ficha';
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
      );
    ELSIF v_sheet_basis = 'reference_base' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
$new_loop$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_fornecedor_20270101024000' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old_snapshot, ''))
  ) / nullif(length(v_old_snapshot), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ramo reference_base do snapshot do prepare não encontrado (hits=%); recuse 24000',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old_snapshot, v_new_snapshot);

  v_hits := (
    length(v_def) - length(replace(v_def, v_old_loop, ''))
  ) / nullif(length(v_old_loop), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Loop reference_base do prepare não encontrado (hits=%); recuse 24000',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old_loop, v_new_loop);
END;
$patch_prepare$;

DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$
    IF v_basis = 'reference_base' THEN
      IF (v_color_mode = 'follow_main' AND (
            v_expected_color_id IS NULL
            OR v_line_color_id IS DISTINCT FROM v_expected_color_id
          ))
         OR (v_color_mode = 'select_on_order' AND v_line_color_id IS NULL)
         OR v_source_mode IS DISTINCT FROM 'internal'
$old$;
  v_new text := $new$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    IF v_basis = 'reference_base'
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
      END IF;
    ELSIF v_basis = 'reference_base' THEN
      IF (v_color_mode = 'follow_main' AND (
            v_expected_color_id IS NULL
            OR v_line_color_id IS DISTINCT FROM v_expected_color_id
          ))
         OR (v_color_mode = 'select_on_order' AND v_line_color_id IS NULL)
         OR v_source_mode IS DISTINCT FROM 'internal'
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_acabado_fornecedor_20270101024000' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ramo reference_base do guard não encontrado (hits=%); recuse 24000',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_guard$;
