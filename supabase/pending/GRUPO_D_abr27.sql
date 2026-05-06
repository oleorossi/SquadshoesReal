-- GRUPO D: MRP, ondas, funcionários, Mesa (abr/27)

-- ========== 20260427100000_mrp-reserved-stock.sql ==========
-- ============================================================
-- MRP: Reserved / In-Production stock visibility
-- Adds:
--   1. get_in_production_stock()  – aggregate of out stock_movements
--                                   linked to active OPs
--   2. parse_iso_billing_week()   – parses '2026-W16' → Monday date
--   3. product_stock_with_reservations view (convenience)
-- ============================================================

-- 1. Returns (product_id, in_production_quantity) for every product
--    that has at least one out-movement on an active OP.
--    "Active OP" = status IN ('Reservado', 'Em Produção').
CREATE OR REPLACE FUNCTION public.get_in_production_stock()
RETURNS TABLE(product_id uuid, in_production_quantity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sm.product_id,
    SUM(sm.quantity) AS in_production_quantity
  FROM stock_movements sm
  INNER JOIN orders o ON o.id = sm.order_id
  WHERE sm.movement_type = 'out'
    AND o.status IN ('Reservado', 'Em Produção')
  GROUP BY sm.product_id;
$$;

COMMENT ON FUNCTION public.get_in_production_stock IS
  'Returns the sum of out stock_movements linked to active OPs (Reservado / Em Produção). '
  'This represents material that has been hard-debited but is still being processed in production.';

-- 2. Parse ISO billing-week text (e.g. "2026-W16") to the Monday of that week.
CREATE OR REPLACE FUNCTION public.parse_iso_billing_week(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_year  int;
  v_week  int;
  v_jan4  date;
  v_dow   int;  -- 0 = Mon … 6 = Sun
  v_w1mon date;
BEGIN
  IF p_text ~ '^\d{4}-W\d{1,2}$' THEN
    v_year  := split_part(p_text, '-W', 1)::int;
    v_week  := split_part(p_text, '-W', 2)::int;
    v_jan4  := make_date(v_year, 1, 4);
    -- ISODOW: 1=Mon … 7=Sun  →  subtract (isodow-1) to reach Monday
    v_dow   := (EXTRACT(ISODOW FROM v_jan4)::int) - 1;
    v_w1mon := v_jan4 - v_dow;
    RETURN v_w1mon + ((v_week - 1) * 7);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.parse_iso_billing_week IS
  'Converts an ISO week string like "2026-W16" to the Monday date of that week.';

-- 3. Convenience view: products enriched with soft-reserved and in-production quantities.
--    • reserved_quantity  – soft reservations from material_reservations (status = reserved/partially_consumed)
--    • in_production_quantity – hard-debited materials still in active OPs (from stock_movements)
--    • available_quantity – products.quantity (free stock after debits)
CREATE OR REPLACE VIEW public.product_stock_with_reservations AS
SELECT
  p.*,
  COALESCE(r.reserved_qty, 0)    AS reserved_quantity,
  COALESCE(ip.in_prod_qty, 0)    AS in_production_quantity,
  GREATEST(0, p.quantity - COALESCE(r.reserved_qty, 0)) AS available_quantity
FROM public.products p
LEFT JOIN (
  SELECT
    product_id,
    SUM(GREATEST(0, quantity_reserved - COALESCE(quantity_consumed, 0))) AS reserved_qty
  FROM public.material_reservations
  WHERE status IN ('reserved', 'partially_consumed')
  GROUP BY product_id
) r ON r.product_id = p.id
LEFT JOIN (
  SELECT sm.product_id, SUM(sm.quantity) AS in_prod_qty
  FROM public.stock_movements sm
  INNER JOIN public.orders o ON o.id = sm.order_id
  WHERE sm.movement_type = 'out'
    AND o.status IN ('Reservado', 'Em Produção')
  GROUP BY sm.product_id
) ip ON ip.product_id = p.id;

COMMENT ON VIEW public.product_stock_with_reservations IS
  'Products with additional stock breakdown: soft reservations and in-production quantities.';

-- ========== 20260427110000_po-grade-column.sql ==========
-- Add structured grade breakdown to purchase_order_items (for sole items)
-- and a color snapshot column for efficient PDF rendering

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS grade   jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS color   text    DEFAULT NULL;

COMMENT ON COLUMN public.purchase_order_items.grade IS
  'For sole items: {size_key: quantity} breakdown, e.g. {"36": 10, "37": 20, "23/24": 5}';

COMMENT ON COLUMN public.purchase_order_items.color IS
  'Product color snapshot at time of order creation (used for sole PDF grouping)';

-- ========== 20260427120000_accounts-payable-uniqueness.sql ==========
-- Prevent duplicate accounts_payable entries for the same purchase order.
-- The notes field carries "OC: <order_number>" so we use a partial unique index
-- based on (supplier_id, description) to catch exact duplicate calls.
-- A function-based approach covers the idempotency check done in the app layer.

-- Unique index: one pending/unpaid AP entry per (supplier_id, description).
-- This blocks the double-AP bug when handleSendToFinance + handleFinalize
-- are both called on the same OC without status transitioning in between.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_payable_supplier_desc_pending
  ON public.accounts_payable (supplier_id, description)
  WHERE status IN ('pending', 'approved');

COMMENT ON INDEX public.uq_accounts_payable_supplier_desc_pending IS
  'Prevents duplicate pending AP entries with the same supplier and description (guards against double-click / double-finalization of purchase orders).';

-- ========== 20260427130000_wave-sale-order-uniqueness.sql ==========
-- Prevent the same sale_order from being assigned to more than one active
-- production wave simultaneously (guards against the race condition in
-- listPendingSaleOrdersForWeek + createWave).
--
-- A sale_order CAN appear in multiple FINISHED/CANCELLED waves (historical),
-- but only once in a wave whose status is draft / planning / running.

-- Helper function used by the constraint
CREATE OR REPLACE FUNCTION public.wave_is_active(wave_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.production_waves
    WHERE id = wave_id
      AND status NOT IN ('finished', 'cancelled')
  );
$$;

-- Unique partial index: (sale_order_id) where the linked wave is active.
-- Cannot use a direct partial index on a FK-resolved value, so we use an
-- EXCLUDE constraint via a trigger instead.

CREATE OR REPLACE FUNCTION public.check_sale_order_single_active_wave()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sale_order_id IS NOT NULL AND public.wave_is_active(
    (SELECT wave_id FROM public.production_wave_items WHERE id = NEW.wave_item_id)
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM public.production_wave_item_sources s
      JOIN public.production_wave_items wi ON wi.id = s.wave_item_id
      JOIN public.production_waves pw ON pw.id = wi.wave_id
      WHERE s.sale_order_id = NEW.sale_order_id
        AND s.id IS DISTINCT FROM NEW.id
        AND pw.status NOT IN ('finished', 'cancelled')
    ) THEN
      RAISE EXCEPTION
        'sale_order % is already assigned to an active production wave',
        NEW.sale_order_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sale_order_single_active_wave
  ON public.production_wave_item_sources;

CREATE TRIGGER trg_check_sale_order_single_active_wave
  BEFORE INSERT OR UPDATE ON public.production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.check_sale_order_single_active_wave();

COMMENT ON TRIGGER trg_check_sale_order_single_active_wave
  ON public.production_wave_item_sources IS
  'Blocks a sale_order from being assigned to more than one active (non-finished, non-cancelled) production wave at a time.';

-- ========== 20260427140000_employee-overtime-rate.sql ==========
-- Add per-employee overtime hourly rate.
-- When set, this value (R$/hora) is used for overtime cost calculations
-- instead of the derived rate (salary / 220 * schedule.overtime_multiplier).
-- This allows each employee to have an individual overtime agreement.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_hourly_rate NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.employees.overtime_hourly_rate IS
  'Custom overtime hourly rate (R$/hr). When set, overrides salary/220 * multiplier for OT cost calculations.';

-- ========== 20260427150000_employee-work-schedule.sql ==========
-- Link each employee to a specific work schedule.
-- When set, the employee's own schedule is used for OT/deficit calculations
-- instead of the global default schedule.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS work_schedule_id UUID REFERENCES public.work_schedules(id) ON DELETE SET NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_work_schedule_id ON public.employees(work_schedule_id);

COMMENT ON COLUMN public.employees.work_schedule_id IS
  'Optional link to a specific work schedule. Falls back to is_default schedule when NULL.';

-- ========== 20260427170000_automation-tables.sql ==========
-- automation_workflows: persists workflow definitions (replaces in-memory useState)
CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  trigger        TEXT        NOT NULL,
  trigger_label  TEXT        NOT NULL DEFAULT '',
  conditions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  actions        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  category       TEXT        NOT NULL DEFAULT 'orders',
  execution_count INTEGER    NOT NULL DEFAULT 0,
  success_count  INTEGER     NOT NULL DEFAULT 0,
  last_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- automation_executions: one row per run attempt
CREATE TABLE IF NOT EXISTS public.automation_executions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID        NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  workflow_name TEXT        NOT NULL,
  trigger       TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  context       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_exec_workflow_id  ON public.automation_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_auto_exec_executed_at  ON public.automation_executions(executed_at DESC);

ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_workflows_all"  ON public.automation_workflows  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "auto_executions_all" ON public.automation_executions FOR ALL USING (true) WITH CHECK (true);

-- auto-update updated_at on edit
CREATE OR REPLACE FUNCTION public.touch_automation_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_auto_workflow_updated_at ON public.automation_workflows;
CREATE TRIGGER trg_auto_workflow_updated_at
  BEFORE UPDATE ON public.automation_workflows
  FOR EACH ROW EXECUTE FUNCTION public.touch_automation_workflow();

-- Seed default workflows only when the table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.automation_workflows LIMIT 1) THEN
    INSERT INTO public.automation_workflows
      (name, description, trigger, trigger_label, conditions, actions, enabled, category)
    VALUES
      (
        'Alerta Estoque Baixo',
        'Notifica quando um material atinge o estoque mínimo',
        'stock_below_minimum', 'Estoque abaixo do mínimo',
        '[{"id":"c1","field":"quantity","operator":"less_than","value":"min_stock"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Enviar notificação","config":{"title":"Estoque Baixo","severity":"warning","message":"Material abaixo do estoque mínimo"}}]'::jsonb,
        true, 'stock'
      ),
      (
        'Pedido Confirmado → Notifica PCP',
        'Ao criar pedido de venda confirmado, alerta o PCP para programar produção',
        'sale_order_created', 'Pedido de venda criado',
        '[{"id":"c1","field":"status","operator":"equals","value":"Confirmado"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar PCP","config":{"title":"Novo pedido confirmado","severity":"info","message":"Programar produção"}},{"id":"a2","type":"log_event","label":"Log de evento","config":{"message":"Pedido confirmado recebido","level":"info"}}]'::jsonb,
        true, 'orders'
      ),
      (
        'Pagamento Recebido → Notificar',
        'Notifica financeiro ao confirmar pagamento de cliente',
        'payment_received', 'Pagamento confirmado',
        '[]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar financeiro","config":{"title":"Pagamento recebido","severity":"success","message":"Confirmar baixa no sistema"}}]'::jsonb,
        true, 'finance'
      ),
      (
        'Pagamento em Atraso',
        'Alerta quando título vence sem pagamento confirmado',
        'payment_overdue', 'Pagamento em atraso',
        '[{"id":"c1","field":"days_overdue","operator":"greater_than","value":"3"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Alerta de inadimplência","config":{"title":"Título em atraso","severity":"error","message":"Cliente com pagamento atrasado"}}]'::jsonb,
        true, 'finance'
      ),
      (
        'OS Concluída → Conta a Pagar',
        'Alerta para criar título no financeiro ao concluir OS de terceirizado',
        'service_order_completed', 'OS de terceirizado concluída',
        '[{"id":"c1","field":"type","operator":"equals","value":"terceirizado"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar financeiro","config":{"title":"Nova conta a pagar pendente","severity":"warning","message":"OS concluída — criar título"}},{"id":"a2","type":"log_event","label":"Log de OS","config":{"message":"OS terceirizado concluída","level":"info"}}]'::jsonb,
        true, 'finance'
      );
  END IF;
END;
$$;

-- ========== 20260427190000_palmilha-lining-config.sql ==========
-- Adds insole lining flag and palmilha color mapping to technical sheets.
-- insole_has_lining = true  → palmilha follows the same color as cabedal (default)
-- insole_has_lining = false → use technical_sheet_palmilha_colors to look up palmilha color per cabedal color

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_has_lining BOOLEAN DEFAULT TRUE;

-- Maps cabedal/product color → palmilha (insole) color for sheets without insole lining.
-- Example: "Preto" → "Preto", "Caramelo" → "Caramelo", "__DEFAULT__" → "Caramelo"
CREATE TABLE IF NOT EXISTS public.technical_sheet_palmilha_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  cabedal_color text NOT NULL,   -- product/shoe color (key)
  palmilha_color text NOT NULL,  -- insole color to use for that cabedal color
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, cabedal_color)
);

