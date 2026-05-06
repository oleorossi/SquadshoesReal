-- Add default_group_id to sole_structures
ALTER TABLE public.sole_structures ADD COLUMN IF NOT EXISTS default_group_id UUID REFERENCES public.product_groups(id);

-- Ensure RLS is enabled
ALTER TABLE public.sole_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sole_technical_specs ENABLE ROW LEVEL SECURITY;

-- Create policies if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sole_structures' AND policyname = 'Enable all for authenticated users') THEN
        CREATE POLICY "Enable all for authenticated users" ON public.sole_structures FOR ALL USING (auth.role() = 'authenticated');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sole_technical_specs' AND policyname = 'Enable all for authenticated users') THEN
        CREATE POLICY "Enable all for authenticated users" ON public.sole_technical_specs FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;
