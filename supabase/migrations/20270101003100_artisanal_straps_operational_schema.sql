-- =============================================================================
-- Tiras artesanais: esquema operacional canonico
-- Spec: specs/tiras-artesanais-unificacao.md (Reqs. 41-121)
--
-- Esta migration e deliberadamente aditiva, exceto pelo cutover explicito do
-- trigger legado de dupla baixa no final. Fatos historicos nao sao reescritos.
-- Quantidades operacionais usam seis casas ou mais e nunca recebem perda de
-- corte: o rendimento confirmado da receita ja e o rendimento real cadastrado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Escolha de origem no rascunho do item do PV
-- -----------------------------------------------------------------------------

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS strap_sourcing jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS strap_sourcing_revision integer NOT NULL DEFAULT 0;

-- Este e um backfill exclusivamente cadastral. Em PVs aprovados/em producao,
-- qualquer UPDATE de sale_order_items dispara tg_sync_orders_from_sale_order_item,
-- que pode criar/atualizar OPs e reservar/debitar estoque. Isole somente estas
-- duas escritas com a guarda canonica do gatilho e restaure o valor anterior
-- para nao contaminar as migrations seguintes quando o deploy roda em uma
-- unica transacao.
DO $strap_sourcing_backfill$
DECLARE
  v_previous_item_op_sync text := current_setting('app.suppress_item_op_sync', true);
BEGIN
  PERFORM set_config('app.suppress_item_op_sync', '1', true);

  UPDATE public.sale_order_items
     SET strap_sourcing='{}'::jsonb
   WHERE strap_sourcing IS NULL OR jsonb_typeof(strap_sourcing)<>'object';

  UPDATE public.sale_order_items
     SET strap_sourcing_revision=0
   WHERE strap_sourcing_revision IS NULL OR strap_sourcing_revision<0;

  PERFORM set_config(
    'app.suppress_item_op_sync',
    coalesce(v_previous_item_op_sync, ''),
    true
  );
END
$strap_sourcing_backfill$;
ALTER TABLE public.sale_order_items
  ALTER COLUMN strap_sourcing SET DEFAULT '{}'::jsonb,
  ALTER COLUMN strap_sourcing SET NOT NULL,
  ALTER COLUMN strap_sourcing_revision SET DEFAULT 0,
  ALTER COLUMN strap_sourcing_revision SET NOT NULL;

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_strap_sourcing_object_ck;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_strap_sourcing_object_ck
  CHECK (jsonb_typeof(strap_sourcing) = 'object');

COMMENT ON COLUMN public.sale_order_items.strap_sourcing IS
  'Rascunho por technical_strap_line_id. A origem inicia NULL e deve ser internal ou buy_ready antes da confirmacao; a demanda confirmada e normalizada em sale_order_strap_demands.';

-- O motor de reservas legado foi criado com order_id obrigatorio. Reservas de
-- tira/base possuem origem estrutural propria, portanto order_id passa a ser
-- opcional e um CHECK de origem e adicionado depois das tabelas operacionais.
ALTER TABLE public.material_reservations
  ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.material_reservations
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- 2. Calendarios operacionais e capacidade versionada
-- -----------------------------------------------------------------------------

CREATE TABLE public.strap_operational_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  calendar_type text NOT NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  uses_factory_calendar boolean NOT NULL DEFAULT false,
  open_iso_weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_operational_calendars_type_ck
    CHECK (calendar_type IN ('factory', 'contractor', 'banking')),
  CONSTRAINT strap_operational_calendars_status_ck
    CHECK (status IN ('active', 'superseded', 'archived')),
  CONSTRAINT strap_operational_calendars_weekdays_ck CHECK (
    cardinality(open_iso_weekdays) > 0
    AND open_iso_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  ),
  CONSTRAINT strap_operational_calendars_shape_ck CHECK (
    (calendar_type = 'contractor' AND contractor_id IS NOT NULL AND NOT uses_factory_calendar)
    OR (calendar_type = 'factory' AND contractor_id IS NULL AND uses_factory_calendar)
    OR (calendar_type = 'banking' AND contractor_id IS NULL AND NOT uses_factory_calendar)
  )
);

CREATE UNIQUE INDEX strap_operational_calendars_active_executor_uq
  ON public.strap_operational_calendars (calendar_type, contractor_id)
  NULLS NOT DISTINCT
  WHERE status = 'active' AND calendar_type IN ('factory', 'contractor');

CREATE TABLE public.strap_operational_calendar_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES public.strap_operational_calendars(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  is_open boolean NOT NULL,
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_operational_calendar_exceptions_reason_ck CHECK (btrim(reason) <> ''),
  CONSTRAINT strap_operational_calendar_exceptions_date_uq UNIQUE (calendar_id, work_date)
);

CREATE TABLE public.strap_executor_capacities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executor_type text NOT NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  contractor_key uuid GENERATED ALWAYS AS (
    coalesce(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) STORED,
  capacity_m_per_open_day numeric(24,6) NOT NULL,
  calendar_id uuid NOT NULL REFERENCES public.strap_operational_calendars(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_executor_capacities_executor_ck CHECK (
    (executor_type = 'factory' AND contractor_id IS NULL)
    OR (executor_type = 'contractor' AND contractor_id IS NOT NULL)
  ),
  CONSTRAINT strap_executor_capacities_positive_ck CHECK (capacity_m_per_open_day > 0),
  CONSTRAINT strap_executor_capacities_version_ck CHECK (version > 0),
  CONSTRAINT strap_executor_capacities_validity_ck CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT strap_executor_capacities_status_ck CHECK (status IN ('active', 'superseded', 'suspended', 'archived')),
  CONSTRAINT strap_executor_capacities_version_uq UNIQUE (executor_type, contractor_key, version)
);

CREATE UNIQUE INDEX strap_executor_capacities_current_uq
  ON public.strap_executor_capacities (executor_type, contractor_key)
  WHERE status = 'active' AND valid_to IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Demanda confirmada, piso e fila persistente
-- -----------------------------------------------------------------------------

CREATE TABLE public.sale_order_strap_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  sale_order_item_id uuid NOT NULL REFERENCES public.sale_order_items(id) ON DELETE RESTRICT,
  technical_strap_line_id uuid NOT NULL,
  strap_variant_id uuid NOT NULL REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  recipe_version_snapshot integer,
  base_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  source_mode text NOT NULL,
  gross_required_m numeric(24,6) NOT NULL,
  fulfilled_m numeric(24,6) NOT NULL DEFAULT 0,
  cancelled_m numeric(24,6) NOT NULL DEFAULT 0,
  finished_stock_reserved_m numeric(24,6) NOT NULL DEFAULT 0,
  committed_finished_inbound_m numeric(24,6) NOT NULL DEFAULT 0,
  replenishment_required_m numeric(24,6) NOT NULL DEFAULT 0,
  base_required_m numeric(24,9) NOT NULL DEFAULT 0,
  base_reserved_m numeric(24,9) NOT NULL DEFAULT 0,
  base_inbound_allocated_m numeric(24,9) NOT NULL DEFAULT 0,
  base_shortage_m numeric(24,9) NOT NULL DEFAULT 0,
  purchase_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_shortage_stock_unit numeric(24,9) NOT NULL DEFAULT 0,
  coverage_mode text NOT NULL DEFAULT 'pre_netted',
  required_at date NOT NULL,
  main_production_start date NOT NULL,
  strap_start date NOT NULL,
  strap_deadline date NOT NULL,
  base_required_at date,
  base_purchase_by date,
  target_week date,
  schedule_revision integer NOT NULL,
  billing_anchor date NOT NULL,
  billing_year integer NOT NULL,
  billing_month integer NOT NULL,
  billing_fortnight smallint NOT NULL,
  confirmed_yield_snapshot numeric(24,9),
  identity_snapshot jsonb NOT NULL,
  calculation_explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  suspended_from_status text,
  suspension_reason text,
  suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspended_at timestamptz,
  revision integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  supersedes_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_order_strap_demands_source_ck CHECK (source_mode IN ('internal', 'buy_ready')),
  CONSTRAINT sale_order_strap_demands_nonnegative_ck CHECK (
    gross_required_m > 0 AND fulfilled_m >= 0 AND cancelled_m >= 0
    AND fulfilled_m + cancelled_m <= gross_required_m
    AND finished_stock_reserved_m >= 0 AND committed_finished_inbound_m >= 0
    AND replenishment_required_m >= 0 AND base_required_m >= 0
    AND base_reserved_m >= 0 AND base_inbound_allocated_m >= 0 AND base_shortage_m >= 0
    AND purchase_shortage_stock_unit >= 0
  ),
  CONSTRAINT sale_order_strap_demands_internal_shape_ck CHECK (
    (source_mode = 'internal' AND recipe_id IS NOT NULL AND recipe_version_snapshot IS NOT NULL
      AND base_product_id IS NOT NULL AND confirmed_yield_snapshot > 0)
    OR (source_mode = 'buy_ready' AND recipe_id IS NULL AND recipe_version_snapshot IS NULL
      AND base_product_id IS NULL AND confirmed_yield_snapshot IS NULL)
  ),
  CONSTRAINT sale_order_strap_demands_coverage_ck CHECK (coverage_mode = 'pre_netted'),
  CONSTRAINT sale_order_strap_demands_billing_ck CHECK (
    billing_year BETWEEN 2000 AND 2200 AND billing_month BETWEEN 1 AND 12
    AND billing_fortnight IN (1, 2)
  ),
  CONSTRAINT sale_order_strap_demands_status_ck CHECK (
    status IN ('pending', 'allocated', 'planned', 'in_progress', 'partial', 'fulfilled',
               'superseded', 'cancelled', 'error', 'suspended')
  ),
  CONSTRAINT sale_order_strap_demands_revision_ck CHECK (revision > 0 AND schedule_revision >= 0),
  CONSTRAINT sale_order_strap_demands_idempotency_uq UNIQUE (operation_type, idempotency_key),
  CONSTRAINT sale_order_strap_demands_source_revision_uq
    UNIQUE (sale_order_item_id, technical_strap_line_id, revision)
);

