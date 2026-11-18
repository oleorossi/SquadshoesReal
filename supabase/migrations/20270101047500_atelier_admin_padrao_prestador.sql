-- Administração do Ateliê (fase 1).
-- O padrão interno/prestador mora na ficha, por referência e setor.
-- O job novo copia esse padrão. Job já gravado não é reescrito aqui.
-- Prestador inativo, com prazo >= 999 (atalho de fábrica do módulo de
-- terceiros) ou que já declarou setores e não inclui este, não recebe
-- remessa nova. Quem ainda não declarou setor continua podendo receber,
-- senão a fila pararia no dia em que a tabela nasce vazia.
-- Não cria ordem de serviço.

ALTER TABLE public.atelier_complex_references
  ADD COLUMN IF NOT EXISTS default_execution_mode text,
  ADD COLUMN IF NOT EXISTS default_contractor_id uuid REFERENCES public.contractors(id);

ALTER TABLE public.atelier_complex_references
  DROP CONSTRAINT IF EXISTS atelier_complex_references_default_mode_chk;
ALTER TABLE public.atelier_complex_references
  ADD CONSTRAINT atelier_complex_references_default_mode_chk
  CHECK (
    default_execution_mode IS NULL
    OR default_execution_mode = ANY (ARRAY['internal'::text, 'contractor'::text])
  );

COMMENT ON COLUMN public.atelier_complex_references.default_execution_mode IS
  'Padrão copiado no job novo deste setor. NULL = o job segue o modo do item do PV (vazio continua prestador).';
COMMENT ON COLUMN public.atelier_complex_references.default_contractor_id IS
  'Prestador sugerido quando o padrão é contractor. Só entra no job se ainda puder atender o setor.';

CREATE TABLE IF NOT EXISTS public.atelier_contractor_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  sector text NOT NULL,
  capacity_pairs_per_day numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atelier_contractor_sectors_sector_chk
    CHECK (sector = ANY (ARRAY['costura_cabedal'::text, 'aviamento'::text])),
  CONSTRAINT atelier_contractor_sectors_capacity_chk
    CHECK (
      capacity_pairs_per_day IS NULL
      OR (capacity_pairs_per_day > 0 AND capacity_pairs_per_day <= 1000000)
    ),
  CONSTRAINT atelier_contractor_sectors_unique UNIQUE (contractor_id, sector)
);

COMMENT ON TABLE public.atelier_contractor_sectors IS
  'Setores de rua que o prestador atende no Ateliê, com capacidade em pares por dia. A tarifa continua em contractor_service_rates.';

ALTER TABLE public.atelier_contractor_sectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atelier_contractor_sectors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.atelier_contractor_sectors TO authenticated;
GRANT ALL ON TABLE public.atelier_contractor_sectors TO service_role;

DROP POLICY IF EXISTS atelier_contractor_sectors_select ON public.atelier_contractor_sectors;
CREATE POLICY atelier_contractor_sectors_select ON public.atelier_contractor_sectors
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

