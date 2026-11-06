-- =============================================================================
-- overlock-tira3-fonte-unica-rendimento (45800)
-- =============================================================================
-- Decisões do dono (grill 06/11/2026, confirmado):
--   Q1  rendimento só em strap_group_napa_yields; sem linha → bloqueia
--   Q2  backfill group_id de SKUs de tira + trava
--   Q4  receita Hub deixa de alimentar o cálculo
--   Q9  sempre_fabrica nunca fica sku_acabado/buy_ready por grupo legado
--   Q10 TIRA 3 Overlock = 48 cm/par
--   Q11 apaga TIRA 4; Q12 TRASEIRA 120; Q14 SP130 canônica sem fantasmas
--   Q15 one-shot force refresh + enqueue híbridos
--   Q16 coerção por origem_padrao = sempre_fabrica
--   Q17/Q18 save da ficha = replace + label único; PVs não terminais re-congelam
--
-- Marcador: overlock_tira3_fonte_unica_rendimento_458
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Yield: só grupo; sem fallback de receita Hub
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enrich_consumo_strap_preview_recipe_yield(
  p_preview jsonb,
  p_line_measure_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  -- overlock_tira3_fonte_unica_rendimento_458
  v_preview jsonb := COALESCE(p_preview, '{}'::jsonb);
  v_resolved jsonb;
  v_source text;
  v_yield numeric;
  v_gross numeric;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_strap_group_id uuid;
  v_color_id uuid;
  v_base_product_id uuid;
  v_base_product_name text;
  v_reasons jsonb;
  v_soft text[] := ARRAY[
    'variant_identity_not_persisted',
    'frozen_source_snapshot_stale',
    'reference_base_intent_mismatch',
    'catalog_resolution_blocked'
  ];
  v_measure_name text;
  v_pinned_recipe_id uuid;
  v_pinned_measure_id uuid;
  v_stale_pin boolean := false;
  v_group_yield numeric;
  v_finished_product_id uuid;
BEGIN
  v_source := NULLIF(pg_catalog.btrim(v_preview ->> 'source_mode'), '');
  IF v_source IS DISTINCT FROM 'internal' THEN
    RETURN v_preview;
  END IF;

  v_resolved := CASE
    WHEN pg_catalog.jsonb_typeof(v_preview -> 'resolved') = 'object'
      THEN v_preview -> 'resolved'
    ELSE '{}'::jsonb
  END;

  -- Q1: nunca seedar yield da receita/snapshot — só strap_group_napa_yields.
  v_yield := NULL;

  BEGIN
    v_gross := NULLIF(v_preview ->> 'gross_required_m', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_gross := NULL;
  END;

  v_measure_id := COALESCE(
    p_line_measure_id,
    public.try_parse_uuid(v_resolved ->> 'measure_id')
  );
  v_base_group_id := public.try_parse_uuid(v_resolved ->> 'base_group_id');
  v_color_id := public.try_parse_uuid(v_resolved ->> 'color_id');
  v_measure_name := NULLIF(pg_catalog.btrim(v_resolved ->> 'measure_name'), '');

  IF v_measure_id IS NULL AND v_measure_name IS NOT NULL THEN
    SELECT m.id INTO v_measure_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '') = v_measure_name
        OR NULLIF(pg_catalog.btrim(m.display_name), '') = v_measure_name
     ORDER BY CASE
                WHEN NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '') = v_measure_name
                  THEN 0 ELSE 1
              END
     LIMIT 1;
  END IF;

  v_pinned_recipe_id := COALESCE(
    public.try_parse_uuid(v_preview ->> 'recipe_id'),
    public.try_parse_uuid(v_resolved -> 'catalog' ->> 'recipe_id')
  );
  IF v_measure_id IS NOT NULL AND v_pinned_recipe_id IS NOT NULL THEN
    SELECT r.measure_id INTO v_pinned_measure_id
      FROM public.artisanal_strap_recipes r WHERE r.id = v_pinned_recipe_id;
    IF v_pinned_measure_id IS DISTINCT FROM v_measure_id THEN
      v_stale_pin := true;
      v_yield := NULL;
      v_preview := v_preview || pg_catalog.jsonb_build_object('recipe_id', NULL);
      v_resolved := (v_resolved - 'confirmed_yield_m_per_m' - 'base_required_m')
        || pg_catalog.jsonb_build_object('recipe_yield_stale_overlay', true);
    END IF;
  END IF;

  v_finished_product_id := COALESCE(
    public.try_parse_uuid(v_preview ->> 'finished_product_id'),
    public.try_parse_uuid(v_resolved ->> 'finished_product_id'),
    public.try_parse_uuid(v_resolved -> 'catalog' ->> 'finished_product_id')
  );

  IF v_finished_product_id IS NOT NULL THEN
    v_strap_group_id := private.resolve_artisanal_strap_group_id_from_product(
      v_finished_product_id
    );
  END IF;
  IF v_strap_group_id IS NULL THEN
    v_strap_group_id := COALESCE(
      public.try_parse_uuid(v_resolved ->> 'identity_group_id'),
      public.try_parse_uuid(v_resolved -> 'catalog' ->> 'identity_group_id'),
      public.try_parse_uuid(v_resolved ->> 'strap_group_id')
    );
    IF v_strap_group_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_groups g
       WHERE g.id = v_strap_group_id AND coalesce(g.is_artisanal_strap, false)
    ) THEN
      v_strap_group_id := NULL;
    END IF;
  END IF;

  -- Mapa medida → grupo quando o SKU/identity ainda não resolveu.
  IF v_strap_group_id IS NULL AND v_measure_id IS NOT NULL THEN
    SELECT map.strap_group_id INTO v_strap_group_id
      FROM public.strap_hub_measure_group_map map
     WHERE map.measure_id = v_measure_id
     LIMIT 1;
  END IF;

  IF v_strap_group_id IS NOT NULL AND v_base_group_id IS NOT NULL THEN
    SELECT y.yield_m_per_m INTO v_group_yield
      FROM public.strap_group_napa_yields y
     WHERE y.strap_group_id = v_strap_group_id AND y.napa_group_id = v_base_group_id;
    IF coalesce(v_group_yield, 0) > 0 THEN
      v_yield := v_group_yield;
      v_resolved := v_resolved || pg_catalog.jsonb_build_object(
        'confirmed_yield_m_per_m', v_yield,
        'base_required_m', CASE
          WHEN COALESCE(v_gross, 0) > 0 THEN v_gross / v_yield
          ELSE NULLIF(v_resolved ->> 'base_required_m', '')::numeric
        END,
        'strap_group_id', v_strap_group_id,
        'group_yield_preferred', true
      );
    END IF;
  END IF;

  -- Sem rendimento no grupo: BLOQUEIA (Q3). Não cai mais na receita Hub.
  IF v_yield IS NULL OR v_yield <= 0 THEN
    v_preview := v_preview || pg_catalog.jsonb_build_object(
      'resolved', v_resolved,
      'blocking_reasons', COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'group_yield_missing',
          'field', 'confirmed_yield_m_per_m',
          'message',
            'Sem rendimento no grupo da tira × napa. '
            || 'Cadastre em Estoque → grupo da tira (Rendimento).'
        )));
    RETURN v_preview;
  END IF;

  IF COALESCE(v_gross, 0) > 0 AND NULLIF(v_resolved ->> 'base_required_m', '') IS NULL THEN
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'base_required_m', v_gross / v_yield
    );
  END IF;

  IF public.try_parse_uuid(v_preview ->> 'base_product_id') IS NULL
     AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
    SELECT o.official_product_id, p.name
      INTO v_base_product_id, v_base_product_name
      FROM public.base_material_color_official_products o
      JOIN public.products p ON p.id = o.official_product_id
     WHERE o.base_group_id = v_base_group_id AND o.color_id = v_color_id
       AND o.status = 'active' AND p.active
     LIMIT 1;
    IF v_base_product_id IS NULL THEN
      SELECT p.id, p.name INTO v_base_product_id, v_base_product_name
        FROM public.products p
        JOIN public.canonical_colors c ON c.id = v_color_id
       WHERE p.group_id = v_base_group_id AND p.active
         AND lower(COALESCE(p.unit, '')) IN ('m', 'metro', 'metros')
         AND lower(pg_catalog.btrim(COALESCE(p.color, '')))
             = lower(pg_catalog.btrim(COALESCE(c.name, '')))
       ORDER BY p.created_at
       LIMIT 1;
    END IF;
    IF v_base_product_id IS NOT NULL THEN
      v_preview := v_preview || pg_catalog.jsonb_build_object(
        'base_product_id', v_base_product_id
      );
      v_resolved := v_resolved || pg_catalog.jsonb_build_object(
        'base_product_name', v_base_product_name
      );
    END IF;
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(reason.value ORDER BY reason.ordinality), '[]'::jsonb)
    INTO v_reasons
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
    ) WITH ORDINALITY reason(value, ordinality)
   WHERE NOT (
     COALESCE(v_yield, 0) > 0
     AND COALESCE(reason.value ->> 'code', '') = ANY (v_soft)
   );

  RETURN v_preview || pg_catalog.jsonb_build_object(
    'resolved', v_resolved,
    'blocking_reasons', v_reasons
  );
