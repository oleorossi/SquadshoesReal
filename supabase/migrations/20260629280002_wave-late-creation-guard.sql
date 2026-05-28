-- P1.3 (bug #10): sinaliza waves criadas com material_ready_date no passado
-- Cálculo de compute_wave_timeline está correto; bug é falta de validação.
-- Flag dá visibilidade ao PCP de que material vai chegar atrasado.

ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS late_creation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.production_waves.late_creation IS
  'TRUE quando material_ready_date < created_at::date (wave criada com prazo impossível).';

-- Backfill (6 waves identificadas em auditoria 28/05/2026)
UPDATE public.production_waves
SET late_creation = true
WHERE material_ready_date IS NOT NULL
  AND material_ready_date < created_at::date;

-- Trigger auto-flag pra novas waves
CREATE OR REPLACE FUNCTION public.tg_waves_flag_late_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.material_ready_date IS NOT NULL
     AND NEW.material_ready_date < COALESCE(NEW.created_at::date, CURRENT_DATE) THEN
    NEW.late_creation := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_waves_flag_late_creation ON public.production_waves;
CREATE TRIGGER trg_waves_flag_late_creation
  BEFORE INSERT OR UPDATE OF material_ready_date
  ON public.production_waves
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_waves_flag_late_creation();
