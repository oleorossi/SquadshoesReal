CREATE OR REPLACE FUNCTION trg_fn_block_rascunho_wave_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_order_number TEXT;
BEGIN
  SELECT status, order_number
    INTO v_status, v_order_number
    FROM sale_orders
   WHERE id = NEW.sale_order_id;

  IF v_status = 'Rascunho' THEN
    RAISE EXCEPTION
      'O pedido % (%) está em Rascunho e não pode ser atribuído a uma onda de produção. Aprove o pedido antes de incluí-lo.',
      COALESCE(v_order_number, NEW.sale_order_id::text),
      v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rascunho_wave_assignment ON production_wave_item_sources;

CREATE TRIGGER trg_block_rascunho_wave_assignment
  BEFORE INSERT ON production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_block_rascunho_wave_assignment();