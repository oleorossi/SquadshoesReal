-- Aprovar um PV de teste com cabedal complexo e conferir que a cor
-- entra na lista. A transação termina em RAISE EXCEPTION.
-- Não altera PV-00249, PV-00250 nem LOTE-00004.
-- Antes do teste, a leitura list_complex_upper_not_in_launch mostra
-- os pedidos reais que hoje não têm job.

BEGIN;

CREATE TEMP TABLE aprovado_lancamento_report (
  check_name text,
  ok boolean,
  detail text
);

-- Lista somente leitura dos pedidos reais fora da listagem.
SELECT order_number, status, color, reference_code, reason
  FROM public.list_complex_upper_not_in_launch();

DO $teste_aprovado_lancamento$
DECLARE
  v_sheet uuid;
  v_client uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_number text := 'PV-TESTE-LANCAR-' || substr(gen_random_uuid()::text, 1, 8);
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_jobs int;
BEGIN
  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_249
    FROM public.sale_orders WHERE order_number = 'PV-00249'
   ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_250
    FROM public.sale_orders WHERE order_number = 'PV-00250'
   ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
    INTO v_stamp_lote
    FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1;

  SELECT ts.id INTO v_sheet
    FROM public.technical_sheets ts
    JOIN public.atelier_complex_references a
      ON a.reference_id = ts.id AND a.active AND a.sector = 'costura_cabedal'
   LIMIT 1;
  IF v_sheet IS NULL THEN
    RAISE EXCEPTION 'sem ficha de cabedal complexo ativa para o teste';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, 'TESTE LANCAR — apagar', 'TESTE LANCAR — apagar', 'TESTE LANCAR — apagar');

  INSERT INTO public.sale_orders (
    id, order_number, client_id, client_name, status, notes, total
  ) VALUES (
    v_pv, v_number, v_client, 'TESTE LANCAR — apagar', 'Rascunho', 'TESTE LANCAR — apagar', 0
  );

  INSERT INTO public.sale_order_items (
    id, sale_order_id, reference_id, color, quantity, fichas, unit_price, grade
  ) VALUES (
    v_item, v_pv, v_sheet, 'PRETO', 12, 1, 0, '{"35":4,"36":4,"37":4}'::jsonb
  );

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  UPDATE public.sale_orders
     SET status = 'Aprovado'
   WHERE id = v_pv;

  SELECT count(*) INTO v_jobs
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_id = v_pv
     AND j.pipeline_status <> 'cancelled'
     AND j.sector IN ('costura_cabedal', 'aviamento');

  INSERT INTO aprovado_lancamento_report VALUES (
    'aprovado entra na lista',
    v_jobs > 0,
    format('jobs=%s pv=%s', v_jobs, v_number)
  );

  INSERT INTO aprovado_lancamento_report VALUES (
    'a cor do teste não fica na lista de faltantes',
    NOT EXISTS (
      SELECT 1 FROM public.list_complex_upper_not_in_launch() g
       WHERE g.order_number = v_number
    ),
    v_number
  );

  IF (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
        FROM public.sale_orders WHERE order_number = 'PV-00249'
       ORDER BY created_at DESC LIMIT 1) IS DISTINCT FROM v_stamp_249
     OR (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
           FROM public.sale_orders WHERE order_number = 'PV-00250'
          ORDER BY created_at DESC LIMIT 1) IS DISTINCT FROM v_stamp_250
     OR (SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
           FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1) IS DISTINCT FROM v_stamp_lote
  THEN
    RAISE EXCEPTION 'PV-00249, PV-00250 ou LOTE-00004 mudou de carimbo';
  END IF;

  IF EXISTS (SELECT 1 FROM aprovado_lancamento_report WHERE NOT ok) THEN
    RAISE EXCEPTION 'teste de aprovado no lançamento falhou';
  END IF;
END;
$teste_aprovado_lancamento$;

SELECT check_name, ok, detail FROM aprovado_lancamento_report ORDER BY check_name;

DO $rollback_aprovado_lancamento$
BEGIN
  RAISE EXCEPTION 'rollback teste aprovado no lancamento';
END;
$rollback_aprovado_lancamento$;
