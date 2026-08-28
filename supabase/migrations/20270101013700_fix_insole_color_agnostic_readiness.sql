-- Corrige falso bloqueio de cor em materiais-base sem cor (EVA/palmilha).
--
-- A versão area-first do resolver de palmilha, introduzida na migration 116,
-- preservou a preferência por produto estocado em área, mas perdeu a regra
-- canônica de product_groups.is_color_agnostic. Com isso, PALMILHA retornava
-- color_mismatch para cada cor do PV e impedia a confirmação do pedido, embora
-- o cadastro declare explicitamente que a cor não faz parte da identidade.
--
-- O patch é deliberadamente estreito: altera somente a decisão entre
-- color_mismatch e group_generic e mantém intacta a precedência area-first.

BEGIN;

DO $patch_resolve_insole_color_agnostic$
DECLARE
  v_definition text;
  v_anchor text := E'           AND p.color IS NOT NULL\n           AND btrim(p.color) <> ''''';
  v_replacement text := E'           AND NOT COALESCE(pg.is_color_agnostic, false)\n           AND p.color IS NOT NULL\n           AND btrim(p.color) <> ''''';
  v_occurrences integer;
  v_patched_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'resolve_insole_material_for_variant'
     AND pg_get_function_identity_arguments(p.oid) = 'p_variant_id uuid, p_group_name text, p_color text, p_required numeric';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION
      'resolve_insole_material_for_variant(uuid,text,text,numeric) não encontrada';
  END IF;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_anchor, ''))
  ) / NULLIF(length(v_anchor), 0);
  v_patched_occurrences := (
    length(v_definition) - length(replace(v_definition, v_replacement, ''))
  ) / NULLIF(length(v_replacement), 0);

  -- O MCP aplica a mudança imediatamente e o CI volta a executar o arquivo
  -- versionado. Reconhecer a definição já corrigida evita duplicar o predicado.
  IF v_patched_occurrences = 1 THEN
    NULL;
  ELSIF v_patched_occurrences <> 0 OR v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncora do ramo color_mismatch mudou; original=%, corrigida=%',
      v_occurrences,
      v_patched_occurrences;
  ELSE
    EXECUTE replace(v_definition, v_anchor, v_replacement);
  END IF;
END;
$patch_resolve_insole_color_agnostic$;

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Resolve palmilha por pin explícito, grupo da variante e grupo da ficha. Em grupo heterogêneo sem pin, prefere SKU ativo de unidade de área; grupos is_color_agnostic resolvem como group_generic, nunca color_mismatch.';

-- Guard executável: quando houver grupo agnóstico com produto de área no
-- ambiente, uma cor sentinela ausente jamais pode produzir color_mismatch.
DO $assert_insole_color_agnostic$
DECLARE
  v_group_name text;
BEGIN
  SELECT pg.name
    INTO v_group_name
    FROM public.product_groups pg
   WHERE COALESCE(pg.is_color_agnostic, false)
     AND EXISTS (
       SELECT 1
         FROM public.products p
        WHERE p.group_id = pg.id
          AND p.active = true
          AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
            ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
          )
     )
     AND EXISTS (
       SELECT 1
         FROM public.resolve_insole_material_for_variant(
           NULL,
           pg.name,
           '__readiness_regression_missing_color__',
           1
         ) resolved
        WHERE resolved.matched_by = 'color_mismatch'
     )
   LIMIT 1;

  IF v_group_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Grupo agnóstico % ainda foi resolvido como color_mismatch',
      v_group_name;
  END IF;
END;
$assert_insole_color_agnostic$;

COMMIT;
