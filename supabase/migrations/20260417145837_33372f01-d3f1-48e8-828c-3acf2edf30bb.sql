-- Adiciona o solado padrão na ficha de componente
ALTER TABLE public.component_sheets 
ADD COLUMN IF NOT EXISTS default_sole_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_component_sheets_default_sole_group 
ON public.component_sheets(default_sole_group_id) 
WHERE default_sole_group_id IS NOT NULL;

COMMENT ON COLUMN public.component_sheets.default_sole_group_id IS 
'Grupo de solado padrão para este componente. Propaga para todas as fichas técnicas que utilizam este componente.';