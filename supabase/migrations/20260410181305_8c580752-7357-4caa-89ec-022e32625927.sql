-- Create a table for sole technical specifications
CREATE TABLE IF NOT EXISTS public.sole_technical_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sole_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    size INT NOT NULL,
    upper_consumption_dm2 NUMERIC(10,4),
    lining_consumption_dm2 NUMERIC(10,4),
    insole_consumption_dm2 NUMERIC(10,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(sole_id, size)
);

-- Enable RLS
ALTER TABLE public.sole_technical_specs ENABLE ROW LEVEL SECURITY;

-- Basic policies (adjust if needed based on existing roles)
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.sole_technical_specs;
CREATE POLICY "Enable all for authenticated users" ON public.sole_technical_specs
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Trigger for updated_at
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.sole_technical_specs
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_updated_at();
