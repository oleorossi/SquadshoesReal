-- Cole no SQL Editor do Supabase. Devolve UMA linha só.
-- Copia o valor da coluna `resultado` e me manda.

SELECT
  CASE WHEN EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_production_planning_kpis') THEN 'OK' ELSE 'FALTA' END
    || ' | view v_production_planning_kpis' || E'\n' ||
  CASE WHEN EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_sector_load') THEN 'OK' ELSE 'FALTA' END
    || ' | view v_sector_load' || E'\n' ||
  CASE WHEN EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='v_capacity_driven_lead_times') THEN 'OK' ELSE 'FALTA' END
    || ' | view v_capacity_driven_lead_times' || E'\n' ||
  CASE WHEN COALESCE(
              (SELECT bool_or(pg_get_functiondef(oid) ILIKE '%FOR UPDATE%')
                 FROM pg_proc
                WHERE proname='debit_strap_stock' AND pronamespace='public'::regnamespace), FALSE)
       THEN 'OK' ELSE 'FALTA' END
    || ' | debit_strap_stock contém FOR UPDATE' || E'\n' ||
  CASE WHEN COALESCE(
              (SELECT bool_or(pg_get_functiondef(oid) ILIKE '%GREATEST(0,%')
                 FROM pg_proc
                WHERE proname='debit_strap_stock' AND pronamespace='public'::regnamespace), FALSE)
       THEN 'OK' ELSE 'FALTA' END
    || ' | debit_strap_stock contém GREATEST(0,' || E'\n' ||
  CASE WHEN COALESCE(
              (SELECT bool_or(pg_get_functiondef(oid) ILIKE '%pg_advisory_xact_lock%')
                 FROM pg_proc
                WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace), FALSE)
       THEN 'OK' ELSE 'FALTA' END
    || ' | hybrid_debit contém pg_advisory_xact_lock' || E'\n' ||
  CASE WHEN COALESCE(
              (SELECT bool_or(pg_get_functiondef(oid) ILIKE '%idempotent_skip%')
                 FROM pg_proc
                WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace), FALSE)
       THEN 'OK' ELSE 'FALTA' END
    || ' | hybrid_debit contém idempotent_skip' || E'\n' ||
  '---' || E'\n' ||
  'debit_strap_stock: ' ||
    (SELECT count(*)::text || ' versão(ões)' FROM pg_proc
      WHERE proname='debit_strap_stock' AND pronamespace='public'::regnamespace) || E'\n' ||
  'hybrid_debit_stock_for_order: ' ||
    (SELECT count(*)::text || ' versão(ões)' FROM pg_proc
      WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace)
  AS resultado;
