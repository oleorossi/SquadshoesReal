-- Um preço-base comercial continua sendo útil para calcular o piso permitido,
-- mas não é requisito de prontidão quando o próprio item do PV já possui um
-- valor positivo. Antes desta correção, o preflight classificava os dois casos
-- abaixo com o mesmo blocker `item_price_missing`:
--
--   1. preço do item ausente/zerado;
--   2. preço do item positivo, mas sem tabela/variante/ficha para comparação.
--
-- Só o primeiro caso impede a confirmação. Quando existe base, a proteção de
-- preço abaixo do piso permanece intacta. Quando não existe, o valor explícito
-- do item é aceito e registrado como warning auditável.

BEGIN;

DO $patch_preflight_price_without_base$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_missing_base_condition constant text :=
    'OR COALESCE(ep.expected_price, 0) <= 0';
  v_old_manual_warning_filter constant text :=
    $old$AND COALESCE(ep.expected_price, 0) > 0
                 AND i.unit_price >= ep.expected_price * (
                   1 - LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ) / 100
                 ) - 0.01
                 AND abs(i.unit_price - ep.expected_price) > 0.01$old$;
  v_new_manual_warning_filter constant text :=
    $new$AND (
                   COALESCE(ep.expected_price, 0) <= 0
                   OR (
                     COALESCE(ep.expected_price, 0) > 0
                     AND i.unit_price >= ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ) - 0.01
                     AND abs(i.unit_price - ep.expected_price) > 0.01
                   )
                 )$new$;
  v_old_warning_code constant text :=
    $old$'code', 'item_manual_price',$old$;
  v_new_warning_code constant text :=
    $new$'code', CASE
                   WHEN COALESCE(ep.expected_price, 0) <= 0
                     THEN 'item_price_without_base'
                   ELSE 'item_manual_price'
                 END,$new$;
  v_old_warning_message constant text :=
    $old$'message', 'Preço manual aceito dentro do piso comercial.',$old$;
  v_new_warning_message constant text :=
    $new$'message', CASE
                   WHEN COALESCE(ep.expected_price, 0) <= 0
                     THEN 'Preço informado no item aceito sem preço-base cadastrado.'
                   ELSE 'Preço manual aceito dentro do piso comercial.'
                 END,$new$;
  v_old_missing_message constant text :=
    'Item sem preço-base comercial efetivo positivo.';
  v_new_missing_message constant text :=
    'Item sem preço de venda positivo.';
  v_old_list_warning constant text :=
    'Cliente/grupo sem lista efetiva; preço será resolvido por variante/ficha.';
  v_new_list_warning constant text :=
    'Cliente/grupo sem lista efetiva; será usada variante/ficha ou o valor positivo informado no item.';
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION
      'preflight_sale_order_command(uuid,text,bigint,uuid,jsonb) não encontrada';
  END IF;

  v_definition := pg_get_functiondef(v_function);

  -- Idempotência para ambientes onde o hotfix já tenha sido aplicado antes do
  -- ledger. Também rejeita uma aplicação parcial, em vez de mascarar drift.
  IF position('item_price_without_base' IN v_definition) > 0 THEN
    IF position(v_old_missing_base_condition IN v_definition) > 0
       OR position(v_old_manual_warning_filter IN v_definition) > 0
       OR position(v_old_warning_code IN v_definition) > 0
       OR position(v_old_warning_message IN v_definition) > 0
       OR position(v_old_missing_message IN v_definition) > 0
       OR position(v_old_list_warning IN v_definition) > 0
       OR position(v_new_warning_code IN v_definition) = 0
       OR position(v_new_warning_message IN v_definition) = 0
       OR position(v_new_missing_message IN v_definition) = 0
       OR position(v_new_list_warning IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Preflight contém patch parcial da aceitação de preço sem base';
    END IF;
    RETURN;
  END IF;

  v_occurrences := (
    length(v_definition)
    - length(replace(v_definition, v_old_missing_base_condition, ''))
  ) / length(v_old_missing_base_condition);
  IF v_occurrences <> 3 THEN
    RAISE EXCEPTION
      'Patch recusado: esperava 3 gates de base ausente no preflight, encontrou %',
      v_occurrences;
  END IF;

  v_occurrences := (
    length(v_definition)
    - length(replace(v_definition, v_old_manual_warning_filter, ''))
  ) / length(v_old_manual_warning_filter);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Patch recusado: esperava 1 filtro de warning com base, encontrou %',
      v_occurrences;
  END IF;

  FOR v_patched IN
    SELECT anchor
      FROM unnest(ARRAY[
        v_old_warning_code,
        v_old_warning_message,
        v_old_missing_message,
        v_old_list_warning
      ]) AS anchors(anchor)
  LOOP
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_patched, ''))
    ) / length(v_patched);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch recusado: âncora comercial esperada uma vez, encontrada %: %',
        v_occurrences,
        v_patched;
    END IF;
  END LOOP;

  v_patched := replace(
    v_definition,
    v_old_missing_base_condition,
    ''
  );
  v_patched := replace(
    v_patched,
    v_old_manual_warning_filter,
    v_new_manual_warning_filter
  );
  v_patched := replace(
    v_patched,
    v_old_warning_code,
    v_new_warning_code
  );
  v_patched := replace(
    v_patched,
    v_old_warning_message,
    v_new_warning_message
  );
  v_patched := replace(
    v_patched,
    v_old_missing_message,
    v_new_missing_message
  );
  v_patched := replace(
    v_patched,
    v_old_list_warning,
    v_new_list_warning
  );

  EXECUTE v_patched;
END;
$patch_preflight_price_without_base$;

