-- ═══════════════════════════════════════════════════════════════════════════
-- Remoção da forração multi-grupo + débito aditivo órfão + paridade pick-one
-- (análise completa 2026-07-11, workflow wf_cccda628 — 3 agentes + queries)
--
-- CONTEXTO / VEREDITO DO DONO: "não existe referência com forração multi
-- grupo" — 1 ficha = 1 grupo de forração. Vários materiais = VARIAÇÕES DE
-- MATERIAL (reference_material_variants), nunca grupos extras de forro.
--
-- 1) technical_sheets.lining_materials (array multi-grupo, F1 da mig
--    20260628140000): meia-feature — F3 (consumo) / F4 (reserva-débito) / F5
--    (recalc) nunca implementadas. ZERO funções/views leem; ZERO fichas com
--    dados (5 com `[]` gravado pelo save do editor). Único consumidor era o
--    pool de cores do PV (frontend) — oferecia cores que nenhum motor
--    consome/reserva/debita. UI removida no mesmo commit → DROP.
-- 2) sale_order_items.lining_colors (F1 idem): nunca preenchida por nenhum
--    form; pré-requisito de F3/F4 que não existem → DROP.
-- 3) debit_stock_for_order (3 overloads órfãos): o de 4 args ainda era
--    ADITIVO no forro (debitava lining_material escalar + TODOS os
--    lining_accessories, sem group_covers_color, sem conversão dm²→física) —
--    semântica pré-fix 20260707120000. Zero callers no banco (regex exclui o
--    falso positivo hybrid_debit_stock_for_order) e zero .rpc() no frontend.
--    Se invocada manualmente, inflaria o débito de forro → DROP dos 3.
-- 4) run_consumption_parity_tests: +2 cases travando o contrato PICK-ONE do
--    forro alternativo (a mig 20260707120000 não tinha guarda — uma regressão
--    pra semântica aditiva passaria em silêncio). Cases 19 (string) e 20
--    (runtime com ficha real, read-only).
--
-- ⚠ ORDEM DE APLICAÇÃO: só aplicar DEPOIS do deploy do frontend que remove
--   os SELECT/UPDATE de lining_materials (senão sheet_specs_for_colors e o
--   save da ficha quebram com 42703 até o deploy chegar).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1+2) Colunas mortas da meia-feature multi-grupo
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS lining_materials;
ALTER TABLE public.sale_order_items DROP COLUMN IF EXISTS lining_colors;

-- 3) Overloads órfãos do débito legado (o de 4 args era aditivo no forro)
DROP FUNCTION IF EXISTS public.debit_stock_for_order(uuid, integer);
DROP FUNCTION IF EXISTS public.debit_stock_for_order(uuid, integer, text);
DROP FUNCTION IF EXISTS public.debit_stock_for_order(uuid, integer, text, uuid);

-- 4) Paridade: 18 → 20 cases (pick-one do forro alternativo)
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
  v_alt_sheet uuid;
  v_alt_color text;
  v_alt_size  text;
  v_forro_lines int;
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

  case_name := 'bygrade_gate_componentes_por_cor';
  ok := v_bygrade ILIKE '%component_colors_enabled%' AND v_bygrade ILIKE '%technical_sheet_component_colors%';
  message := 'by_grade deve aplicar a lista por cor predominante (source component_color)'; RETURN NEXT;

  case_name := 'bygrade_cor_predominante_normalizada';
  ok := v_bygrade ILIKE '%extensions.unaccent(tcc.cabedal_color)%';
  message := 'match de cor do gate deve ser accent/case-insensitive (extensions.unaccent)'; RETURN NEXT;

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

  -- Forro alternativo (lining_accessories) = PICK-ONE, nunca aditivo — case 16
  -- (fix da mig 20260707120000; regressão aditiva já custou 16 PVs com margem
  --  <−50% na era pré-fix — mig 20260524250000)
  case_name := 'bygrade_forro_alternativa_pick_one';
  ok := v_bygrade ILIKE '%lining_accessories%'
    AND v_bygrade ILIKE '%group_covers_color%'
    AND v_bygrade ILIKE '%lining_alt%';
  message := 'by_grade deve resolver forro alternativo como PICK-ONE (lining_accessories + group_covers_color + source lining_alt)'; RETURN NEXT;

  -- Blindagem 22P02 (review 2026-07-10)
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

  SELECT ts.id, COALESCE(ts.reference_size::text, '37')
    INTO v_smoke_sheet, v_smoke_size
    FROM technical_sheets ts
   ORDER BY (ts.component_colors_enabled IS NOT TRUE), ts.id
   LIMIT 1;

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

  -- Runtime PICK-ONE: ficha real com escalar + alternativas, cor coberta SÓ
  -- pela alternativa → o motor deve emitir NO MÁXIMO 1 linha 'Forração'
  -- (a regressão aditiva emitia escalar + N alternativas). Read-only.
  case_name := 'runtime_forro_pick_one_unico';
  SELECT ts.id, p.color, COALESCE(ts.reference_size::text, '37')
    INTO v_alt_sheet, v_alt_color, v_alt_size
    FROM technical_sheets ts
   CROSS JOIN LATERAL (
      SELECT e->>'material' AS alt
        FROM jsonb_array_elements(ts.lining_accessories) e
       WHERE COALESCE(e->>'material','') <> ''
         AND COALESCE((e->>'consumption')::numeric, 0) > 0
    ) a
    JOIN product_groups g ON lower(trim(g.name)) = lower(trim(a.alt))
    JOIN products p ON p.group_id = g.id AND COALESCE(p.color,'') <> ''
   WHERE jsonb_typeof(ts.lining_accessories) = 'array'
     AND jsonb_array_length(ts.lining_accessories) > 0
     AND COALESCE(ts.lining_material,'') <> ''
     AND public.group_covers_color(a.alt, p.color)
     AND NOT public.group_covers_color(ts.lining_material, p.color)
   LIMIT 1;
  IF v_alt_sheet IS NULL THEN
    ok := true; message := 'sem ficha com alternativa cobrindo cor fora do escalar — pulado';
  ELSE
    BEGIN
      SELECT count(*) INTO v_forro_lines
        FROM jsonb_array_elements(public.calculate_order_consumption_by_grade(
               v_alt_sheet, jsonb_build_object(v_alt_size, 1), v_alt_color, NULL)) el
       WHERE el->>'component' = 'Forração';
      ok := v_forro_lines <= 1;
      message := CASE WHEN v_forro_lines <= 1
        THEN 'pick-one ok: ' || v_forro_lines || ' linha(s) de Forração pra cor ' || v_alt_color
        ELSE 'REGRESSÃO ADITIVA: ' || v_forro_lines || ' linhas de Forração pra cor ' || v_alt_color END;
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'runtime pick-one quebrou: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.run_consumption_parity_tests() IS
  'Trava o contrato do motor de consumo (20 cases): delegação escalar→by_grade, palmilha pronta unificada, conversão dm²→física, fachete, gate por cor predominante, try_reserve derivado do motor, blindagem enum 22P02, smokes de runtime e PICK-ONE do forro alternativo (nunca aditivo). Wrapper vitest: consumptionService.parity.test.ts (RUN_DB_INTEGRATION).';
