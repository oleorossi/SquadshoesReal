-- Garante variantes ativas GLOW METALIC × medida (receita aprovada) × cor
-- (SKU linear ativo), e realinha `strap_sourcing` de itens de PV abertos cujo
-- snapshot congelado diverge do catálogo vivo.
--
-- Sintoma §03: "Variante exata ativa nao encontrada" + origem congelada stale
-- em TIRA 5 mm · GLOW METALIC · COBRE (Napa a separar = —).

BEGIN;

DO $catalog$
DECLARE
  v_glow uuid;
  v_recipe record;
  v_color record;
  v_type_name text;
  v_measure_display text;
  v_presentation_group uuid;
  v_finished_id uuid;
  v_variant_id uuid;
  v_created integer := 0;
BEGIN
  SELECT id INTO v_glow
    FROM public.product_groups
   WHERE upper(btrim(name)) IN ('GLOW METALIC', 'GLOW METALLIC')
   ORDER BY CASE WHEN upper(btrim(name)) = 'GLOW METALIC' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_glow IS NULL THEN
    RAISE NOTICE 'GLOW METALIC ausente; catalogo de tiras ignorado';
    RETURN;
  END IF;

  -- Perfil de largura precisa existir (auto-provision ja rodou em PVs
  -- anteriores). Sem perfil, a resolucao do catalogo ainda funciona para
  -- identidade da variante; o rendimento e da receita.
  IF NOT EXISTS (
    SELECT 1 FROM public.base_material_width_profiles wp
     WHERE wp.base_group_id = v_glow
       AND wp.status = 'approved'
       AND wp.valid_to IS NULL
  ) THEN
    RAISE NOTICE 'GLOW METALIC sem perfil de largura aprovado; variantes ainda assim serao criadas';
  END IF;

  FOR v_recipe IN
    SELECT r.measure_id,
           r.id AS recipe_id,
           m.display_name,
           t.name AS type_name
      FROM public.artisanal_strap_recipes r
      JOIN public.artisanal_strap_measures m ON m.id = r.measure_id AND m.active
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id AND t.active
     WHERE r.base_group_id = v_glow
       AND r.status = 'approved'
       AND r.valid_from <= now()
       AND (r.valid_to IS NULL OR r.valid_to > now())
  LOOP
    v_type_name := v_recipe.type_name;
    v_measure_display := v_recipe.display_name;

    -- Grupo de apresentacao: TIRA OVERLOCK 5MM / TIRA CHATA 8MM quando existir.
    SELECT g.id INTO v_presentation_group
      FROM public.product_groups g
     WHERE upper(btrim(g.name)) = upper(btrim(
             v_type_name || ' ' || replace(v_measure_display, ' ', '')
           ))
        OR upper(btrim(g.name)) = upper(btrim(v_type_name || ' ' || v_measure_display))
        OR upper(replace(btrim(g.name), ' ', ''))
             = upper(replace(btrim(v_type_name || v_measure_display), ' ', ''))
     ORDER BY g.created_at
     LIMIT 1;

    FOR v_color IN
      SELECT DISTINCT
             public.resolve_strap_canonical_color_id(p.color) AS color_id,
             c.name AS color_name
        FROM public.products p
        JOIN public.canonical_colors c
          ON c.id = public.resolve_strap_canonical_color_id(p.color)
         AND c.active
       WHERE p.group_id = v_glow
         AND COALESCE(p.active, true)
         AND NULLIF(btrim(p.color), '') IS NOT NULL
         AND public.resolve_strap_canonical_color_id(p.color) IS NOT NULL
         AND lower(COALESCE(p.unit, '')) = 'm'
    LOOP
      -- UNIQUE (measure, base, color) — pode existir com outro identity_basis.
      SELECT av.id, av.finished_product_id
        INTO v_variant_id, v_finished_id
        FROM public.artisanal_strap_variants av
       WHERE av.measure_id = v_recipe.measure_id
         AND av.base_group_id = v_glow
         AND av.color_id = v_color.color_id
       FOR UPDATE;

      IF v_variant_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.artisanal_strap_variants av
           WHERE av.id = v_variant_id
             AND (
               av.status <> 'active'
               OR NOT COALESCE(av.internal_production_enabled, false)
               OR COALESCE(av.identity_basis, '') IS DISTINCT FROM 'reference_base'
             )
        ) THEN
          PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
          PERFORM set_config(
            'app.strap_change_reason',
            'Backfill: reativar variante GLOW interna',
            true
          );
          UPDATE public.artisanal_strap_variants
             SET status = 'active',
                 internal_production_enabled = true,
                 identity_basis = 'reference_base',
                 review_reason = NULL
           WHERE id = v_variant_id;
        END IF;
        CONTINUE;
      END IF;

      PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
      PERFORM set_config(
        'app.strap_change_reason',
        'Backfill: variante GLOW METALIC por cor/medida',
        true
      );

      v_finished_id := gen_random_uuid();
      INSERT INTO public.products (
        id, name, sku, category, group_id, color,
        quantity, min_stock, unit, unit_price, location, active, is_artisanal,
        purchase_unit, conversion_rate, purchase_price,
        min_order_quantity, purchase_multiple, material_preparation_days
      ) VALUES (
        v_finished_id,
        concat_ws(
          ' · ',
          v_type_name || ' ' || v_measure_display,
          'GLOW METALIC',
          v_color.color_name
        ),
        'TA-' || upper(substr(replace(v_finished_id::text, '-', ''), 1, 24)),
        'Tiras Artesanais',
        v_presentation_group,
        v_color.color_name,
        0, 0, 'm', 0, '', true, true,
        'm', 1, NULL, 1, 1, 2
      );

      INSERT INTO public.artisanal_strap_variants (
        measure_id, base_group_id, color_id, finished_product_id,
        min_stock_m, min_stock_replenishment_mode, purchase_enabled,
        identity_basis, internal_production_enabled, status, review_reason
      ) VALUES (
        v_recipe.measure_id, v_glow, v_color.color_id, v_finished_id,
        0, 'internal', false,
        'reference_base', true, 'active', NULL
      )
      RETURNING id INTO v_variant_id;

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Variantes GLOW criadas/reativadas neste run: %', v_created;
END
$catalog$;

