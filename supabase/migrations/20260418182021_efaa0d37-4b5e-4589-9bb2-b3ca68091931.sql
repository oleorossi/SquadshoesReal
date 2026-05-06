-- 1) Capacity columns on technical_sheets
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS cutting_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sewing_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assembly_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finishing_capacity_per_day integer DEFAULT 0;

COMMENT ON COLUMN public.technical_sheets.cutting_capacity_per_day IS 'Pares cortados por dia para esta referência (0 = usar lead time fixo)';
COMMENT ON COLUMN public.technical_sheets.sewing_capacity_per_day IS 'Pares costurados por dia para esta referência (0 = usar lead time fixo)';
COMMENT ON COLUMN public.technical_sheets.assembly_capacity_per_day IS 'Pares montados por dia para esta referência (0 = usar lead time fixo)';
COMMENT ON COLUMN public.technical_sheets.finishing_capacity_per_day IS 'Pares acabados por dia para esta referência (0 = usar lead time fixo)';

-- 2) Same on default_lead_times for category-level fallback
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS cutting_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sewing_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assembly_capacity_per_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finishing_capacity_per_day integer DEFAULT 0;

-- 3) Recreate view with dynamic lead times
DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;
CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT o.id AS order_id,
         o.order_number AS pedido_ref,
         o.sale_order_id,
         so.delivery_deadline AS data_entrega_cliente,
         o.quantity AS op_quantity,
         o.status AS order_status,
         o.reference_id,
         ts.name AS referencia_nome,
         ts.id AS sheet_id,
         ts.shoe_category AS sheet_category,
         -- DYNAMIC: if capacity > 0 use CEIL(qty/capacity), else fixed days
         CASE
           WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
             THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::integer)
           ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
         END AS lead_time_corte_dias,
         CASE
           WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
             THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::integer)
           ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
         END AS lead_time_costura_dias,
         CASE
           WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
             THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::integer)
           ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
         END AS lead_time_montagem_dias,
         CASE
           WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
             THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::integer)
           ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
         END AS lead_time_acabamento_dias,
         COALESCE(ts.lead_time_buffer_material_dias, dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
  FROM orders o
    JOIN sale_orders so ON so.id = o.sale_order_id
    JOIN technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE (o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text]))
    AND so.delivery_deadline IS NOT NULL
)
SELECT lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias AS data_inicio_producao,
  m.id AS material_id,
  m.name AS material,
  m.group_id AS material_group_id,
  pg.name AS grupo_material,
  m.unit AS unidade,
  m.quantity AS estoque_atual,
  m.min_stock,
  m.supplier_lead_time_days,
  m.supplier_id,
  sup.name AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric AS quantidade_necessaria,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias - COALESCE(m.supplier_lead_time_days, 7) AS data_limite_compra,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_acabamento_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_corte_dias,
  lt.lead_time_buffer_material_dias,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias AS data_chegada_material
FROM lt
  JOIN sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN products m ON m.id = sm.product_id
  LEFT JOIN product_groups pg ON pg.id = m.group_id
  LEFT JOIN suppliers sup ON sup.id = m.supplier_id;

-- 4) Trigger to auto-compute planned_start on orders based on delivery + dynamic lead times
DROP FUNCTION IF EXISTS public.compute_order_planned_dates() CASCADE;
CREATE OR REPLACE FUNCTION public.compute_order_planned_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery date;
  v_corte int; v_costura int; v_montagem int; v_acabamento int;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT so.delivery_deadline INTO v_delivery
  FROM sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;

  SELECT
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_acabamento
  FROM technical_sheets ts
    LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE ts.id = NEW.reference_id;

  IF v_corte IS NULL THEN RETURN NEW; END IF;

  NEW.planned_start := v_delivery - v_acabamento - v_montagem - v_costura - v_corte;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_order_planned_dates ON public.orders;
CREATE TRIGGER trg_compute_order_planned_dates
BEFORE INSERT OR UPDATE OF quantity, sale_order_id, reference_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.compute_order_planned_dates();

-- 5) Seed default_lead_times for common categories
INSERT INTO public.default_lead_times
  (shoe_category, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias,
   cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, notes)
VALUES
  ('Sandália', 2, 3, 2, 1, 2, 200, 150, 180, 250, 'Padrão sandálias'),
  ('Tamanco',  2, 2, 2, 1, 2, 200, 180, 180, 250, 'Padrão tamancos'),
  ('Sapato',   3, 4, 3, 2, 3, 150, 100, 120, 200, 'Padrão sapatos fechados'),
  ('Bota',     3, 5, 4, 2, 3, 120,  80, 100, 180, 'Padrão botas')
ON CONFLICT DO NOTHING;