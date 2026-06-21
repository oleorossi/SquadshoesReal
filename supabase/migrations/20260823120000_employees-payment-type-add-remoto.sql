-- employees.payment_type: incluir 'remoto' na CHECK constraint — 2026-06-20
-- ============================================================================
-- Erro: "new row for relation employees violates check constraint
-- employees_payment_type_check" ao salvar funcionário com regime REMOTO.
-- A constraint só permitia ('mensalista','diarista') — o regime 'remoto'
-- (full salary, sem ponto) foi adicionado no front (useEmployees + Employees.tsx)
-- mas faltou liberar no banco. Inclui 'remoto'. NULL continua permitido.
-- Idempotente. Aplicado via MCP.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_payment_type_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_payment_type_check
  CHECK (payment_type IS NULL OR payment_type = ANY (ARRAY['mensalista'::text, 'diarista'::text, 'remoto'::text]));
