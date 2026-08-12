-- Endurece endpoints mutáveis que antes aceitavam qualquer usuário aprovado.
-- O RouteGuard é uma camada de UX; estas funções SECURITY DEFINER também são
-- chamadas diretamente pelo PostgREST e, portanto, precisam autorizar no banco.
--
-- Matriz deliberada:
--   estoque manual: admin, gerente, almoxarifado
--   picking: admin, gerente, almoxarifado, expedicao
--   débito/reserva de OP: admin, gerente, producao
--
-- A alteração é feita sobre a definição efetiva instalada no banco para não
-- ressuscitar versões antigas das funções ao copiar seus corpos para cá.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

DO $rbac$
DECLARE
  v_fn regprocedure;
  v_roles text[];
  v_def text;
  v_guard text;
BEGIN
  FOR v_fn, v_roles IN
    SELECT * FROM (VALUES
      ('public.adjust_stock(uuid,numeric,numeric,numeric,text,jsonb,uuid,boolean)'::regprocedure,
        ARRAY['admin','gerente','almoxarifado']),
      ('public.move_stock_delta(uuid,text,numeric,text,text,timestamptz,text,uuid,boolean)'::regprocedure,
        ARRAY['admin','gerente','almoxarifado']),
      ('public.pick_item_increment(uuid,text,numeric)'::regprocedure,
        ARRAY['admin','gerente','almoxarifado','expedicao']),
      ('public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure,
        ARRAY['admin','gerente','producao']),
      ('public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure,
        ARRAY['admin','gerente','producao']),
      ('public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)'::regprocedure,
        ARRAY['admin','gerente','producao']),
      ('public.process_order_stock_out(uuid,uuid,integer)'::regprocedure,
        ARRAY['admin','gerente','producao']),
      ('public.convert_reservation_to_out(uuid,uuid)'::regprocedure,
        ARRAY['admin','gerente','producao']),
      ('public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)'::regprocedure,
        ARRAY['admin','gerente','producao'])
    ) AS protected(fn, roles)
  LOOP
    v_def := pg_get_functiondef(v_fn);
    v_guard := E'\n  IF auth.role() <> ''service_role'' AND NOT public.user_has_any_role(ARRAY[' ||
      (SELECT string_agg(quote_literal(role), ',') FROM unnest(v_roles) AS role) ||
      E']) THEN\n    RAISE EXCEPTION ''Permission denied'';\n  END IF;\n';

    -- Todas as funções acima já têm BEGIN. Falhar explicitamente se uma futura
    -- alteração de formato impedir a injeção, em vez de publicar uma falsa proteção.
    v_def := regexp_replace(v_def, E'\nBEGIN\n', E'\nBEGIN' || v_guard, 1, 1, '');
    IF position('user_has_any_role' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Não foi possível instalar autorização em %', v_fn;
    END IF;
    EXECUTE v_def;
  END LOOP;
END $rbac$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid,numeric,numeric,numeric,text,jsonb,uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_stock_delta(uuid,text,numeric,text,text,timestamptz,text,uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pick_item_increment(uuid,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_order_stock_out(uuid,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_reservation_to_out(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid,numeric,numeric,numeric,text,jsonb,uuid,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_stock_delta(uuid,text,numeric,text,text,timestamptz,text,uuid,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pick_item_increment(uuid,text,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_order_stock_out(uuid,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_reservation_to_out(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean) TO authenticated, service_role;
