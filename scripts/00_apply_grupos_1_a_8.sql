-- =================================================================
-- 00_apply_all_pending_migrations.sql
-- Grupos 1 a 11 do CLAUDE.md — todas as migrations manuais pendentes
-- IDEMPOTENTE: seguro re-executar se alguma já foi aplicada.
-- Tempo estimado: 10-30 min (backfills em DO blocks)
-- Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new
-- =================================================================


-- ---------------------------------------------------------------
-- 20260419120147_fix-sole-double-debit-and-grade-restore.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260419130000_fix-production-wave-engine.sql
-- ---------------------------------------------------------------
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

ALTER TABLE public.production_wave_item_sources
  ADD CONSTRAINT uq_wave_item_sources
  UNIQUE (wave_item_id, sale_order_item_id);


-- ---------------------------------------------------------------
-- 20260419140000_perf-restore-product-stocks.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260420100000_erp-improvements.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260420110000_supplier-price-history.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260421090000_fix-strap-color-fallback.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260421100000_add-minimum-overtime-to-work-schedules.sql
-- ---------------------------------------------------------------
ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN work_schedules.minimum_overtime_minutes IS
  'Minimum weekly overtime minutes required before overtime is counted. Below this threshold the excess is ignored (not paid, not accumulated).';


-- ---------------------------------------------------------------
-- 20260421120000_artisanal-recipes.sql
-- ---------------------------------------------------------------
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


-- ---------------------------------------------------------------
-- 20260424120000_consumption-per-size-single-source.sql
-- ---------------------------------------------------------------
-- ============================================================
-- Single source of truth: consumption_per_size in sheet_materials
--
-- Before this migration, hybrid_debit_stock_for_order used
--   required = quantity_per_unit × total_pairs
-- ignoring the per-size consumption defined in the ficha técnica.
--
-- After this migration:
--   1. A helper function calc_required_for_grade() computes the
--      correct requirement using grade × consumption_per_size,
--      falling back to quantity_per_unit × total when data is absent.
--   2. check_stock_availability is updated to use sheet_materials
--      + consumption_per_size (instead of reference_materials) so the
--      pre-approval check matches what hybrid_debit_stock_for_order debits.
--
-- NOTE: hybrid_debit_stock_for_order is NOT replaced here because the
-- live version (20260419120147) uses freeze_technical_sheet and snapshots
-- which already handle per-size consumption via _calc_required_per_size.
-- ============================================================

-- ── 1. Helper: compute required quantity respecting per-size consumption ──────

CREATE OR REPLACE FUNCTION public.calc_required_for_grade(
  p_consumption_per_size jsonb,    -- { "36": 0.42, "37": 0.44, ... }  (material unit per pair per size)
  p_order_grade          jsonb,    -- { "36": 50,   "37": 100, ... }   (pairs per size)
  p_quantity_per_unit    numeric,  -- fallback: average consumption per pair
  p_total_quantity       numeric   -- fallback: total pairs
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  numeric := 0;
  v_size   text;
  v_pairs  numeric;
  v_cons   numeric;
BEGIN
  -- Use per-size path only when BOTH grade and consumption_per_size are non-empty
  IF p_consumption_per_size IS NOT NULL
     AND p_order_grade IS NOT NULL
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_consumption_per_size)) > 0
     AND (SELECT COUNT(*) FROM jsonb_object_keys(p_order_grade)) > 0
  THEN
    FOR v_size, v_pairs IN
      SELECT key, value::text::numeric FROM jsonb_each_text(p_order_grade)
    LOOP
      IF v_pairs IS NULL OR v_pairs <= 0 THEN CONTINUE; END IF;
      -- Use per-size consumption; fall back to quantity_per_unit if size not mapped
      v_cons := COALESCE(
        NULLIF((p_consumption_per_size ->> v_size)::numeric, 0),
        p_quantity_per_unit
      );
      v_total := v_total + (v_pairs * v_cons);
    END LOOP;

    IF v_total > 0 THEN
      RETURN v_total;
    END IF;
  END IF;

  -- Fallback: flat rate
  RETURN COALESCE(p_quantity_per_unit, 0) * COALESCE(p_total_quantity, 0);
END;
$$;

-- ── 2. Update check_stock_availability to use sheet_materials + per-size ──────
-- Replaces the old reference_materials-based check so the pre-approval
-- validation matches what hybrid_debit_stock_for_order actually debits.

