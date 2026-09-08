-- Fibra de palmilha: o Consumo Padrão do solado passa a poder pinuar o SKU
-- (além dos dm²). Precedência no resolver:
--   1. pin da variante (reference_material_variants.insole_material_product_id)
--   2. pin do solado (sole_group_standard_items.role='placa_palmilha'.material_product_id)
--   3. resolução por grupo da ficha/variante (comportamento legado)
--
-- Constraint antiga exigia material_product_id NULL em toda linha PAPEL —
-- relaxamos só o suficiente pra fibra opcionalmente carregar o SKU, sem
-- misturar com a UNIQUE dos ITENS (cola/linha/EVA).

BEGIN;

-- 1. PAPEL fibra pode ter material_product_id; demais PAPÉIS seguem null;
--    ITEM continua exigindo material e role null.
ALTER TABLE public.sole_group_standard_items
  DROP CONSTRAINT IF EXISTS sole_group_standard_items_kind;

ALTER TABLE public.sole_group_standard_items
  ADD CONSTRAINT sole_group_standard_items_kind CHECK (
    (role IS NULL AND material_product_id IS NOT NULL)
    OR (role IS NOT NULL AND role <> 'placa_palmilha' AND material_product_id IS NULL)
    OR (role = 'placa_palmilha')
  );

COMMENT ON COLUMN public.sole_group_standard_items.role IS
  'Preenchido = linha PAPEL. forro/forração/fachete: só quantidade (material da ficha/PV). placa_palmilha (fibra): quantidade + SKU opcional pinado no Consumo Padrão do solado. NULL = linha ITEM.';

-- UNIQUE de ITEM não pode colidir com o pin da fibra no mesmo produto.
ALTER TABLE public.sole_group_standard_items
  DROP CONSTRAINT IF EXISTS sole_group_standard_items_unique;

DROP INDEX IF EXISTS public.sole_group_standard_items_item_unique;
CREATE UNIQUE INDEX sole_group_standard_items_item_unique
  ON public.sole_group_standard_items (sole_group_id, material_product_id, applies_to)
  WHERE role IS NULL;

-- 2. Resolver: overload de 5 args com pin do solado. A assinatura de 4 args
--    permanece (wrapper) — contratos e callers legados continuam resolvendo.
CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid,
  p_group_name text,
  p_color text,
  p_required numeric,
  p_sole_group_id uuid
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
  v_sole_pin uuid;
BEGIN
  -- 1) Pin da variante vence tudo.
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

  -- 2) Pin do Consumo Padrão do solado (fibra).
  IF p_sole_group_id IS NOT NULL THEN
    SELECT sgsi.material_product_id
      INTO v_sole_pin
      FROM public.sole_group_standard_items sgsi
     WHERE sgsi.sole_group_id = p_sole_group_id
       AND sgsi.role = 'placa_palmilha'
       AND sgsi.material_product_id IS NOT NULL
     LIMIT 1;

    IF v_sole_pin IS NOT NULL THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'sole_group'::text
        FROM public.products p
       WHERE p.id = v_sole_pin
         AND p.active = true;
      IF FOUND THEN RETURN; END IF;
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

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric, uuid) IS
  'Resolve fibra/palmilha: pin variante > pin Consumo Padrão do solado (placa_palmilha) > grupo da ficha/variante. Prefere SKU de área. Grupo is_color_agnostic resolve como group_generic.';

-- Wrapper 4-args: preserva regprocedure legado; sem sole_group não aplica pin do solado.
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM public.resolve_insole_material_for_variant(
    p_variant_id, p_group_name, p_color, p_required, NULL::uuid
  );
$function$;

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Wrapper legado (4 args). Preferir a sobrecarga com p_sole_group_id para honrar o pin de fibra do Consumo Padrão.';

-- 3. Propaga o 5º arg nos callers que já têm v_sheet no escopo.
--    Só substitui chamadas de 4 args que ainda não passam sole_group.
DO $patch_callers$
DECLARE
  r record;
  src text;
  new_src text;
  sole_expr constant text :=
    'COALESCE(v_sheet.sole_group_id, (SELECT group_id FROM public.products WHERE id = v_sheet.primary_sole_id))';
  patched int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname <> 'resolve_insole_material_for_variant'
       AND pg_get_functiondef(p.oid) LIKE '%resolve_insole_material_for_variant(%'
       AND pg_get_functiondef(p.oid) LIKE '%v_sheet%'
  LOOP
    src := pg_get_functiondef(r.sig);
    -- Já passa 5 args (contém sole_group no call) — pula.
    IF src ~ 'resolve_insole_material_for_variant\([^)]*sole_group' THEN
      CONTINUE;
    END IF;

    new_src := regexp_replace(
      src,
      'resolve_insole_material_for_variant\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)\n]+)\)',
      'resolve_insole_material_for_variant(\1, \2, \3, \4, ' || sole_expr || ')',
      'g'
    );

    IF new_src IS DISTINCT FROM src THEN
      EXECUTE new_src;
      patched := patched + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'fibra-palmilha: % funções caller patchadas com sole_group_id', patched;
END
$patch_callers$;

COMMIT;
