-- motor_ignora_pv_apagado_20270101052200
--
-- A simulação de compra já exige sale_orders.deleted_at nulo.
-- A sequência do PCP (list_production_sequence) ainda lia a fila
-- mesmo com o PV apagado. PV-00142 e os legados não entram no motor.

DO $motor_ignora_pv_apagado$
DECLARE
  v_def text;
  v_old text := $old$  WHERE o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN ($old$;
  v_new text := $new$  WHERE o.deleted_at IS NULL
    AND (so.id IS NULL OR so.deleted_at IS NULL)
    AND COALESCE(o.status, '') NOT IN ($new$;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('public.list_production_sequence()'::regprocedure);
  IF pg_catalog.strpos(v_def, 'so.deleted_at IS NULL') > 0 THEN
    RAISE NOTICE 'sequencia_ja_ignora_pv_apagado';
    RETURN;
  END IF;
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora de list_production_sequence mudou. PV apagado continuaria na sequência.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'sequencia_ignora_pv_apagado';
END;
$motor_ignora_pv_apagado$;
