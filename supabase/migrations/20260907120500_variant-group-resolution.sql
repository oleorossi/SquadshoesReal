-- =============================================================================
-- Variante de material por GRUPO — resolução no motor de consumo/custeio/débito
-- =============================================================================
--
-- Torna os 3 resolvers de componente cientes das colunas *_material_group_id
-- (mig 20260907120000). Esses helpers são o ÚNICO ponto de resolução usado por
-- calculate_order_consumption / _by_grade (mig 20260906120000) — e, por tabela,
-- pelo custeio (via consumo) e pelo débito (via snapshot record_order_consumption).
-- Patchar só os helpers propaga a regra por todo o motor.
--
-- PRECEDÊNCIA (por componente):
--   1. upper_material_product_id  (produto LEGADO fixado)  → 'variant'
--   2. upper_material_group_id     (GRUPO da variante)       → 'variant_group'
--        → resolve_material_product(nome_do_grupo, cor_do_PV)
--   3. p_sheet_pin_product_id      (pin da ficha, se ativo)  → 'sheet_pin'
--   4. grupo da ficha + cor        (comportamento base)      → matched_by original
--
-- Produto legado ANTES do grupo é DE PROPÓSITO: variantes antigas (que fixavam um
-- produto/cor específico) continuam resolvendo EXATAMENTE o mesmo produto — o
-- backfill de grupo (mig anterior) não altera consumo/custeio nelas. Variantes
-- NOVAS nascem com product_id NULL + group_id setado → caem no ramo do grupo.
--
-- Sem variante (p_variant_id NULL) o corpo é idêntico ao anterior.
-- Assinaturas preservadas: upper/lining = 5 args (com pin da ficha), insole = 4.
-- =============================================================================

-- ── Cabedal (5 args, com pin da ficha) ───────────────────────────────────────
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
    -- 1) produto legado da variante (precedência máxima — preserva variantes antigas)
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text FROM public.products p WHERE p.id = v_pid;
      RETURN;
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

-- ── Forração (5 args, com pin da ficha) ──────────────────────────────────────
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
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text FROM public.products p WHERE p.id = v_pid;
      RETURN;
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

-- ── Palmilha (4 args — sem pin de ficha) ─────────────────────────────────────
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
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text FROM public.products p WHERE p.id = v_pid;
      RETURN;
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

COMMENT ON FUNCTION public.resolve_upper_material_for_variant(uuid, text, text, numeric, uuid) IS
  'Resolve produto de cabedal. Precedência: variant.product_id > variant.group_id (por cor do PV) > pin da ficha > grupo da ficha.';
COMMENT ON FUNCTION public.resolve_lining_material_for_variant(uuid, text, text, numeric, uuid) IS
  'Resolve produto de forração. Precedência: variant.product_id > variant.group_id (por cor do PV) > pin da ficha > grupo da ficha.';
COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Resolve produto de palmilha. Precedência: variant.product_id > variant.group_id (por cor do PV) > grupo da ficha.';
