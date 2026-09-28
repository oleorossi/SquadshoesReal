-- =============================================================================
-- Organizar superficie PostgREST: private + timeout de schema cache
-- =============================================================================
-- Incidente 28/09/2026: PostgREST falhou com PGRST002 / 57014 ao montar o
-- schema cache de `public` (centenas de funcoes + ~120 views). O teto de 300s
-- no role `authenticator` (mig 29500) ainda era curto quando a introspeccao
-- de dependencias de view passava de ~7min e o cliente desconectava.
--
-- Esta migration:
--   1. tira o teto do authenticator (statement_timeout=0) so no bootstrap do
--      PostgREST — anon/authenticated nao mudam;
--   2. garante o schema `private` fechado (sem USAGE pra roles de API);
--   3. move pra `private` views orfas do frontend que nao tenham dependentes
--      vivos em `public` (checagem via pg_depend — fail-closed);
--   4. move helpers internos de migracao de tiras (nao sao RPC do app);
--   5. pede reload do schema cache.
--
-- NAO move: wrappers de RPC do frontend/edge, `_impl` chamados por public.*,
-- crons (`trigger_*_cron`), nem guards de diagnostico usados em
-- SystemDiagnostics / test:db.
--
-- Marcador: organize_postgrest_private_surface_20270101029600
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. authenticator: schema cache nao pode morrer no meio
-- -----------------------------------------------------------------------------
ALTER ROLE authenticator SET statement_timeout = 0;
ALTER ROLE authenticator SET lock_timeout = '60s';

DO $verify_authn$
DECLARE
  v_authn text[];
BEGIN
  SELECT coalesce(rolconfig, ARRAY[]::text[]) INTO v_authn
    FROM pg_roles WHERE rolname = 'authenticator';

  IF NOT (
    'statement_timeout=0' = ANY (v_authn)
    OR 'statement_timeout=0s' = ANY (v_authn)
  ) THEN
    RAISE EXCEPTION 'authenticator sem statement_timeout=0: %', v_authn;
  END IF;
END;
$verify_authn$;