END;
$function$;

COMMENT ON FUNCTION private.enrich_consumo_strap_preview_recipe_yield(jsonb, uuid) IS
  'Preview consumo/PV: rendimento SÓ de strap_group_napa_yields; sem linha → bloqueia. Sem fallback de receita Hub (Q1/Q3 grill 06/11/2026).';

-- -----------------------------------------------------------------------------
-- B) Normaliza linha: sempre_fabrica → fabrica + grupo do mapa da medida
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.normalize_strap_line_sempre_fabrica(p_line jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_line jsonb := COALESCE(p_line, '{}'::jsonb);
  v_measure_id uuid;
  v_origem text;
  v_map_group uuid;
  v_map_name text;
  v_pv text;
BEGIN
  -- overlock_tira3_fonte_unica_rendimento_458
  v_measure_id := public.try_parse_uuid(v_line ->> 'measure_id');
  IF v_measure_id IS NULL THEN
    RETURN v_line;
  END IF;

  SELECT m.origem_padrao INTO v_origem
    FROM public.artisanal_strap_measures m
   WHERE m.id = v_measure_id;

  IF v_origem IS DISTINCT FROM 'sempre_fabrica' THEN
    RETURN v_line;
  END IF;

  SELECT map.strap_group_id, pg.name
    INTO v_map_group, v_map_name
    FROM public.strap_hub_measure_group_map map
    JOIN public.product_groups pg ON pg.id = map.strap_group_id
   WHERE map.measure_id = v_measure_id
   LIMIT 1;

  IF v_map_group IS NOT NULL THEN
    v_line := v_line
      || jsonb_build_object(
           'group_id', v_map_group,
           'group_name', v_map_name
         );
    IF COALESCE(v_line ->> 'identity_basis', '') = 'finished_product_group' THEN
      v_line := v_line || jsonb_build_object('identity_group_id', v_map_group);
    END IF;
  END IF;

  v_pv := NULLIF(btrim(v_line ->> 'pv_origem'), '');
  IF v_pv IS NULL OR v_pv IN ('sku_acabado', 'fornecedor') THEN
    v_line := v_line || jsonb_build_object('pv_origem', 'fabrica');
  END IF;

  RETURN v_line;
END;
$fn$;

COMMENT ON FUNCTION private.normalize_strap_line_sempre_fabrica(jsonb) IS
  'Q16: medida sempre_fabrica remapeia group_id pelo mapa Hub→estoque e força pv_origem=fabrica (nunca buy_ready por grupo Chata legado).';

CREATE OR REPLACE FUNCTION private.normalize_strap_colors_array(p_colors jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
BEGIN
  IF jsonb_typeof(p_colors) IS DISTINCT FROM 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_colors)
  LOOP
    v_out := v_out || jsonb_build_array(
      private.normalize_strap_line_sempre_fabrica(v_elem)
    );
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- C) Trigger: ficha — label único + normalização sempre_fabrica (replace = UI)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_technical_sheet_strap_colors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_dup text;
BEGIN
  -- overlock_tira3_fonte_unica_rendimento_458
  IF NEW.strap_colors IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.strap_colors) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser um array JSON'
      USING ERRCODE = '22023';
  END IF;

  NEW.strap_colors := private.normalize_strap_colors_array(NEW.strap_colors);

  SELECT upper(btrim(elem ->> 'label')) INTO v_dup
    FROM jsonb_array_elements(NEW.strap_colors) elem
   WHERE NULLIF(btrim(elem ->> 'label'), '') IS NOT NULL
   GROUP BY upper(btrim(elem ->> 'label'))
  HAVING count(*) > 1
   LIMIT 1;

  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION
      'Ficha com label de tira duplicado (%) — remova a linha fantasma antes de salvar. A ficha é replace total: o que não está na tela não pode ficar no JSON.',
      v_dup
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_technical_sheet_strap_colors
  ON public.technical_sheets;
