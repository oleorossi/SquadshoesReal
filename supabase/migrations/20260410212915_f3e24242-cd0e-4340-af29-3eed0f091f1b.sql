-- 1. Update finalize_production_sector to also update production_step
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
  -- Matching the flow requested: Corte -> Aviamento -> Solagem -> Acabamento
  CASE p_current_sector
    WHEN 'Corte' THEN v_next_sector := 'Aviamento';
    WHEN 'Aviamento' THEN v_next_sector := 'Solagem';
    WHEN 'Solagem' THEN v_next_sector := 'Acabamento';
    WHEN 'Acabamento' THEN v_next_sector := 'Pronto';
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

  -- 2. Update the order status and production_step
  IF v_next_sector IS NOT NULL THEN
    v_next_status := CASE 
      WHEN v_next_sector = 'Pronto' THEN 'Pronto'
      ELSE 'EM_' || UPPER(v_next_sector)
    END;
    
    UPDATE public.orders
    SET 
      status = v_next_status,
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    -- Also update production_orders if it exists
    UPDATE public.production_orders
    SET 
      status = v_next_status,
      current_sector = v_next_sector,
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
    -- If it's already finished or unknown
    UPDATE public.orders
    SET 
      status = 'FINALIZADO',
      production_step = 'Pronto',
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

-- 2. Create a trigger function to sync order_stages when production_step changes
DROP FUNCTION IF EXISTS public.sync_order_stages_with_kanban() CASCADE;
CREATE OR REPLACE FUNCTION public.sync_order_stages_with_kanban()
RETURNS TRIGGER AS $$
BEGIN
  -- If production_step hasn't changed, do nothing
  IF (TG_OP = 'UPDATE' AND OLD.production_step IS NOT DISTINCT FROM NEW.production_step) THEN
    RETURN NEW;
  END IF;

  -- 1. Mark previous stages as completed if they are not already
  -- This is a bit complex because we don't have a strict sequence in a table here, 
  -- but we can use the stage_order column from order_stages to mark everything before the NEW.production_step as completed.
  
  IF NEW.production_step IS NOT NULL AND NEW.production_step != 'Pendente' THEN
    -- Mark all stages with stage_order smaller than the current one as completed
    UPDATE public.order_stages
    SET status = 'concluido', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND stage_order < (
        SELECT COALESCE(MIN(stage_order), 999) 
        FROM public.order_stages 
        WHERE order_id = NEW.id AND stage_name = NEW.production_step
      )
      AND status != 'concluido';
      
    -- Mark the current stage as 'em_andamento'
    UPDATE public.order_stages
    SET status = 'em_andamento', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND stage_name = NEW.production_step
      AND status = 'pendente';
  END IF;

  -- If it's moved to 'Pronto', mark all stages as completed
  IF NEW.production_step = 'Pronto' THEN
    UPDATE public.order_stages
    SET status = 'concluido', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND status != 'concluido';
      
    NEW.status := 'Pronto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger on orders table
DROP TRIGGER IF EXISTS trigger_sync_kanban_stages ON public.orders;
CREATE TRIGGER trigger_sync_kanban_stages
BEFORE UPDATE OF production_step ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_stages_with_kanban();
