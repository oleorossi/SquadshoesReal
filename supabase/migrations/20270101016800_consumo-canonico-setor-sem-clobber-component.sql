-- O merge line || resolve_report_consumption_sector_context clobbava
-- component/source da linha do motor quando o snapshot devolveia
-- snapshot_missing/ambiguous com component NULL. O Zod do relatório
-- exige component.min(1) e derrubava o payload inteiro com
-- "lines.N: Invalid input" (union) — PV-00168 sem tela de consumo.
--
-- Esta função só anota setor no relatório. Nunca devolve identidade
-- de linha (component/source). snapshot_sector_context_for_product e o
-- trigger de reserva continuam intactos.

CREATE OR REPLACE FUNCTION private.resolve_report_consumption_sector_context(
  p_scope_type text,
  p_scope_key uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_product_id uuid,
  p_component text,
  p_source text,
  p_current_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- sector_keys_only_20270101016800
  v_status text;
  v_context jsonb;
  v_snapshot jsonb;
  v_context_count integer := 0;
  v_annotated integer := 0;
  v_sector text;
  v_origin text;
  v_sale_order_found boolean := false;
BEGIN
  SELECT sale_order.status
    INTO v_status
   FROM public.sale_orders sale_order
   WHERE sale_order.id = p_sale_order_id;
  v_sale_order_found := FOUND;

  IF v_sale_order_found
     AND NOT private.is_committed_sale_order_status(v_status) THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector',
        CASE WHEN p_current_context IS NULL THEN NULL
             ELSE p_current_context -> 'consumption_sector' END,
      'consumption_sector_source', COALESCE(
        p_current_context ->> 'consumption_sector_source',
        'legacy_fallback'
      )
    );
  END IF;

  IF p_scope_type = 'production_order'
     AND p_scope_key IS NOT NULL
     AND p_product_id IS NOT NULL THEN
    SELECT pg_catalog.count(DISTINCT (
             COALESCE(reservation.metadata ->> 'consumption_sector', '<NULL>')
             || '|' || COALESCE(
               reservation.metadata ->> 'consumption_sector_source', '<MISSING>')
           )),
           pg_catalog.count(*) FILTER (
             WHERE reservation.metadata ? 'consumption_sector_source'
               AND reservation.metadata ? 'consumption_sector'
           ),
           pg_catalog.min(reservation.metadata ->> 'consumption_sector'),
           pg_catalog.min(reservation.metadata ->> 'consumption_sector_source')
      INTO v_context_count, v_annotated, v_sector, v_origin
      FROM public.material_reservations reservation
     WHERE reservation.order_id = p_scope_key
       AND reservation.product_id = p_product_id
       AND (p_component IS NULL OR p_component = ''
         OR reservation.metadata ->> 'component' IS NULL
         OR reservation.metadata ->> 'component' = p_component)
       AND (p_source IS NULL OR p_source = ''
         OR reservation.metadata ->> 'source' IS NULL
         OR reservation.metadata ->> 'source' = p_source);

    IF v_annotated > 0
       AND v_context_count = 1
       AND v_origin = 'ambiguous' THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous',
        'consumption_sector_origin', 'ambiguous'
      );
    ELSIF v_annotated > 0 AND v_context_count = 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_sector,
        'consumption_sector_source', 'reservation',
        'consumption_sector_origin', v_origin
      );
    ELSIF v_context_count > 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous'
      );
    END IF;
  END IF;

  IF NOT v_sale_order_found THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector',
        CASE WHEN p_current_context IS NULL THEN NULL
             ELSE p_current_context -> 'consumption_sector' END,
      'consumption_sector_source', COALESCE(
        p_current_context ->> 'consumption_sector_source',
        'legacy_fallback'
      )
    );
  END IF;

  SELECT snapshot.consumption_snapshot
    INTO v_snapshot
    FROM public.technical_sheet_snapshots snapshot
   WHERE snapshot.sale_order_item_id = p_sale_order_item_id
     AND snapshot.sale_order_id IS NOT DISTINCT FROM p_sale_order_id
   ORDER BY snapshot.frozen_at DESC, snapshot.id DESC
   LIMIT 1;
  IF FOUND THEN
    v_context := private.snapshot_sector_context_for_product(
      v_snapshot, p_product_id, p_component, p_source
    );
    IF v_context ->> 'consumption_sector_source'
         NOT IN ('snapshot_missing', 'ambiguous') THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_context -> 'consumption_sector',
        'consumption_sector_source', 'snapshot',
        'consumption_sector_origin',
          v_context ->> 'consumption_sector_source'
      );
    END IF;
    -- Antes: RETURN v_context (com component/source) — clobber.
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', v_context -> 'consumption_sector',
      'consumption_sector_source', v_context ->> 'consumption_sector_source'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'consumption_sector', NULL,
    'consumption_sector_source', 'snapshot_missing'
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_report_consumption_sector_context(
  text, uuid, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- Defesa no merge do relatório: aplica só chaves de setor mesmo se a
-- função de resolução voltar a carregar identidade por engano.
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
  -- sector_merge_keys_only_20270101016800
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
        line.value || (
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
      ELSE line.value
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
  'Relatorio canonico com preview de tiras por escopo e setor sem clobber de component/source; nao altera required.';

DO $guard$
DECLARE
  v_resolve text;
  v_batch text;
BEGIN
  v_resolve := pg_catalog.pg_get_functiondef(
    'private.resolve_report_consumption_sector_context(text,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  );
  IF position('sector_keys_only_20270101016800' IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: resolve_report sem marca sector_keys_only_20270101016800';
  END IF;
  IF position('RETURN v_context;' IN v_resolve) > 0 THEN
    RAISE EXCEPTION 'Preflight: resolve_report ainda devolve v_context cru';
  END IF;

  v_batch := pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  );
  IF position('sector_merge_keys_only_20270101016800' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Preflight: batch sem marca sector_merge_keys_only_20270101016800';
  END IF;
  IF position('consumption_sector_origin' IN v_batch) = 0
     OR position('line.value || private.resolve_report_consumption_sector_context(' IN v_batch) > 0 THEN
    RAISE EXCEPTION 'Preflight: batch ainda faz merge cru do contexto de setor';
  END IF;
END
$guard$;
