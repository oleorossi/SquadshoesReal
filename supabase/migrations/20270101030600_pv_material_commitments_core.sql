-- Comprometimento de material no PV (soft pegging) — Phase 1+2 core
-- Spec: specs/pv-material-commitments.md
-- Conta única: pv_commitment → reserved_stock; hybrid/Ateliê adotam sem somar.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.material_reservations
  ADD COLUMN IF NOT EXISTS sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_reservations_sale_order_product_open
  ON public.material_reservations (sale_order_id, product_id)
  WHERE status IN ('reserved', 'partially_consumed')
    AND sale_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_material_reservations_kind_open
  ON public.material_reservations ((metadata ->> 'kind'), product_id)
  WHERE status IN ('reserved', 'partially_consumed');

-- Backfill sale_order_id from OP / metadata (skip strap engine rows — guard)
UPDATE public.material_reservations mr
   SET sale_order_id = COALESCE(
         mr.sale_order_id,
         o.sale_order_id,
         NULLIF(mr.metadata ->> 'sale_order_id', '')::uuid
       )
  FROM public.orders o
 WHERE mr.order_id = o.id
   AND mr.sale_order_id IS NULL
   AND o.sale_order_id IS NOT NULL
   AND mr.strap_variant_id IS NULL
   AND mr.sale_order_strap_demand_id IS NULL
   AND mr.strap_batch_item_id IS NULL
   AND mr.strap_stock_floor_contribution_id IS NULL
   AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
   AND COALESCE(mr.source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       );

UPDATE public.material_reservations mr
   SET sale_order_id = NULLIF(mr.metadata ->> 'sale_order_id', '')::uuid
 WHERE mr.sale_order_id IS NULL
   AND NULLIF(mr.metadata ->> 'sale_order_id', '') IS NOT NULL
   AND mr.strap_variant_id IS NULL
   AND mr.sale_order_strap_demand_id IS NULL
   AND mr.strap_batch_item_id IS NULL
   AND mr.strap_stock_floor_contribution_id IS NULL
   AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
   AND COALESCE(mr.source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       );

-- ---------------------------------------------------------------------------
-- Priority helper (I7)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commitment_cover_priority(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_atelier boolean := false;
  v_billing date;
  v_delivery date;
  v_created timestamptz;
  v_score numeric;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM public.cabedal_prep_demands d
     WHERE d.sale_order_id = p_sale_order_id
       AND d.status IS DISTINCT FROM 'cancelled'
  ) OR EXISTS (
    SELECT 1
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_id = p_sale_order_id
       AND j.pipeline_status IS DISTINCT FROM 'cancelled'
  ) OR EXISTS (
    SELECT 1
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = p_sale_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND (
         mr.metadata ->> 'kind' = 'atelier_prep'
         OR (mr.metadata ->> 'atelier_linked') = 'true'
       )
  )
  INTO v_has_atelier;

  v_billing := public.resolve_billing_week_for_order(p_sale_order_id);

  SELECT so.delivery_deadline, so.created_at
    INTO v_delivery, v_created
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;

  -- Menor score = maior prioridade
  v_score := CASE WHEN v_has_atelier THEN 0 ELSE 100000000 END
    + CASE
        WHEN v_billing IS NOT NULL THEN EXTRACT(EPOCH FROM v_billing::timestamp)::numeric
        WHEN v_delivery IS NOT NULL THEN 2000000000 + EXTRACT(EPOCH FROM v_delivery::timestamp)::numeric
        ELSE 4000000000 + EXTRACT(EPOCH FROM COALESCE(v_created, now()))::numeric
      END;

  RETURN v_score;
END;
$$;