CREATE UNIQUE INDEX sale_order_strap_demands_current_line_uq
  ON public.sale_order_strap_demands (sale_order_item_id, technical_strap_line_id)
  WHERE is_current;
CREATE INDEX sale_order_strap_demands_variant_priority_idx
  ON public.sale_order_strap_demands (strap_variant_id, required_at, confirmed_at, id)
  WHERE is_current AND status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error');

CREATE TABLE public.strap_stock_floor_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strap_variant_id uuid NOT NULL REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  base_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  confirmed_yield_snapshot numeric(24,9),
  source_mode text NOT NULL,
  calculation_revision integer NOT NULL,
  required_m numeric(24,6) NOT NULL,
  fulfilled_m numeric(24,6) NOT NULL DEFAULT 0,
  committed_finished_inbound_m numeric(24,6) NOT NULL DEFAULT 0,
  replenishment_required_m numeric(24,6) NOT NULL DEFAULT 0,
  base_required_m numeric(24,9) NOT NULL DEFAULT 0,
  base_reserved_m numeric(24,9) NOT NULL DEFAULT 0,
  base_inbound_allocated_m numeric(24,9) NOT NULL DEFAULT 0,
  base_shortage_m numeric(24,9) NOT NULL DEFAULT 0,
  purchase_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_shortage_stock_unit numeric(24,9) NOT NULL DEFAULT 0,
  coverage_mode text NOT NULL DEFAULT 'pre_netted',
  needed_at date NOT NULL,
  billing_anchor_sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  billing_anchor_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  billing_anchor date NOT NULL,
  billing_year integer NOT NULL,
  billing_month integer NOT NULL,
  billing_fortnight smallint NOT NULL,
  schedule_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  suspended_from_status text,
  suspension_reason text,
  suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspended_at timestamptz,
  revision integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  supersedes_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_stock_floor_source_ck CHECK (source_mode IN ('internal', 'buy_ready')),
  CONSTRAINT strap_stock_floor_nonnegative_ck CHECK (
    required_m >= 0 AND fulfilled_m >= 0 AND fulfilled_m <= required_m
    AND committed_finished_inbound_m >= 0 AND replenishment_required_m >= 0
    AND base_required_m >= 0 AND base_reserved_m >= 0
    AND base_inbound_allocated_m >= 0 AND base_shortage_m >= 0
    AND purchase_shortage_stock_unit >= 0
  ),
  CONSTRAINT strap_stock_floor_internal_shape_ck CHECK (
    (source_mode = 'internal' AND recipe_id IS NOT NULL AND base_product_id IS NOT NULL
      AND confirmed_yield_snapshot > 0)
    OR (source_mode = 'buy_ready' AND recipe_id IS NULL AND base_product_id IS NULL
      AND confirmed_yield_snapshot IS NULL)
  ),
  CONSTRAINT strap_stock_floor_coverage_ck CHECK (coverage_mode = 'pre_netted'),
  CONSTRAINT strap_stock_floor_billing_ck CHECK (
    billing_year BETWEEN 2000 AND 2200 AND billing_month BETWEEN 1 AND 12
    AND billing_fortnight IN (1,2)
  ),
  CONSTRAINT strap_stock_floor_status_ck CHECK (
    status IN ('pending', 'allocated', 'planned', 'in_progress', 'partial', 'fulfilled',
               'superseded', 'cancelled', 'error', 'suspended')
  ),
  CONSTRAINT strap_stock_floor_revision_ck CHECK (revision > 0 AND calculation_revision > 0 AND schedule_revision >= 0),
  CONSTRAINT strap_stock_floor_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE UNIQUE INDEX strap_stock_floor_current_variant_uq
  ON public.strap_stock_floor_contributions (strap_variant_id)
  WHERE is_current;

CREATE TABLE public.strap_demand_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_revision integer NOT NULL,
  schedule_revision integer NOT NULL,
  event_type text NOT NULL,
  event_origin text NOT NULL DEFAULT 'database',
  payload jsonb NOT NULL,
  semantic_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT strap_demand_jobs_source_ck
    CHECK (source_type IN ('sale_order', 'strap_variant', 'stock', 'purchase_order', 'production_batch', 'service_order', 'custody')),
  CONSTRAINT strap_demand_jobs_status_ck
    CHECK (status IN ('queued', 'processing', 'retry', 'completed', 'dead_letter', 'cancelled')),
  CONSTRAINT strap_demand_jobs_attempts_ck
    CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
  CONSTRAINT strap_demand_jobs_revision_ck CHECK (source_revision >= 0 AND schedule_revision >= 0),
  CONSTRAINT strap_demand_jobs_idempotency_uq UNIQUE (idempotency_key)
);

CREATE INDEX strap_demand_jobs_claim_idx
  ON public.strap_demand_jobs (next_attempt_at, created_at, id)
  WHERE status IN ('queued', 'retry');
CREATE INDEX strap_demand_jobs_source_idx
  ON public.strap_demand_jobs (source_type, source_id, source_revision, schedule_revision);

-- Custos comprometidos ficam numa tabela separada. Assim tabelas/views
-- operacionais podem ser lidas por Producao sem expor preco, margem ou custo.
CREATE TABLE public.strap_financial_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  planned_unit_cost numeric(24,9) NOT NULL,
  base_unit_cost_snapshot numeric(24,9),
  transformation_cost_per_m_snapshot numeric(24,9),
  purchase_price_snapshot numeric(24,9),
  composition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_financial_snapshots_origin_xor_ck CHECK (
    num_nonnulls(sale_order_strap_demand_id, stock_floor_contribution_id) = 1
  ),
  CONSTRAINT strap_financial_snapshots_cost_ck CHECK (
    planned_unit_cost >= 0
    AND (base_unit_cost_snapshot IS NULL OR base_unit_cost_snapshot >= 0)
    AND (transformation_cost_per_m_snapshot IS NULL OR transformation_cost_per_m_snapshot >= 0)
    AND (purchase_price_snapshot IS NULL OR purchase_price_snapshot > 0)
  )
);

CREATE UNIQUE INDEX strap_financial_snapshots_demand_uq
  ON public.strap_financial_snapshots (sale_order_strap_demand_id)
  WHERE sale_order_strap_demand_id IS NOT NULL;
CREATE UNIQUE INDEX strap_financial_snapshots_floor_uq
  ON public.strap_financial_snapshots (stock_floor_contribution_id)
  WHERE stock_floor_contribution_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Contribuicoes pre-netted para o motor geral de OCs e recebimentos
