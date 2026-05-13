-- =============================================================================
-- 20260627125000 — convert_to_product_unit retorna NULL em incompatibilidade
-- =============================================================================
--
-- Bug B3 da auditoria: a função emite RAISE WARNING ao detectar unidades
-- incompatíveis (mass × length, etc.), mas DEVOLVE p_qty mesmo assim. Como
-- o warning vai pro log do Postgres (não pro UI nem pro breakdown), o custo
-- aleatório chegava ao Dashboard sem aviso ao operador.
--
-- Fix: retorna NULL em incompatibilidade. callers (calculate_order_cost_item
-- em 20260627123000) já tratam NULL pulando a linha e marcando
-- breakdown.conversion_warning='unit_mismatch' — UI pode renderizar alerta.

CREATE OR REPLACE FUNCTION public.convert_to_product_unit(
  p_qty numeric, p_source_unit text, p_target_unit text
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_src text := LOWER(TRIM(COALESCE(p_source_unit, '')));
  v_tgt text := LOWER(TRIM(COALESCE(p_target_unit, '')));
  v_src_kind text;
  v_tgt_kind text;
BEGIN
  IF p_qty IS NULL THEN RETURN 0; END IF;
  IF v_src = v_tgt OR v_src = '' OR v_tgt = '' THEN RETURN p_qty; END IF;

  -- mass (g/mg/kg)
  IF v_src = 'g'  AND v_tgt = 'kg' THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'mg' AND v_tgt = 'kg' THEN RETURN p_qty / 1000000; END IF;
  IF v_src = 'mg' AND v_tgt = 'g'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'g'  THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'mg' THEN RETURN p_qty * 1000000; END IF;
  IF v_src = 'g'  AND v_tgt = 'mg' THEN RETURN p_qty * 1000; END IF;

  -- volume (ml/L)
  IF v_src = 'ml' AND v_tgt = 'l'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'l'  AND v_tgt = 'ml' THEN RETURN p_qty * 1000; END IF;

  -- length (mm/cm/m)
  IF v_src = 'cm' AND v_tgt = 'm'  THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm'  AND v_tgt = 'cm' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'mm' AND v_tgt = 'm'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'm'  AND v_tgt = 'mm' THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'mm' AND v_tgt = 'cm' THEN RETURN p_qty / 10; END IF;
  IF v_src = 'cm' AND v_tgt = 'mm' THEN RETURN p_qty * 10; END IF;

  -- area
  IF v_src = 'dm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm²'  AND v_tgt = 'dm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'dm²' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'dm²' AND v_tgt = 'cm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 10000; END IF;
  IF v_src = 'm²'  AND v_tgt = 'cm²' THEN RETURN p_qty * 10000; END IF;
  IF v_src = 'mm²' AND v_tgt = 'cm²' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'mm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'mm²' AND v_tgt = 'dm²' THEN RETURN p_qty / 10000; END IF;
  IF v_src = 'mm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 1000000; END IF;

  -- count
  IF v_src = 'mil'   AND v_tgt = 'un'    THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'un'    AND v_tgt = 'mil'   THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'cento' AND v_tgt = 'un'    THEN RETURN p_qty * 100; END IF;
  IF v_src = 'un'    AND v_tgt = 'cento' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'dz'    AND v_tgt = 'un'    THEN RETURN p_qty * 12; END IF;
  IF v_src = 'un'    AND v_tgt = 'dz'    THEN RETURN p_qty / 12; END IF;
  IF v_src = 'cento' AND v_tgt = 'mil'   THEN RETURN p_qty / 10; END IF;
  IF v_src = 'mil'   AND v_tgt = 'cento' THEN RETURN p_qty * 10; END IF;

  v_src_kind := CASE
    WHEN v_src IN ('g','mg','kg')                THEN 'mass'
    WHEN v_src IN ('ml','l')                     THEN 'volume'
    WHEN v_src IN ('mm','cm','m')                THEN 'length'
    WHEN v_src IN ('mm²','cm²','dm²','m²')       THEN 'area'
    WHEN v_src IN ('un','mil','cento','dz','par') THEN 'count'
    ELSE 'unknown'
  END;
  v_tgt_kind := CASE
    WHEN v_tgt IN ('g','mg','kg')                THEN 'mass'
    WHEN v_tgt IN ('ml','l')                     THEN 'volume'
    WHEN v_tgt IN ('mm','cm','m')                THEN 'length'
    WHEN v_tgt IN ('mm²','cm²','dm²','m²')       THEN 'area'
    WHEN v_tgt IN ('un','mil','cento','dz','par') THEN 'count'
    ELSE 'unknown'
  END;

  -- B3: em vez de retornar p_qty cru, retorna NULL.
  -- Callers (calculate_order_cost_item) detectam NULL e pulam a linha com
  -- conversion_warning='unit_mismatch' no breakdown, em vez de inflar custo.
  IF v_src_kind <> v_tgt_kind AND v_src_kind <> 'unknown' AND v_tgt_kind <> 'unknown' THEN
    RAISE WARNING 'convert_to_product_unit: unidades incompatíveis (% [%] -> % [%]) — retornando NULL pra forçar tratamento explícito no caller.',
      p_source_unit, v_src_kind, p_target_unit, v_tgt_kind;
    RETURN NULL;
  END IF;

  -- Unidades não classificáveis (unknown) — devolve cru pra compatibilidade
  -- com cadastros não-padrão antigos.
  RETURN p_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_to_product_unit(numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.convert_to_product_unit(numeric, text, text) IS
  'Converte qty entre unidades compatíveis. A partir de 27/jun (B3): em '
  'unidades INCOMPATÍVEIS (ex: kg → un) retorna NULL — callers tratam como '
  'erro de cadastro com breakdown.conversion_warning. Antes retornava p_qty '
  'cru, escondendo bugs.';
