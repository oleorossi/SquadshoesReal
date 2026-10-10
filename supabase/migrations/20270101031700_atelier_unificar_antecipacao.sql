-- Unificar Antecipação → Ateliê
-- - pipeline awaiting_cut (destrava após Corte Cabedal concluído)
-- - atelier_settings (offsets Costura/Aviamento) + target_* nas jobs
-- - sync não cria jobs de corte_cabedal (corte interno)
-- - zera start_offset_days de Costura Cabedal / Aviamento na fábrica

-- ─── 1. Settings do Ateliê ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atelier_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  costura_offset_days integer NOT NULL DEFAULT 5
    CHECK (costura_offset_days >= 0 AND costura_offset_days <= 60),
  aviamento_offset_days integer NOT NULL DEFAULT 5
    CHECK (aviamento_offset_days >= 0 AND aviamento_offset_days <= 60),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atelier_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_settings_all ON public.atelier_settings;
CREATE POLICY atelier_settings_all ON public.atelier_settings
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

INSERT INTO public.atelier_settings (id, costura_offset_days, aviamento_offset_days)
SELECT
  1,
  COALESCE(
    (SELECT ss.start_offset_days FROM public.sector_settings ss
      WHERE ss.sector = 'Costura Cabedal' LIMIT 1),
    5
  ),
  COALESCE(
    (SELECT ss.start_offset_days FROM public.sector_settings ss
      WHERE ss.sector = 'Aviamento' LIMIT 1),
    5
  )
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.atelier_settings IS
  'Offsets (dias úteis) da agenda Ateliê vs âncora de corte — substitui early-release de Costura/Aviamento na Antecipação.';

-- ─── 2. Colunas de agenda + status awaiting_cut ──────────────────────────────
ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS target_start date,
  ADD COLUMN IF NOT EXISTS target_end date;

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;

ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text,
    'awaiting_debit'::text,
    'debited'::text,
    'sent_to_contractor'::text,
    'received_at_factory'::text,
    'cancelled'::text
  ]));

-- ─── 3. Zerar early-release de fábrica ───────────────────────────────────────
-- Desliga o recompute: o trigger de sector_settings chama
-- recompute_production_schedule → enqueue strap e pode falhar por permissão
-- no contexto da migration (session sem JWT aprovado).
ALTER TABLE public.sector_settings DISABLE TRIGGER tg_sector_settings_recompute;
UPDATE public.sector_settings
   SET start_offset_days = 0,
       updated_at = now()
 WHERE sector IN ('Costura Cabedal', 'Aviamento')
   AND COALESCE(start_offset_days, 0) <> 0;
ALTER TABLE public.sector_settings ENABLE TRIGGER tg_sector_settings_recompute;

