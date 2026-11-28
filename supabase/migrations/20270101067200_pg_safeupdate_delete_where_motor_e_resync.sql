-- pg_safeupdate exige WHERE em todo DELETE (inclusive TEMP e "apagar tudo").
-- Sintoma: PV Programado → Em Produção falha com "DELETE requires a WHERE clause"
-- porque recompute_production_schedule_impl_249 / refresh_purchase_order_motor_priority
-- (e o resync de reservas) faziam DELETE sem predicado.
-- Espelha o padrão de 20270101066200 (atelier TEMP WHERE TRUE).

DO $patch_safe_delete$
DECLARE
  rec record;
  v_def text;
  v_new text;
  v_changed boolean := false;
BEGIN
  FOR rec IN
    SELECT p.oid, n.nspname, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'recompute_production_schedule_impl_249',
         'refresh_purchase_order_motor_priority',
         'resync_op_material_reservations'
       )
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    v_new := v_def;
    v_new := replace(v_new,
      'DELETE FROM public.production_motor_forecast;',
      'DELETE FROM public.production_motor_forecast WHERE TRUE;');
    v_new := replace(v_new,
      'DELETE FROM public.production_motor_state;',
      'DELETE FROM public.production_motor_state WHERE TRUE;');
    v_new := replace(v_new,
      'DELETE FROM public.purchase_order_motor_priority;',
      'DELETE FROM public.purchase_order_motor_priority WHERE TRUE;');
    v_new := replace(v_new,
      'DELETE FROM _exp_direct;',
      'DELETE FROM _exp_direct WHERE TRUE;');
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
      v_changed := true;
    END IF;
  END LOOP;

  -- Guarda: se a função do motor existe, o DELETE precisa ter WHERE.
  IF to_regprocedure('public.recompute_production_schedule_impl_249(text)') IS NOT NULL THEN
    IF position(
         'DELETE FROM public.production_motor_forecast WHERE TRUE;'
         IN pg_get_functiondef('public.recompute_production_schedule_impl_249(text)'::regprocedure)
       ) = 0
       OR position(
         'DELETE FROM public.production_motor_state WHERE TRUE;'
         IN pg_get_functiondef('public.recompute_production_schedule_impl_249(text)'::regprocedure)
       ) = 0 THEN
      RAISE EXCEPTION 'recompute_production_schedule_impl_249 ainda tem DELETE sem WHERE';
    END IF;
  END IF;

  IF to_regprocedure('public.refresh_purchase_order_motor_priority()') IS NOT NULL THEN
    IF position(
         'DELETE FROM public.purchase_order_motor_priority WHERE TRUE;'
         IN pg_get_functiondef('public.refresh_purchase_order_motor_priority()'::regprocedure)
       ) = 0 THEN
      RAISE EXCEPTION 'refresh_purchase_order_motor_priority ainda tem DELETE sem WHERE';
    END IF;
  END IF;

  IF to_regprocedure('public.resync_op_material_reservations(uuid)') IS NOT NULL THEN
    IF position(
         'DELETE FROM _exp_direct WHERE TRUE;'
         IN pg_get_functiondef('public.resync_op_material_reservations(uuid)'::regprocedure)
       ) = 0 THEN
      RAISE EXCEPTION 'resync_op_material_reservations ainda tem DELETE sem WHERE';
    END IF;
  END IF;

  IF NOT v_changed
     AND to_regprocedure('public.recompute_production_schedule_impl_249(text)') IS NULL
     AND to_regprocedure('public.refresh_purchase_order_motor_priority()') IS NULL
     AND to_regprocedure('public.resync_op_material_reservations(uuid)') IS NULL THEN
    RAISE NOTICE 'nenhuma das funções alvo existe neste banco — patch no-op';
  END IF;
END;
$patch_safe_delete$;