CREATE TRIGGER trg_validate_technical_sheet_strap_colors
BEFORE INSERT OR UPDATE OF strap_colors
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.tg_validate_technical_sheet_strap_colors();

-- -----------------------------------------------------------------------------
-- D) Trigger: item do PV — mesma coerção sempre_fabrica
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_normalize_sale_order_item_strap_colors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- overlock_tira3_fonte_unica_rendimento_458
  IF NEW.strap_colors IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.strap_colors := private.normalize_strap_colors_array(NEW.strap_colors);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_normalize_sale_order_item_strap_colors
  ON public.sale_order_items;
CREATE TRIGGER trg_normalize_sale_order_item_strap_colors
BEFORE INSERT OR UPDATE OF strap_colors
ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_normalize_sale_order_item_strap_colors();

-- -----------------------------------------------------------------------------
-- E) Propagate: PVs não terminais (Q20)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_sheet_straps_to_open_pvs(p_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_next jsonb;
  v_clean jsonb;
  v_next_sourcing jsonb;
  v_prepared jsonb;
  v_sourcing_changed boolean;
  v_colors_changed boolean;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_skipped_started integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sqlstate text;
  v_message text;
BEGIN
  -- strap_structure_consumption_wins_open_pvs_455
  -- overlock_tira3_fonte_unica_rendimento_458 (status não terminal)
  IF NOT private.can_propagate_sheet_straps() THEN
    RAISE EXCEPTION 'Somente Produção/Gerência/Comercial pode propagar tiras da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'updated_items', 0,
      'unchanged_items', 0,
      'skipped_started_items', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  PERFORM set_config(
    'app.sale_order_item_strap_context_reference_id',
    p_sheet_id::text,
    true
  );
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  FOR v_item IN
    SELECT i.*
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id = i.sale_order_id
     WHERE i.reference_id = p_sheet_id
       AND i.production_excluded_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Faturado', 'Cancelado', 'Cancelada',
         'Finalizado s/ NF', 'Concluído', 'Entregue'
       )
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM public.orders o
         WHERE o.sale_order_item_id = v_item.id
           AND o.deleted_at IS NULL
           AND lower(COALESCE(o.status, '')) NOT IN ('cancelado', 'cancelada')
           AND (
             EXISTS (
               SELECT 1 FROM public.order_stages os
                WHERE os.order_id = o.id
                  AND (
                    COALESCE(os.quantity_processed, 0) > 0
                    OR os.started_at IS NOT NULL
                    OR os.completed_at IS NOT NULL
                    OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
                  )
             )
             OR EXISTS (
               SELECT 1 FROM public.production_pointings pp
                WHERE pp.order_id = o.id
             )
             OR EXISTS (
               SELECT 1 FROM public.production_consumptions pc
                WHERE pc.order_id = o.id
                  AND pc.superseded_at IS NULL
                  AND COALESCE(pc.actual_quantity, 0) > 0
             )
           )
      ) THEN
        v_skipped_started := v_skipped_started + 1;
        CONTINUE;
      END IF;

      v_next := private.merge_consumo_strap_colors_with_sheet_gaps(
        COALESCE(v_item.strap_colors, '[]'::jsonb),
        v_item.reference_id,
        true
      );
      v_clean := private.strip_consumo_strap_report_flags(v_next);
      v_clean := private.normalize_strap_colors_array(v_clean);

      v_colors_changed := v_clean IS DISTINCT FROM COALESCE(v_item.strap_colors, '[]'::jsonb);
      IF NOT v_colors_changed THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      IF NOT private.strap_colors_require_recipe_revalidate(
           COALESCE(v_item.strap_colors, '[]'::jsonb),
           v_clean
         )
      THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      PERFORM set_config('app.strap_source_rpc', '1', true);
      PERFORM set_config('app.strap_force_revalidate', '1', true);
      v_prepared := public.prepare_sale_order_item_internal_straps(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'strap_colors', v_clean,
          'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb)
        )
      );
      v_clean := COALESCE(v_prepared -> 'item' -> 'strap_colors', v_clean);
      v_clean := private.normalize_strap_colors_array(v_clean);
      v_next_sourcing := COALESCE(
        v_prepared -> 'item' -> 'strap_sourcing',
        '{}'::jsonb
      );
      v_sourcing_changed := v_next_sourcing IS DISTINCT FROM COALESCE(v_item.strap_sourcing, '{}'::jsonb);

      IF v_sourcing_changed THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean,
               strap_sourcing = v_next_sourcing,
               strap_sourcing_revision = COALESCE(
                 nullif(v_prepared -> 'item' ->> 'strap_sourcing_revision', '')::bigint,
                 strap_sourcing_revision
               )
         WHERE id = v_item.id;
      ELSE
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
      END IF;
      v_updated := v_updated + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'color', v_item.color,
        'sqlstate', v_sqlstate,
        'message', v_message
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sheet_id', p_sheet_id,
    'updated_items', v_updated,
    'unchanged_items', v_unchanged,
    'skipped_started_items', v_skipped_started,
    'errors', v_errors
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- F) Backfill products.group_id + trigger (Q2/Q6)
-- -----------------------------------------------------------------------------
WITH named AS (
  SELECT p.id AS product_id,
         CASE
           WHEN p.name ILIKE 'TIRA OVERLOCK 5%'
             THEN 'e0301b34-7963-448d-a12a-33a897439282'::uuid
           WHEN p.name ILIKE 'TIRA CHATA 8%'
             THEN (SELECT id FROM public.product_groups WHERE name = 'TIRA CHATA 8MM' LIMIT 1)
           WHEN p.name ILIKE 'TRANÇA 3%' OR p.name ILIKE 'TRANCA 3%'
             THEN COALESCE(
               (SELECT map.strap_group_id
                  FROM public.strap_hub_measure_group_map map
                  JOIN public.artisanal_strap_measures m ON m.id = map.measure_id
                  JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
                 WHERE t.name ILIKE 'TRANÇA%' OR t.name ILIKE 'TRANCA%'
                 LIMIT 1),
               (SELECT id FROM public.product_groups
                 WHERE name ILIKE 'TRANÇA%' OR name ILIKE 'TRANCA%'
                 ORDER BY CASE WHEN name ILIKE 'TRANÇA' OR name ILIKE 'TRANCA' THEN 0 ELSE 1 END
                 LIMIT 1)
             )
           WHEN p.name ILIKE 'Overlock Redonda 6%'
             THEN (SELECT id FROM public.product_groups WHERE name = 'OVERLOCK REDONDA 6MM' LIMIT 1)
           ELSE NULL
         END AS group_id
    FROM public.products p
   WHERE p.group_id IS NULL
     AND p.strap_base_group_id IS NOT NULL
)
UPDATE public.products p
   SET group_id = n.group_id
  FROM named n
 WHERE p.id = n.product_id
   AND n.group_id IS NOT NULL
   AND p.group_id IS NULL;

