-- Quick win 3 do roadmap (auditoria 30/05). Cycle counting operacional.
-- As tabelas cycle_counts / cycle_count_items já existiam (1 registro órfão).
-- Faltavam as RPCs e a view de dashboard.

CREATE OR REPLACE FUNCTION public.create_cycle_count(
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_seq int;
  v_number text;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT COALESCE(MAX(CASE WHEN count_number ~ '^CC-\d+$'
                          THEN substring(count_number FROM 4)::int
                          ELSE 0 END), 0) + 1
    INTO v_seq
    FROM public.cycle_counts;

  v_number := 'CC-' || lpad(v_seq::text, 5, '0');

  INSERT INTO public.cycle_counts (
    id, count_number, count_date, status, total_items, accurate_items, accuracy_pct, notes, counted_by
  ) VALUES (
    gen_random_uuid(), v_number, CURRENT_DATE, 'open', 0, 0, 0, p_notes,
    COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_cycle_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cycle_count(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_cycle_count_item(
  p_cycle_id uuid,
  p_product_id uuid,
  p_counted_quantity numeric,
  p_bin_location text DEFAULT NULL,
  p_lot_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_system_qty numeric;
  v_cycle_status text;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT status INTO v_cycle_status FROM public.cycle_counts WHERE id = p_cycle_id;
  IF v_cycle_status IS NULL THEN
    RAISE EXCEPTION 'Ciclo % não encontrado', p_cycle_id;
  END IF;
  IF v_cycle_status <> 'open' THEN
    RAISE EXCEPTION 'Ciclo % não está aberto (status=%)', p_cycle_id, v_cycle_status;
  END IF;

  SELECT quantity INTO v_system_qty FROM public.products WHERE id = p_product_id;
  IF v_system_qty IS NULL THEN
    RAISE EXCEPTION 'Produto % não encontrado', p_product_id;
  END IF;

  DELETE FROM public.cycle_count_items
   WHERE cycle_count_id = p_cycle_id
     AND product_id = p_product_id
     AND COALESCE(bin_location, '') = COALESCE(p_bin_location, '')
     AND COALESCE(lot_number, '') = COALESCE(p_lot_number, '');

  INSERT INTO public.cycle_count_items (
    id, cycle_count_id, product_id, system_quantity, counted_quantity,
    variance, bin_location, lot_number, notes, adjusted
  ) VALUES (
    gen_random_uuid(), p_cycle_id, p_product_id, v_system_qty, p_counted_quantity,
    p_counted_quantity - v_system_qty, p_bin_location, p_lot_number, p_notes, false
  )
  RETURNING id INTO v_item_id;

  UPDATE public.cycle_counts
     SET total_items = (SELECT COUNT(*) FROM public.cycle_count_items WHERE cycle_count_id = p_cycle_id),
         accurate_items = (SELECT COUNT(*) FROM public.cycle_count_items WHERE cycle_count_id = p_cycle_id AND variance = 0),
         updated_at = now()
   WHERE id = p_cycle_id;

  RETURN v_item_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_cycle_count_item(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_cycle_count_item(uuid, uuid, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_cycle_count(
  p_cycle_id uuid,
  p_apply_adjustments boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle_status text;
  v_total int := 0;
  v_accurate int := 0;
  v_adjusted int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_item record;
  v_adj_result record;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','almoxarifado']) THEN
    RAISE EXCEPTION 'Permission denied: requer admin/gerente/almoxarifado';
  END IF;

  SELECT status INTO v_cycle_status FROM public.cycle_counts WHERE id = p_cycle_id FOR UPDATE;
  IF v_cycle_status IS NULL THEN
    RAISE EXCEPTION 'Ciclo % não encontrado', p_cycle_id;
  END IF;
  IF v_cycle_status <> 'open' THEN
    RAISE EXCEPTION 'Ciclo % não está aberto (status=%)', p_cycle_id, v_cycle_status;
  END IF;

  IF p_apply_adjustments THEN
    FOR v_item IN
      SELECT id, product_id, system_quantity, counted_quantity, variance
        FROM public.cycle_count_items
       WHERE cycle_count_id = p_cycle_id
         AND variance <> 0
         AND COALESCE(adjusted, false) = false
    LOOP
      BEGIN
        SELECT * INTO v_adj_result
          FROM public.adjust_stock(
            v_item.product_id,
            v_item.system_quantity,
            v_item.counted_quantity,
            v_item.variance,
            'Inventário rotativo ' || (SELECT count_number FROM public.cycle_counts WHERE id = p_cycle_id),
            NULL::jsonb,
            NULL::uuid
          );
        IF v_adj_result.success THEN
          UPDATE public.cycle_count_items SET adjusted = true WHERE id = v_item.id;
          v_adjusted := v_adjusted + 1;
        ELSE
          v_failed := v_failed + 1;
          v_failures := v_failures || jsonb_build_array(jsonb_build_object(
            'item_id', v_item.id, 'product_id', v_item.product_id,
            'error', v_adj_result.error_message,
            'current_db_qty', v_adj_result.current_db_qty
          ));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'item_id', v_item.id, 'product_id', v_item.product_id,
          'error', SQLERRM
        ));
      END;
    END LOOP;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE variance = 0)
    INTO v_total, v_accurate
    FROM public.cycle_count_items WHERE cycle_count_id = p_cycle_id;

  UPDATE public.cycle_counts
     SET status = 'closed',
         total_items = v_total,
         accurate_items = v_accurate,
         accuracy_pct = CASE WHEN v_total > 0 THEN ROUND(100.0 * v_accurate / v_total, 2) ELSE 0 END,
         approved_by = COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), ''),
         updated_at = now()
   WHERE id = p_cycle_id;

  RETURN jsonb_build_object(
    'success', v_failed = 0,
    'total_items', v_total,
    'accurate_items', v_accurate,
    'adjustments_applied', v_adjusted,
    'failures', v_failed,
    'failure_details', v_failures,
    'accuracy_pct', CASE WHEN v_total > 0 THEN ROUND(100.0 * v_accurate / v_total, 2) ELSE 0 END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_cycle_count(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_cycle_count(uuid, boolean) TO authenticated;

CREATE OR REPLACE VIEW public.v_cycle_counts_summary AS
SELECT
  cc.id, cc.count_number, cc.count_date, cc.status, cc.total_items,
  cc.accurate_items, cc.accuracy_pct, cc.counted_by, cc.approved_by, cc.notes,
  cc.created_at, cc.updated_at,
  (SELECT COUNT(*) FROM cycle_count_items WHERE cycle_count_id = cc.id AND variance > 0) AS items_over,
  (SELECT COUNT(*) FROM cycle_count_items WHERE cycle_count_id = cc.id AND variance < 0) AS items_under,
  (SELECT COUNT(*) FROM cycle_count_items WHERE cycle_count_id = cc.id AND COALESCE(adjusted, false) = true) AS items_adjusted
FROM public.cycle_counts cc
ORDER BY cc.created_at DESC;

ALTER VIEW public.v_cycle_counts_summary SET (security_invoker = on);
GRANT SELECT ON public.v_cycle_counts_summary TO authenticated;
