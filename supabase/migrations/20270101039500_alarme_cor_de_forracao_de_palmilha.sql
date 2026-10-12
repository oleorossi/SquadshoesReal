-- Alarme: cor vendida sem SKU no grupo da FORRAÇÃO, em ficha cujo forro é da
-- PALMILHA (decisão do dono, grill de 12/10/2026).
--
-- O SINTOMA que originou isto: o PV da SP301 recusava salvar com
-- "Cor ROCHA sem estoque em NAPA SUDANI" enquanto o seletor "Material" ao lado
-- exibia NAPA SOFT. Nada estava trocado — NAPA SOFT é o CABEDAL e NAPA SUDANI é
-- o `lining_material`. O que faltava era dizer de qual componente era cada um.
--
-- Por trás disso havia um segundo fato, maior: em ficha com
-- `sole_drives_consumption` cujo SOLADO tem forro de PALMILHA
-- (`insole_lining_consumption_dm2 > 0`) e NÃO tem forro de CABEDAL
-- (`lining_consumption_dm2` nulo), o motor SUPRIME a linha de Forração do
-- cabedal (`suppressCabedalForracao` em `orderConsumption.ts`, espelhando
-- `v_suppress_cabedal_lining` da mig `20260911120000`). Nessas fichas o
-- `lining_material` NÃO é forração de cabedal: é o material do forro da
-- PALMILHA. Medido em 12/10/2026: 25 fichas nesse estado, e
-- `technical_sheet_palmilha_colors` VAZIA em todas — logo o forro da palmilha
-- herda a cor do item, e uma cor sem SKU naquele grupo vira débito pulado.
--
-- ⚠ Esta função NÃO inventa cor nem material: devolve a lista acionável, como
-- `list_sole_spec_gaps` e `list_material_sector_gaps`. A correção é cadastro —
-- criar o SKU na cor, mapear a cor da palmilha em
-- `technical_sheet_palmilha_colors`, ou corrigir o `lining_material` da ficha.
--
-- ⚠ NÃO confundir com "cabedal e forração são grupos diferentes", que é
-- legítimo e corriqueiro (NAPA SOFT + MASSABOX / NAPA SOFT; NEW VELVET /
-- NEW VELVET PRETO). Alarmar diferença de grupo seria ruído: o que dói é cor
-- VENDIDA sem SKU no grupo que o débito vai procurar.

CREATE OR REPLACE FUNCTION public.list_insole_lining_color_gaps()
RETURNS TABLE (
  sheet_id uuid,
  reference_code text,
  reference_name text,
  lining_material text,
  lining_group_id uuid,
  sold_color text,
  items integer,
  sale_orders text[],
  has_palmilha_color_map boolean,
  fix_hint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
  WITH sheet AS (
    SELECT ts.id,
           ts.code,
           ts.name,
           ts.lining_material,
           gl.id AS lining_group_id,
           EXISTS (
             SELECT 1 FROM public.technical_sheet_palmilha_colors c
              WHERE c.sheet_id = ts.id
           ) AS has_color_map
      FROM public.technical_sheets ts
      JOIN public.product_groups gl
        ON lower(btrim(gl.name)) = lower(btrim(ts.lining_material))
     WHERE coalesce(ts.sole_drives_consumption, false)
       AND nullif(btrim(coalesce(ts.lining_material, '')), '') IS NOT NULL
       -- O solado dirige o forro da PALMILHA …
       AND EXISTS (
         SELECT 1
           FROM public.sole_technical_specs s
           JOIN public.products p ON p.id = s.sole_id
          WHERE p.group_id = ts.sole_group_id
            AND coalesce(s.insole_lining_consumption_dm2, 0) > 0
       )
       -- … e NÃO tem forro de CABEDAL: é exatamente a condição de supressão do
       -- motor. Fora dela o `lining_material` é forração de cabedal de verdade
       -- e este alarme não se aplica.
       AND NOT EXISTS (
         SELECT 1
           FROM public.sole_technical_specs s
           JOIN public.products p ON p.id = s.sole_id
          WHERE p.group_id = ts.sole_group_id
            AND coalesce(s.lining_consumption_dm2, 0) > 0
       )
  ), sold AS (
    SELECT i.reference_id,
           upper(btrim(i.color)) AS color,
           count(*)::integer AS items,
           array_agg(DISTINCT so.order_number ORDER BY so.order_number)
             FILTER (WHERE so.order_number IS NOT NULL) AS orders
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id = i.sale_order_id
     WHERE nullif(btrim(coalesce(i.color, '')), '') IS NOT NULL
     GROUP BY i.reference_id, upper(btrim(i.color))
  )
  SELECT s.id,
         s.code,
         s.name,
         s.lining_material,
         s.lining_group_id,
         sold.color,
         sold.items,
         coalesce(sold.orders, ARRAY[]::text[]),
         s.has_color_map,
         CASE
           WHEN NOT s.has_color_map THEN
             'Sem mapa de cor de palmilha: o forro herda a cor do item. '
             || 'Cadastre o SKU ' || s.lining_material || ' ' || sold.color
             || ', ou mapeie a cor da palmilha na ficha.'
           ELSE
             'Cadastre o SKU ' || s.lining_material || ' ' || sold.color
             || ' ou revise o mapa de cor de palmilha da ficha.'
         END
    FROM sheet s
    JOIN sold ON sold.reference_id = s.id
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.products p
      WHERE p.group_id = s.lining_group_id
        AND p.active = true
        AND upper(btrim(coalesce(p.color, ''))) = sold.color
   )
     -- Grupo sem nenhuma cor é genérico: o débito não resolve por cor ali.
     AND EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.group_id = s.lining_group_id
          AND p.active = true
          AND nullif(btrim(coalesce(p.color, '')), '') IS NOT NULL
     )
   ORDER BY s.name, sold.color;
$function$;

COMMENT ON FUNCTION public.list_insole_lining_color_gaps() IS
  'Cor vendida sem SKU ativo no grupo do lining, restrito às fichas em que o '
  'solado dirige o forro da PALMILHA e o cabedal NÃO tem forro (condição de '
  'suppressCabedalForracao). Leitura; não inventa cadastro. Grill 12/10/2026.';

-- ⚠ Tabela/função nova nasce aberta neste projeto (DEFAULT PRIVILEGES). Revogar
-- de PUBLIC/anon ANTES de conceder, senão o GRANT seguinte é no-op que parece
-- permissão apertada — ver a nota de grants no CLAUDE.md.
REVOKE ALL ON FUNCTION public.list_insole_lining_color_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_insole_lining_color_gaps() TO authenticated, service_role;
