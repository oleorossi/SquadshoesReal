-- ============ 1) TABELA DE CUSTOS ======================================
CREATE TABLE IF NOT EXISTS public.order_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid,
  reference_id uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  color text DEFAULT '',
  quantity numeric NOT NULL,
  material_cost numeric NOT NULL DEFAULT 0,
  labor_cost numeric NOT NULL DEFAULT 0,
  overhead_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  margin numeric NOT NULL DEFAULT 0,
  margin_pct numeric NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sale_order_id, sale_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_costs_order ON public.order_costs(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_order_costs_ref ON public.order_costs(reference_id);

ALTER TABLE public.order_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_costs_rw ON public.order_costs;
CREATE POLICY order_costs_rw ON public.order_costs
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============ 2) PARÂMETRO DE OVERHEAD =================================
CREATE TABLE IF NOT EXISTS public.cost_parameters (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cost_parameters (key, value, description)
VALUES ('overhead_pct', 0.15, 'Percentual de overhead sobre (material+MOD)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.cost_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_params_rw ON public.cost_parameters;
CREATE POLICY cost_params_rw ON public.cost_parameters
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============ 3) VÍNCULO FICHA × OPERAÇÕES (LABOR) =====================
CREATE TABLE IF NOT EXISTS public.technical_sheet_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  labor_cost_id uuid NOT NULL REFERENCES public.labor_costs(id) ON DELETE RESTRICT,
  minutes_per_unit numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, labor_cost_id)
);

CREATE INDEX IF NOT EXISTS idx_ts_ops_sheet ON public.technical_sheet_operations(sheet_id, sort_order);

ALTER TABLE public.technical_sheet_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ts_ops_rw ON public.technical_sheet_operations;
CREATE POLICY ts_ops_rw ON public.technical_sheet_operations
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============ 4) RPC calculate_order_cost ==============================
CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_ref uuid;
  v_color text;
  v_qty numeric;
  v_unit_price numeric;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric;
  v_margin numeric;
  v_margin_pct numeric;
  v_op record;
  v_prod record;
  v_out jsonb;
BEGIN
  SELECT value INTO v_overhead_pct FROM public.cost_parameters WHERE key = 'overhead_pct';
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  SELECT soi.id, soi.reference_id, soi.color, soi.quantity, soi.unit_price
    INTO v_item
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR soi.id = p_sale_order_item_id)
   ORDER BY soi.created_at
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do pedido não encontrado (order=%, item=%)',
      p_sale_order_id, p_sale_order_item_id;
  END IF;

  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := v_item.unit_price;

  -- Consumo (snapshot > cálculo vivo)
  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      INTO v_cons
      FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL) c;
  END IF;

  -- Custo de materiais
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name INTO v_prod
      FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_material := v_material + COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', (v_line ->> 'required')::numeric,
      'unit_price', COALESCE(v_prod.unit_price,0),
      'subtotal', COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric
    );
  END LOOP;

  -- Custo de MOD
  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty
    );
  END LOOP;

  v_overhead := v_overhead_pct * (v_material + v_labor);
  v_total := v_material + v_labor + v_overhead;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost', v_material,
    'labor_cost', v_labor,
    'overhead_cost', v_overhead,
    'total_cost', v_total,
    'revenue', v_revenue,
    'margin', v_margin,
    'margin_pct', v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_pct', v_overhead_pct
    )
  );

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      p_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown'
    )
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost    = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      total_cost    = EXCLUDED.total_cost,
      revenue       = EXCLUDED.revenue,
      margin        = EXCLUDED.margin,
      margin_pct    = EXCLUDED.margin_pct,
      breakdown     = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;

-- ============ 5) VIEW DE LUCRATIVIDADE ==================================
CREATE OR REPLACE VIEW public.v_order_profitability
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.order_number,
  so.client_name,
  so.status,
  SUM(oc.quantity)       AS total_units,
  SUM(oc.material_cost)  AS total_material,
  SUM(oc.labor_cost)     AS total_labor,
  SUM(oc.overhead_cost)  AS total_overhead,
  SUM(oc.total_cost)     AS total_cost,
  SUM(oc.revenue)        AS total_revenue,
  SUM(oc.margin)         AS total_margin,
  CASE WHEN SUM(oc.revenue) > 0
       THEN SUM(oc.margin) / SUM(oc.revenue)
       ELSE 0 END        AS margin_pct,
  MAX(oc.calculated_at)  AS last_calculated_at
FROM public.sale_orders so
LEFT JOIN public.order_costs oc ON oc.sale_order_id = so.id
GROUP BY so.id, so.order_number, so.client_name, so.status;