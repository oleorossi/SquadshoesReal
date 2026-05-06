-- 1) 20260504120000 — calculate_order_cost com packaging + grade
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
      v_cons := public.calculate_order_consumption_by_grade(v_ref, COALESCE(v_color, ''), v_grade);
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

-- 2) 20260504130000 — debit_packaging_for_order_atomic (RPC)
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

-- 3) 20260504140000 — clients.endereco_manual_override + trigger
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS endereco_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS endereco_updated_at timestamptz;

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

-- 4) 20260504150000 — fn_projected_demand status case-insensitive
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
           (SELECT key::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE LOWER(COALESCE(so.status, '')) NOT IN (
            'cancelado', 'cancelada', 'cancelled',
            'entregue', 'delivered',
            'finalizado', 'finalizada', 'finished', 'completed',
            'faturado', 'faturada', 'invoiced'
          )
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      sale_order_id,
      delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')      AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    SUM(e.required)     AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_projected_demand() TO authenticated;

-- 5) 20260504160000 — sale_orders.total trigger + backfill
CREATE OR REPLACE FUNCTION public.recalc_sale_order_total(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0)), 0)
    INTO v_total
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;

  v_total := round(v_total::numeric, 2);

  UPDATE public.sale_orders
     SET total = v_total,
         updated_at = now()
   WHERE id = p_sale_order_id
     AND COALESCE(total, 0) IS DISTINCT FROM v_total;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_sale_order_total(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_sync_sale_order_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.sale_order_id;
    PERFORM public.recalc_sale_order_total(v_target_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.recalc_sale_order_total(OLD.sale_order_id);
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_sale_order_total();

DO $$
DECLARE
  v_fixed integer := 0;
  v_so_id uuid;
BEGIN
  FOR v_so_id IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     GROUP BY so.id, so.total
    HAVING ABS(COALESCE(so.total, 0) - COALESCE(SUM(COALESCE(soi.quantity, 0) * COALESCE(soi.unit_price, 0)), 0)) > 0.01
  LOOP
    PERFORM public.recalc_sale_order_total(v_so_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % pedidos tiveram total reajustado.', v_fixed;
END;
$$;

-- 6) 20260504180000 — resync_queue + RPC atômica + triggers
CREATE TABLE IF NOT EXISTS public.resync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  artisanal_order_id uuid,
  reason text NOT NULL,
  triggered_by text NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_result jsonb,
  CHECK (order_id IS NOT NULL OR artisanal_order_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_resync_queue_pending
  ON public.resync_queue (enqueued_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.resync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resync_queue_select ON public.resync_queue;
CREATE POLICY resync_queue_select ON public.resync_queue
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_insert ON public.resync_queue;
CREATE POLICY resync_queue_insert ON public.resync_queue
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_update ON public.resync_queue;
CREATE POLICY resync_queue_update ON public.resync_queue
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

ALTER TABLE public.production_consumptions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
CREATE TRIGGER trg_resync_for_sole_conjugation
  AFTER INSERT OR UPDATE OR DELETE ON public.sole_size_conjugations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_sole_conjugation();

CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte','Forração','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'resynced_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_op_atomic(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_resync_queue(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_result jsonb;
BEGIN
  FOR v_row IN
    SELECT id, order_id, artisanal_order_id, reason
      FROM public.resync_queue
     WHERE processed_at IS NULL
       AND order_id IS NOT NULL
     ORDER BY enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.resync_op_atomic(v_row.order_id);
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = v_result
       WHERE id = v_row.id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = jsonb_build_object('error', SQLERRM)
       WHERE id = v_row.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_resync_queue(integer) TO authenticated;

-- 7) 20260504170000 — backfill order_costs (depende de #1)
DO $$
DECLARE
  v_oc record;
  v_processed integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR v_oc IN
    SELECT oc.sale_order_id, oc.sale_order_item_id, so.status
      FROM public.order_costs oc
      JOIN public.sale_orders so ON so.id = oc.sale_order_id
     ORDER BY oc.calculated_at NULLS FIRST
  LOOP
    IF LOWER(COALESCE(v_oc.status, '')) IN (
         'cancelado', 'cancelada', 'cancelled',
         'entregue', 'delivered',
         'finalizado', 'finalizada', 'finished', 'completed',
         'faturado', 'faturada', 'invoiced'
       ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.calculate_order_cost(
        v_oc.sale_order_id,
        v_oc.sale_order_item_id,
        true
      );
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'Falhou ao recalcular order_cost para (%, %): %',
        v_oc.sale_order_id, v_oc.sale_order_item_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill order_costs: % recalculados, % pulados (finalizados/cancelados), % falharam.',
    v_processed, v_skipped, v_failed;
END;
$$;