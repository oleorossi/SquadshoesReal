-- =============================================================================
-- v_audit_log_facets — opções dos filtros da Auditoria, agregadas no banco
-- =============================================================================
--
-- Contexto (03/08/2026)
-- ---------------------
-- A tela de Auditoria montava os dropdowns "Recurso" e "Ação" baixando 1.000
-- linhas de `audit_logs` e rodando `new Set(...)` em JS. Como a tabela tem
-- 1.414 linhas e a query ordenava por `created_at DESC`, as opções vinham só
-- dos registros MAIS RECENTES: um recurso que parou de ser usado há tempo
-- simplesmente sumia do filtro, e o usuário não tinha como filtrar por ele.
--
-- Agregar é trabalho de banco. O DISTINCT roda no Postgres e trafegam algumas
-- dezenas de linhas em vez de mil.
--
-- PostgREST não expõe DISTINCT, daí a view.
--
-- `security_invoker = true`: mantém as policies RLS de `audit_logs` valendo —
-- sem isso a view rodaria com os direitos do dono e viraria bypass.
-- =============================================================================

DROP VIEW IF EXISTS public.v_audit_log_facets;

CREATE VIEW public.v_audit_log_facets
WITH (security_invoker = true) AS
SELECT DISTINCT
  resource,
  action
FROM public.audit_logs
WHERE resource IS NOT NULL
   OR action IS NOT NULL;

COMMENT ON VIEW public.v_audit_log_facets IS 'Valores distintos de resource/action pra alimentar os dropdowns da tela de Auditoria sem baixar a tabela. Antes o front baixava 1.000 linhas e fazia Set() em JS, perdendo as opcoes mais antigas.';

GRANT SELECT ON public.v_audit_log_facets TO authenticated;
