BEGIN;

-- ---------------------------------------------------------------------------
-- Composição final do diagnóstico operacional do PV.
--
-- A implementação criada em 20270101010500 continua sendo a fonte dos checks
-- de command boundary. Ela vira um core não exposto; o nome público permanece
-- estável e passa a compor também fiscal/financeiro, OP–estoque e Tiras.
-- O bloco aceita replay após aplicação parcial sem renomear o wrapper de volta.
-- ---------------------------------------------------------------------------

DO $rename_command_diagnostics_core$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.get_sale_order_command_diagnostics_core(uuid)'
     ) IS NULL THEN
    IF pg_catalog.to_regprocedure(
         'public.get_sale_order_command_diagnostics(uuid)'
       ) IS NULL THEN
      RAISE EXCEPTION
        'get_sale_order_command_diagnostics(uuid) ausente antes da composição'
        USING ERRCODE = '42883';
    END IF;

    ALTER FUNCTION public.get_sale_order_command_diagnostics(uuid)
      RENAME TO get_sale_order_command_diagnostics_core;
  END IF;
END;
$rename_command_diagnostics_core$;

-- ALTER FUNCTION preserva a ACL anterior. O core só pode ser atravessado pelo
-- wrapper SECURITY DEFINER, nunca chamado diretamente pela Data API.
REVOKE ALL ON FUNCTION public.get_sale_order_command_diagnostics_core(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  check_name text,
  category text,
  severity text,
  item_count bigint,
  sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- O core executa primeiro e preserva exatamente o gate de acesso original.
  RETURN QUERY
  SELECT *
    FROM public.get_sale_order_command_diagnostics_core(p_sale_order_id);

  -- Produção conserva command boundary + OP/estoque + Tiras, sem atravessar a
  -- fronteira fiscal/financeira reservada a Administração/Gerência.
  IF coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin', 'service_role')
     OR public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RETURN QUERY
    SELECT *
      FROM public.get_sale_order_billing_integrity_diagnostics(p_sale_order_id);
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.get_op_stock_integrity_diagnostics(p_sale_order_id);

  RETURN QUERY
  SELECT *
    FROM public.get_strap_flow_integrity_diagnostics(p_sale_order_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sale_order_command_diagnostics(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sale_order_command_diagnostics(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_command_diagnostics(uuid) IS
  'CheckRows consolidados de command boundary, fiscal/financeiro, OP–estoque e Tiras. NULL produz visão global; UUID restringe ao PV.';
COMMENT ON FUNCTION public.get_sale_order_command_diagnostics_core(uuid) IS
  'Core interno dos checks de command boundary da migration 20270101010500. Consumir somente pelo wrapper público consolidado.';

-- ---------------------------------------------------------------------------
-- Self-test live e somente-leitura: existência, shape, composição e ACL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_sale_order_integrity_composition_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_wrapper text;
  v_core text;
  v_expected_result constant text :=
    'TABLE(check_name text, category text, severity text, item_count bigint, sample text)';
BEGIN
  IF coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION
      'Contratos do diagnostico consolidado exigem Administracao/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  v_wrapper := pg_catalog.pg_get_functiondef(
    'public.get_sale_order_command_diagnostics(uuid)'::regprocedure
  );
  v_core := pg_catalog.pg_get_functiondef(
    'public.get_sale_order_command_diagnostics_core(uuid)'::regprocedure
  );

  RETURN QUERY SELECT
    'DIAG1 helpers existem com o rowset comum'::text,
    pg_catalog.to_regprocedure(
      'public.get_sale_order_billing_integrity_diagnostics(uuid)'
    ) IS NOT NULL
      AND pg_catalog.to_regprocedure(
        'public.get_op_stock_integrity_diagnostics(uuid)'
      ) IS NOT NULL
      AND pg_catalog.to_regprocedure(
        'public.get_strap_flow_integrity_diagnostics(uuid)'
      ) IS NOT NULL
      AND pg_catalog.pg_get_function_result(
        'public.get_sale_order_command_diagnostics(uuid)'::regprocedure
      ) = v_expected_result
      AND pg_catalog.pg_get_function_result(
        'public.get_sale_order_command_diagnostics_core(uuid)'::regprocedure
      ) = v_expected_result
      AND pg_catalog.pg_get_function_result(
        'public.get_sale_order_billing_integrity_diagnostics(uuid)'::regprocedure
      ) = v_expected_result
      AND pg_catalog.pg_get_function_result(
        'public.get_op_stock_integrity_diagnostics(uuid)'::regprocedure
      ) = v_expected_result
      AND pg_catalog.pg_get_function_result(
        'public.get_strap_flow_integrity_diagnostics(uuid)'::regprocedure
      ) = v_expected_result,
    'wrapper, core e três helpers precisam expor o mesmo CheckRow'::text;

  RETURN QUERY SELECT
    'DIAG2 wrapper compõe os quatro domínios'::text,
    position(
      'get_sale_order_command_diagnostics_core' IN v_wrapper
    ) > 0
      AND position(
        'get_sale_order_billing_integrity_diagnostics' IN v_wrapper
      ) > 0
      AND position(
        'get_op_stock_integrity_diagnostics' IN v_wrapper
      ) > 0
      AND position(
        'get_strap_flow_integrity_diagnostics' IN v_wrapper
      ) > 0
      AND position(
        'command_receipts_in_progress_stale' IN v_core
      ) > 0
      AND position(
        'material_plan_readiness_blocked' IN v_core
      ) > 0
      AND position(
        'active_ops_outdated_plan' IN v_core
      ) > 0
      AND position(
        'debit_delta_missing' IN v_core
      ) > 0
      AND position(
        'unsafe_stock_debit_overloads' IN v_core
      ) > 0
      AND position(
        'partial_promotion_enabled' IN v_core
      ) > 0,
    'wrapper deve compor core, fiscal, OP–estoque e Tiras sem perder checks antigos'::text;

  RETURN QUERY SELECT
    'DIAG3 ACL pública preservada e core interno'::text,
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_sale_order_command_diagnostics(uuid)',
      'EXECUTE'
    )
      AND pg_catalog.has_function_privilege(
        'service_role',
        'public.get_sale_order_command_diagnostics(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'public.get_sale_order_command_diagnostics(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_sale_order_command_diagnostics_core(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'public.get_sale_order_command_diagnostics_core(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'service_role',
        'public.get_sale_order_command_diagnostics_core(uuid)',
        'EXECUTE'
      ),
    'authenticated/service_role acessam só o wrapper; anon e chamadas diretas ao core ficam revogados'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_sale_order_integrity_composition_contract_tests()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_sale_order_integrity_composition_contract_tests()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.run_sale_order_integrity_composition_contract_tests() IS
  'Self-test read-only da existência, shape, composição e ACL do diagnóstico consolidado de PV.';

DO $self_test$
DECLARE
  v_failures text;
BEGIN
  SELECT pg_catalog.string_agg(t.case_name || ': ' || t.message, E'\n')
    INTO v_failures
    FROM public.run_sale_order_integrity_composition_contract_tests() t
   WHERE NOT t.ok;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato do diagnóstico consolidado falhou:%', E'\n' || v_failures
      USING ERRCODE = '23514';
  END IF;
END;
$self_test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