CREATE OR REPLACE FUNCTION public.check_stock_availability(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT '',
  p_order_grade jsonb DEFAULT NULL   -- { "36": 50, "37": 100, ... }
)
RETURNS TABLE(
  product_id   uuid,
  product_name text,
  required     numeric,
  available    numeric,
  sufficient   boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mat RECORD;
  v_required numeric;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
BEGIN
  -- Check sheet_materials (ficha técnica BOM) using per-size consumption
  FOR mat IN
    SELECT sm.product_id,
           sm.quantity_per_unit,
           sm.consumption_per_size,
           p.quantity  AS current_stock,
           p.name,
           p.group_id,
           p.color     AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    v_required := public.calc_required_for_grade(
      mat.consumption_per_size,
      p_order_grade,
      mat.quantity_per_unit,
      p_order_quantity
    );

    v_target_id   := mat.product_id;
    v_target_name := mat.name;
    v_target_qty  := mat.current_stock;

    -- Resolve color variant
    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND (  (mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
            OR (mat.group_id IS NULL      AND p.name    = mat.name    ))
      LIMIT 1;

      IF v_target_id IS NULL THEN
        v_target_id   := mat.product_id;
        v_target_name := mat.name;
        v_target_qty  := mat.current_stock;
      END IF;
    END IF;

    product_id   := v_target_id;
    product_name := v_target_name;
    required     := v_required;
    available    := v_target_qty;
    sufficient   := (v_target_qty >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.calc_required_for_grade(jsonb, jsonb, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb) TO authenticated;


-- ---------------------------------------------------------------
-- 20260424140000_fix-production-sector-flow.sql
-- ---------------------------------------------------------------
-- ============================================================
-- Fix finalize_production_sector:
--
-- Problems found in the previous version:
-- 1. Hardcoded sector flow (Corte→Aviamento→Solagem→Acabamento) meant
--    any OP with additional sectors (e.g. Costura, Montagem) defined in
--    the ficha técnica would get stuck when finalized.
-- 2. Intermediate status was set to 'EM_SETOR' (e.g. 'EM_AVIAMENTO')
--    breaking all queries that filter on status = 'Em Produção'.
-- 3. actual_time_minutes was already being computed correctly from
--    started_at, but only populated when the trigger set started_at.
--
-- Fixes:
-- 1. Next sector is determined dynamically from order_stages (stage_order).
-- 2. status stays 'Em Produção' throughout production; 'Pronto' on completion.
-- 3. No change to actual_time_minutes logic (already correct).
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_sector TEXT;
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_actual_minutes NUMERIC;
  v_current_stage_order INTEGER;
BEGIN
  -- Get started_at for duration calculation
  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  -- Mark current stage as completed
  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  -- Find next pending sector dynamically via stage_order
  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    -- Advance production_step; keep status = 'Em Produção'.
    -- The trigger sync_order_stages_with_kanban will set started_at on the next stage.
    UPDATE public.orders
    SET
      status = 'Em Produção',
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', 'Em Produção',
      'actual_time_minutes', v_actual_minutes
    );
  ELSE
    -- All sectors done: mark OP as Pronto
    UPDATE public.orders
    SET
      status = 'Pronto',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      status = 'Pronto',
      current_sector = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'Pronto',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Also fix any existing orders that ended up with stale 'EM_*' status values.
-- Restore them to 'Em Produção' so they show up in standard production queries.
UPDATE public.orders
SET status = 'Em Produção', updated_at = NOW()
WHERE status LIKE 'EM_%'
  AND production_step IS NOT NULL
  AND production_step NOT IN ('Pronto', 'Pendente', 'Finalizado');


-- ---------------------------------------------------------------
-- 20260424180000_fix-packaging-debit-stock-movements.sql
-- ---------------------------------------------------------------
-- ============================================================
-- Fix debit_packaging_for_order: insert stock_movements when
-- debiting box_types so that:
--   1. There is a full audit trail for packaging consumption.
--   2. restore_product_stocks_for_order can reverse the debit
--      when an OP is cancelled (it reads from stock_movements).
-- ============================================================

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg          RECORD;
  boxes_needed integer;
  v_result     jsonb := '[]'::jsonb;
  v_types_to_debit text[];
BEGIN
  -- Determine which packaging types to debit based on mode
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome   AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE pc.sheet_id      = p_reference_id
      AND pc.active        = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Primary path: debit box_types (centralised packaging stock)
    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.box_type_id;

      -- Audit trail so restore_product_stocks_for_order can reverse this debit
      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        cfg.box_stock, cfg.box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    -- Legacy path: debit from products table (direct product link)
    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        cfg.current_stock, cfg.current_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      -- No stock linked — log but do not raise (packaging config may be optional)
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;


-- ---------------------------------------------------------------
-- 20260425155923_fa87b65c-113c-42ed-bb26-a8eb7d4be2b6.sql
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id UUID,
    p_expected_previous_qty NUMERIC,
    p_new_qty NUMERIC,
    p_delta NUMERIC,
    p_reason TEXT,
    p_new_grade JSONB DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    current_db_qty NUMERIC,
    error_message TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_qty NUMERIC;
    v_movement_type TEXT;
    v_actual_delta NUMERIC;
BEGIN
    -- Bloqueia a linha do produto para atualização concorrente
    SELECT quantity INTO v_actual_qty
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;

    -- Validação de concorrência: o saldo esperado pelo cliente deve ser igual ao do banco
    IF v_actual_qty != p_expected_previous_qty THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;

    -- Calcula o delta real baseado no que está no banco agora
    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    -- Atualiza o produto
    UPDATE public.products
    SET 
        quantity = p_new_qty,
        current_stock = p_new_qty,
        stock_grade = COALESCE(p_new_grade, stock_grade),
        updated_at = NOW()
    WHERE id = p_product_id;

    -- Registra a movimentação
    INSERT INTO public.stock_movements (
        product_id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        description
    ) VALUES (
        p_product_id,
        v_movement_type,
        ABS(v_actual_delta),
        v_actual_qty,
        p_new_qty,
        p_reason
    );

    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$$;

-- ---------------------------------------------------------------
-- 20260426120000_consumption-per-size-as-primary-source.sql
-- ---------------------------------------------------------------
-- Make technical_sheets.*_consumption_per_size the primary source for all consumption calculations.
-- Priority: sheet per-size → sole_technical_specs (if sole_drives_consumption) → scalar fallback.

CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_size integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_spec RECORD;
  v_result jsonb := '[]'::jsonb;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_resolved RECORD;
  v_group_name text;
  v_effective_size integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption numeric;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_conv RECORD;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- 1. Read per-size consumption from the sheet (primary source)
  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  -- 2. Fallback: sole_technical_specs (when sole_drives_consumption and sheet has no per-size)
  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;
    IF FOUND THEN
      IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
      IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
      IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
    END IF;
  END IF;

  -- 3. Final fallback: scalar average from sheet
  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado',
      'product_id', v_sole_product_id,
      'product_name', v_row.name,
      'color', v_sole_color,
      'consumption_per_unit', 1,
      'required', v_required,
      'available', v_row.quantity,
      'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard',
      'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha',
        'product_id', v_resolved.product_id,
        'product_name', v_resolved.product_name,
        'color', p_color,
        'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required,
        'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft',
        'source', 'sheet_per_size',
        'matched_by', v_resolved.matched_by,
        'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Direct Components from technical_sheets.direct_components (JSONB array)
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * p_order_quantity;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM legacy
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color, p.group_id
    FROM sheet_materials sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft'
      END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

-- Grade-based version: reads technical_sheets.*_consumption_per_size per size (primary),
-- falls back to sole_technical_specs, then to sheet scalar.
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade jsonb,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet RECORD;
  v_sole_product_id uuid;
  v_sole_color text;
  v_total_qty numeric := 0;
  v_size integer;
  v_pairs numeric;
  v_spec RECORD;
  v_upper numeric;
  v_lining numeric;
  v_insole numeric;
  v_resolved RECORD;
  v_row RECORD;
  v_item jsonb;
  v_pid uuid;
  v_consumption numeric;
  v_required numeric;
  v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_acc_upper jsonb := '{}'::jsonb;
  v_acc_lining jsonb := '{}'::jsonb;
  v_acc_insole jsonb := '{}'::jsonb;
  v_acc_std jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_upper_pid uuid;
  v_lining_pid uuid;
  v_insole_pid uuid;
  v_std_item RECORD;
  v_key text;
  v_acc_required numeric;
  v_acc_avail numeric;
  v_acc_name text;
  v_conv RECORD;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade inválida (precisa ser JSON object {size: pairs})';
  END IF;

  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade)
  WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Grade vazia (sem pares)';
  END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_upper_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- 1. Per-size from ficha técnica (primary source)
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

    -- 2. Fallback: sole_technical_specs for any missing value
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL)
       AND v_sheet.sole_drives_consumption AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
      END IF;
    END IF;

    -- 3. Last fallback: scalar from sheet
    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);

    IF v_upper_pid IS NOT NULL AND v_upper > 0 THEN
      v_acc_upper := jsonb_set(v_acc_upper, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_upper->>'required')::numeric, 0) + v_upper * v_pairs));
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    END IF;

    -- Standard items per sole (unchanged)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0) + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key], jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object('component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name, 'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty, 'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'forro');
    v_covered_categories := array_append(v_covered_categories, 'forração');
    v_covered_categories := array_append(v_covered_categories, 'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Items padrão (solado) acumulados
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name, 'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4), 'required', v_acc_required, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_acc_required, 'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard' ELSE 'soft' END, 'source', 'sole_standard_per_size', 'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- Direct Components
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto',
              'product_id', v_pid,
              'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric,
              'required', v_required,
              'available', v_row.quantity,
              'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE
                WHEN LOWER(COALESCE(v_row.category, '')) IN
                  ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft'
              END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM Legado
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories) THEN CONTINUE; END IF;

    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM',
      'product_id', v_row.product_id,
      'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required,
      'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE
        WHEN LOWER(COALESCE(v_row.category, '')) IN
          ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials',
      'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$function$;


-- ---------------------------------------------------------------
-- 20260426130000_sole-size-conjugations.sql
-- ---------------------------------------------------------------
-- New table to store conjugation config per sole group
CREATE TABLE IF NOT EXISTS public.sole_size_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  size_key text NOT NULL,          -- display key: "23/24", "25/26", "35"
  sizes integer[] NOT NULL,        -- e.g. [23,24] or [35]
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sole_group_id, size_key)
);

