-- Consumo: rendimento da receita aprovada do Hub na lista de compra.
--
-- PV-00194: Hub mostra ELÁSTICO FORRADO 7 mm × NAPA SOFT = 30 m/m Confirmado,
-- mas o preview do consumo marcava "rendimento pendente" porque:
--   1) overlay 232 remove pins de variante/receita da TIRA CHATA;
--   2) resolve_artisanal_strap_catalog exige variante ativa por cor — ELÁSTICO
--      ainda não tem variante → catalog_resolution_blocked → yield NULL;
--   3) mesmo MEIA CANA (yield 55 ok) ganhava blocking soft
--      (variant_identity_not_persisted / frozen_source_snapshot_stale) e o
--      frontend tratava QUALQUER blocking como pending.
--
-- Este patch, só na apresentação do batch:
--   - se origem internal sem confirmed_yield, busca receita aprovada vigente
--     por (medida da linha overlay/merge × base_group_id do resolved);
--   - preenche recipe_id / yield / base_required_m;
--   - tenta SKU oficial da cor quando base_product_id ainda é null;
--   - remove blockers soft de apresentação quando o yield já conversível.
-- Marca: consumo_recipe_yield_fallback_presentation_233

BEGIN;

CREATE OR REPLACE FUNCTION private.enrich_consumo_strap_preview_recipe_yield(
  p_preview jsonb,
  p_line_measure_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  -- consumo_recipe_yield_fallback_presentation_233
  v_preview jsonb := COALESCE(p_preview, '{}'::jsonb);
  v_resolved jsonb;
  v_source text;
  v_yield numeric;
  v_gross numeric;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_color_id uuid;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
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

  BEGIN
    v_yield := NULLIF(v_resolved ->> 'confirmed_yield_m_per_m', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_yield := NULL;
  END;

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
    SELECT m.id
      INTO v_measure_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '')
             = v_measure_name
        OR NULLIF(pg_catalog.btrim(m.display_name), '') = v_measure_name
     ORDER BY CASE
                WHEN NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '')
                       = v_measure_name THEN 0
                ELSE 1
              END
     LIMIT 1;
  END IF;

  IF v_yield IS NULL OR v_yield <= 0 THEN
    IF v_measure_id IS NULL OR v_base_group_id IS NULL THEN
      RETURN v_preview;
    END IF;

    SELECT r.*
      INTO v_recipe
      FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_measure_id
       AND r.base_group_id = v_base_group_id
       AND r.status = 'approved'
       AND r.valid_from <= pg_catalog.now()
       AND (r.valid_to IS NULL OR r.valid_to > pg_catalog.now())
     ORDER BY r.version DESC, r.approved_at DESC NULLS LAST
     LIMIT 1;

    IF v_recipe.id IS NULL OR COALESCE(v_recipe.confirmed_yield_m_per_m, 0) <= 0 THEN
      RETURN v_preview;
    END IF;

    v_yield := v_recipe.confirmed_yield_m_per_m;
    v_preview := v_preview || pg_catalog.jsonb_build_object(
      'recipe_id', v_recipe.id
    );
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'confirmed_yield_m_per_m', v_yield,
      'base_required_m', CASE
        WHEN COALESCE(v_gross, 0) > 0 THEN v_gross / v_yield
        ELSE NULL
      END,
      'cut_band_width_mm', v_recipe.cut_band_width_mm,
      'usable_base_width_mm_snapshot', v_recipe.usable_base_width_mm_snapshot,
      'theoretical_yield_m_per_m', v_recipe.theoretical_yield_m_per_m,
      'measure_id', v_measure_id,
      'recipe_yield_fallback', true
    );
  ELSIF COALESCE(v_gross, 0) > 0
     AND NULLIF(v_resolved ->> 'base_required_m', '') IS NULL THEN
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'base_required_m', v_gross / v_yield
    );
  END IF;

  IF public.try_parse_uuid(v_preview ->> 'base_product_id') IS NULL
     AND v_base_group_id IS NOT NULL
     AND v_color_id IS NOT NULL
  THEN
    SELECT o.official_product_id, p.name
      INTO v_base_product_id, v_base_product_name
      FROM public.base_material_color_official_products o
      JOIN public.products p ON p.id = o.official_product_id
     WHERE o.base_group_id = v_base_group_id
       AND o.color_id = v_color_id
       AND o.status = 'active'
       AND p.active
     LIMIT 1;

    IF v_base_product_id IS NULL THEN
      SELECT p.id, p.name
        INTO v_base_product_id, v_base_product_name
        FROM public.products p
        JOIN public.canonical_colors c ON c.id = v_color_id
       WHERE p.group_id = v_base_group_id
         AND p.active
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

  v_preview := v_preview
    || pg_catalog.jsonb_build_object(
         'resolved', v_resolved,
         'blocking_reasons', v_reasons
       );

  RETURN v_preview;
