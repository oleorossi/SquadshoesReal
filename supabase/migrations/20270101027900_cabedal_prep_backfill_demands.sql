-- Corrige materialize (ts.reference → ts.code) e adiciona backfill.
-- Causa do menu vazio: materialize quebrava em runtime (coluna inexistente),
-- então o outbox falhava / PVs antigos nunca geraram demanda.

CREATE OR REPLACE FUNCTION public.materialize_cabedal_prep_demands(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_billing text;
  v_billing_start date;
  v_created int := 0;
  v_updated int := 0;
  r record;
  v_cap numeric;
  v_assembly_days int;
  v_lead int;
  v_ready date;
  v_req_cut boolean;
  v_req_sew boolean;
  v_req_avi boolean;
BEGIN
  SELECT so.status, so.billing_week
    INTO v_status, v_billing
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado', 'status', v_status);
  END IF;

  v_billing_start := public.cabedal_prep_billing_start(v_billing);

  FOR r IN
    SELECT soi.id AS item_id,
           soi.reference_id,
           soi.color,
           soi.quantity AS pairs,
           COALESCE(
             NULLIF(btrim(ts.code), ''),
             NULLIF(btrim(ts.model), ''),
             NULLIF(btrim(ts.name), '')
           ) AS reference_code,
           ts.assembly_capacity_per_day,
           ts.upper_material,
           ts.upper_material_group_id,
           ts.upper_material_product_id,
           ts.upper_consumption,
           ts.upper_corte_a_fio,
           ts.has_straps,
           ts.components_accessories,
           ts.aviamento_steps
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
  LOOP
    v_req_cut := (
      NULLIF(btrim(COALESCE(r.upper_material, '')), '') IS NOT NULL
      OR r.upper_material_group_id IS NOT NULL
      OR r.upper_material_product_id IS NOT NULL
      OR COALESCE(r.upper_consumption, 0) > 0
      OR (jsonb_typeof(r.components_accessories) = 'array'
          AND jsonb_array_length(r.components_accessories) > 0)
    );
    v_req_sew := v_req_cut AND COALESCE(r.upper_corte_a_fio, false) IS NOT TRUE;
    v_req_avi := COALESCE(r.has_straps, false)
      OR (jsonb_typeof(r.aviamento_steps) = 'array'
          AND jsonb_array_length(r.aviamento_steps) > 0);
    IF NOT (v_req_cut OR v_req_avi) THEN
      CONTINUE;
    END IF;

    v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
      v_lead := v_assembly_days + 1;
    ELSE
      v_assembly_days := NULL;
      v_lead := NULL;
    END IF;
    IF v_billing_start IS NOT NULL AND v_lead IS NOT NULL THEN
      v_ready := v_billing_start - v_lead;
    ELSE
      v_ready := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_demands (
      sale_order_id, sale_order_item_id, technical_sheet_id, reference_code,
      color, pairs, billing_week, billing_start_date, assembly_capacity_per_day,
      assembly_days, ready_date, requires_cut, requires_sewing, requires_aviamento,
      status, updated_at
    ) VALUES (
      p_sale_order_id, r.item_id, r.reference_id, r.reference_code,
      r.color, r.pairs, v_billing, v_billing_start, v_cap,
      v_assembly_days, v_ready, v_req_cut, v_req_sew, v_req_avi,
      'open', now()
    )
    ON CONFLICT (sale_order_item_id) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      billing_week = EXCLUDED.billing_week,
      billing_start_date = EXCLUDED.billing_start_date,
      assembly_capacity_per_day = EXCLUDED.assembly_capacity_per_day,
      assembly_days = EXCLUDED.assembly_days,
      ready_date = EXCLUDED.ready_date,
      requires_cut = EXCLUDED.requires_cut,
      requires_sewing = EXCLUDED.requires_sewing,
      requires_aviamento = EXCLUDED.requires_aviamento,
      status = CASE
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'stale'
        ELSE public.cabedal_prep_demands.status
      END,
      stale_reason = CASE
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'pv_item_changed'
        ELSE public.cabedal_prep_demands.stale_reason
      END,
      updated_at = now();

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_updated,
    'billing_week', v_billing,
    'billing_start_date', v_billing_start
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_cabedal_prep_demands(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_orders int := 0;
  v_upserted int := 0;
  v_skipped int := 0;
  v_result jsonb;
  v_one int;
BEGIN
  IF p_sale_order_id IS NOT NULL THEN
    v_result := public.materialize_cabedal_prep_demands(p_sale_order_id);
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'single',
      'sale_order_id', p_sale_order_id,
      'result', v_result
    );
  END IF;

  FOR r IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND soi.reference_id IS NOT NULL
  LOOP
    v_result := public.materialize_cabedal_prep_demands(r.id);
    v_orders := v_orders + 1;
    IF COALESCE((v_result->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_one := COALESCE((v_result->>'upserted')::int, 0);
      v_upserted := v_upserted + v_one;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'all_open',
    'orders_scanned', v_orders,
    'demands_upserted', v_upserted,
    'orders_skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_cabedal_prep_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_cabedal_prep_demands(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.backfill_cabedal_prep_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_cabedal_prep_demands(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.backfill_cabedal_prep_demands(uuid) IS
  'Sincroniza cabedal_prep_demands a partir de PVs Aprovado/Em Produção (ou um PV). Não gera OC.';