-- -----------------------------------------------------------------------------

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_terms_structured jsonb;
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_payment_terms_structured_shape_ck;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_payment_terms_structured_shape_ck CHECK (
    payment_terms_structured IS NULL OR jsonb_typeof(payment_terms_structured)='array');

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS billing_year integer,
  ADD COLUMN IF NOT EXISTS billing_month integer,
  ADD COLUMN IF NOT EXISTS billing_fortnight smallint,
  ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_condition_snapshot text,
  ADD COLUMN IF NOT EXISTS payment_terms_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS supplier_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS delivery_company_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS commercial_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commercial_digest text,
  ADD COLUMN IF NOT EXISTS approval_preflight_token uuid,
  ADD COLUMN IF NOT EXISTS approval_preflight_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_preflight_actor_name text,
  ADD COLUMN IF NOT EXISTS approval_preflight_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_preflight_revision integer,
  ADD COLUMN IF NOT EXISTS approval_preflight_digest text,
  ADD COLUMN IF NOT EXISTS approved_by_name_snapshot text,
  ADD COLUMN IF NOT EXISTS snapshot_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_storage_path text,
  ADD COLUMN IF NOT EXISTS pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS suspended_from_status text,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS strap_manual_purchase_by_date date,
  ADD COLUMN IF NOT EXISTS strap_manual_promised_date date,
  ADD COLUMN IF NOT EXISTS strap_manual_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS strap_manual_adjusted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS strap_manual_adjusted_at timestamptz;

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS client_request_payload_hash text,
  ADD COLUMN IF NOT EXISTS client_request_item_count integer;
ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_client_request_payload_ck;
ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_client_request_payload_ck CHECK (
    (client_request_payload_hash IS NULL AND client_request_item_count IS NULL)
    OR (client_request_payload_hash ~ '^[0-9a-f]{64}$'
      AND client_request_item_count IS NOT NULL AND client_request_item_count>0)
  );

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type CHECK (source_type = ANY (ARRAY[
    'manual'::text, 'mrp'::text, 'per_pv'::text, 'manual_avulsa'::text,
    'auto_pv'::text, 'auto_op'::text, 'rop'::text, 'strap_demand'::text
  ]));

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_strap_billing_bucket_ck;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_strap_billing_bucket_ck CHECK (
    (billing_year IS NULL AND billing_month IS NULL AND billing_fortnight IS NULL)
    OR (billing_year BETWEEN 2000 AND 2200 AND billing_month BETWEEN 1 AND 12
      AND billing_fortnight IN (1,2))
  );

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_strap_payment_terms_shape_ck;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_strap_payment_terms_shape_ck CHECK (
    payment_terms_snapshot IS NULL OR jsonb_typeof(payment_terms_snapshot)='array'
  );

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_strap_commercial_snapshot_ck;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_strap_commercial_snapshot_ck CHECK (
    commercial_revision >= 0
    AND (supplier_snapshot IS NULL OR jsonb_typeof(supplier_snapshot)='object')
    AND (delivery_company_snapshot IS NULL OR jsonb_typeof(delivery_company_snapshot)='object')
    AND (commercial_digest IS NULL OR commercial_digest ~ '^[0-9a-f]{64}$')
    AND (approval_preflight_digest IS NULL OR approval_preflight_digest ~ '^[0-9a-f]{64}$')
    AND (approval_preflight_revision IS NULL OR approval_preflight_revision >= 0)
    AND (
      num_nonnulls(approval_preflight_token,approval_preflight_by,approval_preflight_actor_name,
        approval_preflight_at,approval_preflight_revision,approval_preflight_digest)=0
      OR num_nonnulls(approval_preflight_token,approval_preflight_by,approval_preflight_actor_name,
        approval_preflight_at,approval_preflight_revision,approval_preflight_digest)=6
    )
  );

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS stock_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS purchase_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS conversion_rate_snapshot numeric(24,9),
  ADD COLUMN IF NOT EXISTS min_order_quantity_snapshot numeric(24,9),
  ADD COLUMN IF NOT EXISTS purchase_multiple_snapshot numeric(24,9),
  ADD COLUMN IF NOT EXISTS preparation_days_snapshot integer,
  ADD COLUMN IF NOT EXISTS needed_at date,
  ADD COLUMN IF NOT EXISTS strap_manual_quantity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS strap_manual_needed_at date,
  ADD COLUMN IF NOT EXISTS strap_manual_adjustment_reason text,
  ADD COLUMN IF NOT EXISTS strap_manual_adjusted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS strap_manual_adjusted_at timestamptz;

CREATE INDEX IF NOT EXISTS purchase_orders_strap_open_bucket_idx
  ON public.purchase_orders (supplier_id, billing_year, billing_month, billing_fortnight)
  WHERE source_type = 'strap_demand' AND status IN ('draft', 'pending', 'Pendente')
    AND snapshot_locked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_strap_single_open_bucket_uq
  ON public.purchase_orders (
    coalesce(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),
    billing_year,billing_month,billing_fortnight,provisional)
  WHERE source_type='strap_demand' AND status IN ('draft','pending','Pendente')
    AND snapshot_locked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.purchase_demand_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE RESTRICT,
  sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  strap_stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  purchase_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  superseded_purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  superseded_purchase_order_item_id uuid,
  coverage_mode text NOT NULL DEFAULT 'pre_netted',
  required_quantity_stock_unit numeric(24,9) NOT NULL,
  committed_quantity_stock_unit numeric(24,9) NOT NULL DEFAULT 0,
  accepted_quantity_stock_unit numeric(24,9) NOT NULL DEFAULT 0,
  rejected_quantity_stock_unit numeric(24,9) NOT NULL DEFAULT 0,
  needed_at date NOT NULL,
  expected_at date,
  billing_anchor date NOT NULL,
  billing_year integer NOT NULL,
  billing_month integer NOT NULL,
  billing_fortnight smallint NOT NULL,
  stock_unit text NOT NULL,
  purchase_unit_snapshot text NOT NULL,
  conversion_rate_snapshot numeric(24,9) NOT NULL,
  min_order_quantity_snapshot numeric(24,9) NOT NULL,
  purchase_multiple_snapshot numeric(24,9) NOT NULL,
  purchase_price_snapshot numeric(24,9) NOT NULL,
  supplier_lead_time_days_snapshot integer NOT NULL DEFAULT 15,
  material_preparation_days_snapshot integer NOT NULL DEFAULT 2,
  payment_condition_snapshot text,
  payment_terms_snapshot jsonb,
  provisional boolean NOT NULL DEFAULT false,
  contribution_revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'proposed',
  suspended_from_status text,
  suspension_reason text,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_demand_contributions_source_ck
    CHECK (source_type IN ('pv_automatico', 'strap_stock_floor')),
  CONSTRAINT purchase_demand_contributions_origin_xor_ck CHECK (
    (source_type = 'pv_automatico'
      AND sale_order_id IS NOT NULL AND sale_order_item_id IS NOT NULL
      AND sale_order_strap_demand_id IS NOT NULL
      AND strap_stock_floor_contribution_id IS NULL)
    OR (source_type = 'strap_stock_floor'
      AND sale_order_id IS NULL AND sale_order_item_id IS NULL
      AND sale_order_strap_demand_id IS NULL
      AND strap_stock_floor_contribution_id IS NOT NULL)
  ),
  CONSTRAINT purchase_demand_contributions_pre_netted_ck CHECK (coverage_mode = 'pre_netted'),
  CONSTRAINT purchase_demand_contributions_quantity_ck CHECK (
    required_quantity_stock_unit >= 0 AND committed_quantity_stock_unit >= 0
    AND accepted_quantity_stock_unit >= 0 AND rejected_quantity_stock_unit >= 0
    AND accepted_quantity_stock_unit <= committed_quantity_stock_unit
  ),
  CONSTRAINT purchase_demand_contributions_conversion_ck CHECK (
    conversion_rate_snapshot >= 0 AND min_order_quantity_snapshot >= 0
    AND purchase_multiple_snapshot >= 0 AND purchase_price_snapshot >= 0
    AND (
      status = 'suspended'
      OR (conversion_rate_snapshot > 0 AND min_order_quantity_snapshot > 0
        AND purchase_multiple_snapshot > 0 AND purchase_price_snapshot > 0)
    )
  ),
  CONSTRAINT purchase_demand_contributions_dates_ck CHECK (
    billing_year BETWEEN 2000 AND 2200 AND billing_month BETWEEN 1 AND 12
    AND billing_fortnight IN (1,2)
    AND supplier_lead_time_days_snapshot >= 0 AND material_preparation_days_snapshot >= 0
  ),
  CONSTRAINT purchase_demand_contributions_revision_ck CHECK (contribution_revision > 0),
  CONSTRAINT purchase_demand_contributions_status_ck CHECK (
    status IN ('proposed', 'awaiting_approval', 'approved', 'sent', 'partial', 'received',
               'cancelled', 'superseded', 'suspended')
  ),
  CONSTRAINT purchase_demand_contributions_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

-- Snapshot comercial incompleto deve continuar visivel em Provisoria/
-- Aguardando aprovacao. NULL/zero aqui e marcador de bloqueio, nunca default
-- inventado; estados comprometidos continuam exigindo snapshot integral.
ALTER TABLE public.purchase_demand_contributions
  ALTER COLUMN purchase_unit_snapshot DROP NOT NULL;
ALTER TABLE public.purchase_demand_contributions
  DROP CONSTRAINT IF EXISTS purchase_demand_contributions_conversion_ck;
ALTER TABLE public.purchase_demand_contributions
  ADD CONSTRAINT purchase_demand_contributions_conversion_ck CHECK (
    conversion_rate_snapshot >= 0 AND min_order_quantity_snapshot >= 0
    AND purchase_multiple_snapshot >= 0 AND purchase_price_snapshot >= 0
    AND (
      status IN ('proposed','awaiting_approval','suspended','cancelled','superseded')
      OR (purchase_unit_snapshot IS NOT NULL AND conversion_rate_snapshot > 0
        AND min_order_quantity_snapshot > 0 AND purchase_multiple_snapshot > 0
        AND purchase_price_snapshot > 0)
    )
  );

CREATE UNIQUE INDEX purchase_demand_contributions_open_demand_product_uq
  ON public.purchase_demand_contributions (sale_order_strap_demand_id, purchase_product_id)
  WHERE sale_order_strap_demand_id IS NOT NULL
    AND status IN ('proposed', 'awaiting_approval', 'suspended');
CREATE UNIQUE INDEX purchase_demand_contributions_open_floor_product_uq
  ON public.purchase_demand_contributions (strap_stock_floor_contribution_id, purchase_product_id)
  WHERE strap_stock_floor_contribution_id IS NOT NULL
    AND status IN ('proposed', 'awaiting_approval', 'suspended');
CREATE UNIQUE INDEX purchase_demand_contributions_demand_revision_uq
  ON public.purchase_demand_contributions (sale_order_strap_demand_id, purchase_product_id, contribution_revision)
  WHERE sale_order_strap_demand_id IS NOT NULL;
CREATE UNIQUE INDEX purchase_demand_contributions_floor_revision_uq
  ON public.purchase_demand_contributions (strap_stock_floor_contribution_id, purchase_product_id, contribution_revision)
  WHERE strap_stock_floor_contribution_id IS NOT NULL;
