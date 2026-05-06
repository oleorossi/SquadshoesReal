-- Create table for silk registrations by sole type
CREATE TABLE public.sole_silk_registrations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sole_type TEXT NOT NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    economic_group_id UUID REFERENCES public.economic_groups(id) ON DELETE CASCADE,
    silk_name TEXT NOT NULL,
    silk_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(sole_type, client_id, economic_group_id)
);

-- Enable RLS
ALTER TABLE public.sole_silk_registrations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow authenticated users to view silk registrations"
ON public.sole_silk_registrations FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated users to insert silk registrations"
ON public.sole_silk_registrations FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update silk registrations"
ON public.sole_silk_registrations FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated users to delete silk registrations"
ON public.sole_silk_registrations FOR DELETE
TO authenticated
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_sole_silk_registrations_updated_at
BEFORE UPDATE ON public.sole_silk_registrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
