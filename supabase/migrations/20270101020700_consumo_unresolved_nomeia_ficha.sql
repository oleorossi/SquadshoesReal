-- Nomeia a ficha no aviso "Palmilha sem material" do relatório canônico.
-- Sem o nome, Grupo/Aplicação ficam opacos ("não sei nem o que é").
--
-- Enrich no wrapper público de calculate_consumption_report_batch: adiciona
-- reference_name em toda linha e, em source=unresolved de Palmilha, reescreve
-- product_name / consumption_warning com o nome da ficha.

BEGIN;

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
           item.strap_sourcing
      FROM public.sale_order_items item
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
           item.strap_sourcing
      FROM public.orders production_order
      JOIN public.sale_order_items item
        ON item.id = production_order.sale_order_item_id
       AND item.sale_order_id IS NOT DISTINCT FROM production_order.sale_order_id
       AND item.reference_id IS NOT DISTINCT FROM production_order.reference_id
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

    v_preview_payload := pg_catalog.jsonb_build_object(
      'sale_order_id', v_scope.sale_order_id,
      'sale_order_item_id', v_scope.sale_order_item_id,
      'reference_id', v_scope.reference_id,
      'material_variant_id', v_scope.material_variant_id,
      'color', v_scope.color,
      'quantity', v_scope.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', v_scope.strap_colors,
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
      v_previews := v_previews || pg_catalog.jsonb_build_array(
        pg_catalog.to_jsonb(v_preview) || pg_catalog.jsonb_build_object(
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
  'Relatorio canonico: setor sem clobber + reference_name; unresolved de Palmilha nomeia a ficha.';

DO $guard$
DECLARE
  v_batch text;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_batch;
  IF position('unresolved_names_ficha_20270101020700' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: marker unresolved_names_ficha ausente no batch';
  END IF;
  IF position('reference_name' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: reference_name ausente no batch';
  END IF;
  IF position('Ficha ' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: prefixo Ficha ausente no batch';
  END IF;
END
$guard$;

COMMIT;