CREATE INDEX purchase_demand_contributions_builder_idx
  ON public.purchase_demand_contributions (supplier_id, billing_year, billing_month, billing_fortnight, needed_at)
  WHERE status IN ('proposed', 'suspended');

CREATE TABLE public.purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  invoice_key text,
  invoice_issue_date date NOT NULL,
  received_at timestamptz NOT NULL,
  payment_condition_snapshot text,
  payment_terms_structured_snapshot jsonb,
  installments_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'confirmed',
  confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operation_type text NOT NULL DEFAULT 'strap_purchase_receipt',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipts_invoice_ck CHECK (
    nullif(btrim(invoice_number),'') IS NOT NULL
    AND (invoice_key IS NULL OR nullif(btrim(invoice_key),'') IS NOT NULL)
  ),
  CONSTRAINT purchase_receipts_installments_ck CHECK (
    jsonb_typeof(installments_snapshot) = 'array'
    AND (payment_terms_structured_snapshot IS NULL
      OR jsonb_typeof(payment_terms_structured_snapshot)='array')
  ),
  CONSTRAINT purchase_receipts_status_ck CHECK (status IN ('confirmed','cancelled','reversed')),
  CONSTRAINT purchase_receipts_idempotency_uq UNIQUE (operation_type,idempotency_key)
);

CREATE TABLE public.strap_purchase_cashflow_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  purchase_receipt_id uuid REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT,
  layer text NOT NULL,
  installment_number integer NOT NULL,
  days_offset integer NOT NULL,
  percentage numeric(12,8) NOT NULL,
  due_date date NOT NULL,
  original_amount numeric(24,9) NOT NULL,
  remaining_amount numeric(24,9) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_purchase_cashflow_layer_ck CHECK (
    layer IN ('forecast','committed_unbilled','invoiced')),
  CONSTRAINT strap_purchase_cashflow_values_ck CHECK (
    installment_number>0 AND days_offset>=0 AND percentage>0
    AND original_amount>=0 AND remaining_amount>=0 AND remaining_amount<=original_amount),
  CONSTRAINT strap_purchase_cashflow_status_ck CHECK (status IN ('open','converted','cancelled')),
  CONSTRAINT strap_purchase_cashflow_receipt_shape_ck CHECK (
    (layer='invoiced' AND purchase_receipt_id IS NOT NULL)
    OR (layer<>'invoiced' AND purchase_receipt_id IS NULL))
);
CREATE UNIQUE INDEX strap_purchase_cashflow_open_layer_uq
  ON public.strap_purchase_cashflow_installments(purchase_order_id,layer,installment_number)
  WHERE purchase_receipt_id IS NULL;
CREATE UNIQUE INDEX strap_purchase_cashflow_receipt_uq
  ON public.strap_purchase_cashflow_installments(purchase_receipt_id,installment_number)
  WHERE purchase_receipt_id IS NOT NULL;

CREATE TABLE public.purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id uuid NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  delivered_quantity numeric(24,9) NOT NULL,
  accepted_quantity numeric(24,9) NOT NULL,
  rejected_quantity numeric(24,9) NOT NULL,
  accepted_stock_quantity numeric(24,9) NOT NULL,
  conversion_rate_snapshot numeric(24,9) NOT NULL,
  actual_unit_price_purchase numeric(24,9) NOT NULL,
  effective_unit_cost_stock numeric(24,9) NOT NULL,
  rejection_reason text,
  rejection_disposition text,
  document_number text,
  received_at timestamptz NOT NULL,
  received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operation_type text NOT NULL DEFAULT 'purchase_receipt',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipt_items_quantity_ck CHECK (
    delivered_quantity > 0 AND accepted_quantity >= 0 AND rejected_quantity >= 0
    AND delivered_quantity = accepted_quantity + rejected_quantity
    AND accepted_stock_quantity >= 0 AND conversion_rate_snapshot > 0
    AND actual_unit_price_purchase > 0 AND effective_unit_cost_stock >= 0
  ),
  CONSTRAINT purchase_receipt_items_rejection_ck CHECK (
    rejected_quantity = 0 OR (nullif(btrim(rejection_reason), '') IS NOT NULL
      AND rejection_disposition IN ('return', 'replace', 'scrap', 'credit_note', 'pending'))
  ),
  CONSTRAINT purchase_receipt_items_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE TABLE public.purchase_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_item_id uuid NOT NULL REFERENCES public.purchase_receipt_items(id) ON DELETE RESTRICT,
  purchase_demand_contribution_id uuid NOT NULL REFERENCES public.purchase_demand_contributions(id) ON DELETE RESTRICT,
  accepted_stock_quantity numeric(24,9) NOT NULL DEFAULT 0,
  rejected_stock_quantity numeric(24,9) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipt_allocations_quantity_ck
    CHECK (accepted_stock_quantity >= 0 AND rejected_stock_quantity >= 0
      AND accepted_stock_quantity + rejected_stock_quantity > 0),
  CONSTRAINT purchase_receipt_allocations_uq
    UNIQUE (purchase_receipt_item_id, purchase_demand_contribution_id)
);

-- -----------------------------------------------------------------------------
-- 5. Lotes, grade global de capacidade e recebimentos de transformacao
-- -----------------------------------------------------------------------------

CREATE TABLE public.strap_production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  target_week date NOT NULL,
  executor_type text NOT NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  contractor_key uuid GENERATED ALWAYS AS (
    coalesce(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) STORED,
  production_start_date date,
  deadline date NOT NULL,
  schedule_revision integer NOT NULL,
  capacity_profile_id uuid NOT NULL REFERENCES public.strap_executor_capacities(id) ON DELETE RESTRICT,
  capacity_m_per_open_day_snapshot numeric(24,6) NOT NULL,
  calendar_exception boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  suspended_from_status text,
  suspension_reason text,
  suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspended_at timestamptz,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_batches_executor_ck CHECK (
    (executor_type = 'factory' AND contractor_id IS NULL)
    OR (executor_type = 'contractor' AND contractor_id IS NOT NULL)
  ),
  CONSTRAINT strap_production_batches_capacity_ck CHECK (capacity_m_per_open_day_snapshot > 0),
  CONSTRAINT strap_production_batches_schedule_ck CHECK (schedule_revision >= 0),
  CONSTRAINT strap_production_batches_dates_ck CHECK (
    target_week = date_trunc('week', target_week)::date
    AND (production_start_date IS NULL OR production_start_date <= deadline)
  ),
  CONSTRAINT strap_production_batches_status_ck CHECK (
    status IN ('draft', 'planned', 'in_progress', 'partial', 'completed', 'cancelled', 'suspended')
  ),
  CONSTRAINT strap_production_batches_lifecycle_ck CHECK (
    (started_at IS NULL OR status IN ('in_progress', 'partial', 'completed', 'suspended'))
    AND (completed_at IS NULL OR status = 'completed')
  )
);

CREATE UNIQUE INDEX strap_production_batches_open_bucket_uq
  ON public.strap_production_batches (target_week, executor_type, contractor_key)
  WHERE status IN ('draft', 'planned', 'suspended') AND started_at IS NULL;

CREATE TABLE public.strap_production_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.strap_production_batches(id) ON DELETE RESTRICT,
  strap_variant_id uuid NOT NULL REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  recipe_id uuid NOT NULL REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  recipe_version_snapshot integer NOT NULL,
  base_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  confirmed_yield_snapshot numeric(24,9) NOT NULL,
  planned_finished_m numeric(24,6) NOT NULL DEFAULT 0,
  planned_base_m numeric(24,9) NOT NULL DEFAULT 0,
  scheduled_m numeric(24,6) NOT NULL DEFAULT 0,
  unscheduled_m numeric(24,6) NOT NULL DEFAULT 0,
  delivered_m numeric(24,6) NOT NULL DEFAULT 0,
  approved_m numeric(24,6) NOT NULL DEFAULT 0,
  rejected_m numeric(24,6) NOT NULL DEFAULT 0,
  base_consumed_m numeric(24,9) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_batch_items_yield_ck CHECK (confirmed_yield_snapshot > 0),
  CONSTRAINT strap_production_batch_items_nonnegative_ck CHECK (
    planned_finished_m >= 0 AND planned_base_m >= 0 AND scheduled_m >= 0
    AND unscheduled_m >= 0 AND delivered_m >= 0 AND approved_m >= 0
    AND rejected_m >= 0 AND base_consumed_m >= 0
    AND delivered_m = approved_m + rejected_m
  ),
  CONSTRAINT strap_production_batch_items_status_ck CHECK (
    status IN ('draft', 'planned', 'in_progress', 'partial', 'completed', 'cancelled', 'suspended')
  ),
  CONSTRAINT strap_production_batch_items_identity_uq UNIQUE (batch_id, strap_variant_id, recipe_id)
);

CREATE TABLE public.strap_production_batch_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_item_id uuid NOT NULL REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  service_order_item_id uuid REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  planned_m numeric(24,6) NOT NULL,
  allocated_m numeric(24,6) NOT NULL DEFAULT 0,
  delivered_m numeric(24,6) NOT NULL DEFAULT 0,
  priority integer NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_batch_contributions_origin_xor_ck CHECK (
    num_nonnulls(sale_order_strap_demand_id, stock_floor_contribution_id) = 1
  ),
  CONSTRAINT strap_production_batch_contributions_quantity_ck CHECK (
    planned_m >= 0 AND allocated_m >= 0 AND delivered_m >= 0
    AND delivered_m <= planned_m
  ),
  CONSTRAINT strap_production_batch_contributions_priority_ck CHECK (priority >= 0),
  CONSTRAINT strap_production_batch_contributions_status_ck CHECK (
    status IN ('planned', 'in_progress', 'partial', 'fulfilled', 'cancelled', 'superseded', 'suspended')
  )
);

