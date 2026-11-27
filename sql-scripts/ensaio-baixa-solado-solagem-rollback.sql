-- Ensaio (produção): baixa de solado ao passar pela Solagem.
-- Roda numa transação e FAZ ROLLBACK no final — não deixa dado de teste.
-- Pré-requisito: migration 20270101065000 já aplicada.
-- Não toca PV-00249, PV-00250, PV-00251 nem LOTE-00004.

DO $ensaio$
DECLARE
  v_group_id uuid;
  v_product_id uuid;
  v_sheet_id uuid;
  v_order_id uuid;
  v_sale_id uuid;
  v_res_id uuid;
  v_stage_id uuid;
  v_qty numeric;
  v_grade jsonb;
  v_status text;
  v_mov_n integer;
  v_already numeric;
BEGIN
  -- Produto e grupo isolados (não são cadastros reais de solado).
  INSERT INTO public.product_groups (name, description)
  VALUES ('ENSAIO SOLAGEM ' || left(gen_random_uuid()::text, 8), 'rollback')
  RETURNING id INTO v_group_id;

  INSERT INTO public.products (
    name, sku, category, unit, quantity, current_stock, reserved_stock,
    stock_grade, active, group_id, sole_classification
  ) VALUES (
    'ENSAIO SOLADO BAIXA',
    'ENSAIO-SOLAGEM-' || left(gen_random_uuid()::text, 8),
    'Solado', 'par', 100, 100, 0,
    '{"34": 40, "35": 30, "36": 30, "_size_from": 34, "_size_to": 36}'::jsonb,
    true, v_group_id, 'tradicional'
  ) RETURNING id INTO v_product_id;

  INSERT INTO public.technical_sheets (name, status, sole_group_id, primary_sole_id)
  VALUES ('ENSAIO FICHA SOLAGEM', 'ativo', v_group_id, v_product_id)
  RETURNING id INTO v_sheet_id;

  INSERT INTO public.sale_orders (order_number, client_name, status)
  VALUES ('PV-ENSAIO-SOLAGEM', 'Ensaio rollback', 'Em Produção')
  RETURNING id INTO v_sale_id;

  INSERT INTO public.orders (order_number, reference_id, quantity, status, sale_order_id, color, grade)
  VALUES (
    'OP-ENSAIO-SOLAGEM', v_sheet_id, 50, 'Em Produção', v_sale_id, 'PRETO',
    '{"34": 20, "35": 15, "36": 15}'::jsonb
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  VALUES (v_order_id, 'Solagem', 9, 'pendente', 50, 0)
  RETURNING id INTO v_stage_id;

  INSERT INTO public.material_reservations (
    order_id, product_id, sale_order_id, quantity_reserved, quantity_consumed,
    status, reservation_type, source, metadata
  ) VALUES (
    v_order_id, v_product_id, v_sale_id, 50, 0, 'reserved', 'soft', 'onhand',
    jsonb_build_object(
      'kind', 'sole_grade',
      'effective_grade', jsonb_build_object('34', 20, '35', 15, '36', 15),
      'covered_grade', jsonb_build_object('34', 20, '35', 15, '36', 15),
      'shortage_grade', '{}'::jsonb
    )
  ) RETURNING id INTO v_res_id;

  -- (a) passar pela Solagem (quantity_processed 0→50) baixa por numeração.
  UPDATE public.order_stages
     SET quantity_processed = 50, status = 'em_andamento', updated_at = now()
   WHERE id = v_stage_id;

  SELECT quantity, stock_grade INTO v_qty, v_grade
    FROM public.products WHERE id = v_product_id;
  IF v_qty IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'ENSAIO (a) quantity deveria ser 50, veio %', v_qty;
  END IF;
  IF COALESCE((v_grade->>'34')::numeric, 0) IS DISTINCT FROM 20
     OR COALESCE((v_grade->>'35')::numeric, 0) IS DISTINCT FROM 15
     OR COALESCE((v_grade->>'36')::numeric, 0) IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'ENSAIO (a) stock_grade inesperado: %', v_grade;
  END IF;

  SELECT status INTO v_status FROM public.material_reservations WHERE id = v_res_id;
  IF v_status IS DISTINCT FROM 'converted' THEN
    RAISE EXCEPTION 'ENSAIO (a) reserva deveria estar converted, veio %', v_status;
  END IF;

  SELECT count(*) INTO v_mov_n
    FROM public.stock_movements
   WHERE product_id = v_product_id
     AND order_id = v_order_id
     AND movement_type = 'out'
     AND previous_grade IS NOT NULL
     AND new_grade IS NOT NULL;
  IF v_mov_n < 1 THEN
    RAISE EXCEPTION 'ENSAIO (a) movimento sem previous_grade/new_grade';
  END IF;

  -- (b) "faturar" de novo (convert_reservation_to_out) NÃO baixa outra vez.
  PERFORM public.convert_reservation_to_out(v_order_id, v_product_id);
  SELECT quantity INTO v_qty FROM public.products WHERE id = v_product_id;
  IF v_qty IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'ENSAIO (b) faturamento rebaixou: quantity=%', v_qty;
  END IF;
  v_already := public.sole_grade_already_debited_pairs(v_order_id);
  IF v_already IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'ENSAIO (b) already_debited=%', v_already;
  END IF;

  -- (c) falta em uma numeração: LEAST + pending_reconciliation, sem negativo.
  -- Restaura reserva e zera o 36 no estoque para simular falta parcial.
  UPDATE public.products
     SET quantity = 20,
         current_stock = 20,
         stock_grade = '{"34": 20, "35": 0, "36": 0, "_size_from": 34, "_size_to": 36}'::jsonb
   WHERE id = v_product_id;
  UPDATE public.material_reservations
     SET status = 'reserved',
         reservation_type = 'soft',
         quantity_reserved = 30,
         quantity_consumed = 0,
         quantity_short = 0,
         consumed_at = NULL,
         metadata = jsonb_build_object(
           'kind', 'sole_grade',
           'effective_grade', jsonb_build_object('34', 10, '35', 10, '36', 10),
           'covered_grade', jsonb_build_object('34', 10, '35', 0, '36', 0),
           'shortage_grade', jsonb_build_object('35', 10, '36', 10)
         )
   WHERE id = v_res_id;
  -- Nova OP só para não somar o already=50 da anterior: reuse same order by
  -- zerando consumed via a reserva reaberta (already conta só converted).
  PERFORM public.debit_sole_grade_up_to(v_order_id, 50 + 30);

  SELECT quantity, stock_grade INTO v_qty, v_grade
    FROM public.products WHERE id = v_product_id;
  IF v_qty < 0 OR COALESCE((v_grade->>'34')::numeric, 0) < 0
     OR COALESCE((v_grade->>'35')::numeric, 0) < 0
     OR COALESCE((v_grade->>'36')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'ENSAIO (c) estoque negativo: qty=% grade=%', v_qty, v_grade;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = v_order_id
       AND status = 'pending_reconciliation'
       AND COALESCE((metadata->>'partial_pending')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'ENSAIO (c) deveria criar pending_reconciliation na falta';
  END IF;

  RAISE EXCEPTION 'ROLLBACK_ENSAIO_OK: a=baixa por numeração, b=faturamento idempotente, c=LEAST+pending';
END;
$ensaio$;
