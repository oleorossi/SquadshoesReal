-- Recovery one-shot: liberar pool + reduzir superficie PostgREST + reload
-- Uso: supabase-db-exec ou MCP execute_sql quando houver slot.
SET default_transaction_read_only = off;
SET transaction_read_only = off;

-- 1) Matar autenticators travados no schema cache (nao mata LISTEN pgrst)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND usename = 'authenticator'
  AND query NOT ILIKE 'LISTEN%'
  AND (
    state LIKE 'idle in transaction%'
    OR (state = 'active' AND now() - query_start > interval '20 seconds')
    OR (state = 'idle' AND query ~* '^(ABORT|COMMIT|SET client_encoding)')
  );

-- 2) Matar clients idle ha > 2 min (libera slots sem derrubar auth/admin recentes)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state = 'idle'
  AND usename IN ('authenticator', 'supabase_admin', 'postgres')
  AND query NOT ILIKE 'LISTEN%'
  AND now() - state_change > interval '2 minutes'
  AND application_name IS DISTINCT FROM 'postgrest';

ALTER ROLE authenticator SET statement_timeout = 0;
ALTER ROLE authenticator SET lock_timeout = '60s';

-- Tira graphql_public do schema cache (menos introspeccao). O app usa REST, nao GraphQL.
-- Depois do incidente, o Dashboard volta a mandar se fizer RESET pgrst.db_schemas.
ALTER ROLE authenticator SET pgrst.db_schemas = 'public';
NOTIFY pgrst, 'reload config';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- 3) Mover views orfas (fail-closed via pg_depend)
DO $body$
DECLARE
  v_name text;
  v_oid oid;
  v_deps int;
  v_moved int := 0;
  v_pass int;
  v_pass_moved int;
  v_views text[] := ARRAY[
    'v_costura_backlog_30d','v_costura_capacity_plan','v_cycle_counts_summary',
    'v_delivery_routes_summary','v_demand_forecast','v_demand_history_monthly',
    'v_employee_punch_pattern','v_ficha_sole_range_mismatch','v_lasts_with_usage',
    'v_late_orders','v_legacy_artisanal_strap_recipe_history','v_lots_active',
    'v_nfe_sequence_gaps','v_open_purchase_orders','v_open_service_orders',
    'v_operator_productivity','v_order_lot_traceability','v_order_pickup_window',
    'v_outsourced_in_field','v_overdue_purchase_orders','v_production_planning_kpis',
    'v_products_abc_class','v_products_below_rop','v_products_missing_supplier',
    'v_products_missing_supplier_active_demand','v_products_with_location',
    'v_quality_cost','v_quality_pareto','v_quality_pareto_by_sector','v_sector_load',
    'v_service_order_refs','v_sheets_missing_lining_consumption','v_shoe_category_unmapped',
    'v_stage_quality','v_time_import_archive','vw_cash_flow_projection',
    'vw_costura_queue','vw_necessidade_corte','vw_necessidade_costura',
    'vw_production_labels','vw_supplier_quality_rating'
  ];
BEGIN
  FOR v_pass IN 1..5 LOOP
    v_pass_moved := 0;
    FOREACH v_name IN ARRAY v_views LOOP
      SELECT c.oid INTO v_oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_name AND c.relkind = 'v';
      IF v_oid IS NULL THEN CONTINUE; END IF;
      SELECT count(*)::int INTO v_deps
        FROM pg_depend d
        JOIN pg_class dc ON dc.oid = d.objid
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
       WHERE d.refobjid = v_oid AND d.deptype IN ('n','a')
         AND dn.nspname = 'public' AND dc.oid <> v_oid;
      IF v_deps > 0 THEN CONTINUE; END IF;
      EXECUTE format('ALTER VIEW public.%I SET SCHEMA private', v_name);
      EXECUTE format(
        'REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role',
        v_name
      );
      v_pass_moved := v_pass_moved + 1;
      v_moved := v_moved + 1;
    END LOOP;
    EXIT WHEN v_pass_moved = 0;
  END LOOP;
  RAISE NOTICE 'recovery moved % views to private', v_moved;
END;
$body$;

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v') AS public_views,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relkind='v') AS private_views,
  (SELECT rolconfig FROM pg_roles WHERE rolname='authenticator') AS authenticator_config;
