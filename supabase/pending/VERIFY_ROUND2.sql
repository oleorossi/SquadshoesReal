-- Verifica se as 2 migrations da rodada de auditoria 2 foram aplicadas.
-- Cole no SQL Editor do Supabase. Devolve 1 linha.

SELECT
  -- 1) shipment guard com fallback 'producao' (não 'homologacao')
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname='register_order_shipment'
       AND pronamespace='public'::regnamespace
       AND pg_get_functiondef(oid) ILIKE E'%COALESCE(MAX(ambiente), \'producao\')%'
  ) THEN 'OK' ELSE 'FALTA' END
    || ' | shipment guard fallback = producao' || E'\n' ||

  -- 2) trigger de auto-cancel de mrp_suggestions
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.orders'::regclass
       AND tgname='trg_cancel_mrp_suggestions_on_order_cancel'
  ) THEN 'OK' ELSE 'FALTA' END
    || ' | trigger trg_cancel_mrp_suggestions_on_order_cancel' || E'\n' ||

  -- 3) função do trigger existe
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname='cancel_mrp_suggestions_on_order_cancel'
       AND pronamespace='public'::regnamespace
  ) THEN 'OK' ELSE 'FALTA' END
    || ' | função cancel_mrp_suggestions_on_order_cancel' || E'\n' ||

  -- 4) backfill: quantas mrp_suggestions ainda estão 'open' vinculadas a OPs canceladas
  '---' || E'\n' ||
  'orphaned_open_mrp_suggestions: ' ||
  (SELECT count(*)::text FROM public.mrp_suggestions ms
     JOIN public.orders o ON ms.order_id = o.id
    WHERE o.status = 'Cancelada' AND ms.status IN ('open','accepted')) ||
  ' (esperado: 0 após backfill)' || E'\n' ||

  -- 5) shipment guard ainda só com 1 versão
  'register_order_shipment_versions: ' ||
  (SELECT count(*)::text FROM pg_proc
    WHERE proname='register_order_shipment'
      AND pronamespace='public'::regnamespace) ||
  ' (esperado: 1)'
  AS resultado;
