-- Fix compute_wave_timeline: only add supplier lead time when a material is
-- actually short (needed qty > current stock). If ALL materials are in stock
-- the supplier delay is 0 and corte_start_date is computed from production
-- lead times only — no extra wait for material arrival.

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
  --   Level 3: global hardcoded default (2/3/2/1/2)
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

  -- Supplier lead time: ONLY counted for materials that are actually short.
  -- Aggregate total required qty per product across all sale order items,
  -- then compare against current stock. If stock covers the demand, that
  -- product contributes 0 days; if short, it contributes its supplier_lead_time_days.
  -- The wave must wait for the slowest short material.
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7)
         ELSE 0
    END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

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
