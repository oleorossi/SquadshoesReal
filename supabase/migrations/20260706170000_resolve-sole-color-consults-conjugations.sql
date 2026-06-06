-- Faz resolve_sole_color consultar sole_color_conjugations independente da
-- classificação do solado.
--
-- Antes: a coligação cabedal→cor-do-solado SÓ era aplicada quando o solado
-- estava marcado como palmilha_pronta (gate em debit_sole_stock_by_grade).
-- Resultado visível no modal de Consumo do PV-00140 com SOLADO INFANTIL
-- (classification=tradicional): o consumo mostrava "Solado Solado Infantil"
-- com label da cor do cabedal (NUDE/OFF WHITE) em vez de resolver pra
-- CARAMELO conforme a regra default cadastrada em sole_color_conjugations.
--
-- Mudança: adiciona PRIORIDADE 0 em resolve_sole_color — se houver regra
-- ativa pro sole_group_id da ficha técnica casando com a cor do cabedal
-- (ou regra default *), retorna o produto desse grupo com a cor da regra.
-- Fluxo legacy (technical_sheet_sole_colors, primary_sole_id) continua
-- como fallback nas prioridades 1-3.
--
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-06-06.

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
  v_input_color_upper := UPPER(TRIM(COALESCE(p_product_color, '')));

  -- PRIORIDADE 0 (novo): regra ativa em sole_color_conjugations pro grupo
  -- de solado da ficha técnica. Aplica em TODA classificação.
  SELECT ts.sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;

  IF v_sole_group_id IS NOT NULL AND v_input_color_upper <> '' THEN
    v_target_color := NULL;

    -- 0.1: match exato cabedal_color
    SELECT palmilha_color INTO v_target_color
      FROM public.sole_color_conjugations
     WHERE sole_group_id = v_sole_group_id
       AND active = true
       AND UPPER(TRIM(cabedal_color)) = v_input_color_upper
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
           AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_target_color))
         ORDER BY p.quantity DESC NULLS LAST, p.id
         LIMIT 1;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  -- Prioridade 1: mapping explícito por sole_product_id
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

  -- Prioridade 2: mapping antigo sem sole_product_id (só group_id) → maior estoque
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
