-- Auditoria 2026-06-28 (cura da fundação, parte 2): captura automática do INÍCIO
-- do estágio pelo FLUXO DE MATERIAL, já que o botão "Iniciar" é pulado (started_at
-- estava em 3%). Modelo (alinhado ao motor de ondas):
--   • Preparo PARALELO {Corte Palmilha, Corte Forração, Aviamento} → inicia na
--     LIBERAÇÃO da OP (min(created_at) dos estágios da ordem).
--   • Demais setores (sequenciais) → iniciam quando o upstream concluiu
--     (max(completed_at) dos estágios de stage_order menor).
--
-- Isso dá o TEMPO DE ATRAVESSAMENTO real por estágio (lead time, INCLUI fila) —
-- alimenta gargalo/lead-time. NÃO é tempo de TRABALHO/OEE (esse precisa de
-- apontamento real + tempo-padrão configurado). É um proxy de fluxo, aceito pelo
-- dono. Resultado do backfill: started_at 3%→40%, actual_time 0→555 estágios,
-- mediana ~3 dias. Estágios cujo início inferido cairia DEPOIS do fim (dado
-- histórico inconsistente) ficam em branco de propósito (não forçar valor errado).
--
-- Aplicada via Supabase MCP em 2026-06-28 (GitHub Action de migrations quebrada).

CREATE OR REPLACE FUNCTION public.tg_stamp_order_stage_wip_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_start timestamptz;
  v_prep boolean := NEW.stage_name IN ('Corte Palmilha', 'Corte Forração', 'Aviamento');
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Início REAL: operador clicou "Iniciar" (pendente → em_andamento).
    IF OLD.status = 'pendente' AND NEW.status = 'em_andamento' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    -- Fim.
    IF NEW.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  -- Início INFERIDO pelo fluxo de material, quando concluiu sem início real
  -- (evita started_at = completed_at = duração 0).
  IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NULL THEN
    IF v_prep THEN
      SELECT min(created_at) INTO v_start FROM public.order_stages WHERE order_id = NEW.order_id;
    ELSE
      SELECT max(completed_at) INTO v_start FROM public.order_stages
        WHERE order_id = NEW.order_id AND stage_order < NEW.stage_order AND completed_at IS NOT NULL;
      IF v_start IS NULL THEN
        SELECT min(created_at) INTO v_start FROM public.order_stages WHERE order_id = NEW.order_id;
      END IF;
    END IF;
    IF v_start IS NOT NULL AND v_start <= NEW.completed_at THEN
      NEW.started_at := v_start;
    ELSE
      NEW.started_at := NEW.completed_at;
    END IF;
  END IF;

  -- Tempo de atravessamento (minutos) — quando há início e fim.
  IF NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
    NEW.actual_time_minutes := GREATEST(0, round(extract(epoch FROM (NEW.completed_at - NEW.started_at)) / 60.0, 2));
  END IF;
  RETURN NEW;
END;
$function$;

-- ── BACKFILL histórico ──────────────────────────────────────────────────────
-- 1) completed_at p/ concluídos sem fim (proxy = updated_at do momento da conclusão).
UPDATE public.order_stages
   SET completed_at = updated_at
 WHERE status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
   AND completed_at IS NULL
   AND updated_at IS NOT NULL;

-- 2) started_at inferido (fluxo de material) p/ estágios concluídos sem início.
WITH rel AS (
  SELECT order_id, min(created_at) AS release_at FROM public.order_stages GROUP BY order_id
), calc AS (
  SELECT o.id,
    CASE WHEN o.stage_name IN ('Corte Palmilha', 'Corte Forração', 'Aviamento')
         THEN rel.release_at
         ELSE COALESCE(
           (SELECT max(p.completed_at) FROM public.order_stages p
             WHERE p.order_id = o.order_id AND p.stage_order < o.stage_order AND p.completed_at IS NOT NULL),
           rel.release_at)
    END AS v_start
  FROM public.order_stages o
  JOIN rel ON rel.order_id = o.order_id
  WHERE o.completed_at IS NOT NULL AND o.started_at IS NULL
)
UPDATE public.order_stages os
   SET started_at = calc.v_start
  FROM calc
 WHERE os.id = calc.id
   AND calc.v_start IS NOT NULL
   AND calc.v_start <= os.completed_at;

-- 3) Recalcula actual_time_minutes p/ todos com início + fim.
UPDATE public.order_stages
   SET actual_time_minutes = GREATEST(0, round(extract(epoch FROM (completed_at - started_at)) / 60.0, 2))
 WHERE started_at IS NOT NULL AND completed_at IS NOT NULL;
