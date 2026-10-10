-- Ateliê: cadastro de refs complexas × setor, jobs em pipeline (debitar→enviado→
-- recebido), soft na aprovação, débito no confirmar, anti-rebaixa na OP via
-- ledger + skip em hybrid_debit (trigger em material_reservations).

-- ─── 1. Cadastro Ateliê ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atelier_complex_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  sector text NOT NULL CHECK (sector = ANY (ARRAY[
    'corte_cabedal'::text, 'costura_cabedal'::text, 'aviamento'::text
  ])),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_id, sector)
);

CREATE INDEX IF NOT EXISTS idx_atelier_complex_ref_active
  ON public.atelier_complex_references (reference_id)
  WHERE active;

ALTER TABLE public.atelier_complex_references ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_complex_references_all ON public.atelier_complex_references;
CREATE POLICY atelier_complex_references_all ON public.atelier_complex_references
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

COMMENT ON TABLE public.atelier_complex_references IS
  'Cadastro Ateliê: referências de cabedal complexo por setor (rua).';

-- ─── 2. Jobs por demanda × setor (pipeline) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cabedal_prep_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES public.cabedal_prep_demands(id) ON DELETE CASCADE,
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  technical_sheet_id uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  sector text NOT NULL CHECK (sector = ANY (ARRAY[
    'corte_cabedal'::text, 'costura_cabedal'::text, 'aviamento'::text
  ])),
  pairs numeric NOT NULL CHECK (pairs > 0),
  color text,
  reference_code text,
  pipeline_status text NOT NULL DEFAULT 'awaiting_debit' CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_debit'::text,
    'debited'::text,
    'sent_to_contractor'::text,
    'received_at_factory'::text,
    'cancelled'::text
  ])),
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  atelier_service_number text,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  debited_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demand_id, sector)
);

CREATE INDEX IF NOT EXISTS idx_cabedal_prep_jobs_pipeline
  ON public.cabedal_prep_jobs (pipeline_status, sector);
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_jobs_so
  ON public.cabedal_prep_jobs (sale_order_id);

ALTER TABLE public.cabedal_prep_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cabedal_prep_jobs_all ON public.cabedal_prep_jobs;
CREATE POLICY cabedal_prep_jobs_all ON public.cabedal_prep_jobs
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- Nº de serviço Ateliê
CREATE SEQUENCE IF NOT EXISTS public.atelier_service_number_seq START 1;

