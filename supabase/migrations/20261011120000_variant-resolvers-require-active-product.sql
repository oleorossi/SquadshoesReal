-- =============================================================================
-- Variant resolvers: never resolve inactive fixed/pinned products
-- =============================================================================
-- The group resolver already requires products.active = true. Fixed products
-- pinned on a material variant must obey the same rule and continue down the
-- existing precedence chain when their SKU was deactivated.
--
-- Escopo do achado #9: os RESOLVERS de variante. NÃO reescrevemos
-- debit_sole_stock_by_grade — ela resolve o solado via resolve_sole_for_variant
-- (agora active-gated) e via resolve_sole_color; reescrever a função crítica só
-- pra um gate redundante perderia os comentários de auditoria (RES-7/DEB-7/
-- precedência de variante) sem ganho funcional.

CREATE OR REPLACE FUNCTION public.resolve_upper_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid DEFAULT NULL)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid; v_gid uuid; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT upper_material_product_id, upper_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants WHERE id = p_variant_id;
    -- 1) produto legado da variante
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;
    -- 2) grupo da variante → resolve por grupo + cor do PV
    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, 'variant_group'::text
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;
  -- 3) pin da ficha (se ativo)
  IF p_sheet_pin_product_id IS NOT NULL THEN
    RETURN QUERY SELECT p.id, p.name, p.quantity, 'sheet_pin'::text
      FROM public.products p WHERE p.id = p_sheet_pin_product_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- 4) grupo da ficha + cor
  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resolve_lining_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid DEFAULT NULL)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid; v_gid uuid; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT lining_material_product_id, lining_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants WHERE id = p_variant_id;
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;
    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, 'variant_group'::text
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;
  IF p_sheet_pin_product_id IS NOT NULL THEN
    RETURN QUERY SELECT p.id, p.name, p.quantity, 'sheet_pin'::text
      FROM public.products p WHERE p.id = p_sheet_pin_product_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid; v_gid uuid; v_gname text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT insole_material_product_id, insole_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants WHERE id = p_variant_id;
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p WHERE p.id = v_pid AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;
    IF v_gid IS NOT NULL THEN
      SELECT name INTO v_gname FROM public.product_groups WHERE id = v_gid;
      IF v_gname IS NOT NULL AND v_gname <> '' THEN
        RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, 'variant_group'::text
          FROM public.resolve_material_product(v_gname, p_color, p_required, false) r;
        RETURN;
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(p_group_name, p_color, p_required, false) r;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resolve_sole_for_variant(
  p_variant_id uuid)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid;
BEGIN
  IF p_variant_id IS NULL THEN RETURN; END IF;
  SELECT sole_material_product_id INTO v_pid
    FROM public.reference_material_variants WHERE id = p_variant_id;
  IF v_pid IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p.id, p.name, p.quantity
    FROM public.products p WHERE p.id = v_pid AND p.active = true;
END;
$fn$;
