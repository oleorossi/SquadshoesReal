ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sole_moq integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sole_technical_notes text;

COMMENT ON COLUMN public.products.sole_moq IS 'Quantidade mínima de compra (pares) exigida pelo fornecedor para esta variante de solado';
COMMENT ON COLUMN public.products.sole_technical_notes IS 'Notas técnicas específicas do solado (acabamento, fôrma, observações de produção)';