-- =============================================================================
-- execute_sale_order_command: elevar statement_timeout / lock_timeout
-- =============================================================================
-- Sintoma (PV-00168, 18/09/2026): Salvar Alterações em /sales/edit com remoção
-- de itens (7→4, PV Aprovado, 7 OPs Reservado, 276 reservas) retornou
--   "O pedido NÃO foi salvo. canceling statement due to statement timeout"
-- Edge log: POST 500 rpc/execute_sale_order_command às 10:09 UTC; sem receipt
-- (transação inteira rolou back).
--
-- Causa: role `authenticated` tem statement_timeout=8s (e authenticator
-- lock_timeout=8s). execute_sale_order_command é SECURITY DEFINER mas herda
-- os GUCs da sessão do PostgREST — não eleva o teto. Rematerializar
-- (teardown + persist plan + promote) de PV Aprovado com dezenas de reservas
-- estoura esses 8s. pg_stat_statements mostra RPCs autenticadas batendo no
-- teto ~7,5–8s; o execute bem-sucedido médio é ~2,4s, o pior que cabe é
-- ~7,5s — o caso do PV-00168 ficou acima.
--
-- Correção: no prólogo do execute, set_config local (is_local=true) para
-- statement_timeout=90s e lock_timeout=30s — mesmo padrão da 24700
-- (purchase shortages). Só vale nesta transação.
--
-- Marcador: execute_sale_order_raise_timeout_20270101025500
-- =============================================================================

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  );

  IF position($$set_config('statement_timeout', '90s', true)$$ IN v_def) > 0 THEN
    -- Já aplicado (possivelmente sob carimbo MCP antigo). Só alinha o marcador.
    IF position('execute_sale_order_raise_timeout_20270101025500' IN v_def) = 0 THEN
      v_def := replace(
        v_def,
        'execute_sale_order_raise_timeout_20270101025400',
        'execute_sale_order_raise_timeout_20270101025500'
      );
      EXECUTE v_def;
    END IF;
    RAISE NOTICE 'execute_sale_order_command já eleva statement_timeout';
    RETURN;
  END IF;

  v_old := $old$BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();$old$;

  v_new := $new$BEGIN
  -- execute_sale_order_raise_timeout_20270101025500
  -- authenticated herda statement_timeout=8s / lock_timeout=8s do role;
  -- rematerializar PV Aprovado com dezenas de reservas (ex.: PV-00168) estoura
  -- esses 8s. Eleva só nesta transação — mesmo padrão da 24700.
  PERFORM set_config('statement_timeout', '90s', true);
  PERFORM set_config('lock_timeout', '30s', true);
  PERFORM public.lock_sale_order_purchase_allocation();$new$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Âncora BEGIN/lock de execute_sale_order_command não encontrada';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION
      'Âncora BEGIN/lock de execute_sale_order_command aparece % vez(es)',
      (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

DO $verify$
DECLARE
  v_def text := pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  );
BEGIN
  IF position('execute_sale_order_raise_timeout_20270101025500' IN v_def) = 0 THEN
    RAISE EXCEPTION 'marcador execute_sale_order_raise_timeout ausente';
  END IF;
  IF position($$set_config('statement_timeout', '90s', true)$$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'statement_timeout 90s ausente em execute_sale_order_command';
  END IF;
  IF position($$set_config('lock_timeout', '30s', true)$$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'lock_timeout 30s ausente em execute_sale_order_command';
  END IF;
  IF position('PERFORM public.lock_sale_order_purchase_allocation();' IN v_def) = 0 THEN
    RAISE EXCEPTION 'lock de alocação sumiu do prólogo de execute';
  END IF;
END;
$verify$;
