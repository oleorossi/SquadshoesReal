-- =============================================================================
-- Add is_approved_user() guard to wave RPCs, resync RPCs, and packaging debit
-- =============================================================================
-- Audit-33 finding [1]: resync_op_atomic + process_resync_queue are SECURITY
-- DEFINER with GRANT TO authenticated but have no is_approved_user() guard.
-- An unapproved user can force full stock churn by passing any OP UUID.
--
-- Audit-33 finding [4]: start_wave, advance_wave_stage, create_production_wave,
-- sync_wave_from_kanban, split_wave_to_finishing, auto_start_due_waves only
-- check auth.uid() IS NULL (not unapproved). Any unapproved authenticated user
-- can skip production stages or corrupt wave planning.
--
-- Audit-33 finding [5]: debit_packaging_for_order_atomic is SECURITY DEFINER,
-- no is_approved_user() guard — unapproved user can debit packaging stock.
-- =============================================================================

-- ── 1. resync_op_atomic ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.resync_op_atomic(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte Palmilha','Corte Forração','Mesa','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'resynced_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_op_atomic(uuid) TO authenticated;

-- ── 2. process_resync_queue ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.process_resync_queue(p_limit integer) CASCADE;
CREATE OR REPLACE FUNCTION public.process_resync_queue(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_row IN
    SELECT id, order_id, artisanal_order_id, reason
      FROM public.resync_queue
     WHERE processed_at IS NULL
       AND order_id IS NOT NULL
     ORDER BY enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.resync_op_atomic(v_row.order_id);
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = v_result
       WHERE id = v_row.id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = jsonb_build_object('error', SQLERRM)
       WHERE id = v_row.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_resync_queue(integer) TO authenticated;

-- ── 3. debit_packaging_for_order_atomic ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic(p_order_id uuid, p_packaging_product_id uuid, p_quantity numeric, p_packaging_type text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order_atomic(
  p_order_id uuid,
  p_packaging_product_id uuid,
  p_quantity numeric,
  p_packaging_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_stock numeric;
  v_new_stock  numeric;
  v_movement_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de embalagem inválida (%)', p_quantity;
  END IF;
  IF p_packaging_product_id IS NULL THEN
    RAISE EXCEPTION 'packaging_product_id é obrigatório';
  END IF;

  SELECT quantity
    INTO v_prev_stock
    FROM public.products
   WHERE id = p_packaging_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto de embalagem não encontrado (%)', p_packaging_product_id;
  END IF;

  v_new_stock := v_prev_stock - p_quantity;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente: disponível % unidade(s), tentado debitar %',
      v_prev_stock, p_quantity;
  END IF;

  UPDATE public.products
     SET quantity = v_new_stock,
         updated_at = now()
   WHERE id = p_packaging_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    p_packaging_product_id,
    'out',
    p_quantity,
    v_prev_stock,
    v_new_stock,
    COALESCE('Embalagem OP - ' || p_packaging_type, 'Embalagem OP'),
    p_order_id
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'product_id', p_packaging_product_id,
    'movement_id', v_movement_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_new_stock,
    'debited', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text)
  TO authenticated;

-- ── 4. start_wave ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.start_wave(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status   = 'pending'
     AND (stage_order(stage) = 1 OR stage_starts_with_wave(stage));

  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage = v_first_stage,
         started_at    = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- ── 5. advance_wave_stage ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.advance_wave_stage(p_wave_id uuid, p_stage   production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum DEFAULT NULL
)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   production_stage_enum;
  v_target    production_stage_enum;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT current_stage
    INTO v_current
    FROM production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_current IS NULL AND p_stage IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  v_target := COALESCE(p_stage, v_current);

  UPDATE production_wave_stages
     SET status      = 'completed',
         finished_at = COALESCE(finished_at, v_now),
         progress_pct = 100,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_target;

  UPDATE order_stages os
     SET status           = 'concluido',
         completed_at     = COALESCE(os.completed_at, v_now),
         quantity_processed = os.quantity_total
    FROM orders o
    JOIN production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN production_wave_items pwi         ON pwi.id = pwis.wave_item_id
   WHERE pwi.wave_id = p_wave_id
     AND os.order_id  = o.id
     AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_target))
     AND os.status NOT IN ('concluido', 'concluído', 'completed', 'done');

  IF EXISTS (
    SELECT 1
      FROM production_wave_stages
     WHERE wave_id = p_wave_id
       AND stage_order(stage) = stage_order(v_target)
       AND status <> 'completed'
       AND stage <> v_target
  ) THEN
    RETURN v_current;
  END IF;

  SELECT pws.stage
    INTO v_next
    FROM production_wave_stages pws
   WHERE pws.wave_id = p_wave_id
     AND stage_order(pws.stage) = stage_order(v_target) + 1
     AND pws.status <> 'completed'
   ORDER BY pws.stage
   LIMIT 1;

  IF v_next IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM production_wave_stages
       WHERE wave_id = p_wave_id
         AND status <> 'completed'
    ) THEN
      UPDATE production_waves
         SET status      = 'finished',
             finished_at = v_now,
             current_stage = NULL
       WHERE id = p_wave_id;
      RETURN NULL;
    END IF;
    RETURN v_current;
  END IF;

  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = COALESCE(started_at, v_now),
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_next;

  UPDATE production_waves
     SET current_stage = v_next
   WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;

-- ── 6. create_production_wave ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) CASCADE;
CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id  uuid;
  v_code     text;
  v_week_end date;
  v_row      RECORD;
  v_item_id  uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  v_week_end := p_week_start + 6;
  v_code := 'W' || to_char(p_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, p_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  WITH sectors_needed AS (
    SELECT DISTINCT sector_display_to_enum(s.nm) AS stage
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(
        NULLIF(ts.production_sectors, 'null'::jsonb),
        '["Corte Palmilha","Corte Forração","Mesa","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb
      )
    ) AS s(nm)
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sector_display_to_enum(s.nm) IS NOT NULL
  ),
  capacities(stage, cap) AS (
    SELECT 'corte_palmilha'::production_stage_enum, MAX(ts.sewing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'corte_forracao'::production_stage_enum, MAX(ts.cutting_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'mesa'::production_stage_enum, MAX(ts.mesa_daily_capacity)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'silk'::production_stage_enum, MAX(ts.silk_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'colagem'::production_stage_enum, MAX(ts.gluing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'montagem'::production_stage_enum, MAX(ts.assembly_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'solagem'::production_stage_enum, MAX(ts.soling_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'acabamento'::production_stage_enum, MAX(ts.finishing_capacity_per_day)
    FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    UNION ALL
    SELECT 'expedicao'::production_stage_enum, 0
  )
  INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
  SELECT v_wave_id, sn.stage, 'pending', COALESCE(c.cap, 0)
  FROM sectors_needed sn
  LEFT JOIN capacities c ON c.stage = sn.stage
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id                                                         AS source_item_id,
      so.id                                                          AS sale_order_id,
      so.client_id                                                   AS client_id,
      COALESCE(c.razao_social, so.id::text)                          AS store_name,
      soi.reference_id                                               AS reference_id,
      COALESCE(soi.color, '')                                        AS color,
      COALESCE(soi.quantity, 0)::numeric                             AS qty,
      COALESCE(soi.grade, '{}'::jsonb)                               AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = ANY(p_sale_order_ids)
  LOOP
    INSERT INTO production_wave_items(
      wave_id, reference_id, sole_product_id, color, total_quantity, grade
    ) VALUES (
      v_wave_id, v_row.reference_id, v_row.sole_id,
      v_row.color, v_row.qty, v_row.grade
    )
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity =
      production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id,
      client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves w
  SET
    total_pairs = COALESCE(
      (SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id), 0),
    total_items = COALESCE(
      (SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id), 0),
    status = 'planning'
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_wave(date, uuid[]) TO authenticated;

-- ── 7. sync_wave_from_kanban ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.sync_wave_from_kanban(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec            RECORD;
  v_total_orders   int;
  v_done_orders    int;
  v_new_current    production_stage_enum;
  v_now            timestamptz := now();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT COUNT(DISTINCT o.id)
    INTO v_total_orders
    FROM production_wave_items pwi
    JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
    JOIN orders o ON o.sale_order_id = pwis.sale_order_id
   WHERE pwi.wave_id = p_wave_id
     AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado');

  IF v_total_orders = 0 THEN
    RETURN NULL;
  END IF;

  FOR v_rec IN
    SELECT pws.stage, stage_order(pws.stage) AS lvl, pws.status AS cur_status
      FROM production_wave_stages pws
     WHERE pws.wave_id = p_wave_id
     ORDER BY stage_order(pws.stage), pws.stage
  LOOP
    SELECT COUNT(DISTINCT o.id)
      INTO v_done_orders
      FROM production_wave_items pwi
      JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN orders o ON o.sale_order_id = pwis.sale_order_id
     WHERE pwi.wave_id = p_wave_id
       AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado')
       AND EXISTS (
         SELECT 1
           FROM order_stages os
          WHERE os.order_id = o.id
            AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_rec.stage))
            AND os.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       );

    IF v_done_orders >= v_total_orders THEN
      UPDATE production_wave_stages
         SET status      = 'completed',
             finished_at = COALESCE(finished_at, v_now),
             progress_pct = 100,
             updated_at  = v_now
       WHERE wave_id = p_wave_id
         AND stage = v_rec.stage
         AND status <> 'completed';
    ELSE
      IF v_new_current IS NULL THEN
        v_new_current := v_rec.stage;
        UPDATE production_wave_stages
           SET status      = 'in_progress',
               started_at  = COALESCE(started_at, v_now),
               progress_pct = CASE WHEN v_total_orders > 0
                                   THEN round((v_done_orders::numeric / v_total_orders) * 100)
                                   ELSE 0 END,
               updated_at  = v_now
         WHERE wave_id = p_wave_id
           AND stage = v_rec.stage
           AND status <> 'completed';
      END IF;
    END IF;
  END LOOP;

  IF v_new_current IS NULL THEN
    UPDATE production_waves
       SET status      = 'finished',
           current_stage = NULL,
           finished_at = COALESCE(finished_at, v_now)
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  ELSE
    UPDATE production_waves
       SET current_stage = v_new_current,
           status        = 'running'
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  END IF;

  RETURN v_new_current;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_wave_from_kanban(uuid) TO authenticated;

-- ── 8. split_wave_to_finishing ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.split_wave_to_finishing(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.split_wave_to_finishing(p_wave_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  DELETE FROM production_finishing_packages WHERE wave_id = p_wave_id;

  INSERT INTO production_finishing_packages(
    wave_id, sale_order_id, store_name, reference_id, color, quantity, grade
  )
  WITH qty_agg AS (
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      SUM(src.quantity) AS quantity
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color
  ),
  grade_keys AS (
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      g.k,
      SUM(g.v) AS size_qty
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    JOIN LATERAL (
      SELECT key AS k, (value::text)::numeric AS v
      FROM jsonb_each_text(src.grade)
      WHERE key ~ '^[0-9]+$'
    ) g ON TRUE
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color, g.k
  ),
  grade_agg AS (
    SELECT
      wave_id, sale_order_id, store_name, reference_id, color,
      jsonb_object_agg(k, size_qty) AS grade
    FROM grade_keys
    GROUP BY wave_id, sale_order_id, store_name, reference_id, color
  )
  SELECT
    q.wave_id,
    q.sale_order_id,
    q.store_name,
    q.reference_id,
    q.color,
    q.quantity,
    COALESCE(g.grade, '{}'::jsonb) AS grade
  FROM qty_agg q
  LEFT JOIN grade_agg g USING (wave_id, sale_order_id, store_name, reference_id, color);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.split_wave_to_finishing(uuid) TO authenticated;

-- ── 9. auto_start_due_waves ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.auto_start_due_waves() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_start_due_waves()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave  record;
  v_count int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_wave IN
    SELECT id
      FROM production_waves
     WHERE status IN ('draft', 'planning')
       AND corte_palmilha_start_date IS NOT NULL
       AND corte_palmilha_start_date <= CURRENT_DATE
  LOOP
    UPDATE production_wave_stages
       SET status = 'in_progress'
     WHERE wave_id = v_wave.id AND stage = 'corte_palmilha';

    UPDATE production_waves
       SET status        = 'running',
           current_stage = 'corte_palmilha',
           started_at    = COALESCE(started_at, now()),
           start_mode    = 'auto'
     WHERE id = v_wave.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_start_due_waves() TO authenticated;
