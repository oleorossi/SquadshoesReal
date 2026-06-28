-- ════════════════════════════════════════════════════════════════════════════
-- Material BASE sem cor (EVA/palmilha, cola): flag is_color_agnostic
-- ════════════════════════════════════════════════════════════════════════════
-- O guard "cor não cadastrada" marcava materiais-base (PLACA EVA, etc.) como
-- color_mismatch porque resolve_material_product decidia "grupo é por cor?" só
-- olhando se ALGUM produto do grupo tem cor — sem distinguir material-base de
-- material color-específico. Falso positivo que bloqueava a OC/PV.
--
-- Agora: grupo só é "gerenciado por cor" se tem produto com cor E NÃO é
-- is_color_agnostic. Grupo agnóstico → group_generic (NUNCA color_mismatch).
-- Conserta de uma vez: calculate_order_consumption → compute_materials_per_pv
-- (guard Compras por Pedido), hybrid_debit_stock_for_order (débito) e custeio/MRP.
-- (pedido do dono 2026-06-27; ver memória project_pv_color_guard_and_name_normalization)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.product_groups
  add column if not exists is_color_agnostic boolean not null default false;
comment on column public.product_groups.is_color_agnostic is
  'Material base sem cor (EVA, cola): consumo/débito resolvem por grupo, nunca color_mismatch.';

CREATE OR REPLACE FUNCTION public.resolve_material_product(p_group_name text, p_color text, p_required numeric DEFAULT 0, p_check_stock boolean DEFAULT false)
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

    -- Grupo só é "gerenciado por cor" se tem produto com cor E NÃO é agnóstico.
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
