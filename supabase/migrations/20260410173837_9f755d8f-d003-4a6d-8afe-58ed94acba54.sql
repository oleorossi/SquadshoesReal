-- Create packaging catalog table
CREATE TABLE IF NOT EXISTS public.packaging_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    tipo TEXT CHECK (tipo IN ('individual', 'master', 'colmeia')),
    comprimento_ext NUMERIC,
    largura_ext NUMERIC,
    altura_ext NUMERIC,
    capacidade_pares INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.packaging_catalog ENABLE ROW LEVEL SECURITY;

-- Create policies for packaging_catalog
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.packaging_catalog;
CREATE POLICY "Enable all for authenticated users" ON public.packaging_catalog
    FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Update clients table to include packaging preference
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS accepts_bundled_packaging BOOLEAN DEFAULT true;

-- Create trigger for updated_at on packaging_catalog
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_packaging_catalog_updated_at
    BEFORE UPDATE ON public.packaging_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();