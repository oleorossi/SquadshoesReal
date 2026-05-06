
-- Table to map insole color to sole color per technical sheet
CREATE TABLE public.technical_sheet_insole_colors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  sole_color TEXT NOT NULL,
  insole_color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, sole_color)
);

-- Enable RLS
ALTER TABLE public.technical_sheet_insole_colors ENABLE ROW LEVEL SECURITY;

-- Policies for approved users
CREATE POLICY "Approved users can view insole color mappings"
  ON public.technical_sheet_insole_colors FOR SELECT
  USING (public.is_approved_user());

CREATE POLICY "Approved users can insert insole color mappings"
  ON public.technical_sheet_insole_colors FOR INSERT
  WITH CHECK (public.is_approved_user());

CREATE POLICY "Approved users can update insole color mappings"
  ON public.technical_sheet_insole_colors FOR UPDATE
  USING (public.is_approved_user());

CREATE POLICY "Approved users can delete insole color mappings"
  ON public.technical_sheet_insole_colors FOR DELETE
  USING (public.is_approved_user());

-- Index for fast lookups
CREATE INDEX idx_insole_colors_sheet ON public.technical_sheet_insole_colors(sheet_id);
