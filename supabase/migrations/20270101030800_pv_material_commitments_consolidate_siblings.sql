-- Consolidate sibling OP soft rows into one pv_commitment per (PV, product)
CREATE OR REPLACE FUNCTION public.commit_sale_order_material_demand(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_needed numeric;
  v_existing public.material_reservations%ROWTYPE;
  v_upserted int := 0;
  v_released int := 0;
  v_product_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1'
     AND COALESCE(current_setting('app.internal_stock_sync', true), '') <> '1'
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pv_commit:' || p_sale_order_id::text));

  FOR r IN
    SELECT d.product_id,
           sum(d.required)::numeric AS required,
           min(d.component) AS component
      FROM public.sale_order_material_demand_lines(p_sale_order_id) d
     GROUP BY d.product_id
  LOOP
    v_product_ids := array_append(v_product_ids, r.product_id);
    v_needed := GREATEST(r.required, 0);

    SELECT * INTO v_existing
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = p_sale_order_id
       AND mr.product_id = r.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
     ORDER BY
       CASE COALESCE(mr.metadata ->> 'kind', '')
         WHEN 'pv_commitment' THEN 0
         WHEN 'atelier_prep' THEN 1
         ELSE 2
       END,
       mr.created_at
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.material_reservations
         SET quantity_reserved = GREATEST(v_needed, COALESCE(quantity_consumed, 0)),
             sale_order_id = p_sale_order_id,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'kind', CASE
                         WHEN COALESCE(metadata ->> 'kind', '') = 'atelier_prep' THEN 'atelier_prep'
                         ELSE 'pv_commitment'
                       END,
               'component', r.component,
               'sale_order_id', p_sale_order_id
             ),
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      INSERT INTO public.material_reservations (
        order_id, sale_order_id, product_id,
        quantity_reserved, quantity_consumed,
        status, reservation_type, notes, metadata
      ) VALUES (
        NULL, p_sale_order_id, r.product_id,
        v_needed, 0,
        'reserved', 'soft',
        'Comprometimento PV',
        jsonb_build_object(
          'kind', 'pv_commitment',
          'component', r.component,
          'sale_order_id', p_sale_order_id
        )
      )
      RETURNING * INTO v_existing;
    END IF;

    -- Uma conta: cancela irmãs abertas do mesmo PV+produto (anti-2× com OP soft legado)
    UPDATE public.material_reservations mr
       SET status = 'cancelled',
           updated_at = now(),
           notes = COALESCE(notes, '') || ' · consolidado em pv_commitment'
     WHERE mr.sale_order_id = p_sale_order_id
       AND mr.product_id = r.product_id
       AND mr.id IS DISTINCT FROM v_existing.id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component')
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
       AND COALESCE(mr.quantity_consumed, 0) = 0;

    v_upserted := v_upserted + 1;
  END LOOP;

  -- Release open pv_commitment rows no longer needed (not atelier hard path)
  UPDATE public.material_reservations mr
     SET status = 'cancelled',
         updated_at = now(),
         notes = COALESCE(notes, '') || ' · recompute sem demanda'
   WHERE mr.sale_order_id = p_sale_order_id
     AND mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.metadata ->> 'kind', '') = 'pv_commitment'
     AND mr.quantity_consumed = 0
     AND (cardinality(v_product_ids) = 0 OR NOT (mr.product_id = ANY (v_product_ids)));
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_order_id', p_sale_order_id,
    'upserted', v_upserted,
    'released', v_released
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_sale_order_material_demand(uuid) TO authenticated, service_role;