-- O guard live da fundação ainda codificava a decisão antiga como
-- `v_missing_price_base_blocked`. Atualizá-lo junto evita um diagnóstico falso
-- depois que o preflight passar a aceitar o valor explícito do item.
DO $patch_sale_order_contract_guard$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.run_sale_order_command_contract_tests()'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    'v_missing_price_base_blocked boolean;';
  v_new_declaration constant text :=
    'v_positive_item_without_base_accepted boolean;';
  v_old_assignment constant text :=
    'v_missing_price_base_blocked := 0::numeric <= 0;';
  v_new_assignment constant text :=
    $new$v_positive_item_without_base_accepted := NOT (
    19.7::numeric <= 0
    OR (
      0::numeric > 0
      AND 19.7::numeric < 0::numeric * (1 - 10::numeric / 100) - 0.01
    )
  );$new$;
  v_old_assertion constant text :=
    'AND v_missing_price_base_blocked;';
  v_new_assertion constant text :=
    $new$AND v_positive_item_without_base_accepted
    AND position('item_price_without_base' IN v_preflight) > 0
    AND position(
      'OR COALESCE(ep.expected_price, 0) <= 0'
      IN v_preflight
    ) = 0;$new$;
  v_old_message constant text :=
    $old$THEN 'preço segue cadeia canônica e manual respeita piso/teto server-side'$old$;
  v_new_message constant text :=
    $new$THEN 'preço manual respeita piso; valor positivo sem base é aceito com aviso'$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'run_sale_order_command_contract_tests() não encontrada';
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position(v_new_declaration IN v_definition) > 0 THEN
    IF position(v_old_declaration IN v_definition) > 0
       OR position(v_old_assignment IN v_definition) > 0
       OR position(v_old_assertion IN v_definition) > 0
       OR position(v_old_message IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Guard comercial contém contrato novo e antigo ao mesmo tempo';
    END IF;
    RETURN;
  END IF;

  FOR v_patched IN
    SELECT anchor
      FROM unnest(ARRAY[
        v_old_declaration,
        v_old_assignment,
        v_old_assertion,
        v_old_message
      ]) AS anchors(anchor)
  LOOP
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_patched, ''))
    ) / length(v_patched);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch recusado no guard comercial: âncora encontrada % vez(es): %',
        v_occurrences,
        v_patched;
    END IF;
  END LOOP;

  v_patched := replace(v_definition, v_old_declaration, v_new_declaration);
  v_patched := replace(v_patched, v_old_assignment, v_new_assignment);
  v_patched := replace(v_patched, v_old_assertion, v_new_assertion);
  v_patched := replace(v_patched, v_old_message, v_new_message);
  EXECUTE v_patched;
END;
$patch_sale_order_contract_guard$;

-- Guard estrutural pós-patch. CREATE OR REPLACE precisa preservar a fronteira
-- SECURITY DEFINER/STABLE, o search_path fixo e os grants deliberados do RPC.
DO $assert_sale_order_price_without_base$
DECLARE
  v_preflight regprocedure := to_regprocedure(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'
  );
  v_contracts regprocedure := to_regprocedure(
    'public.run_sale_order_command_contract_tests()'
  );
  v_preflight_definition text;
  v_contract_definition text;
  v_security_definer boolean;
  v_stable boolean;
  v_search_path_fixed boolean;
BEGIN
  v_preflight_definition := pg_get_functiondef(v_preflight);
  v_contract_definition := pg_get_functiondef(v_contracts);

  IF position('item_price_without_base' IN v_preflight_definition) = 0
     OR position(
       'OR COALESCE(ep.expected_price, 0) <= 0'
       IN v_preflight_definition
     ) > 0
     OR position($needle$THEN 'item_price_missing'$needle$ IN v_preflight_definition) = 0
     OR position($needle$'item_price_below_floor'$needle$ IN v_preflight_definition) = 0
     OR position(
       'Preço informado no item aceito sem preço-base cadastrado.'
       IN v_preflight_definition
     ) = 0
     OR position(
       'será usada variante/ficha ou o valor positivo informado no item.'
       IN v_preflight_definition
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressão: contrato de preço do item sem base não ficou ativo';
  END IF;

  IF position(
       $needle$i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')$needle$
       IN v_preflight_definition
     ) = 0
     OR position(
       'COALESCE(i.unit_price, 0) <= 0'
       IN v_preflight_definition
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressão: item com preço zero ou não finito deixou de bloquear';
  END IF;

  IF position(
       'v_positive_item_without_base_accepted'
       IN v_contract_definition
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressão: guard live ainda exige preço-base para item positivo';
  END IF;

  SELECT
    p.prosecdef,
    p.provolatile = 's',
    COALESCE(p.proconfig, '{}'::text[])
      @> ARRAY['search_path=public']::text[]
    INTO v_security_definer, v_stable, v_search_path_fixed
    FROM pg_proc p
   WHERE p.oid = v_preflight;

  IF NOT v_security_definer OR NOT v_stable OR NOT v_search_path_fixed THEN
    RAISE EXCEPTION
      'Regressão: preflight perdeu SECURITY DEFINER/STABLE/search_path fixo';
  END IF;

  IF has_function_privilege('anon', v_preflight, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_preflight, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_preflight, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Regressão: ACL do preflight divergiu da fronteira autenticada';
  END IF;
END;
$assert_sale_order_price_without_base$;

COMMENT ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb) IS
  'Preflight canônico dos comandos do PV. Preço positivo informado no item é aceito sem preço-base; quando existe base, mantém validação de piso e desconto.';

COMMIT;