-- Helper: for a sole group + shoe size, return the conjugated key (or NULL if not configured)
CREATE OR REPLACE FUNCTION public.get_sole_size_key(p_sole_group_id uuid, p_shoe_size integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT size_key
  FROM sole_size_conjugations
  WHERE sole_group_id = p_sole_group_id
    AND p_shoe_size = ANY(sizes)
  LIMIT 1;
$$;

-- Helper: return group_id for a given product_id
CREATE OR REPLACE FUNCTION public.get_sole_group_id_for_product(p_product_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.products WHERE id = p_product_id LIMIT 1;
$$;

-- Updated debit_sole_stock_by_grade with conjugation support
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
  INTO v_mapped_sole_product_id, v_mapped_sole_group_id
  FROM public.technical_sheet_sole_colors tsc
  WHERE tsc.sheet_id = p_reference_id
    AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
  LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
    INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true
      AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN
    RETURN;
  END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  -- Get the group_id for the resolved target product
  SELECT p.group_id INTO v_product_group_id
  FROM public.products p
  WHERE p.id = target_product_id;

  -- Build conjugated grade from p_order_grade
  -- For each size in p_order_grade, check if it maps to a conjugated key
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    ELSE
      v_conj_key := NULL;
    END IF;

    -- Use conjugated key if available, else original size string
    IF v_conj_key IS NULL THEN
      v_conj_key := v_size;
    END IF;

    -- Accumulate quantities under the conjugated key
    v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
    v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade)
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using conjugated grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      description,
      order_id
    )
    VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' || CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;


-- ---------------------------------------------------------------
-- 20260426140000_fix-conjugation-debit-legacy-fallback.sql
-- ---------------------------------------------------------------
-- Fix: debit_sole_stock_by_grade with conjugation only applies conjugated key
-- when that key actually exists in stock_grade. If stock was recorded with individual
-- keys ("23", "24") before conjugation was configured, fall back to individual keys.
-- This makes conjugation backwards-compatible with existing stock data.

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
BEGIN
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
  INTO v_mapped_sole_product_id, v_mapped_sole_group_id
  FROM public.technical_sheet_sole_colors tsc
  WHERE tsc.sheet_id = p_reference_id
    AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
  LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
    INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  SELECT p.group_id INTO v_product_group_id FROM public.products p WHERE p.id = target_product_id;

  -- Build effective debit grade:
  -- For each order size, look up its conjugated key.
  -- Use the conjugated key ONLY if it already exists in stock_grade (new stock format).
  -- Otherwise fall back to the individual size key (legacy stock format).
  -- This makes conjugation backwards-compatible with existing per-size stock data.
  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    v_conj_key := NULL;

    IF v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    END IF;

    -- Only use conjugated key if it actually exists in stock_grade
    IF v_conj_key IS NOT NULL AND (v_stock_grade ->> v_conj_key) IS NOT NULL THEN
      v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    ELSE
      -- Fallback: use original size string (legacy individual keys or no conjugation)
      v_existing_qty := COALESCE((v_conj_grade ->> v_size)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_size], to_jsonb(v_existing_qty + v_size_qty));
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- Validate stock availability using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- Debit stock using effective grade
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(v_conj_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;


-- ---------------------------------------------------------------
-- 20260427240000_mesa-sector-planning.sql
-- ---------------------------------------------------------------
-- Integrate the Mesa sector into the production planning cascade.
--
-- Mesa applies only to models with has_straps = true.
-- lead_time_mesa_dias is derived from handling_time_minutes (min/pair):
--   dias = CEIL(handling_time_minutes * quantity / 480)
--   where 480 = 8 h × 60 min (one working day).
--
-- Position in cascade (before Acabamento, after Montagem):
--   entrega → acabamento → MESA → montagem → costura → corte → buffer → compra

-- ── 1. Recreate view with Mesa ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,

    -- Corte: dynamic capacity or fixed days
    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,

    -- Costura
    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,

    -- Montagem
    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,

    -- Mesa (tiras): CEIL(min_par × qty / 480). Zero when not applicable.
    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
        THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                              * o.quantity::numeric / 480.0)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,

    -- Acabamento
    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,

    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias

  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_corte_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  -- Cascade: entrega → acabamento → mesa → montagem → costura → corte
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    AS data_chegada_material,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    - COALESCE(m.supplier_lead_time_days, 7)
    AS data_limite_compra,

  -- Material columns (unchanged)
  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  m.quantity        AS estoque_atual,
  m.min_stock,
  m.supplier_lead_time_days,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
    AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

-- ── 2. Update planned_start trigger to include Mesa ───────────────────────────
CREATE OR REPLACE FUNCTION public.compute_order_planned_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery   date;
  v_corte      int;
  v_costura    int;
  v_montagem   int;
  v_mesa       int;
  v_acabamento int;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT so.delivery_deadline INTO v_delivery
  FROM public.sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;

  SELECT
    -- Corte
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                       dlt.cutting_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    -- Costura
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                       dlt.sewing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    -- Montagem
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                       dlt.assembly_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    -- Mesa
    CASE WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
         THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                               * NEW.quantity::numeric / 480.0)::int)
         ELSE 0 END,
    -- Acabamento
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                       dlt.finishing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_mesa, v_acabamento
  FROM public.technical_sheets ts
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE ts.id = NEW.reference_id;

  IF v_corte IS NULL THEN RETURN NEW; END IF;

  NEW.planned_start := v_delivery
    - v_acabamento - v_mesa - v_montagem - v_costura - v_corte;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_order_planned_dates ON public.orders;
CREATE TRIGGER trg_compute_order_planned_dates
BEFORE INSERT OR UPDATE OF quantity, sale_order_id, reference_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.compute_order_planned_dates();


-- ---------------------------------------------------------------
-- 20260428150000_block-rascunho-wave-assignment.sql
-- ---------------------------------------------------------------
-- Prevent "Rascunho" (draft) sale orders from being assigned to a production wave.
-- A PV in Rascunho status has not been approved yet and should not enter production.

CREATE OR REPLACE FUNCTION trg_fn_block_rascunho_wave_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_order_number TEXT;
BEGIN
  SELECT status, order_number
    INTO v_status, v_order_number
    FROM sale_orders
   WHERE id = NEW.sale_order_id;

  IF v_status = 'Rascunho' THEN
    RAISE EXCEPTION
      'O pedido % (%) está em Rascunho e não pode ser atribuído a uma onda de produção. Aprove o pedido antes de incluí-lo.',
      COALESCE(v_order_number, NEW.sale_order_id::text),
      v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rascunho_wave_assignment ON production_wave_item_sources;

CREATE TRIGGER trg_block_rascunho_wave_assignment
  BEFORE INSERT ON production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_block_rascunho_wave_assignment();


-- ---------------------------------------------------------------
-- 20260428160000_fix-oc-00127-dedup.sql
-- ---------------------------------------------------------------
-- Fix OC-2026-00127: remove duplicate purchase_order_items caused by the
-- generateAutoPurchaseOrders bug (items were appended without dedup check).
-- Keeps the entry with the highest quantity per product_id, recalculates total_value.

DO $$
DECLARE
  v_po_id uuid;
  v_total  numeric;
BEGIN
  SELECT id INTO v_po_id
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Remove duplicates: for each product_id keep the row with the highest quantity
  -- (= the most recent / largest deficit). Ties broken by latest created_at.
  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  -- Recalculate total_value from the remaining (deduplicated) items
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
     SET total_value = v_total
   WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127 corrigida — duplicatas removidas, total atualizado para R$ %', v_total;
END;
$$;


