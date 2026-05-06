-- Tabela de consumo padrão de itens (cola, palmilha, forro, linha, EVA) por solado e numeração.
-- Permite que cada solado defina quanto consome de cada item padrão para cada numeração da sua grade.
CREATE TABLE IF NOT EXISTS public.sole_standard_items_consumption (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sole_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  standard_item_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size integer NOT NULL,
  consumption numeric(12,4) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'un',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sole_product_id, standard_item_id, size)
);

CREATE INDEX IF NOT EXISTS idx_ssic_sole ON public.sole_standard_items_consumption(sole_product_id);
CREATE INDEX IF NOT EXISTS idx_ssic_item ON public.sole_standard_items_consumption(standard_item_id);

ALTER TABLE public.sole_standard_items_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users can select sole standard items"
  ON public.sole_standard_items_consumption FOR SELECT
  TO authenticated
  USING (is_approved_user());

CREATE POLICY "Approved users can insert sole standard items"
  ON public.sole_standard_items_consumption FOR INSERT
  TO authenticated
  WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can update sole standard items"
  ON public.sole_standard_items_consumption FOR UPDATE
  TO authenticated
  USING (is_approved_user())
  WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can delete sole standard items"
  ON public.sole_standard_items_consumption FOR DELETE
  TO authenticated
  USING (is_approved_user());

CREATE TRIGGER set_updated_at_ssic
  BEFORE UPDATE ON public.sole_standard_items_consumption
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();