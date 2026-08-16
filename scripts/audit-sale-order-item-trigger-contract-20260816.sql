-- Diagnóstico read-only do contrato vivo de triggers em sale_order_items.
SELECT
  trigger_catalog.tgname AS trigger_name,
  trigger_catalog.tgenabled AS enabled_mode,
  trigger_function.oid::regprocedure::text AS function_signature,
  pg_get_triggerdef(trigger_catalog.oid, true) AS trigger_definition
FROM pg_catalog.pg_trigger trigger_catalog
JOIN pg_catalog.pg_proc trigger_function
  ON trigger_function.oid = trigger_catalog.tgfoid
WHERE trigger_catalog.tgrelid = 'public.sale_order_items'::regclass
  AND NOT trigger_catalog.tgisinternal
ORDER BY trigger_catalog.tgname;

SELECT
  procedure_catalog.oid::regprocedure::text AS function_signature,
  procedure_catalog.prosecdef AS security_definer
FROM pg_catalog.pg_proc procedure_catalog
JOIN pg_catalog.pg_namespace namespace_catalog
  ON namespace_catalog.oid = procedure_catalog.pronamespace
WHERE namespace_catalog.nspname = 'public'
  AND (
    procedure_catalog.proname ILIKE '%sale_order_total%'
    OR procedure_catalog.proname ILIKE '%costs_dirty%'
    OR procedure_catalog.proname ILIKE '%reservations_outdated%'
    OR procedure_catalog.proname ILIKE '%sync_orders_from_sale_order_item%'
    OR procedure_catalog.proname ILIKE '%strap_demands_on_item_change%'
  )
ORDER BY procedure_catalog.oid::regprocedure::text;
