-- =============================================================================
-- Trigger fn_guard_manual_stage_transition: DAG por nome (não stage_order)
-- =============================================================================
-- Antes: bloqueava qualquer pendente→em_andamento se o stage com order N-1
-- não estivesse concluído. Como o auto-create põe Corte Palmilha=1,
-- Corte Forração=2, Aviamento=3 (sequencial), o operador NÃO conseguia
-- iniciar Aviamento sem fechar Corte Forração — contradiz o design de
-- paralelismo do PR 3 (CLAUDE.md) e produz mensagens absurdas tipo
-- "Mesa não pode iniciar porque o setor anterior 'Montagem' não está
-- finalizado" (em ordens com stage_orders desalinhados).
--
-- Agora: dependência declarada por NOME de setor, alinhada ao fluxo real:
--   Prep (paralelo, sem dependência): Corte Palmilha, Corte Forração,
--                                     Aviamento (alias Mesa), Silk
--   Costura ⟵ Corte Forração + Aviamento
--   Colagem ⟵ Corte Palmilha + Costura
--   Montagem ⟵ Colagem
--   Solagem ⟵ Montagem
--   Acabamento ⟵ Solagem
--   Expedição ⟵ Acabamento
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_guard_manual_stage_transition() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required text[];
  v_blocking text;
  v_blocking_status text;
BEGIN
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  v_required := CASE NEW.stage_name
    WHEN 'Corte Palmilha' THEN ARRAY[]::text[]
    WHEN 'Corte Forração' THEN ARRAY[]::text[]
    WHEN 'Aviamento'      THEN ARRAY[]::text[]
    WHEN 'Mesa'           THEN ARRAY[]::text[]
    WHEN 'Silk'           THEN ARRAY[]::text[]
    WHEN 'Costura'        THEN ARRAY['Corte Forração','Aviamento']
    WHEN 'Colagem'        THEN ARRAY['Corte Palmilha','Costura']
    WHEN 'Montagem'       THEN ARRAY['Colagem']
    WHEN 'Solagem'        THEN ARRAY['Montagem']
    WHEN 'Acabamento'     THEN ARRAY['Solagem']
    WHEN 'Expedição'      THEN ARRAY['Acabamento']
    ELSE NULL
  END;

  IF v_required IS NULL OR cardinality(v_required) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT stage_name, status
    INTO v_blocking, v_blocking_status
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_name = ANY(v_required)
    AND status <> 'concluido'
  LIMIT 1;

  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor pré-requisito "%" não está finalizado (status atual: %).',
      NEW.stage_name, v_blocking, v_blocking_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_stage_transition ON public.order_stages;
CREATE TRIGGER trg_guard_manual_stage_transition
BEFORE UPDATE ON public.order_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_manual_stage_transition();

COMMENT ON FUNCTION public.fn_guard_manual_stage_transition() IS
  'Bloqueia início de setor (pendente→em_andamento) que ainda dependa de outro '
  'setor não finalizado. Usa DAG por NOME (não stage_order) pra respeitar '
  'paralelismo dos setores prep (Corte Palmilha/Forração, Aviamento, Silk).';
