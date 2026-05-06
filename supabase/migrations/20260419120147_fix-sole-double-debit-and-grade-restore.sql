-- ============================================================
-- Fix: duplo débito do solado quando OP tem grade
--
-- Problema: quando hybrid_debit_stock_for_order é chamado com
-- p_order_grade != NULL, ele debita quantity do solado via a
-- lista de consumption (source='primary_sole'). Logo depois, o
-- frontend chama debit_sole_stock_by_grade que debita quantity
-- novamente — resultando em dois débitos do mesmo solado.
--
-- Solução: quando p_order_grade != NULL, o solado é registrado
-- como reserva (para rastreamento) mas NÃO gera UPDATE em
-- products.quantity. O debit_sole_stock_by_grade fica como
-- única fonte de verdade para o débito por numeração.
-- ============================================================

DROP FUNCTION IF EXISTS public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
BEGIN
  -- When grade is present, debit_sole_stock_by_grade will handle sole stock
  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT key::integer INTO v_size
      FROM jsonb_each_text(p_order_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, p_order_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;

  -- Phase 1: lock + fail-fast
  -- Skip sole stock check here when grade is present (debit_sole_stock_by_grade validates per-size)
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';

    -- When grade handles sole debit, skip sole validation here
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      CONTINUE;
    END IF;

    SELECT id, quantity, name INTO v_product
      FROM public.products WHERE id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
    END IF;

    v_required := (v_item ->> 'required')::numeric;
    IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
      RAISE EXCEPTION
        'Estoque insuficiente para % "%": disponível %, necessário %',
        v_item ->> 'component', v_product.name, v_product.quantity, v_required;
    END IF;
  END LOOP;

  -- Phase 2: actual debit
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    -- Sole handled by debit_sole_stock_by_grade when grade is present:
    -- register reservation for traceability but skip the stock UPDATE
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft')
      ON CONFLICT DO NOTHING;

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF v_mode = 'hard' THEN
      UPDATE public.products
         SET quantity = quantity - v_required, updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- Fix: restaurar stock_grade do solado ao cancelar/excluir OP
--
-- Problema: useDeleteOrder (TypeScript) restaura quantity via
-- stock_movements, mas nunca restaura stock_grade por numeração.
-- Após excluir uma OP, o estoque por numeração fica defasado.
--
-- Solução: nova função restore_sole_grade_for_order que lê a
-- grade da OP excluída e devolve os pares por numeração.
-- ============================================================

DROP FUNCTION IF EXISTS public.restore_sole_grade_for_order(
  p_order_id uuid
) CASCADE;
CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(
  p_order_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_ref_id uuid;
  v_color text;
  v_grade jsonb;
  v_target_product_id uuid;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_total_restored numeric := 0;
BEGIN
  SELECT reference_id, color, grade
    INTO v_ref_id, v_color, v_grade
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND OR v_grade IS NULL OR jsonb_typeof(v_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- Resolve which sole product was debited (same logic as debit_sole_stock_by_grade)
  SELECT tsc.sole_product_id INTO v_target_product_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = v_ref_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(v_color, '')))
   LIMIT 1;

  IF v_target_product_id IS NULL THEN
    SELECT p.id INTO v_target_product_id
      FROM public.products p
      JOIN public.technical_sheets ts ON ts.id = v_ref_id
     WHERE p.active = true
       AND (p.group_id = ts.sole_group_id OR ts.primary_sole_id = p.id)
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(p.color,''))) = UPPER(TRIM(COALESCE(v_color,'')))
            THEN 0 ELSE 1 END,
       p.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_target_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT stock_grade INTO v_stock_grade
    FROM public.products WHERE id = v_target_product_id;

  v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(v_grade)
     WHERE value::numeric > 0
  LOOP
    v_new_grade := jsonb_set(
      v_new_grade,
      ARRAY[v_size],
      to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty)
    );
    v_total_restored := v_total_restored + v_size_qty;
  END LOOP;

  IF v_total_restored > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade, updated_at = now()
     WHERE id = v_target_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid) TO authenticated;
