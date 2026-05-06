-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create packaging_types table
CREATE TABLE IF NOT EXISTS public.packaging_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- Ex: "Caixa Bota Cano Curto", "Master 12 Pares", "Colmeia G"
    type TEXT CHECK (type IN ('individual', 'master', 'colmeia')),
    length_cm NUMERIC,
    width_cm NUMERIC,
    height_cm NUMERIC,
    max_capacity_pairs INT DEFAULT 1, -- Quantos pares cabem (para Master/Colmeia)
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.packaging_types ENABLE ROW LEVEL SECURITY;

-- Create policies (allowing authenticated users for now)
CREATE POLICY "Everyone can view active packaging types" ON public.packaging_types
    FOR SELECT USING (is_active = true);

CREATE POLICY "Authenticated users can manage packaging types" ON public.packaging_types
    FOR ALL USING (auth.role() = 'authenticated');

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_packaging_types_updated_at
    BEFORE UPDATE ON public.packaging_types
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();