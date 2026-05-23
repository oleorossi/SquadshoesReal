-- Auditoria 23/05/2026: AuditLogs.tsx faz select('*, user:profiles(...)')
-- que precisa de FK declarada audit_logs.user_id -> profiles.id pro
-- PostgREST auto-detectar o relationship. Sem FK, retorna HTTP 400
-- "Could not find a relationship between audit_logs and profiles".
--
-- Usa NOT VALID + VALIDATE pra não bloquear caso haja user_id órfão
-- (logs antigos com usuário deletado). ON DELETE SET NULL pra permitir
-- exclusão de profile sem perder o histórico do log.

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL
  NOT VALID;

-- Limpa user_ids órfãos antes de validar
UPDATE public.audit_logs SET user_id = NULL
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM public.profiles);

ALTER TABLE public.audit_logs VALIDATE CONSTRAINT audit_logs_user_id_fkey;
