-- Create new tables for Labeling system, integrating with existing product_references

CREATE TABLE public.care_instructions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    symbols JSONB, -- Array of symbol IDs
    instruction_text_pt TEXT,
    instruction_text_en TEXT,
    instruction_text_es TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.label_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'hangtag', 'box', 'internal', 'sole'
    width_mm NUMERIC NOT NULL,
    height_mm NUMERIC NOT NULL,
    layout_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.print_jobs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id),
    template_id UUID REFERENCES public.label_templates(id),
    status TEXT DEFAULT 'pending',
    batch_name TEXT,
    total_labels INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.print_job_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    print_job_id UUID REFERENCES public.print_jobs(id) ON DELETE CASCADE,
    reference_id UUID REFERENCES public.product_references(id),
    quantity INTEGER DEFAULT 1,
    size TEXT, -- For specific size labels
    color TEXT, -- For specific color labels
    serial_start TEXT,
    serial_end TEXT
);

-- Enable RLS
ALTER TABLE public.care_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_job_items ENABLE ROW LEVEL SECURITY;

-- Simple Policies
CREATE POLICY "Public read care_instructions" ON public.care_instructions FOR SELECT USING (true);
CREATE POLICY "Public read templates" ON public.label_templates FOR SELECT USING (true);
CREATE POLICY "Public read print_jobs" ON public.print_jobs FOR SELECT USING (true);
CREATE POLICY "Public read print_job_items" ON public.print_job_items FOR SELECT USING (true);

-- Add sample data
INSERT INTO public.care_instructions (name, symbols, instruction_text_pt) VALUES
('Couro Natural', '["no-wash", "no-bleach", "no-iron"]', 'Limpar com pano levemente úmido. Não lavar na máquina.'),
('Sintético / Tecido', '["hand-wash", "no-tumble"]', 'Lavar à mão com sabão neutro. Secar à sombra.');

INSERT INTO public.label_templates (name, type, width_mm, height_mm, layout_config) VALUES
('Hangtag Padrão', 'hangtag', 50, 80, '{"elements": [{"type": "logo", "top": 5, "left": 15}, {"type": "text", "field": "name", "top": 25, "size": 12}, {"type": "barcode", "top": 60}]}');
