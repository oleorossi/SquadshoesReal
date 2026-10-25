-- Expand weekly_balance_audit_log.action CHECK to allow reimport protect/unlock.
-- Live bug (25/10/2026): set_time_record_reimport_protection inseria
-- 'reimport_protect' / 'reimport_unlock', mas o CHECK legado só aceitava
-- snapshot|unlock|retroactive_*|recompute — unlock da UI estourava 23514.

ALTER TABLE public.weekly_balance_audit_log
  DROP CONSTRAINT IF EXISTS weekly_balance_audit_log_action_check;

ALTER TABLE public.weekly_balance_audit_log
  ADD CONSTRAINT weekly_balance_audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'snapshot'::text,
    'unlock'::text,
    'retroactive_edit'::text,
    'retroactive_insert'::text,
    'retroactive_delete'::text,
    'recompute'::text,
    'reimport_protect'::text,
    'reimport_unlock'::text
  ]));

COMMENT ON CONSTRAINT weekly_balance_audit_log_action_check
  ON public.weekly_balance_audit_log IS
  'Ações de auditoria do banco de horas + protect/unlock de reimport de ponto.';
