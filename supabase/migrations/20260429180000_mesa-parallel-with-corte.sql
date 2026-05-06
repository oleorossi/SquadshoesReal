-- Mesa sector: independent, runs parallel with Corte
--
-- Mesa handles the upper part of the shoe (parte de cima / cabedal).
-- It starts as soon as the wave begins — it does not depend on Corte's output.
--
-- New stage flow:
--   start_wave → Corte(1) ‖ Mesa(1)
--              → Palmilha(2) ‖ Costura(2)   [after ALL level-1 stages complete]
--              → Montagem(3) → Solagem(4) → Acabamento(5)
--
-- Mesa is removed from the linear timeline cascade because it runs in
-- parallel with Corte and does not lengthen the critical path.
--
-- Changes:
--   1. stage_order(): mesa = 1 (parallel with corte)
--   2. start_wave(): start ALL level-1 stages (corte AND mesa when present)
--   3. compute_wave_timeline(): remove mesa from the backward cascade

-- ── 1. stage_order ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 1  -- parallel with corte (independent sector)
    WHEN 'palmilha'   THEN 2  -- parallel with costura
    WHEN 'costura'    THEN 2  -- parallel with palmilha
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. start_wave — start ALL level-1 stages ────────────────────────────────────
DROP FUNCTION IF EXISTS public.start_wave(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Start ALL stages at the minimum order level (1 = corte + mesa when present)
  UPDATE production_wave_stages
     SET status     = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND stage_order(stage) = 1;

  -- Set current_stage to the first level-1 stage alphabetically (deterministic)
  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id AND stage_order(stage) = 1 AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- ── 3. compute_wave_timeline — mesa removed from cascade ────────────────────────
-- Mesa runs in parallel with Corte at level 1 and is not on the critical path.
-- Cascade is now: deadline → -acab → -montagem → -costura → -corte → -buffer → -supplier
DROP FUNCTION IF EXISTS public.compute_wave_timeline(p_sale_order_ids uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
      (SELECT sc.corte_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
      (SELECT sc.costura_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 3)), 3),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Mesa runs in parallel with Corte (level 1) — not in the critical path.
  -- Cascade: deadline → -acab → -montagem → -costura → -corte → -buffer → -supplier
  RETURN QUERY SELECT
    v_deadline                                                                          AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                                          AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                                          AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date                                 AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                    AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer)::date                          AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer
       - v_lead_supplier)::date                                                         AS purchase_deadline;
END;
$$;
