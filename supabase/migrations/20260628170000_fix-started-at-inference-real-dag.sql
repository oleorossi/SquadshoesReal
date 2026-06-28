-- Auditoria 2026-06-28 (cura da fundação, parte 2 — CORREÇÃO): supersede a
-- 20260628160000, que inferia o predecessor por stage_order. Errado: stage_order é
-- sequencial (1-10) mas o DAG real (fn_guard_manual_stage_transition) é
-- convergente/paralelo — ex.: Costura (stage_order 3) depende de Aviamento
-- (stage_order 4); Silk é PREP (paralelo), não sequencial.
--
-- DAG autoritativo (de fn_guard):
--   prep (sem pré-req → inicia na liberação): Corte Palmilha, Corte Forração,
--     Aviamento, Mesa(legacy), Silk
--   Costura ← Corte Forração + Aviamento
--   Colagem ← Corte Palmilha + Costura
--   Montagem ← Colagem ; Solagem ← Montagem ; Acabamento ← Solagem ;
--   Expedição ← Acabamento
--
-- started_at = max(completed_at dos predecessores reais); prep = liberação da OP.
-- Resultado: 100% dos concluídos com started_at, actual_time em 868 estágios,
-- mediana ~2,9 dias (lead-time, inclui fila). Continua sendo TEMPO DE
-- ATRAVESSAMENTO, não tempo de trabalho/OEE.
--
-- Aplicada via Supabase MCP em 2026-06-28 (GitHub Action de migrations quebrada).

CREATE OR REPLACE FUNCTION public.tg_stamp_order_stage_wip_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_start timestamptz;
  v_required text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pendente' AND NEW.status = 'em_andamento' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  -- Início inferido pelo FLUXO DE MATERIAL (DAG real), quando concluiu sem início.
  IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NULL THEN
    v_required := CASE NEW.stage_name
      WHEN 'Costura'    THEN ARRAY['Corte Forração','Aviamento']
      WHEN 'Colagem'    THEN ARRAY['Corte Palmilha','Costura']
      WHEN 'Montagem'   THEN ARRAY['Colagem']
      WHEN 'Solagem'    THEN ARRAY['Montagem']
      WHEN 'Acabamento' THEN ARRAY['Solagem']
      WHEN 'Expedição'  THEN ARRAY['Acabamento']
      ELSE ARRAY[]::text[]   -- prep (Corte Palmilha/Forração/Aviamento/Mesa/Silk) e desconhecidos
    END;
    IF cardinality(v_required) = 0 THEN
      SELECT min(created_at) INTO v_start FROM public.order_stages WHERE order_id = NEW.order_id;
    ELSE
      SELECT max(completed_at) INTO v_start FROM public.order_stages
        WHERE order_id = NEW.order_id AND stage_name = ANY(v_required) AND completed_at IS NOT NULL;
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

  IF NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL THEN
    NEW.actual_time_minutes := GREATEST(0, round(extract(epoch FROM (NEW.completed_at - NEW.started_at)) / 60.0, 2));
  END IF;
  RETURN NEW;
END;
$function$;

-- RE-BACKFILL corrigindo a inferência por stage_order da migration anterior.
WITH rel AS (
  SELECT order_id, min(created_at) AS release_at FROM public.order_stages GROUP BY order_id
), calc AS (
  SELECT o.id, o.completed_at,
    CASE WHEN (CASE o.stage_name
                 WHEN 'Costura' THEN ARRAY['Corte Forração','Aviamento']
                 WHEN 'Colagem' THEN ARRAY['Corte Palmilha','Costura']
                 WHEN 'Montagem' THEN ARRAY['Colagem']
                 WHEN 'Solagem' THEN ARRAY['Montagem']
                 WHEN 'Acabamento' THEN ARRAY['Solagem']
                 WHEN 'Expedição' THEN ARRAY['Acabamento']
                 ELSE ARRAY[]::text[] END) = ARRAY[]::text[]
         THEN rel.release_at
         ELSE COALESCE(
           (SELECT max(p.completed_at) FROM public.order_stages p
             WHERE p.order_id = o.order_id
               AND p.stage_name = ANY(CASE o.stage_name
                 WHEN 'Costura' THEN ARRAY['Corte Forração','Aviamento']
                 WHEN 'Colagem' THEN ARRAY['Corte Palmilha','Costura']
                 WHEN 'Montagem' THEN ARRAY['Colagem']
                 WHEN 'Solagem' THEN ARRAY['Montagem']
                 WHEN 'Acabamento' THEN ARRAY['Solagem']
                 WHEN 'Expedição' THEN ARRAY['Acabamento']
                 ELSE ARRAY[]::text[] END)
               AND p.completed_at IS NOT NULL),
           rel.release_at)
    END AS v_start
  FROM public.order_stages o
  JOIN rel ON rel.order_id = o.order_id
  WHERE o.completed_at IS NOT NULL
)
UPDATE public.order_stages os
   SET started_at = CASE WHEN calc.v_start IS NOT NULL AND calc.v_start <= calc.completed_at THEN calc.v_start ELSE NULL END
  FROM calc
 WHERE os.id = calc.id;

UPDATE public.order_stages
   SET actual_time_minutes = CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
        THEN GREATEST(0, round(extract(epoch FROM (completed_at - started_at)) / 60.0, 2)) ELSE NULL END
 WHERE completed_at IS NOT NULL;
