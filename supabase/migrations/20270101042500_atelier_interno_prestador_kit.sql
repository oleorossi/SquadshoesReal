-- Ateliê: modo interno × prestador + kit por produtos da ficha.
--
-- Prestador: cut → sent_to_contractor → realized → received_at_factory
-- Interno:   cut → in_progress → done  (sem enviado / sem recebido)
-- Corte do lote continua na fábrica (sem modo).

-- ─── Colunas ────────────────────────────────────────────────────────────────
ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS execution_mode text;

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_execution_mode_check;
ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_execution_mode_check
  CHECK (execution_mode IS NULL OR execution_mode = ANY (ARRAY['internal'::text, 'contractor'::text]));

COMMENT ON COLUMN public.cabedal_prep_jobs.execution_mode IS
  'internal = fábrica (Em realização → Concluído); contractor = prestador (Enviado → Realizado → Conferido). NULL = ainda não decidido.';

ALTER TABLE public.atelier_complex_references
  ADD COLUMN IF NOT EXISTS kit_product_ids uuid[];

COMMENT ON COLUMN public.atelier_complex_references.kit_product_ids IS
  'SKUs da ficha que entram no kit do lote. Quando preenchido, débito/preview filtram por product_id; senão usam material_components (rótulos).';

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS atelier_execution_mode text;

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_atelier_execution_mode_check;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_atelier_execution_mode_check
  CHECK (atelier_execution_mode IS NULL OR atelier_execution_mode = ANY (ARRAY['internal'::text, 'contractor'::text]));

COMMENT ON COLUMN public.sale_order_items.atelier_execution_mode IS
  'Sugestão Ateliê no pedido (interno|prestador). Copiada ao job na materialização; relatório pode sobrescrever antes do 1º OK.';

-- Pipeline: statuses internos
ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;
ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text,
    'cut'::text,
    'sent_to_contractor'::text,
    'realized'::text,
    'received_at_factory'::text,
    'in_progress'::text,
    'done'::text,
    'cancelled'::text
  ]));

