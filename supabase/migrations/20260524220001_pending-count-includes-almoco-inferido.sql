-- =============================================================================
-- get_pending_count_by_employee: incluir dias com almoco_inferido
-- =============================================================================
-- Sequência da mig 20260524200000 (inferência de 1h de almoço em 2 batidas).
-- Após o fix, dias com 2 batidas viraram 'normal'/'overtime'/'absent' (não mais
-- 'inconsistent'), então sumiram do badge de Pendências do RH Hub.
--
-- O frontend (useTimePendings.ts) já foi ajustado pra incluir
-- partial_reason='almoco_inferido' como pendência. Aqui replicamos o filtro
-- no RPC que alimenta o badge agregado por funcionário pra ficar consistente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_count_by_employee(p_max_age_days integer DEFAULT 30)
RETURNS TABLE(employee_id uuid, employee_name text, department text, pending_count integer, overdue_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    employee_id,
    employee_name,
    department,
    COUNT(*)::int AS pending_count,
    COUNT(*) FILTER (WHERE urgency = 'overdue')::int AS overdue_count
  FROM public.v_time_pendings
  WHERE (
    (day_summary->>'status') IN ('inconsistent','irregular','partial')
    OR (day_summary->>'partial_reason') = 'almoco_inferido'
  )
    AND days_since <= p_max_age_days
  GROUP BY employee_id, employee_name, department;
$function$;
