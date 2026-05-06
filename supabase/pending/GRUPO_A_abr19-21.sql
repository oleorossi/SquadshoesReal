-- GRUPO A: Correções de estoque e produção (abr/19-21)
-- Aplique este bloco completo de uma vez no SQL Editor do Supabase


-- ========== 20260419120147_fix-sole-double-debit-and-grade-restore.sql ==========
-- ============================================================
-- Fix: duplo débito do solado quando OP tem grade
--
-- Problema: quando hybrid_debit_stock_for_order é chamado com
-- p_order_grade != NULL, ele debita quantity do solado via a
-- lista de consumption (source='primary_sole'). Logo depois, o
-- frontend chama debit_sole_stock_by_grade que debita quantity
-- novamente — resultando em dois débitos do mesmo solado.
--
-- Solução: quando p_order_grade != NULL, o solado é registrado
-- como reserva (para rastreamento) mas NÃO gera UPDATE em
-- products.quantity. O debit_sole_stock_by_grade fica como
-- única fonte de verdade para o débito por numeração.
-- ============================================================

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
  -- When grade is present, debit_sole_stock_by_grade will handle sole stock
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

  -- Phase 1: lock + fail-fast
  -- Skip sole stock check here when grade is present (debit_sole_stock_by_grade validates per-size)
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_source := v_item ->> 'source';

    -- When grade handles sole debit, skip sole validation here
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

  -- Phase 2: actual debit
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

    -- Sole handled by debit_sole_stock_by_grade when grade is present:
    -- register reservation for traceability but skip the stock UPDATE
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

-- ============================================================
-- Fix: restaurar stock_grade do solado ao cancelar/excluir OP
--
-- Problema: useDeleteOrder (TypeScript) restaura quantity via
-- stock_movements, mas nunca restaura stock_grade por numeração.
-- Após excluir uma OP, o estoque por numeração fica defasado.
--
-- Solução: nova função restore_sole_grade_for_order que lê a
-- grade da OP excluída e devolve os pares por numeração.
-- ============================================================

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

  -- Resolve which sole product was debited (same logic as debit_sole_stock_by_grade)
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


-- ========== 20260419130000_fix-production-wave-engine.sql ==========
-- =============================================================================
-- FIX PRODUCTION WAVE ENGINE
-- Fixes 4 bugs identified in the wave system:
--   1. resolve_billing_week_for_order: wrong JOIN (ts.product_id → ts.id)
--   2. split_wave_to_finishing: grade jsonb_object_agg loses duplicate keys instead of summing
--   3. v_sector_board: next_wave shows all-pending waves for ALL sectors (should respect order)
--   4. production_wave_item_sources: missing UNIQUE constraint (ON CONFLICT DO NOTHING never fires)
-- =============================================================================

-- 1. Fix resolve_billing_week_for_order ---------------------------------------------------
-- sale_order_items.reference_id is a technical_sheets.id (FK confirmed).
-- Both previous versions had wrong JOINs:
--   v1 (20260419005623): ts.product_id = soi.reference_id  (field doesn't exist)
--   v2 (20260419005802): via products table + LOWER(ts.name) = LOWER(p.name)  (fragile name match)
-- Correct: JOIN technical_sheets ts ON ts.id = soi.reference_id

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

  -- 1) explicit billing_week wins — snap to monday
  IF v_billing_week IS NOT NULL THEN
    RETURN v_billing_week - ((EXTRACT(ISODOW FROM v_billing_week)::int - 1));
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) lead time from the technical sheet directly referenced by the item
  --    (sale_order_items.reference_id IS a technical_sheets.id)
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

  -- 3) fallback to default_lead_times table
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
  -- snap to monday
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;


