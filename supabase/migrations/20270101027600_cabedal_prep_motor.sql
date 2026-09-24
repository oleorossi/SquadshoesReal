-- Motor de preparação de cabedal (fila operacional em /terceirizados).
-- Demandas nascem na aprovação do PV; OC source_type=cabedal_prep para faltas
-- de material do cabedal (napa, enfeites/BOM, aviamento); baixa na OS sem
-- rebaixar na OP (tabela de débitos + gate).

-- ─── source_type novo nas OCs ───────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type CHECK (source_type = ANY (ARRAY[
    'manual'::text, 'mrp'::text, 'per_pv'::text, 'manual_avulsa'::text,
    'auto_pv'::text, 'auto_op'::text, 'rop'::text, 'strap_demand'::text,
    'cabedal_prep'::text
  ]));

-- ─── Capacidade sugerida por prestador × ficha × setor ──────────────────────
CREATE TABLE IF NOT EXISTS public.contractor_model_capacities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  technical_sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  sector text NOT NULL CHECK (sector = ANY (ARRAY[
    'corte_cabedal'::text, 'costura_cabedal'::text, 'aviamento'::text
  ])),
  capacity_pairs_per_day integer NOT NULL CHECK (
    capacity_pairs_per_day >= 1 AND capacity_pairs_per_day <= 1000000
  ),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, technical_sheet_id, sector)
);

CREATE INDEX IF NOT EXISTS idx_contractor_model_capacities_sheet
  ON public.contractor_model_capacities (technical_sheet_id);

ALTER TABLE public.contractor_model_capacities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractor_model_capacities_all ON public.contractor_model_capacities;
CREATE POLICY contractor_model_capacities_all ON public.contractor_model_capacities
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ─── Demanda de preparação (1 por item de PV) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.cabedal_prep_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid NOT NULL REFERENCES public.sale_order_items(id) ON DELETE CASCADE,
  technical_sheet_id uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  reference_code text,
  color text,
  pairs numeric NOT NULL CHECK (pairs > 0),
  billing_week text,
  billing_start_date date,
  assembly_capacity_per_day numeric,
  assembly_days integer,
  ready_date date,
  requires_cut boolean NOT NULL DEFAULT true,
  requires_sewing boolean NOT NULL DEFAULT true,
  requires_aviamento boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY[
    'open'::text, 'planned'::text, 'stale'::text, 'done'::text, 'cancelled'::text
  ])),
  plan_locked_at timestamptz,
  stale_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cabedal_prep_demands_so
  ON public.cabedal_prep_demands (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_demands_ready
  ON public.cabedal_prep_demands (ready_date) WHERE status IN ('open', 'planned', 'stale');
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_demands_billing
  ON public.cabedal_prep_demands (billing_week);

ALTER TABLE public.cabedal_prep_demands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cabedal_prep_demands_all ON public.cabedal_prep_demands;
CREATE POLICY cabedal_prep_demands_all ON public.cabedal_prep_demands
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ─── Alocações do plano ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cabedal_prep_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES public.cabedal_prep_demands(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  sector text NOT NULL CHECK (sector = ANY (ARRAY[
    'corte_cabedal'::text, 'costura_cabedal'::text, 'aviamento'::text, 'package'::text
  ])),
  pairs numeric NOT NULL CHECK (pairs > 0),
  pairs_per_day numeric NOT NULL CHECK (pairs_per_day > 0),
  leave_date date NOT NULL,
  start_date date,
  end_date date,
  work_days integer,
  package_group_id uuid,
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  is_factory_overtime boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cabedal_prep_allocations_demand
  ON public.cabedal_prep_allocations (demand_id);
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_allocations_contractor
  ON public.cabedal_prep_allocations (contractor_id);

ALTER TABLE public.cabedal_prep_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cabedal_prep_allocations_all ON public.cabedal_prep_allocations;
CREATE POLICY cabedal_prep_allocations_all ON public.cabedal_prep_allocations
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ─── Débitos de estoque feitos na prep (anti-rebaixa na OP) ──────────────────
CREATE TABLE IF NOT EXISTS public.cabedal_prep_stock_debits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  stock_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_order_id, product_id, service_order_id)
);

CREATE INDEX IF NOT EXISTS idx_cabedal_prep_stock_debits_so_product
  ON public.cabedal_prep_stock_debits (sale_order_id, product_id);

