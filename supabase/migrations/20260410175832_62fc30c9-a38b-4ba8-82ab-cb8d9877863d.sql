CREATE TABLE public.sole_structures (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sole_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    component_type TEXT NOT NULL, -- 'palmilha', 'forma', 'salto'
    default_material_id UUID REFERENCES public.products(id),
    consumption_default NUMERIC DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.sole_structures ENABLE ROW LEVEL SECURITY;

-- Create policies (allowing authenticated users access for now)
DROP POLICY IF EXISTS "Authenticated users can manage sole structures" ON public.sole_structures;
CREATE POLICY "Authenticated users can manage sole structures" 
ON public.sole_structures 
FOR ALL 
TO authenticated 
USING (true);

-- Add update trigger
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_sole_structures_updated_at
BEFORE UPDATE ON public.sole_structures
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();