-- 2. Fix split_wave_to_finishing grade aggregation ----------------------------------------
-- Problem: jsonb_object_agg(k, v) keeps only one value per key (last-wins).
--          When two source rows both have size "38", one value is silently dropped.
--          Additionally, the LATERAL join multiplied src.quantity by the number of grade keys.
-- Fix: separate quantity aggregation (no LATERAL) from grade aggregation (with SUM per key).

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
    -- Sum total quantity per (wave, order, reference, color) WITHOUT grade expansion
    -- to avoid multiplication by number of grade keys
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
    -- Expand grade JSONB and SUM per size key (so duplicates across multiple sources are summed)
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
    -- Re-assemble summed keys into JSONB
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


-- 3. Fix v_sector_board next_wave ---------------------------------------------------------
-- Problem: A newly created wave (all 5 stages = 'pending') shows up as next_wave for ALL
--          5 sector columns simultaneously. A sector should only queue a wave as its
--          "next" if that wave's *previous* stage is already completed (or it's the first
--          sector, corte).
-- Fix: add existence check on the previous stage being 'completed' for that specific wave.

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
       -- next_wave: only queue a pending wave if it's ready for this sector
       -- (first sector has no prerequisite; others need the previous stage completed)
       (SELECT jsonb_build_object(
           'wave_id', s3.wave_id, 'code', s3.wave_code, 'week_start', s3.week_start
         )
         FROM stages s3
         WHERE s3.stage = stages.stage
           AND s3.stage_status = 'pending'
           AND (
             s3.ord = 1  -- corte: no predecessor required
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


-- 4. Add UNIQUE constraint to production_wave_item_sources --------------------------------
-- Problem: ON CONFLICT DO NOTHING in auto_assign_sale_order_to_wave never triggers because
--          there is no UNIQUE constraint on (wave_item_id, sale_order_item_id).
--          Without it, re-running assignment creates duplicate source rows.

-- First remove any duplicate rows (keep lowest id per pair)
DELETE FROM public.production_wave_item_sources a
USING public.production_wave_item_sources b
WHERE a.id > b.id
  AND a.wave_item_id = b.wave_item_id
  AND a.sale_order_item_id = b.sale_order_item_id;

-- Add constraint safely (no-op if it already exists)
DO $safe_constraint$
BEGIN
  ALTER TABLE public.production_wave_item_sources
    ADD CONSTRAINT uq_wave_item_sources
    UNIQUE (wave_item_id, sale_order_item_id);
EXCEPTION WHEN duplicate_table THEN
  NULL; -- constraint already exists, skip
END
$safe_constraint$;


-- ========== 20260419140000_perf-restore-product-stocks.sql ==========
-- =============================================================================
-- PERFORMANCE: batch stock restore for order deletion
-- Replaces N read+write round-trips in useOrders.ts with a single RPC call.
-- =============================================================================

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
  -- Aggregate all 'out' movements for this order per product
  FOR v_row IN
    SELECT product_id, SUM(quantity) AS total_qty
    FROM stock_movements
    WHERE order_id = p_order_id
      AND movement_type = 'out'
    GROUP BY product_id
  LOOP
    -- Increment stock and capture before/after values atomically
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


-- ========== 20260420100000_erp-improvements.sql ==========
-- ERP Improvements: promised_date on purchase_orders, credit_limit on clients,
-- performance indexes, and analytical views.

-- ─── purchase_orders: supplier delivery tracking ─────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS promised_date date,
  ADD COLUMN IF NOT EXISTS received_date date;

-- ─── clients: credit limit ───────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0;

-- ─── Performance indexes ──────────────────────────────────────────────────────
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

-- ─── View: client credit exposure ────────────────────────────────────────────
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

-- RLS: same as clients (authenticated read)
DROP POLICY IF EXISTS "Auth users can view v_client_credit_exposure" ON public.v_client_credit_exposure;

-- ─── View: late production orders ────────────────────────────────────────────
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

-- ─── View: purchase orders overdue (sent but promised_date passed) ────────────
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


-- ========== 20260420110000_supplier-price-history.sql ==========
-- Price history view: tracks unit_price per product across all received invoices.
-- Joins invoice_items → invoices → suppliers to provide trend data.

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

-- Aggregate view: latest price and trend per product per supplier
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

-- Suppliers: add avg_lead_time_days for performance tracking
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS avg_lead_time_days  numeric,
  ADD COLUMN IF NOT EXISTS on_time_rate        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_date  date;

-- Index to make price history fast
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date      ON public.invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id     ON public.invoices(supplier_id);


-- ========== 20260421090000_fix-strap-color-fallback.sql ==========
-- Fix debit_strap_stock: remove silent wrong-color fallback.
-- Previously, if exact color was missing, the function debited any product in the group.
-- Now: only fall back when the found product has no specific color (generic/multi-color stock).
-- If the fallback product has a DIFFERENT specific color, raise a clear exception.

CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL::uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_product_color text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    -- Calculate consumption: prefer per-size with grade, fallback to flat
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100; -- cm → metros
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- 1. Try exact color match
    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(p.color)) = lower(trim(v_color))
    LIMIT 1;

    -- 2. If not found, look for a generic (no-color) product in the same group
    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;

    -- 3. If still not found, check if only a wrong-color product exists — raise clear error
    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
        FROM public.products p
        WHERE p.active = true AND p.group_id = v_group_id
        LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION
            'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION
            'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %.4f, necessário %.4f metros.',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (
      v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;


-- ========== 20260421100000_add-minimum-overtime-to-work-schedules.sql ==========
ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN work_schedules.minimum_overtime_minutes IS
  'Minimum weekly overtime minutes required before overtime is counted. Below this threshold the excess is ignored (not paid, not accumulated).';


-- ========== 20260421120000_artisanal-recipes.sql ==========
-- ── Artisanal Recipes ─────────────────────────────────────────────────────────
-- Links an artisanal output material (e.g. "Tira Overlock 5mm") to a base raw
-- material (e.g. "Napa Soft") with a yield ratio (output meters per 1 m of base)
-- and a labor cost per meter of output. Default contractor is pre-selected when
-- creating a service order from this recipe.

CREATE TABLE IF NOT EXISTS artisanal_recipes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  artisanal_product_name TEXT NOT NULL,   -- output material type (matches product group or base name)
  base_product_name      TEXT NOT NULL,   -- raw material type sent to contractor
  yield_per_meter        NUMERIC NOT NULL DEFAULT 1 CHECK (yield_per_meter > 0),
  labor_cost_per_meter   NUMERIC NOT NULL DEFAULT 0,
  default_contractor_id  UUID REFERENCES contractors(id) ON DELETE SET NULL,
  notes                  TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Flag products that are produced artisanally (used for stock/alert display)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_artisanal BOOLEAN NOT NULL DEFAULT false;

-- Extend service_orders with artisanal production tracking columns
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS artisanal_recipe_id        UUID REFERENCES artisanal_recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisanal_output_name      TEXT,          -- product type being produced
  ADD COLUMN IF NOT EXISTS artisanal_output_color     TEXT,          -- color of output material
  ADD COLUMN IF NOT EXISTS artisanal_output_meters    NUMERIC DEFAULT 0, -- total meters to be produced
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0, -- portion for linked order
  ADD COLUMN IF NOT EXISTS artisanal_for_stock_meters NUMERIC DEFAULT 0, -- portion to restore min stock
  ADD COLUMN IF NOT EXISTS artisanal_base_color       TEXT,          -- color of base material sent
  ADD COLUMN IF NOT EXISTS artisanal_stock_entry_done BOOLEAN DEFAULT false; -- prevents double entry

-- Auto-update updated_at on artisanal_recipes
CREATE OR REPLACE FUNCTION artisanal_recipes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS artisanal_recipes_updated_at ON artisanal_recipes;
CREATE TRIGGER artisanal_recipes_updated_at
  BEFORE UPDATE ON artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION artisanal_recipes_set_updated_at();