ALTER TABLE public.cabedal_prep_stock_debits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cabedal_prep_stock_debits_select ON public.cabedal_prep_stock_debits;
CREATE POLICY cabedal_prep_stock_debits_select ON public.cabedal_prep_stock_debits
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- Helper: produto já debitado na prep deste PV?
CREATE OR REPLACE FUNCTION public.cabedal_prep_product_already_debited(
  p_sale_order_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cabedal_prep_stock_debits d
     WHERE d.sale_order_id = p_sale_order_id
       AND d.product_id = p_product_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.cabedal_prep_product_already_debited(uuid, uuid)
  TO authenticated, service_role;

-- ─── Parse billing_week → date (reusa se existir) ───────────────────────────
CREATE OR REPLACE FUNCTION public.cabedal_prep_billing_start(p_billing_week text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_month text;
  v_week text;
  v_year int;
  v_mon int;
  v_wn int;
  v_first date;
  v_start date;
  v_dow int;
BEGIN
  IF p_billing_week IS NULL OR btrim(p_billing_week) = '' THEN
    RETURN NULL;
  END IF;
  -- "YYYY-MM-S#"
  IF p_billing_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
    v_month := substring(p_billing_week from 1 for 7);
    v_week := substring(p_billing_week from 9);
  ELSE
    RETURN NULL;
  END IF;
  v_year := substring(v_month from 1 for 4)::int;
  v_mon := substring(v_month from 6 for 2)::int;
  v_wn := regexp_replace(v_week, '\D', '', 'g')::int;
  IF v_wn < 1 THEN RETURN NULL; END IF;
  v_first := make_date(v_year, v_mon, 1);
  v_dow := EXTRACT(DOW FROM v_first)::int; -- 0=dom … 1=seg
  v_start := v_first - ((v_dow + 6) % 7);
  v_start := v_start + ((v_wn - 1) * 7);
  IF v_start < v_first THEN
    RETURN v_first;
  END IF;
  RETURN v_start;
END;
$$;

-- ─── Produtos de cabedal de um PV (napa, acessórios, BOM da ficha) ──────────
CREATE OR REPLACE FUNCTION public.cabedal_prep_material_product_ids(p_sale_order_id uuid)
RETURNS TABLE(product_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH items AS (
    SELECT soi.id, soi.reference_id, soi.color
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
  ),
  sheets AS (
    SELECT ts.*
      FROM public.technical_sheets ts
     WHERE ts.id IN (SELECT reference_id FROM items)
  ),
  from_upper AS (
    SELECT DISTINCT ts.upper_material_product_id AS product_id
      FROM sheets ts
     WHERE ts.upper_material_product_id IS NOT NULL
    UNION
    SELECT DISTINCT p.id
      FROM sheets ts
      JOIN public.products p ON p.group_id = ts.upper_material_group_id
     WHERE ts.upper_material_group_id IS NOT NULL
       AND COALESCE(p.active, true)
  ),
  from_accessories AS (
    SELECT DISTINCT (acc ->> 'product_id')::uuid AS product_id
      FROM sheets ts
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ts.components_accessories) = 'array'
             THEN ts.components_accessories ELSE '[]'::jsonb END
      ) acc
     WHERE NULLIF(acc ->> 'product_id', '') IS NOT NULL
  ),
  from_bom AS (
    SELECT DISTINCT sm.product_id
      FROM public.sheet_materials sm
     WHERE sm.sheet_id IN (SELECT id FROM sheets)
       AND sm.product_id IS NOT NULL
  )
  SELECT product_id FROM from_upper WHERE product_id IS NOT NULL
  UNION
  SELECT product_id FROM from_accessories WHERE product_id IS NOT NULL
  UNION
  SELECT product_id FROM from_bom WHERE product_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.cabedal_prep_material_product_ids(uuid)
  TO authenticated, service_role;

-- ─── Materializa demandas na aprovação ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.materialize_cabedal_prep_demands(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_billing text;
  v_billing_start date;
  v_created int := 0;
  v_updated int := 0;
  r record;
  v_cap numeric;
  v_assembly_days int;
  v_lead int;
  v_ready date;
  v_req_cut boolean;
  v_req_sew boolean;
  v_req_avi boolean;
BEGIN
  SELECT so.status, so.billing_week
    INTO v_status, v_billing
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado', 'status', v_status);
  END IF;

  v_billing_start := public.cabedal_prep_billing_start(v_billing);

  FOR r IN
    SELECT soi.id AS item_id,
           soi.reference_id,
           soi.color,
           soi.quantity AS pairs,
           COALESCE(
             NULLIF(btrim(ts.code), ''),
             NULLIF(btrim(ts.model), ''),
             NULLIF(btrim(ts.name), '')
           ) AS reference_code,
           ts.assembly_capacity_per_day,
           ts.upper_material,
           ts.upper_material_group_id,
           ts.upper_material_product_id,
           ts.upper_consumption,
           ts.upper_corte_a_fio,
           ts.has_straps,
           ts.components_accessories,
           ts.aviamento_steps
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
  LOOP
    -- Elegibilidade espelha upperCutEligibility (sinais de cabedal).
    v_req_cut := (
      NULLIF(btrim(COALESCE(r.upper_material, '')), '') IS NOT NULL
      OR r.upper_material_group_id IS NOT NULL
      OR r.upper_material_product_id IS NOT NULL
      OR COALESCE(r.upper_consumption, 0) > 0
      OR (jsonb_typeof(r.components_accessories) = 'array'
          AND jsonb_array_length(r.components_accessories) > 0)
    );
    v_req_sew := v_req_cut AND COALESCE(r.upper_corte_a_fio, false) IS NOT TRUE;
    v_req_avi := COALESCE(r.has_straps, false)
      OR (jsonb_typeof(r.aviamento_steps) = 'array'
          AND jsonb_array_length(r.aviamento_steps) > 0);
    IF NOT (v_req_cut OR v_req_avi) THEN
      CONTINUE;
    END IF;

    v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
      v_lead := v_assembly_days + 1;
    ELSE
      v_assembly_days := NULL;
      v_lead := NULL;
    END IF;
    IF v_billing_start IS NOT NULL AND v_lead IS NOT NULL THEN
      v_ready := v_billing_start - v_lead;
    ELSE
      v_ready := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_demands (
      sale_order_id, sale_order_item_id, technical_sheet_id, reference_code,
      color, pairs, billing_week, billing_start_date, assembly_capacity_per_day,
      assembly_days, ready_date, requires_cut, requires_sewing, requires_aviamento,
      status, updated_at
    ) VALUES (
      p_sale_order_id, r.item_id, r.reference_id, r.reference_code,
      r.color, r.pairs, v_billing, v_billing_start, v_cap,
      v_assembly_days, v_ready, v_req_cut, v_req_sew, v_req_avi,
      'open', now()
    )
    ON CONFLICT (sale_order_item_id) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      billing_week = EXCLUDED.billing_week,
      billing_start_date = EXCLUDED.billing_start_date,
      assembly_capacity_per_day = EXCLUDED.assembly_capacity_per_day,
      assembly_days = EXCLUDED.assembly_days,
      ready_date = EXCLUDED.ready_date,
      requires_cut = EXCLUDED.requires_cut,
      requires_sewing = EXCLUDED.requires_sewing,
      requires_aviamento = EXCLUDED.requires_aviamento,
      status = CASE
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'stale'
        ELSE public.cabedal_prep_demands.status
      END,
      stale_reason = CASE
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'pv_item_changed'
        ELSE public.cabedal_prep_demands.stale_reason
      END,
      updated_at = now();

    IF FOUND THEN
      -- ON CONFLICT UPDATE always "found"; distinguish via xmax hack is messy —
      -- count both as upserted.
      v_updated := v_updated + 1;
    ELSE
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_created + v_updated,
    'billing_week', v_billing,
    'billing_start_date', v_billing_start
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_cabedal_prep_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_cabedal_prep_demands(uuid)
  TO authenticated, service_role;

-- ─── OCs cabedal_prep a partir das faltas (subconjunto do motor per_pv) ─────
CREATE OR REPLACE FUNCTION public.process_cabedal_prep_purchase_shortages(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_mat record;
  v_supplier_id uuid;
  v_supplier_name text;
  v_idem text;
  v_po_id uuid;
  v_created int := 0;
  v_reused int := 0;
  v_skipped int := 0;
  v_cabedal_ids uuid[];
  v_by_supplier jsonb := '{}'::jsonb;
  v_key text;
  v_items jsonb;
  v_entry jsonb;
  v_total numeric;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', 'authenticated') THEN
    -- authenticated allowed for manual retry from UI; outbox uses service_role
    NULL;
  END IF;

  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado');
  END IF;

  PERFORM public.materialize_cabedal_prep_demands(p_sale_order_id);

  SELECT COALESCE(array_agg(DISTINCT c.product_id), ARRAY[]::uuid[])
    INTO v_cabedal_ids
    FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c;

  IF coalesce(array_length(v_cabedal_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'reason', 'no_cabedal_products');
  END IF;

  FOR v_mat IN
    SELECT need.*
      FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
     WHERE COALESCE(need.shortage, 0) > 0
       AND need.material_id = ANY (v_cabedal_ids)
       AND NOT COALESCE(need.is_artisanal, false)
       AND COALESCE(need.last_unit_price, 0) > 0
  LOOP
    v_key := CASE
      WHEN v_mat.supplier_id IS NULL THEN 'none'
      ELSE 'supplier:' || v_mat.supplier_id::text
    END;
    v_entry := jsonb_build_object(
      'product_id', v_mat.material_id,
      'product_name', v_mat.product_name,
      'quantity', v_mat.shortage,
      'unit_price', v_mat.last_unit_price,
      'unit', COALESCE(NULLIF(btrim(v_mat.unit), ''), 'un'),
      'color', NULLIF(v_mat.color, ''),
      'current_stock', COALESCE(v_mat.stock_qty, 0)
    );
    IF v_by_supplier ? v_key THEN
      v_by_supplier := jsonb_set(
        v_by_supplier,
        ARRAY[v_key, 'items'],
        (v_by_supplier -> v_key -> 'items') || jsonb_build_array(v_entry)
      );
    ELSE
      v_by_supplier := v_by_supplier || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'supplier_id', v_mat.supplier_id,
          'supplier_name', COALESCE(NULLIF(btrim(v_mat.supplier_name), ''), 'A definir'),
          'items', jsonb_build_array(v_entry)
        )
      );
    END IF;
  END LOOP;

  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_by_supplier)
  LOOP
    v_supplier_id := NULLIF(v_entry ->> 'supplier_id', '')::uuid;
    v_supplier_name := v_entry ->> 'supplier_name';
    v_items := v_entry -> 'items';
    v_idem := 'cabedal_prep:outbox:' || COALESCE(v_supplier_id::text, 'none') || ':' || p_sale_order_id::text;

    SELECT po.id INTO v_po_id
      FROM public.purchase_orders po
     WHERE po.idempotency_key = v_idem
     LIMIT 1;

    IF v_po_id IS NOT NULL THEN
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM((i ->> 'quantity')::numeric * (i ->> 'unit_price')::numeric), 0)
      INTO v_total
      FROM jsonb_array_elements(v_items) i;

    INSERT INTO public.purchase_orders(
      supplier_id, supplier_name, notes, total_value, auto_generated,
      status, approval_status, source_type, source_pv_ids,
      linked_sale_order_ids, idempotency_key
    ) VALUES (
      v_supplier_id,
      v_supplier_name,
      'OC preparação de cabedal · PV ' || p_sale_order_id::text,
      v_total,
      true,
      CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
      'pendente_aprovacao',
      'cabedal_prep',
      ARRAY[p_sale_order_id],
      ARRAY[p_sale_order_id],
      v_idem
    ) RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, suggested_quantity,
      unit_price, unit, current_stock, color
    )
    SELECT
      v_po_id,
      (i ->> 'product_id')::uuid,
      (i ->> 'quantity')::numeric,
      (i ->> 'quantity')::numeric,
      (i ->> 'unit_price')::numeric,
      COALESCE(i ->> 'unit', 'un'),
      COALESCE((i ->> 'current_stock')::numeric, 0),
      i ->> 'color'
    FROM jsonb_array_elements(v_items) i;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'reused', v_reused,
    'skipped', v_skipped
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_cabedal_prep_purchase_shortages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_cabedal_prep_purchase_shortages(uuid)
  TO authenticated, service_role;