CREATE OR REPLACE FUNCTION public.next_atelier_service_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'ATELIE-' || lpad(nextval('public.atelier_service_number_seq')::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_atelier_service_number() TO authenticated, service_role;

-- ─── 3. Colunas extras no ledger de débito ──────────────────────────────────
ALTER TABLE public.cabedal_prep_stock_debits
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.cabedal_prep_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE SET NULL;

-- ─── 4. Helpers de catálogo / materiais por setor ───────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_reference_has_sector(
  p_reference_id uuid,
  p_sector text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.sector = p_sector
       AND a.active
  );
$$;

GRANT EXECUTE ON FUNCTION public.atelier_reference_has_sector(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_resolve_sector_product_ids(
  p_sale_order_item_id uuid,
  p_sector text
)
RETURNS TABLE (product_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref uuid;
  v_color text;
  v_upper_pid uuid;
  v_upper_gid uuid;
BEGIN
  SELECT soi.reference_id, soi.color,
         ts.upper_material_product_id, ts.upper_material_group_id
    INTO v_ref, v_color, v_upper_pid, v_upper_gid
    FROM public.sale_order_items soi
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.id = p_sale_order_item_id;

  IF v_ref IS NULL THEN
    RETURN;
  END IF;

  IF p_sector IN ('corte_cabedal', 'costura_cabedal') THEN
    IF v_upper_pid IS NOT NULL THEN
      product_id := v_upper_pid;
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_upper_gid IS NOT NULL THEN
      RETURN QUERY
        SELECT p.id
          FROM public.products p
         WHERE p.group_id = v_upper_gid
           AND COALESCE(p.active, true)
           AND (
             v_color IS NULL OR btrim(v_color) = ''
             OR lower(btrim(COALESCE(p.color, ''))) = lower(btrim(v_color))
           )
         ORDER BY p.name
         LIMIT 5;
      RETURN;
    END IF;
  ELSIF p_sector = 'aviamento' THEN
    RETURN QUERY
      SELECT DISTINCT d.finished_product_id
        FROM public.sale_order_strap_demands d
       WHERE d.sale_order_item_id = p_sale_order_item_id
         AND d.finished_product_id IS NOT NULL
      UNION
      SELECT DISTINCT d.base_product_id
        FROM public.sale_order_strap_demands d
       WHERE d.sale_order_item_id = p_sale_order_item_id
         AND d.base_product_id IS NOT NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_resolve_sector_product_ids(uuid, text)
  TO authenticated, service_role;

-- ─── 5. Soft reserve / release / confirm debit ──────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_soft_reserve_for_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_pid uuid;
  v_need numeric;
  v_rid uuid;
  v_count int := 0;
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_not_found');
  END IF;
  IF v_job.pipeline_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_cancelled');
  END IF;

  FOR v_pid IN
    SELECT s.product_id FROM public.atelier_resolve_sector_product_ids(v_job.sale_order_item_id, v_job.sector) s
  LOOP
    -- Já existe soft Ateliê ativa?
    IF EXISTS (
      SELECT 1 FROM public.material_reservations mr
       WHERE mr.product_id = v_pid
         AND mr.status = 'reserved'
         AND mr.metadata ->> 'kind' = 'atelier_prep'
         AND (mr.metadata ->> 'job_id')::uuid = p_job_id
    ) THEN
      CONTINUE;
    END IF;

    -- Necessidade aproximada: pares do job (unidade par/contagem) — para napa
    -- o settle real no confirmar usa compute_materials; soft usa pares como piso
    -- de disponibilidade (evita oversell grosseiro até o débito).
    v_need := GREATEST(COALESCE(v_job.pairs, 0), 0);
    IF v_need <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.material_reservations (
      order_id, product_id, quantity_reserved, quantity_consumed,
      status, reservation_type, notes, metadata
    ) VALUES (
      NULL, v_pid, v_need, 0,
      'reserved', 'soft',
      'Ateliê soft · job=' || p_job_id::text,
      jsonb_build_object(
        'kind', 'atelier_prep',
        'job_id', p_job_id,
        'sale_order_id', v_job.sale_order_id,
        'sale_order_item_id', v_job.sale_order_item_id,
        'sector', v_job.sector
      )
    )
    RETURNING id INTO v_rid;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reserved_rows', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_soft_reserve_for_job(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_release_soft_for_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.material_reservations
     SET status = 'cancelled',
         updated_at = now(),
         notes = COALESCE(notes, '') || ' · liberado Ateliê'
   WHERE status = 'reserved'
     AND metadata ->> 'kind' = 'atelier_prep'
     AND (metadata ->> 'job_id')::uuid = p_job_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_release_soft_for_job(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_confirm_job_debit(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_pid uuid;
  v_need numeric;
  v_avail numeric;
  v_debit numeric;
  v_prev numeric;
  v_mov uuid;
  v_rid uuid;
  v_debited int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.pipeline_status <> 'awaiting_debit' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', v_job.pipeline_status);
  END IF;

  FOR v_pid IN
    SELECT s.product_id FROM public.atelier_resolve_sector_product_ids(v_job.sale_order_item_id, v_job.sector) s
  LOOP
    IF public.cabedal_prep_product_already_debited(v_job.sale_order_id, v_pid) THEN
      -- Consome soft residual se houver
      UPDATE public.material_reservations
         SET status = 'consumed',
             quantity_consumed = quantity_reserved,
             consumed_at = now(),
             updated_at = now()
       WHERE status = 'reserved'
         AND product_id = v_pid
         AND metadata ->> 'kind' = 'atelier_prep'
         AND (metadata ->> 'job_id')::uuid = p_job_id;
      CONTINUE;
    END IF;

    SELECT COALESCE(need.needed_qty, 0)
      INTO v_need
      FROM public.compute_materials_per_pv(ARRAY[v_job.sale_order_id]) need
     WHERE need.material_id = v_pid
     LIMIT 1;

    IF COALESCE(v_need, 0) <= 0 THEN
      v_need := GREATEST(COALESCE(v_job.pairs, 0), 0);
    ELSE
      -- Rateio: job cobre o item inteiro (1 job/setor por demanda)
      v_need := v_need;
    END IF;
    IF v_need <= 0 THEN CONTINUE; END IF;

    SELECT quantity INTO v_prev FROM public.products WHERE id = v_pid FOR UPDATE;
    v_avail := GREATEST(COALESCE(v_prev, 0), 0);
    v_debit := LEAST(v_avail, v_need);
    IF v_debit <= 0 THEN CONTINUE; END IF;

    UPDATE public.products
       SET quantity = quantity - v_debit,
           updated_at = now()
     WHERE id = v_pid;

    INSERT INTO public.stock_movements (
      product_id, order_id, movement_type, quantity,
      previous_stock, new_stock, description, movement_reason
    ) VALUES (
      v_pid, NULL, 'out', v_debit,
      v_prev, v_prev - v_debit,
      'Ateliê · débito prep cabedal · ' || COALESCE(v_job.reference_code, '?')
        || ' · ' || v_job.sector,
      'atelier_prep'
    )
    RETURNING id INTO v_mov;

    SELECT id INTO v_rid
      FROM public.material_reservations
     WHERE status = 'reserved'
       AND product_id = v_pid
       AND metadata ->> 'kind' = 'atelier_prep'
       AND (metadata ->> 'job_id')::uuid = p_job_id
     LIMIT 1;

    IF v_rid IS NOT NULL THEN
      UPDATE public.material_reservations
         SET status = 'consumed',
             quantity_consumed = v_debit,
             consumed_at = now(),
             updated_at = now()
       WHERE id = v_rid;
    END IF;

    INSERT INTO public.cabedal_prep_stock_debits (
      sale_order_id, sale_order_item_id, product_id, quantity,
      stock_movement_id, sector, job_id, reservation_id
    ) VALUES (
      v_job.sale_order_id, v_job.sale_order_item_id, v_pid, v_debit,
      v_mov, v_job.sector, p_job_id, v_rid
    )
    ON CONFLICT DO NOTHING;

    v_debited := v_debited + 1;
  END LOOP;

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'debited',
         debited_at = now(),
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'products_debited', v_debited);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_job_debit(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_mark_job_sent(
  p_job_id uuid,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_num text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.pipeline_status NOT IN ('debited', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Job precisa estar debitado antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = COALESCE(p_contractor_id, contractor_id),
         atelier_service_number = v_num,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'atelier_service_number', v_num);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_mark_job_received(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'received_at_factory',
         received_at = now(),
         updated_at = now()
   WHERE id = p_job_id
     AND pipeline_status = 'sent_to_contractor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job precisa estar enviado ao prestador' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_received(uuid)
  TO authenticated, service_role;

-- ─── 6. Sync jobs a partir da demanda ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_sync_jobs_for_demand(p_demand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.cabedal_prep_demands%ROWTYPE;
  v_sectors text[] := ARRAY[]::text[];
  v_sec text;
  v_job_id uuid;
  v_created int := 0;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'demand_not_found');
  END IF;
  IF v_d.technical_sheet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_sheet');
  END IF;

  IF v_d.requires_cut AND public.atelier_reference_has_sector(v_d.technical_sheet_id, 'corte_cabedal') THEN
    v_sectors := array_append(v_sectors, 'corte_cabedal');
  END IF;
  IF v_d.requires_sewing AND public.atelier_reference_has_sector(v_d.technical_sheet_id, 'costura_cabedal') THEN
    v_sectors := array_append(v_sectors, 'costura_cabedal');
  END IF;
  IF v_d.requires_aviamento AND public.atelier_reference_has_sector(v_d.technical_sheet_id, 'aviamento') THEN
    v_sectors := array_append(v_sectors, 'aviamento');
  END IF;

  -- Cancela jobs de setores que saíram do catálogo
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.demand_id = p_demand_id
     AND j.pipeline_status = 'awaiting_debit'
     AND NOT (j.sector = ANY (v_sectors));

  FOREACH v_sec IN ARRAY v_sectors LOOP
    INSERT INTO public.cabedal_prep_jobs (
      demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
      sector, pairs, color, reference_code, pipeline_status
    ) VALUES (
      p_demand_id, v_d.sale_order_id, v_d.sale_order_item_id, v_d.technical_sheet_id,
      v_sec, v_d.pairs, v_d.color, v_d.reference_code, 'awaiting_debit'
    )
    ON CONFLICT (demand_id, sector) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      updated_at = now()
    WHERE public.cabedal_prep_jobs.pipeline_status = 'awaiting_debit'
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
      SELECT id INTO v_job_id
        FROM public.cabedal_prep_jobs
       WHERE demand_id = p_demand_id AND sector = v_sec;
    END IF;

    IF v_job_id IS NOT NULL THEN
      PERFORM public.atelier_soft_reserve_for_job(v_job_id);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sectors', to_jsonb(v_sectors), 'jobs', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sync_jobs_for_demand(uuid)
  TO authenticated, service_role;

-- ─── 7. Materialize: só Aprovado + catálogo Ateliê ──────────────────────────
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
  v_upserted int := 0;
  v_skipped_catalog int := 0;
  r record;
  v_cap numeric;
  v_assembly_days int;
  v_lead int;
  v_ready date;
  v_req_cut boolean;
  v_req_sew boolean;
  v_req_avi boolean;
  v_catalog_ok boolean;
  v_demand_id uuid;
  v_sync jsonb;
BEGIN
  SELECT so.status, so.billing_week
    INTO v_status, v_billing
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;

  -- Entrada nova só em Aprovado (decisão Ateliê). Em Produção só atualiza
  -- demanda já existente.
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

    -- Gate Ateliê: precisa casar ao menos um setor necessário no cadastro
    v_catalog_ok := (
      (v_req_cut AND public.atelier_reference_has_sector(r.reference_id, 'corte_cabedal'))
      OR (v_req_sew AND public.atelier_reference_has_sector(r.reference_id, 'costura_cabedal'))
      OR (v_req_avi AND public.atelier_reference_has_sector(r.reference_id, 'aviamento'))
    );

    IF NOT v_catalog_ok THEN
      -- Cancela demanda aberta órfã deste item
      UPDATE public.cabedal_prep_demands d
         SET status = 'cancelled', updated_at = now(),
             stale_reason = 'fora_do_atelier'
       WHERE d.sale_order_item_id = r.item_id
         AND d.status IN ('open', 'planned', 'stale');
      PERFORM public.atelier_release_soft_for_job(j.id)
        FROM public.cabedal_prep_jobs j
        JOIN public.cabedal_prep_demands d ON d.id = j.demand_id
       WHERE d.sale_order_item_id = r.item_id
         AND j.pipeline_status = 'awaiting_debit';
      UPDATE public.cabedal_prep_jobs j
         SET pipeline_status = 'cancelled', updated_at = now()
        FROM public.cabedal_prep_demands d
       WHERE d.id = j.demand_id
         AND d.sale_order_item_id = r.item_id
         AND j.pipeline_status = 'awaiting_debit';
      v_skipped_catalog := v_skipped_catalog + 1;
      CONTINUE;
    END IF;

    -- Em Produção: só mexe se já existir demanda
    IF v_status = 'Em Produção'
       AND NOT EXISTS (
         SELECT 1 FROM public.cabedal_prep_demands d
          WHERE d.sale_order_item_id = r.item_id
            AND d.status <> 'cancelled'
       )
    THEN
      v_skipped_catalog := v_skipped_catalog + 1;
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
      technical_sheet_id = EXCLUDED.technical_sheet_id,
      reference_code = EXCLUDED.reference_code,
      status = CASE
        WHEN public.cabedal_prep_demands.status = 'cancelled'
          THEN 'open'
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'stale'
        ELSE public.cabedal_prep_demands.status
      END,
      stale_reason = CASE
        WHEN public.cabedal_prep_demands.status = 'cancelled'
          THEN NULL
        WHEN public.cabedal_prep_demands.status IN ('planned')
          AND (
            public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
            OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color
          )
        THEN 'pv_item_changed'
        ELSE public.cabedal_prep_demands.stale_reason
      END,
      updated_at = now()
    RETURNING id INTO v_demand_id;

    v_sync := public.atelier_sync_jobs_for_demand(v_demand_id);
    v_upserted := v_upserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'skipped_catalog', v_skipped_catalog,
    'billing_week', v_billing,
    'billing_start_date', v_billing_start
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_cabedal_prep_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_cabedal_prep_demands(uuid)
  TO authenticated, service_role;

-- ─── 8. Reaplicar elegibilidade (limpa fila inchada) ────────────────────────
CREATE OR REPLACE FUNCTION public.reapply_atelier_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled int := 0;
  v_remat int := 0;
  r record;
  v_res jsonb;
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  -- Cancela demandas abertas sem casamento Ateliê
  FOR r IN
    SELECT d.id, d.sale_order_item_id, d.technical_sheet_id,
           d.requires_cut, d.requires_sewing, d.requires_aviamento
      FROM public.cabedal_prep_demands d
     WHERE d.status IN ('open', 'planned', 'stale')
  LOOP
    IF r.technical_sheet_id IS NULL
       OR NOT (
         (r.requires_cut AND public.atelier_reference_has_sector(r.technical_sheet_id, 'corte_cabedal'))
         OR (r.requires_sewing AND public.atelier_reference_has_sector(r.technical_sheet_id, 'costura_cabedal'))
         OR (r.requires_aviamento AND public.atelier_reference_has_sector(r.technical_sheet_id, 'aviamento'))
       )
    THEN
      UPDATE public.cabedal_prep_demands
         SET status = 'cancelled', stale_reason = 'reapply_fora_atelier', updated_at = now()
       WHERE id = r.id;
      PERFORM public.atelier_release_soft_for_job(j.id)
        FROM public.cabedal_prep_jobs j
       WHERE j.demand_id = r.id AND j.pipeline_status = 'awaiting_debit';
      UPDATE public.cabedal_prep_jobs
         SET pipeline_status = 'cancelled', updated_at = now()
       WHERE demand_id = r.id AND pipeline_status = 'awaiting_debit';
      v_cancelled := v_cancelled + 1;
    END IF;
  END LOOP;

  -- Rematerializa PVs Aprovado
  FOR r IN
    SELECT so.id
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status = 'Aprovado'
  LOOP
    v_res := public.materialize_cabedal_prep_demands(r.id);
    IF COALESCE((v_res ->> 'upserted')::int, 0) > 0 THEN
      v_remat := v_remat + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_demands', v_cancelled,
    'sale_orders_touched', v_remat
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reapply_atelier_eligibility()
  TO authenticated, service_role;

-- ─── 9. Anti-rebaixa: bloqueia nova soft da OP se já debitado no Ateliê ──────
CREATE OR REPLACE FUNCTION public.tg_block_op_reserve_if_atelier_debited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Não interferir nas próprias reservas Ateliê
  IF COALESCE(NEW.metadata ->> 'kind', '') = 'atelier_prep' THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NOT NULL THEN
    SELECT o.sale_order_id INTO v_so
      FROM public.orders o
     WHERE o.id = NEW.order_id;
  END IF;
  IF v_so IS NULL AND NEW.metadata ? 'sale_order_id' THEN
    v_so := (NEW.metadata ->> 'sale_order_id')::uuid;
  END IF;
  IF v_so IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.cabedal_prep_product_already_debited(v_so, NEW.product_id) THEN
    -- Skip insert: material já saiu na prep Ateliê
    RETURN NULL;
  END IF;

  -- Soft Ateliê ainda ativa para o mesmo PV+produto → OP não duplica
  IF EXISTS (
    SELECT 1 FROM public.material_reservations mr
     WHERE mr.product_id = NEW.product_id
       AND mr.status = 'reserved'
       AND mr.metadata ->> 'kind' = 'atelier_prep'
       AND (mr.metadata ->> 'sale_order_id')::uuid = v_so
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aa_block_op_reserve_if_atelier_debited
  ON public.material_reservations;
CREATE TRIGGER trg_aa_block_op_reserve_if_atelier_debited
  BEFORE INSERT ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_op_reserve_if_atelier_debited();

-- ─── 10. Kanban helper: status Ateliê por OP × setor ─────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_job_status_for_order_sector(
  p_order_id uuid,
  p_sector text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.pipeline_status
    FROM public.orders o
    JOIN public.cabedal_prep_jobs j ON j.sale_order_id = o.sale_order_id
   WHERE o.id = p_order_id
     AND j.sector = CASE
       WHEN p_sector IN ('Corte Cabedal', 'corte_cabedal') THEN 'corte_cabedal'
       WHEN p_sector IN ('Costura Cabedal', 'costura_cabedal', 'Costura') THEN 'costura_cabedal'
       WHEN p_sector IN ('Aviamento', 'aviamento', 'Mesa') THEN 'aviamento'
       ELSE NULL
     END
     AND j.pipeline_status <> 'cancelled'
   ORDER BY j.updated_at DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_job_status_for_order_sector(uuid, text)
  TO authenticated, service_role;

-- ─── 11. Primeira limpeza: cancela demandas fora do Ateliê (catálogo vazio) ─
SELECT public.reapply_atelier_eligibility();
