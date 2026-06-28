-- Pin de SKU exato por componente na ficha técnica (Cabedal Material 1 + Forração).
-- Precedência de resolução: variante (reference_material_variants) > pin da ficha (NOVO)
-- > grupo+cor (resolve_material_product). O débito real (hybrid_debit_stock_for_order)
-- lê o product_id do snapshot → baixa o SKU fixado. Fachete NÃO recebe o pin (pode ser
-- grupo do solado). Auditoria 2026-06-28. Aplicada via Supabase MCP (Action quebrada).

-- A. Colunas + FKs (ON DELETE SET NULL → pin some se o produto for excluído; degrada seguro).
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS upper_material_product_id uuid,
  ADD COLUMN IF NOT EXISTS lining_material_product_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='technical_sheets_upper_material_product_id_fkey') THEN
    ALTER TABLE public.technical_sheets ADD CONSTRAINT technical_sheets_upper_material_product_id_fkey
      FOREIGN KEY (upper_material_product_id) REFERENCES public.products(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='technical_sheets_lining_material_product_id_fkey') THEN
    ALTER TABLE public.technical_sheets ADD CONSTRAINT technical_sheets_lining_material_product_id_fkey
      FOREIGN KEY (lining_material_product_id) REFERENCES public.products(id) ON DELETE SET NULL;
  END IF;
END $fk$;

COMMENT ON COLUMN public.technical_sheets.upper_material_product_id IS
  'Pin do SKU exato do Cabedal Material 1. Precedência: variante > este pin > grupo+cor. NULL = resolve por cor do PV.';
COMMENT ON COLUMN public.technical_sheets.lining_material_product_id IS
  'Pin do SKU exato da Forração Material 1. Idem precedência do upper.';

-- B1. Resolvers — overload de 5 args com o pin da ficha (variante > pin (ativo) > grupo+cor).
CREATE OR REPLACE FUNCTION public.resolve_upper_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid DEFAULT NULL)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT upper_material_product_id INTO v_pid FROM public.reference_material_variants WHERE id = p_variant_id;
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text FROM public.products p WHERE p.id = v_pid;
      RETURN;
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

CREATE OR REPLACE FUNCTION public.resolve_lining_material_for_variant(
  p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid DEFAULT NULL)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_pid uuid;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT lining_material_product_id INTO v_pid FROM public.reference_material_variants WHERE id = p_variant_id;
    IF v_pid IS NOT NULL THEN
      RETURN QUERY SELECT p.id, p.name, p.quantity, 'variant'::text FROM public.products p WHERE p.id = v_pid;
      RETURN;
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

-- B2/B3. Patch dos calc functions: passar o pin no Cabedal (v_sheet.upper_material) e na
-- Forração/insole (v_sheet.lining_material). Lê a fonte VIVA e faz REPLACE — idempotente
-- (pula se já aplicado) e aborta se o call-site base sumir (proteção contra drift).
DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  -- escalar
  v_src := pg_get_functiondef('public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure);
  IF position('v_required, v_sheet.upper_material_product_id)' in v_src) = 0 THEN
    v_new := replace(v_src,
      'resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, v_required)',
      'resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, v_required, v_sheet.upper_material_product_id)');
    v_new := replace(v_new,
      'resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, v_required)',
      'resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, v_required, v_sheet.lining_material_product_id)');
    IF v_new = v_src THEN RAISE EXCEPTION 'calc escalar: call-site do pin não encontrado — abortando'; END IF;
    EXECUTE v_new;
  END IF;

  -- by_grade (calls usam ", 0)")
  v_src := pg_get_functiondef('public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure);
  IF position('p_color, 0, v_sheet.upper_material_product_id)' in v_src) = 0 THEN
    v_new := replace(v_src,
      'resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0)',
      'resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id)');
    v_new := replace(v_new,
      'resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0)',
      'resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id)');
    IF v_new = v_src THEN RAISE EXCEPTION 'calc by_grade: call-site do pin não encontrado — abortando'; END IF;
    EXECUTE v_new;
  END IF;
END $mig$;
