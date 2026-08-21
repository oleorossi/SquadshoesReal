-- =============================================================================
-- INCIDENTE: cliente em laco serializava o pipeline de tiras/PV pelo lock global
-- =============================================================================
-- Medido em 21/08/2026 nos logs do banco:
--   * 57.917.199 erros identicos entre 20/08 15:28 e 21/08 11:58 (BRT),
--     ininterruptos — praticamente TODO o volume de postgres_logs do projeto;
--   * ritmo de ~45.000/min (750/s), de UMA sessao e UMA conexao;
--   * todos '40001 · A ficha mudou desde a abertura do Estoque', levantados por
--     resolve_technical_strap_context_from_sale_order.
--
-- O sintoma que o dono relatou foi outro: "mudar o status do pedido para
-- producao demora demais". A ligacao e o LOCK. A funcao pegava
--     PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0))
-- e um SELECT ... FOR UPDATE na ficha ANTES de comparar `updated_at`. Ou seja,
-- cada uma das 750 chamadas obsoletas por segundo ADQUIRIA o lock global e o
-- row lock, e so entao falhava. `ensure_sale_order_internal_strap_intents` — que
-- roda ao salvar e ao promover o PV — disputa EXATAMENTE o mesmo advisory lock,
-- entao a aprovacao ficava na fila atras da tempestade. Os proprios logs
-- registram 'still waiting for ExclusiveLock on advisory lock'.
--
-- CORRECAO (decisao do dono): validar barato ANTES de travar. Um pre-check por
-- chave primaria compara `updated_at` e recusa a chamada obsoleta sem tocar no
-- lock global nem no row lock. O cliente em laco continua falhando — a origem
-- dele e outra investigacao —, mas para de serializar a fabrica inteira.
--
-- ⚠ A checagem sob o lock CONTINUA existindo, e nao e redundante: entre o
-- pre-check e a aquisicao do lock a ficha pode mudar. O pre-check e um filtro de
-- carga; a garantia de correcao segue sendo a verificacao com FOR UPDATE.
--
-- ⚠ Ficha INEXISTENTE nao muda de comportamento: o pre-check so dispara quando a
-- ficha existe, entao esse caso continua caindo em 'Ficha tecnica inexistente'.
--
-- POR QUE ESTA MIGRATION REESCREVE POR CIRURGIA DE TEXTO
-- O corpo da funcao tem ~11 mil caracteres e foi declarado na migration
-- 20270101006200. Redigita-lo aqui so para inserir 10 linhas criaria risco real
-- de divergencia silenciosa (ja aconteceu nesta base: uma reaplicacao perdeu os
-- comentarios internos e so foi pega por md5). A cirurgia abaixo e deterministica
-- na ordem de replay — 006200 cria a funcao antes — e ABORTA se a ancora nao for
-- encontrada, em vez de virar no-op silencioso.

-- VARREDURA DAS DEMAIS (decisao do dono: varrer todas) — 21/08/2026
-- 96 funcoes usam pg_advisory_xact_lock. RAISE depois do lock NAO e erro por si
-- so: muitas validam estado que precisa do lock pra ser estavel. O padrao
-- perigoso e outro — validacao BARATA, sobre dado que o CLIENTE mandou, atras do
-- lock. Classificando pelo trecho entre o lock e o 1o RAISE (sem leitura de
-- tabela), sobraram 4:
--
--   resolve_technical_strap_context_from_sale_order  lock GLOBAL  <- esta migration
--   resolve_artisanal_strap_migration_review_item    lock GLOBAL  ('artisanal-strap-legacy-cutover')
--       valida jsonb_typeof(p_resolution) depois do lock. Mesma classe de risco,
--       mas e ferramenta administrativa de cutover, chamada raramente — nao foi
--       mexida aqui pra nao acumular cirurgia sem necessidade. Fica registrada.
--   register_strap_purchase_receipt   lock POR CHAVE ('strap-idempotency:'||key)
--   save_artisanal_strap_variant      lock POR ID    ('strap-variant-capability:'||id)
--       nestas duas o lock e por chave/id, entao um cliente ruim trava apenas a
--       propria chave, nao a fabrica. Risco baixo; nao movidas.

BEGIN;

