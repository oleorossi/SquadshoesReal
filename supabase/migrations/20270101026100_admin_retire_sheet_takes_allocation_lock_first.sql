-- =============================================================================
-- admin_retire_technical_sheet: alocacao global ANTES dos locks por PV
-- =============================================================================
-- Fecha a inversao que a migration 26000 CRIOU nesta funcao. Nao e regressao de
-- terceiro: e consequencia direta do fix anterior, encontrada auditando o que o
-- proprio fix mudou.
--
-- ## O que a 26000 fez, e o efeito colateral
--
-- A 26000 pos `lock_sale_order_purchase_allocation()` dentro das tres funcoes de
-- `strap-base-netting` para fechar o ciclo save x drain (40P01 do PV-00168).
-- Como o lock passou a ser tomado LA DENTRO, toda rota que chega ao netting
-- passou a querer a alocacao — inclusive rotas que ja seguravam outros locks
-- antes de chamar o netting.
--
-- Varredura das 19 rotas que chamam netting (medido 18/09/2026): 18 nao tocam
-- lock de PV antes. UMA toca:
--
--   admin_retire_technical_sheet
--     linha  85: advisory 'operational-command-request:<client_request_id>'
--     linha 106: advisory 'recompute_production_schedule'
--     linha 139: advisory 'sale-order-command:<pv>'   <- lock de PV
--     linha 146: sale_orders FOR UPDATE               <- linha do PV
--     linha 583: reconcile_strap_variant  -> alocacao  <- DEPOIS (via 26000)
--
-- Ordem canonica dos outros 16 comandos que pegam os dois (todos concordam,
-- inclusive `execute_sale_order_command`, pos_alloc=2397 < pos_soc=5357):
--
--   alocacao -> 'sale-order-command:<pv>' -> sale_orders FOR UPDATE
--
-- Logo o ciclo NOVO seria:
--   admin_retire segura 'sale-order-command:X' -> quer alocacao
--   save        segura alocacao               -> quer 'sale-order-command:X'
--   => 40P01, o mesmo erro que a 26000 existe para eliminar.
--
-- ⚠ Aposentar ficha e operacao rara, então isto quase nunca apareceria — e
--    apareceria como deadlock intermitente num save comum, sem apontar para a
--    aposentadoria. Ordem de lock nao se valida por frequencia de sintoma.
--
-- ## A correcao
--
-- A alocacao passa a ser tomada antes de qualquer lock de PV/producao, logo
-- depois do advisory de idempotencia do recibo. Fica igual aos outros 16.
--
-- ⚠ Depois do recibo, NAO antes: `operational-command-request:<client_request_id>`
--    e por REQUISICAO (nao ha duas requisicoes distintas disputando a mesma
--    chave), e o bloco seguinte faz `RETURN` quando o recibo ja existe. Pegar a
--    linha global antes disso faria todo replay idempotente serializar na
--    alocacao sem precisar. Os outros comandos de `operational_command_receipts`
--    (`execute_order_stage_command`, `execute_production_pointing_command`,
--    `execute_production_wave_stage_command`) usam exatamente esta ordem:
--    recibo -> alocacao -> resto.
--
-- Verificado nesta mesma auditoria, para nao trocar um ciclo por outro:
--   'recompute_production_schedule'      -> 0 funcoes o pegam depois da alocacao
--   'outsource_service_order_generation' -> 0 funcoes o pegam depois da alocacao
-- Ou seja, os dois advisories globais que ficam ANTES da alocacao aqui nao
-- participam de par invertido em nenhuma rota.
--
-- Mesma tecnica da 26000: corpo vem de `pg_get_functiondef`, UM `replace`, e o
-- bloco prova que remover a linha inserida devolve o original byte a byte. Se o
-- ancora nao casar exatamente uma vez, a migration ABORTA e nada e aplicado.
--
-- Travado por src/__tests__/strapNettingAllocationLockOrder.contract.test.ts.
-- =============================================================================