-- Realinha strap_sourcing de itens ainda abertos (sem demanda congelada
-- vigente) quando o catalogo agora resolve e o snapshot diverge.
DO $resync$
DECLARE
  v_item record;
  v_line_id text;
  v_entry jsonb;
  v_source jsonb;
  v_new jsonb;
  v_measure_id uuid;
  v_color_id uuid;
  v_base_group_id uuid;
  v_variant_id uuid;
  v_recipe_id uuid;
  v_base_product_id uuid;
  v_finished_id uuid;
  v_changed boolean;
  v_updated integer := 0;
BEGIN
  FOR v_item IN
    SELECT soi.id,
           soi.strap_sourcing,
           soi.strap_colors,
           soi.color
      FROM public.sale_order_items soi
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE soi.strap_sourcing IS NOT NULL
       AND soi.strap_sourcing <> '{}'::jsonb
       AND COALESCE(so.status, '') NOT IN ('cancelado', 'cancelled')
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_strap_demands d
          WHERE d.sale_order_item_id = soi.id
            AND COALESCE(d.is_current, true)
       )
  LOOP
    v_new := COALESCE(v_item.strap_sourcing, '{}'::jsonb);
    v_changed := false;

    FOR v_line_id, v_entry IN
      SELECT key, value
        FROM jsonb_each(COALESCE(v_item.strap_sourcing, '{}'::jsonb))
    LOOP
      IF COALESCE(v_entry ->> 'source_mode', 'internal') NOT IN ('internal', '') THEN
        CONTINUE;
      END IF;

      BEGIN
        v_measure_id := NULLIF(v_entry ->> 'measure_id', '')::uuid;
        v_color_id := NULLIF(v_entry ->> 'color_id', '')::uuid;
        v_base_group_id := NULLIF(v_entry ->> 'base_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;

      IF v_measure_id IS NULL THEN
        SELECT NULLIF(line.value ->> 'measure_id', '')::uuid
          INTO v_measure_id
          FROM jsonb_array_elements(COALESCE(v_item.strap_colors, '[]'::jsonb)) line(value)
         WHERE line.value ->> 'technical_strap_line_id' = v_line_id
         LIMIT 1;
      END IF;

      IF v_color_id IS NULL THEN
        v_color_id := public.resolve_strap_canonical_color_id(v_item.color);
      END IF;

      IF v_base_group_id IS NULL THEN
        SELECT id INTO v_base_group_id
          FROM public.product_groups
         WHERE upper(btrim(name)) = 'GLOW METALIC'
         LIMIT 1;
      END IF;

      IF v_measure_id IS NULL OR v_color_id IS NULL OR v_base_group_id IS NULL THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.product_groups g
         WHERE g.id = v_base_group_id
           AND upper(btrim(g.name)) IN ('GLOW METALIC', 'GLOW METALLIC')
      ) THEN
        CONTINUE;
      END IF;

      SELECT av.id, av.finished_product_id
        INTO v_variant_id, v_finished_id
        FROM public.artisanal_strap_variants av
       WHERE av.measure_id = v_measure_id
         AND av.base_group_id = v_base_group_id
         AND av.color_id = v_color_id
         AND av.identity_basis = 'reference_base'
         AND av.status = 'active'
         AND COALESCE(av.internal_production_enabled, false)
       LIMIT 1;
      IF v_variant_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT r.id INTO v_recipe_id
        FROM public.artisanal_strap_recipes r
       WHERE r.measure_id = v_measure_id
         AND r.base_group_id = v_base_group_id
         AND r.status = 'approved'
         AND r.valid_from <= now()
         AND (r.valid_to IS NULL OR r.valid_to > now())
       LIMIT 1;

      SELECT o.official_product_id INTO v_base_product_id
        FROM public.base_material_color_official_products o
       WHERE o.base_group_id = v_base_group_id
         AND o.color_id = v_color_id
         AND o.status = 'active'
       LIMIT 1;

      -- Sem oficial: usa o unico candidato linear (nao grava designation —
      -- exige approved_by de profiles; o writer do PV materializa depois).
      IF v_base_product_id IS NULL
         AND (
           SELECT count(*) FROM public.products p
            WHERE p.group_id = v_base_group_id
              AND COALESCE(p.active, true)
              AND lower(COALESCE(p.unit, '')) = 'm'
              AND public.resolve_strap_canonical_color_id(p.color) = v_color_id
         ) = 1 THEN
        SELECT p.id INTO v_base_product_id
          FROM public.products p
         WHERE p.group_id = v_base_group_id
           AND COALESCE(p.active, true)
           AND lower(COALESCE(p.unit, '')) = 'm'
           AND public.resolve_strap_canonical_color_id(p.color) = v_color_id
         LIMIT 1;
      END IF;

      IF v_recipe_id IS NULL OR v_base_product_id IS NULL THEN
        CONTINUE;
      END IF;

      IF (v_entry ->> 'strap_variant_id') IS NOT DISTINCT FROM v_variant_id::text
         AND (v_entry ->> 'recipe_id') IS NOT DISTINCT FROM v_recipe_id::text
         AND (v_entry ->> 'base_product_id')
             IS NOT DISTINCT FROM v_base_product_id::text THEN
        CONTINUE;
      END IF;

      v_source := v_entry
        || jsonb_build_object(
             'strap_variant_id', v_variant_id,
             'recipe_id', v_recipe_id,
             'base_product_id', v_base_product_id,
             'finished_product_id', v_finished_id,
             'source_mode', 'internal',
             'measure_id', v_measure_id,
             'base_group_id', v_base_group_id,
             'color_id', v_color_id
           );
      v_new := jsonb_set(v_new, ARRAY[v_line_id], v_source, true);
      v_changed := true;
    END LOOP;

    IF v_changed THEN
      UPDATE public.sale_order_items
         SET strap_sourcing = v_new
       WHERE id = v_item.id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Itens de PV com strap_sourcing GLOW realinhado: %', v_updated;
