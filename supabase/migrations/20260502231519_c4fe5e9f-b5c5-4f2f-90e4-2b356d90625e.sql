-- 20260419120147_fix-sole-double-debit-and-grade-restore.sql
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
BEGIN
  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');
  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT key::integer INTO v_size
      FROM jsonb_each_text(p_order_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;
  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;
  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;
  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;
  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, p_order_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      CONTINUE;
    END IF;
    SELECT id, quantity, name INTO v_product
      FROM public.products WHERE id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
    END IF;
    v_required := (v_item ->> 'required')::numeric;
    IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
      RAISE EXCEPTION
        'Estoque insuficiente para % "%": disponível %, necessário %',
        v_item ->> 'component', v_product.name, v_product.quantity, v_required;
    END IF;
  END LOOP;
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';
    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft')
      ON CONFLICT DO NOTHING;
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;
    IF v_mode = 'hard' THEN
      UPDATE public.products
         SET quantity = quantity - v_required, updated_at = now()
       WHERE id = v_pid;
      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    END IF;
  END LOOP;
  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result);
END;
$$;
GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(
  p_order_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order RECORD;
  v_ref_id uuid;
  v_color text;
  v_grade jsonb;
  v_target_product_id uuid;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_total_restored numeric := 0;
BEGIN
  SELECT reference_id, color, grade
    INTO v_ref_id, v_color, v_grade
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND OR v_grade IS NULL OR jsonb_typeof(v_grade) <> 'object' THEN
    RETURN;
  END IF;
  SELECT tsc.sole_product_id INTO v_target_product_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = v_ref_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(v_color, '')))
   LIMIT 1;
  IF v_target_product_id IS NULL THEN
    SELECT p.id INTO v_target_product_id
      FROM public.products p
      JOIN public.technical_sheets ts ON ts.id = v_ref_id
     WHERE p.active = true
       AND (p.group_id = ts.sole_group_id OR ts.primary_sole_id = p.id)
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(p.color,''))) = UPPER(TRIM(COALESCE(v_color,'')))
            THEN 0 ELSE 1 END,
       p.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_target_product_id IS NULL THEN
    RETURN;
  END IF;
  SELECT stock_grade INTO v_stock_grade
    FROM public.products WHERE id = v_target_product_id;
  v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(v_grade)
     WHERE value::numeric > 0
  LOOP
    v_new_grade := jsonb_set(
      v_new_grade,
      ARRAY[v_size],
      to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty)
    );
    v_total_restored := v_total_restored + v_size_qty;
  END LOOP;
  IF v_total_restored > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade, updated_at = now()
     WHERE id = v_target_product_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid) TO authenticated;

-- 20260419130000_fix-production-wave-engine.sql
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week date;
  v_delivery date;
  v_lead_days int;
  v_target date;
