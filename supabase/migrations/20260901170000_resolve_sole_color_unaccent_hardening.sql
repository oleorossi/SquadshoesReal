-- ============================================================================
-- resolve_sole_color: hardening accent-insensitive (unaccent)
-- ============================================================================
-- resolve_material_product (20260627151423) e debit_strap_stock (20260524140000)
-- já casam cor accent-insensitive (lower(trim(unaccent(...)))). resolve_sole_color
-- só normalizava com UPPER(TRIM()), sem unaccent — uma cor de PV digitada "CAFÉ"
-- não batia com um registro salvo "CAFE" (ou vice-versa), fazendo a linha de
-- Solado (e o Fachete associado) sumir silenciosamente do consumo, sem erro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_sole_color(p_sheet_id uuid, p_product_color text)
 RETURNS TABLE(sole_product_id uuid, sole_color text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary_sole_id uuid;
  v_sole_group_id uuid;
  v_target_color text;
  v_input_color_upper text;
BEGIN
  v_input_color_upper := UPPER(TRIM(unaccent(COALESCE(p_product_color, ''))));

  -- ── PRIORIDADE 0 (novo, 2026-06-06): regra ativa em sole_color_conjugations
  -- ── pro grupo de solado da ficha técnica. Aplica em TODA classificação
  -- ── (tradicional, conjugado ou palmilha_pronta) — coligação cabedal→cor
  -- ── do solado é independente do tipo da palmilha.
  SELECT ts.sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;

  IF v_sole_group_id IS NOT NULL AND v_input_color_upper <> '' THEN
    v_target_color := NULL;

    -- 0.1: match exato cabedal_color (PRETO=PRETO), agora accent-insensitive
    SELECT palmilha_color INTO v_target_color
      FROM public.sole_color_conjugations
     WHERE sole_group_id = v_sole_group_id
       AND active = true
       AND UPPER(TRIM(unaccent(cabedal_color))) = v_input_color_upper
     LIMIT 1;

    -- 0.2: regra default (cabedal_color='*')
    IF v_target_color IS NULL THEN
      SELECT palmilha_color INTO v_target_color
        FROM public.sole_color_conjugations
       WHERE sole_group_id = v_sole_group_id
         AND active = true
         AND is_default = true
       LIMIT 1;
    END IF;

    IF v_target_color IS NOT NULL THEN
      RETURN QUERY
        SELECT p.id, p.color
          FROM public.products p
         WHERE p.group_id = v_sole_group_id
           AND p.active = true
           AND UPPER(TRIM(unaccent(COALESCE(p.color, '')))) = UPPER(TRIM(unaccent(v_target_color)))
         ORDER BY p.quantity DESC NULLS LAST, p.id
         LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  -- Prioridade 1: mapping explícito por sole_product_id (accent-insensitive)
  RETURN QUERY
  SELECT p.id, p.color
  FROM public.technical_sheet_sole_colors tsc
  JOIN public.products p ON p.id = tsc.sole_product_id
  WHERE tsc.sheet_id = p_sheet_id
    AND LOWER(unaccent(tsc.product_color)) = LOWER(unaccent(p_product_color))
    AND p.active = true
    AND tsc.sole_product_id IS NOT NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Prioridade 2: mapping antigo sem sole_product_id (só group_id) → maior estoque
  RETURN QUERY
  SELECT p.id, p.color
  FROM public.technical_sheet_sole_colors tsc
  JOIN public.products p ON p.group_id = tsc.sole_group_id AND p.active = true
  WHERE tsc.sheet_id = p_sheet_id
    AND LOWER(unaccent(tsc.product_color)) = LOWER(unaccent(p_product_color))
    AND tsc.sole_product_id IS NULL
  ORDER BY p.quantity DESC
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Prioridade 3: primary_sole_id da ficha técnica
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
