-- Trigger: impede que o mesmo sale_order_id apareça em duas ondas de produção ativas
-- (status NOT IN ('finished','cancelled')) ao mesmo tempo.

CREATE OR REPLACE FUNCTION public.check_sale_order_single_active_wave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_wave_id UUID;
  v_conflict_wave_code TEXT;
  v_conflict_wave_status TEXT;
BEGIN
  IF NEW.sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Identifica a onda da linha que está sendo inserida/atualizada
  SELECT wi.wave_id
    INTO v_current_wave_id
  FROM public.production_wave_items wi
  WHERE wi.id = NEW.wave_item_id;

  IF v_current_wave_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Procura outra onda ativa com o mesmo sale_order_id
  SELECT w.code, w.status::text
    INTO v_conflict_wave_code, v_conflict_wave_status
  FROM public.production_wave_item_sources s
  JOIN public.production_wave_items wi ON wi.id = s.wave_item_id
  JOIN public.production_waves w ON w.id = wi.wave_id
  WHERE s.sale_order_id = NEW.sale_order_id
    AND wi.wave_id <> v_current_wave_id
    AND w.status NOT IN ('finished', 'cancelled')
    AND s.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_conflict_wave_code IS NOT NULL THEN
    RAISE EXCEPTION
      'Pedido de venda % já está vinculado à onda ativa % (status: %). Finalize ou cancele a onda anterior antes de incluí-lo em uma nova.',
      NEW.sale_order_id, v_conflict_wave_code, v_conflict_wave_status
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sale_order_single_active_wave
  ON public.production_wave_item_sources;

CREATE TRIGGER trg_check_sale_order_single_active_wave
  BEFORE INSERT OR UPDATE OF sale_order_id, wave_item_id
  ON public.production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.check_sale_order_single_active_wave();