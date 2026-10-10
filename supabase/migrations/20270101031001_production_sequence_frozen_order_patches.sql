-- Companion stamp: patches de ORDER BY (recompute + v_production_queue_detail)
-- foram aplicados via MCP junto com 20270101031000 e re-aplicados sob este nome.
-- Conteúdo idempotente — se 31000 já rodou, só confirma.

DO $confirm_frozen_order$
DECLARE
  v_recompute text;
  v_view text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.recompute_production_schedule_impl_249(text)'::regprocedure
  ) INTO v_recompute;

  SELECT pg_catalog.pg_get_viewdef('public.v_production_queue_detail'::regclass, true)
    INTO v_view;

  IF pg_catalog.strpos(COALESCE(v_recompute, ''), 'sequence_frozen_position') = 0 THEN
    RAISE EXCEPTION
      'recompute_production_schedule_impl_249 sem sequence_frozen_position — rode 20270101031000';
  END IF;

  IF pg_catalog.strpos(COALESCE(v_view, ''), 'sequence_frozen_position') = 0 THEN
    RAISE EXCEPTION
      'v_production_queue_detail sem sequence_frozen_position — rode 20270101031000';
  END IF;

  RAISE NOTICE 'Fase 2: ordem frozen confirmada em recompute + view';
END;
$confirm_frozen_order$;
