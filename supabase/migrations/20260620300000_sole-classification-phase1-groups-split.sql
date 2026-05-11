-- FASE 1.5: Separa solados em grupos próprios baseado no TIPO
--
-- Antes: 9 solados de tipos diferentes (Solado 01 tradicional, Solado 238
-- palmilha pronta, Solado 204 conjugado, etc.) compartilhavam o mesmo
-- group_id="d1b030cd...". Isso quebrava qualquer lógica que dependia de
-- "todas variantes do grupo seguem a mesma regra" (range, conjugação, tipo).
--
-- Depois: 5 grupos novos, um por família/tipo de solado:
--   SOLADO 01      → tradicional (01-CARAMELO, 01-Preto)
--   SOLADO 238     → palmilha_pronta (238)
--   SOLADO 204     → conjugado (204-CARAMELO, 204-Preto)
--   SALTINHO BLOCO → tradicional (Saltinho Bloco-Caramelo, Saltinho Bloco-Preto)
--   SOLADO INFANTIL → tradicional (SOLADO INFANTIL, Solado Infantil-Caramelo)

-- Cria os grupos (idempotente via NOT EXISTS)
DO $$
BEGIN
  INSERT INTO public.product_groups (name) VALUES
    ('SOLADO 01'), ('SOLADO 238'), ('SOLADO 204'),
    ('SALTINHO BLOCO'), ('SOLADO INFANTIL')
  ON CONFLICT DO NOTHING;
END $$;

-- Migra produtos pros grupos certos (busca pelo nome do grupo)
UPDATE public.products SET group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 01' LIMIT 1)
  WHERE category = 'Solado' AND name IN ('01 - CARAMELO', '01 - Preto');

UPDATE public.products SET group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 238' LIMIT 1)
  WHERE category = 'Solado' AND name = '238';

UPDATE public.products SET group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 204' LIMIT 1)
  WHERE category = 'Solado' AND name IN ('204 - CARAMELO', '204 - Preto');

UPDATE public.products SET group_id = (SELECT id FROM public.product_groups WHERE name='SALTINHO BLOCO' LIMIT 1)
  WHERE category = 'Solado' AND name IN ('Saltinho Bloco - Caramelo', 'Saltinho Bloco - Preto');

UPDATE public.products SET group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO INFANTIL' LIMIT 1)
  WHERE category = 'Solado' AND name IN ('SOLADO INFANTIL', 'Solado Infantil - Caramelo');

-- Atualiza classificação manualmente conforme briefing (238 pronta, 204 conjugado)
UPDATE public.products SET sole_classification = 'palmilha_pronta'::public.sole_classification_enum
 WHERE category = 'Solado' AND name = '238';

UPDATE public.products SET sole_classification = 'conjugado'::public.sole_classification_enum
 WHERE category = 'Solado' AND name IN ('204 - CARAMELO', '204 - Preto');

-- Migra fichas técnicas pros novos grupos baseado no sole_material texto
UPDATE public.technical_sheets ts
   SET sole_group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 01' LIMIT 1)
 WHERE lower(trim(coalesce(ts.sole_material, ''))) = '01';

UPDATE public.technical_sheets ts
   SET sole_group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 238' LIMIT 1)
 WHERE trim(coalesce(ts.sole_material, '')) = '238';

UPDATE public.technical_sheets ts
   SET sole_group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO 204' LIMIT 1)
 WHERE lower(trim(coalesce(ts.sole_material, ''))) = '204';

UPDATE public.technical_sheets ts
   SET sole_group_id = (SELECT id FROM public.product_groups WHERE name='SALTINHO BLOCO' LIMIT 1)
 WHERE lower(trim(coalesce(ts.sole_material, ''))) LIKE 'saltinho%';

UPDATE public.technical_sheets ts
   SET sole_group_id = (SELECT id FROM public.product_groups WHERE name='SOLADO INFANTIL' LIMIT 1)
 WHERE lower(trim(coalesce(ts.sole_material, ''))) ILIKE '%infantil%';

-- Conjugações iniciais pro Solado 204 (range 25-32, pontas conjugadas)
INSERT INTO public.sole_size_conjugations (sole_group_id, size_key, sizes, display_order)
SELECT (SELECT id FROM public.product_groups WHERE name='SOLADO 204' LIMIT 1),
       v.size_key, v.sizes, v.ord
  FROM (VALUES
    ('25/26', ARRAY[25,26], 1),
    ('27',    ARRAY[27],    2),
    ('28',    ARRAY[28],    3),
    ('29',    ARRAY[29],    4),
    ('30',    ARRAY[30],    5),
    ('31/32', ARRAY[31,32], 6)
  ) AS v(size_key, sizes, ord)
ON CONFLICT DO NOTHING;