-- Writer legado reference_base: INSERT sem group_id (Q6). Patch cirúrgico.
DO $patch_writer$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  -- overlock_tira3_fonte_unica_rendimento_458
  v_def := pg_get_functiondef(
    'public.save_artisanal_strap_catalog_bundle_reference_base_legacy(jsonb,text)'::regprocedure
  );
  v_old := $old$INSERT INTO public.products (
      name, sku, category, quantity, min_stock, unit, unit_price, location,
      active, is_artisanal, supplier_id, purchase_unit,
      conversion_rate, purchase_price, min_order_quantity, purchase_multiple,
      material_preparation_days
    ) VALUES (
      v_product_payload ->> 'name',
      v_product_payload ->> 'sku',
      coalesce(nullif(v_product_payload ->> 'category', ''), 'Tiras Artesanais'),
      0, 0, 'm', coalesce((v_product_payload ->> 'unit_price')::numeric, 0), '',
      false, true,
      nullif(v_product_payload ->> 'supplier_id', '')::uuid,
      v_product_payload ->> 'purchase_unit',
      (v_product_payload ->> 'conversion_rate')::numeric,
      (v_product_payload ->> 'purchase_price')::numeric,
      (v_product_payload ->> 'min_order_quantity')::numeric,
      (v_product_payload ->> 'purchase_multiple')::numeric,
      coalesce((v_product_payload ->> 'material_preparation_days')::integer, 2)
    ) RETURNING * INTO v_product;$old$;
  v_new := $new$INSERT INTO public.products (
      name, sku, category, group_id, strap_base_group_id, quantity, min_stock, unit, unit_price, location,
      active, is_artisanal, supplier_id, purchase_unit,
      conversion_rate, purchase_price, min_order_quantity, purchase_multiple,
      material_preparation_days
    ) VALUES (
      v_product_payload ->> 'name',
      v_product_payload ->> 'sku',
      coalesce(nullif(v_product_payload ->> 'category', ''), 'Tiras Artesanais'),
      (SELECT map.strap_group_id
         FROM public.strap_hub_measure_group_map map
        WHERE map.measure_id = v_measure_id
        LIMIT 1),
      v_base_group_id,
      0, 0, 'm', coalesce((v_product_payload ->> 'unit_price')::numeric, 0), '',
      false, true,
      nullif(v_product_payload ->> 'supplier_id', '')::uuid,
      v_product_payload ->> 'purchase_unit',
      (v_product_payload ->> 'conversion_rate')::numeric,
      (v_product_payload ->> 'purchase_price')::numeric,
      (v_product_payload ->> 'min_order_quantity')::numeric,
      (v_product_payload ->> 'purchase_multiple')::numeric,
      coalesce((v_product_payload ->> 'material_preparation_days')::integer, 2)
    ) RETURNING * INTO v_product;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      '458: INSERT do writer reference_base_legacy mudou de forma — revisar patch group_id';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_writer$;