-- ─── Candidatos de kit da ficha (BOM + setor) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_sheet_kit_candidates(
  p_reference_id uuid,
  p_sector text
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  component text,
  quantity_per_unit numeric,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (sm.product_id)
         sm.product_id,
         p.name,
         p.unit,
         COALESCE(NULLIF(btrim(sm.part_name), ''), COALESCE(sm.sector, 'BOM')) AS component,
         sm.quantity_per_unit,
         sm.sector
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
   WHERE sm.sheet_id = p_reference_id
     AND sm.product_id IS NOT NULL
     AND COALESCE(sm.is_active, true)
     AND COALESCE(sm.include_in_consumption, true)
     AND (
       (p_sector = 'aviamento' AND (
         sm.sector ILIKE '%aviamento%'
         OR sm.sector ILIKE '%acabamento%'
         OR lower(COALESCE(sm.part_name, '')) LIKE '%binoc%'
         OR lower(COALESCE(sm.part_name, '')) LIKE '%binóculo%'
         OR lower(COALESCE(p.name, '')) LIKE '%binoc%'
         OR lower(COALESCE(p.name, '')) LIKE '%binóculo%'
         OR sm.sector IS NULL
       ))
       OR (p_sector = 'costura_cabedal' AND (
         sm.sector ILIKE '%costura%'
         OR sm.sector ILIKE '%cabedal%'
         OR sm.sector ILIKE '%forra%'
         OR sm.sector IS NULL
       ))
       OR (p_sector = 'corte_cabedal' AND (
         sm.sector ILIKE '%corte%'
         OR sm.sector ILIKE '%cabedal%'
         OR sm.sector IS NULL
       ))
     )
   ORDER BY sm.product_id, sm.quantity_per_unit DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sheet_kit_candidates(uuid, text)
  TO authenticated, service_role;

-- ─── Sync jobs: herda modo do item do PV ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_sync_jobs_for_demand(p_demand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.cabedal_prep_demands%ROWTYPE;
  v_sectors text[];
  v_sec text;
  v_lot_id uuid;
  v_lot_status text;
  v_initial text;
  v_t_start date;
  v_t_end date;
  v_n int := 0;
  v_mode text;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'demand_not_found');
  END IF;
  IF v_d.technical_sheet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_sheet');
  END IF;

  SELECT soi.atelier_execution_mode INTO v_mode
    FROM public.sale_order_items soi
   WHERE soi.id = v_d.sale_order_item_id;

  v_sectors := public.atelier_reference_street_sectors(v_d.technical_sheet_id);

  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.demand_id = p_demand_id
     AND j.pipeline_status = 'awaiting_cut'
     AND NOT (j.sector = ANY (v_sectors));

  IF cardinality(v_sectors) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'sectors', '[]'::jsonb, 'jobs', 0);
  END IF;

  v_lot_id := public.atelier_assign_lot_for_demand(p_demand_id);
  SELECT status INTO v_lot_status FROM public.atelier_lots WHERE id = v_lot_id;
  v_initial := CASE WHEN v_lot_status = 'cut' THEN 'cut' ELSE 'awaiting_cut' END;

  FOREACH v_sec IN ARRAY v_sectors LOOP
    SELECT t.target_start, t.target_end
      INTO v_t_start, v_t_end
      FROM public.atelier_compute_job_targets(
        v_d.sale_order_item_id, v_d.sale_order_id, v_sec, v_d.ready_date
      ) t;

    INSERT INTO public.cabedal_prep_jobs (
      demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
      sector, pairs, color, reference_code, pipeline_status,
      target_start, target_end, lot_id, execution_mode
    ) VALUES (
      p_demand_id, v_d.sale_order_id, v_d.sale_order_item_id, v_d.technical_sheet_id,
      v_sec, v_d.pairs, v_d.color, v_d.reference_code, v_initial,
      v_t_start, v_t_end, v_lot_id, v_mode
    )
    ON CONFLICT (demand_id, sector) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      target_start = EXCLUDED.target_start,
      target_end = EXCLUDED.target_end,
      lot_id = EXCLUDED.lot_id,
      pipeline_status = EXCLUDED.pipeline_status,
      execution_mode = COALESCE(public.cabedal_prep_jobs.execution_mode, EXCLUDED.execution_mode),
      updated_at = now()
    WHERE public.cabedal_prep_jobs.pipeline_status IN ('awaiting_cut', 'cancelled');
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sectors', to_jsonb(v_sectors), 'jobs', v_n, 'lot_id', v_lot_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sync_jobs_for_demand(uuid) TO authenticated, service_role;

-- ─── Definir / trocar modo (antes do 1º OK de rua/interno) ───────────────────
CREATE OR REPLACE FUNCTION public.atelier_set_job_execution_mode(
  p_job_id uuid,
  p_mode text,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('internal', 'contractor') THEN
    RAISE EXCEPTION 'Modo inválido (internal|contractor)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura/Aviamento têm modo interno/prestador' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('awaiting_cut', 'cut') THEN
    RAISE EXCEPTION 'Modo só pode mudar antes do envio/início (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'contractor' AND p_contractor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.contractors c WHERE c.id = p_contractor_id) THEN
      RAISE EXCEPTION 'Prestador inválido' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.cabedal_prep_jobs
     SET execution_mode = p_mode,
         contractor_id = CASE
           WHEN p_mode = 'contractor' THEN COALESCE(p_contractor_id, contractor_id)
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'execution_mode', p_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_set_job_execution_mode(uuid, text, uuid)
  TO authenticated, service_role;

-- ─── OKs internos ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_mark_job_internal_start(p_job_id uuid)
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
     SET pipeline_status = 'in_progress',
         updated_at = now()
   WHERE id = p_job_id
     AND execution_mode = 'internal'
     AND pipeline_status = 'cut'
     AND sector IN ('costura_cabedal', 'aviamento');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job interno precisa estar cortado e no modo interno'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_internal_start(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_mark_job_internal_done(p_job_id uuid)
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
     SET pipeline_status = 'done',
         received_at = COALESCE(received_at, now()),
         updated_at = now()
   WHERE id = p_job_id
     AND execution_mode = 'internal'
     AND pipeline_status = 'in_progress'
     AND sector IN ('costura_cabedal', 'aviamento');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job interno precisa estar em realização'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_internal_done(uuid)
  TO authenticated, service_role;

-- Prestador: enviar exige mode contractor (ou define contractor)
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
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Este job é interno — use Em realização / Concluído' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Corte o lote antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_contractor_id, v_job.contractor_id) IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  END IF;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         execution_mode = 'contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = COALESCE(p_contractor_id, contractor_id),
         atelier_service_number = v_num,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'atelier_service_number', v_num);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid) TO authenticated, service_role;

