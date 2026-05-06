DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week_text text;
  v_delivery date;
  v_lead_days int;
  v_target date;
  v_billing_date date;
  v_year int;
  v_month int;
  v_week int;
  v_first_day date;
  v_dow int;
BEGIN
  -- Fetch as text to avoid automatic cast crashes
  SELECT billing_week::text, delivery_deadline
    INTO v_billing_week_text, v_delivery
    FROM public.sale_orders
   WHERE id = p_sale_order_id;

  IF v_billing_week_text IS NOT NULL AND v_billing_week_text <> '' THEN
    -- 1) Try ISO week format (YYYY-Www)
    IF v_billing_week_text ~ '^\d{4}-W\d{1,2}$' THEN
      v_billing_date := public.parse_iso_billing_week(v_billing_week_text);
    
    -- 2) Try Month-Week format (YYYY-MM-S#) - e.g., 2026-05-S1
    ELSIF v_billing_week_text ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
      v_year := split_part(v_billing_week_text, '-', 1)::int;
      v_month := split_part(v_billing_week_text, '-', 2)::int;
      v_week := substring(split_part(v_billing_week_text, '-', 3) from 2)::int;
      
      v_first_day := make_date(v_year, v_month, 1);
      v_dow := (EXTRACT(ISODOW FROM v_first_day)::int) - 1;
      -- Align to first Monday of the month (standardizing week start)
      v_billing_date := v_first_day - v_dow;
      -- Advance to target week
      v_billing_date := v_billing_date + ((v_week - 1) * 7);
      
    -- 3) Try direct date format (YYYY-MM-DD)
    ELSIF v_billing_week_text ~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_billing_date := v_billing_week_text::date;
    END IF;

    IF v_billing_date IS NOT NULL THEN
      -- Always return the Monday of that week
      RETURN v_billing_date - ((EXTRACT(ISODOW FROM v_billing_date)::int - 1));
    END IF;
  END IF;

  -- Fallback logic if no billing week or parsing failed
  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate lead time from technical sheets
  SELECT COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0)
    INTO v_lead_days
    FROM public.sale_order_items soi
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND (COALESCE(ts.lead_time_corte_dias, 0)
        + COALESCE(ts.lead_time_costura_dias, 0)
        + COALESCE(ts.lead_time_montagem_dias, 0)
        + COALESCE(ts.lead_time_acabamento_dias, 0)
        + COALESCE(ts.lead_time_buffer_material_dias, 0)) > 0
   ORDER BY 1 DESC
   LIMIT 1;

  -- Default fallback lead times
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias, 0)
         + COALESCE(lead_time_costura_dias, 0)
         + COALESCE(lead_time_montagem_dias, 0)
         + COALESCE(lead_time_acabamento_dias, 0)
         + COALESCE(lead_time_buffer_material_dias, 0)
      INTO v_lead_days
      FROM public.default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21; -- Standard 3 weeks
  END IF;

  v_target := v_delivery - v_lead_days;
  -- Return Monday of the target week
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;