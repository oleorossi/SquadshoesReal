-- =============================================================================
-- fn_guard_wave_stage_transition: DAG por nome (igual ao manual)
-- =============================================================================
-- Bug: o guard de wave usava stage_order() NOVO (de 2026-05-06: mesa=4,
-- montagem=7) combinado com uma lista HARDCODED LEGACY (corte=1, costura=2,
-- montagem=3, solagem=4, acabamento=5). Resultado: stage_order('mesa')=4
-- buscava ord 3 na lista legacy = 'montagem' → erro absurdo:
--   "Setor 'mesa': não pode iniciar porque o setor anterior 'montagem'
--    não está finalizado (status atual: pending)"
--
-- Mesmo fix do trigger manual (migration 20260515140000): DAG por NOME,
-- com paralelismo dos setores prep.
--
-- Aplicada via MCP em 2026-05-15.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_wave_stage_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required production_stage_enum[];
  v_blocking production_stage_enum;
  v_blocking_status stage_status_enum;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'in_progress'
     AND OLD.status IN ('pending','blocked') THEN

    v_required := CASE NEW.stage::text
      WHEN 'corte'           THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_palmilha'  THEN ARRAY[]::production_stage_enum[]
      WHEN 'palmilha'        THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_forracao'  THEN ARRAY[]::production_stage_enum[]
      WHEN 'corte_cabedal'   THEN ARRAY[]::production_stage_enum[]
      WHEN 'mesa'            THEN ARRAY[]::production_stage_enum[]
      WHEN 'silk'            THEN ARRAY[]::production_stage_enum[]
      WHEN 'costura'         THEN ARRAY['corte_forracao','mesa']::production_stage_enum[]
      WHEN 'colagem'         THEN ARRAY['corte_palmilha','costura']::production_stage_enum[]
      WHEN 'montagem'        THEN ARRAY['colagem']::production_stage_enum[]
      WHEN 'solagem'         THEN ARRAY['montagem']::production_stage_enum[]
      WHEN 'acabamento'      THEN ARRAY['solagem']::production_stage_enum[]
      WHEN 'expedicao'       THEN ARRAY['acabamento']::production_stage_enum[]
      ELSE NULL
    END;

    IF v_required IS NOT NULL AND cardinality(v_required) > 0 THEN
      SELECT stage, status
        INTO v_blocking, v_blocking_status
      FROM public.production_wave_stages
      WHERE wave_id = NEW.wave_id
        AND stage = ANY(v_required)
        AND status <> 'completed'
      LIMIT 1;

      IF v_blocking IS NOT NULL THEN
        RAISE EXCEPTION
          'Setor "%": não pode iniciar porque o setor pré-requisito "%" não está finalizado (status atual: %).',
          NEW.stage, v_blocking, v_blocking_status::text;
      END IF;
    END IF;

    NEW.started_at := COALESCE(NEW.started_at, now());
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.progress_pct := 100;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_wave_stage_transition() IS
  'Bloqueia in_progress de wave_stage que dependa de outro stage não completed. '
  'Usa DAG por NOME (não stage_order legacy) pra respeitar paralelismo dos prep.';