-- Gate: interno libera em done; prestador em received_at_factory
CREATE OR REPLACE FUNCTION public.atelier_item_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref uuid;
  v_sectors text[];
  v_sec text;
  v_status text;
  v_mode text;
BEGIN
  SELECT soi.reference_id INTO v_ref FROM public.sale_order_items soi WHERE soi.id = p_item_id;
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;
  v_sectors := public.atelier_reference_street_sectors(v_ref);
  IF cardinality(v_sectors) = 0 THEN
    RETURN NULL;
  END IF;
  FOREACH v_sec IN ARRAY v_sectors LOOP
    SELECT j.pipeline_status, j.execution_mode
      INTO v_status, v_mode
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = p_item_id
       AND j.sector = v_sec
       AND j.pipeline_status <> 'cancelled'
     ORDER BY j.updated_at DESC
     LIMIT 1;
    IF v_mode = 'internal' THEN
      IF v_status IS DISTINCT FROM 'done' THEN
        RETURN format(
          'Ateliê — %s interno só libera quando concluído (status: %s)',
          CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END,
          COALESCE(v_status, 'sem job — rode Reaplicar no Ateliê')
        );
      END IF;
    ELSE
      IF v_status IS DISTINCT FROM 'received_at_factory' THEN
        RETURN format(
          'Ateliê — %s só libera após recebido e conferido (status: %s)',
          CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END,
          COALESCE(v_status, 'sem job — rode Reaplicar no Ateliê')
        );
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_item_block_reason(uuid)
  TO authenticated, service_role;

-- OP nasce com etapas feitas: interno done OU prestador received
CREATE OR REPLACE FUNCTION public.tg_atelier_stage_born_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soi uuid;
  v_done boolean := false;
BEGIN
  IF COALESCE(NEW.status, '') = 'concluido'
     OR NEW.stage_name NOT IN ('Corte Cabedal', 'Costura Cabedal', 'Aviamento') THEN
    RETURN NEW;
  END IF;

  SELECT o.sale_order_item_id INTO v_soi FROM public.orders o WHERE o.id = NEW.order_id;
  IF v_soi IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_name = 'Corte Cabedal' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_soi
         AND j.pipeline_status IN (
           'cut', 'sent_to_contractor', 'realized', 'received_at_factory',
           'in_progress', 'done'
         )
    ) INTO v_done;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_soi
         AND j.sector = CASE NEW.stage_name
               WHEN 'Costura Cabedal' THEN 'costura_cabedal'
               ELSE 'aviamento'
             END
         AND (
           (j.execution_mode = 'internal' AND j.pipeline_status = 'done')
           OR (COALESCE(j.execution_mode, 'contractor') <> 'internal'
               AND j.pipeline_status = 'received_at_factory')
         )
    ) INTO v_done;
  END IF;

  IF v_done THEN
    NEW.status := 'concluido';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.quantity_processed := COALESCE(NEW.quantity_total, NEW.quantity_processed);
    NEW.observations := concat_ws(' · ', NULLIF(NEW.observations, ''), 'Feito no Ateliê');
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Kit: débito honra kit_product_ids quando preenchido ────────────────────
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_filter_products(p_reference_id uuid)
RETURNS TABLE (product_id uuid, component text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH refs AS (
    SELECT a.sector,
           a.kit_product_ids,
           COALESCE(a.material_components, public.atelier_default_kit_components(a.sector)) AS comps
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.active
       AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id))
  ),
  by_product AS (
    SELECT DISTINCT unnest(kit_product_ids) AS product_id, sector::text AS component
      FROM refs
     WHERE kit_product_ids IS NOT NULL AND cardinality(kit_product_ids) > 0
  )
  SELECT product_id, component FROM by_product
  UNION ALL
  SELECT NULL::uuid, c
    FROM refs r
    CROSS JOIN LATERAL unnest(r.comps) c
   WHERE NOT EXISTS (SELECT 1 FROM by_product);
