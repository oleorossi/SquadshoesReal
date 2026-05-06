CREATE OR REPLACE FUNCTION public.resolve_material_product(
  p_group_name text,
  p_color text,
  p_required numeric DEFAULT 0,
  p_check_stock boolean DEFAULT false
) RETURNS TABLE (
  product_id uuid,
  product_name text,
  available_qty numeric,
  matched_by text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 1. Match exato por cor
  IF p_color IS NOT NULL AND p_color <> '' THEN
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'exact_color'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND p.color = p_color
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 2. Match parcial no nome
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'partial_name'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%'
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3. Fallback: qualquer produto ativo do grupo (ordenado por estoque)
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
$$;