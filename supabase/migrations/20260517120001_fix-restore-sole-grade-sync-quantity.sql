-- Fix: restore_sole_grade_for_order não atualizava `products.quantity` junto
-- com `stock_grade`. O trigger `check_grade_quantity_coherence` (BEFORE
-- UPDATE em products) exige SUM(stock_grade) == quantity e bloqueia o
-- UPDATE incoerente — qualquer cancel de OP com grade falhava com:
--   "Inconsistência: SUM(stock_grade) = N difere de quantity = M no produto …"
--
-- Bug existe desde a versão original (migration 20260419120147) e foi
-- propagado nas duas reaplicações posteriores (20260502231519 e
-- 20260521120000). Funções irmãs como `debit_sole_stock_by_grade` já
-- atualizam stock_grade + quantity juntos — só a restore_* esquecia.
--
-- Fix: adiciona `quantity = quantity + v_total_restored` no UPDATE para
-- manter o invariante. Sem backfill — dados em produção ainda estão
-- consistentes (o trigger sempre rejeitou antes de persistir).

DROP FUNCTION IF EXISTS public.restore_sole_grade_for_order(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(
  p_order_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref_id uuid;
  v_color text;
  v_grade jsonb;
  v_target_product_id uuid;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_total_restored numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT reference_id, color, grade
    INTO v_ref_id, v_color, v_grade
    FROM public.orders
   WHERE id = p_order_id;

  IF NOT FOUND OR v_grade IS NULL OR jsonb_typeof(v_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id INTO v_target_product_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = v_ref_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(v_color, '')))
   LIMIT 1;

  IF v_target_product_id IS NULL THEN
    SELECT p.id INTO v_target_product_id
      FROM public.products p
      JOIN public.technical_sheets ts ON ts.id = v_ref_id
     WHERE p.active = true
       AND (p.group_id = ts.sole_group_id OR ts.primary_sole_id = p.id)
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(p.color,''))) = UPPER(TRIM(COALESCE(v_color,'')))
            THEN 0 ELSE 1 END,
       p.updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_target_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT stock_grade INTO v_stock_grade
    FROM public.products WHERE id = v_target_product_id;

  v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(v_grade)
     WHERE value::numeric > 0
       -- Ignora metadata (_size_from, _size_to) — keys de tamanhos válidos
       -- são só numéricas. Sem o filtro, _size_from=34 entraria como qty 34
       -- no calculo, quebrando o invariante.
       AND NOT (key LIKE '\_%' ESCAPE '\')
  LOOP
    v_new_grade := jsonb_set(
      v_new_grade,
      ARRAY[v_size],
      to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty)
    );
    v_total_restored := v_total_restored + v_size_qty;
  END LOOP;

  IF v_total_restored > 0 THEN
    -- CRÍTICO: atualizar quantity junto com stock_grade. Sem isso, o
    -- trigger check_grade_quantity_coherence bloqueia o UPDATE.
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = COALESCE(quantity, 0) + v_total_restored,
           updated_at  = now()
     WHERE id = v_target_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid) TO authenticated;
