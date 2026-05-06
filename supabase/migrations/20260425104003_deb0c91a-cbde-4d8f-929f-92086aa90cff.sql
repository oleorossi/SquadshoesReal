-- Create history table for overhead changes
CREATE TABLE IF NOT EXISTS public.technical_sheet_overhead_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES auth.users(id),
    old_value NUMERIC(10, 2),
    new_value NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.technical_sheet_overhead_history ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view history of sheets they can access"
    ON public.technical_sheet_overhead_history
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.technical_sheets WHERE id = sheet_id));

-- Trigger function to log overhead changes
CREATE OR REPLACE FUNCTION public.log_technical_sheet_overhead_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.custom_overhead IS DISTINCT FROM NEW.custom_overhead) THEN
        INSERT INTO public.technical_sheet_overhead_history (
            sheet_id,
            changed_by,
            old_value,
            new_value
        ) VALUES (
            NEW.id,
            auth.uid(),
            OLD.custom_overhead,
            NEW.custom_overhead
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
DROP TRIGGER IF EXISTS tr_log_technical_sheet_overhead_change ON public.technical_sheets;
CREATE TRIGGER tr_log_technical_sheet_overhead_change
    AFTER UPDATE OF custom_overhead ON public.technical_sheets
    FOR EACH ROW
    EXECUTE FUNCTION public.log_technical_sheet_overhead_change();

-- Add check constraint for non-negative overhead
ALTER TABLE public.technical_sheets 
ADD CONSTRAINT check_custom_overhead_non_negative 
CHECK (custom_overhead IS NULL OR custom_overhead >= 0);
