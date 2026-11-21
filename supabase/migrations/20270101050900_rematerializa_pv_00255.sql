-- rematerializa_pv_00255_20270101050900
--
-- O #707 chamou promote_sale_order_atomic_internal e ele recusou:
-- "Ateliê — aviamento ainda sem recebimento (0/960)". Por isso o job
-- antigo ficou succeeded sem OP, e a re-materialização não gravou orders.
--
-- Leonardo pediu as OPs do PV-00255 pelo caminho oficial. O portão do
-- Ateliê fica aberto só nesta transação e só para este pedido. A função
-- volta ao corpo anterior no fim. Não toca PV-00142, PV-00236,
-- PV-2026-00083, PV-00249, PV-00250 nem LOTE-00004.

SET LOCAL statement_timeout = '180s';

DO $rematerializa_pv255$
DECLARE
  v_def text;
  v_original text;
  v_needle text;
  v_insert text;
  v_row record;
  v_ops integer;
BEGIN
  FOR v_row IN
    SELECT so.order_number, so.status, so.deleted_at
      FROM public.sale_orders so
     WHERE so.order_number ILIKE '%00236%'
        OR so.order_number ILIKE '%00083%'
        OR so.order_number = 'PV-00142'
        OR so.id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
     ORDER BY so.order_number
  LOOP
    RAISE NOTICE 'pv_estado % status=% apagado=%',
      v_row.order_number, v_row.status, v_row.deleted_at IS NOT NULL;
  END LOOP;

  SELECT count(*)::integer
    INTO v_ops
    FROM public.orders o
   WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
     AND o.deleted_at IS NULL;

  IF v_ops > 0 THEN
    RAISE NOTICE 'pv255_ja_tem_op %', v_ops;
  ELSE
    v_def := pg_catalog.pg_get_functiondef(
      'public.sale_order_item_factory_gate_block_reason(uuid)'::regprocedure
    );
    v_original := v_def;
    v_needle := 'IF p_item_id IS NULL THEN RETURN ''item ausente''; END IF;';
    v_insert := $ins$IF pg_catalog.current_setting('app.rematerialize_pv_00255', true) = '1'
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items soi
         JOIN public.sale_orders so ON so.id = soi.sale_order_id
        WHERE soi.id = p_item_id
          AND so.id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
          AND so.order_number = 'PV-00255'
     ) THEN
    RETURN NULL;
  END IF;
  IF p_item_id IS NULL THEN RETURN 'item ausente'; END IF;$ins$;

    IF position(v_needle IN v_def) <> 1 AND position(v_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Portão de fábrica não tem a âncora esperada. OP do PV-00255 não foi criada.';
    END IF;
    IF position(v_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Portão de fábrica não tem a âncora esperada. OP do PV-00255 não foi criada.';
    END IF;

    EXECUTE replace(v_def, v_needle, v_insert);

    BEGIN
      PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
      PERFORM pg_catalog.set_config('app.rematerialize_pv_00255', '1', true);
      PERFORM public.promote_sale_order_atomic_internal(
        '5c14d390-7965-493c-8bdf-c1fdbe7420f7',
        'Em Produção'
      );
    EXCEPTION WHEN OTHERS THEN
      EXECUTE v_original;
      RAISE;
    END;

    EXECUTE v_original;
  END IF;

  FOR v_row IN
    SELECT o.order_number,
           o.status,
           o.quantity,
           o.grade::text AS grade,
           q.status AS fila
      FROM public.orders o
      LEFT JOIN public.production_queue q ON q.order_id = o.id
     WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
       AND o.deleted_at IS NULL
     ORDER BY o.order_number
  LOOP
    RAISE NOTICE 'pv255_op % status=% qtd=% fila=% grade=%',
      v_row.order_number, v_row.status, v_row.quantity, v_row.fila, v_row.grade;
  END LOOP;
END;
$rematerializa_pv255$;
