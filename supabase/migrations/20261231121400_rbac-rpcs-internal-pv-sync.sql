-- O Comercial pode editar itens do PV (policy de 20261231120300). O trigger
-- SECURITY DEFINER de sincronização precisa então reservar material em seu
-- nome, sem transformar as RPCs operacionais em endpoints diretos do Comercial.
--
-- O marcador é transaction-local e só é definido dentro do trigger. Chamadas
-- PostgREST não executam SET LOCAL arbitrário, portanto continuam exigindo a
-- matriz de papéis da migration 20261231121300.

DO $rbac$
DECLARE
  v_fn regprocedure;
  v_def text;
BEGIN
  FOR v_fn IN
    SELECT unnest(ARRAY[
      'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure,
      'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure,
      'public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)'::regprocedure,
      'public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)'::regprocedure
    ])
  LOOP
    v_def := pg_get_functiondef(v_fn);
    v_def := replace(
      v_def,
      'IF auth.role() <> ''service_role'' AND NOT public.user_has_any_role(',
      'IF auth.role() <> ''service_role'' AND current_setting(''app.internal_stock_sync'', true) IS DISTINCT FROM ''1'' AND NOT public.user_has_any_role('
    );
    IF position('app.internal_stock_sync' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Não foi possível permitir sync interno em %', v_fn;
    END IF;
    EXECUTE v_def;
  END LOOP;
END $rbac$;

DO $trigger$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.tg_sync_orders_from_sale_order_item()'::regprocedure);
  v_def := regexp_replace(
    v_def,
    E'\nBEGIN\n',
    E'\nBEGIN\n  PERFORM set_config(''app.internal_stock_sync'', ''1'', true);\n',
    1, 1, ''
  );
  IF position('set_config(''app.internal_stock_sync'', ''1'', true)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Não foi possível marcar o sync interno de PV';
  END IF;
  EXECUTE v_def;
END $trigger$;
