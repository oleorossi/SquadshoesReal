
DROP FUNCTION IF EXISTS public.process_order_stock_out(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.process_order_stock_out(
  p_order_id uuid,
  p_product_id uuid,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet_exists boolean;
  v_component RECORD;
  v_consumption_per_pair numeric;
  v_waste_pct numeric;
  v_total_to_debit numeric;
  v_prev_qty numeric;
  v_new_qty numeric;
  v_components_processed integer := 0;
  v_components_debited integer := 0;
  v_total_value numeric := 0;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.technical_sheets WHERE id = p_product_id) INTO v_sheet_exists;
  IF NOT v_sheet_exists THEN
    RETURN jsonb_build_object('success', false, 'reason', 'technical_sheet_not_found');
  END IF;

  FOR v_component IN
    SELECT
      sm.product_id,
      sm.quantity_per_unit,
      cs.yield_per_size,
      COALESCE(cs.waste_pct, 0) AS waste_pct,
      p.quantity AS current_qty,
      p.unit_price
    FROM public.sheet_materials sm
    INNER JOIN public.component_sheets cs ON cs.product_id = sm.product_id
    INNER JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_product_id
      AND sm.product_id IS NOT NULL
  LOOP
    v_components_processed := v_components_processed + 1;

    v_consumption_per_pair := COALESCE(
      NULLIF((v_component.yield_per_size->>'unit')::numeric, 0),
      v_component.quantity_per_unit,
      0
    );

    IF v_consumption_per_pair <= 0 THEN
      CONTINUE;
    END IF;

    v_waste_pct := COALESCE(v_component.waste_pct, 0);
    v_total_to_debit := v_consumption_per_pair * p_quantity * (1 + v_waste_pct / 100.0);

    v_prev_qty := COALESCE(v_component.current_qty, 0);
    v_new_qty := v_prev_qty - v_total_to_debit;

    UPDATE public.products
    SET quantity = v_new_qty
    WHERE id = v_component.product_id;

    INSERT INTO public.stock_movements (
      product_id, order_id, movement_type, quantity,
      previous_stock, new_stock, description
    ) VALUES (
      v_component.product_id,
      p_order_id,
      'out',
      v_total_to_debit,
      v_prev_qty,
      v_new_qty,
      'Baixa automática de componente via OP (consumo por par + perda)'
    );

    v_components_debited := v_components_debited + 1;
    v_total_value := v_total_value + (v_total_to_debit * COALESCE(v_component.unit_price, 0));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'components_processed', v_components_processed,
    'components_debited', v_components_debited,
    'total_value', v_total_value
  );
END;
$function$;
