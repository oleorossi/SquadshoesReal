-- =============================================================================
-- Tira comprada pronta resolve pelo SKU do grupo — sem medida/cor do Hub
-- =============================================================================
-- Sintoma (19/11/2026, /sales/new, INL01 OFF WHITE, TIRA STRASS 6MM):
--   a ficha aponta o grupo de estoque (comprar pronto) sem measure_id do Hub.
--   A tela pedia família/medida e cor canônica e o save não baixava o SKU.
--
-- Writer: se o pedido (ou um único SKU ativo em metros do grupo) já indica o
-- produto, congela finished_product_id. Não cria produto. Sem SKU, ou com
-- vários sem escolha, o RAISE nomeia o que falta.
-- Pré-checagem: finished_product_id completa a identidade mesmo sem color_id.
--
-- Marcador: strap_pronta_sku_direto_20270101049800
-- Não grava dado de produto nem de PV.
-- =============================================================================

DO $patch_writer_sku$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$      -- strap_strass_comprar_pronto_sem_variante_20270101045600
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
      END IF;$old$;
  v_new text := $new$      -- strap_pronta_sku_direto_20270101049800
      -- finished_product_group: o SKU do grupo de estoque é a identidade.
      -- Medida/cor do Hub são opcionais. O pedido não cria produto.
      BEGIN
        v_identity_group_id := coalesce(
          nullif(v_line ->> 'identity_group_id', '')::uuid,
          nullif(v_line ->> 'group_id', '')::uuid
        );
        v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Cor/grupo invalido na tira comprada pronta';
      END;
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira comprada pronta exige o grupo de estoque na ficha',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
      v_catalog := NULL;
      IF coalesce(
           nullif(v_line ->> 'finished_product_id', ''),
           nullif(v_existing_source ->> 'finished_product_id', '')
         ) IS NOT NULL THEN
        SELECT jsonb_build_object('finished_product_id', p.id), coalesce(p.color, p.name)
          INTO v_catalog, v_line_color_name
          FROM public.products p
         WHERE p.id = coalesce(
                 nullif(v_line ->> 'finished_product_id', ''),
                 nullif(v_existing_source ->> 'finished_product_id', '')
               )::uuid
           AND p.active
           AND p.group_id = v_identity_group_id
           AND p.unit = 'm'
         FOR SHARE OF p;
        IF NOT FOUND THEN
          RAISE EXCEPTION
            'Modelo % / %, %: o SKU escolhido nao esta ativo, em metros, no grupo da tira',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSIF v_line_color_id IS NOT NULL THEN
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
            'Modelo % / %, %: ha mais de um SKU ativo da cor no grupo. Selecione o produto no pedido',
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
          RAISE EXCEPTION
            'Modelo % / %, %: nao ha SKU ativo em metros para a cor %. Cadastre o produto nesse grupo. O pedido nao cria SKU',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA'),
            coalesce(v_line_color_name, v_line_color_id::text);
        END IF;
      ELSE
        IF (
          SELECT count(*)::integer
            FROM public.products p
           WHERE p.active AND p.group_id = v_identity_group_id AND p.unit = 'm'
        ) = 1 THEN
          SELECT jsonb_build_object('finished_product_id', p.id), coalesce(p.color, p.name)
            INTO v_catalog, v_line_color_name
            FROM public.products p
           WHERE p.active AND p.group_id = v_identity_group_id AND p.unit = 'm'
           FOR SHARE OF p;
        ELSIF (
          SELECT count(*)::integer
            FROM public.products p
           WHERE p.active AND p.group_id = v_identity_group_id AND p.unit = 'm'
        ) = 0 THEN
          RAISE EXCEPTION
            'Modelo % / %, %: o grupo da tira comprada pronta nao tem SKU ativo em metros. Cadastre o produto. O pedido nao cria SKU',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        ELSE
          RAISE EXCEPTION
            'Modelo % / %, %: ha mais de um SKU ativo no grupo. Selecione o produto no pedido',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pronta_sku_direto_20270101049800' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position('strap_strass_comprar_pronto_sem_variante_20270101045600' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Ramo 45600 ausente no writer vivo; revise 49800';
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Bloco da tira pronta nao encontrado (hits=%); revise 49800', coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  -- O INSERT de produto com estoque 0 deixa de ser o caminho desta identidade.
  IF position('O pedido nao cria SKU' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Writer nao passou a recusar SKU ausente; revise 49800';
  END IF;
  EXECUTE v_def;
END;
$patch_writer_sku$;

DO $patch_precheck_sku$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$    IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id
       OR (v_source_variant_id IS NULL
           AND nullif(v_source ->> 'finished_product_id', '') IS NULL
           AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;$old$;
  v_new text := $new$    -- strap_pronta_sku_direto_20270101049800
    -- SKU acabado congelado completa a identidade sem cor do Hub.
    IF (v_line_color_id IS NULL
        AND nullif(v_source ->> 'finished_product_id', '') IS NULL)
       OR (v_line_color_id IS NOT NULL
           AND v_source_color_id IS DISTINCT FROM v_line_color_id)
       OR (v_source_variant_id IS NULL
           AND nullif(v_source ->> 'finished_product_id', '') IS NULL
           AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pronta_sku_direto_20270101049800' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Pre-checagem de cor nao encontrada (hits=%); revise 49800', coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_precheck_sku$;
