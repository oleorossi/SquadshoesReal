-- ============================================================================
-- Reforço dos guards vivos do solado (pós-auditoria 2026-09-07)
-- ============================================================================
-- Acrescenta casos que o plano pedia e a 18000 só cobria estruturalmente:
--   - list_sole_spec_gaps() acionável em runtime
--   - by_grade emite 'Forração Palmilha' / 'Palmilha' / 'Fachete' com debit soft
--   - size sem spec + escalar 0 ⇒ Forração Palmilha required = 0 (não inventa)
-- Recria run_sole_live_parity_guards() por completo (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_sole_live_parity_guards()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_debit     text;
  v_bygrade   text;
  v_report    text;
  v_gaps      text;
  v_sheet     uuid;
  v_variant   uuid;
  v_size      text;
  v_gap_count integer;
  v_sole      uuid;
  v_cons      jsonb;
  v_required  numeric;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_debit
    FROM pg_proc
   WHERE proname = 'debit_sole_stock_by_grade'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc
   WHERE proname = 'calculate_order_consumption_by_grade'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_report
    FROM pg_proc
   WHERE proname = 'consumption_consistency_report'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_gaps
    FROM pg_proc
   WHERE proname = 'list_sole_spec_gaps'
     AND pronamespace = 'public'::regnamespace;

  case_name := 'debit_sole_existe';
  ok := v_debit IS NOT NULL;
  message := CASE WHEN ok THEN 'debit_sole_stock_by_grade presente'
                  ELSE 'debit_sole_stock_by_grade ausente' END;
  RETURN NEXT;

  case_name := 'debit_sole_fallback_ficha_com_variante';
  ok := v_debit IS NOT NULL
    AND v_debit ~* 'IF[[:space:]]+v_resolved_product_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN'
    AND v_debit !~* 'IF[[:space:]]+v_variant_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+AND[[:space:]]+v_resolved_product_id[[:space:]]+IS[[:space:]]+NULL';
  message := CASE WHEN ok
    THEN 'gate vivo = IF v_resolved_product_id IS NULL (pin vence; ausência cai na ficha)'
    ELSE 'REGRESSÃO: gate vivo ainda exige v_variant_id IS NULL AND … — solado some com variante sem pin'
  END;
  RETURN NEXT;

  case_name := 'bygrade_variante_nao_clobber_solado';
  ok := v_bygrade IS NOT NULL
    AND v_bygrade ILIKE '%COALESCE(v_variant_sole_pid, v_sole_product_id)%'
    AND position('v_sole_product_id := v_variant_sole_pid;' in v_bygrade) = 0;
  message := CASE WHEN ok
    THEN 'by_grade vivo usa COALESCE(v_variant_sole_pid, v_sole_product_id)'
    ELSE 'REGRESSÃO: by_grade pode clobberar solado com atribuição direta da variante'
  END;
  RETURN NEXT;

  case_name := 'list_sole_spec_gaps_existe';
  ok := v_gaps IS NOT NULL;
  message := CASE WHEN ok THEN 'list_sole_spec_gaps presente'
                  ELSE 'list_sole_spec_gaps ausente' END;
  RETURN NEXT;

  case_name := 'consistency_cobertura_por_numeracao';
  ok := v_report IS NOT NULL
    AND v_report ILIKE '%solado_sem_spec_na_faixa_vendida%'
    AND v_report ILIKE '%forro_palmilha_debita_zero%'
    AND v_report ILIKE '%list_sole_spec_gaps%';
  message := CASE WHEN ok
    THEN 'consumption_consistency_report cobre spec por numeração vendida'
    ELSE 'consistency report perdeu checks de cobertura de spec'
  END;
  RETURN NEXT;

  case_name := 'bygrade_emite_forracao_palmilha_e_palmilha';
  ok := v_bygrade IS NOT NULL
    AND v_bygrade LIKE '%''component'', ''Forração Palmilha''%'
    AND v_bygrade LIKE '%''component'', ''Palmilha''%'
    AND v_bygrade LIKE '%''debit_mode'', ''soft''%';
  message := CASE WHEN ok
    THEN 'by_grade emite Forração Palmilha + Palmilha em debit soft'
    ELSE 'by_grade perdeu emissão distinta de Forração Palmilha/Palmilha soft'
  END;
  RETURN NEXT;

  -- Smoke: by_grade com variante SEM sole_material_product_id — não pode explodir.
  SELECT v.id INTO v_variant
    FROM public.reference_material_variants v
   WHERE v.sole_material_product_id IS NULL
     AND COALESCE(v.active, true) = true
   ORDER BY v.id
   LIMIT 1;

  SELECT ts.id, COALESCE(ts.reference_size::text, '37')
    INTO v_sheet, v_size
    FROM public.technical_sheets ts
   WHERE ts.primary_sole_id IS NOT NULL
   ORDER BY ts.id
   LIMIT 1;

  case_name := 'runtime_bygrade_variante_sem_pin_solado';
  IF v_sheet IS NULL THEN
    ok := true;
    message := 'sem ficha com primary_sole — smoke pulado';
  ELSIF v_variant IS NULL THEN
    ok := true;
    message := 'sem variante sem pin de solado — smoke estrutural ok; runtime pulado';
  ELSE
    BEGIN
      v_cons := public.calculate_order_consumption_by_grade(
        v_sheet,
        jsonb_build_object(v_size, 1),
        '',
        v_variant
      );
      ok := v_cons IS NOT NULL;
      message := 'by_grade executa com variante sem pin de solado (read-only)';
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'by_grade QUEBRADO com variante sem pin: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;

  case_name := 'runtime_list_sole_spec_gaps_acionavel';
  BEGIN
    SELECT COUNT(*)::integer INTO v_gap_count
      FROM public.list_sole_spec_gaps();
    ok := true;
    message := format(
      'list_sole_spec_gaps() retornou %s linhas (alarme acionável; 0 = cobertura ok)',
      COALESCE(v_gap_count, 0)
    );
  EXCEPTION WHEN OTHERS THEN
    ok := false;
    message := 'list_sole_spec_gaps QUEBRADA: ' || SQLERRM;
  END;
  RETURN NEXT;

  -- Size sem spec: se existir ficha com primary_sole que TEM forro de palmilha
  -- cadastrado no solado em algum tamanho, mas NÃO no 25, e escalar da ficha = 0,
  -- by_grade com grade só no 25 deve exigir 0 de Forração Palmilha (não inventa).
  case_name := 'runtime_size_sem_spec_forro_palmilha_zero';
  v_sheet := NULL;
  v_sole := NULL;
  SELECT sts.sole_id INTO v_sole
    FROM public.sole_technical_specs sts
   WHERE COALESCE(sts.insole_lining_consumption_dm2, 0) > 0
     AND NOT EXISTS (
       SELECT 1
         FROM public.sole_technical_specs x
        WHERE x.sole_id = sts.sole_id
          AND x.size = 25
          AND COALESCE(x.insole_lining_consumption_dm2, 0) > 0
     )
   ORDER BY sts.sole_id
   LIMIT 1;

  IF v_sole IS NOT NULL THEN
    SELECT ts.id INTO v_sheet
      FROM public.technical_sheets ts
     WHERE ts.primary_sole_id = v_sole
       AND COALESCE(ts.insole_lining_consumption, 0) = 0
       AND (
         ts.insole_lining_consumption_per_size IS NULL
         OR ts.insole_lining_consumption_per_size = '{}'::jsonb
         OR COALESCE((ts.insole_lining_consumption_per_size ->> '25')::numeric, 0) = 0
       )
     ORDER BY ts.id
     LIMIT 1;
  END IF;

  IF v_sheet IS NULL THEN
    ok := true;
    message := 'sem ficha elegível (sole com forro+sem nº25 + escalar 0) — smoke pulado';
  ELSE
    BEGIN
      v_cons := public.calculate_order_consumption_by_grade(
        v_sheet,
        jsonb_build_object('25', 10),
        '',
        NULL
      );
      SELECT COALESCE(SUM(NULLIF(el->>'required', '')::numeric), 0)
        INTO v_required
        FROM jsonb_array_elements(COALESCE(v_cons, '[]'::jsonb)) el
       WHERE el->>'component' = 'Forração Palmilha';
      ok := COALESCE(v_required, 0) = 0;
      message := CASE WHEN ok
        THEN format('size 25 sem spec ⇒ Forração Palmilha required=0 (ficha %s)', v_sheet)
        ELSE format('REGRESSÃO: size sem spec inventou Forração Palmilha required=%s', v_required)
      END;
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'by_grade QUEBRADO no smoke size-sem-spec: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;

  case_name := 'restore_graded_nao_credita_escalar_cego';
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_debit
    FROM pg_proc
   WHERE proname = 'restore_product_stocks_for_order'
     AND pronamespace = 'public'::regnamespace;
  ok := v_debit IS NOT NULL
    AND (
      v_debit ILIKE '%residuo sem grade rastreavel%'
      OR v_debit ILIKE '%resíduo sem grade rastreável%'
      OR v_debit ILIKE '%op_restore_pending%'
      OR v_debit ILIKE '%nao credita residuo escalar%'
      OR v_debit ILIKE '%não credita resíduo escalar%'
    )
    AND v_debit NOT ILIKE '%residuo escalar de produto com grade; numeracao intacta%';
  message := CASE WHEN ok
    THEN 'restore_product_stocks_for_order não credita escalar cego em produto graduado'
    ELSE 'restore ainda credita resíduo escalar em produto com grade (quebra coerência)'
  END;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.run_sole_live_parity_guards() IS
  'Guards vivos do domínio solado: gate débito+variante, COALESCE by_grade, '
  'cobertura de spec, list_sole_spec_gaps acionável, size-sem-spec ⇒ forro 0, '
  'emissão Forração Palmilha/Palmilha soft, restore sem crédito escalar cego.';

GRANT EXECUTE ON FUNCTION public.run_sole_live_parity_guards() TO authenticated, service_role;
