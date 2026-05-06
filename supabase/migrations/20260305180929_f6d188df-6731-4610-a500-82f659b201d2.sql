
-- Create product_groups table
CREATE TABLE public.product_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Auth users can view groups" ON public.product_groups;
CREATE POLICY "Auth users can view groups" ON public.product_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth users can insert groups" ON public.product_groups;
CREATE POLICY "Auth users can insert groups" ON public.product_groups FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update groups" ON public.product_groups;
CREATE POLICY "Auth users can update groups" ON public.product_groups FOR UPDATE USING (true);
DROP POLICY IF EXISTS "Auth users can delete groups" ON public.product_groups;
CREATE POLICY "Auth users can delete groups" ON public.product_groups FOR DELETE USING (true);

-- Add group_id to products
ALTER TABLE public.products ADD COLUMN group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL;

-- Trigger for updated_at
CREATE TRIGGER update_product_groups_updated_at
  BEFORE UPDATE ON public.product_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
