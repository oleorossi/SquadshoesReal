-- 1) Add missing columns to production_waves
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS silk_start_date    date,
  ADD COLUMN IF NOT EXISTS colagem_start_date date,
  ADD COLUMN IF NOT EXISTS solagem_start_date date;

-- 2) Recreate update_wave_timeline() to persist the three new columns
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl             record;
BEGIN
  SELECT array_agg(DISTINCT sale_order_id)
    INTO v_sale_order_ids
    FROM public.orders
   WHERE wave_id = p_wave_id;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM public.compute_wave_timeline(v_sale_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline   = v_tl.earliest_deadline,
         corte_start_date    = v_tl.corte_start_date,
         costura_start_date  = v_tl.costura_start_date,
         silk_start_date     = v_tl.silk_start_date,
         colagem_start_date  = v_tl.colagem_start_date,
         solagem_start_date  = v_tl.solagem_start_date,
         purchase_deadline   = v_tl.purchase_deadline,
         material_ready_date = v_tl.material_ready_date,
         updated_at          = now()
   WHERE id = p_wave_id;
END;
$$;

COMMENT ON FUNCTION public.update_wave_timeline(uuid) IS
  'Recomputes and persists all timeline dates for a production wave. '
  'Includes silk_start_date, colagem_start_date, solagem_start_date added in '
  'sector-rename migration 20260506120000.';