CREATE UNIQUE INDEX strap_batch_contributions_open_demand_uq
  ON public.strap_production_batch_contributions (sale_order_strap_demand_id)
  WHERE sale_order_strap_demand_id IS NOT NULL
    AND status IN ('planned', 'suspended');
CREATE UNIQUE INDEX strap_batch_contributions_open_floor_uq
  ON public.strap_production_batch_contributions (stock_floor_contribution_id)
  WHERE stock_floor_contribution_id IS NOT NULL
    AND status IN ('planned', 'suspended');

CREATE TABLE public.strap_executor_daily_capacity_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executor_type text NOT NULL,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  contractor_key uuid GENERATED ALWAYS AS (
    coalesce(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) STORED,
  work_date date NOT NULL,
  capacity_profile_id uuid NOT NULL REFERENCES public.strap_executor_capacities(id) ON DELETE RESTRICT,
  capacity_m_snapshot numeric(24,6) NOT NULL,
  schedule_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_capacity_buckets_executor_ck CHECK (
    (executor_type = 'factory' AND contractor_id IS NULL)
    OR (executor_type = 'contractor' AND contractor_id IS NOT NULL)
  ),
  CONSTRAINT strap_capacity_buckets_capacity_ck CHECK (capacity_m_snapshot > 0),
  CONSTRAINT strap_capacity_buckets_revision_ck CHECK (schedule_revision >= 0),
  CONSTRAINT strap_capacity_buckets_status_ck CHECK (status IN ('active', 'superseded', 'cancelled'))
);

CREATE UNIQUE INDEX strap_capacity_buckets_one_active_executor_day_uq
  ON public.strap_executor_daily_capacity_buckets (executor_type, contractor_key, work_date)
  WHERE status = 'active';

CREATE TABLE public.strap_executor_daily_capacity_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_bucket_id uuid NOT NULL REFERENCES public.strap_executor_daily_capacity_buckets(id) ON DELETE RESTRICT,
  batch_item_id uuid NOT NULL REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  scheduled_m numeric(24,6) NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_capacity_allocations_quantity_ck CHECK (scheduled_m > 0),
  CONSTRAINT strap_capacity_allocations_status_ck CHECK (status IN ('active', 'superseded', 'cancelled'))
);

CREATE UNIQUE INDEX strap_capacity_allocations_active_item_uq
  ON public.strap_executor_daily_capacity_allocations (capacity_bucket_id, batch_item_id)
  WHERE status = 'active';

CREATE TABLE public.strap_production_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_item_id uuid REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  service_order_item_id uuid REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  strap_variant_id uuid NOT NULL REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  recipe_id uuid NOT NULL REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  base_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  operation_type text NOT NULL DEFAULT 'strap_production_receipt',
  delivered_m numeric(24,6) NOT NULL,
  approved_m numeric(24,6) NOT NULL,
  rejected_m numeric(24,6) NOT NULL,
  base_consumed_m numeric(24,9) NOT NULL,
  base_returned_m numeric(24,9) NOT NULL DEFAULT 0,
  base_lost_m numeric(24,9) NOT NULL DEFAULT 0,
  balance_in_custody_snapshot numeric(24,9),
  document_number text,
  notes text,
  occurred_at timestamptz NOT NULL,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_receipts_batch_required_ck CHECK (batch_item_id IS NOT NULL),
  CONSTRAINT strap_production_receipts_quantity_ck CHECK (
    delivered_m > 0 AND approved_m >= 0 AND rejected_m >= 0
    AND delivered_m = approved_m + rejected_m
    AND base_consumed_m >= 0 AND base_returned_m >= 0 AND base_lost_m >= 0
    AND (balance_in_custody_snapshot IS NULL OR balance_in_custody_snapshot >= 0)
  ),
  CONSTRAINT strap_production_receipts_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE TABLE public.strap_production_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_receipt_id uuid NOT NULL REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  batch_contribution_id uuid NOT NULL REFERENCES public.strap_production_batch_contributions(id) ON DELETE RESTRICT,
  approved_m numeric(24,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_receipt_allocations_quantity_ck CHECK (approved_m > 0),
  CONSTRAINT strap_production_receipt_allocations_uq
    UNIQUE (production_receipt_id, batch_contribution_id)
);

CREATE TABLE public.strap_pending_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_type text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  production_receipt_id uuid REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  expected_quantity numeric(24,9) NOT NULL,
  posted_quantity numeric(24,9) NOT NULL,
  deficit_quantity numeric(24,9) GENERATED ALWAYS AS (expected_quantity - posted_quantity) STORED,
  status text NOT NULL DEFAULT 'pending',
  resolution_reason text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_pending_reconciliations_type_ck
    CHECK (reconciliation_type IN ('base_stock_deficit', 'finished_stock_variance',
      'custody_variance','rejected_base_review')),
  CONSTRAINT strap_pending_reconciliations_quantity_ck CHECK (
    expected_quantity > 0 AND posted_quantity >= 0 AND posted_quantity < expected_quantity
  ),
  CONSTRAINT strap_pending_reconciliations_status_ck CHECK (status IN ('pending', 'resolved', 'written_off')),
  CONSTRAINT strap_pending_reconciliations_resolution_ck CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
      AND nullif(btrim(resolution_reason), '') IS NOT NULL)
  )
);

-- -----------------------------------------------------------------------------
-- 6. OS externa, custodia, claims, competencias e ciclos financeiros
-- -----------------------------------------------------------------------------

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS financial_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT;

ALTER TABLE public.service_order_items
  ADD COLUMN IF NOT EXISTS strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_batch_item_id uuid REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS base_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS finished_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipe_version_snapshot integer,
  ADD COLUMN IF NOT EXISTS confirmed_yield_snapshot numeric(24,9),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_from_status text,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

ALTER TABLE public.service_order_items
  DROP CONSTRAINT IF EXISTS service_order_items_strap_origin_xor_ck;
ALTER TABLE public.service_order_items
  ADD CONSTRAINT service_order_items_strap_origin_xor_ck CHECK (
    strap_variant_id IS NULL
    OR num_nonnulls(sale_order_strap_demand_id, strap_stock_floor_contribution_id) = 1
  );

CREATE UNIQUE INDEX service_order_items_open_strap_demand_uq
  ON public.service_order_items (sale_order_strap_demand_id)
  WHERE sale_order_strap_demand_id IS NOT NULL
    AND line_status NOT IN ('Entregue', 'Cancelado');
CREATE UNIQUE INDEX service_order_items_open_strap_floor_uq
  ON public.service_order_items (strap_stock_floor_contribution_id)
  WHERE strap_stock_floor_contribution_id IS NOT NULL
    AND line_status NOT IN ('Entregue', 'Cancelado');

CREATE TABLE public.contractor_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  frequency text NOT NULL,
  cutoff_iso_weekday smallint NOT NULL,
  cutoff_day_of_month smallint,
  payment_iso_weekday smallint,
  payment_day_of_month smallint,
  payment_offset_days integer,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  bank_calendar_id uuid NOT NULL REFERENCES public.strap_operational_calendars(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_schedules_frequency_ck CHECK (frequency IN ('weekly', 'biweekly')),
  CONSTRAINT contractor_payment_schedules_cutoff_ck CHECK (
    cutoff_iso_weekday BETWEEN 1 AND 7
    AND ((frequency='weekly' AND cutoff_day_of_month IS NULL)
      OR (frequency='biweekly' AND cutoff_day_of_month BETWEEN 1 AND 27))
  ),
  CONSTRAINT contractor_payment_schedules_payment_rule_ck CHECK (
    num_nonnulls(payment_iso_weekday, payment_day_of_month, payment_offset_days) = 1
    AND (payment_iso_weekday IS NULL OR payment_iso_weekday BETWEEN 1 AND 7)
    AND (payment_day_of_month IS NULL OR payment_day_of_month BETWEEN 1 AND 31)
    AND (payment_offset_days IS NULL OR payment_offset_days >= 0)
  ),
  CONSTRAINT contractor_payment_schedules_version_ck CHECK (version > 0),
  CONSTRAINT contractor_payment_schedules_validity_ck CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT contractor_payment_schedules_status_ck CHECK (status IN ('active', 'superseded', 'suspended', 'archived')),
  CONSTRAINT contractor_payment_schedules_version_uq UNIQUE (contractor_id, version)
);

CREATE UNIQUE INDEX contractor_payment_schedules_current_uq
  ON public.contractor_payment_schedules (contractor_id)
  WHERE status = 'active' AND valid_to IS NULL;

