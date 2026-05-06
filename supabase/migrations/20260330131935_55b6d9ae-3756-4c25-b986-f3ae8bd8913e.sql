-- Add last_sector_finished_at to production_orders and orders if they don't exist
ALTER TABLE public.production_orders 
ADD COLUMN IF NOT EXISTS last_sector_finished_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS last_sector_finished_at TIMESTAMP WITH TIME ZONE;

-- Create a table for notifications if it doesn't exist
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID, -- For targeted notifications (optional)
  sector TEXT, -- For sector-wide notifications
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own notifications or sector notifications
DROP POLICY IF EXISTS "Users can view relevant notifications" ON public.notifications;
CREATE POLICY "Users can view relevant notifications" 
ON public.notifications 
FOR SELECT 
USING (true); -- Simplified for now

DROP POLICY IF EXISTS "Anyone can create notifications" ON public.notifications;
CREATE POLICY "Anyone can create notifications" 
ON public.notifications 
FOR INSERT 
WITH CHECK (true);

-- Function to finalize a sector task and transition to the next
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

  -- 1. Update the order/production_order status and last_sector_finished_at
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

    -- 2. Notify the next sector (insert into notifications table)
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