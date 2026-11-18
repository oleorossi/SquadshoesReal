-- Envio dividido do Ateliê: um job pode ir em partes, uma OS por prestador.
-- Cada parte trava o R$/par digitado (referência vence setor). O despacho
-- leva a grade. O job só fecha quando todas as partes voltarem e não sobrar saldo.
-- OS já enviada ganha uma parte do total, sem novo despacho e sem novo recebimento.

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;

ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text,
    'cut'::text,
    'partially_sent'::text,
    'sent_to_contractor'::text,
    'realized'::text,
    'partially_received'::text,
    'received_at_factory'::text,
    'in_progress'::text,
    'partially_done'::text,
    'done'::text,
    'cancelled'::text
  ]));

CREATE TABLE IF NOT EXISTS public.contractor_reference_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  technical_sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  sector text NOT NULL,
  price_per_pair numeric NOT NULL CHECK (price_per_pair > 0),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, technical_sheet_id, sector, valid_from)
);

ALTER TABLE public.contractor_reference_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contractor_reference_rates FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS contractor_reference_rates_rw ON public.contractor_reference_rates;
CREATE POLICY contractor_reference_rates_rw ON public.contractor_reference_rates
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());
GRANT SELECT, INSERT, UPDATE ON public.contractor_reference_rates TO authenticated;
GRANT ALL ON public.contractor_reference_rates TO service_role;

CREATE TABLE IF NOT EXISTS public.atelier_job_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cabedal_prep_jobs(id) ON DELETE CASCADE,
  execution_mode text NOT NULL CHECK (execution_mode = ANY (ARRAY['contractor'::text, 'internal'::text])),
  contractor_id uuid REFERENCES public.contractors(id),
  pairs integer NOT NULL CHECK (pairs > 0),
  grade jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  unit_price numeric,
  suggested_unit_price numeric,
  price_source text,
  return_on date,
  pipeline_status text NOT NULL,
  sent_at timestamptz,
  received_pairs numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atelier_job_parts_job ON public.atelier_job_parts (job_id);
CREATE INDEX IF NOT EXISTS idx_atelier_job_parts_os ON public.atelier_job_parts (service_order_id);

ALTER TABLE public.atelier_job_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atelier_job_parts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS atelier_job_parts_read ON public.atelier_job_parts;
CREATE POLICY atelier_job_parts_read ON public.atelier_job_parts
  FOR SELECT TO authenticated
  USING (public.is_approved_user());
GRANT SELECT ON public.atelier_job_parts TO authenticated;
GRANT ALL ON public.atelier_job_parts TO service_role;

ALTER TABLE public.service_order_items
  ADD COLUMN IF NOT EXISTS atelier_part_id uuid REFERENCES public.atelier_job_parts(id) ON DELETE SET NULL;

ALTER TABLE public.service_order_dispatches
  ADD COLUMN IF NOT EXISTS grade jsonb;

