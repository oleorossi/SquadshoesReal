DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week date;
  v_delivery date;
  v_lead_days int;
  v_target date;
BEGIN
  SELECT billing_week, delivery_deadline
    INTO v_billing_week, v_delivery
    FROM sale_orders
   WHERE id = p_sale_order_id;

  -- 1) explicit billing_week wins
  IF v_billing_week IS NOT NULL THEN
    RETURN v_billing_week - ((EXTRACT(ISODOW FROM v_billing_week)::int - 1));
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) lead time from any technical sheet matched by product name
  SELECT COALESCE(ts.lead_time_corte_dias,0)
       + COALESCE(ts.lead_time_costura_dias,0)
       + COALESCE(ts.lead_time_montagem_dias,0)
       + COALESCE(ts.lead_time_acabamento_dias,0)
       + COALESCE(ts.lead_time_buffer_material_dias,0)
    INTO v_lead_days
    FROM sale_order_items soi
    JOIN products p ON p.id = soi.reference_id
    JOIN technical_sheets ts ON LOWER(ts.name) = LOWER(p.name)
   WHERE soi.sale_order_id = p_sale_order_id
     AND COALESCE(ts.lead_time_corte_dias,0)
       + COALESCE(ts.lead_time_costura_dias,0)
       + COALESCE(ts.lead_time_montagem_dias,0)
       + COALESCE(ts.lead_time_acabamento_dias,0)
       + COALESCE(ts.lead_time_buffer_material_dias,0) > 0
   ORDER BY 1 DESC
   LIMIT 1;

  -- 3) fallback to default_lead_times
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias,0)
         + COALESCE(lead_time_costura_dias,0)
         + COALESCE(lead_time_montagem_dias,0)
         + COALESCE(lead_time_acabamento_dias,0)
         + COALESCE(lead_time_buffer_material_dias,0)
      INTO v_lead_days
      FROM default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21;
  END IF;

  v_target := v_delivery - v_lead_days;
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;