CREATE OR REPLACE FUNCTION public.tg_require_strap_product_group_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- overlock_tira3_fonte_unica_rendimento_458
  IF NEW.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Writer de tira artesanal: nasce com strap_base_group_id e/ou is_artisanal.
  -- Não barra UPDATE cosmético de produto legado órfão (só INSERT / novo vínculo).
  IF TG_OP = 'INSERT'
     AND (
       NEW.strap_base_group_id IS NOT NULL
       OR COALESCE(NEW.is_artisanal, false)
       OR NEW.name ~* '^(TIRA |TRANÇA |Overlock )'
     )
  THEN
    RAISE EXCEPTION
      'SKU de tira (%) precisa de group_id (grupo de estoque da tira). '
      || 'O writer legado sem grupo está bloqueado.',
      COALESCE(NEW.name, NEW.id::text)
      USING ERRCODE = '23502';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.strap_base_group_id IS NOT NULL
     AND (OLD.strap_base_group_id IS NULL OR OLD.strap_base_group_id IS DISTINCT FROM NEW.strap_base_group_id)
     AND NEW.group_id IS NULL
  THEN
    RAISE EXCEPTION
      'SKU de tira (%) precisa de group_id ao vincular napa-base.',
      COALESCE(NEW.name, NEW.id::text)
      USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_require_strap_product_group_id ON public.products;
