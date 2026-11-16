-- =============================================================================
-- check_stock_availability: grade-base do PV vira pares absolutos no by_grade
-- =============================================================================
-- Marcador: check_stock_escala_grade_base_470
--
-- A RPC da aprovação / auto-OC delega cabedal/forro/palmilha/fachete/item
-- padrão a calculate_order_consumption_by_grade com p_order_grade cru.
-- sale_order_items.grade é a grade BASE da ficha (Σ ≈ 12) e quantity é o
-- total de pares (× fichas). by_grade soma os números como pares absolutos,
-- então um PV de 720 pares (60 fichas) pedia palmilha de 12 pares.
--
-- Tiras desta RPC já faziam v_fichas = quantity / Σgrade. A migração
-- 20270101045900 passou a escalar as LINHAS ADICIONAIS do BOM. O cabeçalho
-- via by_grade ficou para trás — badge "Estoque OK" e auto-OC subcontados
-- (família PV-00145: 12 vs 1104).
--
-- Fix: a delegação usa resolve_effective_op_grade (scale_grade_to_total),
-- a mesma função do débito/MRP/consumptionService. Grade já absoluta
-- (Σ >= quantity) sai intacta. Tiras e linhas adicionais continuam com o
-- p_order_grade cru + v_fichas — se o caller já escalou (useOrders),
-- v_fichas = 1 e não há dupla escala.
-- =============================================================================

DO $patch_check_stock_grade$
DECLARE
  v_fn regprocedure := to_regprocedure(
    'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'
  );
  v_def text;
  v_patched text;
  v_hits integer;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION
      'Preflight: check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid) ausente';
  END IF;

  IF to_regprocedure('public.resolve_effective_op_grade(jsonb,numeric)') IS NULL THEN
    RAISE EXCEPTION
      'Preflight: resolve_effective_op_grade(jsonb,numeric) ausente';
  END IF;

  v_def := pg_get_functiondef(v_fn);

  IF position(
       'resolve_effective_op_grade(p_order_grade, p_order_quantity)'
       IN v_def
     ) > 0 THEN
    RAISE NOTICE 'check_stock_availability já escala grade-base — skip';
    RETURN;
  END IF;

  v_patched := regexp_replace(
    v_def,
    'calculate_order_consumption_by_grade\(\s*p_reference_id,\s*p_order_grade,',
    'calculate_order_consumption_by_grade(p_reference_id, COALESCE(public.resolve_effective_op_grade(p_order_grade, p_order_quantity), p_order_grade),',
    'g'
  );

  IF v_patched = v_def THEN
    RAISE EXCEPTION
      'check_stock_availability: âncora by_grade(p_order_grade) não encontrada';
  END IF;

  SELECT count(*) INTO v_hits
    FROM regexp_matches(
      v_def,
      'calculate_order_consumption_by_grade\(\s*p_reference_id,\s*p_order_grade,',
      'g'
    );
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'check_stock_availability: esperava 1 âncora by_grade+p_order_grade, encontrou %',
      coalesce(v_hits, 0);
  END IF;

  EXECUTE v_patched;

  v_def := pg_get_functiondef(v_fn);
  IF position(
       'resolve_effective_op_grade(p_order_grade, p_order_quantity)'
       IN v_def
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressão: check_stock_availability não escala grade-base via resolve_effective_op_grade';
  END IF;
END
$patch_check_stock_grade$;

-- CREATE OR REPLACE via pg_get_functiondef preserva ACL; reassertamos a
-- fronteira viva de 46100: authenticated/service_role, nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  TO authenticated, service_role;
