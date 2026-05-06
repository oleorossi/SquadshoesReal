-- =========================================================================
-- PATCH 5 — MRP
-- =========================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS preferred_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

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
    WHERE so.status NOT IN ('Cancelado', 'Entregue', 'Finalizado', 'Faturado')
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

CREATE OR REPLACE VIEW public.v_mrp_needs
WITH (security_invoker = true) AS
WITH demand AS (SELECT * FROM public.fn_projected_demand()),
po_open AS (
  SELECT poi.product_id, SUM(poi.quantity) AS qty_in_pipeline
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE po.status NOT IN ('Cancelado', 'Recebido')
   GROUP BY poi.product_id
),
reserved AS (
  SELECT product_id, SUM(quantity_reserved - quantity_consumed) AS qty_reserved
    FROM public.material_reservations
   WHERE status IN ('reserved','partially_consumed')
   GROUP BY product_id
)
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  p.category,
  p.unit,
  p.unit_price,
  p.lead_time_days,
  p.preferred_supplier_id,
  s.name AS supplier_name,
  p.min_stock,
  p.quantity AS on_hand,
  COALESCE(r.qty_reserved, 0) AS reserved,
  GREATEST(p.quantity - COALESCE(r.qty_reserved, 0), 0) AS available_now,
  COALESCE(po.qty_in_pipeline, 0) AS qty_in_po,
  COALESCE(d.total_required, 0)   AS projected_demand,
  d.earliest_deadline,
  d.orders_count,
  GREATEST(
    COALESCE(d.total_required,0) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline,0),
    0
  ) AS suggested_qty,
  (d.earliest_deadline - (p.lead_time_days || ' days')::interval)::date AS order_by_date
FROM public.products p
LEFT JOIN demand   d  ON d.product_id  = p.id
LEFT JOIN po_open  po ON po.product_id = p.id
LEFT JOIN reserved r  ON r.product_id  = p.id
LEFT JOIN public.suppliers s ON s.id = p.preferred_supplier_id
WHERE COALESCE(d.total_required, 0) > 0
   OR p.quantity < p.min_stock;

CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(
  p_product_ids uuid[] DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_supplier uuid;
  v_po_id uuid;
  v_po_number text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'Rascunho'
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') ||
                     '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated)
      VALUES (
        v_po_number, 'Rascunho', v_supplier,
        COALESCE(v_row.supplier_name, ''),
        0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true
      ) RETURNING id INTO v_po_id;
    END IF;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (
      v_po_id, v_row.product_id,
      v_row.suggested_qty, COALESCE(v_row.unit_price,0), COALESCE(v_row.unit,''),
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (
         SELECT COALESCE(SUM(quantity * unit_price),0)
           FROM public.purchase_order_items
          WHERE purchase_order_id = v_po_id
       ),
       updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_purchase_orders_from_mrp(uuid[]) TO authenticated;

-- =========================================================================
-- PATCH 6 — QUALIDADE EM ONDAS
-- =========================================================================
ALTER TABLE public.quality_inspections
  ADD COLUMN IF NOT EXISTS wave_stage_id uuid
    REFERENCES public.production_wave_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS defect_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_qi_wave_stage
  ON public.quality_inspections(wave_stage_id)
  WHERE wave_stage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_wave_rework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid NOT NULL REFERENCES public.production_waves(id) ON DELETE CASCADE,
  origin_stage text NOT NULL,
  inspection_id uuid REFERENCES public.quality_inspections(id) ON DELETE SET NULL,
  product_ref uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  color text DEFAULT '',
  quantity numeric NOT NULL,
  reason text DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rework_wave ON public.production_wave_rework(wave_id, status);

ALTER TABLE public.production_wave_rework ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rework_rw ON public.production_wave_rework;
CREATE POLICY rework_rw ON public.production_wave_rework
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.register_defect_and_adjust_wave(
  p_wave_stage_id uuid,
  p_defect_qty numeric,
  p_reason text,
  p_product_ref uuid DEFAULT NULL,
  p_color text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage record;
  v_insp_id uuid;
  v_rework_id uuid;
BEGIN
  IF p_defect_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade de defeito deve ser > 0';
  END IF;

  SELECT id, wave_id, stage::text AS stage, produced_quantity
    INTO v_stage
    FROM public.production_wave_stages
   WHERE id = p_wave_stage_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa de onda % não encontrada', p_wave_stage_id;
  END IF;

  INSERT INTO public.quality_inspections
    (wave_stage_id, defect_quantity, rework_required, inspector_id, status, results)
  VALUES
    (p_wave_stage_id, p_defect_qty, true, auth.uid(), 'done',
     jsonb_build_object('reason', p_reason))
  RETURNING id INTO v_insp_id;

  UPDATE public.production_wave_stages
     SET produced_quantity = GREATEST(produced_quantity - p_defect_qty, 0),
         updated_at = now()
   WHERE id = p_wave_stage_id;

  INSERT INTO public.production_wave_rework
    (wave_id, origin_stage, inspection_id, product_ref, color, quantity, reason, created_by)
  VALUES
    (v_stage.wave_id, v_stage.stage, v_insp_id, p_product_ref, p_color,
     p_defect_qty, p_reason, auth.uid())
  RETURNING id INTO v_rework_id;

  RETURN jsonb_build_object(
    'inspection_id', v_insp_id,
    'rework_id', v_rework_id,
    'adjusted_produced',
      (SELECT produced_quantity FROM public.production_wave_stages WHERE id = p_wave_stage_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_defect_and_adjust_wave(uuid, numeric, text, uuid, text) TO authenticated;

CREATE OR REPLACE VIEW public.v_stage_quality
WITH (security_invoker = true) AS
SELECT
  pws.id AS wave_stage_id,
  pws.wave_id,
  pws.stage,
  pws.produced_quantity,
  COALESCE(SUM(qi.defect_quantity),0) AS total_defects,
  CASE
    WHEN pws.produced_quantity + COALESCE(SUM(qi.defect_quantity),0) = 0 THEN 0
    ELSE COALESCE(SUM(qi.defect_quantity),0) * 1.0
       / (pws.produced_quantity + COALESCE(SUM(qi.defect_quantity),0))
  END AS defect_rate,
  COUNT(qi.id) AS inspections_count
FROM public.production_wave_stages pws
LEFT JOIN public.quality_inspections qi ON qi.wave_stage_id = pws.id
GROUP BY pws.id, pws.wave_id, pws.stage, pws.produced_quantity;

-- =========================================================================
-- PATCH 7 — GUARDAS DE INTEGRIDADE
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_guard_delete_technical_sheet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE soi.reference_id = OLD.id
     AND so.status NOT IN ('Cancelado','Entregue','Finalizado','Faturado');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Ficha técnica "%" não pode ser excluída: % pedido(s) ativo(s) vinculado(s)',
      OLD.name, v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.production_wave_items pwi
    JOIN public.production_waves pw ON pw.id = pwi.wave_id
   WHERE pwi.reference_id = OLD.id
     AND pw.status::text NOT IN ('cancelled','finished');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Ficha técnica "%" não pode ser excluída: em % onda(s) de produção ativas',
      OLD.name, v_count;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_del_ts ON public.technical_sheets;
CREATE TRIGGER trg_guard_del_ts
BEFORE DELETE ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_delete_technical_sheet();

CREATE OR REPLACE FUNCTION public.fn_guard_delete_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.material_reservations
   WHERE product_id = OLD.id AND status IN ('reserved','partially_consumed');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Produto "%" não pode ser excluído: possui % reserva(s) ativa(s)',
      OLD.name, v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.sheet_materials WHERE product_id = OLD.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Produto "%" não pode ser excluído: usado em % ficha(s) técnica(s)',
      OLD.name, v_count;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_del_product ON public.products;
CREATE TRIGGER trg_guard_del_product
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_delete_product();

CREATE TABLE IF NOT EXISTS public.product_price_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  previous_price numeric NOT NULL,
  new_price numeric NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_log_product ON public.product_price_log(product_id, changed_at DESC);

ALTER TABLE public.product_price_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_log_ro ON public.product_price_log;
CREATE POLICY price_log_ro ON public.product_price_log
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS price_log_ins ON public.product_price_log;
CREATE POLICY price_log_ins ON public.product_price_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.fn_log_price_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    INSERT INTO public.product_price_log
      (product_id, previous_price, new_price, changed_by)
    VALUES
      (OLD.id, OLD.unit_price, NEW.unit_price, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_price ON public.products;
CREATE TRIGGER trg_log_price
AFTER UPDATE OF unit_price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_log_price_change();

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_qty_nonneg;
ALTER TABLE public.products
  ADD CONSTRAINT products_qty_nonneg CHECK (quantity >= 0);