GRANT EXECUTE ON FUNCTION public.commitment_cover_priority(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Demand explosion for one PV (excludes Solado + strap products)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_order_material_demand_lines(p_sale_order_id uuid)
RETURNS TABLE (
  product_id uuid,
  required numeric,
  component text,
  source text,
  sale_order_item_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_grade jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_pid uuid;
  v_req numeric;
  v_comp text;
  v_src text;
  v_strap uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x.pid), ARRAY[]::uuid[])
    INTO v_strap
    FROM (
      SELECT unnest(ARRAY[
        d.base_product_id,
        d.finished_product_id,
        d.purchase_product_id
      ]) AS pid
        FROM public.sale_order_strap_demands d
       WHERE d.sale_order_id = p_sale_order_id
         AND COALESCE(d.is_current, true)
         AND COALESCE(d.status, '') IS DISTINCT FROM 'cancelled'
    ) x
   WHERE x.pid IS NOT NULL;

  FOR v_item IN
    SELECT *
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
       AND soi.production_excluded_at IS NULL
  LOOP
    SELECT COALESCE(
             jsonb_object_agg(
               g.key,
               (
                 COALESCE(NULLIF(g.value, '')::numeric, 0)
                 * GREATEST(COALESCE(v_item.fichas, 1), 1)
               )::numeric
             ),
             '{}'::jsonb
           )
      INTO v_grade
      FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
     WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) > 0;

    IF v_grade IS NULL OR v_grade = '{}'::jsonb THEN
      v_grade := COALESCE(v_item.grade, '{}'::jsonb);
    END IF;

    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_lines := public.calculate_order_consumption_by_grade(
        v_item.reference_id,
        v_grade,
        v_item.color,
        v_item.material_variant_id
      );
    ELSE
      v_lines := public.calculate_order_consumption(
        v_item.reference_id,
        COALESCE(v_item.quantity, 0),
        v_item.color,
        NULL,
        v_item.material_variant_id
      );
    END IF;

    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN
      CONTINUE;
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;
      v_pid := NULLIF(v_line ->> 'product_id', '')::uuid;
      IF v_pid IS NULL THEN
        CONTINUE;
      END IF;
      v_comp := COALESCE(v_line ->> 'component', '');
      v_src := COALESCE(v_line ->> 'source', '');
      IF v_comp = 'Solado' OR v_src IN ('primary_sole', 'variant_sole') THEN
        CONTINUE;
      END IF;
      IF v_pid = ANY (v_strap) THEN
        CONTINUE;
      END IF;
      v_req := COALESCE(NULLIF(v_line ->> 'required', '')::numeric, 0);
      IF v_req <= 0 THEN
        CONTINUE;
      END IF;

      product_id := v_pid;
      required := v_req;
      component := v_comp;
      source := v_src;
      sale_order_item_id := v_item.id;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sale_order_material_demand_lines(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Commit / recompute (idempotent upsert of pv_commitment)
-- ---------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.recompute_sale_order_material_commitments(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.commit_sale_order_material_demand(p_sale_order_id);
$$;

CREATE OR REPLACE FUNCTION public.release_excess_sale_order_commitments(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
  v_atelier int := 0;
BEGIN
  UPDATE public.material_reservations
     SET status = 'cancelled',
         updated_at = now(),
         notes = COALESCE(notes, '') || ' · liberado cancel/alteração PV'
   WHERE sale_order_id = p_sale_order_id
     AND status IN ('reserved', 'partially_consumed')
     AND COALESCE(metadata ->> 'kind', '') IN ('pv_commitment', 'component')
     AND COALESCE(quantity_consumed, 0) = 0
     AND order_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Soft Ateliê aberto do PV
  UPDATE public.material_reservations
     SET status = 'cancelled',
         updated_at = now(),
         notes = COALESCE(notes, '') || ' · liberado Ateliê (cancel PV)'
   WHERE sale_order_id = p_sale_order_id
     AND status = 'reserved'
     AND COALESCE(metadata ->> 'kind', '') = 'atelier_prep'
     AND COALESCE(quantity_consumed, 0) = 0;
  GET DIAGNOSTICS v_atelier = ROW_COUNT;

  -- Jobs Ateliê: release por job (idempotente)
  PERFORM public.atelier_release_soft_for_job(j.id)
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_id = p_sale_order_id
     AND j.pipeline_status IS DISTINCT FROM 'cancelled';

  RETURN jsonb_build_object('ok', true, 'released_pv', v_n, 'released_atelier', v_atelier);
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_sale_order_material_demand(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_sale_order_material_commitments(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_excess_sale_order_commitments(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cover / rebalance (entrada + escassez)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cover_open_material_commitments(
  p_product_id uuid,
  p_qty numeric DEFAULT NULL,
  p_movement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phys numeric;
  v_reserved numeric;
  v_avail numeric;
BEGIN
  -- Soft pegging: recebimento já subiu products.quantity.
  -- reserved_stock continua refletindo commitments abertos via sync trigger.
  -- Esta função garante recompute de reserved_stock e retorna visão atual.
  SELECT COALESCE(quantity, 0), COALESCE(reserved_stock, 0)
    INTO v_phys, v_reserved
    FROM public.products
   WHERE id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_not_found');
  END IF;

  PERFORM public.sync_product_reserved_stock(p_product_id);

  SELECT COALESCE(quantity, 0), COALESCE(reserved_stock, 0)
    INTO v_phys, v_reserved
    FROM public.products
   WHERE id = p_product_id;

  v_avail := GREATEST(v_phys - v_reserved, 0);

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'physical', v_phys,
    'committed', v_reserved,
    'available', v_avail,
    'movement_id', p_movement_id,
    'inbound_qty', p_qty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rebalance_material_commitments_for_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phys numeric;
  v_need_total numeric;
  v_row record;
  v_remaining numeric;
  v_touched int := 0;
BEGIN
  SELECT COALESCE(quantity, 0) INTO v_phys
    FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(sum(quantity_reserved - COALESCE(quantity_consumed, 0)), 0)
    INTO v_need_total
    FROM public.material_reservations
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed')
     AND COALESCE(metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
     AND strap_variant_id IS NULL;

  IF v_need_total <= v_phys THEN
    RETURN jsonb_build_object('ok', true, 'rebalanced', 0, 'reason', 'covered');
  END IF;

  v_remaining := v_phys;

  -- Prioridade alta primeiro: garante qty; sobra corta dos de prioridade pior
  FOR v_row IN
    SELECT mr.id,
           mr.sale_order_id,
           (mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0)) AS open_qty,
           public.commitment_cover_priority(mr.sale_order_id) AS prio
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component')
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND mr.sale_order_id IS NOT NULL
       -- nunca roubar atelier_prep / hard
       AND COALESCE(mr.metadata ->> 'kind', '') <> 'atelier_prep'
     ORDER BY public.commitment_cover_priority(mr.sale_order_id) ASC, mr.created_at ASC
  LOOP
    IF v_remaining >= v_row.open_qty THEN
      v_remaining := v_remaining - v_row.open_qty;
    ELSE
      IF v_remaining > 0 THEN
        UPDATE public.material_reservations
           SET quantity_reserved = v_remaining,
               updated_at = now(),
               notes = COALESCE(notes, '') || ' · rebalance prioridade'
         WHERE id = v_row.id;
        v_remaining := 0;
      ELSE
        UPDATE public.material_reservations
           SET status = 'cancelled',
               updated_at = now(),
               notes = COALESCE(notes, '') || ' · rebalance liberou (prioridade menor)'
         WHERE id = v_row.id;
      END IF;
      v_touched := v_touched + 1;
    END IF;
  END LOOP;

  PERFORM public.sync_product_reserved_stock(p_product_id);
  RETURN jsonb_build_object('ok', true, 'rebalanced', v_touched);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cover_open_material_commitments(uuid, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebalance_material_commitments_for_product(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- List RPCs (UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_material_commitments_by_pv(p_sale_order_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  product_id uuid,
  product_name text,
  quantity_reserved numeric,
  quantity_consumed numeric,
  open_qty numeric,
  status text,
  kind text,
  order_id uuid,
  order_number text,
  component text,
  physical_qty numeric,
  reserved_stock numeric,
  available_qty numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.id,
         mr.product_id,
         p.name,
         mr.quantity_reserved,
         COALESCE(mr.quantity_consumed, 0),
         mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0),
         mr.status,
         COALESCE(mr.metadata ->> 'kind', 'component'),
         mr.order_id,
         o.order_number,
         mr.metadata ->> 'component',
         COALESCE(p.quantity, 0),
         COALESCE(p.reserved_stock, 0),
         GREATEST(COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0), 0)
    FROM public.material_reservations mr
    JOIN public.products p ON p.id = mr.product_id
    LEFT JOIN public.orders o ON o.id = mr.order_id
   WHERE mr.sale_order_id = p_sale_order_id
     AND mr.status IN ('reserved', 'partially_consumed', 'consumed')
     AND COALESCE(mr.metadata ->> 'kind', '') IN (
           'pv_commitment', 'atelier_prep', 'component'
         )
   ORDER BY p.name, mr.created_at;
$$;

CREATE OR REPLACE FUNCTION public.list_material_commitments_by_product(p_product_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  sale_order_id uuid,
  sale_order_number text,
  quantity_reserved numeric,
  quantity_consumed numeric,
  open_qty numeric,
  status text,
  kind text,
  order_id uuid,
  order_number text,
  priority_score numeric,
  billing_week text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mr.id,
         mr.sale_order_id,
         so.order_number,
         mr.quantity_reserved,
         COALESCE(mr.quantity_consumed, 0),
         mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0),
         mr.status,
         COALESCE(mr.metadata ->> 'kind', 'component'),
         mr.order_id,
         o.order_number,
         CASE WHEN mr.sale_order_id IS NOT NULL
              THEN public.commitment_cover_priority(mr.sale_order_id)
              ELSE NULL END,
         so.billing_week
    FROM public.material_reservations mr
    LEFT JOIN public.sale_orders so ON so.id = mr.sale_order_id
    LEFT JOIN public.orders o ON o.id = mr.order_id
   WHERE mr.product_id = p_product_id
     AND mr.status IN ('reserved', 'partially_consumed')
   ORDER BY
     CASE WHEN mr.sale_order_id IS NOT NULL
          THEN public.commitment_cover_priority(mr.sale_order_id)
          ELSE 9000000000 END,
     mr.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_commitments_by_pv(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_material_commitments_by_product(uuid) TO authenticated, service_role;
