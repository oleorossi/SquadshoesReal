-- =============================================================================
-- Fix crítico: resolve_sole_color deve respeitar sole_product_id do mapping
-- =============================================================================
-- Antes: a função fazia JOIN só por group_id + ORDER BY quantity DESC.
-- Quando o grupo tinha 2 produtos (CARAMELO + PRETO) com estoques diferentes,
-- sempre retornava o com MAIOR estoque, ignorando o mapping em
-- technical_sheet_sole_colors.sole_product_id.
--
-- Impacto: cadastrar "cor PRETO do sapato → solado PRETO" não funcionava
-- na prática — o débito caía no solado CARAMELO porque tinha mais estoque.
-- Descoberto em 24/05/2026 durante auditoria pós-fix dos PVs 122-125.
--
-- Correção: 3 níveis de prioridade
--   1. Mapping com sole_product_id explícito (caminho moderno) → JOIN por id
--   2. Mapping legacy (só group_id, sole_product_id NULL) → maior estoque
--   3. Fallback primary_sole_id da ficha técnica
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_sole_color(p_sheet_id uuid, p_product_color text)
RETURNS TABLE(sole_product_id uuid, sole_color text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_primary_sole_id uuid;
BEGIN
  RETURN QUERY
  SELECT p.id, p.color
  FROM public.technical_sheet_sole_colors tsc
  JOIN public.products p ON p.id = tsc.sole_product_id
  WHERE tsc.sheet_id = p_sheet_id
    AND LOWER(tsc.product_color) = LOWER(p_product_color)
    AND p.active = true
    AND tsc.sole_product_id IS NOT NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT p.id, p.color
  FROM public.technical_sheet_sole_colors tsc
  JOIN public.products p ON p.group_id = tsc.sole_group_id AND p.active = true
  WHERE tsc.sheet_id = p_sheet_id
    AND LOWER(tsc.product_color) = LOWER(p_product_color)
    AND tsc.sole_product_id IS NULL
  ORDER BY p.quantity DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  SELECT ts.primary_sole_id INTO v_primary_sole_id
  FROM public.technical_sheets ts WHERE ts.id = p_sheet_id;

  IF v_primary_sole_id IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.color
    FROM public.products p
    WHERE p.id = v_primary_sole_id AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN;
END;
$function$;
