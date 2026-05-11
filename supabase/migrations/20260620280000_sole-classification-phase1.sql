-- FASE 1 da reformulação de solados: formaliza os 3 tipos.
--
-- Tipos:
--   'tradicional'     - cada número da grade é individual; palmilha cortada na fábrica (dm²)
--   'palmilha_pronta' - palmilha vem pronta do fornecedor (un); pode ter coligação cor cabedal/palmilha
--   'conjugado'       - alguns números são conjugados (ex.: 33/34, 39/40)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sole_classification_enum') THEN
    CREATE TYPE public.sole_classification_enum AS ENUM ('tradicional', 'palmilha_pronta', 'conjugado');
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sole_classification public.sole_classification_enum;

COMMENT ON COLUMN public.products.sole_classification IS
  'Tipo do solado (apenas pra category=Solado): tradicional (grade individual + palmilha cortada dm²), '
  'palmilha_pronta (palmilha em un + coligação cor), conjugado (alguns números agrupados ex 33/34).';

-- insole_consumption_unit (default 'dm2') na ficha técnica
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='technical_sheets' AND column_name='insole_consumption_unit'
  ) THEN
    ALTER TABLE public.technical_sheets
      ADD COLUMN insole_consumption_unit text NOT NULL DEFAULT 'dm2'
      CONSTRAINT chk_insole_consumption_unit CHECK (insole_consumption_unit IN ('dm2', 'un'));
  END IF;
END $$;

COMMENT ON COLUMN public.technical_sheets.insole_consumption_unit IS
  'Unidade de consumo da palmilha. dm2 quando palmilha é cortada (Tipo 1/3), un quando palmilha pronta (Tipo 2).';

-- Backfill: marca o tipo de cada solado baseado em sinais existentes
UPDATE public.products p
   SET sole_classification = CASE
     WHEN EXISTS (
       SELECT 1 FROM public.sole_size_conjugations sc
        WHERE sc.sole_group_id = p.group_id
     ) THEN 'conjugado'::public.sole_classification_enum
     WHEN EXISTS (
       SELECT 1 FROM public.technical_sheets ts
        WHERE ts.sole_group_id = p.group_id AND ts.insole_ready_made = true
     ) THEN 'palmilha_pronta'::public.sole_classification_enum
     ELSE 'tradicional'::public.sole_classification_enum
   END
 WHERE p.category = 'Solado' AND p.sole_classification IS NULL;

NOTIFY pgrst, 'reload schema';