CREATE TABLE public.contractor_payment_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  schedule_version_id uuid NOT NULL REFERENCES public.contractor_payment_schedules(id) ON DELETE RESTRICT,
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  payment_date date NOT NULL,
  gross_amount numeric(24,9) NOT NULL DEFAULT 0,
  discount_amount numeric(24,9) NOT NULL DEFAULT 0,
  carried_credit_in numeric(24,9) NOT NULL DEFAULT 0,
  carried_credit_out numeric(24,9) NOT NULL DEFAULT 0,
  net_amount numeric(24,9) NOT NULL DEFAULT 0,
  accounts_payable_id uuid REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open',
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  payment_date_snapshot date,
  payment_method_snapshot text,
  payment_idempotency_key text,
  payment_payload_hash text,
  operation_type text,
  idempotency_key text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_cycles_dates_ck CHECK (cycle_end >= cycle_start AND payment_date >= cycle_end),
  CONSTRAINT contractor_payment_cycles_amounts_ck CHECK (
    gross_amount >= 0 AND discount_amount >= 0 AND carried_credit_in >= 0
    AND carried_credit_out >= 0 AND net_amount >= 0
  ),
  CONSTRAINT contractor_payment_cycles_status_ck CHECK (status IN ('open', 'closed', 'paid', 'cancelled')),
  CONSTRAINT contractor_payment_cycles_close_ck CHECK (
    (status = 'open' AND closed_at IS NULL AND accounts_payable_id IS NULL)
    OR (status IN ('closed', 'paid') AND closed_at IS NOT NULL AND closed_by IS NOT NULL
      AND (net_amount = 0 OR accounts_payable_id IS NOT NULL))
    OR status = 'cancelled'
  ),
  CONSTRAINT contractor_payment_cycles_payment_ck CHECK (
    (status<>'paid' AND paid_by IS NULL AND paid_at IS NULL
      AND payment_date_snapshot IS NULL AND payment_idempotency_key IS NULL
      AND payment_payload_hash IS NULL)
    OR (status='paid' AND paid_by IS NOT NULL AND paid_at IS NOT NULL
      AND payment_date_snapshot IS NOT NULL AND nullif(btrim(payment_idempotency_key),'') IS NOT NULL
      AND payment_payload_hash ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT contractor_payment_cycles_identity_uq
    UNIQUE (contractor_id, schedule_version_id, cycle_start, cycle_end),
  CONSTRAINT contractor_payment_cycles_idempotency_uq UNIQUE (operation_type, idempotency_key)
);
CREATE UNIQUE INDEX contractor_payment_cycles_payment_idempotency_uq
  ON public.contractor_payment_cycles(payment_idempotency_key)
  WHERE payment_idempotency_key IS NOT NULL;

CREATE TABLE public.contractor_loss_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE RESTRICT,
  service_order_item_id uuid NOT NULL REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  production_receipt_id uuid REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  base_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  lost_quantity numeric(24,9) NOT NULL,
  base_unit_cost_snapshot numeric(24,9) NOT NULL,
  claim_amount numeric(24,9) GENERATED ALWAYS AS (lost_quantity * base_unit_cost_snapshot) STORED,
  responsible_party text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  applied_cycle_id uuid REFERENCES public.contractor_payment_cycles(id) ON DELETE RESTRICT,
  operation_type text NOT NULL DEFAULT 'contractor_loss_claim',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_loss_claims_quantity_ck CHECK (lost_quantity > 0 AND base_unit_cost_snapshot >= 0),
  CONSTRAINT contractor_loss_claims_responsible_ck CHECK (responsible_party IN ('contractor', 'company', 'shared', 'under_review')),
  CONSTRAINT contractor_loss_claims_reason_ck CHECK (btrim(reason) <> ''),
  CONSTRAINT contractor_loss_claims_status_ck CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  CONSTRAINT contractor_loss_claims_decision_ck CHECK (
    (status = 'pending' AND approved_at IS NULL AND rejected_at IS NULL)
    OR (status IN ('approved', 'applied') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status = 'rejected' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL)
  ),
  CONSTRAINT contractor_loss_claims_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE TABLE public.contractor_material_custody_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE RESTRICT,
  service_order_item_id uuid NOT NULL REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  base_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL,
  quantity numeric(24,9) NOT NULL,
  base_unit_cost_snapshot numeric(24,9) NOT NULL,
  contractor_loss_claim_id uuid REFERENCES public.contractor_loss_claims(id) ON DELETE RESTRICT,
  production_receipt_id uuid REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  document_number text,
  reason text,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operation_type text NOT NULL DEFAULT 'custody_movement',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_custody_movements_type_ck
    CHECK (movement_type IN ('sent', 'consumed', 'returned', 'lost', 'adjusted')),
  CONSTRAINT contractor_custody_movements_quantity_ck CHECK (
    (movement_type = 'adjusted' AND quantity <> 0)
    OR (movement_type <> 'adjusted' AND quantity > 0)
  ),
  CONSTRAINT contractor_custody_movements_cost_ck CHECK (base_unit_cost_snapshot >= 0),
  CONSTRAINT contractor_custody_movements_claim_ck CHECK (
    (movement_type = 'lost' AND contractor_loss_claim_id IS NOT NULL)
    OR (movement_type <> 'lost' AND contractor_loss_claim_id IS NULL)
  ),
  CONSTRAINT contractor_custody_movements_adjustment_ck CHECK (
    movement_type <> 'adjusted'
    OR (nullif(btrim(reason), '') IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT contractor_custody_movements_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE TABLE public.contractor_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  schedule_version_id uuid NOT NULL REFERENCES public.contractor_payment_schedules(id) ON DELETE RESTRICT,
  payment_cycle_id uuid REFERENCES public.contractor_payment_cycles(id) ON DELETE RESTRICT,
  production_receipt_id uuid NOT NULL REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE RESTRICT,
  service_order_item_id uuid NOT NULL REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  accepted_m numeric(24,6) NOT NULL,
  transformation_cost_per_m_snapshot numeric(24,9) NOT NULL,
  gross_amount numeric(24,9) GENERATED ALWAYS AS (accepted_m * transformation_cost_per_m_snapshot) STORED,
  accrual_date date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  operation_type text NOT NULL DEFAULT 'contractor_accrual',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_accruals_quantity_ck CHECK (accepted_m > 0 AND transformation_cost_per_m_snapshot >= 0),
  CONSTRAINT contractor_accruals_status_ck CHECK (status IN ('open', 'applied', 'reversed')),
  CONSTRAINT contractor_accruals_receipt_uq UNIQUE (production_receipt_id),
  CONSTRAINT contractor_accruals_idempotency_uq UNIQUE (operation_type, idempotency_key)
);

CREATE TABLE public.contractor_payment_cycle_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_cycle_id uuid NOT NULL REFERENCES public.contractor_payment_cycles(id) ON DELETE RESTRICT,
  entry_type text NOT NULL,
  contractor_accrual_id uuid REFERENCES public.contractor_accruals(id) ON DELETE RESTRICT,
  contractor_loss_claim_id uuid REFERENCES public.contractor_loss_claims(id) ON DELETE RESTRICT,
  amount numeric(24,9) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_cycle_entries_type_ck CHECK (entry_type IN ('accrual', 'loss_claim', 'credit_carry')),
  CONSTRAINT contractor_payment_cycle_entries_amount_ck CHECK (amount >= 0),
  CONSTRAINT contractor_payment_cycle_entries_origin_ck CHECK (
    (entry_type = 'accrual' AND contractor_accrual_id IS NOT NULL AND contractor_loss_claim_id IS NULL)
    OR (entry_type = 'loss_claim' AND contractor_loss_claim_id IS NOT NULL AND contractor_accrual_id IS NULL)
    OR (entry_type = 'credit_carry' AND contractor_accrual_id IS NULL AND contractor_loss_claim_id IS NULL)
  )
);

CREATE UNIQUE INDEX contractor_cycle_entries_accrual_uq
  ON public.contractor_payment_cycle_entries (contractor_accrual_id)
  WHERE contractor_accrual_id IS NOT NULL;
CREATE UNIQUE INDEX contractor_cycle_entries_claim_uq
  ON public.contractor_payment_cycle_entries (contractor_loss_claim_id)
  WHERE contractor_loss_claim_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. FKs estruturais em reservas/movimentos e auditoria
-- -----------------------------------------------------------------------------

ALTER TABLE public.material_reservations
  ADD COLUMN IF NOT EXISTS strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_batch_item_id uuid REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_order_item_id uuid REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS base_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS finished_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE public.material_reservations
  DROP CONSTRAINT IF EXISTS material_reservations_origin_ck;
ALTER TABLE public.material_reservations
  ADD CONSTRAINT material_reservations_origin_ck CHECK (
    order_id IS NOT NULL
    OR num_nonnulls(sale_order_strap_demand_id, strap_stock_floor_contribution_id) = 1
  );

CREATE INDEX IF NOT EXISTS material_reservations_strap_demand_idx
  ON public.material_reservations (sale_order_strap_demand_id, product_id, status);
CREATE INDEX IF NOT EXISTS material_reservations_strap_floor_idx
  ON public.material_reservations (strap_stock_floor_contribution_id, product_id, status);
CREATE INDEX IF NOT EXISTS material_reservations_strap_batch_idx
  ON public.material_reservations (strap_batch_item_id, product_id, status);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS material_reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_movement_event_id uuid,
  ADD COLUMN IF NOT EXISTS strap_variant_id uuid REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS base_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS finished_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sale_order_strap_demand_id uuid REFERENCES public.sale_order_strap_demands(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_stock_floor_contribution_id uuid REFERENCES public.strap_stock_floor_contributions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_batch_item_id uuid REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS service_order_item_id uuid REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_production_receipt_id uuid REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_receipt_item_id uuid REFERENCES public.purchase_receipt_items(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_recipe_version_snapshot integer,
  ADD COLUMN IF NOT EXISTS origin_type text,
  ADD COLUMN IF NOT EXISTS effective_unit_cost numeric(24,9),
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_strap_event_uq
  ON public.stock_movements(strap_movement_event_id)
  WHERE strap_movement_event_id IS NOT NULL;

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_strap_origin_type_ck;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_strap_origin_type_ck CHECK (
    origin_type IS NULL OR origin_type IN ('internal_factory', 'internal_contractor', 'buy_ready')
  );

ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contractor_payment_cycle_id uuid REFERENCES public.contractor_payment_cycles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS purchase_receipt_id uuid REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX accounts_payable_contractor_cycle_uq
  ON public.accounts_payable (contractor_payment_cycle_id)
  WHERE contractor_payment_cycle_id IS NOT NULL;

CREATE UNIQUE INDEX accounts_payable_purchase_receipt_installment_uq
  ON public.accounts_payable (purchase_receipt_id, installment_number)
  WHERE purchase_receipt_id IS NOT NULL;

-- Eventos internos idempotentes para o contador/lista da aba administrativa.
-- A criticidade e reavaliada pelo servidor; refresh de tela nunca cria alerta.
CREATE TABLE public.strap_operational_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  event_type text NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  previous_criticality text,
  criticality text,
  title text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_operational_notifications_event_uq UNIQUE (event_key),
  CONSTRAINT strap_operational_notifications_event_ck CHECK (
    event_type IN ('purchase_order_created','criticality_changed')),
  CONSTRAINT strap_operational_notifications_criticality_ck CHECK (
    (event_type='purchase_order_created'
      AND previous_criticality IS NULL AND criticality IS NULL)
    OR (event_type='criticality_changed'
      AND criticality IN ('Atrasada','Urgente')
      AND (previous_criticality IS NULL
        OR previous_criticality IN ('Normal','Atrasada','Urgente')))
  ),
  CONSTRAINT strap_operational_notifications_text_ck CHECK (
    btrim(event_key)<>'' AND btrim(title)<>'' AND btrim(message)<>''
    AND jsonb_typeof(payload)='object')
);

CREATE INDEX strap_operational_notifications_po_created_idx
  ON public.strap_operational_notifications (purchase_order_id,created_at DESC);

CREATE TABLE public.artisanal_strap_operational_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  reason text,
  correlation_id uuid,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_operational_audit_action_ck CHECK (
    action IN ('insert', 'update', 'suspend', 'resume', 'cancel', 'receive', 'send',
               'approve', 'reject', 'close_cycle', 'reconcile', 'retry', 'dead_letter')
  )
);

CREATE INDEX artisanal_strap_operational_audit_entity_idx
  ON public.artisanal_strap_operational_audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX artisanal_strap_operational_audit_correlation_idx
  ON public.artisanal_strap_operational_audit_log (correlation_id, occurred_at)
  WHERE correlation_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. Guardas de estado, imutabilidade e capacidade
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_touch_artisanal_strap_operational()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'strap_operational_calendars', 'strap_executor_capacities',
    'sale_order_strap_demands', 'strap_stock_floor_contributions', 'strap_demand_jobs',
    'purchase_demand_contributions', 'strap_production_batches',
    'strap_production_batch_items', 'strap_production_batch_contributions',
    'strap_executor_daily_capacity_buckets', 'strap_executor_daily_capacity_allocations',
    'strap_pending_reconciliations', 'contractor_payment_schedules',
    'contractor_payment_cycles', 'contractor_loss_claims'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_strap_operational ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_strap_operational BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_touch_artisanal_strap_operational()', v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_strap_immutable_fact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' AND current_setting('app.strap_fact_reversal', true) = '1' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% e um fato imutavel; corrija por estorno administrativo', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'purchase_receipts', 'purchase_receipt_items', 'purchase_receipt_allocations',
    'strap_production_receipts', 'strap_production_receipt_allocations',
    'contractor_material_custody_movements', 'contractor_accruals',
    'contractor_payment_cycle_entries', 'strap_financial_snapshots'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_strap_immutable_fact ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_guard_strap_immutable_fact BEFORE UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_immutable_fact()', v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_validate_strap_daily_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity numeric;
  v_total numeric;
BEGIN
  SELECT b.capacity_m_snapshot INTO v_capacity
    FROM public.strap_executor_daily_capacity_buckets b
   WHERE b.id = NEW.capacity_bucket_id AND b.status = 'active'
   FOR UPDATE;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'Bucket de capacidade inativo ou inexistente';
  END IF;

  SELECT coalesce(sum(a.scheduled_m), 0) INTO v_total
    FROM public.strap_executor_daily_capacity_allocations a
   WHERE a.capacity_bucket_id = NEW.capacity_bucket_id
     AND a.status = 'active'
     AND a.id IS DISTINCT FROM NEW.id;

  IF v_total + NEW.scheduled_m > v_capacity + 0.000001 THEN
    RAISE EXCEPTION 'Capacidade diaria excedida: alocado %, novo %, capacidade %',
      v_total, NEW.scheduled_m, v_capacity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_strap_daily_capacity
  BEFORE INSERT OR UPDATE OF capacity_bucket_id, scheduled_m, status
  ON public.strap_executor_daily_capacity_allocations
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.tg_validate_strap_daily_capacity();

CREATE OR REPLACE FUNCTION public.tg_validate_strap_executor_calendar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_type text; v_contractor uuid; v_status text;
BEGIN
  SELECT calendar_type,contractor_id,status INTO v_type,v_contractor,v_status
    FROM public.strap_operational_calendars WHERE id=NEW.calendar_id;
  IF v_status<>'active' THEN RAISE EXCEPTION 'Calendario do executor deve estar ativo'; END IF;
  IF NEW.executor_type='factory' AND (v_type<>'factory' OR v_contractor IS NOT NULL) THEN
    RAISE EXCEPTION 'Capacidade da fabrica exige calendario factory';
  ELSIF NEW.executor_type='contractor'
    AND (v_type<>'contractor' OR v_contractor IS DISTINCT FROM NEW.contractor_id) THEN
    RAISE EXCEPTION 'Capacidade terceirizada exige calendario do mesmo fornecedor';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_strap_executor_calendar
  BEFORE INSERT OR UPDATE OF executor_type,contractor_id,calendar_id,status
  ON public.strap_executor_capacities
  FOR EACH ROW WHEN (NEW.status='active')
  EXECUTE FUNCTION public.tg_validate_strap_executor_calendar();

CREATE OR REPLACE FUNCTION public.tg_guard_closed_contractor_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status = 'paid'
     AND current_setting('app.strap_cycle_payment', true) = '1'
     -- A baixa e a unica mutacao admitida depois do fechamento. O token e
     -- transaction-local e os campos liberados sao exatamente os snapshots
     -- produzidos por mark_contractor_payment_cycle_paid; todo o restante da
     -- competencia financeira continua congelado.
     AND (to_jsonb(NEW)
       - 'status' - 'paid_by' - 'paid_at'
       - 'payment_date_snapshot' - 'payment_method_snapshot'
       - 'payment_idempotency_key' - 'payment_payload_hash' - 'updated_at')
       = (to_jsonb(OLD)
       - 'status' - 'paid_by' - 'paid_at'
       - 'payment_date_snapshot' - 'payment_method_snapshot'
       - 'payment_idempotency_key' - 'payment_payload_hash' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('closed', 'paid') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Ciclo financeiro fechado e imutavel';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_closed_contractor_cycle
  BEFORE UPDATE ON public.contractor_payment_cycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_closed_contractor_cycle();

-- Contrato executavel: a transicao closed -> paid so pode preencher os sete
-- fatos de pagamento sob o GUC interno; nenhuma coluna de competencia/custo
-- pode ser alterada no mesmo UPDATE.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.tg_guard_closed_contractor_cycle()'::regprocedure
  ) INTO v_def;
  IF v_def !~ 'app\.strap_cycle_payment'
     OR v_def !~ 'OLD\.status = ''closed'' AND NEW\.status = ''paid'''
     OR v_def !~ '''payment_idempotency_key'''
     OR v_def !~ '''payment_payload_hash'''
     OR v_def !~ '''payment_date_snapshot'''
     OR v_def !~ '''payment_method_snapshot'''
     OR v_def !~ '''paid_by'''
     OR v_def !~ '''paid_at''' THEN
    RAISE EXCEPTION 'Regressao: ciclo fechado nao possui transicao paid fechada pelo GUC';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS: leitura operacional aprovada, escrita somente por capability/RPC
-- -----------------------------------------------------------------------------

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'strap_operational_calendars', 'strap_operational_calendar_exceptions',
    'strap_executor_capacities',
    'strap_stock_floor_contributions',
    'purchase_receipt_allocations', 'strap_production_batches',
    'strap_production_batch_items', 'strap_production_batch_contributions',
    'strap_executor_daily_capacity_buckets', 'strap_executor_daily_capacity_allocations',
    'strap_production_receipts', 'strap_production_receipt_allocations',
    'strap_pending_reconciliations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS strap_operational_select ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY strap_operational_select ON public.%I FOR SELECT TO authenticated '
      'USING ((SELECT public.is_approved_user()))', v_table
    );
  END LOOP;
