
CREATE TABLE public.packaging_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  packaging_type TEXT NOT NULL DEFAULT 'individual',
  nome TEXT NOT NULL DEFAULT '',
  pairs_per_box INTEGER NOT NULL DEFAULT 1,
  comprimento_cm NUMERIC NOT NULL DEFAULT 0,
  largura_cm NUMERIC NOT NULL DEFAULT 0,
  altura_cm NUMERIC NOT NULL DEFAULT 0,
  peso_kg NUMERIC DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.packaging_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage packaging_configs"
ON public.packaging_configs
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
