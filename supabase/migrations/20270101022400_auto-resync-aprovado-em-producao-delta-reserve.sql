-- Propaga consumo da ficha também para PVs Em Produção sem fato físico, e
-- em OP com PZ105 (fato físico) reserva só o DELTA via reserve_missing —
-- sem resync destrutivo. Snapshot de OP iniciada continua só sinalizado.
--
-- Base: 20270101016900_auto-resync-unstarted-ops-on-sheet-save.sql

CREATE OR REPLACE FUNCTION public.auto_resync_unstarted_ops_for_sheet(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_resync jsonb;
  v_delta jsonb;
  v_resynced integer := 0;
  v_skipped_inactive integer := 0;
  v_skipped_started integer := 0;
  v_delta_reserved integer := 0;
  v_delta_shortfalls integer := 0;
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
      'errors', '[]'::jsonb
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
        -- Fato físico: não reescreve snapshot/reservas; só fecha furo aditivo.
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

  -- Limpa o flag de reservas nos PVs que tiveram ao menos uma OP refeita e
  -- já não guardam snapshot desatualizado desta ficha.
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
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid) IS
  'Após save da ficha: re-freeze + re-reserva das OPs de PVs Aprovado/Em Produção sem fato físico; em PZ105 reserva só o delta (reserve_missing).';

REVOKE ALL ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid)
  TO authenticated, service_role;

-- Solado / Consumo Padrão: propaga para todas as fichas que usam o grupo.
CREATE OR REPLACE FUNCTION public.auto_resync_unstarted_ops_for_sole_group(
  p_sole_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet uuid;
  v_one jsonb;
  v_resynced integer := 0;
  v_skipped_inactive integer := 0;
  v_skipped_started integer := 0;
  v_delta_reserved integer := 0;
  v_delta_shortfalls integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sheets integer := 0;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar consumo do solado'
      USING ERRCODE = '42501';
  END IF;

  IF p_sole_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'sheets', 0,
      'resynced', 0,
      'skipped_inactive', 0,
      'skipped_started', 0,
      'delta_reserved', 0,
      'delta_shortfalls', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  FOR v_sheet IN
    SELECT DISTINCT ts.id
      FROM public.technical_sheets ts
     WHERE ts.sole_group_id = p_sole_group_id
        OR ts.primary_sole_id IN (
          SELECT p.id FROM public.products p WHERE p.group_id = p_sole_group_id
        )
     UNION
    SELECT DISTINCT tsc.sheet_id
      FROM public.technical_sheet_sole_colors tsc
     WHERE tsc.sole_group_id = p_sole_group_id
        OR tsc.sole_product_id IN (
          SELECT p.id FROM public.products p WHERE p.group_id = p_sole_group_id
        )
  LOOP
    v_sheets := v_sheets + 1;
    v_one := public.auto_resync_unstarted_ops_for_sheet(v_sheet);
    v_resynced := v_resynced + COALESCE((v_one ->> 'resynced')::integer, 0);
    v_skipped_inactive := v_skipped_inactive
      + COALESCE((v_one ->> 'skipped_inactive')::integer, 0);
    v_skipped_started := v_skipped_started
      + COALESCE((v_one ->> 'skipped_started')::integer, 0);
    v_delta_reserved := v_delta_reserved
      + COALESCE((v_one ->> 'delta_reserved')::integer, 0);
    v_delta_shortfalls := v_delta_shortfalls
      + COALESCE((v_one ->> 'delta_shortfalls')::integer, 0);
    v_errors := v_errors || COALESCE(v_one -> 'errors', '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sole_group_id', p_sole_group_id,
    'sheets', v_sheets,
    'resynced', v_resynced,
    'skipped_inactive', v_skipped_inactive,
    'skipped_started', v_skipped_started,
    'delta_reserved', v_delta_reserved,
    'delta_shortfalls', v_delta_shortfalls,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.auto_resync_unstarted_ops_for_sole_group(uuid) IS
  'Após Consumo Padrão do solado: auto-resync (Aprovado/Em Produção + delta PZ105) nas fichas do grupo.';

REVOKE ALL ON FUNCTION public.auto_resync_unstarted_ops_for_sole_group(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resync_unstarted_ops_for_sole_group(uuid)
  TO authenticated, service_role;

-- Contrato: filtro ampliado + delta em PZ105.
DO $$
DECLARE
  v_sheet text;
  v_group text;
BEGIN
  SELECT pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sheet(uuid)'::regprocedure
  ) INTO v_sheet;
  SELECT pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sole_group(uuid)'::regprocedure
  ) INTO v_group;

  IF v_sheet IS NULL OR v_group IS NULL THEN
    RAISE EXCEPTION 'auto_resync RPCs ausentes';
  END IF;
  IF v_sheet NOT ILIKE '%resync_op_atomic%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem resync_op_atomic';
  END IF;
  IF v_sheet NOT ILIKE '%Aprovado%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem filtro Aprovado';
  END IF;
  IF v_sheet NOT ILIKE '%Em Produção%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem filtro Em Produção';
  END IF;
  IF v_sheet NOT ILIKE '%PZ105%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem guarda PZ105';
  END IF;
  IF v_sheet NOT ILIKE '%reserve_missing_materials_for_order%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem reserve_missing em PZ105';
  END IF;
  IF v_sheet NOT ILIKE '%delta_reserved%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sheet sem contador delta_reserved';
  END IF;
  IF v_group NOT ILIKE '%auto_resync_unstarted_ops_for_sheet%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sole_group sem delegação à ficha';
  END IF;
  IF v_group NOT ILIKE '%delta_reserved%' THEN
    RAISE EXCEPTION 'auto_resync_unstarted_ops_for_sole_group sem agregação delta_reserved';
  END IF;
END;
$$;