ALTER TABLE public.technical_sheet_palmilha_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_palmilha_colors"
  ON public.technical_sheet_palmilha_colors
  FOR ALL USING (true) WITH CHECK (true);

-- ========== 20260427200000_add-fachete-to-soles.sql ==========
-- ----------------------------------------------------------------
-- 20260427200000_add-fachete-to-soles.sql
-- Solados fachetados: flag no produto + consumo de forração por numeração
-- O fachete usa o material de forração da ficha técnica na cor da palmilha.
-- ----------------------------------------------------------------

-- 1. Flag is_fachetado na tabela de produtos (solados)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_fachetado boolean NOT NULL DEFAULT false;

-- 2. Consumo de forração do fachete por numeração
ALTER TABLE public.sole_technical_specs
  ADD COLUMN IF NOT EXISTS fachete_lining_consumption_dm2 numeric(10,4) DEFAULT NULL;

-- ----------------------------------------------------------------
-- 3. Atualiza calculate_order_consumption para incluir Fachete
-- ----------------------------------------------------------------
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
  v_is_fachetado boolean;
  v_fachete_consumption numeric;
BEGIN
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  v_effective_size := COALESCE(p_size, v_sheet.reference_size, 37);

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  v_upper_consumption  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_effective_size::text))::numeric, 0), 0);
  v_lining_consumption := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);
  v_insole_consumption := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_effective_size::text))::numeric, 0), 0);

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

  v_upper_consumption  := COALESCE(v_upper_consumption,  v_sheet.upper_consumption,  0);
  v_lining_consumption := COALESCE(v_lining_consumption, v_sheet.lining_consumption, 0);
  v_insole_consumption := COALESCE(v_insole_consumption, v_sheet.insole_consumption, 0);

  IF v_sole_product_id IS NOT NULL THEN
    v_required := p_order_quantity;
    SELECT p.name, p.quantity INTO v_row FROM products p WHERE p.id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_row.name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_required,
      'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
      'debit_mode', 'hard', 'source', 'primary_sole'
    );
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);

    -- Fachete: forração aplicada sobre o solado, na cor da palmilha
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado FROM products WHERE id = v_sole_product_id;
    IF v_is_fachetado AND v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
      SELECT fachete_lining_consumption_dm2 INTO v_fachete_consumption
      FROM sole_technical_specs
      WHERE sole_id = v_sole_product_id AND size = v_effective_size;

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
            'source', 'sole_fachete', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
          );
        END IF;
      END IF;
    END IF;
  END IF;

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
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'cabedal');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> ''
     AND v_lining_consumption > 0 THEN
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
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'forro');
      v_covered_categories := array_append(v_covered_categories, 'forração');
      v_covered_categories := array_append(v_covered_categories, 'forracao');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
     AND v_insole_consumption > 0 THEN
    v_required := v_insole_consumption * p_order_quantity;
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, v_required, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Palmilha', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
      v_covered_categories := array_append(v_covered_categories, 'palmilha');
      v_covered_product_ids := array_append(v_covered_product_ids, v_resolved.product_id);
    END IF;
  END IF;

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
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
                ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

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
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
        ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

