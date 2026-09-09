-- Correção forward da 20270101014600.
--
-- A migration anterior usou o termo "EVA" como alternativa ao setor
-- Palmilha. Isso alcançou também materiais compostos de outros setores que
-- possuem SKUs realmente distintos por cor. A correção preserva a doutrina da
-- fibra da palmilha sem apagar a identidade cromática desses materiais.

BEGIN;

UPDATE public.product_groups pg
   SET is_color_agnostic = false,
       is_bom_color_source = true
 WHERE COALESCE(pg.sector, '') <> 'Palmilha'
   AND COALESCE(pg.is_family, false) = false
   AND translate(lower(btrim(pg.name)),
         'áàâãäéèêëíìîïóòôõöúùûüç',
         'aaaaaeeeeiiiiooooouuuuc')
       ~ '(fibra|placa|\yeva\y|celulose|papelao|strobel|^palmilha$)'
   AND (
     COALESCE(pg.is_color_agnostic, false)
     OR NOT COALESCE(pg.is_bom_color_source, true)
   )
   AND EXISTS (
     SELECT 1
       FROM public.products p
      WHERE p.group_id = pg.id
        AND p.active = true
      GROUP BY p.group_id
     HAVING count(DISTINCT NULLIF(btrim(p.color), '')) > 1
   );

COMMENT ON COLUMN public.product_groups.is_color_agnostic IS
  'Material-base explicitamente sem cor (cola, fibra/placa e EVA estrutural da palmilha): consumo e débito resolvem pelo grupo. Materiais de outros setores que contêm EVA podem variar por cor.';

-- Fail-closed: a transação inteira aborta se algum material estrutural fora da
-- Palmilha, com múltiplas cores ativas, continuar sem identidade por cor.
DO $assert_colored_non_insole_materials$
DECLARE
  v_group_name text;
BEGIN
  SELECT pg.name
    INTO v_group_name
    FROM public.product_groups pg
   WHERE COALESCE(pg.sector, '') <> 'Palmilha'
     AND COALESCE(pg.is_family, false) = false
     AND translate(lower(btrim(pg.name)),
           'áàâãäéèêëíìîïóòôõöúùûüç',
           'aaaaaeeeeiiiiooooouuuuc')
         ~ '(fibra|placa|\yeva\y|celulose|papelao|strobel|^palmilha$)'
     AND (
       COALESCE(pg.is_color_agnostic, false)
       OR NOT COALESCE(pg.is_bom_color_source, true)
     )
     AND EXISTS (
       SELECT 1
         FROM public.products p
        WHERE p.group_id = pg.id
          AND p.active = true
        GROUP BY p.group_id
       HAVING count(DISTINCT NULLIF(btrim(p.color), '')) > 1
     )
   LIMIT 1;

  IF v_group_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Material colorido fora da Palmilha perdeu identidade por cor: %',
      v_group_name;
  END IF;
END;
$assert_colored_non_insole_materials$;

-- O resolver deve continuar avisando incompatibilidade quando a cor solicitada
-- não existe em um grupo que possui mais de uma cor real.
DO $assert_colored_resolver$
DECLARE
  v_group_name text;
BEGIN
  SELECT pg.name
    INTO v_group_name
    FROM public.product_groups pg
   WHERE COALESCE(pg.sector, '') <> 'Palmilha'
     AND COALESCE(pg.is_family, false) = false
     AND translate(lower(btrim(pg.name)),
           'áàâãäéèêëíìîïóòôõöúùûüç',
           'aaaaaeeeeiiiiooooouuuuc')
         ~ '(fibra|placa|\yeva\y|celulose|papelao|strobel|^palmilha$)'
     AND EXISTS (
       SELECT 1
         FROM public.products p
        WHERE p.group_id = pg.id
          AND p.active = true
        GROUP BY p.group_id
       HAVING count(DISTINCT NULLIF(btrim(p.color), '')) > 1
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.resolve_material_product(
           pg.name,
           '__migration_14650_missing_color__',
           0,
           false
         ) resolved
        WHERE resolved.matched_by = 'color_mismatch'
     )
   LIMIT 1;

  IF v_group_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Resolver deixou de sinalizar color_mismatch no material colorido: %',
      v_group_name;
  END IF;
END;
$assert_colored_resolver$;

COMMIT;