DO $fix$
DECLARE
  v_anchor constant text := '  -- Serializa com o motor de antecipacao.';
  v_insert constant text :=
    '  -- Ordem global de locks: a linha unica de alocacao vem antes de qualquer'
    || chr(10) ||
    '  -- lock de PV/producao. Sem isto, o netting de tira (que pega a alocacao'
    || chr(10) ||
    '  -- desde a mig 26000) inverteria a ordem contra os saves de PV -> 40P01.'
    || chr(10) ||
    '  PERFORM public.lock_sale_order_purchase_allocation();'
    || chr(10) || chr(10);
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_old
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_retire_technical_sheet';

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'funcao public.admin_retire_technical_sheet ausente';
  END IF;

  -- Idempotencia: se a alocacao ja vem antes do lock de PV, nada a fazer.
  IF position('lock_sale_order_purchase_allocation' in v_old) > 0
     AND position('lock_sale_order_purchase_allocation' in v_old)
         < position('sale-order-command:' in v_old) THEN
    RAISE NOTICE 'admin_retire_technical_sheet ja esta na ordem canonica';
    RETURN;
  END IF;

  -- A funcao TEM que continuar pegando lock de PV; se parou, esta reescrita
  -- perdeu o proposito e a premissa precisa ser revista a mao.
  IF position('sale-order-command:' in v_old) = 0 THEN
    RAISE EXCEPTION
      'admin_retire_technical_sheet nao pega mais sale-order-command; revise a ordem';
  END IF;

  -- E tem que continuar chegando ao netting (o motivo de querer a alocacao).
  IF position('reconcile_strap_variant' in v_old) = 0 THEN
    RAISE EXCEPTION
      'admin_retire_technical_sheet nao chama mais reconcile_strap_variant; revise';
  END IF;

  v_hits := (length(v_old) - length(replace(v_old, v_anchor, '')))
            / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION
      'ancora casou % vezes (esperado 1) em admin_retire_technical_sheet', v_hits;
  END IF;

  v_new := replace(v_old, v_anchor, v_insert || v_anchor);

  -- Prova de diff minimo: remover o bloco inserido devolve o corpo original.
  IF replace(v_new, v_insert, '') <> v_old THEN
    RAISE EXCEPTION
      'reescrita de admin_retire_technical_sheet alterou mais que o lock';
  END IF;

  IF position('lock_sale_order_purchase_allocation' in v_new)
     >= position('sale-order-command:' in v_new) THEN
    RAISE EXCEPTION
      'admin_retire_technical_sheet: alocacao nao ficou antes do lock de PV';
  END IF;

  EXECUTE v_new;
END;
$fix$;

DO $verify$
DECLARE
  v_def text;
  v_bad text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_retire_technical_sheet';

  IF position('lock_sale_order_purchase_allocation' in v_def) = 0
     OR position('lock_sale_order_purchase_allocation' in v_def)
        >= position('sale-order-command:' in v_def) THEN
    RAISE EXCEPTION
      'admin_retire_technical_sheet fora da ordem alocacao -> PV';
  END IF;

  -- Invariante geral: nenhuma rota que chega ao netting pode segurar lock de PV
  -- antes. Isto vale para a base inteira, nao so para a funcao deste arquivo —
  -- e o que impede o proximo caller novo de reabrir o ciclo em silencio.
  SELECT string_agg(proname, ', ' ORDER BY proname) INTO v_bad
    FROM (
      SELECT p.proname, d.def,
        least(
          nullif(position('reconcile_strap_variant' in d.def), 0),
          nullif(position('lock_strap_physical_operation_scope' in d.def), 0),
          nullif(position('neutralize_strap_source_override_promises' in d.def), 0)
        ) AS pos_netting
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL (SELECT pg_get_functiondef(p.oid) AS def) d
       WHERE n.nspname = 'public'
         AND p.proname NOT IN (
           'reconcile_strap_variant',
           'lock_strap_physical_operation_scope',
           'neutralize_strap_source_override_promises'
         )
         AND (d.def LIKE '%reconcile_strap_variant%'
           OR d.def LIKE '%lock_strap_physical_operation_scope%'
           OR d.def LIKE '%neutralize_strap_source_override_promises%')
    ) t
   WHERE pos_netting IS NOT NULL
     AND nullif(position('sale-order-command:' in def), 0) IS NOT NULL
     AND position('sale-order-command:' in def) < pos_netting
     AND (position('lock_sale_order_purchase_allocation' in def) = 0
       OR position('lock_sale_order_purchase_allocation' in def)
          > position('sale-order-command:' in def));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'rotas de netting segurando lock de PV antes da alocacao: %', v_bad;
  END IF;
END;
$verify$;