CREATE TRIGGER trg_require_strap_product_group_id
BEFORE INSERT OR UPDATE OF group_id, strap_base_group_id, name, is_artisanal
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.tg_require_strap_product_group_id();

-- -----------------------------------------------------------------------------
-- G) SP130 canônica (Q10–Q14)
-- -----------------------------------------------------------------------------
DO $sp130$
DECLARE
  v_sheet_id uuid;
  v_soft uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'; -- NAPA SOFT (follow_reference base típica)
  v_chata_g uuid := '87b706a8-40ba-4019-9aee-b2f80ef81212';
  v_over_g uuid := 'e0301b34-7963-448d-a12a-33a897439282';
  v_chata_m uuid := '65628af5-8cb3-419a-8c54-3e2ac474ee5e';
  v_chata_t uuid := '96c66bb7-c920-4f07-ad75-24d7a3795fba';
  v_over_m uuid := '06500a23-801d-4627-a927-3ce7e5ee2619';
  v_over_t uuid := 'a69cb531-2d66-4931-9a71-8b06bec56eb0';
  v_cps42 jsonb := '{"34":42,"35":42,"36":42,"37":42,"38":42,"39":42,"40":42}'::jsonb;
  v_cps48 jsonb := '{"34":48,"35":48,"36":48,"37":48,"38":48,"39":48,"40":48}'::jsonb;
  v_cps120 jsonb := '{"34":120,"35":120,"36":120,"37":120,"38":120,"39":120,"40":120}'::jsonb;
  v_canonical jsonb;
  v_prop jsonb;
  v_so uuid;
  v_job uuid;
  r record;
