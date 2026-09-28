-- =============================================================================
-- auto_resync: sobe errors[] do propagate de tiras no toast
-- =============================================================================
-- 292 já realinha strap_colors via prepare, mas engolia failures de cadastro
-- (ex.: Overlock Redonda 6mm × GLOW METALIC sem receita). O Consumo overlaya
-- a ficha e o item do PV fica velho — sem aviso. Marca: strap_propagate_err_toast_293
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_resync_unstarted_ops_for_sheet(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- strap_propagate_err_toast_293
  v_op record;
  v_resync jsonb;
  v_delta jsonb;
  v_straps jsonb;
  v_resynced integer := 0;
  v_skipped_inactive integer := 0;
  v_skipped_started integer := 0;
  v_delta_reserved integer := 0;
  v_delta_shortfalls integer := 0;
  v_straps_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sale_order_ids uuid[] := ARRAY[]::uuid[];
  v_so_id uuid;
  v_sqlstate text;
  v_message text;
  v_n_reserved integer;
  v_n_shortfalls integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar consumo da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'resynced', 0,
      'skipped_inactive', 0,
      'skipped_started', 0,
      'delta_reserved', 0,
      'delta_shortfalls', 0,
      'straps_updated', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  -- Tiras do PV primeiro: o freeze da OP e o Consumo leem strap_colors do item.
  v_straps := public.propagate_sheet_straps_to_open_pvs(p_sheet_id);
  v_straps_updated := COALESCE((v_straps ->> 'updated_items')::integer, 0);
  -- Falha de cadastro (ex.: receita ausente p/ tipo×napa) não aborta o lote,
  -- mas precisa aparecer no toast — senão o Consumo overlaya e o item fica velho.
  IF jsonb_typeof(v_straps -> 'errors') = 'array'
     AND jsonb_array_length(v_straps -> 'errors') > 0
  THEN
    v_errors := v_errors || (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'order_number', NULL,
          'message',
            'Tiras PV'
            || CASE
                 WHEN NULLIF(e->>'color', '') IS NOT NULL
                   THEN ' (' || (e->>'color') || ')'
                 ELSE ''
               END
            || ': '
            || COALESCE(e->>'message', 'falha ao realinhar')
        )
      ), '[]'::jsonb)
        FROM jsonb_array_elements(v_straps -> 'errors') AS t(e)
    );
  END IF;

  FOR v_op IN
    SELECT o.id,
           o.order_number,
           o.sale_order_id
      FROM public.orders o
      JOIN public.sale_orders so
        ON so.id = o.sale_order_id
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND lower(COALESCE(o.status, '')) IN (
         'reservado', 'em produção', 'em producao'
       )
     ORDER BY o.order_number NULLS LAST, o.id
  LOOP
    BEGIN
      v_resync := public.resync_op_atomic(v_op.id);

      IF COALESCE((v_resync ->> 'skipped')::boolean, false) THEN
        v_skipped_inactive := v_skipped_inactive + 1;
      ELSIF COALESCE((v_resync ->> 'ok')::boolean, false) THEN
        v_resynced := v_resynced + 1;
        IF v_op.sale_order_id IS NOT NULL THEN
          v_sale_order_ids := array_append(v_sale_order_ids, v_op.sale_order_id);
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'order_id', v_op.id,
          'order_number', v_op.order_number,
          'message', COALESCE(v_resync #>> '{error,message}', 'resync recusado')
        ));
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'PZ105' THEN
        v_skipped_started := v_skipped_started + 1;
        BEGIN
          v_delta := public.reserve_missing_materials_for_order(v_op.id);
          v_n_reserved := COALESCE(jsonb_array_length(v_delta -> 'reserved'), 0);
          v_n_shortfalls := COALESCE(jsonb_array_length(v_delta -> 'shortfalls'), 0);
          IF v_n_reserved > 0 THEN
            v_delta_reserved := v_delta_reserved + 1;
          END IF;
          v_delta_shortfalls := v_delta_shortfalls + v_n_shortfalls;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_sqlstate = RETURNED_SQLSTATE,
            v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'order_id', v_op.id,
            'order_number', v_op.order_number,
            'sqlstate', v_sqlstate,
            'message', 'delta reserve: ' || v_message
          ));
        END;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_sqlstate = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'order_id', v_op.id,
          'order_number', v_op.order_number,
          'sqlstate', v_sqlstate,
          'message', v_message
        ));
    END;
  END LOOP;

  FOR v_so_id IN
    SELECT DISTINCT x
      FROM unnest(v_sale_order_ids) AS t(x)
     WHERE x IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.technical_sheet_snapshots tss
       WHERE tss.sale_order_id = v_so_id
         AND tss.sheet_id = p_sheet_id
         AND tss.outdated_at IS NOT NULL
    ) THEN
      UPDATE public.sale_orders
         SET reservations_outdated_at = NULL
       WHERE id = v_so_id
         AND reservations_outdated_at IS NOT NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sheet_id', p_sheet_id,
    'resynced', v_resynced,
    'skipped_inactive', v_skipped_inactive,
    'skipped_started', v_skipped_started,
    'delta_reserved', v_delta_reserved,
    'delta_shortfalls', v_delta_shortfalls,
    'straps_updated', v_straps_updated,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid) IS
  'Após save da ficha: alinha tiras do PV + re-freeze/re-reserva das OPs '
  'Aprovado/Em Produção sem fato físico; em PZ105 reserva só o delta. '
  'Errors de propagate (receita ausente) sobem no payload.';

DO $guards$
DECLARE
  v_auto text;
BEGIN
  SELECT pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sheet(uuid)'::regprocedure
  ) INTO v_auto;
  IF v_auto NOT ILIKE '%Tiras PV%' THEN
    RAISE EXCEPTION 'Guard: auto_resync sem surface de erro de tiras';
  END IF;
  IF v_auto NOT ILIKE '%strap_propagate_err_toast_293%' THEN
    RAISE EXCEPTION 'Guard: auto_resync sem marca 293';
  END IF;
END;
$guards$;

COMMIT;
