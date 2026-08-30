-- Fibra/placa da palmilha NÃO varia por cor. A cor entra no forro que a reveste.
--
-- Doutrina do dono (2026-08-30): a fibra é o suporte; depois ela é forrada.
-- O motor ainda pedia a cor do pedido nesse grupo e devolvia color_mismatch
-- → toast "Cor do componente não está cadastrada" / "Material sem variação de cor".
--
-- Dois buracos:
-- 1. product_groups.is_color_agnostic não estava ligado nos grupos de placa/fibra.
-- 2. resolve_material_product (fallback linear e débito genérico) perdeu o
--    predicado is_color_agnostic na reescrita de 20260804. O resolver de palmilha
--    area-first foi consertado em 137; o genérico, não. Grupo sem SKU de área
--    (ou qualquer outro material-base) voltava a color_mismatch mesmo com a flag.
--
-- Forração da palmilha (setor e nomes de forro/revestimento) continua por cor.

BEGIN;

-- 1. Marca somente a estrutura da PALMILHA (fibra/placa/EVA/celulose) como
--    agnóstica a cor. O setor é parte obrigatória do predicado: materiais de
--    cabedal podem conter "EVA" no nome e ainda assim variar por cor.
--    Não toca forro, revestimento, napa, palmilha pronta nem outro setor.
UPDATE public.product_groups pg
   SET is_color_agnostic = true,
       is_bom_color_source = false
 WHERE NOT COALESCE(pg.is_color_agnostic, false)
   AND COALESCE(pg.is_family, false) = false
   AND COALESCE(pg.sector, '') = 'Palmilha'
   AND translate(lower(btrim(pg.name)),
         'áàâãäéèêëíìîïóòôõöúùûüç',
         'aaaaaeeeeiiiiooooouuuuc')
       !~ '(forr|revest|forro|lining|napa|pronta|pronto)'
   AND translate(lower(btrim(pg.name)),
         'áàâãäéèêëíìîïóòôõöúùûüç',
         'aaaaaeeeeiiiiooooouuuuc')
       ~ '(fibra|placa|\yeva\y|celulose|papelao|strobel|^palmilha$)';

-- Fail-closed: material estrutural fora da Palmilha com várias cores ativas
-- continua gerido por cor. Assim um cabedal composto cujo nome contém "EVA"
-- não pode ser desclassificado silenciosamente por uma ampliação futura.
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

COMMENT ON COLUMN public.product_groups.is_color_agnostic IS
  'Material-base sem cor (EVA, cola, fibra/placa da palmilha): consumo e débito resolvem pelo grupo, nunca color_mismatch. A cor da palmilha entra no forro que a reveste.';

-- 2. Restaura o predicado no resolver genérico (buraco desde 20260804).
CREATE OR REPLACE FUNCTION public.resolve_material_product(
  p_group_name text,
  p_color text,
  p_required numeric DEFAULT 0,
  p_check_stock boolean DEFAULT false
)
RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_color_norm text;
BEGIN
  IF p_color IS NOT NULL AND p_color <> '' THEN
    v_color_norm := lower(trim(unaccent(p_color)));

    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'exact_color'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND lower(trim(unaccent(COALESCE(p.color, '')))) = v_color_norm
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'partial_name'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND lower(unaccent(p.name)) LIKE '%' || v_color_norm || '%'
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Grupo gerido por cor: tem produto com cor E NÃO é agnóstico.
    -- Material-base (fibra/EVA/cola) cai em group_generic mesmo se algum SKU
    -- residual tiver cor preenchida.
    IF EXISTS (
      SELECT 1 FROM products p2
      JOIN product_groups pg2 ON pg2.id = p2.group_id
      WHERE p2.active = true AND pg2.name = p_group_name
        AND p2.color IS NOT NULL AND trim(p2.color) <> ''
        AND NOT COALESCE(pg2.is_color_agnostic, false)
    ) THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'color_mismatch'::text
      FROM products p
      JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = p_group_name
        AND (NOT p_check_stock OR p.quantity >= p_required)
      ORDER BY p.quantity DESC
      LIMIT 1;
    ELSE
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'group_generic'::text
      FROM products p
      JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = p_group_name
        AND (NOT p_check_stock OR p.quantity >= p_required)
      ORDER BY p.quantity DESC
      LIMIT 1;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.quantity, 'group_fallback'::text
  FROM products p
  JOIN product_groups pg ON pg.id = p.group_id
  WHERE p.active = true
    AND pg.name = p_group_name
    AND (NOT p_check_stock OR p.quantity >= p_required)
  ORDER BY p.quantity DESC
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.resolve_material_product(text, text, numeric, boolean) IS
  'Resolve SKU do grupo pela cor. Grupo is_color_agnostic nunca devolve color_mismatch — a cor do pedido não faz parte da identidade (fibra/EVA/cola).';

