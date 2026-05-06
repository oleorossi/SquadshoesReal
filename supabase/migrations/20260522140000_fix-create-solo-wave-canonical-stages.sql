-- =============================================================================
-- Fix create_solo_wave: use canonical post-rename stage enum values
-- =============================================================================
-- Audit-33 finding [3]: Migration 20260521140000_tighten-solo-wave-approved-user
-- copy-pasted the original create_solo_wave body (pre-rename) and added the
-- is_approved_user() guard, but did NOT update the hard-coded stage names.
-- The base stages array still used legacy values ('corte','costura') that were
-- renamed in 20260506120000 to 'corte_palmilha','corte_forracao'. The separate
-- conditional palmilha INSERT is now redundant since 'corte_palmilha' is always
-- present.
--
-- Impact: solo waves created after audit-32 get stages with legacy enum values.
-- compute_wave_timeline()/update_wave_timeline() match only canonical names →
-- timeline columns stay NULL; auto_start_due_waves targets 'corte_palmilha' and
-- never finds the legacy 'corte' row → solo waves never auto-start.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_solo_wave(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.create_solo_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id    uuid;
  v_wave_code  text;
  v_week_start date;
  v_week_end   date;
  v_order_num  text;
  v_item_id    uuid;
  v_row        RECORD;
  v_mesa_cap   int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  v_week_start := date_trunc('week', current_date)::date;
  v_week_end   := v_week_start + 6;

  SELECT COALESCE(order_number, id::text) INTO v_order_num
    FROM sale_orders WHERE id = p_sale_order_id;

  v_wave_code := 'PV-' || v_order_num;

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_wave_code, v_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  -- Base sectors (always present) — canonical post-rename vocabulary
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte_palmilha','corte_forracao','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  -- Mesa: when the reference requires it (mesa_daily_capacity > 0)
  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0) INTO v_mesa_cap
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_cap > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa', 'pending', v_mesa_cap)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Wave items (grouped by reference + sole + color)
  FOR v_row IN
    SELECT
      soi.id                                 AS source_item_id,
      so.id                                  AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text)  AS store_name,
      soi.reference_id,
      COALESCE(soi.color, '')                AS color,
      COALESCE(soi.quantity, 0)::numeric     AS qty,
      COALESCE(soi.grade, '{}'::jsonb)       AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = p_sale_order_id
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  -- Totals
  UPDATE production_waves SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    status = 'planning'
  WHERE id = v_wave_id;

  -- Auto-start (Corte Palmilha + Mesa if present)
  PERFORM public.start_wave(v_wave_id);

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_solo_wave(uuid) TO authenticated;

COMMENT ON FUNCTION public.create_solo_wave(uuid) IS
  'Creates a solo production wave for a single PV. Uses canonical post-rename '
  'stage vocabulary (corte_palmilha, corte_forracao, etc). Requires approved user.';