END;
$function$;

REVOKE ALL ON FUNCTION private.enrich_consumo_strap_preview_recipe_yield(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enrich_consumo_strap_preview_recipe_yield(jsonb, uuid)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.calculate_consumption_report_batch(
  p_sale_order_ids uuid[] DEFAULT NULL::uuid[],
  p_order_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- unresolved_names_ficha_20270101020700
  -- sheet_strap_gap_consumo_211
  -- sheet_strap_structure_overlay_consumo_231
  -- sheet_strap_overlay_sourcing_sanitize_232
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_report jsonb;
  v_lines jsonb;
  v_previews jsonb := '[]'::jsonb;
  v_scope record;
  v_preview record;
  v_preview_payload jsonb;
  v_effective_grade jsonb;
  v_main_production_start date;
  v_schedule_revision integer;
  v_merged_straps jsonb;
  v_gap_ids text[] := ARRAY[]::text[];
  v_preview_json jsonb;
  v_item_line_ids text[];
  v_sale_order_status text;
  v_overlay_structure boolean;
  -- sheet_strap_overlay_sourcing_sanitize_232
  -- consumo_recipe_yield_fallback_presentation_233
  v_line jsonb;
  v_strap_sourcing jsonb;
  v_overlay_line_ids text[] := ARRAY[]::text[];
  v_overlay_measure_ids jsonb := '{}'::jsonb;
  v_line_id text;
  v_measure_id text;
  v_measure_label text;
BEGIN
  IF NOT v_is_service AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  v_report := private.calculate_consumption_report_batch_pre_20270101015500(
    p_sale_order_ids, p_order_ids
  );
  IF pg_catalog.jsonb_typeof(v_report -> 'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Relatorio-base devolveu lines invalido'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    CASE
      WHEN line.value ->> 'line_kind' = 'material' THEN
        line.value
        || (
          SELECT pg_catalog.jsonb_build_object(
                   'consumption_sector', sector.ctx -> 'consumption_sector',
                   'consumption_sector_source',
                     sector.ctx -> 'consumption_sector_source'
                 )
                 || CASE
                      WHEN sector.ctx ? 'consumption_sector_origin' THEN
                        pg_catalog.jsonb_build_object(
                          'consumption_sector_origin',
                          sector.ctx -> 'consumption_sector_origin'
                        )
                      ELSE '{}'::jsonb
                    END
          FROM (
            SELECT private.resolve_report_consumption_sector_context(
              line.value ->> 'scope_type',
              public.try_parse_uuid(line.value ->> 'scope_key'),
              public.try_parse_uuid(line.value ->> 'sale_order_id'),
              public.try_parse_uuid(line.value ->> 'sale_order_item_id'),
              public.try_parse_uuid(line.value ->> 'product_id'),
              line.value ->> 'component',
              line.value ->> 'source',
              pg_catalog.jsonb_build_object(
                'consumption_sector', line.value -> 'consumption_sector',
                'consumption_sector_source', COALESCE(
                  line.value ->> 'consumption_sector_source',
                  'legacy_fallback'
                )
              )
            ) AS ctx
          ) sector
        )
        -- COALESCE: subquery sem linha vira NULL e `jsonb || NULL` apaga a linha.
        || COALESCE((
          SELECT
            pg_catalog.jsonb_build_object(
              'reference_name', COALESCE(NULLIF(btrim(sheet.name), ''), NULL)
            )
            || CASE
                 WHEN COALESCE(line.value ->> 'source', '') = 'unresolved'
                      AND lower(COALESCE(line.value ->> 'component', ''))
                          LIKE '%palmilha%'
                      AND NULLIF(btrim(sheet.name), '') IS NOT NULL
                 THEN pg_catalog.jsonb_build_object(
                   'product_name',
                     CASE
                       WHEN COALESCE(line.value ->> 'product_name', '')
                            ~* ('^Ficha[[:space:]]+')
                         THEN line.value ->> 'product_name'
                       ELSE 'Ficha ' || btrim(sheet.name) || ' · '
                            || COALESCE(
                                 NULLIF(btrim(line.value ->> 'product_name'), ''),
                                 'Palmilha sem material'
                               )
                     END,
                   'consumption_warning',
                     CASE
                       WHEN COALESCE(line.value ->> 'consumption_warning', '')
                            ~* ('^Ficha[[:space:]]+' || btrim(sheet.name))
                         THEN line.value ->> 'consumption_warning'
                       WHEN COALESCE(btrim(line.value ->> 'consumption_warning'), '') = ''
                         THEN 'Ficha ' || btrim(sheet.name)
                              || ': cadastre o Material da Palmilha.'
                       ELSE 'Ficha ' || btrim(sheet.name) || ': '
                            || (line.value ->> 'consumption_warning')
                     END
                 )
                 ELSE '{}'::jsonb
               END
            FROM public.technical_sheets sheet
           WHERE sheet.id = public.try_parse_uuid(line.value ->> 'reference_id')
        ), '{}'::jsonb)
      ELSE line.value
           || COALESCE((
             SELECT pg_catalog.jsonb_build_object(
               'reference_name', COALESCE(NULLIF(btrim(sheet.name), ''), NULL)
             )
               FROM public.technical_sheets sheet
              WHERE sheet.id = public.try_parse_uuid(line.value ->> 'reference_id')
           ), '{}'::jsonb)
    END
    ORDER BY line.ordinality
  ), '[]'::jsonb)
    INTO v_lines
    FROM pg_catalog.jsonb_array_elements(v_report -> 'lines')
         WITH ORDINALITY line(value, ordinality);

  FOR v_scope IN
    SELECT item.id AS scope_key,
           'sale_order_item'::text AS scope_type,
           item.sale_order_id,
           item.id AS sale_order_item_id,
           item.reference_id,
           item.material_variant_id,
           item.color,
           item.quantity::numeric AS quantity,
           item.grade,
           item.strap_colors,
           item.strap_sourcing,
           sale_order.status AS sale_order_status
      FROM public.sale_order_items item
      JOIN public.sale_orders sale_order
        ON sale_order.id = item.sale_order_id
     WHERE item.sale_order_id = ANY(
       COALESCE(p_sale_order_ids, ARRAY[]::uuid[])
     )
       AND item.production_excluded_at IS NULL

    UNION ALL

    SELECT production_order.id AS scope_key,
           'production_order'::text AS scope_type,
           production_order.sale_order_id,
           production_order.sale_order_item_id,
           production_order.reference_id,
           item.material_variant_id,
           item.color,
           production_order.quantity::numeric AS quantity,
           production_order.grade,
           item.strap_colors,
           item.strap_sourcing,
           sale_order.status AS sale_order_status
      FROM public.orders production_order
      JOIN public.sale_order_items item
        ON item.id = production_order.sale_order_item_id
       AND item.sale_order_id IS NOT DISTINCT FROM production_order.sale_order_id
       AND item.reference_id IS NOT DISTINCT FROM production_order.reference_id
      LEFT JOIN public.sale_orders sale_order
        ON sale_order.id = production_order.sale_order_id
     WHERE production_order.id = ANY(
       COALESCE(p_order_ids, ARRAY[]::uuid[])
     )
       AND production_order.deleted_at IS NULL
     ORDER BY scope_key
  LOOP
    SELECT schedule.main_production_start, schedule.schedule_revision
      INTO v_main_production_start, v_schedule_revision
      FROM public.resolve_sale_order_main_production_start(
        v_scope.sale_order_id, v_scope.sale_order_item_id
      ) schedule
     LIMIT 1;

    IF v_scope.scope_type = 'production_order' THEN
      v_effective_grade := public.resolve_effective_op_grade(
        v_scope.grade, v_scope.quantity
      );
    ELSE
      v_effective_grade := v_scope.grade;
    END IF;

    SELECT COALESCE(
             pg_catalog.array_agg(DISTINCT NULLIF(pg_catalog.btrim(
               line.value ->> 'technical_strap_line_id'
             ), '')),
             ARRAY[]::text[]
           )
      INTO v_item_line_ids
      FROM pg_catalog.jsonb_array_elements(
             CASE
               WHEN pg_catalog.jsonb_typeof(v_scope.strap_colors) = 'array'
                 THEN v_scope.strap_colors
               ELSE '[]'::jsonb
             END
           ) line(value);

    -- Rascunho/Pendente: ficha manda na estrutura. Comprometido: só gap (freeze).
    v_overlay_structure := NOT private.is_committed_sale_order_status(
      v_scope.sale_order_status
    );

    v_merged_straps := private.merge_consumo_strap_colors_with_sheet_gaps(
      v_scope.strap_colors,
      v_scope.reference_id,
      v_overlay_structure
    );

    SELECT COALESCE(
             pg_catalog.array_agg(DISTINCT NULLIF(pg_catalog.btrim(
               line.value ->> 'technical_strap_line_id'
             ), ''))
               FILTER (
                 WHERE NULLIF(pg_catalog.btrim(
                   line.value ->> 'technical_strap_line_id'
                 ), '') IS NOT NULL
                   AND NOT (
                     NULLIF(pg_catalog.btrim(
                       line.value ->> 'technical_strap_line_id'
                     ), '') = ANY (v_item_line_ids)
                   )
               ),
             ARRAY[]::text[]
           )
      INTO v_gap_ids
      FROM pg_catalog.jsonb_array_elements(v_merged_straps) line(value);

    -- Overlay estrutural invalida pins de catálogo da identidade antiga
    -- (variante/receita/acabado da TIRA CHATA não servem ao ELÁSTICO FORRADO).
    v_strap_sourcing := CASE
      WHEN pg_catalog.jsonb_typeof(v_scope.strap_sourcing) = 'object'
        THEN v_scope.strap_sourcing
      ELSE '{}'::jsonb
    END;
    v_overlay_line_ids := ARRAY[]::text[];
    v_overlay_measure_ids := '{}'::jsonb;

    IF v_overlay_structure THEN
      FOR v_line IN
        SELECT value FROM pg_catalog.jsonb_array_elements(v_merged_straps)
      LOOP
        IF NOT COALESCE((v_line ->> 'consumo_sheet_structure_overlay')::boolean, false) THEN
          CONTINUE;
        END IF;
        v_line_id := NULLIF(pg_catalog.btrim(v_line ->> 'technical_strap_line_id'), '');
        IF v_line_id IS NULL THEN
          CONTINUE;
        END IF;
        v_overlay_line_ids := v_overlay_line_ids || v_line_id;
        v_measure_id := NULLIF(pg_catalog.btrim(v_line ->> 'measure_id'), '');
        IF v_measure_id IS NOT NULL THEN
          v_overlay_measure_ids := v_overlay_measure_ids
            || pg_catalog.jsonb_build_object(v_line_id, v_measure_id);
        END IF;
        IF v_strap_sourcing ? v_line_id THEN
          v_strap_sourcing := pg_catalog.jsonb_set(
            v_strap_sourcing,
            ARRAY[v_line_id],
            (v_strap_sourcing -> v_line_id)
              - 'strap_variant_id'
              - 'recipe_id'
              - 'finished_product_id'
          );
        END IF;
      END LOOP;
    END IF;

    v_preview_payload := pg_catalog.jsonb_build_object(
      'sale_order_id', v_scope.sale_order_id,
      'sale_order_item_id', v_scope.sale_order_item_id,
      'reference_id', v_scope.reference_id,
      'material_variant_id', v_scope.material_variant_id,
      'color', v_scope.color,
      'quantity', v_scope.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', v_merged_straps,
      'strap_sourcing', v_strap_sourcing,
      'main_production_start', v_main_production_start,
      'schedule_revision', v_schedule_revision,
      'scope_type', v_scope.scope_type,
      'scope_key', v_scope.scope_key
    );

    FOR v_preview IN
      SELECT preview.*
        FROM public.preview_sale_order_strap_demand_draft(
          v_preview_payload
        ) preview
       ORDER BY preview.line_ordinal
    LOOP
      v_preview_json := pg_catalog.to_jsonb(v_preview);
      IF v_preview.technical_strap_line_id IS NOT NULL
         AND v_preview.technical_strap_line_id::text = ANY (v_gap_ids)
      THEN
        v_preview_json := v_preview_json || pg_catalog.jsonb_build_object(
          'blocking_reasons',
            COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
            || pg_catalog.jsonb_build_array(
                 pg_catalog.jsonb_build_object(
                   'code', 'sheet_strap_missing_from_item_snapshot',
                   'field', 'strap_colors',
                   'message',
                     'Tira da ficha ausente do snapshot do item do PV; '
                     || 'salve o item de novo ou revise Origem no Hub de Tiras.'
                 )
               )
        );
      END IF;

      -- Rótulo: medida da ficha = tipo + display (evita "TIRA 7 mm" para ELÁSTICO FORRADO).
      IF v_preview.technical_strap_line_id IS NOT NULL
         AND v_preview.technical_strap_line_id::text = ANY (v_overlay_line_ids)
      THEN
        v_measure_id := NULLIF(pg_catalog.btrim(
          v_overlay_measure_ids ->> v_preview.technical_strap_line_id::text
        ), '');
        IF v_measure_id IS NOT NULL THEN
          SELECT NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '')
            INTO v_measure_label
            FROM public.artisanal_strap_measures m
            JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
           WHERE m.id = v_measure_id::uuid;
          IF v_measure_label IS NOT NULL THEN
            v_preview_json := pg_catalog.jsonb_set(
              v_preview_json,
              '{resolved}',
              COALESCE(v_preview_json -> 'resolved', '{}'::jsonb)
                || pg_catalog.jsonb_build_object('measure_name', v_measure_label),
              true
            );
          END IF;
        END IF;
      END IF;


      v_measure_id := COALESCE(
        NULLIF(pg_catalog.btrim(
          v_overlay_measure_ids ->> v_preview.technical_strap_line_id::text
        ), ''),
        (
          SELECT NULLIF(pg_catalog.btrim(line.value ->> 'measure_id'), '')
            FROM pg_catalog.jsonb_array_elements(v_merged_straps) line(value)
           WHERE NULLIF(pg_catalog.btrim(
                   line.value ->> 'technical_strap_line_id'
                 ), '') = v_preview.technical_strap_line_id::text
           LIMIT 1
        )
      );
      v_preview_json := private.enrich_consumo_strap_preview_recipe_yield(
        v_preview_json || pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id
        ),
        public.try_parse_uuid(v_measure_id)
      );
      v_previews := v_previews || pg_catalog.jsonb_build_array(v_preview_json);
    END LOOP;
  END LOOP;

  RETURN pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(v_report, '{lines}', v_lines, true),
    '{strap_previews}', v_previews, true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[]) IS
  'Relatorio canonico: setor + ficha + overlay; em falta de variante, usa rendimento da receita aprovada do Hub na lista de compra.';


DO $guard$
DECLARE
  v_batch text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_batch;

  IF position('consumo_recipe_yield_fallback_presentation_233' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: marker consumo_recipe_yield_fallback_presentation_233 ausente no batch';
  END IF;
  IF position('enrich_consumo_strap_preview_recipe_yield' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch 233 nao chama enrich_consumo_strap_preview_recipe_yield';
  END IF;
  IF position('consumo_sheet_structure_overlay' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch 232 nao referencia consumo_sheet_structure_overlay';
  END IF;
  IF position('strap_variant_id' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch 232 nao remove strap_variant_id do sourcing overlay';
  END IF;
  IF position('measure_name' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch 232 nao enriquece measure_name';
  END IF;
  IF position('artisanal_strap_types' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch 232 nao le artisanal_strap_types no rotulo';
  END IF;
END
$guard$;

COMMIT;
