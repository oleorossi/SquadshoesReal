-- =============================================================================
-- AUDITORIA C1 (CRÍTICO): débito por grade ignora a quantidade real (~1/30)
-- =============================================================================
-- As OPs gravam a grade BASE (ex.: soma=12 "fichas") mas a quantidade real é
-- 360/264/300 (ratio 30×/22×/25×). O débito de material (hybrid_debit→by_grade) e
-- o débito de solado (debit_sole_stock_by_grade) usam a grade como vem → debitam
-- ~1/30 do físico. O custeio escala por qty_multiplier e fica correto → custo e
-- débito divergem ~30×.
--
-- Fonte única: escalar a grade para a QUANTIDADE REAL no ponto de débito.
-- Idempotente: scale_grade_to_total só escala quando soma(grade) < total
-- (callers que já passam grade escalada — ex.: SaleOrders.tsx:1176 — não são
-- afetados; OPs de 12 pares onde soma==qtd também não). Não toca o custeio.
-- =============================================================================

-- Helper: escala {numeração: pares} para somar exatamente p_total (largest-remainder).
-- Preserva chaves '_*' (metadados). Idempotente: retorna a grade intacta se a soma
-- das numerações já for >= p_total (ou inválida).
CREATE OR REPLACE FUNCTION public.scale_grade_to_total(p_grade jsonb, p_total numeric)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_sum numeric := 0; v_out jsonb := '{}'::jsonb; v_k text; v_v numeric;
  v_floor bigint; v_scaled_sum bigint := 0; v_diff integer; v_rec record;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' OR p_total IS NULL OR p_total <= 0 THEN
    RETURN p_grade;
  END IF;
  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_sum
    FROM jsonb_each_text(p_grade)
   WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$';
  -- só escala se a grade for "base" (soma menor que o total real); senão devolve intacta
  IF v_sum <= 0 OR v_sum >= p_total THEN
    RETURN p_grade;
  END IF;
  -- preserva chaves de metadados ('_*')
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_out
    FROM jsonb_each(p_grade) WHERE left(key, 1) = '_';
  -- piso de cada numeração
  FOR v_k, v_v IN
    SELECT key, (value)::numeric FROM jsonb_each_text(p_grade)
     WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$' AND (value)::numeric > 0
  LOOP
    v_floor := floor(v_v * p_total / v_sum)::bigint;
    v_out := jsonb_set(v_out, ARRAY[v_k], to_jsonb(v_floor));
    v_scaled_sum := v_scaled_sum + v_floor;
  END LOOP;
  -- distribui o resto pelas maiores frações (Hamilton/largest-remainder)
  v_diff := round(p_total)::integer - v_scaled_sum::integer;
  FOR v_rec IN
    SELECT key AS k,
           ((value)::numeric * p_total / v_sum) - floor((value)::numeric * p_total / v_sum) AS frac
      FROM jsonb_each_text(p_grade)
     WHERE left(key, 1) <> '_' AND value ~ '^[0-9.]+$' AND (value)::numeric > 0
     ORDER BY frac DESC, key
  LOOP
    EXIT WHEN v_diff <= 0;
    v_out := jsonb_set(v_out, ARRAY[v_rec.k], to_jsonb(COALESCE((v_out ->> v_rec.k)::bigint, 0) + 1));
    v_diff := v_diff - 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Patch cirúrgico em hybrid_debit_stock_for_order: escala a grade p/ p_order_quantity
-- antes de freeze/by_grade (via pg_get_functiondef + replace — sem recolar o corpo).
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure);
  src := replace(src, 'v_already_debited boolean;',
                      'v_already_debited boolean;' || chr(10) || '  v_eff_grade jsonb;');
  src := replace(src,
    'v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = ''object'');',
    'v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = ''object'');'
      || chr(10) || chr(10)
      || '  -- C1: escala a grade base p/ a quantidade real (idempotente; só escala se soma<qtd)' || chr(10)
      || '  v_eff_grade := CASE WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity) ELSE p_order_grade END;');
  src := replace(src, 'jsonb_each_text(p_order_grade)', 'jsonb_each_text(v_eff_grade)');
  src := replace(src, 'p_order_quantity, v_size, p_order_grade', 'p_order_quantity, v_size, v_eff_grade');
  src := replace(src, 'calculate_order_consumption_by_grade(p_reference_id, p_order_grade, p_color)',
                      'calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color)');
  EXECUTE src;
END $patch$;

-- Patch cirúrgico em debit_sole_stock_by_grade: escala a grade p/ orders.quantity.
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure);
  src := replace(src, 'numeric := 0;' || chr(10) || 'BEGIN',
                      'numeric := 0;' || chr(10) || '  v_input_grade jsonb;' || chr(10) || '  v_order_qty numeric;' || chr(10) || 'BEGIN');
  src := replace(src,
    'IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> ''object'' THEN RETURN; END IF;',
    'IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> ''object'' THEN RETURN; END IF;'
      || chr(10) || chr(10)
      || '  -- C1: escala a grade base p/ a quantidade real da OP (idempotente)' || chr(10)
      || '  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id;' || chr(10)
      || '  v_input_grade := public.scale_grade_to_total(p_order_grade, COALESCE(v_order_qty, 0));');
  src := replace(src, 'jsonb_each_text(p_order_grade)', 'jsonb_each_text(v_input_grade)');
  EXECUTE src;
END $patch$;
