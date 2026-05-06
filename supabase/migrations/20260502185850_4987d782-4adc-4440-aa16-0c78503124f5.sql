-- =============================================================================
-- Fix: quantity_processed on stage complete
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_stage_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_stage_id uuid;
  v_is_last_stage boolean;
BEGIN
  -- Se o status não mudou para 'completed', não faz nada
  IF (NEW.status IS DISTINCT FROM 'completed' AND OLD.status IS NOT DISTINCT FROM 'completed') OR NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- 1. Incrementar quantity_processed no item da ordem de produção
  UPDATE production_order_items
  SET quantity_processed = COALESCE(quantity_processed, 0) + NEW.quantity
  WHERE id = NEW.production_order_item_id;

  -- 2. Identificar se existe uma próxima etapa
  SELECT id INTO v_next_stage_id
  FROM production_stages
  WHERE production_order_item_id = NEW.production_order_item_id
    AND sequence > NEW.sequence
  ORDER BY sequence ASC
  LIMIT 1;

  -- 3. Se houver próxima etapa, criar/atualizar registro de controle de fluxo
  IF v_next_stage_id IS NOT NULL THEN
    -- Lógica para liberar a próxima etapa se necessário
    NULL;
  ELSE
    -- 4. Se for a última etapa, marcar o item como concluído se a quantidade total bater
    UPDATE production_order_items
    SET status = 'completed',
        completed_at = now()
    WHERE id = NEW.production_order_item_id
      AND quantity_processed >= quantity;
  END IF;

  RETURN NEW;
END;
$$;