-- ─── 4. Gate: Corte Cabedal liberou? ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_cut_gate_released(
  p_sale_order_item_id uuid,
  p_sale_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_ops boolean := false;
BEGIN
  IF p_sale_order_item_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.orders o
       WHERE o.sale_order_item_id = p_sale_order_item_id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') <> 'Cancelado'
    ) INTO v_has_ops;

    IF NOT v_has_ops THEN
      RETURN false;
    END IF;

    RETURN NOT EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.order_stages os ON os.order_id = o.id
       WHERE o.sale_order_item_id = p_sale_order_item_id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') <> 'Cancelado'
         AND os.stage_name = 'Corte Cabedal'
         AND COALESCE(os.status, '') <> 'concluido'
    );
  END IF;

  IF p_sale_order_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.orders o
       WHERE o.sale_order_id = p_sale_order_id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') <> 'Cancelado'
    ) INTO v_has_ops;

    IF NOT v_has_ops THEN
      RETURN false;
    END IF;

    RETURN NOT EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.order_stages os ON os.order_id = o.id
       WHERE o.sale_order_id = p_sale_order_id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') <> 'Cancelado'
         AND os.stage_name = 'Corte Cabedal'
         AND COALESCE(os.status, '') <> 'concluido'
    );
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_cut_gate_released(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_cut_gate_released(uuid, uuid) IS
  'True quando OPs do item/PV existem e não há Corte Cabedal pendente (ou a rota não tem Corte Cabedal). Sem OP → false (fica awaiting_cut).';

-- ─── 5. Targets a partir da agenda de corte ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_compute_job_targets(
  p_sale_order_item_id uuid,
  p_sale_order_id uuid,
  p_sector text,
  p_ready_date date DEFAULT NULL
)
RETURNS TABLE (target_start date, target_end date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anchor date;
  v_offset int := 5;
  v_start date;
BEGIN
  SELECT CASE
           WHEN p_sector = 'aviamento' THEN s.aviamento_offset_days
           ELSE s.costura_offset_days
         END
    INTO v_offset
    FROM public.atelier_settings s
   WHERE s.id = 1;

  v_offset := COALESCE(v_offset, 5);

  SELECT MIN(ps.date)
    INTO v_anchor
    FROM public.orders o
    JOIN public.production_schedule ps ON ps.order_id = o.id
   WHERE o.deleted_at IS NULL
     AND COALESCE(o.status, '') <> 'Cancelado'
     AND (
       (p_sale_order_item_id IS NOT NULL AND o.sale_order_item_id = p_sale_order_item_id)
       OR (p_sale_order_item_id IS NULL AND p_sale_order_id IS NOT NULL AND o.sale_order_id = p_sale_order_id)
     )
     AND ps.sector IN (
       'Corte Cabedal', 'Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Corte'
     );

  IF v_anchor IS NULL THEN
    v_anchor := p_ready_date;
  END IF;

  IF v_anchor IS NULL THEN
    target_start := NULL;
    target_end := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_start := public.add_business_days(v_anchor, -v_offset);
  target_start := v_start;
  target_end := v_anchor;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_compute_job_targets(uuid, uuid, text, date)
  TO authenticated, service_role;

-- ─── 6. Unlock após corte ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_unlock_jobs_after_cut(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so uuid;
  v_soi uuid;
  v_n int := 0;
BEGIN
  SELECT o.sale_order_id, o.sale_order_item_id
    INTO v_so, v_soi
    FROM public.orders o
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  IF NOT public.atelier_cut_gate_released(v_soi, v_so) THEN
    RETURN jsonb_build_object('ok', true, 'unlocked', 0, 'released', false);
  END IF;

  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'awaiting_debit',
         updated_at = now()
   WHERE j.pipeline_status = 'awaiting_cut'
     AND j.sector IN ('costura_cabedal', 'aviamento')
     AND (
       (v_soi IS NOT NULL AND j.sale_order_item_id = v_soi)
       OR (v_soi IS NULL AND j.sale_order_id = v_so)
     );

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'unlocked', v_n, 'released', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_unlock_jobs_after_cut(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_atelier_unlock_on_order_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stage_name = 'Corte Cabedal'
       AND NEW.status = 'concluido'
       AND OLD.status IS DISTINCT FROM 'concluido' THEN
      PERFORM public.atelier_unlock_jobs_after_cut(NEW.order_id);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    -- Rota materializada (com ou sem Corte Cabedal) reavalia o gate
    PERFORM public.atelier_unlock_jobs_after_cut(NEW.order_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_unlock_on_order_stage ON public.order_stages;
CREATE TRIGGER trg_atelier_unlock_on_order_stage
  AFTER INSERT OR UPDATE OF status, stage_name ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_unlock_on_order_stage();

-- ─── 7. Sync: só Costura/Aviamento; nasce awaiting_cut ───────────────────────
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
  v_initial text;
  v_t_start date;
  v_t_end date;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'demand_not_found');
  END IF;
  IF v_d.technical_sheet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_sheet');
  END IF;

  -- Corte Cabedal é interno: não materializa job de rua
  IF v_d.requires_sewing AND public.atelier_reference_has_sector(v_d.technical_sheet_id, 'costura_cabedal') THEN
    v_sectors := array_append(v_sectors, 'costura_cabedal');
  END IF;
  IF v_d.requires_aviamento AND public.atelier_reference_has_sector(v_d.technical_sheet_id, 'aviamento') THEN
    v_sectors := array_append(v_sectors, 'aviamento');
  END IF;

  -- Cancela jobs que saíram do catálogo (incl. corte_cabedal legado) ou aguardando corte/débito
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.demand_id = p_demand_id
     AND j.pipeline_status IN ('awaiting_cut', 'awaiting_debit')
     AND NOT (j.sector = ANY (v_sectors));

  -- Cancela qualquer job aberto de corte_cabedal nesta demanda
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.demand_id = p_demand_id
     AND j.sector = 'corte_cabedal'
     AND j.pipeline_status IN ('awaiting_cut', 'awaiting_debit', 'debited');

  FOREACH v_sec IN ARRAY v_sectors LOOP
    IF public.atelier_cut_gate_released(v_d.sale_order_item_id, v_d.sale_order_id) THEN
      v_initial := 'awaiting_debit';
    ELSE
      v_initial := 'awaiting_cut';
    END IF;

    SELECT t.target_start, t.target_end
      INTO v_t_start, v_t_end
      FROM public.atelier_compute_job_targets(
        v_d.sale_order_item_id,
        v_d.sale_order_id,
        v_sec,
        v_d.ready_date
      ) t;

    INSERT INTO public.cabedal_prep_jobs (
      demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
      sector, pairs, color, reference_code, pipeline_status,
      target_start, target_end
    ) VALUES (
      p_demand_id, v_d.sale_order_id, v_d.sale_order_item_id, v_d.technical_sheet_id,
      v_sec, v_d.pairs, v_d.color, v_d.reference_code, v_initial,
      v_t_start, v_t_end
    )
    ON CONFLICT (demand_id, sector) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      target_start = EXCLUDED.target_start,
      target_end = EXCLUDED.target_end,
      pipeline_status = EXCLUDED.pipeline_status,
      updated_at = now()
    WHERE public.cabedal_prep_jobs.pipeline_status IN ('awaiting_cut', 'awaiting_debit')
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

-- ─── 8. Debit: só awaiting_debit (awaiting_cut fica bloqueado pelo gate existente)

-- ─── 9. RPC pra UI atualizar offsets ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_update_settings(
  p_costura_offset_days integer DEFAULT NULL,
  p_aviamento_offset_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.atelier_settings%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.atelier_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.atelier_settings s
     SET costura_offset_days = COALESCE(
           GREATEST(0, LEAST(60, p_costura_offset_days)),
           s.costura_offset_days
         ),
         aviamento_offset_days = COALESCE(
           GREATEST(0, LEAST(60, p_aviamento_offset_days)),
           s.aviamento_offset_days
         ),
         updated_at = now()
   WHERE s.id = 1
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'costura_offset_days', v_row.costura_offset_days,
    'aviamento_offset_days', v_row.aviamento_offset_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_update_settings(integer, integer)
  TO authenticated, service_role;

-- ─── 10. Backfill ────────────────────────────────────────────────────────────
UPDATE public.cabedal_prep_jobs j
   SET pipeline_status = 'cancelled',
       updated_at = now()
 WHERE j.sector = 'corte_cabedal'
   AND j.pipeline_status IN ('awaiting_cut', 'awaiting_debit', 'debited');

UPDATE public.cabedal_prep_jobs j
   SET pipeline_status = 'awaiting_cut',
       updated_at = now()
 WHERE j.sector IN ('costura_cabedal', 'aviamento')
   AND j.pipeline_status = 'awaiting_debit'
   AND NOT public.atelier_cut_gate_released(j.sale_order_item_id, j.sale_order_id);

-- Preenche targets faltando
UPDATE public.cabedal_prep_jobs j
   SET target_start = x.target_start,
       target_end = x.target_end,
       updated_at = now()
  FROM (
    SELECT j2.id,
           t.target_start,
           t.target_end
      FROM public.cabedal_prep_jobs j2
      JOIN public.cabedal_prep_demands d ON d.id = j2.demand_id
     CROSS JOIN LATERAL public.atelier_compute_job_targets(
       j2.sale_order_item_id, j2.sale_order_id, j2.sector, d.ready_date
     ) t
     WHERE j2.pipeline_status <> 'cancelled'
       AND j2.sector IN ('costura_cabedal', 'aviamento')
       AND (j2.target_start IS NULL OR j2.target_end IS NULL)
  ) x
 WHERE j.id = x.id;
