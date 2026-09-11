-- Consumo (PV Rascunho/Pendente): identidade estrutural da tira vem da FICHA.
--
-- Causa (PV-00194 / NL03 TRASEIRA): ficha tem ELÁSTICO FORRADO 7 mm, mas o
-- snapshot do item ainda carrega TIRA CHATA 8 mm no MESMO technical_strap_line_id.
-- O merge 211 só acrescenta line_id ausente — identidade divergente era ignorada.
-- O formulário já reidrata via reconcileEditableStrapSnapshots; o relatório não.
--
-- Este patch:
--   1) overload do merge com p_overlay_structure
--   2) batch passa true só quando o PV NÃO está comprometido
--   3) 2-arg (usado pelo draft comprometido / 218) continua gap-only
-- Marca: sheet_strap_structure_overlay_consumo_231

BEGIN;

CREATE OR REPLACE FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(
  p_item_straps jsonb,
  p_reference_id uuid,
  p_overlay_structure boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  -- sheet_strap_gap_consumo_211
  -- sheet_strap_structure_overlay_consumo_231
  v_item jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_item_straps) = 'array' THEN p_item_straps
    ELSE '[]'::jsonb
  END;
  v_sheet jsonb := '[]'::jsonb;
  v_line jsonb;
  v_item_line jsonb;
  v_sheet_line jsonb;
  v_line_id text;
  v_present text[] := ARRAY[]::text[];
  v_out jsonb := '[]'::jsonb;
  v_drift boolean;
  v_overlay jsonb;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN v_item;
  END IF;

  SELECT CASE
           WHEN pg_catalog.jsonb_typeof(ts.strap_colors) = 'array'
             THEN ts.strap_colors
           ELSE '[]'::jsonb
         END
    INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF v_sheet IS NULL THEN
    v_sheet := '[]'::jsonb;
  END IF;

  -- 1) Reemite linhas do item; com overlay, alinha estrutura à ficha no mesmo line_id.
  FOR v_item_line IN
    SELECT value FROM pg_catalog.jsonb_array_elements(v_item)
  LOOP
    v_line_id := NULLIF(pg_catalog.btrim(
      v_item_line ->> 'technical_strap_line_id'
    ), '');

    IF p_overlay_structure
       AND v_line_id IS NOT NULL
       AND pg_catalog.jsonb_array_length(v_sheet) > 0
    THEN
      v_sheet_line := NULL;
      SELECT value
        INTO v_sheet_line
        FROM pg_catalog.jsonb_array_elements(v_sheet) sheet_line(value)
       WHERE NULLIF(pg_catalog.btrim(
               sheet_line.value ->> 'technical_strap_line_id'
             ), '') = v_line_id
       LIMIT 1;

      IF v_sheet_line IS NOT NULL THEN
        v_drift :=
             (NULLIF(pg_catalog.btrim(v_item_line ->> 'measure_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'measure_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'strap_type_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'strap_type_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'identity_basis'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'identity_basis'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'identity_group_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'identity_group_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'group_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'group_name'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_name'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'label'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'label'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'material_mode'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'material_mode'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'material_group_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'material_group_id'), ''))
          OR (COALESCE(v_item_line -> 'allowed_material_group_ids', '[]'::jsonb)
                IS DISTINCT FROM COALESCE(v_sheet_line -> 'allowed_material_group_ids', '[]'::jsonb))
          OR (COALESCE(v_item_line -> 'consumption_per_size', '{}'::jsonb)
                IS DISTINCT FROM COALESCE(v_sheet_line -> 'consumption_per_size', '{}'::jsonb))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'consumption'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'consumption'), ''))
          OR (COALESCE(v_item_line ->> 'internal_production_enabled', '')
                IS DISTINCT FROM COALESCE(v_sheet_line ->> 'internal_production_enabled', ''));

        IF v_drift THEN
          -- Estrutura da ficha + escolhas comerciais do PV (cor / base escolhida).
          v_overlay := v_item_line
            || pg_catalog.jsonb_build_object(
              'technical_strap_line_id', v_line_id,
              'measure_id', v_sheet_line -> 'measure_id',
              'strap_type_id', v_sheet_line -> 'strap_type_id',
              'identity_basis', v_sheet_line -> 'identity_basis',
              'identity_group_id', v_sheet_line -> 'identity_group_id',
              'group_id', v_sheet_line -> 'group_id',
              'group_name', v_sheet_line -> 'group_name',
              'label', v_sheet_line -> 'label',
              'material_mode', v_sheet_line -> 'material_mode',
              'material_group_id', v_sheet_line -> 'material_group_id',
              'allowed_material_group_ids',
                COALESCE(v_sheet_line -> 'allowed_material_group_ids', '[]'::jsonb),
              'consumption', v_sheet_line -> 'consumption',
              'consumption_per_size',
                COALESCE(v_sheet_line -> 'consumption_per_size', '{}'::jsonb),
              'consumo_sheet_structure_overlay', true
            );
          IF v_sheet_line ? 'internal_production_enabled' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'internal_production_enabled',
              v_sheet_line -> 'internal_production_enabled'
            );
          END IF;
          -- Preserva explicitamente escolhas do PV (não vem da ficha estrutural).
          IF v_item_line ? 'color' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color', v_item_line -> 'color');
          END IF;
          IF v_item_line ? 'color_id' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color_id', v_item_line -> 'color_id');
          END IF;
          IF v_item_line ? 'color_mode' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color_mode', v_item_line -> 'color_mode');
          END IF;
          IF v_item_line ? 'base_group_id' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'base_group_id', v_item_line -> 'base_group_id'
            );
          END IF;
          IF v_item_line ? 'base_group_name' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'base_group_name', v_item_line -> 'base_group_name'
            );
          END IF;

          v_out := v_out || pg_catalog.jsonb_build_array(v_overlay);
          IF v_line_id IS NOT NULL THEN
            v_present := v_present || v_line_id;
          END IF;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    v_out := v_out || pg_catalog.jsonb_build_array(v_item_line);
    IF v_line_id IS NOT NULL THEN
      v_present := v_present || v_line_id;
    END IF;
  END LOOP;

  -- 2) Gap clássico: linhas da ficha cujo line_id não está no item.
  IF pg_catalog.jsonb_array_length(v_sheet) > 0 THEN
    FOR v_line IN
      SELECT value FROM pg_catalog.jsonb_array_elements(v_sheet)
    LOOP
      v_line_id := NULLIF(pg_catalog.btrim(v_line ->> 'technical_strap_line_id'), '');
      IF v_line_id IS NULL THEN
        CONTINUE;
      END IF;
      IF v_line_id = ANY (v_present) THEN
        CONTINUE;
      END IF;

      v_out := v_out || pg_catalog.jsonb_build_array(
        v_line || pg_catalog.jsonb_build_object(
          'technical_strap_line_id', v_line_id,
          'consumo_sheet_gap', true
        )
      );
      v_present := v_present || v_line_id;
    END LOOP;
  END IF;

  RETURN v_out;
