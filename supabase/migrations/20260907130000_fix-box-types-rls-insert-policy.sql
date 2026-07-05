-- =============================================================================
-- Fix RLS de box_types — INSERT bloqueado ("new row violates row-level security
-- policy for table box_types")
-- =============================================================================
--
-- Causa: a migration 20260528120000 (security-audit-fixes) HABILITOU RLS em
-- box_types (linha 119: ALTER TABLE public.box_types ENABLE ROW LEVEL SECURITY)
-- mas box_types NÃO está no array `needs_policies` daquela migration — ou seja,
-- o loop que cria approved_select/insert/update/delete NÃO rodou pra ela. Ela
-- dependia das policies criadas em 20260501100638 / 20260502100000 ("Approved
-- users can insert box_types"). No banco vivo essas policies sumiram (ou aquelas
-- migrations não aplicaram), então ficou: RLS LIGADO + SEM policy de INSERT =
-- todo insert rejeitado. SELECT só retornava vazio (0 linhas), por isso a tela
-- "Cadastro & Estoque" parecia normal até tentar cadastrar.
--
-- Fix: (re)cria as 4 policies no padrão canônico do projeto (mesmo de
-- 20260528120000), mantendo o gate is_approved_user() — NÃO afrouxa segurança.
-- Idempotente: dropa os dois esquemas de nome antigos antes de criar.
-- =============================================================================

ALTER TABLE public.box_types ENABLE ROW LEVEL SECURITY;

-- Limpa TODOS os nomes já usados (duas convenções) pra não duplicar policy.
DROP POLICY IF EXISTS "Approved users can view box_types"   ON public.box_types;
DROP POLICY IF EXISTS "Approved users can insert box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can update box_types" ON public.box_types;
DROP POLICY IF EXISTS "Approved users can delete box_types" ON public.box_types;
DROP POLICY IF EXISTS "approved_select" ON public.box_types;
DROP POLICY IF EXISTS "approved_insert" ON public.box_types;
DROP POLICY IF EXISTS "approved_update" ON public.box_types;
DROP POLICY IF EXISTS "approved_delete" ON public.box_types;

CREATE POLICY "approved_select" ON public.box_types
  FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()));
CREATE POLICY "approved_insert" ON public.box_types
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY "approved_update" ON public.box_types
  FOR UPDATE TO authenticated USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()));
CREATE POLICY "approved_delete" ON public.box_types
  FOR DELETE TO authenticated USING ((SELECT public.is_approved_user()));
