CREATE TABLE public.technical_sheet_lining_colors (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
    cabedal_color TEXT NOT NULL,
    lining_color TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(sheet_id, cabedal_color)
);

ALTER TABLE public.technical_sheet_lining_colors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view lining color mappings" ON public.technical_sheet_lining_colors FOR SELECT USING (true);
CREATE POLICY "Anyone can insert/update lining color mappings" ON public.technical_sheet_lining_colors FOR ALL USING (true) WITH CHECK (true);
