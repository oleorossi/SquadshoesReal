-- Auditoria 2026-06-28: computa order_stages.actual_time_minutes sempre que início
-- e fim existem. Antes NADA populava (0/2235, mesmo nos estágios apontados) → as
-- telas de eficiência / cronoanálise / lead-time real liam tempo zerado. NÃO
-- fabrica dado: só calcula quando started_at E completed_at são reais.
--
-- ⚠ O backfill revelou que apenas 2 estágios em toda a base tiveram apontamento
-- real (Iniciar→Concluir com intervalo > 0); o restante teve started_at carimbado
-- no mesmo instante do completed_at (conclusão direta, sem o toque "Iniciar"). A
-- cura da fundação (started_at + tempo-padrão) é DADO/PROCESSO, não só código.
--
-- Aplicada via Supabase MCP em 2026-06-28 (GitHub Action de migrations quebrada).
CREATE OR REPLACE FUNCTION public.tg_stamp_order_stage_wip_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pendente'
       AND NEW.status <> 'pendente'
       AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  -- Tempo real do estágio (minutos) — só quando há início E fim genuínos.
  IF NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
    NEW.actual_time_minutes := GREATEST(0, round(extract(epoch FROM (NEW.completed_at - NEW.started_at)) / 60.0, 2));
  END IF;
  RETURN NEW;
END;
$function$;

-- Backfill dos estágios já apontados (início + fim reais) que ficaram com tempo 0.
UPDATE public.order_stages
   SET actual_time_minutes = GREATEST(0, round(extract(epoch FROM (completed_at - started_at)) / 60.0, 2))
 WHERE started_at IS NOT NULL
   AND completed_at IS NOT NULL
   AND coalesce(actual_time_minutes, 0) = 0;
