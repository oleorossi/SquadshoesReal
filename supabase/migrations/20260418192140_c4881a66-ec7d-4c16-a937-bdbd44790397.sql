-- Add shared specs flag and default consumption unit on groups
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS shared_specs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consumption_unit text;

-- Add per-product consumption unit
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS consumption_unit text;

COMMENT ON COLUMN public.product_groups.shared_specs IS
  'Quando TRUE, todos os itens do grupo herdam as mesmas especificações técnicas (consumo, valor, dimensões).';
COMMENT ON COLUMN public.product_groups.consumption_unit IS
  'Unidade de medida usada para cálculos de consumo do grupo (vale para todos os itens quando shared_specs = TRUE).';
COMMENT ON COLUMN public.products.consumption_unit IS
  'Unidade de medida específica de consumo deste item (usada quando o grupo não tem especificações compartilhadas).';