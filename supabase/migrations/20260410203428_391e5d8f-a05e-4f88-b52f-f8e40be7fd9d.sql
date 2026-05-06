-- Add box_type_id to technical_sheets
ALTER TABLE public.technical_sheets 
ADD COLUMN box_type_id UUID REFERENCES public.box_types(id) ON DELETE SET NULL;
