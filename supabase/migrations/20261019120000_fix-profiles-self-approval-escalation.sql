-- P0 — escalação de privilégio por auto-aprovação em public.profiles.
--
-- CADEIA MEDIDA EM PRODUÇÃO (30/07/2026):
--   1. o trigger `on_auth_user_created` cria a linha em profiles no signup,
--      com `approved` no default `false`;
--   2. a policy `profiles_update` (FOR UPDATE TO authenticated) tem
--      USING/WITH CHECK = `id = auth.uid() OR has_role(auth.uid(),'admin')`,
--      SEM nenhuma restrição de coluna;
--   3. `is_approved_user()` lê `profiles.approved` e é o portão de 297 policies.
--
--   ⇒ um usuário autenticado qualquer roda
--        UPDATE public.profiles SET approved = true WHERE id = auth.uid();
--      e passa a enxergar/escrever o ERP inteiro.
--
-- HISTÓRICO — por que a guarda sumiu:
--   `20260525120002_fix-profiles-self-approval-rls.sql` criava exatamente essa
--   proteção, mas NUNCA foi aplicada (auditoria de registro de migrations,
--   30/07/2026: a policy que ela cria não existe e nunca existiu no banco).
--   Três dias depois, `20260528130000_perf-audit-fixes.sql` — essa sim aplicada —
--   consolidou as duas policies de UPDATE numa só (`profiles_update`) e recriou
--   o predicado SEM a guarda de coluna.
--
-- POR QUE TEM TRIGGER, E NÃO SÓ POLICY:
--   a falha acima é o modo de falha da guarda-só-em-policy: qualquer migration
--   futura que reescreva a policy (consolidação de performance, refactor de RLS)
--   apaga a proteção em silêncio. O trigger sobrevive a reescrita de policy e é
--   avaliado mesmo em caminhos que não passam por RLS de UPDATE.
--   Defesa em profundidade: as duas camadas.
--
-- COLUNAS PRIVILEGIADAS PROTEGIDAS: `approved` (portão de acesso) e
-- `is_sales_rep` (define o escopo de representante). As demais (full_name,
-- avatar_url, email…) o próprio usuário continua editando normalmente.

-- ============================================================================
-- Camada 1 — trigger (sobrevive a reescrita de policy)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_profiles_block_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Sem uid autenticado = service_role, migration ou SQL Editor: o fluxo de
  -- aprovação pelo admin passa por aqui e deve continuar funcionando.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin pode tudo (inclusive aprovar terceiros).
  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Usuário comum: congela as colunas privilegiadas no valor anterior.
  -- Não levanta exceção de propósito — o UPDATE legítimo dos campos de perfil
  -- (nome, avatar) continua passando; só a tentativa de escalar é neutralizada.
  NEW.approved     := OLD.approved;
  NEW.is_sales_rep := OLD.is_sales_rep;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_block_privilege_escalation() IS
  'Impede que um usuário autenticado altere as próprias colunas privilegiadas '
  '(approved, is_sales_rep). Admin e service_role passam livres. Existe como '
  'trigger — e não só como predicado de policy — porque a guarda anterior vivia '
  'só na policy e foi apagada por uma consolidação de RLS em 28/05/2026.';

DROP TRIGGER IF EXISTS tg_profiles_block_privilege_escalation ON public.profiles;
CREATE TRIGGER tg_profiles_block_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_block_privilege_escalation();

-- ============================================================================
-- Camada 2 — a policy volta a carregar a guarda explícita
-- ============================================================================

-- Helper SECURITY DEFINER: lê o valor gravado sem reentrar na RLS de profiles
-- (subquery direta na própria tabela dentro do WITH CHECK arrisca recursão).
CREATE OR REPLACE FUNCTION public.current_profile_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT approved FROM public.profiles WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR (
      id = (SELECT auth.uid())
      AND approved IS NOT DISTINCT FROM public.current_profile_approved()
    )
  );

COMMENT ON POLICY "profiles_update" ON public.profiles IS
  'Usuário autenticado edita a própria linha, mas não pode virar a coluna '
  'approved — auto-aprovação é bloqueada aqui e, redundantemente, pelo trigger '
  'tg_profiles_block_privilege_escalation. Aprovação legítima é feita por admin '
  'ou via service-role (que ignora RLS).';
