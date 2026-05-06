-- Lead Time Fallback Chain + Artisanal OS Automation
--
-- 1. shoe_category_lead_times: per-category fallback lead times
-- 2. compute_wave_timeline: updated with 3-level fallback
--    Level 1: technical_sheet value (if > 0 = explicitly set by user)
--    Level 2: shoe_category default
--    Level 3: global hardcoded default
-- 3. Supplier memory: supplier_id on products is already present; no schema change needed

-- ── 1. Shoe category lead time defaults ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shoe_category_lead_times (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shoe_category        text NOT NULL UNIQUE,
  corte_dias           int  NOT NULL DEFAULT 2,
  costura_dias         int  NOT NULL DEFAULT 3,
  montagem_dias        int  NOT NULL DEFAULT 2,
  acabamento_dias      int  NOT NULL DEFAULT 1,
  buffer_material_dias int  NOT NULL DEFAULT 2,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shoe_category_lead_times ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all authenticated" ON public.shoe_category_lead_times;
CREATE POLICY "allow all authenticated" ON public.shoe_category_lead_times
  FOR ALL USING (auth.role() = 'authenticated');

-- Seed common shoe categories
INSERT INTO public.shoe_category_lead_times
  (shoe_category, corte_dias, costura_dias, montagem_dias, acabamento_dias, buffer_material_dias)
VALUES
  ('Sandália',   1, 2, 2, 1, 2),
  ('Rasteira',   1, 2, 2, 1, 2),
  ('Chinelo',    1, 1, 1, 1, 1),
  ('Scarpin',    2, 3, 2, 1, 2),
  ('Bota',       3, 4, 3, 1, 3),
  ('Botina',     3, 4, 3, 1, 3),
  ('Tênis',      2, 3, 2, 1, 2),
  ('Sapatênis',  2, 3, 2, 1, 2),
  ('Sapatilha',  1, 2, 1, 1, 1),
  ('Sapato',     2, 3, 2, 1, 2),
  ('Mule',       1, 2, 2, 1, 2),
  ('Tamanco',    2, 3, 2, 1, 2),
  ('Plataforma', 2, 3, 2, 1, 2)
ON CONFLICT (shoe_category) DO NOTHING;

-- ── 2. compute_wave_timeline with 3-level fallback ────────────────────────────
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
  -- Earliest delivery deadline from sale orders
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- 3-level fallback per lead time field:
  --   Level 1: technical_sheet value if > 0 (user explicitly set it)
  --   Level 2: shoe_category default from shoe_category_lead_times
  --   Level 3: global hardcoded default (2/3/2/1/2 matching column defaults)
  SELECT
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_corte_dias,           0),
        (SELECT sc.corte_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_costura_dias,         0),
        (SELECT sc.costura_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        3
      )
    ), 3),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_montagem_dias,        0),
        (SELECT sc.montagem_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_acabamento_dias,      0),
        (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        1
      )
    ), 1),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_buffer_material_dias, 0),
        (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time: COALESCE already provides 7-day fallback
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline                                                        AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date                         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date                       AS purchase_deadline;
END;
$$;
