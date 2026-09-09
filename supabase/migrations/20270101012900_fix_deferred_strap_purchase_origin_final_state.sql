-- A constraint diferida da origem canônica precisa validar o estado FINAL do
-- item. Durante uma reconciliação o materializador pode atualizar um item e,
-- ainda na mesma transação, removê-lo/recriá-lo em outro bucket. O evento
-- diferido conserva NEW do UPDATE antigo; consultar a OC por esse snapshot e o
-- helper pelo UUID já removido produz um falso positivo no COMMIT.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_assert_strap_purchase_order_item_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- A linha atual é a âncora da prova. Um evento diferido cujo item já não
  -- existe é apenas um tombstone intermediário; itens sobreviventes de OC de
  -- tira continuam obrigados a provar produto, variante e contribuição.
  IF EXISTS (
    SELECT 1
      FROM public.purchase_order_items current_item
      JOIN public.purchase_orders current_order
        ON current_order.id = current_item.purchase_order_id
     WHERE current_item.id = NEW.id
       AND current_order.source_type = 'strap_demand'
       AND NOT public.strap_purchase_item_has_canonical_origin(current_item.id)
  ) THEN
    RAISE EXCEPTION 'Item de OC de tira sem contribuicao canonica estrutural';
  END IF;
  RETURN NEW;
END;
$function$;

-- Contrato read-only: prova a semântica final-state sem criar, alterar ou
-- apagar OCs históricas. O trigger de contribuições já usa esta mesma âncora.
CREATE OR REPLACE FUNCTION public.run_strap_purchase_origin_final_state_contract_tests_129()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_definition text;
  v_trigger_def text;
  v_deferrable boolean;
  v_initially_deferred boolean;
  v_current_item_pos integer;
  v_origin_pos integer;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.tg_assert_strap_purchase_order_item_origin()'::regprocedure
  );
  v_current_item_pos := pg_catalog.strpos(
    v_definition,
    'FROM public.purchase_order_items current_item'
  );
  v_origin_pos := pg_catalog.strpos(
    v_definition,
    'strap_purchase_item_has_canonical_origin(current_item.id)'
  );

  case_name := 'tombstone_event_is_ignored';
  ok := v_current_item_pos > 0
    AND pg_catalog.strpos(v_definition, 'current_item.id = NEW.id') > 0
    AND pg_catalog.strpos(
      v_definition,
      'current_order.id = current_item.purchase_order_id'
    ) > 0
    AND pg_catalog.strpos(v_definition, 'NEW.purchase_order_id') = 0
    AND v_current_item_pos < v_origin_pos;
  detail := 'evento antigo só valida se o item ainda existir no estado final';
  RETURN NEXT;

  case_name := 'live_invalid_item_stays_fail_closed';
  ok := pg_catalog.strpos(
      v_definition,
      'current_order.source_type = ''strap_demand'''
    ) > 0
    AND pg_catalog.strpos(v_definition, 'AND NOT public.strap_purchase_item_has_canonical_origin') > 0
    AND pg_catalog.strpos(
      v_definition,
      'Item de OC de tira sem contribuicao canonica estrutural'
    ) > v_origin_pos;
  detail := 'item sobrevivente de OC de tira sem origem canônica ainda aborta o COMMIT';
  RETURN NEXT;

  SELECT pg_catalog.pg_get_triggerdef(trigger.oid),
         trigger.tgdeferrable,
         trigger.tginitdeferred
    INTO v_trigger_def, v_deferrable, v_initially_deferred
    FROM pg_catalog.pg_trigger trigger
   WHERE trigger.tgrelid = 'public.purchase_order_items'::regclass
     AND trigger.tgname = 'trg_assert_strap_purchase_order_item_origin'
     AND NOT trigger.tgisinternal;

  case_name := 'constraint_remains_deferred';
  ok := COALESCE(v_deferrable, false)
    AND COALESCE(v_initially_deferred, false)
    AND v_trigger_def ILIKE '%AFTER INSERT OR UPDATE%'
    AND v_trigger_def ILIKE '%purchase_order_id%'
    AND v_trigger_def ILIKE '%product_id%'
    AND v_trigger_def ILIKE '%strap_variant_id%';
  detail := 'writer ainda pode vincular contribuições antes da prova no COMMIT';
  RETURN NEXT;

  case_name := 'guard_is_read_only';
  ok := pg_catalog.strpos(v_definition, 'INSERT INTO public.') = 0
    AND pg_catalog.strpos(v_definition, 'UPDATE public.') = 0
    AND pg_catalog.strpos(v_definition, 'DELETE FROM public.') = 0;
  detail := 'correção não reescreve item, contribuição ou histórico';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_strap_purchase_origin_final_state_contract_tests_129()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_strap_purchase_origin_final_state_contract_tests_129()
  TO service_role;

DO $contract_129$
DECLARE
  v_failures text;
BEGIN
  SELECT pg_catalog.string_agg(test.case_name || ': ' || test.detail, '; ')
    INTO v_failures
    FROM public.run_strap_purchase_origin_final_state_contract_tests_129() test
   WHERE NOT test.ok;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato final-state da origem de OC de tira falhou: %',
      v_failures;
  END IF;
END;
$contract_129$;

COMMIT;