CREATE OR REPLACE FUNCTION public.atelier_contractor_can_take(
  p_contractor_id uuid,
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
      FROM public.contractors c
     WHERE c.id = p_contractor_id
       AND c.active IS TRUE
       AND COALESCE(c.payment_days, 0) < 999
       AND (
         NOT EXISTS (
           SELECT 1
             FROM public.atelier_contractor_sectors s
            WHERE s.contractor_id = c.id
         )
         OR EXISTS (
           SELECT 1
             FROM public.atelier_contractor_sectors s
            WHERE s.contractor_id = c.id
              AND s.sector = p_sector
              AND s.active
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.atelier_contractor_can_take(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atelier_contractor_can_take(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_upsert_contractor_sector(
  p_contractor_id uuid,
  p_sector text,
  p_capacity numeric,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sector IS NULL OR p_sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Setor do Ateliê inválido' USING ERRCODE = '22023';
  END IF;
  IF p_capacity IS NOT NULL AND (p_capacity <= 0 OR p_capacity > 1000000) THEN
    RAISE EXCEPTION 'Capacidade tem de ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contractors c
     WHERE c.id = p_contractor_id
       AND c.active IS TRUE
       AND COALESCE(c.payment_days, 0) < 999
  ) THEN
    RAISE EXCEPTION 'Prestador inativo ou de fábrica não atende o Ateliê'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.atelier_contractor_sectors (
    contractor_id, sector, capacity_pairs_per_day, active, updated_at
  ) VALUES (
    p_contractor_id, p_sector, p_capacity, COALESCE(p_active, true), now()
  )
  ON CONFLICT (contractor_id, sector) DO UPDATE SET
    capacity_pairs_per_day = EXCLUDED.capacity_pairs_per_day,
    active = EXCLUDED.active,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_upsert_contractor_sector(uuid, text, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atelier_upsert_contractor_sector(uuid, text, numeric, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_set_reference_execution_default(
  p_reference_id uuid,
  p_sector text,
  p_mode text,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sector IS NULL OR p_sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura e Aviamento têm padrão de execução' USING ERRCODE = '22023';
  END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('internal', 'contractor') THEN
    RAISE EXCEPTION 'Modo inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.sector = p_sector
       AND a.active
  ) THEN
    RAISE EXCEPTION 'A referência não está ativa neste setor do Ateliê' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'internal' THEN
    p_contractor_id := NULL;
  ELSIF p_mode IS NULL THEN
    p_contractor_id := NULL;
  ELSIF p_contractor_id IS NOT NULL
        AND NOT public.atelier_contractor_can_take(p_contractor_id, p_sector) THEN
    RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_complex_references
     SET default_execution_mode = p_mode,
         default_contractor_id = p_contractor_id,
         updated_at = now()
   WHERE reference_id = p_reference_id
     AND sector = p_sector;

  RETURN jsonb_build_object(
    'ok', true,
    'default_execution_mode', p_mode,
    'default_contractor_id', p_contractor_id
  );
END;
$$;

COMMENT ON FUNCTION public.atelier_set_reference_execution_default(uuid, text, text, uuid) IS
  'Grava o padrão da ficha. Não altera jobs já criados.';

REVOKE ALL ON FUNCTION public.atelier_set_reference_execution_default(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atelier_set_reference_execution_default(uuid, text, text, uuid)
  TO authenticated, service_role;

-- Job novo copia o padrão da ficha. Conflito não mexe no modo nem no prestador
-- já gravados (PV em aberto, inclusive os que já estão na fila, ficam como estão).
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
  v_sheet_mode text;
  v_sheet_contractor uuid;
  v_job_mode text;
  v_job_contractor uuid;
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

    v_sheet_mode := NULL;
    v_sheet_contractor := NULL;
    SELECT a.default_execution_mode, a.default_contractor_id
      INTO v_sheet_mode, v_sheet_contractor
      FROM public.atelier_complex_references a
     WHERE a.reference_id = v_d.technical_sheet_id
       AND a.sector = v_sec
       AND a.active;

    v_job_mode := COALESCE(v_sheet_mode, v_mode);
    IF v_job_mode IS NOT NULL AND v_job_mode NOT IN ('internal', 'contractor') THEN
      v_job_mode := v_mode;
    END IF;

    v_job_contractor := NULL;
    IF v_sheet_mode = 'contractor'
       AND v_sheet_contractor IS NOT NULL
       AND public.atelier_contractor_can_take(v_sheet_contractor, v_sec) THEN
      v_job_contractor := v_sheet_contractor;
    END IF;
    IF v_job_mode = 'internal' THEN
      v_job_contractor := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_jobs (
      demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
      sector, pairs, color, reference_code, pipeline_status,
      target_start, target_end, lot_id, execution_mode, contractor_id
    ) VALUES (
      p_demand_id, v_d.sale_order_id, v_d.sale_order_item_id, v_d.technical_sheet_id,
      v_sec, v_d.pairs, v_d.color, v_d.reference_code, v_initial,
      v_t_start, v_t_end, v_lot_id, v_job_mode, v_job_contractor
    )
    ON CONFLICT (demand_id, sector) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      target_start = EXCLUDED.target_start,
      target_end = EXCLUDED.target_end,
      lot_id = EXCLUDED.lot_id,
      pipeline_status = EXCLUDED.pipeline_status,
      updated_at = now()
    WHERE public.cabedal_prep_jobs.pipeline_status IN ('awaiting_cut', 'cancelled');
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sectors', to_jsonb(v_sectors), 'jobs', v_n, 'lot_id', v_lot_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sync_jobs_for_demand(uuid) TO authenticated, service_role;

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
  IF p_mode = 'internal' THEN
    p_contractor_id := NULL;
  ELSIF p_contractor_id IS NOT NULL
        AND NOT public.atelier_contractor_can_take(p_contractor_id, v_job.sector) THEN
    RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
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

CREATE OR REPLACE FUNCTION public.tg_atelier_contractor_can_receive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.execution_mode = 'internal' THEN
    NEW.contractor_id := NULL;
  END IF;

  IF NEW.pipeline_status = 'sent_to_contractor'
     AND NEW.execution_mode IS DISTINCT FROM 'internal'
     AND (
       OLD.pipeline_status IS DISTINCT FROM 'sent_to_contractor'
       OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
     )
     AND (
       NEW.contractor_id IS NULL
       OR NOT public.atelier_contractor_can_take(NEW.contractor_id, NEW.sector)
     )
  THEN
    RAISE EXCEPTION 'Este prestador não recebe remessa deste setor'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_contractor_can_receive ON public.cabedal_prep_jobs;
CREATE TRIGGER trg_atelier_contractor_can_receive
  BEFORE UPDATE OF pipeline_status, contractor_id, execution_mode
  ON public.cabedal_prep_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_contractor_can_receive();
