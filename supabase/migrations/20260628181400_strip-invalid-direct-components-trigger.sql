-- Fase 1: causa-raiz do crash "invalid input syntax for type uuid" nas funções de consumo —
-- o form da ficha deixa linhas em branco em direct_components ({product_id:''}); as funções
-- castam product_id::uuid sem guard. Em vez de re-transcrever as 2 funções grandes, bloqueia o
-- lixo na ENTRADA com trigger BEFORE INS/UPD + higieniza o dado existente. Aplicada via MCP.

-- Higieniza itens-lixo existentes (product_id não-uuid).
UPDATE public.technical_sheets t
SET direct_components = (
  SELECT coalesce(jsonb_agg(dc), '[]'::jsonb)
  FROM jsonb_array_elements(t.direct_components) dc
  WHERE coalesce(dc->>'product_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
WHERE jsonb_typeof(t.direct_components)='array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.direct_components) dc
    WHERE coalesce(dc->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  );

CREATE OR REPLACE FUNCTION public.tg_strip_invalid_direct_components()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direct_components IS NOT NULL AND jsonb_typeof(NEW.direct_components) = 'array' THEN
    NEW.direct_components := (
      SELECT coalesce(jsonb_agg(dc), '[]'::jsonb)
      FROM jsonb_array_elements(NEW.direct_components) dc
      WHERE coalesce(dc->>'product_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_strip_invalid_direct_components ON public.technical_sheets;
CREATE TRIGGER tg_strip_invalid_direct_components
  BEFORE INSERT OR UPDATE ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_strip_invalid_direct_components();
