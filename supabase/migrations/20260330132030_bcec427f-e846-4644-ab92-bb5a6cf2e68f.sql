-- Update the function to also mark the current stage as completed
DROP FUNCTION IF EXISTS public.finalize_production_sector(
  p_order_id UUID,
  p_current_sector TEXT
) CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id UUID,
  p_current_sector TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_sector TEXT;
  v_next_status TEXT;
  v_result JSONB;
BEGIN
  -- Define the next sector based on the current one
  CASE p_current_sector
    WHEN 'Corte' THEN v_next_sector := 'Aviamento';
    WHEN 'Aviamento' THEN v_next_sector := 'Preparação';
    WHEN 'Preparação' THEN v_next_sector := 'Montagem';
    WHEN 'Montagem' THEN v_next_sector := 'Expedição';
    ELSE 
      v_next_sector := NULL;
  END CASE;

  -- 1. Mark the current stage as completed in order_stages if it exists
  UPDATE public.order_stages
  SET 
    status = 'concluido',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE order_id = p_order_id 
    AND stage_name = p_current_sector
    AND status != 'concluido';

  -- 2. Update the order/production_order status and last_sector_finished_at
  IF v_next_sector IS NOT NULL THEN
    v_next_status := 'EM_' || UPPER(v_next_sector);
    
    -- Try updating production_orders first
    UPDATE public.production_orders
    SET 
      status = v_next_status,
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    -- Also update the main orders table
    UPDATE public.orders
    SET 
      status = v_next_status,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    -- 3. Notify the next sector
    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', v_next_status
    );
  ELSE
    -- If it's the last sector (Expedição) or unknown
    UPDATE public.production_orders
    SET 
      status = 'FINALIZADO',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.orders
    SET 
      status = 'FINALIZADO',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'FINALIZADO'
    );
  END IF;

  RETURN v_result;
END;
$$;