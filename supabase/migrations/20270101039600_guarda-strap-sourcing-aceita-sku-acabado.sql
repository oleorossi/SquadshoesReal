-- =============================================================================
-- Guarda de strap_sourcing: Comprar pronto do PV identifica por SKU acabado
-- =============================================================================
-- Sintoma (PV novo, 12/10/2026, tira FRENTE TIRA CHATA 8MM / NAPA ROOTS com
-- ORIGEM trocada para "Comprar pronto"):
--   "O pedido NÃO foi salvo. Origem/variante persistida invalida para linha
--    1b683048-c387-46db-99a6-d4cabd9415b6"
-- O PV inteiro aborta (5 itens), não só a linha da tira.
--
-- Causa: contrato divergente entre o WRITER e a GUARDA, nos dois lados do
-- mesmo `sale_order_items.strap_sourcing`.
--
--   writer  `prepare_sale_order_item_internal_straps`, ramo
--           v_sheet_basis='reference_base' AND pv_origem='sku_acabado'
--           (definido pela migration 20270101031900, pv-sku-acabado-buy-ready-
--           sem-variante; o marcador literal dela NAO e citado aqui de
--           proposito: no repo o ultimo arquivo que menciona um marcador e
--           tratado como quem define aquele corpo, e esta migration patcha
--           OUTRA funcao -- a guarda)
--           congela de propósito:
--             'source_mode','buy_ready', 'strap_variant_id', NULL,
--             'finished_product_id', <SKU acabado da Cor Principal>
--
--   guarda  `tg_version_and_guard_sale_order_item_strap_sourcing` (03200)
--           exige `strap_variant_id` NÃO nulo nos DOIS modos, e dispara
--           BEFORE INSERT/UPDATE — ou seja, recusa exatamente o que o writer
--           acabou de produzir.
--
-- A 31900 (e as seguintes 33000/35300) patcharam só o writer; nenhuma migration
-- tocou a guarda. O lado TS já migrou (`isCompleteStrapSourcingSelection` em
-- src/lib/strapSourcing.ts aceita strap_variant_id OU finished_product_id), por
-- isso a tela valida, libera o botão e o banco recusa.
--
-- Medido em 12/10/2026 antes deste patch: 92 entradas `buy_ready` persistidas,
-- **0** sem variante e **0** com `finished_product_id`. As 92 são todas do basis
-- `finished_product_group` (ramo que preenche variant_id). O caminho aberto pela
-- 31900 nunca salvou uma linha sequer — era código morto desde que foi escrito.
--
-- Esta migration alinha a GUARDA ao writer, em dois pontos:
--   1) identidade completa de `buy_ready` = strap_variant_id OU
--      finished_product_id. `internal` continua EXIGINDO a variante: só o Hub
--      resolve receita, rendimento e napa-base, então internal sem variante
--      segue sendo dado inválido (não relaxar).
--   2) a detecção de compromisso no ramo UPDATE passa a comparar também
--      `finished_product_id`. Sem isso, trocar o SKU acabado de uma tira já
--      comprometida (PO enviada, lote iniciado) escaparia da guarda "Origem
--      comprometida", porque a comparação só olhava source_mode + variante —
--      e na identidade nova a variante é NULL dos dois lados.
--
-- ⚠ NÃO relaxar o `PERFORM ::uuid`: ele continua valendo para cada um dos dois
-- campos quando presente. O que muda é que ele deixa de rodar sobre NULL.
--
-- Patch por substituição de texto do corpo vivo (padrão 24000/28500/28600/
-- 31900/32200/32300); falha alto se o trecho esperado não existir.
-- Marcador: strap_buy_ready_sku_acabado_sem_variante_20270101039600
-- =============================================================================

DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_version_and_guard_sale_order_item_strap_sourcing()'::regprocedure;
  v_def text;
  v_old_check text := $old_check$    IF jsonb_typeof(v_value)<>'object'
       OR v_value->>'source_mode' NOT IN ('internal','buy_ready')
       OR nullif(v_value->>'strap_variant_id','') IS NULL THEN
      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;
    END IF;
    BEGIN PERFORM (v_value->>'strap_variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'UUID da variante invalido para linha %',v_key; END;$old_check$;
  v_new_check text := $new_check$    -- strap_buy_ready_sku_acabado_sem_variante_20270101039600
    -- buy_ready do PV (31900) congela finished_product_id SEM variante Hub.
    -- internal continua exigindo a variante: so o Hub resolve receita/rendimento.
    IF jsonb_typeof(v_value)<>'object'
       OR v_value->>'source_mode' NOT IN ('internal','buy_ready')
       OR (v_value->>'source_mode'='internal'
           AND nullif(v_value->>'strap_variant_id','') IS NULL)
       OR (v_value->>'source_mode'='buy_ready'
           AND nullif(v_value->>'strap_variant_id','') IS NULL
           AND nullif(v_value->>'finished_product_id','') IS NULL) THEN
      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;
    END IF;
    IF nullif(v_value->>'strap_variant_id','') IS NOT NULL THEN
      BEGIN PERFORM (v_value->>'strap_variant_id')::uuid;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'UUID da variante invalido para linha %',v_key; END;
    END IF;
    IF nullif(v_value->>'finished_product_id','') IS NOT NULL THEN
      BEGIN PERFORM (v_value->>'finished_product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'UUID do SKU acabado invalido para linha %',v_key; END;
    END IF;$new_check$;
  v_old_commit text := $old_commit$        OR nullif(OLD.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
          IS DISTINCT FROM nullif(NEW.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
      ) AND ($old_commit$;
  v_new_commit text := $new_commit$        OR nullif(OLD.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
          IS DISTINCT FROM nullif(NEW.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
        -- strap_buy_ready_sku_acabado_sem_variante_20270101039600
        -- Na identidade por SKU acabado a variante e NULL dos dois lados; sem
        -- esta linha, trocar o SKU de uma tira comprometida passaria livre.
        OR nullif(OLD.strap_sourcing->d.technical_strap_line_id::text->>'finished_product_id','')::uuid
          IS DISTINCT FROM nullif(NEW.strap_sourcing->d.technical_strap_line_id::text->>'finished_product_id','')::uuid
      ) AND ($new_commit$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_version_and_guard_sale_order_item_strap_sourcing()') IS NULL THEN
    RAISE EXCEPTION 'tg_version_and_guard_sale_order_item_strap_sourcing() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_sku_acabado_sem_variante_20270101039600' IN v_def) > 0 THEN
    RETURN; -- ja aplicado
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old_check, ''))) / nullif(length(v_old_check), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Validacao de identidade da guarda (03200) nao encontrada (hits=%); corpo mudou, revise 39600',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old_check, v_new_check);

  v_hits := (length(v_def) - length(replace(v_def, v_old_commit, ''))) / nullif(length(v_old_commit), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Comparacao de compromisso da guarda (03200) nao encontrada (hits=%); corpo mudou, revise 39600',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old_commit, v_new_commit);

  EXECUTE v_def;

  -- Conferencia do corpo VIVO: o arquivo da migration nao prova nada sozinho.
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_sku_acabado_sem_variante_20270101039600' IN v_def) = 0
     OR position($chk$AND nullif(v_value->>'finished_product_id','') IS NULL) THEN$chk$ IN v_def) = 0
     OR position($chk2$->>'finished_product_id','')::uuid$chk2$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guarda de strap_sourcing nao ficou com o contrato novo; revise 39600';
  END IF;
  -- internal sem variante NAO pode ter sido relaxado junto.
  IF position($chk3$v_value->>'source_mode'='internal'
           AND nullif(v_value->>'strap_variant_id','') IS NULL$chk3$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guarda relaxou internal sem variante; revise 39600';
  END IF;
END;
$patch_guard$;

COMMENT ON FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing() IS
  'Versiona e valida sale_order_items.strap_sourcing. Identidade completa: internal exige strap_variant_id (variante do Hub resolve receita/rendimento/napa-base); buy_ready aceita strap_variant_id (linha finished_product_group da ficha) OU finished_product_id (Comprar pronto do PV, migration 20270101031900, que congela o SKU acabado da Cor Principal sem variante Hub). A troca de origem apos compromisso compara source_mode, strap_variant_id E finished_product_id.';
