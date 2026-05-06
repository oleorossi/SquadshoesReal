DROP VIEW IF EXISTS public.sale_order_min_billing;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_total_days integer := 0;
  v_max_supplier_lead integer := 0;
  v_buffer_material integer := 2;
  v_corte integer := 0;
  v_costura integer := 0;
  v_montagem integer := 0;
  v_acabamento integer := 0;
BEGIN
  SELECT
    COALESCE(MAX(
      CASE
        WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
      END
    ), 0),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
      END
    ), 0),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), MAX(dlt.lead_time_buffer_material_dias), 2)
  INTO v_corte, v_costura, v_montagem, v_acabamento, v_buffer_material
  FROM public.orders o
  JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.sale_order_id = p_sale_order_id
    AND o.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO', 'Pronto');

  SELECT COALESCE(MAX(p.supplier_lead_time_days), 7)
  INTO v_max_supplier_lead
  FROM public.orders o
  JOIN public.sheet_materials sm ON sm.sheet_id = o.reference_id
  JOIN public.products p ON p.id = sm.product_id
  WHERE o.sale_order_id = p_sale_order_id
    AND o.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO', 'Pronto');

  v_total_days := COALESCE(v_max_supplier_lead, 7)
                + COALESCE(v_buffer_material, 2)
                + COALESCE(v_corte, 2)
                + COALESCE(v_costura, 3)
                + COALESCE(v_montagem, 2)
                + COALESCE(v_acabamento, 1);

  RETURN CURRENT_DATE + v_total_days;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

CREATE VIEW public.sale_order_min_billing
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.delivery_deadline,
  so.manual_billing_override,
  so.original_min_billing_date,
  public.compute_min_billing_date(so.id) AS min_billing_date
FROM public.sale_orders so
WHERE so.status NOT IN ('Cancelado', 'cancelado', 'Faturado', 'faturado');

GRANT SELECT ON public.sale_order_min_billing TO authenticated, anon;