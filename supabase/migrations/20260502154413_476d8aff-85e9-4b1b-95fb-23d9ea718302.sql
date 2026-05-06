-- 1. Backfill sole grade range metadata
UPDATE public.products p
SET stock_grade = jsonb_set(
  jsonb_set(
    COALESCE(stock_grade, '{}'::jsonb),
    '{_size_from}',
    (
      SELECT to_jsonb(MIN(size::int))
      FROM public.sole_technical_specs
      WHERE sole_id = p.id
    )
  ),
  '{_size_to}',
  (
    SELECT to_jsonb(MAX(size::int))
    FROM public.sole_technical_specs
    WHERE sole_id = p.id
  )
)
WHERE category = 'Solado'
AND EXISTS (SELECT 1 FROM public.sole_technical_specs WHERE sole_id = p.id);

-- 2. Reference material variants (vincular variantes de materiais a fichas técnicas se necessário)
-- (Esta migração é mais lógica, garantindo que não existam órfãos se as tabelas existirem)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reference_material_variants') THEN
    DELETE FROM public.reference_material_variants
    WHERE reference_id NOT IN (SELECT id FROM public.technical_sheets);
  END IF;
END $$;
