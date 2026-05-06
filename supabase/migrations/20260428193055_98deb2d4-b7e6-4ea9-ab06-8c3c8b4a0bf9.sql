-- Create the silk_shoe_category table
CREATE TABLE public.silk_shoe_category (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on silk_shoe_category
ALTER TABLE public.silk_shoe_category ENABLE ROW LEVEL SECURITY;

-- Add policies for silk_shoe_category
DROP POLICY IF EXISTS "Categories are viewable by everyone" ON public.silk_shoe_category;
CREATE POLICY "Categories are viewable by everyone" 
ON public.silk_shoe_category FOR SELECT USING (true);

DROP POLICY IF EXISTS "Categories can be inserted by authenticated users" ON public.silk_shoe_category;
CREATE POLICY "Categories can be inserted by authenticated users" 
ON public.silk_shoe_category FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Categories can be updated by authenticated users" ON public.silk_shoe_category;
CREATE POLICY "Categories can be updated by authenticated users" 
ON public.silk_shoe_category FOR UPDATE USING (auth.role() = 'authenticated');

-- Add shoe_category_id to technical_sheets
ALTER TABLE public.technical_sheets 
ADD COLUMN shoe_category_id UUID REFERENCES public.silk_shoe_category(id);

-- Insert default categories based on existing data
INSERT INTO public.silk_shoe_category (name)
VALUES ('Rasteira'), ('Infantil'), ('Sandália')
ON CONFLICT (name) DO NOTHING;

-- Map existing string categories to the new IDs (best effort)
UPDATE public.technical_sheets ts
SET shoe_category_id = ssc.id
FROM public.silk_shoe_category ssc
WHERE ts.shoe_category = ssc.name
AND ts.shoe_category_id IS NULL;

-- Trigger to update updated_at
CREATE TRIGGER update_silk_shoe_category_updated_at
BEFORE UPDATE ON public.silk_shoe_category
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();