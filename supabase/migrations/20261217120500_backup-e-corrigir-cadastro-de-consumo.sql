-- Snapshot imutável do estado anterior às correções desta auditoria.
CREATE TABLE public.backup_auditoria_20260807 AS
SELECT
  id,
  name,
  upper_consumption,
  direct_components
FROM public.technical_sheets;

COMMENT ON TABLE public.backup_auditoria_20260807 IS
  'Snapshot de technical_sheets antes das correções de consumo de 2026-08-07.';

REVOKE ALL ON TABLE public.backup_auditoria_20260807 FROM anon, authenticated;

-- O cadastro por numeração da CF 09 já usa 20 dm²/par; corrige o escalar
-- divergente sem alterar os mapas per-size.
UPDATE public.technical_sheets
   SET upper_consumption = 20
 WHERE name = 'CF 09 '
   AND upper_consumption IS DISTINCT FROM 20;

-- Atualiza somente nomes em cache cujo product_id ainda resolve. Componentes
-- órfãos ficam byte a byte intactos: dependem da criação/religação de produtos
-- em uma fase posterior.
WITH rewritten AS (
  SELECT
    sheet.id,
    jsonb_agg(
      CASE
        WHEN product.id IS NOT NULL
         AND component.value ->> 'product_name' IS DISTINCT FROM product.name THEN
          jsonb_set(component.value, '{product_name}', to_jsonb(product.name), true)
        ELSE component.value
      END
      ORDER BY component.ordinality
    ) AS direct_components
  FROM public.technical_sheets AS sheet
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(sheet.direct_components) = 'array' THEN sheet.direct_components
      ELSE '[]'::jsonb
    END
  )
    WITH ORDINALITY AS component(value, ordinality)
  LEFT JOIN public.products AS product
    ON product.id::text = component.value ->> 'product_id'
  WHERE jsonb_typeof(sheet.direct_components) = 'array'
  GROUP BY sheet.id
  HAVING bool_or(
    product.id IS NOT NULL
    AND component.value ->> 'product_name' IS DISTINCT FROM product.name
  )
)
UPDATE public.technical_sheets AS sheet
   SET direct_components = rewritten.direct_components
  FROM rewritten
 WHERE sheet.id = rewritten.id;
