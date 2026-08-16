SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname NOT IN ('debit_strap_stock', 'deprecated_strap_stock_noop')
  AND p.prosrc LIKE '%debit_strap_stock%'
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);