ALTER TABLE public.atelier_job_receipts
  ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.atelier_job_parts(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.uq_service_order_items_atelier_job;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_items_atelier_job_legacy
  ON public.service_order_items (atelier_job_id)
  WHERE atelier_job_id IS NOT NULL AND atelier_part_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_items_atelier_part
  ON public.service_order_items (atelier_part_id)
  WHERE atelier_part_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.atelier_job_size_grade(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairs numeric;
  v_grade jsonb;
  v_fichas int;
  v_key text;
  v_qty numeric;
  v_target int;
  v_sum int := 0;
  v_keys text[] := ARRAY[]::text[];
  v_floors int[] := ARRAY[]::int[];
  v_fracs numeric[] := ARRAY[]::numeric[];
  v_exact numeric;
  v_left int;
  v_best int;
  v_i int;
  v_out jsonb := '{}'::jsonb;
BEGIN
  SELECT j.pairs, COALESCE(soi.grade, '{}'::jsonb), GREATEST(COALESCE(soi.fichas, 1), 1)::int
    INTO v_pairs, v_grade, v_fichas
    FROM public.cabedal_prep_jobs j
    LEFT JOIN public.sale_order_items soi ON soi.id = j.sale_order_item_id
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;
  v_target := GREATEST(trunc(COALESCE(v_pairs, 0))::int, 0);
  FOR v_key, v_qty IN
    SELECT g.key, trunc(COALESCE(NULLIF(g.value, '')::numeric, 0))
      FROM jsonb_each_text(COALESCE(v_grade, '{}'::jsonb)) g
     WHERE g.key ~ '^[0-9]+(/[0-9]+)?$'
  LOOP
    IF v_qty > 0 THEN
      v_keys := v_keys || v_key;
      v_floors := v_floors || (v_qty * v_fichas)::int;
      v_sum := v_sum + (v_qty * v_fichas)::int;
    END IF;
  END LOOP;
  IF v_sum = 0 THEN
    IF v_target > 0 THEN
      RETURN jsonb_build_object('pares', v_target);
    END IF;
    RETURN '{}'::jsonb;
  END IF;
  IF v_sum = v_target OR v_target = 0 THEN
    FOR v_i IN 1..cardinality(v_keys) LOOP
      v_out := v_out || jsonb_build_object(v_keys[v_i], v_floors[v_i]);
    END LOOP;
    RETURN v_out;
  END IF;
  v_fracs := ARRAY[]::numeric[];
  FOR v_i IN 1..cardinality(v_keys) LOOP
    v_exact := v_floors[v_i] * v_target::numeric / v_sum;
    v_fracs := v_fracs || (v_exact - floor(v_exact));
    v_floors[v_i] := floor(v_exact)::int;
  END LOOP;
  v_left := v_target - COALESCE((SELECT SUM(x) FROM unnest(v_floors) x), 0);
  WHILE v_left > 0 LOOP
    v_best := 1;
    FOR v_i IN 2..cardinality(v_keys) LOOP
      IF v_fracs[v_i] > v_fracs[v_best] OR (v_fracs[v_i] = v_fracs[v_best] AND v_i < v_best) THEN
        v_best := v_i;
      END IF;
    END LOOP;
    v_floors[v_best] := v_floors[v_best] + 1;
    v_fracs[v_best] := -1;
    v_left := v_left - 1;
  END LOOP;
  FOR v_i IN 1..cardinality(v_keys) LOOP
    IF v_floors[v_i] > 0 THEN
      v_out := v_out || jsonb_build_object(v_keys[v_i], v_floors[v_i]);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_size_grade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_size_grade(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_job_remaining_grade(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base jsonb := public.atelier_job_size_grade(p_job_id);
  v_part jsonb;
  v_key text;
  v_qty numeric;
  v_have int;
BEGIN
  FOR v_part IN
    SELECT grade FROM public.atelier_job_parts WHERE job_id = p_job_id
  LOOP
    FOR v_key, v_qty IN SELECT g.key, g.value::numeric FROM jsonb_each_text(COALESCE(v_part, '{}'::jsonb)) g LOOP
      v_have := COALESCE((v_base ->> v_key)::int, 0) - trunc(v_qty)::int;
      v_base := jsonb_set(COALESCE(v_base, '{}'::jsonb), ARRAY[v_key], to_jsonb(GREATEST(v_have, 0)), true);
    END LOOP;
  END LOOP;
  RETURN COALESCE((
    SELECT jsonb_object_agg(g.key, g.value::int)
      FROM jsonb_each_text(COALESCE(v_base, '{}'::jsonb)) g
     WHERE g.value::int > 0
  ), '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_remaining_grade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_remaining_grade(uuid) TO authenticated, service_role;

-- Cada ramo do UNION fica entre parênteses. ORDER BY/LIMIT solto antes do
-- UNION ALL é erro de sintaxe e a função nem chega a ser criada.
CREATE OR REPLACE FUNCTION public.atelier_suggested_pair_price(
  p_contractor_id uuid,
  p_sector text,
  p_sheet_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(price numeric, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT r.price_per_pair, 'referencia'::text
      FROM public.contractor_reference_rates r
     WHERE r.contractor_id = p_contractor_id
       AND r.technical_sheet_id = p_sheet_id
       AND lower(r.sector) = lower(COALESCE(public.atelier_rate_sector(p_sector), p_sector))
       AND r.valid_from <= p_date
       AND (r.valid_to IS NULL OR r.valid_to >= p_date)
     ORDER BY r.valid_from DESC
     LIMIT 1
  )
  UNION ALL
  (
    SELECT public.get_contractor_rate(
             p_contractor_id,
             COALESCE(public.atelier_rate_sector(p_sector), p_sector),
             p_date
           ),
           'setor'::text
     WHERE NOT EXISTS (
       SELECT 1 FROM public.contractor_reference_rates r
        WHERE r.contractor_id = p_contractor_id
          AND r.technical_sheet_id = p_sheet_id
          AND lower(r.sector) = lower(COALESCE(public.atelier_rate_sector(p_sector), p_sector))
          AND r.valid_from <= p_date
          AND (r.valid_to IS NULL OR r.valid_to >= p_date)
     )
  );
$$;

REVOKE ALL ON FUNCTION public.atelier_suggested_pair_price(uuid, text, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_suggested_pair_price(uuid, text, uuid, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_save_reference_rate(
  p_contractor_id uuid,
  p_sheet_id uuid,
  p_sector text,
  p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sector text := COALESCE(public.atelier_rate_sector(p_sector), p_sector);
  v_price numeric := round(p_price, 2);
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Só admin ou gerência grava a tarifa da referência' USING ERRCODE = '42501';
  END IF;
  IF v_price IS NULL OR v_price <= 0 OR p_contractor_id IS NULL OR p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'A tarifa da referência precisa de prestador, ficha e R$/par' USING ERRCODE = '22023';
  END IF;
  UPDATE public.contractor_reference_rates
     SET valid_to = CURRENT_DATE - 1
   WHERE contractor_id = p_contractor_id
     AND technical_sheet_id = p_sheet_id
     AND lower(sector) = lower(v_sector)
     AND valid_to IS NULL
     AND valid_from < CURRENT_DATE;
  INSERT INTO public.contractor_reference_rates (
    contractor_id, technical_sheet_id, sector, price_per_pair, valid_from, created_by
  ) VALUES (
    p_contractor_id, p_sheet_id, v_sector, v_price, CURRENT_DATE, auth.uid()
  )
  ON CONFLICT (contractor_id, technical_sheet_id, sector, valid_from)
  DO UPDATE SET price_per_pair = EXCLUDED.price_per_pair, valid_to = NULL, created_by = auth.uid();
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(), 'tarifa_referencia_atelie', 'contractor_reference_rates', p_sheet_id::text,
    jsonb_build_object('contractor_id', p_contractor_id, 'sector', v_sector, 'price_per_pair', v_price),
    true, now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_save_reference_rate(uuid, uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_save_reference_rate(uuid, uuid, text, numeric)
  TO authenticated, service_role;

-- O envio inteiro antigo continua achando a linha única do job.
CREATE OR REPLACE FUNCTION public.atelier_attach_job_line(
  p_service_order_id uuid,
  p_job_id uuid,
  p_contractor_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_sector text;
  v_label text;
  v_price numeric;
  v_order text;
  v_lot text;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Job interno não entra em ordem de serviço' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.atelier_job_parts p WHERE p.job_id = p_job_id) THEN
    RAISE EXCEPTION 'Este job já tem envio dividido. Use o painel de prestadores.'
      USING ERRCODE = '22023';
  END IF;

  v_sector := public.atelier_rate_sector(v_job.sector);
  v_label := CASE v_sector
    WHEN 'costura' THEN 'Costura de cabedal'
    WHEN 'mesa' THEN 'Aviamento'
    ELSE COALESCE(v_sector, v_job.sector)
  END;
  v_price := public.get_contractor_rate(p_contractor_id, v_sector, CURRENT_DATE);
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Cadastre a tarifa vigente de % deste prestador antes de enviar', v_label
      USING ERRCODE = '22023';
  END IF;

  SELECT so.order_number INTO v_order FROM public.sale_orders so WHERE so.id = v_job.sale_order_id;
  SELECT l.lot_number INTO v_lot FROM public.atelier_lots l WHERE l.id = v_job.lot_id;

  INSERT INTO public.service_order_items (
    service_order_id, atelier_job_id, source_item_key,
    material_name, description, sale_order_id, color,
    target_sector, sector, quantity, unit, unit_price, total_value,
    line_status, sent_at
  ) VALUES (
    p_service_order_id, v_job.id, 'atelier:' || v_job.id::text,
    COALESCE(NULLIF(btrim(v_job.reference_code), ''), 'Ateliê'),
    trim(both ' · ' FROM concat_ws(' · ', v_label, NULLIF(btrim(v_lot), ''), NULLIF(btrim(v_job.color), ''), NULLIF(btrim(v_order), ''))),
    v_job.sale_order_id, NULLIF(btrim(v_job.color), ''),
    v_sector, v_sector, v_job.pairs, 'par', v_price, v_job.pairs * v_price,
    'Pendente', now()
  )
  ON CONFLICT (atelier_job_id) WHERE atelier_part_id IS NULL DO NOTHING;

  RETURN v_price;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_attach_job_line(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_attach_job_line(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_send_split(p_job_id uuid, p_parts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_remaining jsonb;
  v_elem jsonb;
  v_mode text;
  v_contractor uuid;
  v_grade jsonb;
  v_key text;
  v_qty int;
  v_pairs int;
  v_used jsonb := '{}'::jsonb;
  v_have int;
  v_price numeric;
  v_suggested numeric;
  v_source text;
  v_save boolean;
  v_part uuid;
  v_os uuid;
  v_os_number text;
  v_orders uuid[];
  v_label text;
  v_sector text;
  v_lot text;
  v_order text;
  v_capacity int;
  v_offset int;
  v_days int;
  v_due date;
  v_os_ids uuid[] := ARRAY[]::uuid[];
  v_alloc int;
  v_any_contractor boolean := false;
  v_edited boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos uma parte' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'partially_sent') THEN
    RAISE EXCEPTION 'O envio dividido sai de um job cortado, com ou sem saldo' USING ERRCODE = '22023';
  END IF;
  IF v_job.sale_order_id IS NULL THEN
    RAISE EXCEPTION 'A OS do Ateliê precisa do PV do job.' USING ERRCODE = '22023';
  END IF;
  IF v_job.lot_id IS NOT NULL AND NOT public.atelier_lot_kit_is_closed(v_job.lot_id) THEN
    RAISE EXCEPTION 'O kit ainda não fechou. O envio espera isso' USING ERRCODE = '22023';
  END IF;

  v_remaining := public.atelier_job_remaining_grade(p_job_id);

  -- Validação por tamanho contra o saldo, e gravação das partes.
  CREATE TEMP TABLE IF NOT EXISTS atelier_split_buffer (
    mode text, contractor_id uuid, grade jsonb, pairs int, unit_price numeric,
    suggested numeric, source text, save_rate boolean, part_id uuid
  ) ON COMMIT DROP;
  DELETE FROM atelier_split_buffer;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_mode := COALESCE(v_elem ->> 'mode', 'contractor');
    IF v_mode NOT IN ('contractor', 'internal') THEN
      RAISE EXCEPTION 'Parte inválida' USING ERRCODE = '22023';
    END IF;
    v_contractor := NULLIF(v_elem ->> 'contractor_id', '')::uuid;
    v_grade := COALESCE(v_elem -> 'grade', '{}'::jsonb);
    v_pairs := 0;
    FOR v_key, v_qty IN
      SELECT g.key, trunc(COALESCE(NULLIF(g.value, '')::numeric, 0))::int
        FROM jsonb_each_text(v_grade) g
    LOOP
      IF v_qty < 0 THEN
        RAISE EXCEPTION 'A grade só aceita pares inteiros, sem fração e sem negativo' USING ERRCODE = '22023';
      END IF;
      IF (v_elem -> 'grade' ->> v_key)::numeric <> trunc((v_elem -> 'grade' ->> v_key)::numeric) THEN
        RAISE EXCEPTION 'A grade só aceita pares inteiros, sem fração e sem negativo' USING ERRCODE = '22023';
      END IF;
      v_have := COALESCE((v_used ->> v_key)::int, 0) + v_qty;
      IF v_have > COALESCE((v_remaining ->> v_key)::int, 0) THEN
        RAISE EXCEPTION 'O tamanho % passa do saldo: % de %', v_key, v_have, COALESCE((v_remaining ->> v_key)::int, 0)
          USING ERRCODE = '22023';
      END IF;
      v_used := jsonb_set(v_used, ARRAY[v_key], to_jsonb(v_have), true);
      v_pairs := v_pairs + v_qty;
    END LOOP;
    IF v_pairs <= 0 THEN
      CONTINUE;
    END IF;
    v_price := NULL;
    v_suggested := NULL;
    v_source := NULL;
    v_save := COALESCE((v_elem ->> 'save_reference_rate')::boolean, false);
    IF v_mode = 'contractor' THEN
      IF v_contractor IS NULL THEN
        RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
      END IF;
      IF NOT public.atelier_contractor_can_take(v_contractor, v_job.sector) THEN
        RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
      END IF;
      SELECT s.price, s.source INTO v_suggested, v_source
        FROM public.atelier_suggested_pair_price(v_contractor, v_job.sector, v_job.technical_sheet_id, CURRENT_DATE) s
       LIMIT 1;
      v_price := round(COALESCE((v_elem ->> 'unit_price')::numeric, v_suggested), 2);
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'Informe o R$/par deste prestador' USING ERRCODE = '22023';
      END IF;
      v_edited := v_suggested IS NULL OR round(v_suggested, 2) IS DISTINCT FROM v_price;
      IF (v_edited OR v_save) AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
        RAISE EXCEPTION 'Só admin ou gerência altera o R$/par' USING ERRCODE = '42501';
      END IF;
      v_any_contractor := true;
    ELSE
      v_contractor := NULL;
      v_save := false;
    END IF;
    INSERT INTO atelier_split_buffer (mode, contractor_id, grade, pairs, unit_price, suggested, source, save_rate)
    VALUES (v_mode, v_contractor, v_grade, v_pairs, v_price, v_suggested, v_source, v_save);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM atelier_split_buffer) THEN
    RAISE EXCEPTION 'Informe ao menos 1 par' USING ERRCODE = '22023';
  END IF;

  SELECT so.order_number INTO v_order FROM public.sale_orders so WHERE so.id = v_job.sale_order_id;
  SELECT l.lot_number INTO v_lot FROM public.atelier_lots l WHERE l.id = v_job.lot_id;
  v_sector := public.atelier_rate_sector(v_job.sector);
  v_label := CASE v_sector
    WHEN 'costura' THEN 'Costura de cabedal'
    WHEN 'mesa' THEN 'Aviamento'
    ELSE COALESCE(v_sector, v_job.sector)
  END;
  SELECT CASE WHEN v_job.sector = 'aviamento' THEN s.aviamento_offset_days ELSE s.costura_offset_days END
    INTO v_offset FROM public.atelier_settings s WHERE s.id = 1;
  v_offset := GREATEST(0, COALESCE(v_offset, 5));

  FOR v_contractor IN
    SELECT DISTINCT contractor_id FROM atelier_split_buffer WHERE mode = 'contractor'
  LOOP
    v_orders := ARRAY[v_job.sale_order_id];
    INSERT INTO public.service_orders (
      contractor_id, status, service_date, description, notes,
      dispatch_tracked, quantity, unit_price, total_value,
      service_order_domain, material_requirements, is_avulsa,
      sale_order_id, source_sale_order_id,
      linked_sale_order_ids, selected_sale_order_item_ids
    ) VALUES (
      v_contractor, 'Em Andamento', CURRENT_DATE, 'Remessa do Ateliê',
      'Uma OS para o prestador neste envio dividido.',
      true, 0, 0, 0, 'generic', '{}'::jsonb, false,
      v_job.sale_order_id, v_job.sale_order_id, v_orders,
      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL ELSE ARRAY[v_job.sale_order_item_id] END
    )
    RETURNING id, order_number INTO v_os, v_os_number;
    v_os_ids := v_os_ids || v_os;

    FOR v_elem IN
      SELECT row_to_json(b)::jsonb FROM atelier_split_buffer b WHERE b.contractor_id = v_contractor
    LOOP
      v_grade := v_elem -> 'grade';
      v_pairs := (v_elem ->> 'pairs')::int;
      v_price := (v_elem ->> 'unit_price')::numeric;
      v_suggested := NULLIF(v_elem ->> 'suggested', '')::numeric;
      v_source := v_elem ->> 'source';
      v_save := COALESCE((v_elem ->> 'save_rate')::boolean, false);
      SELECT c.capacity_pairs_per_day INTO v_capacity
        FROM public.contractor_model_capacities c
       WHERE c.contractor_id = v_contractor
         AND c.technical_sheet_id = v_job.technical_sheet_id
         AND c.sector = v_job.sector
       LIMIT 1;
      v_days := CASE WHEN v_capacity IS NOT NULL AND v_capacity > 0
        THEN CEIL(v_pairs::numeric / v_capacity)::int ELSE v_offset END;
      v_due := public.add_business_days(CURRENT_DATE, v_days);

      INSERT INTO public.atelier_job_parts (
        job_id, execution_mode, contractor_id, pairs, grade, service_order_id,
        unit_price, suggested_unit_price, price_source, return_on,
        pipeline_status, sent_at, created_by
      ) VALUES (
        p_job_id, 'contractor', v_contractor, v_pairs, v_grade, v_os,
        v_price, v_suggested, COALESCE(v_source, 'digitado'), v_due,
        'sent_to_contractor', now(), auth.uid()
      ) RETURNING id INTO v_part;

      INSERT INTO public.service_order_items (
        service_order_id, atelier_job_id, atelier_part_id, source_item_key,
        material_name, description, sale_order_id, color,
        target_sector, sector, quantity, unit, unit_price, total_value,
        line_status, sent_at
      ) VALUES (
        v_os, p_job_id, v_part, 'atelier-part:' || v_part::text,
        COALESCE(NULLIF(btrim(v_job.reference_code), ''), 'Ateliê'),
        trim(both ' · ' FROM concat_ws(' · ', v_label, NULLIF(btrim(v_lot), ''), NULLIF(btrim(v_job.color), ''), NULLIF(btrim(v_order), ''))),
        v_job.sale_order_id, NULLIF(btrim(v_job.color), ''),
        v_sector, v_sector, v_pairs, 'par', v_price, round(v_pairs * v_price, 2),
        'Pendente', now()
      );

      IF v_suggested IS NULL OR round(v_suggested, 2) IS DISTINCT FROM round(v_price, 2) THEN
        INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
        VALUES (
          auth.uid(), 'preco_parte_atelie', 'service_orders', v_os::text,
          jsonb_build_object(
            'part_id', v_part, 'order_number', v_os_number,
            'suggested_unit_price', v_suggested, 'unit_price', v_price,
            'contractor_id', v_contractor
          ),
          true, now()
        );
      END IF;
      IF v_save THEN
        PERFORM public.atelier_save_reference_rate(v_contractor, v_job.technical_sheet_id, v_job.sector, v_price);
      END IF;
    END LOOP;

    UPDATE public.service_orders so
       SET quantity = src.qty,
           total_value = src.total,
           unit_price = CASE WHEN src.qty > 0 THEN round(src.total / src.qty, 4) ELSE 0 END,
           quoted_deadline = src.due,
           updated_at = now()
      FROM (
        SELECT COALESCE(SUM(i.quantity), 0) AS qty,
               COALESCE(SUM(i.total_value), 0) AS total,
               MIN(p.return_on) AS due
          FROM public.service_order_items i
          LEFT JOIN public.atelier_job_parts p ON p.id = i.atelier_part_id
         WHERE i.service_order_id = v_os
      ) src
     WHERE so.id = v_os;

    INSERT INTO public.service_order_dispatches (
      service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, grade, created_by
    )
    SELECT v_os, v_contractor, p.pairs, now(), 'atelier-part:' || p.id::text, p.grade, auth.uid()
      FROM public.atelier_job_parts p
     WHERE p.service_order_id = v_os
       AND NOT EXISTS (
         SELECT 1 FROM public.service_order_dispatches d
          WHERE d.notes = 'atelier-part:' || p.id::text
       );

    UPDATE public.cabedal_prep_jobs
       SET atelier_service_number = v_os_number
     WHERE id = p_job_id
       AND (atelier_service_number IS NULL OR atelier_service_number LIKE 'ATELIE-%');
  END LOOP;

  FOR v_elem IN
    SELECT row_to_json(b)::jsonb FROM atelier_split_buffer b WHERE b.mode = 'internal'
  LOOP
    v_due := public.add_business_days(COALESCE(v_job.target_end, CURRENT_DATE), v_offset);
    INSERT INTO public.atelier_job_parts (
      job_id, execution_mode, pairs, grade, return_on, pipeline_status, sent_at, created_by
    ) VALUES (
      p_job_id, 'internal', (v_elem ->> 'pairs')::int, v_elem -> 'grade', v_due,
      'in_progress', now(), auth.uid()
    );
  END LOOP;

  SELECT COALESCE(SUM(pairs), 0) INTO v_alloc FROM public.atelier_job_parts WHERE job_id = p_job_id;
  UPDATE public.cabedal_prep_jobs
     SET          pipeline_status = CASE
           WHEN v_alloc + 1e-9 >= pairs THEN
             CASE WHEN v_any_contractor THEN 'sent_to_contractor' ELSE 'in_progress' END
           ELSE 'partially_sent'
         END,
         sent_at = COALESCE(sent_at, now()),
         service_order_id = COALESCE(service_order_id, v_os_ids[1]),
         contractor_id = COALESCE(contractor_id, (
           SELECT p.contractor_id FROM public.atelier_job_parts p
            WHERE p.job_id = p_job_id AND p.contractor_id IS NOT NULL
            ORDER BY p.created_at LIMIT 1
         )),
         updated_at = now()
   WHERE id = p_job_id;

  UPDATE public.atelier_lots l
     SET dispatch_signal = NULL, updated_at = now()
   WHERE l.id = v_job.lot_id
     AND NOT EXISTS (
       SELECT 1 FROM public.cabedal_prep_jobs j
        WHERE j.lot_id = l.id
          AND j.pipeline_status IN ('awaiting_cut', 'cut')
          AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
     );

  RETURN jsonb_build_object(
    'ok', true,
    'service_order_ids', to_jsonb(v_os_ids),
    'remaining_pairs', GREATEST(trunc(v_job.pairs)::int - v_alloc, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_send_split(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_send_split(uuid, jsonb) TO authenticated, service_role;

-- OS de Ateliê já enviada vira uma parte do total. Não cria despacho nem recebimento.
INSERT INTO public.atelier_job_parts (
  job_id, execution_mode, contractor_id, pairs, grade, service_order_id,
  unit_price, price_source, pipeline_status, sent_at, received_pairs, created_at
)
SELECT
  j.id,
  CASE WHEN j.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END,
  j.contractor_id,
  GREATEST(trunc(j.pairs)::int, 1),
  public.atelier_job_size_grade(j.id),
  j.service_order_id,
  i.unit_price,
  'setor',
  j.pipeline_status,
  j.sent_at,
  j.received_pairs,
  COALESCE(j.sent_at, now())
FROM public.cabedal_prep_jobs j
JOIN public.service_order_items i
  ON i.atelier_job_id = j.id
 AND i.service_order_id = j.service_order_id
WHERE j.service_order_id IS NOT NULL
  AND j.pipeline_status IN ('sent_to_contractor', 'realized', 'partially_received', 'received_at_factory')
  AND NOT EXISTS (SELECT 1 FROM public.atelier_job_parts p WHERE p.job_id = j.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.service_order_items i2
     WHERE i2.atelier_job_id = j.id AND i2.id <> i.id
  );

UPDATE public.service_order_items i
   SET atelier_part_id = p.id
  FROM public.atelier_job_parts p
 WHERE i.atelier_job_id = p.job_id
   AND i.service_order_id = p.service_order_id
   AND i.atelier_part_id IS NULL;

CREATE OR REPLACE FUNCTION public.atelier_apply_received_total(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_received numeric;
  v_alloc numeric;
  v_status text;
  v_part public.atelier_job_parts%ROWTYPE;
  v_part_received numeric;
  v_open boolean;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_received := public.atelier_job_open_received(p_job_id);
  IF NOT EXISTS (SELECT 1 FROM public.atelier_job_parts WHERE job_id = p_job_id) THEN
    IF v_received <= 0 THEN
      v_status := CASE
        WHEN v_job.execution_mode = 'internal' THEN 'in_progress'
        WHEN v_job.realized_at IS NOT NULL THEN 'realized'
        ELSE 'sent_to_contractor'
      END;
    ELSIF v_received < v_job.pairs THEN
      v_status := CASE WHEN v_job.execution_mode = 'internal' THEN 'partially_done' ELSE 'partially_received' END;
    ELSE
      v_status := CASE WHEN v_job.execution_mode = 'internal' THEN 'done' ELSE 'received_at_factory' END;
    END IF;
  ELSE
    FOR v_part IN SELECT * FROM public.atelier_job_parts WHERE job_id = p_job_id FOR UPDATE LOOP
      SELECT COALESCE(SUM(r.pairs + COALESCE(r.qty_defect, 0) + COALESCE(r.qty_loss, 0)), 0)
        INTO v_part_received
        FROM public.atelier_job_receipts r
       WHERE r.part_id = v_part.id AND r.reversed_at IS NULL;
      UPDATE public.atelier_job_parts
         SET received_pairs = v_part_received,
             pipeline_status = CASE
               WHEN v_part_received <= 0 THEN pipeline_status
               WHEN v_part_received + 1e-9 >= pairs THEN
                 CASE WHEN execution_mode = 'internal' THEN 'done' ELSE 'received_at_factory' END
               ELSE
                 CASE WHEN execution_mode = 'internal' THEN 'partially_done' ELSE 'partially_received' END
             END,
             updated_at = now()
       WHERE id = v_part.id;
    END LOOP;
    SELECT COALESCE(SUM(pairs), 0) INTO v_alloc FROM public.atelier_job_parts WHERE job_id = p_job_id;
    v_open := EXISTS (
      SELECT 1 FROM public.atelier_job_parts
       WHERE job_id = p_job_id AND received_pairs + 1e-9 < pairs
    );
    IF v_job.pairs - v_alloc > 0.5 THEN
      v_status := CASE WHEN v_received > 0 THEN 'partially_received' ELSE 'partially_sent' END;
    ELSIF NOT v_open THEN
      v_status := CASE
        WHEN EXISTS (SELECT 1 FROM public.atelier_job_parts WHERE job_id = p_job_id AND execution_mode = 'contractor')
          THEN 'received_at_factory' ELSE 'done' END;
    ELSIF v_received > 0 THEN
      v_status := 'partially_received';
    ELSIF v_job.pipeline_status = 'realized' THEN
      v_status := 'realized';
    ELSIF NOT EXISTS (SELECT 1 FROM public.atelier_job_parts WHERE job_id = p_job_id AND execution_mode = 'contractor') THEN
      v_status := 'in_progress';
    ELSE
      v_status := 'sent_to_contractor';
    END IF;
  END IF;
  UPDATE public.cabedal_prep_jobs
     SET received_pairs = v_received,
         pipeline_status = v_status,
         received_at = CASE
           WHEN v_status IN ('received_at_factory', 'done') THEN COALESCE(received_at, now())
           ELSE received_at
         END,
         updated_at = now()
   WHERE id = p_job_id;
  PERFORM public.atelier_sync_stage_from_job(p_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_apply_received_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_apply_received_total(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.atelier_mark_job_realized(p_job_id uuid)
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
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Job precisa estar enviado ao prestador (Costura ou Aviamento)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.atelier_job_parts
     SET pipeline_status = 'realized', updated_at = now()
   WHERE job_id = p_job_id
     AND execution_mode = 'contractor'
     AND pipeline_status = 'sent_to_contractor';
  IF v_job.pipeline_status = 'sent_to_contractor'
     OR EXISTS (
       SELECT 1 FROM public.atelier_job_parts
        WHERE job_id = p_job_id AND pipeline_status = 'realized'
     ) THEN
    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = CASE
             WHEN pipeline_status = 'partially_sent' THEN 'partially_sent'
             ELSE 'realized'
           END,
           realized_at = COALESCE(realized_at, now()),
           updated_at = now()
     WHERE id = p_job_id
       AND pipeline_status IN ('sent_to_contractor', 'partially_sent', 'realized');
  ELSE
    RAISE EXCEPTION 'Job precisa estar enviado ao prestador (Costura ou Aviamento)' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_mark_job_realized(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_mark_job_realized(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_post_receipt_return(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.atelier_job_receipts%ROWTYPE;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_part public.atelier_job_parts%ROWTYPE;
  v_line public.service_order_items%ROWTYPE;
  v_os uuid;
  v_contractor uuid;
  v_price numeric;
  v_return uuid;
  v_good integer;
  v_defect integer;
  v_loss integer;
  v_amount numeric;
  v_physical integer;
BEGIN
  SELECT * INTO v_receipt FROM public.atelier_job_receipts WHERE id = p_receipt_id;
  IF NOT FOUND OR v_receipt.reversed_at IS NOT NULL THEN
    RETURN;
  END IF;
  v_good := public.atelier_whole_pairs(v_receipt.pairs, 'Pares bons');
  v_defect := public.atelier_whole_pairs(COALESCE(v_receipt.qty_defect, 0), 'Pares com defeito');
  v_loss := public.atelier_whole_pairs(COALESCE(v_receipt.qty_loss, 0), 'Pares perdidos');
  IF v_good <= 0 THEN
    RAISE EXCEPTION 'A conferência precisa de ao menos 1 par bom' USING ERRCODE = '22023';
  END IF;
  v_physical := v_good + v_defect + v_loss;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_receipt.job_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_receipt.part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM public.atelier_job_parts WHERE id = v_receipt.part_id;
    IF NOT FOUND OR v_part.execution_mode = 'internal' OR v_part.service_order_id IS NULL THEN
      RETURN;
    END IF;
    v_os := v_part.service_order_id;
    v_contractor := v_part.contractor_id;
    v_price := COALESCE(v_part.unit_price, 0);
    SELECT * INTO v_line FROM public.service_order_items WHERE atelier_part_id = v_part.id LIMIT 1;
  ELSE
    IF v_job.execution_mode = 'internal' OR v_job.service_order_id IS NULL THEN
      RETURN;
    END IF;
    v_os := v_job.service_order_id;
    v_contractor := v_job.contractor_id;
    SELECT * INTO v_line
      FROM public.service_order_items
     WHERE atelier_job_id = v_job.id
     ORDER BY created_at
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    v_price := COALESCE(v_line.unit_price, 0);
  END IF;
  v_amount := ROUND(v_good * COALESCE(v_price, 0), 2);
  INSERT INTO public.service_order_returns (
    service_order_id, contractor_id, returned_at,
    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, atelier_job_receipt_id
  ) VALUES (
    v_os, v_contractor, COALESCE(v_receipt.created_at, now()),
    v_good, v_defect, 0, v_loss,
    NULLIF(btrim(COALESCE(v_receipt.note, '')), ''),
    v_receipt.created_by, v_receipt.id
  )
  ON CONFLICT (atelier_job_receipt_id) DO NOTHING
  RETURNING id INTO v_return;
  IF v_return IS NULL THEN
    SELECT id INTO v_return FROM public.service_order_returns WHERE atelier_job_receipt_id = v_receipt.id;
  END IF;
  IF v_job.sale_order_item_id IS NOT NULL AND v_return IS NOT NULL THEN
    INSERT INTO public.service_order_return_items (
      service_order_return_id, service_order_id, sale_order_item_id,
      qty_good, qty_defect, qty_defect_scrapped, qty_loss
    )
    SELECT v_return, v_os, v_job.sale_order_item_id, v_good, v_defect, 0, v_loss
     WHERE NOT EXISTS (
       SELECT 1 FROM public.service_order_return_items i
        WHERE i.service_order_return_id = v_return
          AND i.sale_order_item_id = v_job.sale_order_item_id
     );
  END IF;
  IF v_line.id IS NOT NULL THEN
    UPDATE public.service_order_items
       SET delivered_qty = COALESCE(delivered_qty, 0) + v_physical,
           line_status = CASE
             WHEN COALESCE(delivered_qty, 0) + v_physical >= quantity THEN 'Entregue'
             ELSE line_status
           END,
           updated_at = now()
     WHERE id = v_line.id;
  END IF;
  UPDATE public.accounts_payable
     SET amount = v_amount,
         notes = COALESCE(notes, '') || ' Valor dos pares bons, na tarifa travada no envio.'
   WHERE reference_type = 'service_order_return'
     AND reference_id = v_return
     AND status = 'pending';
  IF NOT FOUND AND v_amount > 0 THEN
    INSERT INTO public.accounts_payable (
      description, category, due_date, amount, status, reference_id, reference_type, notes
    )
    SELECT
      'OS ' || COALESCE(so.order_number, so.id::text) || ' — conferência Ateliê (' || v_good || ' pares bons)',
      'service', CURRENT_DATE + COALESCE(c.payment_days, 30), v_amount, 'pending', v_return,
      'service_order_return',
      'Pares bons × tarifa travada no envio. Defeito e perda não geram título.'
    FROM public.service_orders so
    LEFT JOIN public.contractors c ON c.id = so.contractor_id
    WHERE so.id = v_os AND COALESCE(c.payment_days, 30) < 999
    ON CONFLICT (reference_id) WHERE reference_type = 'service_order_return' DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_post_receipt_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_post_receipt_return(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.register_atelier_job_receipt(
  p_job_id uuid,
  p_pairs numeric,
  p_note text DEFAULT NULL,
  p_defect numeric DEFAULT 0,
  p_loss numeric DEFAULT 0,
  p_part_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_part public.atelier_job_parts%ROWTYPE;
  v_open numeric;
  v_cap numeric;
  v_id uuid;
  v_good integer;
  v_defect integer;
  v_loss integer;
  v_part_count int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  v_good := public.atelier_whole_pairs(p_pairs, 'Pares bons');
  v_defect := public.atelier_whole_pairs(COALESCE(p_defect, 0), 'Pares com defeito');
  v_loss := public.atelier_whole_pairs(COALESCE(p_loss, 0), 'Pares perdidos');
  IF v_good <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos 1 par bom, inteiro' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura e Aviamento recebem conferência' USING ERRCODE = '22023';
  END IF;
  IF p_part_id IS NULL THEN
    SELECT COUNT(*) INTO v_part_count
      FROM public.atelier_job_parts
     WHERE job_id = p_job_id AND received_pairs + 1e-9 < pairs;
    IF v_part_count = 1 THEN
      SELECT id INTO p_part_id
        FROM public.atelier_job_parts
       WHERE job_id = p_job_id AND received_pairs + 1e-9 < pairs
       LIMIT 1;
    ELSIF v_part_count > 1 THEN
      RAISE EXCEPTION 'Escolha a parte do prestador para conferir' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM public.atelier_job_parts WHERE id = p_part_id AND job_id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parte do envio não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_part.execution_mode = 'internal' THEN
      IF v_part.pipeline_status NOT IN ('in_progress', 'partially_done', 'done') THEN
        RAISE EXCEPTION 'Inicie a realização antes de lançar o concluído' USING ERRCODE = '22023';
      END IF;
    ELSIF v_part.pipeline_status NOT IN (
      'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory'
    ) THEN
      RAISE EXCEPTION 'Envie a parte ao prestador antes de conferir' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(SUM(r.pairs + COALESCE(r.qty_defect, 0) + COALESCE(r.qty_loss, 0)), 0)
      INTO v_open
      FROM public.atelier_job_receipts r
     WHERE r.part_id = p_part_id AND r.reversed_at IS NULL;
    v_cap := v_part.pairs;
  ELSE
    IF v_job.execution_mode = 'internal' THEN
      IF v_job.pipeline_status NOT IN ('in_progress', 'partially_done', 'done') THEN
        RAISE EXCEPTION 'Inicie a realização antes de lançar o concluído' USING ERRCODE = '22023';
      END IF;
    ELSIF v_job.pipeline_status NOT IN (
      'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory', 'partially_sent'
    ) THEN
      RAISE EXCEPTION 'Envie o job ao prestador antes de conferir' USING ERRCODE = '22023';
    END IF;
    v_open := public.atelier_job_open_received(p_job_id);
    v_cap := v_job.pairs;
  END IF;
  IF v_open + v_good + v_defect + v_loss > v_cap + 1e-9 THEN
    RAISE EXCEPTION 'Excede a parte: já há % de % pares. Faltam %.',
      v_open, v_cap, GREATEST(v_cap - v_open, 0)
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.atelier_job_receipts (job_id, part_id, pairs, qty_defect, qty_loss, note, created_by)
  VALUES (p_job_id, p_part_id, v_good, v_defect, v_loss, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.atelier_apply_received_total(p_job_id);
  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_id,
    'part_id', p_part_id,
    'received_pairs', public.atelier_job_open_received(p_job_id),
    'pairs', v_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric, uuid)
  TO authenticated, service_role;

-- O período soma as partes. Job sem parte continua valendo o total enviado.
CREATE OR REPLACE FUNCTION public.atelier_period_report(p_from date, p_to date)
RETURNS TABLE (
  side text, contractor_id uuid, contractor_name text,
  sent_pairs numeric, received_pairs numeric, pending_pairs numeric,
  late_jobs integer, avg_lead_first_days numeric, avg_lead_full_days numeric,
  cost numeric, done_pairs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT COALESCE(p_from, CURRENT_DATE - 30) AS d0, COALESCE(p_to, CURRENT_DATE) AS d1
  ),
  jobs AS (
    SELECT j.id, j.pairs, j.sent_at, j.target_end, j.sector, j.contractor_id,
           CASE WHEN j.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           public.atelier_job_open_received(j.id) AS received_now
      FROM public.cabedal_prep_jobs j
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
  ),
  sent_rows AS (
    SELECT CASE WHEN p.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           p.contractor_id, p.pairs::numeric AS pairs,
           GREATEST(p.pairs - p.received_pairs, 0)::numeric AS pending,
           p.sent_at,
           (p.return_on IS NOT NULL AND p.return_on < CURRENT_DATE AND p.received_pairs + 1e-9 < p.pairs) AS late
      FROM public.atelier_job_parts p
      JOIN public.cabedal_prep_jobs j ON j.id = p.job_id
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
       AND p.sent_at IS NOT NULL
    UNION ALL
    SELECT j.side, j.contractor_id, j.pairs,
           GREATEST(j.pairs - j.received_now, 0), j.sent_at,
           j.target_end IS NOT NULL
             AND public.atelier_job_return_date(j.target_end, j.sector) < CURRENT_DATE
             AND j.received_now + 1e-9 < j.pairs
      FROM jobs j
     WHERE j.sent_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.atelier_job_parts p WHERE p.job_id = j.id)
  ),
  sent AS (
    SELECT side, contractor_id, SUM(pairs) AS sent_pairs, SUM(pending) AS pending_pairs,
           COUNT(*) FILTER (WHERE late)::int AS late_jobs
      FROM sent_rows, bounds b
     WHERE sent_at::date BETWEEN b.d0 AND b.d1 AND side = 'contractor'
     GROUP BY side, contractor_id
  ),
  receipts AS (
    SELECT j.side, j.contractor_id, r.pairs, r.created_at, COALESCE(p.sent_at, j.sent_at) AS sent_at,
           j.id AS job_id, COALESCE(p.unit_price, i.unit_price, 0) AS unit_price
      FROM public.atelier_job_receipts r
      JOIN jobs j ON j.id = r.job_id
      LEFT JOIN public.atelier_job_parts p ON p.id = r.part_id
      LEFT JOIN LATERAL (
        SELECT unit_price FROM public.service_order_items si
         WHERE (r.part_id IS NOT NULL AND si.atelier_part_id = r.part_id)
            OR (r.part_id IS NULL AND si.atelier_job_id = j.id)
         ORDER BY si.created_at LIMIT 1
      ) i ON true
      CROSS JOIN bounds b
     WHERE r.reversed_at IS NULL AND r.created_at::date BETWEEN b.d0 AND b.d1
  ),
  received AS (
    SELECT side, contractor_id, SUM(pairs) AS received_pairs,
           SUM(CASE WHEN side = 'contractor' THEN pairs * unit_price ELSE 0 END) AS cost,
           SUM(CASE WHEN side = 'internal' THEN pairs ELSE 0 END) AS done_pairs
      FROM receipts GROUP BY side, contractor_id
  ),
  first_receipt AS (
    SELECT j.id, MIN(r.created_at) AS first_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor'
     GROUP BY j.id
  ),
  full_receipt AS (
    SELECT j.id, MAX(r.created_at) AS full_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor' AND j.received_now + 1e-9 >= j.pairs
     GROUP BY j.id
  ),
  leads AS (
    SELECT j.contractor_id,
           AVG(EXTRACT(EPOCH FROM (f.first_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_first,
           AVG(EXTRACT(EPOCH FROM (u.full_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_full
      FROM jobs j
      CROSS JOIN bounds b
      LEFT JOIN first_receipt f ON f.id = j.id
      LEFT JOIN full_receipt u ON u.id = j.id
     WHERE j.side = 'contractor'
     GROUP BY j.contractor_id
  ),
  keys AS (
    SELECT side, contractor_id FROM sent
    UNION
    SELECT side, contractor_id FROM received
  )
  SELECT k.side, k.contractor_id,
         CASE WHEN k.side = 'internal' THEN NULL ELSE c.name END,
         COALESCE(s.sent_pairs, 0), COALESCE(r.received_pairs, 0), COALESCE(s.pending_pairs, 0),
         COALESCE(s.late_jobs, 0), ROUND(l.avg_first::numeric, 1), ROUND(l.avg_full::numeric, 1),
         ROUND(COALESCE(r.cost, 0), 2), COALESCE(r.done_pairs, 0)
    FROM keys k
    LEFT JOIN sent s ON s.side = k.side AND s.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN received r ON r.side = k.side AND r.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN leads l ON k.side = 'contractor' AND l.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN public.contractors c ON c.id = k.contractor_id
   ORDER BY k.side, c.name NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.atelier_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_period_report(date, date) TO authenticated, service_role;
