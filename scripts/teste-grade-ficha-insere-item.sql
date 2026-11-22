-- Regressão do hotfix da grade. O INSERT do item do PV não pode morrer
-- com record "new" has no field "sale_order_item_id". A OP com grade que
-- fecha também entra. Tudo numa transação que termina em RAISE EXCEPTION.
-- Não altera PV-00249, PV-00250 nem LOTE-00004.

BEGIN;

CREATE TEMP TABLE grade_ficha_report (
  check_name text,
  ok boolean,
  detail text
);

DO $teste_grade_ficha_insere$
DECLARE
  c_marker constant text := 'TESTE GRADE FICHA — apagar';
  c_grade constant jsonb := '{"34":2,"35":2,"36":2,"37":2,"38":2,"39":2}'::jsonb;
  v_client uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_ref uuid;
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_err text;
  v_body text;
BEGIN
  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_249
    FROM public.sale_orders
   WHERE order_number = 'PV-00249'
   ORDER BY created_at DESC
   LIMIT 1;

  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_250
    FROM public.sale_orders
   WHERE order_number = 'PV-00250'
   ORDER BY created_at DESC
   LIMIT 1;

  SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
    INTO v_stamp_lote
    FROM public.atelier_lots
   WHERE lot_number = 'LOTE-00004'
   LIMIT 1;

  SELECT pg_get_functiondef('public.tg_grade_must_close_ficha()'::regprocedure)
    INTO v_body;
  INSERT INTO grade_ficha_report VALUES (
    'função lê o item pelo jsonb',
    v_body LIKE '%to_jsonb(NEW)%' AND position('NEW.sale_order_item_id' IN v_body) = 0,
    left(v_body, 180)
  );

  SELECT ts.id INTO v_ref
    FROM public.technical_sheets ts
   WHERE ts.id IS NOT NULL
   LIMIT 1;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'sem ficha para usar só como referência da OP de teste';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, c_marker, c_marker, c_marker);

  INSERT INTO public.sale_orders (
    id, order_number, client_id, client_name, status, notes, total
  ) VALUES (
    v_pv, 'PV-TESTE-FICHA-APAGAR', v_client, c_marker, 'Rascunho', c_marker, 0
  );

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.production_order_command_internal', '1', true);

  BEGIN
    INSERT INTO public.sale_order_items (
      id, sale_order_id, color, quantity, fichas, unit_price, grade
    ) VALUES (
      v_item, v_pv, 'PRETO', 12, 1, 1, c_grade
    );
    INSERT INTO grade_ficha_report VALUES (
      'insert do item do PV',
      true,
      'item entrou'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO grade_ficha_report VALUES (
      'insert do item do PV',
      false,
      v_err
    );
    IF position('sale_order_item_id' IN v_err) > 0
       OR position('record "new" has no field' IN v_err) > 0 THEN
      RAISE EXCEPTION 'o insert do item ainda quebra no campo da OP: %', v_err;
    END IF;
  END;

  BEGIN
    INSERT INTO public.orders (
      id, order_number, reference_id, sale_order_id, sale_order_item_id,
      quantity, grade, status, notes
    ) VALUES (
      v_op, 'OP-TESTE-FICHA-APAGAR', v_ref, v_pv, v_item,
      12, c_grade, 'Em Produção', c_marker
    );
    INSERT INTO grade_ficha_report VALUES ('insert da OP', true, 'OP entrou');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    INSERT INTO grade_ficha_report VALUES (
      'insert da OP',
      false,
      v_err
    );
    IF position('sale_order_item_id' IN v_err) > 0
       OR position('record "new" has no field' IN v_err) > 0 THEN
      RAISE EXCEPTION 'o insert da OP ainda quebra no campo: %', v_err;
    END IF;
  END;

  IF v_pv::text IN (
    SELECT id::text FROM public.sale_orders WHERE order_number IN ('PV-00249', 'PV-00250')
  ) THEN
    RAISE EXCEPTION 'proteção dos pedidos reais disparou';
  END IF;

  IF (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
        FROM public.sale_orders
       WHERE order_number = 'PV-00249'
       ORDER BY created_at DESC LIMIT 1
     ) IS DISTINCT FROM v_stamp_249
     OR (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
           FROM public.sale_orders
          WHERE order_number = 'PV-00250'
          ORDER BY created_at DESC LIMIT 1
        ) IS DISTINCT FROM v_stamp_250
     OR (SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
           FROM public.atelier_lots
          WHERE lot_number = 'LOTE-00004' LIMIT 1
        ) IS DISTINCT FROM v_stamp_lote
  THEN
    RAISE EXCEPTION 'PV-00249, PV-00250 ou LOTE-00004 mudou de carimbo';
  END IF;
END;
$teste_grade_ficha_insere$;

SELECT check_name, ok, detail FROM grade_ficha_report ORDER BY check_name;

DO $rollback_grade_ficha$
BEGIN
  IF EXISTS (SELECT 1 FROM grade_ficha_report WHERE NOT ok) THEN
    RAISE EXCEPTION 'teste da grade falhou — veja grade_ficha_report';
  END IF;
  RAISE EXCEPTION 'rollback teste grade ficha';
END;
$rollback_grade_ficha$;
