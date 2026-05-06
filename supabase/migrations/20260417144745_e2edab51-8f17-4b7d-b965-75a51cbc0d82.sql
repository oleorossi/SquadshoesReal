
-- 1) Tabela de Lead Times padrão por Categoria de Modelo
CREATE TABLE IF NOT EXISTS public.default_lead_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shoe_category TEXT NOT NULL,
  lead_time_corte_dias INT NOT NULL DEFAULT 2,
  lead_time_costura_dias INT NOT NULL DEFAULT 3,
  lead_time_montagem_dias INT NOT NULL DEFAULT 2,
  lead_time_acabamento_dias INT NOT NULL DEFAULT 1,
  lead_time_buffer_material_dias INT NOT NULL DEFAULT 2,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT default_lead_times_category_unique UNIQUE (shoe_category)
);

CREATE INDEX IF NOT EXISTS idx_default_lead_times_category ON public.default_lead_times(shoe_category);

ALTER TABLE public.default_lead_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can view default lead times" ON public.default_lead_times;
CREATE POLICY "Approved users can view default lead times"
  ON public.default_lead_times FOR SELECT
  TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can manage default lead times" ON public.default_lead_times;
CREATE POLICY "Approved users can manage default lead times"
  ON public.default_lead_times FOR ALL
  TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP TRIGGER IF EXISTS update_default_lead_times_updated_at ON public.default_lead_times;
CREATE TRIGGER update_default_lead_times_updated_at
  BEFORE UPDATE ON public.default_lead_times
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Recriar a view com fallback hierárquico
DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;

CREATE VIEW public.purchase_projection_timeline
WITH (security_invoker = true)
AS
WITH lt AS (
  SELECT
    o.id AS order_id,
    o.order_number AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity AS op_quantity,
    o.status AS order_status,
    o.reference_id,
    ts.name AS referencia_nome,
    ts.id AS sheet_id,
    ts.shoe_category AS sheet_category,
    COALESCE(ts.lead_time_corte_dias,           dlt.lead_time_corte_dias,           2) AS lead_time_corte_dias,
    COALESCE(ts.lead_time_costura_dias,         dlt.lead_time_costura_dias,         3) AS lead_time_costura_dias,
    COALESCE(ts.lead_time_montagem_dias,        dlt.lead_time_montagem_dias,        2) AS lead_time_montagem_dias,
    COALESCE(ts.lead_time_acabamento_dias,      dlt.lead_time_acabamento_dias,      1) AS lead_time_acabamento_dias,
    COALESCE(ts.lead_time_buffer_material_dias, dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
  FROM public.orders o
  JOIN public.sale_orders so ON so.id = o.sale_order_id
  JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  (lt.data_entrega_cliente
     - lt.lead_time_acabamento_dias
     - lt.lead_time_montagem_dias
     - lt.lead_time_costura_dias
     - lt.lead_time_corte_dias) AS data_inicio_producao,
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
  (lt.data_entrega_cliente
     - lt.lead_time_acabamento_dias
     - lt.lead_time_montagem_dias
     - lt.lead_time_costura_dias
     - lt.lead_time_corte_dias
     - lt.lead_time_buffer_material_dias
     - COALESCE(m.supplier_lead_time_days, 7)) AS data_limite_compra,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_acabamento_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_corte_dias,
  lt.lead_time_buffer_material_dias,
  (lt.data_entrega_cliente - lt.lead_time_acabamento_dias) AS data_inicio_acabamento,
  (lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias) AS data_inicio_montagem,
  (lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias) AS data_inicio_costura,
  (lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias) AS data_inicio_corte,
  (lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias) AS data_chegada_material
FROM lt
JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
JOIN public.products m ON m.id = sm.product_id
LEFT JOIN public.product_groups pg ON pg.id = m.group_id
LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;
