DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_billing_week_text text;
  v_delivery_month text;
  v_delivery_week text;
  v_delivery date;
  v_lead_days int;
  v_target date;
  v_year int;
  v_month int;
  v_week_num int;
  v_first_of_month date;
  v_first_monday date;
  v_billing_date date;
BEGIN
  SELECT billing_week, delivery_month, delivery_week, delivery_deadline
    INTO v_billing_week_text, v_delivery_month, v_delivery_week, v_delivery
    FROM sale_orders
   WHERE id = p_sale_order_id;

  -- 1) Try to parse delivery_month ("YYYY-MM") + delivery_week ("Sn") into a date
  IF v_delivery_month ~ '^[0-9]{4}-[0-9]{2}$' AND v_delivery_week ~ '^S[0-9]+$' THEN
    v_year := split_part(v_delivery_month, '-', 1)::int;
    v_month := split_part(v_delivery_month, '-', 2)::int;
    v_week_num := substring(v_delivery_week from 2)::int;
    v_first_of_month := make_date(v_year, v_month, 1);
    -- Monday of the first ISO week that contains the 1st (or first Monday of the month)
    v_first_monday := v_first_of_month - ((EXTRACT(ISODOW FROM v_first_of_month)::int - 1));
    v_billing_date := v_first_monday + ((v_week_num - 1) * 7);
    RETURN v_billing_date;
  END IF;

  -- 2) Backwards-compat: if billing_week happens to be a literal date string (YYYY-MM-DD)
  IF v_billing_week_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    BEGIN
      v_billing_date := v_billing_week_text::date;
      RETURN v_billing_date - ((EXTRACT(ISODOW FROM v_billing_date)::int - 1));
    EXCEPTION WHEN OTHERS THEN
      -- ignore and fall through
      NULL;
    END;
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- 3) lead time from any technical sheet matched by product name
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

  -- 4) fallback to default_lead_times
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