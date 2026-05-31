-- =============================================================================
-- AUDITORIA C3 (CRÍTICO/segurança): fechar RLS-off + escrita ANÔNIMA em
-- sole_size_conjugations e 3 tabelas de log.
-- =============================================================================
-- Estado encontrado (get_advisors rls_disabled_in_public + grants): as 4 tabelas
-- tinham relrowsecurity=false e `anon` com INSERT/UPDATE/DELETE/TRUNCATE. Como a
-- anon key está no bundle público, qualquer um SEM login podia alterar
-- sole_size_conjugations via REST — e essa tabela é lida por get_sole_size_key/
-- debit_sole_stock_by_grade, então mexer nela corrompe o débito de estoque por
-- numeração de TODAS as OPs com grade.
--
-- Seguro: NENHUMA função atual escreve nessas tabelas (a feature de conjugação foi
-- removida; logs foram populados por migrations de manutenção rodando como admin).
-- As funções de débito que LEEM sole_size_conjugations são SECURITY DEFINER e
-- bypassam RLS — portanto habilitar RLS não quebra o débito.
-- =============================================================================

ALTER TABLE public.sole_size_conjugations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sole_grade_split_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_materials_cleanup_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sole_size_conjugations_removed_log  ENABLE ROW LEVEL SECURITY;

-- corta TODO acesso anônimo (não autenticado) — o ponto crítico
REVOKE ALL ON public.sole_size_conjugations             FROM anon;
REVOKE ALL ON public.sole_grade_split_log               FROM anon;
REVOKE ALL ON public.sheet_materials_cleanup_log        FROM anon;
REVOKE ALL ON public.sole_size_conjugations_removed_log FROM anon;

-- logs: nenhum cliente escreve direto (só funções SECURITY DEFINER, que bypassam grants/RLS)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sole_grade_split_log               FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sheet_materials_cleanup_log        FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sole_size_conjugations_removed_log FROM authenticated;

-- sole_size_conjugations: leitura p/ usuário aprovado; escrita só admin/gerente/produção.
DROP POLICY IF EXISTS ssc_select ON public.sole_size_conjugations;
CREATE POLICY ssc_select ON public.sole_size_conjugations
  FOR SELECT TO authenticated USING (public.is_approved_user());
DROP POLICY IF EXISTS ssc_write ON public.sole_size_conjugations;
CREATE POLICY ssc_write ON public.sole_size_conjugations
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin','gerente','producao']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin','gerente','producao']));

-- logs de auditoria: leitura só admin/gerente; escrita só por funções DEFINER.
DROP POLICY IF EXISTS sgsl_select ON public.sole_grade_split_log;
CREATE POLICY sgsl_select ON public.sole_grade_split_log
  FOR SELECT TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente']));
DROP POLICY IF EXISTS smcl_select ON public.sheet_materials_cleanup_log;
CREATE POLICY smcl_select ON public.sheet_materials_cleanup_log
  FOR SELECT TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente']));
DROP POLICY IF EXISTS sscrl_select ON public.sole_size_conjugations_removed_log;
CREATE POLICY sscrl_select ON public.sole_size_conjugations_removed_log
  FOR SELECT TO authenticated USING (public.user_has_any_role(ARRAY['admin','gerente']));
