-- Remove o blocker credit_limit_exceeded do preflight do PV (confirm/promote).
-- Decisão do dono: verificação de limite de crédito não é usada.
-- A trava do formulário (FE) sai no mesmo PR; cadastro do campo e a NF-e
-- avulsa (preflight_standalone_nfe_emission) ficam intactos.
--
-- Patch cirúrgico via pg_get_functiondef — não recria execute_sale_order_command.

BEGIN;

DO $patch_preflight_drop_credit_limit$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_block constant text :=
$old$IF COALESCE(v_commercial.credit_limit, 0) > 0 THEN
          IF v_client.economic_group_id IS NOT NULL THEN
            SELECT egc.credit_available
              INTO v_available_credit
              FROM public.v_economic_group_credit egc
             WHERE egc.economic_group_id = v_client.economic_group_id;
          ELSE
            SELECT ce.available_credit
              INTO v_available_credit
              FROM public.v_client_credit_exposure ce
             WHERE ce.client_id = v_so.client_id;
          END IF;

          IF v_calculated_total > COALESCE(v_available_credit, 0) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'credit_limit_exceeded',
              'scope', 'commercial',
              'message', 'Valor do PV excede o crédito disponível canônico.',
              'details', jsonb_build_object(
                'sale_order_total', v_calculated_total,
                'available_credit', COALESCE(v_available_credit, 0),
                'economic_group_id', v_client.economic_group_id
              ),
              'overridable', true
            ));
          END IF;
        END IF;
$old$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION
      'preflight_sale_order_command(uuid,text,bigint,uuid,jsonb) não encontrada';
  END IF;

  v_definition := pg_get_functiondef(v_function);

  -- Já aplicado: corpo vivo sem o blocker.
  IF position('credit_limit_exceeded' IN v_definition) = 0 THEN
    IF position(v_old_block IN v_definition) > 0 THEN
      RAISE EXCEPTION
        'Preflight sem credit_limit_exceeded mas ainda contém o bloco antigo';
    END IF;
    RETURN;
  END IF;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_block, ''))
  ) / length(v_old_block);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Patch recusado: esperava 1 bloco de limite de crédito no preflight do PV, encontrou %',
      v_occurrences;
  END IF;

  -- Não tocar na NF-e avulsa (função separada).
  IF position(
    'preflight_standalone_nfe_emission'
    IN v_definition
  ) > 0 THEN
    RAISE EXCEPTION
      'Definição inesperada: preflight do PV não deve citar NF-e avulsa';
  END IF;

  v_patched := replace(v_definition, v_old_block, '');

  IF position('credit_limit_exceeded' IN v_patched) > 0 THEN
    RAISE EXCEPTION
      'Patch incompleto: credit_limit_exceeded ainda presente após remoção';
  END IF;

  EXECUTE v_patched;
END;
$patch_preflight_drop_credit_limit$;

COMMIT;
