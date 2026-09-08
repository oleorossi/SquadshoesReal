-- =============================================================================
-- FICHA DE MONTADORES — ACESSO DO PRÓPRIO FUNCIONÁRIO
--
-- Problema: só o administrativo lança e consulta. O montador/solador (regime
-- por par) não tem login vinculado nem escopo de linha.
--
-- Solução:
-- 1. employees.user_id → auth.users (1:1, nullable)
-- 2. papel app_role 'montador'
-- 3. helpers current_employee_id / is_ficha_montadores_manager
-- 4. RLS por escopo (gestor vê tudo; montador só a própria linha)
-- 5. trigger de reforço (UI sozinha não basta)
-- =============================================================================

-- 1) Papel montador ----------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'montador';

-- 2) Vínculo login ↔ funcionário ---------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_user_id_fkey'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_uniq
  ON public.employees (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.employees.user_id IS
  'Login ERP vinculado a este funcionário. Usado pela tela /minha-producao (self-service da Ficha de Montadores). NULL = sem acesso próprio.';

-- 3) Helpers -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.employees e
   WHERE e.user_id = auth.uid()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_ficha_montadores_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.user_has_any_role(
    ARRAY['admin', 'gerente', 'producao', 'rh', 'consulta']::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.is_ficha_montadores_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ficha_montadores_manager() TO authenticated;

-- 4) RLS ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "ficha_montadores_select_auth" ON public.ficha_montadores;
DROP POLICY IF EXISTS "ficha_montadores_insert_approved" ON public.ficha_montadores;
DROP POLICY IF EXISTS "ficha_montadores_update_approved" ON public.ficha_montadores;
DROP POLICY IF EXISTS "ficha_montadores_delete_approved" ON public.ficha_montadores;
DROP POLICY IF EXISTS ficha_montadores_select_scoped ON public.ficha_montadores;
DROP POLICY IF EXISTS ficha_montadores_insert_scoped ON public.ficha_montadores;
DROP POLICY IF EXISTS ficha_montadores_update_scoped ON public.ficha_montadores;
DROP POLICY IF EXISTS ficha_montadores_delete_scoped ON public.ficha_montadores;

CREATE POLICY ficha_montadores_select_scoped ON public.ficha_montadores
  FOR SELECT TO authenticated
  USING (
    public.is_approved_user()
    AND (
      public.is_ficha_montadores_manager()
      OR montador_id = public.current_employee_id()
    )
  );

CREATE POLICY ficha_montadores_insert_scoped ON public.ficha_montadores
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_approved_user()
    AND (
      public.is_ficha_montadores_manager()
      OR montador_id = public.current_employee_id()
    )
  );

CREATE POLICY ficha_montadores_update_scoped ON public.ficha_montadores
  FOR UPDATE TO authenticated
  USING (
    public.is_approved_user()
    AND (
      public.is_ficha_montadores_manager()
      OR montador_id = public.current_employee_id()
    )
  )
  WITH CHECK (
    public.is_approved_user()
    AND (
      public.is_ficha_montadores_manager()
      OR montador_id = public.current_employee_id()
    )
  );

-- Exclusão: gestor OU o próprio (zerar o dia via save_ficha_montadores_batch
-- faz DELETE quando total=0 — precisa passar na policy).
CREATE POLICY ficha_montadores_delete_scoped ON public.ficha_montadores
  FOR DELETE TO authenticated
  USING (
    public.is_approved_user()
    AND (
      public.is_ficha_montadores_manager()
      OR montador_id = public.current_employee_id()
    )
  );

-- 5) Trigger de reforço (RPC SECURITY INVOKER + cliente REST) ----------------------
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_enforce_self()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid;
BEGIN
  IF public.is_ficha_montadores_manager() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_me := public.current_employee_id();
  IF v_me IS NULL THEN
    RAISE EXCEPTION
      'Sua conta não está vinculada a um funcionário. Peça ao RH para vincular em Funcionários → Conta de acesso.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.montador_id IS DISTINCT FROM v_me THEN
      RAISE EXCEPTION
        'Você só pode zerar a própria produção.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.montador_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION
      'Você só pode lançar a própria produção.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.montador_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION
      'Você só pode alterar a própria produção.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ficha_montadores_enforce_self ON public.ficha_montadores;
-- Nome com "aa_" pra rodar cedo (ordem alfabética) antes dos demais BEFORE.
CREATE TRIGGER trg_aa_ficha_montadores_enforce_self
  BEFORE INSERT OR UPDATE OR DELETE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_enforce_self();