COMMENT ON TABLE public.cabedal_prep_demands IS
  'Demanda de preparação de cabedal por item de PV; nasce na aprovação.';
COMMENT ON TABLE public.cabedal_prep_allocations IS
  'Plano de distribuição prestador×setor; OS gerada sob demanda.';
COMMENT ON COLUMN public.purchase_orders.source_type IS
  'Inclui cabedal_prep = OC automática do menu Preparação de cabedal.';

-- ─── Gera OS a partir das alocações do plano + baixa materiais de cabedal ───
CREATE OR REPLACE FUNCTION public.generate_cabedal_prep_service_orders(
  p_allocation_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc record;
  v_demand public.cabedal_prep_demands%ROWTYPE;
  v_os_id uuid;
  v_created int := 0;
  v_sector_label text;
  v_prod record;
  v_need numeric;
  v_avail numeric;
  v_debit numeric;
BEGIN
  IF p_allocation_ids IS NULL OR coalesce(array_length(p_allocation_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma alocação' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  FOR v_alloc IN
    SELECT a.*
      FROM public.cabedal_prep_allocations a
     WHERE a.id = ANY (p_allocation_ids)
       AND a.service_order_id IS NULL
     FOR UPDATE
  LOOP
    SELECT * INTO v_demand
      FROM public.cabedal_prep_demands d
     WHERE d.id = v_alloc.demand_id;

    v_sector_label := CASE v_alloc.sector
      WHEN 'corte_cabedal' THEN 'Corte Cabedal'
      WHEN 'costura_cabedal' THEN 'Costura Cabedal'
      WHEN 'aviamento' THEN 'Aviamento'
      WHEN 'package' THEN 'Pacote cabedal'
      ELSE v_alloc.sector
    END;

    INSERT INTO public.service_orders (
      contractor_id, status, service_date, description, notes,
      quantity, unit_price, total_value, sector, sale_order_id,
      source_sale_order_id, source_sale_order_item_id,
      linked_sale_order_ids, selected_sale_order_item_ids,
      provider_capacity_pairs_per_day, material_requirements
    ) VALUES (
      v_alloc.contractor_id,
      'Pendente',
      COALESCE(v_alloc.leave_date, CURRENT_DATE),
      'Prep. cabedal · ' || v_sector_label || ' · '
        || COALESCE(v_demand.reference_code, '?') || ' '
        || COALESCE(v_demand.color, ''),
      'Gerada pelo menu Preparação de cabedal · allocation=' || v_alloc.id::text,
      v_alloc.pairs,
      0,
      0,
      CASE v_alloc.sector
        WHEN 'corte_cabedal' THEN 'Corte Cabedal'
        WHEN 'costura_cabedal' THEN 'Costura Cabedal'
        WHEN 'aviamento' THEN 'Aviamento'
        ELSE 'Corte Cabedal'
      END,
      v_demand.sale_order_id,
      v_demand.sale_order_id,
      v_demand.sale_order_item_id,
      ARRAY[v_demand.sale_order_id],
      ARRAY[v_demand.sale_order_item_id],
      v_alloc.pairs_per_day,
      '[]'::jsonb
    ) RETURNING id INTO v_os_id;

    UPDATE public.cabedal_prep_allocations
       SET service_order_id = v_os_id, updated_at = now()
     WHERE id = v_alloc.id;

    -- Baixa materiais de cabedal na geração da OS (anti-rebaixa via tabela).
    -- Rateio proporcional aos pares desta alocação / demanda.
    FOR v_prod IN
      SELECT c.product_id,
             GREATEST(COALESCE(p.quantity, 0), 0) AS qty
        FROM public.cabedal_prep_material_product_ids(v_demand.sale_order_id) c
        JOIN public.products p ON p.id = c.product_id
    LOOP
      IF public.cabedal_prep_product_already_debited(v_demand.sale_order_id, v_prod.product_id) THEN
        CONTINUE;
      END IF;
      -- Necessidade aproximada: shortage do motor canônico × (pares alloc / pares demand)
      SELECT COALESCE(need.needed_qty, 0) * (v_alloc.pairs / NULLIF(v_demand.pairs, 0))
        INTO v_need
        FROM public.compute_materials_per_pv(ARRAY[v_demand.sale_order_id]) need
       WHERE need.material_id = v_prod.product_id
       LIMIT 1;
      IF COALESCE(v_need, 0) <= 0 THEN
        CONTINUE;
      END IF;
      v_avail := v_prod.qty;
      v_debit := LEAST(v_avail, v_need);
      IF v_debit <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.products
         SET quantity = quantity - v_debit,
             updated_at = now()
       WHERE id = v_prod.product_id;

      INSERT INTO public.cabedal_prep_stock_debits (
        sale_order_id, sale_order_item_id, product_id, quantity,
        service_order_id
      ) VALUES (
        v_demand.sale_order_id, v_demand.sale_order_item_id, v_prod.product_id,
        v_debit, v_os_id
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_cabedal_prep_service_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_cabedal_prep_service_orders(uuid[])
  TO authenticated, service_role;