$$;

-- Prévia do kit
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_preview(p_lot_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  component text,
  required numeric,
  available numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lot AS (SELECT * FROM public.atelier_lots WHERE id = p_lot_id),
  filt AS (
    SELECT * FROM public.atelier_lot_kit_filter_products((SELECT reference_id FROM lot))
  ),
  dems AS (
    SELECT DISTINCT d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id AND d.status <> 'cancelled'
  ),
  so AS (SELECT DISTINCT sale_order_id FROM dems),
  has_pids AS (SELECT EXISTS (SELECT 1 FROM filt WHERE product_id IS NOT NULL) AS yes)
  SELECT l.product_id, p.name, p.unit, min(l.component), sum(l.required)::numeric,
         GREATEST(COALESCE(p.quantity, 0), 0)
    FROM so
    CROSS JOIN LATERAL public.sale_order_material_demand_lines(so.sale_order_id) l
    JOIN dems ON dems.sale_order_item_id = l.sale_order_item_id
    JOIN public.products p ON p.id = l.product_id
    CROSS JOIN has_pids
   WHERE (
     (has_pids.yes AND l.product_id IN (SELECT f.product_id FROM filt f WHERE f.product_id IS NOT NULL))
     OR (NOT has_pids.yes AND l.component = ANY (SELECT f.component FROM filt f WHERE f.product_id IS NULL))
   )
   GROUP BY l.product_id, p.name, p.unit, p.quantity
   ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_preview(uuid) TO authenticated, service_role;

-- Confirmar corte: mesma lógica de filtro por product_id
CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_dem record;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_items int := 0;
  v_lines int := 0;
  v_pending int := 0;
  v_has_pids boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status = 'cut' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', 'cut');
  END IF;
  IF v_lot.status <> 'open' THEN
    RAISE EXCEPTION 'Lote % está %', v_lot.lot_number, v_lot.status USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.atelier_lot_kit_filter_products(v_lot.reference_id) f WHERE f.product_id IS NOT NULL
  ) INTO v_has_pids;

  FOR v_dem IN
    SELECT d.id, d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id
       AND d.status <> 'cancelled'
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.demand_id = d.id AND j.pipeline_status = 'awaiting_cut'
       )
     ORDER BY d.created_at
  LOOP
    v_items := v_items + 1;

    FOR v_line IN
      SELECT l.product_id, min(l.component) AS component, sum(l.required)::numeric AS required
        FROM public.sale_order_material_demand_lines(v_dem.sale_order_id) l
       WHERE l.sale_order_item_id = v_dem.sale_order_item_id
         AND (
           (v_has_pids AND l.product_id IN (
              SELECT f.product_id FROM public.atelier_lot_kit_filter_products(v_lot.reference_id) f
               WHERE f.product_id IS NOT NULL
            ))
           OR (NOT v_has_pids AND l.component = ANY (
              SELECT f.component FROM public.atelier_lot_kit_filter_products(v_lot.reference_id) f
               WHERE f.product_id IS NULL
            ))
         )
       GROUP BY l.product_id
       ORDER BY l.product_id
    LOOP
      IF COALESCE(v_line.required, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.cabedal_prep_stock_debits s
         WHERE s.sale_order_item_id = v_dem.sale_order_item_id
           AND s.product_id = v_line.product_id
           AND s.lot_id IS NOT NULL
      ) THEN
        CONTINUE;
      END IF;

      SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
      v_mov := NULL;

      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = quantity - v_debit, updated_at = now()
         WHERE id = v_line.product_id;

        INSERT INTO public.stock_movements (
          product_id, order_id, movement_type, quantity,
          previous_stock, new_stock, description, movement_reason
        ) VALUES (
          v_line.product_id, NULL, 'out', v_debit,
          v_prev, v_prev - v_debit,
          'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'atelier_prep'
        )
        RETURNING id INTO v_mov;

        SELECT mr.id INTO v_res_id
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = v_dem.sale_order_id
           AND mr.product_id = v_line.product_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
           AND mr.strap_variant_id IS NULL
           AND mr.sale_order_strap_demand_id IS NULL
         ORDER BY mr.created_at
         LIMIT 1
         FOR UPDATE;

        IF v_res_id IS NOT NULL THEN
          UPDATE public.material_reservations
             SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
                 quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
                 status = CASE
                   WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                        <= COALESCE(quantity_consumed, 0) + v_debit
                     THEN 'consumed'
                   ELSE 'partially_consumed'
                 END,
                 consumed_at = now(),
                 metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('atelier_consumed', true),
                 updated_at = now()
           WHERE id = v_res_id;
        END IF;
      ELSE
        v_res_id := NULL;
      END IF;

      INSERT INTO public.cabedal_prep_stock_debits (
        sale_order_id, sale_order_item_id, product_id, quantity,
        required_qty, pending_qty, component,
        stock_movement_id, sector, lot_id, reservation_id
      ) VALUES (
        v_dem.sale_order_id, v_dem.sale_order_item_id, v_line.product_id, v_debit,
        v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
        v_mov, 'corte_atelier', p_lot_id, v_res_id
      );

      v_lines := v_lines + 1;
      IF v_line.required - v_debit > 0 THEN
        v_pending := v_pending + 1;
      END IF;
    END LOOP;

    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = 'cut', cut_at = now(), updated_at = now()
     WHERE demand_id = v_dem.id AND pipeline_status = 'awaiting_cut';
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Lote % não tem itens aguardando corte', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_lots
     SET status = 'cut', cut_at = now(), cut_by = auth.uid(), updated_at = now()
   WHERE id = p_lot_id;

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'items', v_items, 'lines', v_lines, 'pending_lines', v_pending
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_cut(uuid) TO authenticated, service_role;

