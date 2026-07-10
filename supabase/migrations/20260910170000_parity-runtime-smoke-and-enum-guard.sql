-- =============================================================================
-- Paridade 15 → 18: guarda anti-coerção de enum + smokes de RUNTIME (2026-07-10)
-- Review pós-merge de b855bb7..bf3959c (pedido do usuário: "garantir que a
-- classe de erro não volte").
--
-- CLASSE DO ERRO: o 22P02 do debit_sole_stock_by_grade (fix 20260910160000)
-- entrou em produção porque (1) `COALESCE(enum_col, '')` compila e só explode
-- em RUNTIME, e (2) nada no CI EXECUTA as funções do motor — os cases de
-- paridade eram todos estruturais (ILIKE no fonte). A função ficou quebrada da
-- 20260902140000 até o fix sem nenhum sinal.
--
-- Blindagem (3 cases novos em run_consumption_parity_tests, que roda no CI
-- semanal via consumptionService.parity.test.ts E no botão de /diagnostics):
--   16. enum_sem_coercao_texto — varre TODAS as funções plpgsql de public
--       atrás de `COALESCE(col, …)` ou `col = ''` sobre colunas cujo nome é
--       EXCLUSIVAMENTE enum no schema (lista dinâmica via bool_and(typtype='e'):
--       hoje applies_to, current_stage, insole_mode, pickup_window,
--       sole_classification, tipo_pessoa, tipo_valor — enum novo entra sozinho;
--       nomes reusados como text, ex. status/stage/tipo/role, ficam fora pra
--       não gerar falso-positivo). Teria acusado o 22P02 na semana em que a
--       20260902140000 foi aplicada.
--   17. runtime_motor_consumo_executa — EXECUTA calculate_order_consumption_
--       by_grade numa ficha real (grade mínima, read-only). Pega qualquer
--       quebra de runtime do motor: enum, coluna dropada, search_path,
--       unaccent 42883 etc.
--   18. runtime_resolucao_solado_executa — EXECUTA resolve_sole_color +
--       get_material_conversion_info (cadeia usada pelo débito de solado).
--
-- Wrapper vitest continua assertando rows.length >= 13 (agora 18).
-- Aplicar via Supabase MCP ou workflow supabase-db-exec.yml.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.run_consumption_parity_tests()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scalar   text;
  v_bygrade  text;
  v_reserve  text;
  v_msg      text;
  v_smoke_sheet uuid;
  v_smoke_size  text;
  v_probe    uuid;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_scalar
    FROM pg_proc WHERE proname = 'calculate_order_consumption' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc WHERE proname = 'calculate_order_consumption_by_grade' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_reserve
    FROM pg_proc WHERE proname = 'try_reserve_materials' AND pronamespace = 'public'::regnamespace;

  case_name := 'escalar_existe';  ok := v_scalar IS NOT NULL;  message := COALESCE(left(v_scalar,0),'ausente'); RETURN NEXT;
  case_name := 'bygrade_existe';  ok := v_bygrade IS NOT NULL; message := COALESCE(left(v_bygrade,0),'ausente'); RETURN NEXT;

  case_name := 'escalar_delega_ao_bygrade';
  ok := v_scalar ILIKE '%calculate_order_consumption_by_grade%';
  message := 'escalar deve delegar ao motor único calculate_order_consumption_by_grade'; RETURN NEXT;

  case_name := 'escalar_sem_insole_mode_legado';
  ok := v_scalar NOT ILIKE '%insole_mode%';
  message := 'escalar não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'escalar_nao_duplica_conversao';
  ok := v_scalar NOT ILIKE '%get_material_conversion_info%';
  message := 'escalar não deve duplicar a conversão (deve herdar do by_grade)'; RETURN NEXT;

  case_name := 'bygrade_palmilha_pronta_unificada';
  ok := v_bygrade ILIKE '%insole_ready_made%' AND v_bygrade ILIKE '%palmilha_pronta%';
  message := 'by_grade deve checar insole_ready_made + sole_classification'; RETURN NEXT;

  case_name := 'bygrade_sem_insole_mode_legado';
  ok := v_bygrade NOT ILIKE '%insole_mode%';
  message := 'by_grade não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'bygrade_aplica_conversao';
  ok := v_bygrade ILIKE '%get_material_conversion_info%';
  message := 'by_grade deve converter dm²→unidade via get_material_conversion_info'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';
  ok := v_bygrade ILIKE '%fachete%';
  message := 'by_grade deve incluir o componente Fachete'; RETURN NEXT;

  -- Componentes por cor predominante (auditoria 2026-07-09)
  case_name := 'bygrade_gate_componentes_por_cor';
  ok := v_bygrade ILIKE '%component_colors_enabled%' AND v_bygrade ILIKE '%technical_sheet_component_colors%';
  message := 'by_grade deve aplicar a lista por cor predominante (source component_color)'; RETURN NEXT;

  case_name := 'bygrade_cor_predominante_normalizada';
  ok := v_bygrade ILIKE '%extensions.unaccent(tcc.cabedal_color)%';
  message := 'match de cor do gate deve ser accent/case-insensitive (extensions.unaccent)'; RETURN NEXT;

  -- Reserva deriva do motor unificado (refactor 2026-07-09)
  case_name := 'reserva_gate_componentes_por_cor';
  ok := v_reserve ILIKE '%calculate_order_consumption_by_grade%'
     OR (v_reserve ILIKE '%component_colors_enabled%' AND v_reserve ILIKE '%technical_sheet_component_colors%');
  message := 'reserva deve respeitar o gate por cor — por delegação ao motor unificado (ou gate próprio)'; RETURN NEXT;

  case_name := 'reserva_demanda_do_motor_unificado';
  ok := v_reserve ILIKE '%calculate_order_consumption_by_grade%'
    AND v_reserve NOT ILIKE '%direct_components%'
    AND v_reserve NOT ILIKE '%sheet_materials sm%';
  message := 'try_reserve deve derivar a demanda de calculate_order_consumption_by_grade, sem explosão própria de BOM/componentes'; RETURN NEXT;

  case_name := 'reserva_sem_specs_escalares';
  ok := v_reserve NOT ILIKE '%upper_consumption%' AND v_reserve NOT ILIKE '%lining_consumption%';
  message := 'try_reserve não deve reler consumos escalares da ficha (per-size mora no motor)'; RETURN NEXT;

  case_name := 'reserva_pula_color_mismatch';
  ok := v_reserve ILIKE '%color_mismatch%';
  message := 'try_reserve deve pular linha com cor não cadastrada (paridade com o débito)'; RETURN NEXT;

  -- ==========================================================================
  -- Blindagem 22P02 (review 2026-07-10) — cases 16–18
  -- ==========================================================================

  -- 16. Nenhuma função plpgsql pode COALESCE/comparar coluna enum com texto
  --     sem ::text (foi exatamente isso que quebrou o debit_sole por semanas).
  case_name := 'enum_sem_coercao_texto';
  SELECT COALESCE(string_agg(off.proname || '(' || off.attname || ')', ', ' ORDER BY off.proname), '')
    INTO v_msg
    FROM (
      WITH enum_only AS (
        SELECT a.attname
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_type t ON t.oid = a.atttypid
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
         GROUP BY a.attname
        HAVING bool_and(t.typtype = 'e')
      ), fns AS (
        SELECT p.proname, pg_get_functiondef(p.oid) AS def
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
           AND p.proname <> 'run_consumption_parity_tests'
      )
      SELECT DISTINCT f.proname, e.attname
        FROM fns f
        JOIN enum_only e
          ON f.def ~* ('coalesce\(\s*([a-z_]+\.)?' || e.attname || '\s*,')
          OR f.def ~* (e.attname || '\s*=\s*''''')
    ) off;
  ok := v_msg = '';
  message := CASE WHEN v_msg = ''
    THEN 'nenhuma função COALESCE/compara coluna enum com texto sem ::text (classe do 22P02 do debit_sole)'
    ELSE 'coerção enum↔texto sem ::text (classe do 22P02) em: ' || v_msg END;
  RETURN NEXT;

  -- Ficha do smoke: prioriza a de componentes-por-cor (exercita o gate).
  SELECT ts.id, COALESCE(ts.reference_size::text, '37')
    INTO v_smoke_sheet, v_smoke_size
    FROM technical_sheets ts
   ORDER BY (ts.component_colors_enabled IS NOT TRUE), ts.id
   LIMIT 1;

  -- 17. O motor de consumo tem que EXECUTAR sem erro (cases estruturais não
  --     pegam quebra de runtime: enum, coluna dropada, search_path, unaccent).
  case_name := 'runtime_motor_consumo_executa';
  IF v_smoke_sheet IS NULL THEN
    ok := true; message := 'sem ficha técnica pra smoke — pulado';
  ELSE
    BEGIN
      PERFORM public.calculate_order_consumption_by_grade(
        v_smoke_sheet, jsonb_build_object(v_smoke_size, 1), '', NULL);
      ok := true;
      message := 'calculate_order_consumption_by_grade executa sem erro (smoke em ficha real, read-only)';
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'motor de consumo QUEBRADO em runtime: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;

  -- 18. Cadeia de resolução do solado (usada pelo débito por numeração) tem
  --     que EXECUTAR sem erro — foi onde o 22P02 morou.
  case_name := 'runtime_resolucao_solado_executa';
  IF v_smoke_sheet IS NULL THEN
    ok := true; message := 'sem ficha técnica pra smoke — pulado';
  ELSE
    BEGIN
      PERFORM 1 FROM public.resolve_sole_color(v_smoke_sheet, '');
      SELECT p.id INTO v_probe FROM products p WHERE p.active = true ORDER BY p.id LIMIT 1;
      IF v_probe IS NOT NULL THEN
        PERFORM 1 FROM public.get_material_conversion_info(v_probe);
      END IF;
      ok := true;
      message := 'resolve_sole_color + get_material_conversion_info executam sem erro (read-only)';
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'resolução de solado/conversão QUEBRADA em runtime: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;
END;
$function$;