END;
$$;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'strap_financial_snapshots', 'contractor_payment_schedules',
    'contractor_payment_cycles', 'contractor_loss_claims', 'contractor_accruals',
    'contractor_payment_cycle_entries', 'strap_purchase_cashflow_installments',
    'purchase_demand_contributions', 'purchase_receipts', 'purchase_receipt_items',
    'contractor_material_custody_movements',
    'sale_order_strap_demands', 'strap_demand_jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS strap_operational_select ON public.%I', v_table);
    EXECUTE format('DROP POLICY IF EXISTS strap_financial_select ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY strap_financial_select ON public.%I FOR SELECT TO authenticated '
      'USING ((SELECT public.can_see_strap_financial_values()))', v_table
    );
  END LOOP;
END;
$$;

ALTER TABLE public.artisanal_strap_operational_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY strap_operational_audit_select
  ON public.artisanal_strap_operational_audit_log
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin']))
    OR (SELECT public.can_see_strap_financial_values()));

ALTER TABLE public.strap_operational_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY strap_operational_notifications_admin_select
  ON public.strap_operational_notifications
  FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin'])));

-- Nenhuma tabela nova aceita escrita direta de authenticated. SECURITY DEFINER
-- + checks de capability sao os unicos writers operacionais. Objetos legados
-- nao tem seus grants alterados por este cutover.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'strap_operational_calendars', 'strap_operational_calendar_exceptions',
    'strap_executor_capacities', 'sale_order_strap_demands',
    'strap_stock_floor_contributions', 'strap_demand_jobs',
    'purchase_demand_contributions', 'purchase_receipts', 'purchase_receipt_items',
    'purchase_receipt_allocations', 'strap_production_batches',
    'strap_production_batch_items', 'strap_production_batch_contributions',
    'strap_executor_daily_capacity_buckets', 'strap_executor_daily_capacity_allocations',
    'strap_production_receipts', 'strap_production_receipt_allocations',
    'strap_pending_reconciliations', 'contractor_material_custody_movements',
    'strap_financial_snapshots', 'contractor_payment_schedules',
    'contractor_payment_cycles', 'contractor_loss_claims', 'contractor_accruals',
    'contractor_payment_cycle_entries', 'strap_purchase_cashflow_installments',
    'strap_operational_notifications', 'artisanal_strap_operational_audit_log'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', v_table);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Views operacionais sem custo e criticidade derivada
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_strap_demands_operational
WITH (security_invoker = false)
AS
SELECT
  d.id,
  'sale_order'::text AS origin_type,
  d.sale_order_id,
  d.sale_order_item_id,
  d.technical_strap_line_id,
  d.strap_variant_id,
  d.recipe_id,
  d.base_product_id,
  d.finished_product_id,
  d.source_mode,
  d.gross_required_m AS required_m,
  d.fulfilled_m,
  d.finished_stock_reserved_m,
  d.committed_finished_inbound_m,
  d.replenishment_required_m,
  d.base_required_m,
  d.base_reserved_m,
  d.base_inbound_allocated_m,
  d.base_shortage_m,
  d.required_at AS needed_at,
  d.main_production_start,
  d.target_week,
  d.schedule_revision,
  d.billing_anchor,
  d.billing_year,
  d.billing_month,
  d.billing_fortnight,
  d.status,
  CASE
    WHEN d.gross_required_m - d.fulfilled_m - d.cancelled_m <= 0 THEN 'Normal'
    WHEN current_date > d.strap_deadline THEN 'Urgente'
    WHEN current_date > d.strap_start THEN 'Atrasada'
    ELSE 'Normal'
  END AS criticality,
  so.order_number AS origin_label,
  d.correlation_id,
  d.created_at,
  d.updated_at