BEGIN
  SELECT billing_week, delivery_deadline
    INTO v_billing_week, v_delivery
    FROM sale_orders
   WHERE id = p_sale_order_id;
  IF v_billing_week IS NOT NULL THEN
    RETURN v_billing_week - ((EXTRACT(ISODOW FROM v_billing_week)::int - 1));
  END IF;
  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0)
    INTO v_lead_days
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND COALESCE(ts.lead_time_corte_dias, 0)
       + COALESCE(ts.lead_time_costura_dias, 0)
       + COALESCE(ts.lead_time_montagem_dias, 0)
       + COALESCE(ts.lead_time_acabamento_dias, 0)
       + COALESCE(ts.lead_time_buffer_material_dias, 0) > 0
   ORDER BY 1 DESC
   LIMIT 1;
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias, 0)
         + COALESCE(lead_time_costura_dias, 0)
         + COALESCE(lead_time_montagem_dias, 0)
         + COALESCE(lead_time_acabamento_dias, 0)
         + COALESCE(lead_time_buffer_material_dias, 0)
      INTO v_lead_days
      FROM default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21;
  END IF;
  v_target := v_delivery - v_lead_days;
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.split_wave_to_finishing(p_wave_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;
  DELETE FROM production_finishing_packages WHERE wave_id = p_wave_id;
  INSERT INTO production_finishing_packages(
    wave_id, sale_order_id, store_name, reference_id, color, quantity, grade
  )
  WITH qty_agg AS (
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      SUM(src.quantity) AS quantity
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color
  ),
  grade_keys AS (
    SELECT
      wi.wave_id,
      src.sale_order_id,
      src.store_name,
      wi.reference_id,
      wi.color,
      g.k,
      SUM(g.v) AS size_qty
    FROM production_wave_items wi
    JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
    JOIN LATERAL (
      SELECT key AS k, (value::text)::numeric AS v
      FROM jsonb_each_text(src.grade)
      WHERE key ~ '^[0-9]+$'
    ) g ON TRUE
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color, g.k
  ),
  grade_agg AS (
    SELECT
      wave_id, sale_order_id, store_name, reference_id, color,
      jsonb_object_agg(k, size_qty) AS grade
    FROM grade_keys
    GROUP BY wave_id, sale_order_id, store_name, reference_id, color
  )
  SELECT
    q.wave_id,
    q.sale_order_id,
    q.store_name,
    q.reference_id,
    q.color,
    q.quantity,
    COALESCE(g.grade, '{}'::jsonb) AS grade
  FROM qty_agg q
  LEFT JOIN grade_agg g USING (wave_id, sale_order_id, store_name, reference_id, color);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.split_wave_to_finishing(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.v_sector_board AS
WITH stages AS (
  SELECT s.stage,
         w.id AS wave_id, w.code AS wave_code, w.week_start, w.week_end,
         s.status AS stage_status,
         s.progress_pct,
         s.started_at, s.finished_at,
         w.total_pairs,
         stage_order(s.stage) AS ord
  FROM production_wave_stages s
  JOIN production_waves w ON w.id = s.wave_id
  WHERE w.status IN ('running', 'planning')
)
SELECT stage, ord,
       (SELECT jsonb_build_object(
           'wave_id', wave_id, 'code', wave_code,
           'week_start', week_start, 'week_end', week_end,
           'progress_pct', progress_pct, 'total_pairs', total_pairs,
           'started_at', started_at
         )
         FROM stages s2
         WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
         LIMIT 1) AS active_wave,
       (SELECT jsonb_build_object(
           'wave_id', s3.wave_id, 'code', s3.wave_code, 'week_start', s3.week_start
         )
         FROM stages s3
         WHERE s3.stage = stages.stage
           AND s3.stage_status = 'pending'
           AND (
             s3.ord = 1
             OR EXISTS (
               SELECT 1
               FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status = 'completed'
             )
           )
         ORDER BY s3.week_start
         LIMIT 1) AS next_wave,
       (SELECT count(*)
         FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
FROM stages
GROUP BY stage, ord
ORDER BY ord;
GRANT SELECT ON public.v_sector_board TO authenticated;

ALTER TABLE public.production_wave_item_sources
  ADD CONSTRAINT uq_wave_item_sources
  UNIQUE (wave_item_id, sale_order_item_id);

-- 20260419140000_perf-restore-product-stocks.sql
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_prev_qty numeric;
  v_new_qty  numeric;
BEGIN
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    UPDATE products
    SET quantity = quantity + v_row.total_qty
    WHERE id = v_row.product_id
    RETURNING quantity - v_row.total_qty, quantity
    INTO v_prev_qty, v_new_qty;
    IF FOUND THEN
      INSERT INTO stock_movements(
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        v_row.product_id, 'in', v_row.total_qty,
        v_prev_qty, v_new_qty,
        'Estorno automático - Exclusão de OP',
        p_order_id
      );
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid) TO authenticated;

-- 20260420100000_erp-improvements (Financeiro e Indices)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounts_receivable' AND column_name='client_id') THEN
    ALTER TABLE public.accounts_receivable ADD COLUMN client_id uuid REFERENCES public.clients(id);
  END IF;
END $$;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS promised_date date,
  ADD COLUMN IF NOT EXISTS received_date date;
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_status       ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_due_date     ON public.orders(due_date);
CREATE INDEX IF NOT EXISTS idx_orders_sale_order   ON public.orders(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_ap_due_date         ON public.accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_ap_status           ON public.accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_ar_due_date         ON public.accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_ar_status           ON public.accounts_receivable(status);
CREATE INDEX IF NOT EXISTS idx_ar_client_id        ON public.accounts_receivable(client_id);
CREATE INDEX IF NOT EXISTS idx_stock_mvmt_product  ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_po_status           ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier_id      ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_promised_date    ON public.purchase_orders(promised_date);

CREATE OR REPLACE VIEW public.v_client_credit_exposure AS
SELECT
  c.id                                                      AS client_id,
  c.razao_social,
  c.nome_fantasia,
  c.credit_limit,
  COALESCE(SUM(ar.amount - COALESCE(ar.amount_received, 0))
    FILTER (WHERE ar.status NOT IN ('received', 'cancelled')), 0)   AS open_exposure,
  c.credit_limit - COALESCE(SUM(ar.amount - COALESCE(ar.amount_received, 0))
    FILTER (WHERE ar.status NOT IN ('received', 'cancelled')), 0)   AS available_credit,
  COUNT(ar.id) FILTER (WHERE ar.status NOT IN ('received', 'cancelled')) AS open_ar_count
FROM public.clients c
LEFT JOIN public.accounts_receivable ar ON ar.client_id = c.id
GROUP BY c.id, c.razao_social, c.nome_fantasia, c.credit_limit;

CREATE OR REPLACE VIEW public.v_late_orders AS
SELECT
  o.id,
  o.order_number,
  o.status,
  o.reference_id,
  o.color,
  o.quantity,
  o.due_date,
  o.sale_order_id,
  ts.name  AS reference_name,
  ts.code  AS reference_code,
  so.client_name,
  so.order_number AS sale_order_number,
  (CURRENT_DATE - o.due_date) AS days_late
FROM public.orders o
LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
LEFT JOIN public.sale_orders      so ON so.id = o.sale_order_id
WHERE o.status IN ('Reservado', 'Em Produção')
  AND o.due_date IS NOT NULL
  AND o.due_date < CURRENT_DATE;

CREATE OR REPLACE VIEW public.v_overdue_purchase_orders AS
SELECT
  po.id,
  po.order_number,
  po.supplier_name,
  po.supplier_id,
  po.total_value,
  po.promised_date,
  (CURRENT_DATE - po.promised_date) AS days_overdue,
  po.status
FROM public.purchase_orders po
WHERE po.status IN ('sent', 'approved')
  AND po.promised_date IS NOT NULL
  AND po.promised_date < CURRENT_DATE;

-- Price history
CREATE OR REPLACE VIEW public.v_supplier_price_history AS
SELECT
  ii.product_id,
  ii.product_code,
  ii.product_name,
  ii.unit_price,
  ii.quantity,
  ii.unit          AS unit,
  i.supplier_id,
  s.name           AS supplier_name,
  i.invoice_number,
  i.issue_date,
  i.id             AS invoice_id
FROM public.invoice_items ii
JOIN public.invoices      i  ON i.id  = ii.invoice_id
LEFT JOIN public.suppliers s ON s.id  = i.supplier_id
WHERE ii.product_id IS NOT NULL
  AND i.issue_date  IS NOT NULL
ORDER BY i.issue_date DESC;

CREATE OR REPLACE VIEW public.v_product_price_summary AS
SELECT
  product_id,
  product_name,
  supplier_id,
  supplier_name,
  COUNT(*)                                               AS purchase_count,
  MIN(unit_price)                                        AS min_price,
  MAX(unit_price)                                        AS max_price,
  AVG(unit_price)                                        AS avg_price,
  (ARRAY_AGG(unit_price ORDER BY issue_date DESC))[1]   AS latest_price,
  (ARRAY_AGG(unit_price ORDER BY issue_date DESC))[2]   AS previous_price,
  MAX(issue_date)                                        AS last_purchased
FROM public.v_supplier_price_history
GROUP BY product_id, product_name, supplier_id, supplier_name;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS avg_lead_time_days  numeric,
  ADD COLUMN IF NOT EXISTS on_time_rate        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_date  date;

CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date      ON public.invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id     ON public.invoices(supplier_id);