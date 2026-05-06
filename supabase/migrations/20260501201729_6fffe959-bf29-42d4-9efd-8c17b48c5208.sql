-- ---------------------------------------------------------------
-- 20260504120000_fix-order-cost-packaging-and-grade.sql
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.calculate_order_cost(p_sale_order_id uuid, p_sale_order_item_id uuid, p_persist boolean) CASCADE;
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
  v_grade jsonb;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0;
  v_packaging numeric := 0;
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

  SELECT COALESCE(packaging_cost_per_pair, 0)
    INTO v_packaging_per_pair
    FROM public.cost_policies
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  SELECT soi.id, soi.reference_id, soi.color, soi.quantity, soi.unit_price, soi.grade
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
  v_grade := v_item.grade;

  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(v_ref, v_grade, COALESCE(v_color, ''));
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL) c;
    END IF;
  END IF;

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
  v_packaging := v_packaging_per_pair * v_qty;
  v_total := v_material + v_labor + v_overhead + v_packaging;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost', v_material,
    'labor_cost', v_labor,
    'overhead_cost', v_overhead,
    'packaging_cost', v_packaging,
    'total_cost', v_total,
    'revenue', v_revenue,
    'margin', v_margin,
    'margin_pct', v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_pct', v_overhead_pct,
      'packaging_per_pair', v_packaging_per_pair,
      'used_grade', v_grade IS NOT NULL AND v_grade <> '{}'::jsonb
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

-- ---------------------------------------------------------------
-- 20260504130000_atomic-packaging-debit-rpc.sql
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic(p_order_id uuid, p_packaging_product_id uuid, p_quantity numeric, p_packaging_type text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order_atomic(
  p_order_id uuid,
  p_packaging_product_id uuid,
  p_quantity numeric,
  p_packaging_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_stock numeric;
  v_new_stock  numeric;
  v_movement_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de embalagem inválida (%)', p_quantity;
  END IF;
  IF p_packaging_product_id IS NULL THEN
    RAISE EXCEPTION 'packaging_product_id é obrigatório';
  END IF;

  SELECT quantity
    INTO v_prev_stock
    FROM public.products
   WHERE id = p_packaging_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto de embalagem não encontrado (%)', p_packaging_product_id;
  END IF;

  v_new_stock := v_prev_stock - p_quantity;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente: disponível % unidade(s), tentado debitar %',
      v_prev_stock, p_quantity;
  END IF;

  UPDATE public.products
     SET quantity = v_new_stock,
         updated_at = now()
   WHERE id = p_packaging_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    p_packaging_product_id,
    'out',
    p_quantity,
    v_prev_stock,
    v_new_stock,
    COALESCE('Embalagem OP - ' || p_packaging_type, 'Embalagem OP'),
    p_order_id
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'product_id', p_packaging_product_id,
    'movement_id', v_movement_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_new_stock,
    'debited', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------
-- 20260504140000_clients-address-manual-override-tracking.sql
-- ---------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS endereco_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS endereco_updated_at timestamptz;

DROP FUNCTION IF EXISTS public.fn_track_client_address_manual_edit() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_track_client_address_manual_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.endereco IS DISTINCT FROM OLD.endereco
      OR NEW.bairro IS DISTINCT FROM OLD.bairro
      OR NEW.cidade IS DISTINCT FROM OLD.cidade
      OR NEW.estado IS DISTINCT FROM OLD.estado
      OR NEW.cep    IS DISTINCT FROM OLD.cep)
     AND (NEW.endereco_updated_at IS NULL
          OR NEW.endereco_updated_at = OLD.endereco_updated_at) THEN
    NEW.endereco_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_client_address_manual_edit ON public.clients;
CREATE TRIGGER trg_track_client_address_manual_edit
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_track_client_address_manual_edit();

UPDATE public.clients
   SET endereco_updated_at = COALESCE(endereco_updated_at, updated_at, created_at, now())
 WHERE endereco IS NOT NULL
   AND endereco_updated_at IS NULL;

-- ---------------------------------------------------------------
-- 20260504150000_normalize-mrp-status-filter.sql
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fn_projected_demand() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_required numeric,
  earliest_deadline date,
  orders_count integer,
  order_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         FROM public.calculate_order_consumption(
           soi.reference_id, soi.quantity, COALESCE(soi.color,''),
           (SELECT (key)::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY (value)::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status IN ('Aprovado', 'Em Produção')
  ),
  flattened AS (
    SELECT
      (item ->> 'product_id')::uuid AS pid,
      delivery_deadline,
      (item ->> 'required')::numeric AS required,
      sale_order_id
    FROM items_with_cons, jsonb_array_elements(cons) AS item
  )
  SELECT
    pid,
    p.name,
    SUM(required),
    MIN(delivery_deadline),
    COUNT(DISTINCT sale_order_id)::integer,
    ARRAY_AGG(DISTINCT sale_order_id)
  FROM flattened f
  JOIN public.products p ON p.id = f.pid
  GROUP BY pid, p.name;
END;
$$;