-- 3. Garante o mesmo predicado no resolver area-first da palmilha (137).
--    Recria o corpo canônico para não depender do replace frágil se 137 não
--    tiver rodado, ou se uma migration futura reescrever a função.
CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid,
  p_group_name text,
  p_color text,
  p_required numeric
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  available_qty numeric,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_gid uuid;
  v_gname text;
  v_effective_group text := p_group_name;
  v_variant_group boolean := false;
  v_has_area_product boolean := false;
  v_color_norm text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.insole_material_product_id, v.insole_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants v
     WHERE v.id = p_variant_id;

    IF v_pid IS NOT NULL THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p
       WHERE p.id = v_pid
         AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_gid IS NOT NULL THEN
      SELECT pg.name
        INTO v_gname
        FROM public.product_groups pg
       WHERE pg.id = v_gid;

      IF v_gname IS NOT NULL AND btrim(v_gname) <> '' THEN
        v_effective_group := v_gname;
        v_variant_group := true;
      END IF;
    END IF;
  END IF;

  IF v_effective_group IS NULL OR btrim(v_effective_group) = '' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
  ) INTO v_has_area_product;

  IF v_has_area_product THEN
    IF p_color IS NOT NULL
       AND btrim(p_color) <> ''
       AND btrim(p_color) <> '—' THEN
      v_color_norm := lower(btrim(extensions.unaccent(p_color)));

      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'exact_color'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(btrim(extensions.unaccent(COALESCE(p.color, '')))) = v_color_norm
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'partial_name'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(extensions.unaccent(p.name)) LIKE '%' || v_color_norm || '%'
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      IF EXISTS (
        SELECT 1
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
           AND p.color IS NOT NULL
           AND btrim(p.color) <> ''
           AND NOT COALESCE(pg.is_color_agnostic, false)
      ) THEN
        RETURN QUERY
        SELECT p.id, p.name, p.quantity, 'color_mismatch'::text
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      ELSE
        RETURN QUERY
        SELECT p.id, p.name, p.quantity,
               CASE WHEN v_variant_group
                 THEN 'variant_group'::text ELSE 'group_generic'::text END
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      END IF;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT p.id, p.name, p.quantity,
           CASE WHEN v_variant_group
             THEN 'variant_group'::text ELSE 'group_fallback'::text END
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
     ORDER BY p.quantity DESC
     LIMIT 1;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.product_id,
         r.product_name,
         r.available_qty,
         CASE
           WHEN v_variant_group AND r.matched_by <> 'color_mismatch'
             THEN 'variant_group'::text
           ELSE r.matched_by
         END
    FROM public.resolve_material_product(
      v_effective_group, p_color, p_required, false
    ) r;
END;
$function$;

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Resolve palmilha por pin, grupo da variante e grupo da ficha. Prefere SKU de área. Grupo is_color_agnostic (fibra/placa) resolve como group_generic, nunca color_mismatch — a cor entra no forro.';

-- 4. Guard: grupo agnóstico com SKU de área nunca devolve color_mismatch
--    para uma cor sentinela ausente.
DO $assert_insole_fiber_agnostic$
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
           '__fiber_regression_missing_color__',
           1
         ) resolved
        WHERE resolved.matched_by = 'color_mismatch'
     )
   LIMIT 1;

  IF v_group_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Grupo agnóstico % ainda foi resolvido como color_mismatch (fibra)',
      v_group_name;
  END IF;
END;
$assert_insole_fiber_agnostic$;

COMMIT;