END;
$function$;

-- Compat: callers 2-arg (draft comprometido / 218) = gap-only, sem overlay.
CREATE OR REPLACE FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(
  p_item_straps jsonb,
  p_reference_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  -- sheet_strap_gap_consumo_211
  SELECT private.merge_consumo_strap_colors_with_sheet_gaps(
    p_item_straps,
    p_reference_id,
    false
  );
$function$;

REVOKE ALL ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid, boolean)
  TO service_role;

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

    v_preview_payload := pg_catalog.jsonb_build_object(
      'sale_order_id', v_scope.sale_order_id,
      'sale_order_item_id', v_scope.sale_order_item_id,
      'reference_id', v_scope.reference_id,
      'material_variant_id', v_scope.material_variant_id,
      'color', v_scope.color,
      'quantity', v_scope.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', v_merged_straps,
      'strap_sourcing', v_scope.strap_sourcing,
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

      v_previews := v_previews || pg_catalog.jsonb_build_array(
        v_preview_json || pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id
        )
      );
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
  'Relatorio canonico: setor + ficha nomeada; preview une tiras da ficha ausentes do snapshot; em Rascunho/Pendente alinha identidade estrutural (medida/tipo) à ficha.';

COMMENT ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid, boolean) IS
  'Consumo: gap de line_id ausente; com p_overlay_structure=true, reidrata medida/tipo/consumo da ficha no mesmo technical_strap_line_id (PV nao comprometido).';

COMMENT ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid) IS
  'Consumo: anexa linhas de technical_sheets.strap_colors cujo line_id nao esta no item (sem overlay estrutural).';

DO $guard$
DECLARE
  v_batch text;
  v_merge3 text;
  v_merge2 text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_batch;
  SELECT pg_catalog.pg_get_functiondef(
    'private.merge_consumo_strap_colors_with_sheet_gaps(jsonb,uuid,boolean)'::regprocedure
  ) INTO v_merge3;
  SELECT pg_catalog.pg_get_functiondef(
    'private.merge_consumo_strap_colors_with_sheet_gaps(jsonb,uuid)'::regprocedure
  ) INTO v_merge2;

  IF position('sheet_strap_structure_overlay_consumo_231' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: marker sheet_strap_structure_overlay_consumo_231 ausente no batch';
  END IF;
  IF position('sheet_strap_structure_overlay_consumo_231' IN v_merge3) = 0 THEN
    RAISE EXCEPTION 'Guard: marker sheet_strap_structure_overlay_consumo_231 ausente no merge 3-arg';
  END IF;
  IF position('sheet_strap_gap_consumo_211' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: marker sheet_strap_gap_consumo_211 ausente no batch';
  END IF;
  IF position('sheet_strap_gap_consumo_211' IN v_merge2) = 0 THEN
    RAISE EXCEPTION 'Guard: marker sheet_strap_gap_consumo_211 ausente no merge 2-arg';
  END IF;
  IF position('consumo_sheet_structure_overlay' IN v_merge3) = 0 THEN
    RAISE EXCEPTION 'Guard: flag consumo_sheet_structure_overlay ausente';
  END IF;
  IF position('is_committed_sale_order_status' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch nao consulta is_committed_sale_order_status';
  END IF;
  IF position('v_overlay_structure' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch nao calcula v_overlay_structure';
  END IF;
  IF position('unresolved_names_ficha_20270101020700' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: marker unresolved_names_ficha perdida no batch 231';
  END IF;
END
$guard$;

COMMIT;
