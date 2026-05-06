CREATE OR REPLACE FUNCTION public.check_sale_order_single_active_wave()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
  v_order_number text;
  v_active_wave_id uuid;
BEGIN
  IF NEW.sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT wave_id INTO v_wave_id
  FROM public.production_wave_items
  WHERE id = NEW.wave_item_id;

  IF v_wave_id IS NULL OR NOT public.wave_is_active(v_wave_id) THEN
    RETURN NEW;
  END IF;

  SELECT pw.id INTO v_active_wave_id
  FROM public.production_wave_item_sources s
  JOIN public.production_wave_items wi ON wi.id = s.wave_item_id
  JOIN public.production_waves pw ON pw.id = wi.wave_id
  WHERE s.sale_order_id = NEW.sale_order_id
    AND s.id IS DISTINCT FROM NEW.id
    AND pw.status NOT IN ('finished', 'cancelled')
  LIMIT 1;

  IF v_active_wave_id IS NOT NULL THEN
    SELECT order_number INTO v_order_number
    FROM public.sale_orders
    WHERE id = NEW.sale_order_id;

    RAISE EXCEPTION
      'O pedido % já está atribuído a uma onda de produção ativa. Finalize ou cancele a onda atual antes de incluí-lo em outra.',
      COALESCE(v_order_number, NEW.sale_order_id::text)
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_sale_order_single_active_wave() IS
  'Bloqueia que um sale_order seja atribuído a mais de uma onda de produção ativa. Mensagem em PT-BR com o número do pedido.';