-- ----------------------------------------------------------------
-- 4. Atualiza calculate_order_consumption_by_grade para incluir Fachete
-- ----------------------------------------------------------------
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
  v_acc_fachete jsonb := '{}'::jsonb;
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
  v_is_fachetado boolean;
  v_fachete_consumption numeric;
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

  -- Resolve material PIDs antes do loop
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

  -- Verifica se o solado é fachetado (uma vez, fora do loop)
  v_is_fachetado := false;
  IF v_sole_product_id IS NOT NULL THEN
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado FROM products WHERE id = v_sole_product_id;
  END IF;

  FOR v_size, v_pairs IN
    SELECT key::integer, value::numeric
      FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+$' AND (value)::numeric > 0
  LOOP
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);

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

    -- Acumula fachete por numeração
    IF v_is_fachetado AND v_lining_pid IS NOT NULL AND v_sole_product_id IS NOT NULL THEN
      SELECT fachete_lining_consumption_dm2 INTO v_fachete_consumption
      FROM sole_technical_specs
      WHERE sole_id = v_sole_product_id AND size = v_size;
      IF COALESCE(v_fachete_consumption, 0) > 0 THEN
        v_acc_fachete := jsonb_set(v_acc_fachete, ARRAY['required'],
          to_jsonb(COALESCE((v_acc_fachete->>'required')::numeric, 0) + v_fachete_consumption * v_pairs));
      END IF;
    END IF;

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

  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object('component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name, 'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty, 'debit_mode', 'hard', 'source', 'primary_sole');
    v_covered_categories := array_append(v_covered_categories, 'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);

    -- Fachete acumulado
    IF v_is_fachetado AND v_lining_pid IS NOT NULL AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0 THEN
      SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.lining_material, p_color, 0, false);
      SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
      v_required := ((v_acc_fachete->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Fachete', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
        'source', 'sole_fachete', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit
      );
    END IF;
  END IF;

  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.upper_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

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

  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_sheet.insole_material, p_color, 0, false);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + v_conv.waste_pct / 100);
    v_result := v_result || jsonb_build_object('component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name, 'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required, 'available', v_resolved.available_qty, 'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft', 'source', 'sheet_per_size', 'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit);
    v_covered_categories := array_append(v_covered_categories, 'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    SELECT name, quantity, category INTO v_acc_name, v_acc_avail, v_row_cat_norm
      FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name, 'color', '', 'consumption_per_unit', ROUND(v_acc_required / NULLIF(v_total_qty, 0), 4), 'required', v_acc_required, 'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_acc_required, 'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm, '')) IN ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard' ELSE 'soft' END, 'source', 'sole_standard_per_size', 'unit', (v_acc_std #>> ARRAY[v_key,'unit']));
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  IF v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT name, quantity, category INTO v_row FROM products WHERE id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.quantity, 'stock_ok', v_row.quantity >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
                ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
                ELSE 'soft' END,
              'source', 'direct_components'
            );
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

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
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category, '')) IN
        ('acessório', 'embalagem', 'cola / químico', 'ferramentas', 'solado', 'componente', 'componentes') THEN 'hard'
        ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category
    );
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  RETURN v_result;
END;
$function$;

