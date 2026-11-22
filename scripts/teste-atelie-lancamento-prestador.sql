-- Lançamento do Ateliê por cor. Roda numa transação e termina em
-- RAISE EXCEPTION, então nada fica no banco. Não altera PV-00249,
-- PV-00250 nem LOTE-00004: só lê o carimbo deles antes e depois.
--
-- A carga usa session_replication_role=replica para nenhum gatilho de
-- estoque, fila, OS ou financeiro disparar. A leitura usa as mesmas
-- funções da tela.

BEGIN;

CREATE TEMP TABLE atelie_lanc_report (
  check_name text,
  ok boolean,
  detail text
);

DO $teste_atelie_lancamento$
DECLARE
  c_marker constant text := 'TESTE ATELIE LANCAMENTO — apagar';
  v_client uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_demand uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid();
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_found boolean;
  v_gap text;
  v_pairs int;
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

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, c_marker, c_marker, c_marker);

  INSERT INTO public.sale_orders (
    id, order_number, client_id, client_name, status, notes, total
  ) VALUES (
    v_pv, 'PV-TESTE-ATELIE-APAGAR', v_client, c_marker, 'Em Produção', c_marker, 0
  );

  INSERT INTO public.sale_order_items (
    id, sale_order_id, color, quantity, fichas, unit_price, grade
  ) VALUES (
    v_item, v_pv, 'PRETO', 12, 1, 0, '{"35":4,"36":4,"37":4}'::jsonb
  );

  INSERT INTO public.cabedal_prep_demands (
    id, sale_order_id, sale_order_item_id, color, pairs, status
  ) VALUES (
    v_demand, v_pv, v_item, 'PRETO', 12, 'open'
  );

  INSERT INTO public.cabedal_prep_jobs (
    id, demand_id, sale_order_id, sale_order_item_id, sector, pairs, color, pipeline_status
  ) VALUES (
    v_job, v_demand, v_pv, v_item, 'costura_cabedal', 12, 'PRETO', 'cut'
  );

  INSERT INTO public.atelier_job_parts (
    job_id, execution_mode, pairs, grade, pipeline_status
  ) VALUES (
    v_job, 'internal', 20, '{"35":20}'::jsonb, 'sent_to_contractor'
  );

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT g.detail INTO v_gap
    FROM public.list_atelier_quantity_gaps('PV-TESTE-ATELIE-APAGAR') g
   WHERE g.kind = 'parte_acima_do_job'
   LIMIT 1;
  INSERT INTO atelie_lanc_report VALUES (
    'parte acima do job',
    v_gap IS NOT NULL AND v_gap LIKE '%20%' AND v_gap LIKE '%12%',
    coalesce(v_gap, 'sem linha')
  );

  SELECT (payload ->> 'found')::boolean,
         trunc((payload -> 'colors' -> 0 ->> 'pairs')::numeric)::int
    INTO v_found, v_pairs
    FROM (
      SELECT public.list_atelier_order_launch('PV-TESTE-ATELIE-APAGAR') AS payload
    ) q;
  INSERT INTO atelie_lanc_report VALUES (
    'tela lê a cor e os 12 pares',
    v_found AND v_pairs = 12,
    format('found=%s pairs=%s', v_found, v_pairs)
  );

  IF EXISTS (
    SELECT 1 FROM public.sale_orders
     WHERE id = v_pv AND order_number IN ('PV-00249', 'PV-00250')
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
$teste_atelie_lancamento$;

SELECT check_name, ok, detail FROM atelie_lanc_report ORDER BY check_name;

DO $rollback_atelie_lancamento$
BEGIN
  IF EXISTS (SELECT 1 FROM atelie_lanc_report WHERE NOT ok) THEN
    RAISE EXCEPTION 'teste do lançamento do ateliê falhou — veja atelie_lanc_report';
  END IF;
  RAISE EXCEPTION 'rollback teste atelie lancamento';
END;
$rollback_atelie_lancamento$;