-- Listagem: inclui execution_mode + kit_product_ids no payload
CREATE OR REPLACE FUNCTION public.list_atelier_lots()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lots AS (
    SELECT l.* FROM public.atelier_lots l
     WHERE l.status <> 'cancelled'
       AND EXISTS (SELECT 1 FROM public.cabedal_prep_jobs j WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled')
  ),
  items AS (
    SELECT d.lot_id, d.id AS demand_id, d.sale_order_item_id, d.pairs, d.ready_date,
           so.id AS sale_order_id, so.order_number, so.client_name, so.billing_week,
           so.delivery_deadline,
           soi.grade, GREATEST(COALESCE(soi.fichas, 1), 1) AS fichas,
           soi.atelier_execution_mode
      FROM public.cabedal_prep_demands d
      JOIN lots ON lots.id = d.lot_id
      JOIN public.sale_orders so ON so.id = d.sale_order_id
      JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
     WHERE d.status <> 'cancelled'
  ),
  grade AS (
    SELECT i.lot_id, g.key AS size, SUM(COALESCE(NULLIF(g.value, '')::numeric, 0) * i.fichas) AS qty
      FROM items i CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.grade, '{}'::jsonb)) g
     GROUP BY i.lot_id, g.key
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY
            (row ->> 'min_delivery_deadline') NULLS LAST,
            row ->> 'reference_code',
            row ->> 'lot_number'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', l.id, 'lot_number', l.lot_number, 'status', l.status, 'reference_id', l.reference_id,
        'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name),
        'reference_name', ts.name, 'color', l.color, 'material_variant_id', l.material_variant_id,
        'cut_at', l.cut_at,
        'pairs', (SELECT COALESCE(SUM(i.pairs), 0) FROM items i WHERE i.lot_id = l.id),
        'min_ready_date', (SELECT MIN(i.ready_date) FROM items i WHERE i.lot_id = l.id),
        'min_delivery_deadline', (SELECT MIN(i.delivery_deadline) FROM items i WHERE i.lot_id = l.id),
        'grade', (SELECT COALESCE(jsonb_object_agg(g.size, g.qty), '{}'::jsonb) FROM grade g WHERE g.lot_id = l.id AND g.qty > 0),
        'kit_product_ids', (
          SELECT COALESCE(jsonb_agg(DISTINCT pid), '[]'::jsonb)
            FROM public.atelier_complex_references a
            CROSS JOIN LATERAL unnest(COALESCE(a.kit_product_ids, ARRAY[]::uuid[])) pid
           WHERE a.reference_id = l.reference_id AND a.active
             AND a.sector = ANY (public.atelier_reference_street_sectors(l.reference_id))
        ),
        'orders', (SELECT COALESCE(jsonb_agg(y.o ORDER BY
                      y.o ->> 'delivery_deadline' NULLS LAST, y.o ->> 'order_number'), '[]'::jsonb)
                     FROM (
                       SELECT jsonb_build_object(
                                'sale_order_id', i.sale_order_id, 'order_number', i.order_number,
                                'client_name', i.client_name, 'billing_week', i.billing_week,
                                'delivery_deadline', i.delivery_deadline,
                                'pairs', COALESCE(SUM(i.pairs), 0),
                                'atelier_execution_mode', MAX(i.atelier_execution_mode)
                              ) AS o
                         FROM items i
                        WHERE i.lot_id = l.id
                        GROUP BY i.sale_order_id, i.order_number, i.client_name,
                                 i.billing_week, i.delivery_deadline
                     ) y),
        'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', j.id, 'sector', j.sector, 'pipeline_status', j.pipeline_status, 'pairs', j.pairs,
                    'sale_order_item_id', j.sale_order_item_id, 'order_number', so.order_number,
                    'contractor_id', j.contractor_id, 'contractor_name', c.name,
                    'atelier_service_number', j.atelier_service_number, 'target_end', j.target_end,
                    'execution_mode', j.execution_mode
                  ) ORDER BY j.sector, so.order_number), '[]'::jsonb)
                   FROM public.cabedal_prep_jobs j
                   JOIN public.sale_orders so ON so.id = j.sale_order_id
                   LEFT JOIN public.contractors c ON c.id = j.contractor_id
                  WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled'),
        'debits', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'product_id', s.product_id, 'product_name', p.name, 'unit', p.unit,
                     'component', s.component, 'required_qty', s.required_qty,
                     'quantity', s.quantity, 'pending_qty', s.pending_qty
                   ) ORDER BY p.name), '[]'::jsonb)
                    FROM public.cabedal_prep_stock_debits s
                    JOIN public.products p ON p.id = s.product_id
                   WHERE s.lot_id = l.id)
      ) AS row
      FROM lots l JOIN public.technical_sheets ts ON ts.id = l.reference_id
    ) x;
$$;

GRANT EXECUTE ON FUNCTION public.list_atelier_lots() TO authenticated, service_role;
