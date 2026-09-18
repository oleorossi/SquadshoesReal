-- =============================================================================
-- Netting de tira toma o lock global de alocacao ANTES do base-netting
-- =============================================================================
-- Sintoma (PV-00168, 18/09/2026): remover itens de um PV Aprovado devolvia
-- "O banco estava ocupado com estoque ou compras de outro pedido".
--
-- O recibo do PV mostra o erro exato, e NAO era timeout:
--
--   command=update status=failed 10:05:07-03
--   error_code=40P01
--   error_message='Modelo DS20 / OFF WHITE, TIRA 1: deadlock detected'
--
-- 40P01 e DEADLOCK, nao lock timeout (55P03) nem statement timeout (57014).
-- As migrations 25600 (timeout de role), 25800 (drain volta a FUNCTION) e 25900
-- (teto de tempo no worker) atacaram contencao por ESPERA. Nenhuma delas fecha
-- um CICLO: quando existe ciclo, o Postgres mata um dos lados, e a escolha nao
-- e nossa. Este arquivo remove o ciclo.
--
-- ## O ciclo, medido
--
-- Os dois lados pegam os MESMOS dois recursos em ordem INVERTIDA:
--
--   save  (execute_sale_order_command, authenticated)
--     linha  64: lock_sale_order_purchase_allocation()   <- linha unica global
--     linha 135: advisory 'strap-pv-auto-intent'
--     ...      : DELETE sale_order_items
--                  -> gatilho tg_release_strap_demands_before_item_delete
--                    -> reconcile_strap_variant
--                      -> advisory 'strap-base-netting:<napa>'
--                      -> products FOR UPDATE
--                      -> upsert_strap_purchase_contribution (linhas de compra)
--
--   drain (drain_strap_demand_jobs, pg_cron/service_role)
--     process_strap_demand_job -> reconcile_strap_variant
--       -> advisory 'strap-base-netting:<napa>'        <- PRIMEIRO
--       -> products FOR UPDATE
--       -> upsert_strap_purchase_contribution          <- linhas de compra
--          (nunca pegava a linha global de alocacao)
--
-- Logo:
--   save  segura alocacao   -> quer 'strap-base-netting:X'
--   drain segura 'strap-base-netting:X' -> quer linha de compra que o save segura
--   => ciclo => 40P01.
--
-- O log do Postgres confirma a forma da espera (row lock, nao advisory):
--   13:05:11 process 1346703 detected deadlock while waiting for
--            ShareLock on transaction 69543661 after 1000.720 ms
--
-- ⚠ E o gatilho e justamente o de DELETE de item: o dono estava removendo itens.
--    Por isso o erro aparece nesta operacao e nao em salvar sem remover.
--
-- ## Por que timeout NAO resolve isto
--
-- `deadlock_timeout` = 1000 ms e vale para os dois lados; quem detecta o ciclo
-- e quem morre. Reduzir o `lock_timeout` do worker para baixo de 1 s encolhe a
-- janela, mas nao a fecha: se o save comecou a esperar antes, o detector DELE
-- dispara primeiro e o save e a vitima. E subir o `deadlock_timeout` do save
-- nao e possivel neste projeto — medido agora:
--
--   set_config('deadlock_timeout','5s',true) como postgres
--     -> FAILED 42501: permission denied to set parameter "deadlock_timeout"
--
--   (contexto do GUC = 'superuser' e o `postgres` do Supabase tem
--    rolsuper=false, entao nem SECURITY DEFINER destrava.)
--
-- Sem controlar quem detecta, a unica correcao real e ordem consistente.
--
-- ## A correcao
--
-- Ordem global unica, igual a que o save ja usa:
--
--   alocacao global -> strap-base-netting -> strap-variant -> products
--                   -> reservas -> linhas de compra
--
-- Como a alocacao passa a ser o primeiro lock dos dois lados, eles SERIALIZAM
-- nessa linha unica e nunca se intercalam. Ciclo deixa de ser possivel; quem
-- chega depois simplesmente espera.
--
-- ⚠ Tem que valer para as TRES funcoes que pegam 'strap-base-netting', nao so
--    para a `reconcile_strap_variant`. `cancel_strap_operation`,
--    `resume/suspend_strap_operation` e `register_strap_production_receipt`
--    chamam `lock_strap_physical_operation_scope` (base-netting) e DEPOIS
--    `reconcile_strap_variant`. Se so a reconcile tomasse a alocacao, nessas
--    rotas a ordem viraria base-netting -> alocacao — exatamente a inversao que
--    este arquivo existe para eliminar, so que criada por nos.
--
-- ⚠ NAO mover a alocacao para o inicio de `process_sale_order_purchase_shortages`.
--    Lá ela vem depois do calculo de proposito (mig 24700,
--    "compute before row locks"): antecipa-la faria o worker segurar a linha
--    global durante os ~25 s de calculo (medido: duration 25352.700 ms). Ela nao
--    participa do ciclo acima — o save nunca pede
--    'sale-order-purchase-shortages:<pv>'.
--
-- Reescrita minima e auto-verificada: o corpo vem de `pg_get_functiondef`, sofre
-- UM `replace` e o bloco prova que a diferenca e exatamente a linha inserida
-- (`replace(novo, linha, '') = antigo`). Assim nenhuma conta de tira muda por
-- transcricao — se o ancora nao casar, a migration ABORTA e nada e aplicado.
--
-- Travado por src/__tests__/strapNettingAllocationLockOrder.contract.test.ts.
-- =============================================================================