FROM public.sale_order_strap_demands d
JOIN public.sale_orders so ON so.id = d.sale_order_id
WHERE d.is_current AND public.is_approved_user()
UNION ALL
SELECT
  f.id,
  'stock_floor'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::uuid,
  f.strap_variant_id,
  f.recipe_id,
  f.base_product_id,
  f.finished_product_id,
  f.source_mode,
  f.required_m,
  f.fulfilled_m,
  0::numeric,
  f.committed_finished_inbound_m,
  f.replenishment_required_m,
  f.base_required_m,
  f.base_reserved_m,
  f.base_inbound_allocated_m,
  f.base_shortage_m,
  f.needed_at,
  NULL::date,
  date_trunc('week', f.needed_at)::date,
  f.schedule_revision,
  f.billing_anchor,
  f.billing_year,
  f.billing_month,
  f.billing_fortnight,
  f.status,
  CASE
    WHEN f.required_m - f.fulfilled_m <= 0 THEN 'Normal'
    WHEN current_date > f.needed_at THEN 'Urgente'
    ELSE 'Normal'
  END,
  'Reposicao de estoque minimo'::text,
  f.correlation_id,
  f.created_at,
  f.updated_at
FROM public.strap_stock_floor_contributions f
WHERE f.is_current AND public.is_approved_user();

CREATE OR REPLACE VIEW public.v_strap_batch_criticality
WITH (security_invoker = true)
AS
SELECT
  b.id AS batch_id,
  b.batch_number,
  b.target_week,
  b.executor_type,
  b.contractor_id,
  b.production_start_date,
  b.deadline,
  b.schedule_revision,
  b.status,
  coalesce(sum(i.planned_finished_m), 0) AS planned_m,
  coalesce(sum(i.scheduled_m), 0) AS scheduled_m,
  coalesce(sum(i.unscheduled_m), 0) AS unscheduled_m,
  coalesce(sum(i.approved_m), 0) AS approved_m,
  CASE
    WHEN coalesce(sum(i.planned_finished_m - i.approved_m), 0) <= 0 THEN 'Normal'
    WHEN current_date > b.deadline THEN 'Urgente'
    WHEN b.production_start_date IS NOT NULL AND current_date > b.production_start_date THEN 'Atrasada'
    ELSE 'Normal'
  END AS criticality,
  b.correlation_id,
  b.created_at,
  b.updated_at
FROM public.strap_production_batches b
LEFT JOIN public.strap_production_batch_items i ON i.batch_id = b.id
GROUP BY b.id;

CREATE OR REPLACE VIEW public.v_strap_batch_items_operational
WITH (security_invoker = false)
AS
SELECT
  i.*,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'origin_type', CASE WHEN c.sale_order_strap_demand_id IS NOT NULL THEN 'sale_order' ELSE 'stock_floor' END,
      'sale_order_strap_demand_id', c.sale_order_strap_demand_id,
      'stock_floor_contribution_id', c.stock_floor_contribution_id,
      'label', CASE WHEN c.sale_order_strap_demand_id IS NOT NULL THEN so.order_number ELSE 'Reposicao de estoque minimo' END,
      'planned_m', c.planned_m,
      'delivered_m', c.delivered_m,
      'priority', c.priority,
      'status', c.status
    ) ORDER BY c.priority, c.id
  ) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS contributions
FROM public.strap_production_batch_items i
LEFT JOIN public.strap_production_batch_contributions c ON c.batch_item_id = i.id
LEFT JOIN public.sale_order_strap_demands d ON d.id = c.sale_order_strap_demand_id
LEFT JOIN public.sale_orders so ON so.id = d.sale_order_id
WHERE public.is_approved_user()
GROUP BY i.id;

CREATE OR REPLACE VIEW public.v_contractor_material_custody_balances
WITH (security_invoker = false)
AS
SELECT
  m.service_order_id,
  m.service_order_item_id,
  m.contractor_id,
  m.base_product_id,
  sum(CASE
    WHEN m.movement_type = 'sent' THEN m.quantity
    WHEN m.movement_type = 'adjusted' THEN m.quantity
    ELSE -m.quantity
  END)::numeric(24,9) AS balance_in_custody,
  max(m.occurred_at) AS last_movement_at
FROM public.contractor_material_custody_movements m
WHERE public.is_approved_user()
GROUP BY m.service_order_id, m.service_order_item_id, m.contractor_id, m.base_product_id;

CREATE OR REPLACE VIEW public.v_strap_demand_job_diagnostics
WITH (security_invoker = false)
AS
SELECT
  id, source_type, source_id, source_revision, schedule_revision, event_type,
  event_origin, status, attempts, max_attempts, next_attempt_at, locked_at,
  locked_by, last_error, correlation_id, semantic_hash, created_at, updated_at,
  now() - created_at AS age
FROM public.strap_demand_jobs
WHERE status IN ('queued', 'processing', 'retry', 'dead_letter')
  AND public.user_has_any_role(ARRAY['admin']);

GRANT SELECT ON public.v_strap_demands_operational,
  public.v_strap_batch_criticality,
  public.v_strap_batch_items_operational,
  public.v_contractor_material_custody_balances,
  public.v_strap_demand_job_diagnostics TO authenticated;

-- -----------------------------------------------------------------------------
-- 11. Cutover: remove somente o escritor legado de dupla baixa
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;

COMMENT ON FUNCTION public.debit_service_order_base() IS
  'LEGADO READ-ONLY/CUTOVER: trigger trg_debit_service_order_base removido em 20270101003100. Historico e funcao preservados; nova baixa ocorre exclusivamente em register_strap_production_receipt.';
