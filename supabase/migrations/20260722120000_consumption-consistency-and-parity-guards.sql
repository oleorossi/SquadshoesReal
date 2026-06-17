-- Guardas PREVENTIVAS do cálculo de consumo (avaliação 2026-06-16).
--
-- Contexto: a auditoria confirmou que as divergências históricas entre o motor
-- frontend (TS, display/ficha) e o SQL (custeio/MRP) já foram FECHADAS em
-- produção (palmilha pronta unificada, fachete e conversão dm²→unidade nos dois
-- caminhos SQL). Não há bug ativo. Estas funções existem pra IMPEDIR REGRESSÃO
-- dessa harmonia e pra dar visibilidade proativa aos gaps de cadastro que
-- reintroduziriam consumo/custo errado.
--
-- Ambas são read-only (STABLE). Nada destrutivo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) DIAGNÓSTICO: consumption_consistency_report()
--    Surfaça, pra PCP/admin, os problemas de dados que quebram o cálculo de
--    consumo silenciosamente. Use em /diagnostics ou numa aba de saúde.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.consumption_consistency_report();
CREATE OR REPLACE FUNCTION public.consumption_consistency_report()
RETURNS TABLE (
  check_name  text,
  severity    text,
  item_count  integer,
  sample      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A) Material LINEAR (m/cm) usado em ficha mas SEM largura na ficha de
  --    componente → conversor dm²→metro devolve dm² cru (~100× inflado).
  RETURN QUERY
  SELECT 'material_linear_sem_largura'::text, 'alto'::text,
         COALESCE(count(*),0)::int,
         COALESCE(string_agg(product_name || ' ('||product_unit||')', ' · '
                  ORDER BY product_name), '—')
    FROM (SELECT * FROM public.list_materials_missing_width() LIMIT 200) m;

  -- B) Ficha marcada palmilha PRONTA mas com consumo de ÁREA de palmilha > 1
  --    (contradição: pronta deveria ser 1/par, sem placa). Sinal de cadastro
  --    inconsistente entre os campos que decidem "pronta".
  RETURN QUERY
  SELECT 'palmilha_pronta_com_consumo_area'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE ts.insole_ready_made = true
     AND COALESCE(ts.insole_consumption, 0) > 1;

  -- C) Ficha onde o solado dirige o consumo (sole_drives_consumption) mas o
  --    solado primário NÃO tem sole_technical_specs → cálculo cai na média
  --    escalar (source='fallback_average') sem o usuário perceber.
  RETURN QUERY
  SELECT 'solado_dirige_consumo_sem_specs'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE ts.sole_drives_consumption = true
     AND ts.primary_sole_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = ts.primary_sole_id
     );

  -- D) Solado FACHETADO sem consumo de fachete cadastrado por numeração → o
  --    componente "Fachete" sai com 0 (forro do salto não debita).
  RETURN QUERY
  SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text,
         count(*)::int,
         COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
   WHERE p.is_fachetado = true
     AND lower(COALESCE(p.category,'')) LIKE '%solado%'
     AND NOT EXISTS (
       SELECT 1 FROM public.sole_technical_specs sts
        WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consumption_consistency_report() TO authenticated;
COMMENT ON FUNCTION public.consumption_consistency_report() IS
  'Diagnóstico read-only dos gaps de cadastro que quebram o cálculo de consumo '
  '(largura faltando, palmilha pronta inconsistente, solado sem specs, fachete sem consumo).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) GUARD DE HARMONIZAÇÃO: run_consumption_parity_tests()
--    Trava o CONTRATO acordado entre os dois caminhos SQL de consumo (escalar e
--    by_grade). Se alguém redeployar uma versão antiga/divergente de qualquer
--    uma das funções, estes cases falham — pega a regressão no PR/CI antes de
--    virar custo/NF errado. (A paridade do lado TS é travada por
--    src/lib/__tests__/orderConsumption.test.ts.)
--    Introspecção de pg_get_functiondef: barato, determinístico, sem fixtures.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.run_consumption_parity_tests();
CREATE OR REPLACE FUNCTION public.run_consumption_parity_tests()
RETURNS TABLE (
  case_name text,
  ok        boolean,
  message   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scalar   text;
  v_bygrade  text;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_scalar
    FROM pg_proc WHERE proname = 'calculate_order_consumption' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc WHERE proname = 'calculate_order_consumption_by_grade' AND pronamespace = 'public'::regnamespace;

  case_name := 'escalar_existe';            ok := v_scalar IS NOT NULL;  message := COALESCE(left(v_scalar,0),'ausente'); RETURN NEXT;
  case_name := 'bygrade_existe';            ok := v_bygrade IS NOT NULL; message := COALESCE(left(v_bygrade,0),'ausente'); RETURN NEXT;

  -- Condição de palmilha pronta UNIFICADA (insole_ready_made OU sole_classification='palmilha_pronta'),
  -- e NÃO o legado insole_mode, nos DOIS caminhos.
  case_name := 'escalar_palmilha_pronta_unificada';
  ok := v_scalar ILIKE '%insole_ready_made%' AND v_scalar ILIKE '%palmilha_pronta%';
  message := 'escalar deve checar insole_ready_made + sole_classification'; RETURN NEXT;

  case_name := 'escalar_sem_insole_mode_legado';
  ok := v_scalar NOT ILIKE '%insole_mode%';
  message := 'escalar não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'bygrade_palmilha_pronta_unificada';
  ok := v_bygrade ILIKE '%insole_ready_made%' AND v_bygrade ILIKE '%palmilha_pronta%';
  message := 'by_grade deve checar insole_ready_made + sole_classification'; RETURN NEXT;

  case_name := 'bygrade_sem_insole_mode_legado';
  ok := v_bygrade NOT ILIKE '%insole_mode%';
  message := 'by_grade não deve usar o campo legado insole_mode'; RETURN NEXT;

  -- Conversão dm²→unidade física aplicada nos DOIS caminhos (senão custo infla ~100×).
  case_name := 'escalar_aplica_conversao';
  ok := v_scalar ILIKE '%get_material_conversion_info%';
  message := 'escalar deve converter dm²→unidade via get_material_conversion_info'; RETURN NEXT;

  case_name := 'bygrade_aplica_conversao';
  ok := v_bygrade ILIKE '%get_material_conversion_info%';
  message := 'by_grade deve converter dm²→unidade via get_material_conversion_info'; RETURN NEXT;

  -- Fachete presente no caminho graded (forro do salto fachetado).
  case_name := 'bygrade_inclui_fachete';
  ok := v_bygrade ILIKE '%fachete%';
  message := 'by_grade deve incluir o componente Fachete'; RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_consumption_parity_tests() TO authenticated;
COMMENT ON FUNCTION public.run_consumption_parity_tests() IS
  'Trava o contrato de harmonização entre calculate_order_consumption e '
  '..._by_grade (palmilha pronta unificada, sem insole_mode legado, conversão '
  'dm²→unidade nos dois, fachete no graded). Falha se uma versão divergente for '
  'deployada. Lado TS travado por orderConsumption.test.ts.';
