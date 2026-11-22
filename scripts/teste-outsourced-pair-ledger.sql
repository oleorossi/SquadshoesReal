-- Compara o ledger único com as leituras antigas.
-- A transação termina em RAISE EXCEPTION. Não grava pedido.
-- Não altera PV-00249, PV-00250 nem LOTE-00004.

BEGIN;

CREATE TEMP TABLE ledger_coerencia (
  check_name text,
  antigo numeric,
  ledger numeric,
  diferenca numeric,
  motivo text
);

DO $teste_ledger$
DECLARE
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_jobs numeric;
  v_ledger_costura numeric;
  v_os numeric;
  v_ledger_os numeric;
  v_board numeric;
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

  SELECT coalesce(sum(trunc(j.pairs)), 0)
    INTO v_jobs
    FROM public.cabedal_prep_jobs j
    JOIN public.sale_orders so ON so.id = j.sale_order_id
   WHERE j.pipeline_status <> 'cancelled'
     AND j.sector IN ('costura_cabedal', 'aviamento')
     AND so.deleted_at IS NULL
     AND lower(translate(coalesce(so.status, ''), 'áàãâéêíóôõúç', 'aaaaeeiooouc'))
         IN ('aprovado', 'em producao', 'pendente');

  SELECT coalesce(sum(demand_pairs), 0)
    INTO v_ledger_costura
    FROM public.outsourced_pair_ledger('week')
   WHERE sector_key IN ('costura', 'aviamento')
     AND job_id IS NOT NULL;

  INSERT INTO ledger_coerencia VALUES (
    'cabedal complexo: jobs x ledger',
    v_jobs,
    v_ledger_costura,
    v_ledger_costura - v_jobs,
    'Diferença aparece quando o job tem parte e o saldo que falta ainda não virou OS, ou quando o item foi retirado da produção. O ledger não multiplica o par pela ficha nem pela OP.'
  );

  SELECT coalesce(sum(trunc(os.quantity)), 0)
    INTO v_os
    FROM public.service_orders os
   WHERE lower(translate(coalesce(os.status, ''), 'áàãâéêíóôõúç', 'aaaaeeiooouc'))
         NOT IN ('cancelado', 'concluido', 'finalizado')
     AND public.outsourced_sector_key(coalesce(os.target_sector, os.sector))
         NOT IN ('costura', 'aviamento');

  SELECT coalesce(sum(demand_pairs), 0)
    INTO v_ledger_os
    FROM public.outsourced_pair_ledger('week')
   WHERE job_id IS NULL
     AND service_order_id IS NOT NULL;

  INSERT INTO ledger_coerencia VALUES (
    'outras OS abertas x ledger',
    v_os,
    v_ledger_os,
    v_ledger_os - v_os,
    'O número antigo soma toda OS que não é costura/aviamento, inclusive de pedido faturado ou cancelado. O ledger só fica com pedido aprovado, pendente ou em produção.'
  );

  IF to_regprocedure('public.list_active_service_order_board()') IS NOT NULL THEN
    SELECT coalesce(sum(planned), 0)
      INTO v_board
      FROM public.list_active_service_order_board();
    INSERT INTO ledger_coerencia VALUES (
      'quadro de OS ativas x demanda do ledger',
      v_board,
      (SELECT coalesce(sum(demand_pairs), 0) FROM public.outsourced_pair_ledger('week')),
      (SELECT coalesce(sum(demand_pairs), 0) FROM public.outsourced_pair_ledger('week')) - v_board,
      'O quadro soma a quantidade da OS. O ledger soma o par do item ou do job, uma vez por setor, e inclui o que ainda nem virou OS. Por isso os dois não fecham no mesmo número: um é OS, o outro é demanda a terceirizar.'
    );
  END IF;

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
END;
$teste_ledger$;

SELECT check_name, antigo, ledger, diferenca, motivo FROM ledger_coerencia ORDER BY check_name;

DO $rollback_ledger$
BEGIN
  RAISE EXCEPTION 'rollback teste ledger terceirizados';
END;
$rollback_ledger$;
