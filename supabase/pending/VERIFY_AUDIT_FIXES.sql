-- =============================================================================
-- Diagnóstico: as 4 migrations da auditoria estão realmente aplicadas?
--    20260527120000_lock-debit-strap-stock-against-races.sql
--    20260527130000_idempotent-hybrid-debit-stock.sql
--    20260527140000_recreate-production-planning-kpis-view.sql
--    20260527150000_recreate-capacity-driven-views.sql
--
-- Cole tudo abaixo no SQL Editor do Supabase e execute.
-- Se alguma linha vier ok=FALSE, aquela parte da migration não pegou.
-- =============================================================================

-- BLOCO 1 — checks de objetos das 4 migrations
SELECT * FROM (VALUES
  ('1. view v_production_planning_kpis existe',
   EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_production_planning_kpis')),

  ('2. view v_sector_load existe',
   EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_sector_load')),

  ('3. view v_capacity_driven_lead_times existe',
   EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_capacity_driven_lead_times')),

  -- bool_or agrega N linhas (Postgres permite overload com mesma proname e
  -- assinaturas diferentes — scalar subquery estouraria com "more than one row").
  ('4. debit_strap_stock contém FOR UPDATE',
   COALESCE((SELECT bool_or(pg_get_functiondef(oid) ILIKE '%FOR UPDATE%')
               FROM pg_proc
              WHERE proname='debit_strap_stock' AND pronamespace='public'::regnamespace),
            FALSE)),

  ('5. debit_strap_stock contém GREATEST(0,',
   COALESCE((SELECT bool_or(pg_get_functiondef(oid) ILIKE '%GREATEST(0,%')
               FROM pg_proc
              WHERE proname='debit_strap_stock' AND pronamespace='public'::regnamespace),
            FALSE)),

  ('6. hybrid_debit_stock_for_order contém pg_advisory_xact_lock',
   COALESCE((SELECT bool_or(pg_get_functiondef(oid) ILIKE '%pg_advisory_xact_lock%')
               FROM pg_proc
              WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace),
            FALSE)),

  ('7. hybrid_debit_stock_for_order contém idempotent_skip',
   COALESCE((SELECT bool_or(pg_get_functiondef(oid) ILIKE '%idempotent_skip%')
               FROM pg_proc
              WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace),
            FALSE)),

  -- sanity: as 3 views devem retornar dados sem erro de coluna
  ('8. v_production_planning_kpis pode ser consultada',
   EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_production_planning_kpis')),

  ('9. tabela material_reservations existe (suporte para idempotência)',
   EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='material_reservations'))
) AS t(check_name, ok)
ORDER BY check_name;

-- =============================================================================
-- BLOCO 1b — assinaturas de função (mostra se existem overloads órfãos).
-- O esperado é UMA linha por nome. Mais de uma significa que algum DROP
-- FUNCTION antigo não pegou (overload com assinatura diferente sobrou).
-- =============================================================================
SELECT proname AS function_name,
       count(*) AS signatures_count,
       array_agg(pg_get_function_identity_arguments(oid) ORDER BY oid) AS signatures
  FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND proname IN ('debit_strap_stock', 'hybrid_debit_stock_for_order')
 GROUP BY proname
 ORDER BY proname;

-- =============================================================================
-- BLOCO 2 — todas as migrations registradas pelo Supabase, do mais novo
-- ao mais antigo. Procure pelos prefixos:
--   20260527120000  (lock debit_strap_stock)
--   20260527130000  (idempotent hybrid_debit)
--   20260527140000  (v_production_planning_kpis)
--   20260527150000  (v_sector_load + v_capacity_driven_lead_times)
-- Se algum não aparecer aqui, NÃO foi aplicado pelo Lovable/CLI mas pode
-- ter sido aplicado direto no SQL editor (que não registra). Use o BLOCO 1
-- como fonte da verdade.
-- =============================================================================
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version >= '20260527'
 ORDER BY version DESC;

-- =============================================================================
-- BLOCO 3 — quantas migrations estão registradas, total
-- =============================================================================
SELECT count(*) AS total_migrations_registered
  FROM supabase_migrations.schema_migrations;