-- ========== 20260427240000_mesa-sector-planning.sql ==========
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

-- ========== 20260427260000_guard-manual-stage-transition.sql ==========
-- Enforce sequential sector progression for manually-managed orders.
--
-- Rule (mirrors the wave system's fn_guard_wave_stage_transition):
--   A stage can only transition pendente → em_andamento when the immediately
--   preceding stage (by stage_order) is already 'concluido'.
--   The first stage (no predecessor) is always allowed to start.
--   Completing a stage (→ concluido) is never blocked.

CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_order      integer;
  v_prev_stage_name text;
  v_prev_status     text;
BEGIN
  -- Only enforce pendente → em_andamento transitions
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  -- Find the immediately preceding stage for this order
  SELECT stage_order, stage_name
    INTO v_prev_order, v_prev_stage_name
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_order < NEW.stage_order
  ORDER BY stage_order DESC
  LIMIT 1;

  -- No predecessor → first stage, always allowed
  IF v_prev_order IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_prev_status
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_order = v_prev_order;

  IF v_prev_status IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor anterior "%" não está finalizado (status atual: %).',
      NEW.stage_name, v_prev_stage_name, COALESCE(v_prev_status, 'desconhecido');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_stage_transition ON public.order_stages;
CREATE TRIGGER trg_guard_manual_stage_transition
BEFORE UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_manual_stage_transition();