BEGIN
  -- Preferir code=SP130: existe ficha fantasma name=SP130 com code vazio.
  SELECT id INTO v_sheet_id
    FROM public.technical_sheets
   WHERE code = 'SP130'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;
  IF v_sheet_id IS NULL THEN
    SELECT id INTO v_sheet_id
      FROM public.technical_sheets
     WHERE id = '1143c918-90f0-4eaf-9826-0831892930ca';
  END IF;
  IF v_sheet_id IS NULL THEN
    RAISE NOTICE '458: SP130 não encontrada — skip cleanup';
    RETURN;
  END IF;

  v_canonical := jsonb_build_array(
    jsonb_build_object(
      'id', '3fe15057-c946-42f6-8d39-33509ca7ff55',
      'technical_strap_line_id', '3fe15057-c946-42f6-8d39-33509ca7ff55',
      'label', 'TIRA 1',
      'group_id', v_chata_g,
      'group_name', 'TIRA CHATA COSTURADA 11MM',
      'measure_id', v_chata_m,
      'strap_type_id', v_chata_t,
      'consumption', 42,
      'consumption_per_size', v_cps42,
      'identity_basis', 'reference_base',
      'material_mode', 'follow_reference',
      'color_mode', 'follow_main',
      'pv_origem', NULL
    ),
    jsonb_build_object(
      'id', '44c26f7b-450b-470a-88a3-749b5cbef744',
      'technical_strap_line_id', '44c26f7b-450b-470a-88a3-749b5cbef744',
      'label', 'TIRA 2',
      'group_id', v_chata_g,
      'group_name', 'TIRA CHATA COSTURADA 11MM',
      'measure_id', v_chata_m,
      'strap_type_id', v_chata_t,
      'consumption', 42,
      'consumption_per_size', v_cps42,
      'identity_basis', 'reference_base',
      'material_mode', 'follow_reference',
      'color_mode', 'follow_main',
      'pv_origem', NULL
    ),
    jsonb_build_object(
      'id', '398e80d1-5e60-4283-8386-748a20238e12',
      'technical_strap_line_id', '398e80d1-5e60-4283-8386-748a20238e12',
      'label', 'TIRA 3',
      'group_id', v_over_g,
      'group_name', 'TIRA OVERLOCK 5MM',
      'measure_id', v_over_m,
      'strap_type_id', v_over_t,
      'consumption', 48,
      'consumption_per_size', v_cps48,
      'identity_basis', 'reference_base',
      'material_mode', 'follow_reference',
      'color_mode', 'follow_main',
      'pv_origem', 'fabrica',
      'base_group_name', 'NAPA SOFT'
    ),
    jsonb_build_object(
      'id', 'ae07ee32-bf58-4fd9-88ae-e782d92d1f43',
      'technical_strap_line_id', 'ae07ee32-bf58-4fd9-88ae-e782d92d1f43',
      'label', 'TRASEIRA',
      'group_id', v_over_g,
      'group_name', 'TIRA OVERLOCK 5MM',
      'measure_id', v_over_m,
      'strap_type_id', v_over_t,
      'consumption', 120,
      'consumption_per_size', v_cps120,
      'identity_basis', 'reference_base',
      'material_mode', 'follow_reference',
      'color_mode', 'follow_main',
      'pv_origem', 'fabrica',
      'base_group_name', 'NAPA SOFT'
    )
  );

  PERFORM set_config('app.strap_propagate_rpc', '1', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  UPDATE public.technical_sheets
     SET strap_colors = v_canonical,
         has_straps = true,
         updated_at = now()
   WHERE id = v_sheet_id;

  -- Force re-freeze mesmo com demanda current / OP sem apontamento (Q15)
  FOR r IN
    SELECT i.id AS item_id, i.sale_order_id, i.color, i.strap_colors, i.strap_sourcing,
           i.reference_id, i.material_variant_id
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id = i.sale_order_id
     WHERE i.reference_id = v_sheet_id
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Faturado', 'Cancelado', 'Cancelada',
         'Finalizado s/ NF', 'Concluído', 'Entregue'
       )
  LOOP
    DECLARE
      v_merged jsonb;
      v_prepared jsonb;
    BEGIN
      v_merged := private.merge_consumo_strap_colors_with_sheet_gaps(
        COALESCE(r.strap_colors, '[]'::jsonb),
        v_sheet_id,
        true
      );
      v_merged := private.strip_consumo_strap_report_flags(v_merged);
      v_merged := private.normalize_strap_colors_array(v_merged);

      PERFORM set_config('app.strap_source_rpc', '1', true);
      PERFORM set_config('app.strap_force_revalidate', '1', true);
      PERFORM set_config(
        'app.sale_order_item_strap_context_reference_id',
        v_sheet_id::text,
        true
      );

      BEGIN
        v_prepared := public.prepare_sale_order_item_internal_straps(
          jsonb_build_object(
            'id', r.item_id,
            'reference_id', r.reference_id,
            'material_variant_id', r.material_variant_id,
            'color', r.color,
            'strap_colors', v_merged,
            'strap_sourcing', COALESCE(r.strap_sourcing, '{}'::jsonb)
          )
        );
        UPDATE public.sale_order_items
           SET strap_colors = private.normalize_strap_colors_array(
                 COALESCE(v_prepared -> 'item' -> 'strap_colors', v_merged)
               ),
               strap_sourcing = COALESCE(
                 v_prepared -> 'item' -> 'strap_sourcing',
                 strap_sourcing
               ),
               strap_sourcing_revision = COALESCE(
                 nullif(v_prepared -> 'item' ->> 'strap_sourcing_revision', '')::bigint,
                 strap_sourcing_revision
               )
         WHERE id = r.item_id;
      EXCEPTION WHEN OTHERS THEN
        -- Mesmo se prepare falhar (buy_ready legado), grava cm/grupo da ficha.
        UPDATE public.sale_order_items
           SET strap_colors = v_merged
         WHERE id = r.item_id;
        RAISE WARNING '458 prepare item % (%): %', r.item_id, r.color, SQLERRM;
      END;
    END;
  END LOOP;

  -- Enqueue demandas dos PVs tocados
  FOR r IN
    SELECT DISTINCT so.id AS so_id, so.order_number
      FROM public.sale_orders so
      JOIN public.sale_order_items i ON i.sale_order_id = so.id
     WHERE i.reference_id = v_sheet_id
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Faturado', 'Cancelado', 'Cancelada',
         'Finalizado s/ NF', 'Concluído', 'Entregue'
       )
  LOOP
    BEGIN
      v_job := public.enqueue_sale_order_strap_demands(
        r.so_id, 'item_changed', gen_random_uuid()
      );
      UPDATE public.strap_demand_jobs
         SET status = 'processing',
             locked_at = now(),
             locked_by = 'repair-458',
             updated_at = now()
       WHERE id = v_job
         AND status IN ('queued', 'retry');
      PERFORM public.process_strap_demand_job(v_job, 'repair-458');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '458 enqueue/process %: %', r.order_number, SQLERRM;
    END;
  END LOOP;

  -- Guard SP130
  IF (
    SELECT jsonb_array_length(strap_colors)
      FROM public.technical_sheets WHERE id = v_sheet_id
  ) <> 4 THEN
    RAISE EXCEPTION '458: SP130 deveria ter 4 linhas canônicas';
  END IF;