DO $fix$
DECLARE
  v_insert constant text :=
    '  PERFORM public.lock_sale_order_purchase_allocation();' || chr(10);
  v_name text;
  v_anchor text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'reconcile_strap_variant',
    'lock_strap_physical_operation_scope',
    'neutralize_strap_source_override_promises'
  ] LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO v_old
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_old IS NULL THEN
      RAISE EXCEPTION 'funcao public.% ausente', v_name;
    END IF;

    -- Ancora = inicio do statement que pega o primeiro 'strap-base-netting'.
    -- A formatacao difere entre as tres, por isso cada uma tem a sua.
    v_anchor := CASE v_name
      WHEN 'reconcile_strap_variant' THEN
        '  FOR v_base_id IN SELECT unnest(v_base_ids) ORDER BY 1 LOOP'
      WHEN 'lock_strap_physical_operation_scope' THEN
        '  PERFORM pg_advisory_xact_lock(hashtextextended(' || chr(10)
          || '    ''strap-base-netting:''||v_base_product_id::text,0));'
      WHEN 'neutralize_strap_source_override_promises' THEN
        '  FOR v_lock IN' || chr(10)
          || '    SELECT DISTINCT d.base_product_id AS id'
    END;

    IF position('strap-base-netting' in v_old) = 0 THEN
      RAISE EXCEPTION
        'public.% deixou de pegar strap-base-netting; revise a ordem de locks',
        v_name;
    END IF;

    -- Idempotencia: se a alocacao ja vem antes do base-netting, nada a fazer.
    IF position('lock_sale_order_purchase_allocation' in v_old) > 0
       AND position('lock_sale_order_purchase_allocation' in v_old)
           < position('strap-base-netting' in v_old) THEN
      CONTINUE;
    END IF;

    v_hits := (length(v_old) - length(replace(v_old, v_anchor, '')))
              / length(v_anchor);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION
        'ancora de lock em public.% casou % vezes (esperado 1); corpo mudou',
        v_name, v_hits;
    END IF;

    v_new := replace(v_old, v_anchor, v_insert || v_anchor);

    -- Prova de diff minimo: remover a linha inserida devolve o corpo original.
    IF replace(v_new, v_insert, '') <> v_old THEN
      RAISE EXCEPTION
        'reescrita de public.% alterou mais que a linha do lock', v_name;
    END IF;
    IF position('lock_sale_order_purchase_allocation' in v_new)
       >= position('strap-base-netting' in v_new) THEN
      RAISE EXCEPTION
        'public.%: alocacao nao ficou antes do base-netting', v_name;
    END IF;

    EXECUTE v_new;
  END LOOP;
END;
$fix$;

DO $verify$
DECLARE
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'reconcile_strap_variant',
    'lock_strap_physical_operation_scope',
    'neutralize_strap_source_override_promises'
  ] LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;

    IF position('lock_sale_order_purchase_allocation' in v_def) = 0 THEN
      RAISE EXCEPTION 'public.% sem lock global de alocacao', v_name;
    END IF;
    IF position('lock_sale_order_purchase_allocation' in v_def)
       >= position('strap-base-netting' in v_def) THEN
      RAISE EXCEPTION
        'public.%: ordem alocacao -> base-netting nao vale', v_name;
    END IF;
  END LOOP;

  -- O save continua sendo o lado que define a ordem canonica: se ele parar de
  -- pegar a alocacao antes do strap, a ordem global deixa de existir e o ciclo
  -- volta sem quebrar nenhum teste de tira.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'execute_sale_order_command';
  IF position('lock_sale_order_purchase_allocation' in v_def)
     >= position('strap-pv-auto-intent' in v_def) THEN
    RAISE EXCEPTION
      'execute_sale_order_command deixou de pegar a alocacao antes do strap';
  END IF;
END;
$verify$;
