-- =============================================================================
-- Paridade repo ↔ produção: calculate_order_consumption (escalar) é WRAPPER
-- =============================================================================
--
-- A versão VIVA em produção delega ao motor by_grade (grade sintética de 1
-- numeração) — é o contrato travado por run_consumption_parity_tests
-- (`escalar_delega_ao_bygrade`, `escalar_nao_duplica_conversao`). Porém a
-- última definição LITERAL commitada no repo era a implementação completa
-- antiga (20260702190000), que chama os resolvers com 4 args (sem pin da
-- ficha/grupo da variante) e aplica get_material_conversion_info por conta
-- própria. Num rebuild do zero a partir das migrations, o escalar REGREDIRIA
-- e os testes de paridade falhariam.
--
-- Esta migration commita o wrapper vivo VERBATIM (extraído de produção em
-- 2026-07-11 via pg_get_functiondef). Aplicar em produção é no-op.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_order_consumption(p_reference_id uuid, p_order_quantity numeric, p_color text, p_size integer DEFAULT NULL::integer, p_material_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_size  integer;
  v_grade jsonb;
BEGIN
  IF p_order_quantity IS NULL OR p_order_quantity <= 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_size := COALESCE(
    p_size,
    (SELECT reference_size FROM technical_sheets WHERE id = p_reference_id),
    37
  );

  v_grade := jsonb_build_object(v_size::text, p_order_quantity);

  RETURN public.calculate_order_consumption_by_grade(
    p_reference_id, v_grade, p_color, p_material_variant_id
  );
END;
$function$;

COMMENT ON FUNCTION public.calculate_order_consumption(uuid, numeric, text, integer, uuid) IS
  'Wrapper do motor canônico by_grade (grade sintética de 1 numeração). NÃO reimplementar cálculo aqui — paridade travada por run_consumption_parity_tests.';