END;
$sp130$;

-- -----------------------------------------------------------------------------
-- H) One-shot: demais híbridos (sempre_fabrica + sku_acabado) em PVs abertos
-- -----------------------------------------------------------------------------
DO $hybrids$
DECLARE
  r record;
  v_merged jsonb;
  v_prepared jsonb;
  v_job uuid;
BEGIN
  PERFORM set_config('app.strap_propagate_rpc', '1', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.strap_source_rpc', '1', true);
  PERFORM set_config('app.strap_force_revalidate', '1', true);

  FOR r IN
    SELECT DISTINCT i.id AS item_id, i.sale_order_id, i.color, i.strap_colors,
           i.strap_sourcing, i.reference_id, i.material_variant_id, so.order_number
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id = i.sale_order_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.strap_colors, '[]'::jsonb)) sc
      JOIN public.artisanal_strap_measures m
        ON m.id = public.try_parse_uuid(sc ->> 'measure_id')
     WHERE so.deleted_at IS NULL
       AND so.status NOT IN (
         'Faturado', 'Cancelado', 'Cancelada',
         'Finalizado s/ NF', 'Concluído', 'Entregue'
       )
       AND m.origem_padrao = 'sempre_fabrica'
       AND (
         COALESCE(sc ->> 'pv_origem', '') IN ('sku_acabado', 'fornecedor')
         OR (
           public.try_parse_uuid(sc ->> 'group_id') IS DISTINCT FROM (
             SELECT map.strap_group_id
               FROM public.strap_hub_measure_group_map map
              WHERE map.measure_id = m.id
              LIMIT 1
           )
         )
       )
  LOOP
    BEGIN
      v_merged := private.normalize_strap_colors_array(
        COALESCE(r.strap_colors, '[]'::jsonb)
      );
      IF r.reference_id IS NOT NULL THEN
        v_merged := private.normalize_strap_colors_array(
          private.strip_consumo_strap_report_flags(
            private.merge_consumo_strap_colors_with_sheet_gaps(
              v_merged, r.reference_id, true
            )
          )
        );
      END IF;

      BEGIN
        v_prepared := public.prepare_sale_order_item_internal_straps(
          jsonb_build_object(
            'id', r.item_id,
            'reference_id', r.reference_id,
            'material_variant_id', r.material_variant_id,
            'color', r.color,
            'strap_colors', v_merged,
            'strap_sourcing', COALESCE(r.strap_sourcing, '{}'::jsonb)
          )
        );
        UPDATE public.sale_order_items
           SET strap_colors = private.normalize_strap_colors_array(
                 COALESCE(v_prepared -> 'item' -> 'strap_colors', v_merged)
               ),
               strap_sourcing = COALESCE(
                 v_prepared -> 'item' -> 'strap_sourcing',
                 strap_sourcing
               )
         WHERE id = r.item_id;
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_merged
         WHERE id = r.item_id;
        RAISE WARNING '458 hybrid prepare %: %', r.item_id, SQLERRM;
      END;

      v_job := public.enqueue_sale_order_strap_demands(
        r.sale_order_id, 'item_changed', gen_random_uuid()
      );
      BEGIN
        UPDATE public.strap_demand_jobs
           SET status = 'processing',
               locked_at = now(),
               locked_by = 'repair-458-hybrid',
               updated_at = now()
         WHERE id = v_job AND status IN ('queued', 'retry');
        PERFORM public.process_strap_demand_job(v_job, 'repair-458-hybrid');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '458 hybrid process %: %', r.order_number, SQLERRM;
      END;
    END;
  END LOOP;
END;
$hybrids$;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'private.enrich_consumo_strap_preview_recipe_yield(jsonb,uuid)'::regprocedure
  );
  IF position('recipe_yield_fallback' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Guard 458: enrich ainda tem fallback de receita';
  END IF;
  IF position('group_yield_missing' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guard 458: enrich sem bloqueio group_yield_missing';
  END IF;
  IF to_regprocedure('private.normalize_strap_line_sempre_fabrica(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Guard 458: normalize_strap_line_sempre_fabrica ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_validate_technical_sheet_strap_colors'
  ) THEN
    RAISE EXCEPTION 'Guard 458: trigger de label único ausente';
  END IF;
  IF position('group_id, strap_base_group_id' IN pg_get_functiondef(
    'public.save_artisanal_strap_catalog_bundle_reference_base_legacy(jsonb,text)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'Guard 458: writer legado ainda INSERT sem group_id';
  END IF;
END;
$guard$;