-- ---------------------------------------------------------------
-- 20260428170000_fix-artisanal-stock-inconsistencies.sql
-- ---------------------------------------------------------------
-- Detect and fix artisanal service orders where the artisanal output was added to
-- stock but the base material was NOT debited (bug: old code showed warning and
-- continued instead of stopping when base product was not found).
--
-- For each inconsistency found:
--   • If base product exists with sufficient stock → debit it now and log movement.
--   • If not found or insufficient stock → RAISE NOTICE for manual review.

DO $$
DECLARE
  rec             record;
  v_base_prod_id  uuid;
  v_base_qty      numeric;
  v_base_needed   numeric;
  v_new_qty       numeric;
  v_fixed         int := 0;
  v_needs_review  int := 0;
BEGIN
  FOR rec IN
    SELECT
      so.id                                                          AS os_id,
      so.order_number                                                AS os_number,
      so.artisanal_output_meters                                     AS output_meters,
      COALESCE(so.artisanal_base_color, so.artisanal_output_color, '') AS base_color,
      ar.base_product_name,
      ar.yield_per_meter,
      so.artisanal_output_meters / NULLIF(ar.yield_per_meter, 0)    AS base_needed
    FROM service_orders so
    JOIN artisanal_recipes ar ON ar.id = so.artisanal_recipe_id
    WHERE so.status             = 'Concluído'
      AND so.artisanal_stock_entry_done = true
      AND so.artisanal_recipe_id IS NOT NULL
      AND so.artisanal_output_meters > 0
      -- Output 'in' movement exists for this OS
      AND EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'in'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND sm.description   ILIKE '%artesanal%'
          )
      -- Base 'out' movement is MISSING for this OS
      AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'out'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND (sm.description  ILIKE '%artesanal%' OR sm.description ILIKE '%Consumo artesanal%')
          )
  LOOP
    v_base_needed := rec.base_needed;

    -- Try to find the base product by name + color
    SELECT p.id, p.quantity
      INTO v_base_prod_id, v_base_qty
      FROM products p
     WHERE (lower(p.name) = lower(rec.base_product_name)
            OR lower(p.name) LIKE lower(rec.base_product_name) || ':%'
            OR lower(p.name) LIKE lower(rec.base_product_name) || ' -%')
       AND (rec.base_color = ''
            OR lower(COALESCE(p.color, '')) = lower(rec.base_color))
     ORDER BY p.updated_at DESC
     LIMIT 1;

    IF v_base_prod_id IS NULL THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) não encontrada no estoque. Débito de %.2fm pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    IF v_base_qty < v_base_needed THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) com estoque insuficiente: disponível %, necessário %. Débito pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_qty, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    -- Debit base material
    v_new_qty := v_base_qty - v_base_needed;

    UPDATE products
       SET quantity   = v_new_qty,
           updated_at = now()
     WHERE id = v_base_prod_id;

    INSERT INTO stock_movements
      (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES
      (v_base_prod_id, 'out', v_base_needed, v_base_qty, v_new_qty,
       'Débito retroativo MP artesanal — ' || rec.os_number || ' (correção automática)');

    RAISE NOTICE '[CORRIGIDO] OS % — debitado %.2fm de "%" (%). Estoque: % → %.',
      rec.os_number, v_base_needed, rec.base_product_name, rec.base_color, v_base_qty, v_new_qty;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== Resumo: % OS(s) corrigida(s), % OS(s) aguardam revisão manual. ===', v_fixed, v_needs_review;
END;
$$;


-- ---------------------------------------------------------------
-- 20260428180000_nfe-companies-multicompany.sql
-- ---------------------------------------------------------------
-- Multi-company NF-e support
-- Creates 'companies' table for multiple CNPJs and links nfe_emitidas to a company.

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  inscricao_estadual text NOT NULL DEFAULT '',
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  logradouro text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  cidade text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  codigo_municipio text NOT NULL DEFAULT '',
  regime_tributario text NOT NULL DEFAULT '1',
  serie_nfe integer NOT NULL DEFAULT 1,
  ambiente text NOT NULL DEFAULT 'homologacao',
  certificate_path text DEFAULT '',
  natureza_operacao text NOT NULL DEFAULT 'Venda de Mercadoria',
  cfop text NOT NULL DEFAULT '5102',
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can manage companies" ON public.companies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add company link to nfe_emitidas (nullable for backwards compat with fiscal_config flow)
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cnpj_emitente text DEFAULT '';

-- Add cancel support fields
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS justificativa_cancelamento text DEFAULT '',
  ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz;

-- Trigger to keep updated_at fresh on companies
CREATE OR REPLACE FUNCTION public.set_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_companies_updated_at();


-- ---------------------------------------------------------------
-- 20260428190000_wave-material-intelligence.sql
-- ---------------------------------------------------------------
-- Wave Material Intelligence
-- Adds timeline back-calculation and material shortage detection to production waves.
--
-- New columns on production_waves:
--   earliest_deadline, corte_start_date, costura_start_date,
--   purchase_deadline, material_ready_date
--
-- New RPC functions:
--   compute_wave_timeline(sale_order_ids[])   → returns stage dates
--   get_wave_material_needs(sale_order_ids[]) → returns material shortages + artisanal info
--   update_wave_timeline(wave_id)             → computes & persists timeline for an existing wave

-- ── 1. Timeline columns ────────────────────────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS earliest_deadline   date,
  ADD COLUMN IF NOT EXISTS corte_start_date    date,
  ADD COLUMN IF NOT EXISTS costura_start_date  date,
  ADD COLUMN IF NOT EXISTS purchase_deadline   date,
  ADD COLUMN IF NOT EXISTS material_ready_date date;

-- ── 2. compute_wave_timeline ───────────────────────────────────────────────────
-- Back-calculates stage start dates from the earliest delivery_deadline among the
-- given sale orders. Uses MAX lead-time values from technical_sheets (conservative).
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
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

  IF v_deadline IS NULL THEN
    RETURN; -- no deadlines → no timeline
  END IF;

  -- Worst-case (MAX) lead times from technical sheets in these orders
  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias),           2),
    COALESCE(MAX(ts.lead_time_costura_dias),         3),
    COALESCE(MAX(ts.lead_time_montagem_dias),        2),
    COALESCE(MAX(ts.lead_time_acabamento_dias),      1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Max supplier lead time across all materials needed
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date        AS purchase_deadline;
END;
$$;

-- ── 3. get_wave_material_needs ─────────────────────────────────────────────────
-- Returns one row per (material, color) combination needed by the given sale orders.
-- For artisanal materials: also returns base-material requirements and OS send date.
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE (
  product_id              uuid,
  product_name            text,
  unit                    text,
  color                   text,
  needed_qty              numeric,
  stock_qty               numeric,
  shortage                numeric,
  supplier_id             uuid,
  supplier_name           text,
  supplier_lead_time_days int,
  is_artisanal            boolean,
  artisanal_recipe_id     uuid,
  artisanal_recipe_name   text,
  base_product_id         uuid,
  base_product_name       text,
  base_needed_qty         numeric,
  base_stock_qty          numeric,
  base_shortage           numeric,
  os_send_date            date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_corte_start date;
BEGIN
  -- Compute corte start date for OS timing calculation (OS must arrive before corte)
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  -- ── Aggregate material needs from sale order items ────────────────────────
  needed AS (
    SELECT
      sm.product_id,
      -- Use sheet_material color if set, otherwise use sale_order_item color
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    GROUP BY sm.product_id, COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),
  -- ── Enrich with product + supplier info ───────────────────────────────────
  enriched AS (
    SELECT
      n.product_id,
      p.name                                              AS product_name,
      COALESCE(p.unit, 'un')                              AS unit,
      n.effective_color                                   AS color,
      n.needed_qty,
      p.quantity                                          AS stock_qty,
      GREATEST(0, n.needed_qty - p.quantity)              AS shortage,
      p.supplier_id,
      sup.name                                            AS supplier_name,
      COALESCE(p.supplier_lead_time_days, 7)::int         AS supplier_lead_time_days,
      COALESCE(p.is_artisanal, false)                     AS is_artisanal
    FROM needed n
    JOIN products p ON p.id = n.product_id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  )
  SELECT
    e.product_id,
    e.product_name,
    e.unit,
    e.color,
    e.needed_qty,
    e.stock_qty,
    e.shortage,
    e.supplier_id,
    e.supplier_name,
    e.supplier_lead_time_days,
    e.is_artisanal,
    -- Artisanal recipe (matched by artisanal_product_name like product name)
    ar.id                                                 AS artisanal_recipe_id,
    ar.name                                               AS artisanal_recipe_name,
    -- Base product: find by base_product_name + color match
    bp.id                                                 AS base_product_id,
    ar.base_product_name,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
      THEN ROUND(e.needed_qty / ar.yield_per_meter, 3)
      ELSE NULL
    END                                                   AS base_needed_qty,
    bp.quantity                                           AS base_stock_qty,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
      THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
      ELSE NULL
    END                                                   AS base_shortage,
    -- OS must be sent at least 7 working days before corte
    CASE
      WHEN e.is_artisanal AND v_corte_start IS NOT NULL
      THEN (v_corte_start - 7)::date
      ELSE NULL
    END                                                   AS os_send_date
  FROM enriched e
  LEFT JOIN artisanal_recipes ar
         ON e.is_artisanal = true
        AND ar.active = true
        AND (
              lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
           OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%'
            )
  LEFT JOIN products bp
         ON ar.id IS NOT NULL
        AND (
              lower(bp.name) = lower(ar.base_product_name)
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%'
            )
        AND (
              e.color = ''
           OR lower(COALESCE(bp.color, '')) = lower(e.color)
           OR bp.color IS NULL
           OR bp.color = ''
            )
  ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

-- ── 4. update_wave_timeline ────────────────────────────────────────────────────
-- Computes and persists timeline columns for an already-created wave.
-- Called by the application after wave creation.
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_order_ids uuid[];
  v_tl        record;
BEGIN
  SELECT array_agg(DISTINCT wis.sale_order_id)
    INTO v_order_ids
    FROM production_wave_item_sources wis
    JOIN production_wave_items wi ON wi.id = wis.wave_item_id
   WHERE wi.wave_id = p_wave_id
     AND wis.sale_order_id IS NOT NULL;

  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM compute_wave_timeline(v_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline   = v_tl.earliest_deadline,
         corte_start_date    = v_tl.corte_start_date,
         costura_start_date  = v_tl.costura_start_date,
         purchase_deadline   = v_tl.purchase_deadline,
         material_ready_date = v_tl.material_ready_date,
         updated_at          = now()
   WHERE id = p_wave_id;
END;
$$;


-- ---------------------------------------------------------------
-- 20260430120000_import-time-records-safe-rpc.sql
-- ---------------------------------------------------------------
-- RPC that inserts time records using ON CONFLICT DO NOTHING at the DB level.
-- This is the only 100% reliable way to skip already-imported days without
-- triggering the unique constraint, regardless of how many rows exist in the DB.
CREATE OR REPLACE FUNCTION import_time_records_safe(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec        jsonb;
  ins_count  integer := 0;
  skp_count  integer := 0;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP
    INSERT INTO time_records (
      employee_name,
      employee_external_id,
      department,
      record_date,
      punches,
      import_batch
    ) VALUES (
      rec->>'employee_name',
      rec->>'employee_external_id',
      rec->>'department',
      (rec->>'record_date')::date,
      ARRAY(SELECT jsonb_array_elements_text(rec->'punches')),
      rec->>'import_batch'
    )
    ON CONFLICT (employee_name, record_date) DO NOTHING;

    IF FOUND THEN
      ins_count := ins_count + 1;
    ELSE
      skp_count := skp_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END;
$$;

-- Grant to authenticated role so the Supabase client can call it
GRANT EXECUTE ON FUNCTION import_time_records_safe(jsonb) TO authenticated;


-- ---------------------------------------------------------------
-- 20260430130000_add-corte-a-faca.sql
-- ---------------------------------------------------------------
-- Adds "corte a faca" flag to technical_sheets.
-- When true the cabedal of this model must be cut in the Corte sector
-- and will appear in a dedicated "Cabedal (Corte a Faca)" section in the
-- Corte grouped report, separated by reference + color with a full grade.
ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS corte_a_faca boolean NOT NULL DEFAULT false;


-- ---------------------------------------------------------------
-- 20260501120000_fix-consumption-by-grade-per-size.sql
-- ---------------------------------------------------------------
-- ---------------------------------------------------------------
-- Fix calculate_order_consumption_by_grade:
--   • Use technical sheet per-size values as first priority
--     (upper/lining/insole_consumption_per_size JSONB fields)
--     falling back to sole_technical_specs then scalar average.
--   • Apply technical_sheet_palmilha_colors mapping when
--     insole_has_lining = false (palmilha comes ready-colored).
--   • Skip forração debit when insole_has_lining = false.
--
-- Fix calculate_order_consumption (single-size):
--   • Same insole_has_lining / palmilha color mapping fixes.
-- ---------------------------------------------------------------

-- ================================================================
-- 1. calculate_order_consumption_by_grade  (graded orders)
-- ================================================================
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade        jsonb,
  p_color        text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_total_qty          numeric := 0;
  v_size               integer;
  v_pairs              numeric;
  v_spec               RECORD;
  v_upper              numeric;
  v_lining             numeric;
  v_insole             numeric;
  v_resolved           RECORD;
  v_row                RECORD;
  v_item               jsonb;
  v_consumption        numeric;
  v_required           numeric;
  v_group_name         text;
  v_covered_categories text[]   := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_acc_upper          jsonb    := '{}'::jsonb;
  v_acc_lining         jsonb    := '{}'::jsonb;
  v_acc_insole         jsonb    := '{}'::jsonb;
  v_acc_std            jsonb    := '{}'::jsonb;
  v_result             jsonb    := '[]'::jsonb;
  v_upper_pid          uuid;
  v_lining_pid         uuid;
  v_insole_pid         uuid;
  v_std_item           RECORD;
  v_key                text;
  v_acc_required       numeric;
  v_acc_avail          numeric;
  v_acc_name           text;
  v_palmilha_color     text;   -- resolved insole color (may differ from p_color)
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade inválida (precisa ser JSON object {size: pairs})';
  END IF;

  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade)
  WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0;

  IF v_total_qty <= 0 THEN
    RAISE EXCEPTION 'Grade vazia (sem pares)';
  END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- ── Resolve products once ──────────────────────────────────────
  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_upper_pid := v_resolved.product_id;
  END IF;

  -- Forração: skip entirely when insole_has_lining = false
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_lining_pid := v_resolved.product_id;
  END IF;

  -- Palmilha: when insole_has_lining = false, resolve color via mapping table
  v_palmilha_color := p_color;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color
      FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id
        AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC
      LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    v_insole_pid := v_resolved.product_id;
  END IF;

  -- ── Per-size accumulation loop ─────────────────────────────────
  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    -- Priority 1: technical sheet per-size JSONB
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

    -- Priority 2: sole_technical_specs (only if sole_drives_consumption and value still missing)
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL)
       AND COALESCE(v_sheet.sole_drives_consumption, false)
       AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs
       WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_upper  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper  := v_spec.upper_consumption_dm2;  END IF;
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
      END IF;
    END IF;

    -- Priority 3: sheet scalar average (final fallback)
    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);

    IF v_upper_pid  IS NOT NULL AND v_upper  > 0 THEN
      v_acc_upper := jsonb_set(v_acc_upper, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_upper->>'required')::numeric, 0) + v_upper * v_pairs));
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    END IF;

    -- Standard sole items (per-size)
    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id
           AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0)
                         + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key],
          jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  -- ── Emit results ───────────────────────────────────────────────

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty,
      'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  -- Cabedal
  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    v_required := (v_acc_upper->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  -- Forro (only when insole_has_lining = true)
  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
    v_required := (v_acc_lining->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Forro', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  -- Palmilha (uses resolved color)
  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, 0, false);
    v_required := (v_acc_insole->>'required')::numeric;
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name,
      'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required,
      'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  -- Standard sole items
  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4),
        'required', v_acc_required, 'available', v_acc_avail,
        'stock_ok', v_acc_avail >= v_acc_required,
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  -- BOM legado (sheet_materials)
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * v_total_qty;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  -- Forros alternativos (lining_accessories) — skipped when insole_has_lining = false
  IF COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_sheet.lining_accessories IS NOT NULL
     AND jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.lining_accessories) AS value LOOP
      v_group_name  := v_item ->> 'material';
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_group_name IS NULL OR v_group_name = '' OR v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      SELECT * INTO v_resolved FROM resolve_material_product(v_group_name, p_color, v_required, false);
      IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_covered_product_ids)) THEN
        v_result := v_result || jsonb_build_object(
          'component', 'Forro (alternativa)', 'product_id', v_resolved.product_id,
          'product_name', v_resolved.product_name, 'color', p_color,
          'consumption_per_unit', v_consumption, 'required', v_required,
          'available', v_resolved.available_qty,
          'stock_ok', v_resolved.available_qty >= v_required,
          'debit_mode', 'soft', 'source', 'lining_accessory', 'matched_by', v_resolved.matched_by);
        v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text) TO authenticated;

