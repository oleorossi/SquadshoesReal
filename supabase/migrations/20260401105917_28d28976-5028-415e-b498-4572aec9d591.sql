
-- Factoring configuration table
CREATE TABLE public.factoring_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Factoring Padrão',
  monthly_interest_rate NUMERIC NOT NULL DEFAULT 0,
  receiving_days INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add factoring fields to sale_orders
ALTER TABLE public.sale_orders
  ADD COLUMN is_factoring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN factoring_config_id UUID REFERENCES public.factoring_config(id);

-- RLS
ALTER TABLE public.factoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage factoring_config" ON public.factoring_config;
CREATE POLICY "Authenticated users can manage factoring_config"
  ON public.factoring_config
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