END
$resync$;

DO $post$
DECLARE
  v_glow uuid;
  v_missing integer;
BEGIN
  SELECT id INTO v_glow
    FROM public.product_groups
   WHERE upper(btrim(name)) = 'GLOW METALIC'
   LIMIT 1;
  IF v_glow IS NULL THEN
    RETURN;
  END IF;

  -- Toda cor linear ativa de GLOW com receita aprovada precisa de variante.
  SELECT count(*)::integer
    INTO v_missing
    FROM public.artisanal_strap_recipes r
    CROSS JOIN LATERAL (
      SELECT DISTINCT public.resolve_strap_canonical_color_id(p.color) AS color_id
        FROM public.products p
       WHERE p.group_id = v_glow
         AND COALESCE(p.active, true)
         AND lower(COALESCE(p.unit, '')) = 'm'
         AND public.resolve_strap_canonical_color_id(p.color) IS NOT NULL
    ) colors
   WHERE r.base_group_id = v_glow
     AND r.status = 'approved'
     AND r.valid_from <= now()
     AND (r.valid_to IS NULL OR r.valid_to > now())
     AND NOT EXISTS (
       SELECT 1
         FROM public.artisanal_strap_variants av
        WHERE av.measure_id = r.measure_id
          AND av.base_group_id = v_glow
          AND av.color_id = colors.color_id
          AND av.identity_basis = 'reference_base'
          AND av.status = 'active'
          AND COALESCE(av.internal_production_enabled, false)
     );

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'Pos-condicao: faltam % variantes ativas GLOW×medida×cor',
      v_missing;
  END IF;
END
$post$;

COMMIT;