-- ================================================================
-- 2. calculate_order_consumption  (single-size / average)
--    Add insole_has_lining guard + palmilha color mapping.
-- ================================================================
CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id  uuid,
  p_order_quantity numeric,
  p_color         text,
  p_size          integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet              RECORD;
  v_sole_product_id    uuid;
  v_sole_color         text;
  v_spec               RECORD;
  v_result             jsonb := '[]'::jsonb;
  v_row                RECORD;
  v_item               jsonb;
  v_pid                uuid;
  v_consumption        numeric;
  v_required           numeric;
  v_resolved           RECORD;
  v_group_name         text;
  v_effective_size     integer;
  v_lining_consumption numeric;
  v_insole_consumption numeric;
  v_upper_consumption  numeric;
  v_covered_categories  text[]  := ARRAY[]::text[];
  v_covered_product_ids uuid[]  := ARRAY[]::uuid[];
  v_row_cat_norm       text;
  v_conv               RECORD;
  v_is_fachetado       boolean;
  v_fachete_consumption numeric;
  v_palmilha_color     text;   -- resolved insole color
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  -- Per-size consumption (sheet JSONB → sole_technical_specs → scalar)
  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

  IF (v_upper_consumption IS NULL OR v_lining_consumption IS NULL OR v_insole_consumption IS NULL)
     AND COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT * INTO v_spec FROM sole_technical_specs
    WHERE sole_id = v_sole_product_id AND size = v_effective_size;
    IF FOUND THEN
      IF v_upper_consumption  IS NULL AND COALESCE(v_spec.upper_consumption_dm2,  0) > 0 THEN v_upper_consumption  := v_spec.upper_consumption_dm2;  END IF;
      IF v_lining_consumption IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining_consumption := v_spec.lining_consumption_dm2; END IF;
      IF v_insole_consumption IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole_consumption := v_spec.insole_consumption_dm2; END IF;
    END IF;
  END IF;

  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  -- Resolve palmilha color
  v_palmilha_color := p_color;
  IF COALESCE(v_sheet.insole_has_lining, true) = false AND v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    SELECT palmilha_color INTO v_palmilha_color
    FROM technical_sheet_palmilha_colors
    WHERE sheet_id = p_reference_id
      AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
    ORDER BY (cabedal_color = p_color) DESC
    LIMIT 1;
    v_palmilha_color := COALESCE(v_palmilha_color, p_color);
  END IF;

  -- Solado
  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_row.name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_required,
      'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);

    -- Fachete
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado FROM products WHERE id = v_sole_product_id;
    IF v_is_fachetado AND v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
      SELECT fachete_lining_consumption_dm2 INTO v_fachete_consumption
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_effective_size;
      IF COALESCE(v_fachete_consumption, 0) > 0 THEN
        v_required := v_fachete_consumption * p_order_quantity;
        SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
        IF v_resolved.product_id IS NOT NULL THEN
          SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
          v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
          v_result := v_result || jsonb_build_object(
            'component', 'Fachete', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
            'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
            'required', v_required, 'available', v_resolved.available_qty,
            'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
            'source', 'sole_fachete', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
        END IF;
      END IF;
    END IF;
  END IF;

  -- Cabedal
  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
     AND v_upper_consumption > 0 THEN
    v_required := v_upper_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Cabedal', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Forração (skip when insole_has_lining = false)
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0
     AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
    v_required := v_lining_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Forro', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'forro');
      v_covered_categories  := array_append(v_covered_categories,  'forração');
      v_covered_categories  := array_append(v_covered_categories,  'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Palmilha (uses resolved palmilha_color)
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, v_palmilha_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
      v_covered_categories  := array_append(v_covered_categories,  'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  -- Componentes diretos
  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * p_order_quantity;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
                ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components');
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- BOM legado (sheet_materials)
  FOR v_row IN
    SELECT sm.product_id, sm.quantity_per_unit,
           p.name, p.quantity AS available, p.category, p.color AS product_color
      FROM sheet_materials sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.sheet_id = p_reference_id AND p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials');
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_consumption(uuid, numeric, text, integer) TO authenticated;


-- ---------------------------------------------------------------
-- 20260501130000_fix-conjugated-debit-strict.sql
-- ---------------------------------------------------------------
-- Fix debit_sole_stock_by_grade: strict conjugated-key handling
--
-- Previous version (20260426140000) used the conjugated key ONLY when it already
-- existed in stock_grade (as a safety fallback). This was wrong for soles that
-- HAVE conjugations configured: their stock must be stored with conjugated keys
-- (e.g. "24/25"), so debiting with individual keys ("24", "25") would fail.
--
-- New behaviour:
--   1. If p_order_grade already contains conjugated keys ("24/25") → use as-is.
--   2. If conjugations are configured for the sole group:
--      a. Map each individual size to its conjugated key via get_sole_size_key().
--      b. Sizes not covered by any conjugation → use as individual key.
--   3. No conjugations configured → use all keys from p_order_grade unchanged.
--
-- This makes the debit function work correctly for:
--   • New orders stored with conjugated grades  (case 1)
--   • Old orders stored with individual grades  (cases 2/3 — backwards compat)

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id     uuid,
  p_color        text,
  p_order_grade  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id       uuid;
  v_sole_material       text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id    uuid;
  target_name          text;
  v_stock_grade        jsonb;
  v_size               text;
  v_size_qty           numeric;
  v_available          numeric;
  v_new_grade          jsonb;
  v_total_debited      numeric := 0;
  v_prev_total         numeric;
  v_product_group_id   uuid;
  v_effective_grade    jsonb;
  v_conj_key           text;
  v_existing_qty       numeric;
  v_has_conjugations   boolean;
BEGIN
  -- ── Resolve sole info from technical sheet ───────────────────────────────────
  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- ── Resolve target sole product (same priority chain as before) ──────────────
  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
     WHERE p.active = true AND p.id = v_mapped_sole_product_id
     LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  -- ── Check whether conjugations are configured for this sole group ─────────────
  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  -- ── Build effective debit grade ───────────────────────────────────────────────
  -- Rules:
  --   • If the key already contains '/' → already a conjugated key, use as-is
  --   • Else if conjugations are configured → resolve via get_sole_size_key()
  --     - If a conjugated key is found → use it (accumulate quantities)
  --     - If not found → the size is non-conjugated within the range, use as-is
  --   • No conjugations configured → use key unchanged (legacy individual format)
  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
  LOOP
    IF v_size LIKE '%/%' THEN
      -- Already a conjugated key ("24/25") — pass through
      v_conj_key := v_size;

    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      -- Sole has conjugations; map individual size → conjugated key
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      -- Size not covered by any conjugation → keep as individual key
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;

    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  -- ── Compute previous total for stock_movements ────────────────────────────────
  v_prev_total := 0;
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- ── Validate stock availability ───────────────────────────────────────────────
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- ── Debit stock ───────────────────────────────────────────────────────────────
  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = GREATEST(0, quantity - v_total_debited),
           updated_at  = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Débito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) TO authenticated;


-- ---------------------------------------------------------------
-- 20260502100000_fix-rls-missing-policies.sql
-- ---------------------------------------------------------------
-- ---------------------------------------------------------------
-- Fix RLS gaps:
--   1. 19 tables had RLS enabled but policies never created or
--      were dropped without replacement. This migration adds
--      idempotent policies (DROP IF EXISTS + CREATE) for all of
--      them using the project-standard is_approved_user() pattern.
--   2. 5 tables had policies defined but RLS never enabled.
-- ---------------------------------------------------------------

-- ================================================================
-- PART 1 — Tables with RLS enabled but missing policies
-- ================================================================

-- ── artisanal_recipes ───────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view artisanal_recipes"   ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Authenticated users can view artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can view artisanal_recipes"
  ON public.artisanal_recipes FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert artisanal_recipes"
  ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update artisanal_recipes"
  ON public.artisanal_recipes FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete artisanal_recipes"
  ON public.artisanal_recipes FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── default_lead_times ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view default_lead_times"   ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can insert default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can update default_lead_times" ON public.default_lead_times;
DROP POLICY IF EXISTS "Approved users can delete default_lead_times" ON public.default_lead_times;
CREATE POLICY "Approved users can view default_lead_times"
  ON public.default_lead_times FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert default_lead_times"
  ON public.default_lead_times FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update default_lead_times"
  ON public.default_lead_times FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete default_lead_times"
  ON public.default_lead_times FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── employee_skills ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view employee_skills"   ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can insert employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can update employee_skills" ON public.employee_skills;
DROP POLICY IF EXISTS "Approved users can delete employee_skills" ON public.employee_skills;
CREATE POLICY "Approved users can view employee_skills"
  ON public.employee_skills FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert employee_skills"
  ON public.employee_skills FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update employee_skills"
  ON public.employee_skills FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete employee_skills"
  ON public.employee_skills FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── equipment_downtime ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view equipment_downtime"   ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can insert equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can update equipment_downtime" ON public.equipment_downtime;
DROP POLICY IF EXISTS "Approved users can delete equipment_downtime" ON public.equipment_downtime;
CREATE POLICY "Approved users can view equipment_downtime"
  ON public.equipment_downtime FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert equipment_downtime"
  ON public.equipment_downtime FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update equipment_downtime"
  ON public.equipment_downtime FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete equipment_downtime"
  ON public.equipment_downtime FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── inventory_transactions ──────────────────────────────────────
DROP POLICY IF EXISTS "Allow full access for authenticated users to inventory transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can view inventory_transactions"   ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can insert inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can update inventory_transactions" ON public.inventory_transactions;
DROP POLICY IF EXISTS "Approved users can delete inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "Approved users can view inventory_transactions"
  ON public.inventory_transactions FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert inventory_transactions"
  ON public.inventory_transactions FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update inventory_transactions"
  ON public.inventory_transactions FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete inventory_transactions"
  ON public.inventory_transactions FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── material_audit_log (read-only for approved users) ───────────
DROP POLICY IF EXISTS "Approved users can view material_audit_log"   ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can insert material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can update material_audit_log" ON public.material_audit_log;
DROP POLICY IF EXISTS "Approved users can delete material_audit_log" ON public.material_audit_log;
CREATE POLICY "Approved users can view material_audit_log"
  ON public.material_audit_log FOR SELECT TO authenticated USING (public.is_approved_user());
-- Insert allowed for SECURITY DEFINER functions (triggers/RPCs write to this table)
CREATE POLICY "Approved users can insert material_audit_log"
  ON public.material_audit_log FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- ── product_technical_sheets ────────────────────────────────────
DROP POLICY IF EXISTS "Allow full access for authenticated users to technical sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can view product_technical_sheets"   ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can insert product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can update product_technical_sheets" ON public.product_technical_sheets;
DROP POLICY IF EXISTS "Approved users can delete product_technical_sheets" ON public.product_technical_sheets;
CREATE POLICY "Approved users can view product_technical_sheets"
  ON public.product_technical_sheets FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert product_technical_sheets"
  ON public.product_technical_sheets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update product_technical_sheets"
  ON public.product_technical_sheets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete product_technical_sheets"
  ON public.product_technical_sheets FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── production_equipment ────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view production_equipment"   ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can insert production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can update production_equipment" ON public.production_equipment;
DROP POLICY IF EXISTS "Approved users can delete production_equipment" ON public.production_equipment;
CREATE POLICY "Approved users can view production_equipment"
  ON public.production_equipment FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert production_equipment"
  ON public.production_equipment FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update production_equipment"
  ON public.production_equipment FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete production_equipment"
  ON public.production_equipment FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── quality_checklists ──────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view quality_checklists"   ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can insert quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can update quality_checklists" ON public.quality_checklists;
DROP POLICY IF EXISTS "Approved users can delete quality_checklists" ON public.quality_checklists;
CREATE POLICY "Approved users can view quality_checklists"
  ON public.quality_checklists FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert quality_checklists"
  ON public.quality_checklists FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update quality_checklists"
  ON public.quality_checklists FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete quality_checklists"
  ON public.quality_checklists FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── quality_inspections ─────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view quality_inspections"   ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can insert quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can update quality_inspections" ON public.quality_inspections;
DROP POLICY IF EXISTS "Approved users can delete quality_inspections" ON public.quality_inspections;
CREATE POLICY "Approved users can view quality_inspections"
  ON public.quality_inspections FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert quality_inspections"
  ON public.quality_inspections FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update quality_inspections"
  ON public.quality_inspections FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete quality_inspections"
  ON public.quality_inspections FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sales_targets ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sales_targets"   ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can insert sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can update sales_targets" ON public.sales_targets;
DROP POLICY IF EXISTS "Approved users can delete sales_targets" ON public.sales_targets;
CREATE POLICY "Approved users can view sales_targets"
  ON public.sales_targets FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sales_targets"
  ON public.sales_targets FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sales_targets"
  ON public.sales_targets FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sales_targets"
  ON public.sales_targets FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sheet_catalog_models ────────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can manage catalog models"   ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can view sheet_catalog_models"   ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can insert sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can update sheet_catalog_models" ON public.sheet_catalog_models;
DROP POLICY IF EXISTS "Approved users can delete sheet_catalog_models" ON public.sheet_catalog_models;
CREATE POLICY "Approved users can view sheet_catalog_models"
  ON public.sheet_catalog_models FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sheet_catalog_models"
  ON public.sheet_catalog_models FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sheet_catalog_models"
  ON public.sheet_catalog_models FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sheet_catalog_models"
  ON public.sheet_catalog_models FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sheet_material_grading ──────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sheet_material_grading"   ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can insert sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can update sheet_material_grading" ON public.sheet_material_grading;
DROP POLICY IF EXISTS "Approved users can delete sheet_material_grading" ON public.sheet_material_grading;
CREATE POLICY "Approved users can view sheet_material_grading"
  ON public.sheet_material_grading FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sheet_material_grading"
  ON public.sheet_material_grading FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sheet_material_grading"
  ON public.sheet_material_grading FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sheet_material_grading"
  ON public.sheet_material_grading FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_silk_registrations ─────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_silk_registrations"   ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can insert sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can update sole_silk_registrations" ON public.sole_silk_registrations;
DROP POLICY IF EXISTS "Approved users can delete sole_silk_registrations" ON public.sole_silk_registrations;
CREATE POLICY "Approved users can view sole_silk_registrations"
  ON public.sole_silk_registrations FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_silk_registrations"
  ON public.sole_silk_registrations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_silk_registrations"
  ON public.sole_silk_registrations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_silk_registrations"
  ON public.sole_silk_registrations FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_size_conjugations ──────────────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_size_conjugations"   ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can insert sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can update sole_size_conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "Approved users can delete sole_size_conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can view sole_size_conjugations"
  ON public.sole_size_conjugations FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_size_conjugations"
  ON public.sole_size_conjugations FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_size_conjugations"
  ON public.sole_size_conjugations FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_size_conjugations"
  ON public.sole_size_conjugations FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── sole_standard_items_consumption ────────────────────────────
DROP POLICY IF EXISTS "Approved users can view sole_standard_items_consumption"   ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can insert sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can update sole_standard_items_consumption" ON public.sole_standard_items_consumption;
DROP POLICY IF EXISTS "Approved users can delete sole_standard_items_consumption" ON public.sole_standard_items_consumption;
CREATE POLICY "Approved users can view sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete sole_standard_items_consumption"
  ON public.sole_standard_items_consumption FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── technical_sheet_insole_colors ───────────────────────────────
DROP POLICY IF EXISTS "Approved users can view technical_sheet_insole_colors"   ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_insole_colors" ON public.technical_sheet_insole_colors;
CREATE POLICY "Approved users can view technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete technical_sheet_insole_colors"
  ON public.technical_sheet_insole_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- ── technical_sheet_overhead_history ────────────────────────────
DROP POLICY IF EXISTS "Users can view history of sheets they can access" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_overhead_history"   ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_overhead_history" ON public.technical_sheet_overhead_history;
CREATE POLICY "Approved users can view technical_sheet_overhead_history"
  ON public.technical_sheet_overhead_history FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_overhead_history"
  ON public.technical_sheet_overhead_history FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());

-- ── technical_sheet_palmilha_colors (CRITICAL — used in consumption RPCs) ──
DROP POLICY IF EXISTS "allow_all_palmilha_colors"                              ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can view technical_sheet_palmilha_colors"   ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can insert technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can update technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
DROP POLICY IF EXISTS "Approved users can delete technical_sheet_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "Approved users can view technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete technical_sheet_palmilha_colors"
  ON public.technical_sheet_palmilha_colors FOR DELETE TO authenticated USING (public.is_approved_user());

-- ================================================================
-- PART 2 — Tables with policies but RLS not enabled
-- ================================================================

ALTER TABLE public.baus               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_companies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_company_rates  ENABLE ROW LEVEL SECURITY;

-- Ensure these tables have policies (drop old + recreate idempotently)
DROP POLICY IF EXISTS "Approved users can view baus"   ON public.baus;
DROP POLICY IF EXISTS "Approved users can insert baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can update baus" ON public.baus;
DROP POLICY IF EXISTS "Approved users can delete baus" ON public.baus;
CREATE POLICY "Approved users can view baus"   ON public.baus FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert baus" ON public.baus FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update baus" ON public.baus FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete baus" ON public.baus FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view box_types"   ON public.box_types;
DROP POLICY IF EXISTS "Approved users can insert box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can delete box_types" ON public.box_types;
CREATE POLICY "Approved users can view box_types"   ON public.box_types FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert box_types" ON public.box_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update box_types" ON public.box_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete box_types" ON public.box_types FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view item_types"   ON public.item_types;
DROP POLICY IF EXISTS "Approved users can insert item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can update item_types" ON public.item_types;
DROP POLICY IF EXISTS "Approved users can delete item_types" ON public.item_types;
CREATE POLICY "Approved users can view item_types"   ON public.item_types FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert item_types" ON public.item_types FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update item_types" ON public.item_types FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete item_types" ON public.item_types FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view transport_companies"   ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can insert transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can update transport_companies" ON public.transport_companies;
DROP POLICY IF EXISTS "Approved users can delete transport_companies" ON public.transport_companies;
CREATE POLICY "Approved users can view transport_companies"   ON public.transport_companies FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert transport_companies" ON public.transport_companies FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_companies" ON public.transport_companies FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_companies" ON public.transport_companies FOR DELETE TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can view transport_company_rates"   ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can insert transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can update transport_company_rates" ON public.transport_company_rates;
DROP POLICY IF EXISTS "Approved users can delete transport_company_rates" ON public.transport_company_rates;
CREATE POLICY "Approved users can view transport_company_rates"   ON public.transport_company_rates FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can insert transport_company_rates" ON public.transport_company_rates FOR INSERT TO authenticated WITH CHECK (public.is_approved_user());
CREATE POLICY "Approved users can update transport_company_rates" ON public.transport_company_rates FOR UPDATE TO authenticated USING (public.is_approved_user());
CREATE POLICY "Approved users can delete transport_company_rates" ON public.transport_company_rates FOR DELETE TO authenticated USING (public.is_approved_user());


-- ---------------------------------------------------------------
-- 20260502130000_construction-model-restructure.sql
-- ---------------------------------------------------------------
-- Construction model restructure: 3 clear production models
-- Model 1: Corte Cabedal (sole + insole ready-made from outside, consumed in units)
-- Model 2: Corte Cabedal + Palmilha Forrada (standard with lining)
-- Model 3: Tiras (no cabedal cut, goes through Mesa sector)

-- 1. mesa_daily_capacity: daily pair capacity at the Mesa sector (Model 3 / tiras)
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity integer NOT NULL DEFAULT 0;

-- 2. insole_ready_made: sole + insole arrive ready-made (Model 1)
--    Consumed in units by size, not dm². Only cabedal needs consumption tracking.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;

-- 3. insole_included: mark a sole product group as "comes with insole included"
--    When a sole with insole_included=true is used, the sheet defaults to Model 1.
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS insole_included boolean NOT NULL DEFAULT false;

