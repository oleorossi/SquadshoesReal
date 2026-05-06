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