DO $cirurgia$
DECLARE
  v_def text;
  v_ancora constant text :=
    '  PERFORM pg_advisory_xact_lock(hashtextextended(''strap-pv-auto-intent'', 0));';
  v_precheck constant text :=
    '  -- ⚠ PRE-CHECK BARATO, ANTES DE QUALQUER LOCK (incidente de 21/08/2026).' || E'\n' ||
    '  -- Chamada obsoleta e recusada por uma leitura de chave primaria, sem tomar' || E'\n' ||
    '  -- o advisory lock global nem o FOR UPDATE da ficha. Sem isto, um cliente em' || E'\n' ||
    '  -- laco (750/s por 20h) serializava todo o pipeline de tiras e a promocao do' || E'\n' ||
    '  -- PV, que disputam o mesmo ''strap-pv-auto-intent''.' || E'\n' ||
    '  -- A verificacao definitiva continua abaixo, sob o lock: entre este ponto e' || E'\n' ||
    '  -- a aquisicao a ficha pode mudar.' || E'\n' ||
    '  IF EXISTS (SELECT 1 FROM public.technical_sheets ts WHERE ts.id = p_reference_id)' || E'\n' ||
    '     AND NOT EXISTS (' || E'\n' ||
    '       SELECT 1 FROM public.technical_sheets ts' || E'\n' ||
    '        WHERE ts.id = p_reference_id' || E'\n' ||
    '          AND p_expected_updated_at IS NOT NULL' || E'\n' ||
    '          AND ts.updated_at IS NOT DISTINCT FROM p_expected_updated_at' || E'\n' ||
    '     ) THEN' || E'\n' ||
    '    RAISE EXCEPTION ''A ficha mudou desde a abertura do Estoque; recarregue o pedido antes de confirmar''' || E'\n' ||
    '      USING ERRCODE = ''40001'';' || E'\n' ||
    '  END IF;' || E'\n' || E'\n';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE oid = 'public.resolve_technical_strap_context_from_sale_order(uuid,uuid,jsonb,text,timestamptz)'::regprocedure;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Funcao alvo nao encontrada';
  END IF;
  IF position(v_ancora IN v_def) = 0 THEN
    RAISE EXCEPTION 'Ancora do advisory lock nao encontrada — a funcao mudou; refaca a cirurgia a mao';
  END IF;
  IF position('PRE-CHECK BARATO' IN v_def) > 0 THEN
    RAISE NOTICE 'Pre-check ja aplicado; nada a fazer';
    RETURN;
  END IF;

  -- Insere o pre-check IMEDIATAMENTE antes da primeira aquisicao do lock.
  v_def := overlay(
    v_def
    PLACING v_precheck || v_ancora
    FROM position(v_ancora IN v_def)
    FOR length(v_ancora)
  );

  EXECUTE v_def;
END;
$cirurgia$;

DO $assertions$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE oid = 'public.resolve_technical_strap_context_from_sale_order(uuid,uuid,jsonb,text,timestamptz)'::regprocedure;

  IF position('PRE-CHECK BARATO' IN v_def) = 0 THEN
    RAISE EXCEPTION 'O pre-check nao entrou na funcao';
  END IF;

  -- O pre-check TEM que vir antes do lock; se ficar depois, nao contem nada.
  IF position('PRE-CHECK BARATO' IN v_def)
     > position('pg_advisory_xact_lock(hashtextextended(''strap-pv-auto-intent''' IN v_def) THEN
    RAISE EXCEPTION 'O pre-check ficou DEPOIS do advisory lock — nao conteria a tempestade';
  END IF;

  -- A guarda definitiva sob o lock continua existindo.
  IF position('v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'A verificacao sob o lock foi perdida — o pre-check NAO a substitui';
  END IF;
  IF position('FOR UPDATE' IN v_def) = 0 THEN
    RAISE EXCEPTION 'O FOR UPDATE da ficha foi perdido na cirurgia';
  END IF;
  -- E o resto do writer segue intacto.
  IF position('requested_base_ignored' IN v_def) = 0
     OR position('v_requires_reference_base' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Corpo do writer foi alterado alem do pre-check';
  END IF;
END;
$assertions$;

COMMIT;
