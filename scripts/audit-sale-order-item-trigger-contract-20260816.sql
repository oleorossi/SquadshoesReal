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
