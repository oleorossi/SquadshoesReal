-- outsourced_pair_ledger(text) falhava em produção com
--   42702: column reference "service_order_id" is ambiguous
-- A função é RETURNS TABLE(..., service_order_id uuid, ...), então em PL/pgSQL
-- `service_order_id` também é variável de saída. Os dois LATERAL das OS fora
-- do Ateliê (envios e retornos) filtravam por `service_order_id` sem alias.
-- Resultado: a aba de planejamento dos Terceirizados não carregava.
--
-- Correção mínima: dar alias às tabelas dos dois LATERAL e qualificar a coluna.
-- Idempotente; sem efeito em dados.

DO $fix_ledger_ambiguo$
DECLARE
  v_def text;
  v_old_sent text := E'FROM public.service_order_dispatches\n         WHERE service_order_id = os.id';
  v_new_sent text := E'FROM public.service_order_dispatches sod\n         WHERE sod.service_order_id = os.id';
  v_old_recv text := E'FROM public.service_order_returns\n         WHERE service_order_id = os.id';
  v_new_recv text := E'FROM public.service_order_returns sor\n         WHERE sor.service_order_id = os.id';
BEGIN
  SELECT pg_get_functiondef('public.outsourced_pair_ledger(text)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'outsourced_pair_ledger(text) ausente';
  END IF;

  IF strpos(v_def, v_new_sent) > 0 AND strpos(v_def, v_new_recv) > 0
     AND strpos(v_def, v_old_sent) = 0 AND strpos(v_def, v_old_recv) = 0 THEN
    RAISE NOTICE 'outsourced_pair_ledger já qualifica service_order_id';
    RETURN;
  END IF;
  IF strpos(v_def, v_old_sent) = 0 OR strpos(v_def, v_old_recv) = 0 THEN
    RAISE EXCEPTION 'âncoras dos LATERAL de envios/retornos não encontradas em outsourced_pair_ledger; correção abortada';
  END IF;

  EXECUTE replace(replace(v_def, v_old_sent, v_new_sent), v_old_recv, v_new_recv);
END
$fix_ledger_ambiguo$;