-- -----------------------------------------------------------------------------
-- 2. schema private — superficie interna, fora do db-schemas do PostgREST
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. mover views orfas (somente se sem dependentes em public)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private._org_move_view_if_unreferenced(p_view text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_oid oid;
  v_deps int;
BEGIN
  SELECT c.oid INTO v_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = p_view
     AND c.relkind = 'v';

  IF v_oid IS NULL THEN
    RETURN false;
  END IF;

  -- Dependentes que NAO sao o proprio objeto / regra interna da view.
  SELECT count(*)::int INTO v_deps
    FROM pg_depend d
    JOIN pg_class dc ON dc.oid = d.objid
    JOIN pg_namespace dn ON dn.oid = dc.relnamespace
   WHERE d.refobjid = v_oid
     AND d.deptype IN ('n', 'a')
     AND dn.nspname = 'public'
     AND dc.oid <> v_oid;

  IF v_deps > 0 THEN
    RAISE NOTICE 'organize: skip view %.% — % dependentes public',
      'public', p_view, v_deps;
    RETURN false;
  END IF;

  EXECUTE format('ALTER VIEW public.%I SET SCHEMA private', p_view);
  EXECUTE format(
    'REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role',
    p_view
  );
  RAISE NOTICE 'organize: moved view public.% → private.%', p_view, p_view;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION private._org_move_view_if_unreferenced(text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $move_views$
DECLARE
  v_name text;
  v_moved int := 0;
  v_pass_moved int;
  v_pass int;
  -- Safelist: nomes que o frontend/edge NAO consultam (varredura 28/09/2026).
  -- A guarda de pg_depend ainda bloqueia se houver consumidor SQL vivo.
  -- Varias passagens: folhas da safelist saem primeiro e liberam pais.
  v_views text[] := ARRAY[
    'v_costura_backlog_30d',
    'v_costura_capacity_plan',
    'v_cycle_counts_summary',
    'v_delivery_routes_summary',
    'v_demand_forecast',
    'v_demand_history_monthly',
    'v_employee_punch_pattern',
    'v_ficha_sole_range_mismatch',
    'v_lasts_with_usage',
    'v_late_orders',
    'v_legacy_artisanal_strap_recipe_history',
    'v_lots_active',
    'v_nfe_sequence_gaps',
    'v_open_purchase_orders',
    'v_open_service_orders',
    'v_operator_productivity',
    'v_order_lot_traceability',
    'v_order_pickup_window',
    'v_outsourced_in_field',
    'v_overdue_purchase_orders',
    'v_production_planning_kpis',
    'v_products_abc_class',
    'v_products_below_rop',
    'v_products_missing_supplier',
    'v_products_missing_supplier_active_demand',
    'v_products_with_location',
    'v_quality_cost',
    'v_quality_pareto',
    'v_quality_pareto_by_sector',
    'v_sector_load',
    'v_service_order_refs',
    'v_sheets_missing_lining_consumption',
    'v_shoe_category_unmapped',
    'v_stage_quality',
    'v_time_import_archive',
    'vw_cash_flow_projection',
    'vw_costura_queue',
    'vw_necessidade_corte',
    'vw_necessidade_costura',
    'vw_production_labels',
    'vw_supplier_quality_rating'
  ];
BEGIN
  FOR v_pass IN 1..5 LOOP
    v_pass_moved := 0;
    FOREACH v_name IN ARRAY v_views LOOP
      IF private._org_move_view_if_unreferenced(v_name) THEN
        v_pass_moved := v_pass_moved + 1;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
    EXIT WHEN v_pass_moved = 0;
  END LOOP;
  RAISE NOTICE 'organize: % views movidas para private', v_moved;
END;
$move_views$;

-- -----------------------------------------------------------------------------
-- 4. mover helpers internos de migracao de tiras (nao sao RPC do app)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private._org_move_function_if_unreferenced(
  p_name text,
  p_identity_args text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_oid oid;
  v_deps int;
  v_reg text;
BEGIN
  IF p_identity_args IS NULL THEN
    SELECT p.oid INTO v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = p_name
     ORDER BY p.oid
     LIMIT 1;
  ELSE
    v_reg := format('public.%I(%s)', p_name, p_identity_args);
    v_oid := to_regprocedure(v_reg);
  END IF;

  IF v_oid IS NULL THEN
    RETURN false;
  END IF;

  SELECT count(*)::int INTO v_deps
    FROM pg_depend d
   WHERE d.refobjid = v_oid
     AND d.deptype IN ('n', 'a');

  IF v_deps > 0 THEN
    RAISE NOTICE 'organize: skip function % — % dependentes', p_name, v_deps;
    RETURN false;
  END IF;

  EXECUTE format(
    'ALTER FUNCTION %s SET SCHEMA private',
    v_oid::regprocedure
  );
  EXECUTE format(
    'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
    v_oid::regprocedure
  );
  RAISE NOTICE 'organize: moved function % → private', p_name;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION private._org_move_function_if_unreferenced(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $move_funcs$
DECLARE
  v_name text;
  v_moved int := 0;
  v_funcs text[] := ARRAY[
    'artisanal_strap_legacy_state_checksum',
    'artisanal_strap_product_mapping_scope_checksum',
    'artisanal_strap_product_mapping_scope_snapshot',
    'current_artisanal_strap_migration_snapshot',
    'finish_artisanal_strap_migration_snapshot',
    'record_artisanal_strap_migration_snapshot',
    'run_artisanal_strap_catalog_migration_dry_run_unfenced_202701'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_funcs LOOP
    IF private._org_move_function_if_unreferenced(v_name, NULL) THEN
      v_moved := v_moved + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'organize: % funcoes movidas para private', v_moved;
END;
$move_funcs$;

-- Helpers de organizacao nao precisam ficar invocaveis depois do one-shot.
DROP FUNCTION IF EXISTS private._org_move_view_if_unreferenced(text);
DROP FUNCTION IF EXISTS private._org_move_function_if_unreferenced(text, text);

NOTIFY pgrst, 'reload schema';
