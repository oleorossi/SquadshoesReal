WITH required_relations(name) AS (
  VALUES
    ('public.artisanal_strap_variants'),
    ('public.sale_order_strap_demands'),
    ('public.strap_demand_jobs'),
    ('public.strap_rework_material_requests'),
    ('public.artisanal_strap_migration_cutovers'),
    ('public.v_strap_purchase_order_items_operational'),
    ('public.v_strap_service_order_items_operational'),
    ('public.v_strap_cost_variance_operational')
), required_functions(name) AS (
  VALUES
    ('resolve_artisanal_strap_source_availability'),
    ('preview_sale_order_strap_demand'),
    ('process_strap_demand_job'),
    ('override_sale_order_item_strap_sourcing'),
    ('register_strap_purchase_receipt'),
    ('register_strap_production_receipt'),
    ('apply_artisanal_strap_migration'),
    ('rollback_artisanal_strap_migration')
), required_triggers(name) AS (
  VALUES
    ('trg_enqueue_strap_demands_on_sale_order_confirm'),
    ('trg_enqueue_strap_demands_on_item_change'),
    ('trg_guard_strap_purchase_order'),
    ('trg_guard_strap_purchase_order_item'),
    ('trg_z_guard_strap_engine_reservation'),
    ('trg_z_guard_canonical_strap_service_order'),
    ('trg_z_guard_canonical_strap_stock_movement')
), live_legacy_callers AS (
  SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname NOT IN ('debit_strap_stock','deprecated_strap_stock_noop')
     AND p.prosrc LIKE '%debit_strap_stock%'
), public_security_definers AS (
  SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE n.nspname='public' AND p.prosecdef
     AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
     AND (p.proname LIKE '%strap%' OR p.proname LIKE '%artisanal%')
), migration_history AS (
  SELECT to_jsonb(m) AS row
    FROM supabase_migrations.schema_migrations m
   WHERE coalesce(to_jsonb(m)->>'version','') LIKE '20270101003%'
)
SELECT jsonb_build_object(
  'missing_relations',coalesce((
    SELECT jsonb_agg(name ORDER BY name) FROM required_relations
     WHERE to_regclass(name) IS NULL),'[]'::jsonb),
  'missing_functions',coalesce((
    SELECT jsonb_agg(r.name ORDER BY r.name) FROM required_functions r
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=r.name
     )),'[]'::jsonb),
  'missing_triggers',coalesce((
    SELECT jsonb_agg(r.name ORDER BY r.name) FROM required_triggers r
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_trigger t WHERE t.tgname=r.name AND NOT t.tgisinternal
     )),'[]'::jsonb),
  'live_legacy_callers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM live_legacy_callers x),'[]'::jsonb),
  'public_security_definers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public_security_definers x),'[]'::jsonb),
  'document_bucket_exists',EXISTS(
    SELECT 1 FROM storage.buckets b WHERE b.id='strap-purchase-orders' AND b.public=false
  ),
  'worker_cron_exists',EXISTS(
    SELECT 1 FROM cron.job WHERE command LIKE '%drain_strap_demand_jobs%'
  ),
  'notification_cron_exists',EXISTS(
    SELECT 1 FROM cron.job WHERE jobname='artisanal-strap-purchase-order-notifications'
  ),
  'timesheet_archive_view_exists',to_regclass('public.v_time_import_archive') IS NOT NULL,
  'timesheet_archive_function_exists',EXISTS(
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='import_time_records_with_archive'
  ),
  'migration_history',coalesce((SELECT jsonb_agg(row) FROM migration_history),'[]'::jsonb)
) AS audit;
