-- =============================================================================
-- Fila de materializacao do PV: ator real, chave de retry limitada, portao de
-- papel nas duas camadas e pre-voo de tiras.
--
-- CONTEXTO (PV-00232, 12/10/2026). O PV ficou "Erro -> Aprovado" com a mensagem
-- "idempotency_key e obrigatorio (maximo 200 caracteres)". Eram DOIS defeitos
-- empilhados, e o segundo escondia o primeiro:
--
--  1. BLOQUEADOR. A aprovacao saiu do browser e passou a rodar no worker
--     process-sale-order-materialization, como service_role SEM JWT. A cadeia
--     confirm -> promote_sale_order_*_internal ->
--     refresh_draft_strap_freeze_for_confirmation ->
--     prepare_sale_order_item_internal_straps ->
--     private.ensure_sale_order_internal_strap_materials termina num
--     "IF v_actor_id IS NULL THEN RAISE", com v_actor_id := auth.uid().
--     No worker auth.uid() e sempre NULL => TODO PV com tira artesanal interna
--     era inaprovavel pela fila. Estrutural, nao cadastro: a NAPA SOFT do NL01
--     tem perfil de largura aprovado desde 18/08.
--
--  2. MASCARADOR. retry_sale_order_materialization montava a chave nova
--     CONCATENANDO na anterior (|| ':retry:' || uuid), +43 chars por tentativa.
--     Medido nos 5 jobs do PV-00232: 84 -> 84 -> 127 -> 170 -> 213. O enqueue
--     so validava piso (>= 8) e NAO tinha teto; o execute_sale_order_command
--     rejeita > 200. A partir do 4o retry a fila aceitava uma chave que o
--     executor SEMPRE recusa: o job nascia morto, queimava as 4 tentativas e
--     trocava a mensagem real pela falsa. Irreversivel pela UI -- cada clique
--     em "Tentar de novo" crescia mais 43.
--
-- Na investigacao apareceram mais dois, da mesma raiz:
--
--  3. O recibo do comando grava actor_id = auth.uid() (linha ~208 do
--     execute_sale_order_command). No worker isso e NULL e NAO levanta erro:
--     escreve NULL em silencio. Medido em sale_order_command_receipts:
--     12 recibos de confirm/resync/promote sem ator.
--
--  4. PORTAO DE PAPEL CONTORNADO. enqueue_sale_order_materialization tem
--     GRANT EXECUTE para authenticated e seu unico portao era
--     "auth.uid() IS NOT NULL AND is_approved_user()" -- sem user_has_any_role
--     e sem can_execute_sale_order_command('edit'). O worker entao executa o
--     job como service_role, e o execute_sale_order_command PULA o bloco
--     inteiro de papel/permissao nesse caso. Resultado: qualquer usuario
--     aprovado podia aprovar, promover ou CANCELAR qualquer PV chamando a RPC
--     direto, contornando a exigencia de Comercial/Gerencia. Mesma forma do P0
--     de profiles.approved: guarda que vivia numa camada so e se perdeu quando
--     a outra foi reescrita.
--
-- POR QUE A DERIVACAO DO ATOR VIVE NUM TRIGGER, e nao dentro do
-- execute_sale_order_command: aquela funcao tem 1723 linhas e e recriada por
-- CREATE OR REPLACE em varias migrations. Uma derivacao enfiada no corpo dela
-- seria silenciosamente perdida na primeira recriacao a partir de base antiga
-- -- exatamente o modo de falha que ja custou o P0 de profiles.approved e a
-- regressao de check_grade_quantity_coherence. O INSERT do recibo e o PRIMEIRO
-- ato persistido do comando (antes do preflight e de qualquer mutacao) e
-- carrega sale_order_id, command_name e idempotency_key -- tudo que a
-- derivacao e a guarda precisam. O trigger sobrevive a recriacoes da funcao.
--
-- O QUE NAO FOI FEITO, DE PROPOSITO:
--  * Nenhum backfill dos 12 recibos sem ator. Inventar autor retroativo e pior
--    que o NULL honesto.
--  * Nenhuma limpeza dos 5 jobs mortos do PV-00232. Sao a evidencia do bug e
--    nenhum calculo os le.
--  * Os 233 recibos de 'update' sem ator NAO sao tratados aqui: 'update' roda
--    sincrono no browser, e outro caminho, ainda nao diagnosticado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ator do comando: derivacao + portao de papel, no recibo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sale_order_command_receipt_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_actor uuid;
  -- Espelha o portao do proprio execute_sale_order_command para os comandos
  -- que NAO sao resync/factoring.
  v_roles text[] := ARRAY['admin', 'gerente', 'comercial'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- O corpo do comando monta 'actor_id' dentro de v_result com auth.uid()
    -- (cancelamento compensatorio), e v_result vira receipts.response nas
    -- linhas ~1650/~1685. No worker isso sai null; alinha com o ator ja
    -- resolvido na propria linha em vez de deixar a resposta mentindo.
    IF NEW.actor_id IS NOT NULL
       AND jsonb_typeof(COALESCE(NEW.response, 'null'::jsonb)) = 'object'
       AND NEW.response ? 'actor_id'
       AND jsonb_typeof(NEW.response -> 'actor_id') = 'null' THEN
      NEW.response := jsonb_set(
        NEW.response, '{actor_id}', to_jsonb(NEW.actor_id), false
      );
    END IF;
    RETURN NEW;
  END IF;

  v_actor := COALESCE(NEW.actor_id, auth.uid());

  -- O par (sale_order_id, idempotency_key) e UNIQUE em
  -- sale_order_materialization_jobs e e exatamente o que o worker repassa ao
  -- execute_sale_order_command, entao casa o recibo com o job que o originou.
  SELECT * INTO v_job
    FROM public.sale_order_materialization_jobs j
   WHERE j.sale_order_id = NEW.sale_order_id
     AND j.idempotency_key = NEW.idempotency_key;

  IF FOUND THEN
    v_actor := COALESCE(v_actor, v_job.requested_by);

    -- auth.uid() nulo COM job casado = caminho do worker. E o unico ponto em
    -- que o papel do ator REAL ainda pode ser exigido: dali pra frente o
    -- execute_sale_order_command pula o bloco de papel por ser service_role,
    -- e nada mais pergunta quem mandou.
    IF auth.uid() IS NULL THEN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION
          'Job de materializacao sem requested_by: comando % do PV % nao tem ator para a trilha de auditoria',
          NEW.command_name, NEW.sale_order_id
          USING ERRCODE = '42501';
      END IF;

      -- ATENCAO: nao use is_approved_user(), user_has_any_role() nem
      -- can_execute_sale_order_command() aqui. As tres comecam com
      -- is_service_role_request_128() e devolvem TRUE para service_role
      -- INDEPENDENTEMENTE do ator -- compilam, rodam, passam no teste e nao
      -- checam nada. A verificacao tem que ler profiles/user_roles direto
      -- pelo v_actor.
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = v_actor AND p.approved = true
      ) THEN
        RAISE EXCEPTION
          'Quem enfileirou o comando % do PV % nao e usuario aprovado',
          NEW.command_name, NEW.sale_order_id
          USING ERRCODE = '42501';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = v_actor
           AND ur.role::text = ANY(v_roles)
      ) THEN
        RAISE EXCEPTION
          'Quem enfileirou o comando % do PV % nao tem papel Comercial/Gerencia',
          NEW.command_name, NEW.sale_order_id
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  NEW.actor_id := v_actor;

  -- GUC transacional lido por private.ensure_sale_order_internal_strap_materials.
  -- O recibo e inserido antes do preflight e de qualquer mutacao, entao o valor
  -- ja esta posto quando o gravador de tiras roda, na mesma transacao.
  IF v_actor IS NOT NULL THEN
    PERFORM set_config('app.command_actor_id', v_actor::text, true);
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sale_order_command_receipt_actor
  ON public.sale_order_command_receipts;
CREATE TRIGGER trg_sale_order_command_receipt_actor
  BEFORE INSERT OR UPDATE ON public.sale_order_command_receipts
  FOR EACH ROW EXECUTE FUNCTION public.tg_sale_order_command_receipt_actor();

REVOKE ALL ON FUNCTION public.tg_sale_order_command_receipt_actor()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Gravador de tiras: aceita o ator derivado pelo GUC
-- -----------------------------------------------------------------------------
-- private.ensure_sale_order_internal_strap_materials tem 448 linhas e UMA
-- linha muda: a inicializacao de v_actor_id. Em vez de transcrever 18 KB (onde
-- a mudanca de uma linha fica invisivel para quem revisa, e qualquer deslize de
-- transcricao vira bug silencioso), o patch e cirurgico e ASSERTIVO: falha alto
-- se o alvo nao aparecer exatamente uma vez no corpo VIVO, de modo que nunca
-- possa virar no-op silencioso.
--
-- O portao de PAPEL logo acima (linha ~48) ja tinha escapatoria para caminho de
-- RPC (app.strap_source_rpc). O portao de ATOR nao tinha nenhuma -- era essa
-- assimetria que travava a fila.
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_old_expr constant text := '  v_actor_id uuid := auth.uid();';
  v_new_expr constant text :=
    '  v_actor_id uuid := COALESCE(' || E'\n' ||
    '    auth.uid(),' || E'\n' ||
    '    -- Fila de materializacao: o worker roda como service_role sem JWT,' || E'\n' ||
    '    -- entao auth.uid() e NULL. O ator real (quem clicou em Aprovar) vem' || E'\n' ||
    '    -- de sale_order_materialization_jobs.requested_by, posto neste GUC' || E'\n' ||
    '    -- por tg_sale_order_command_receipt_actor na mesma transacao.' || E'\n' ||
    '    nullif(btrim(COALESCE(current_setting(''app.command_actor_id'', true), '''')), '''')::uuid' || E'\n' ||
    '  );';
  v_hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND p.proname = 'ensure_sale_order_internal_strap_materials';

  IF v_def IS NULL THEN
    RAISE EXCEPTION
      'private.ensure_sale_order_internal_strap_materials nao existe; o patch de ator nao pode ser aplicado';
  END IF;

  -- Idempotencia: migration re-executada nao deve falhar.
  IF position(E'app.command_actor_id' in v_def) > 0 THEN
    RAISE NOTICE 'ensure_sale_order_internal_strap_materials ja aceita o ator derivado; nada a fazer';
    RETURN;
  END IF;

  SELECT count(*) INTO v_hits
    FROM unnest(string_to_array(v_def, E'\n')) AS l(line)
   WHERE l.line = v_old_expr;

  IF v_hits <> 1 THEN
    RAISE EXCEPTION
      'Patch de ator abortado: esperava 1 ocorrencia de "%" no corpo vivo, encontrei %. O corpo mudou -- reveja o patch em vez de deixa-lo virar no-op.',
      v_old_expr, v_hits;
  END IF;

  v_new := replace(v_def, v_old_expr, v_new_expr);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'Patch de ator abortado: substituicao nao alterou o corpo';
  END IF;

  EXECUTE v_new;

  -- Pos-verificacao no corpo vivo (nao no texto que acabamos de montar).
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND p.proname = 'ensure_sale_order_internal_strap_materials';

  IF position('app.command_actor_id' in COALESCE(v_def, '')) = 0 THEN
    RAISE EXCEPTION
      'Patch de ator aplicado mas o corpo vivo nao contem app.command_actor_id';
  END IF;
END;
$patch$;

-- -----------------------------------------------------------------------------
-- 3. enqueue: portao de papel, teto da chave e pre-voo de tiras
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization(
  p_sale_order_id uuid,
  p_command text,
  p_target_status text,
  p_expected_order_version bigint,
  p_idempotency_key text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_override_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_target text := btrim(COALESCE(p_target_status, ''));
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_wake bigint;
  v_actor uuid := auth.uid();
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_item record;
  v_readiness jsonb;
  v_gap_text text;
  v_gaps text[] := ARRAY[]::text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  -- PORTAO DE PAPEL (fechado em 20270101039800). Esta funcao tem GRANT para
  -- authenticated e enfileira comandos que o worker depois executa como
  -- service_role -- caso em que o execute_sale_order_command PULA seu proprio
  -- bloco de papel/permissao. Sem esta checagem, qualquer usuario aprovado
  -- aprovava/promovia/CANCELAVA qualquer PV pela fila, contornando a exigencia
  -- de Comercial/Gerencia que vale no caminho sincrono.
  --
  -- A leitura e DIRETA em user_roles, de proposito: user_has_any_role(),
  -- is_approved_user() e can_execute_sale_order_command() comecam com
  -- is_service_role_request_128() e devolvem TRUE para service_role
  -- independentemente do usuario -- usa-las aqui pareceria certo e nao checaria
  -- nada quando a chamada vier com role de servico.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = v_actor
       AND ur.role::text = ANY(ARRAY['admin', 'gerente', 'comercial'])
  ) THEN
    RAISE EXCEPTION
      'Somente Comercial/Gerência pode enfileirar o comando % do PV', v_command
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para o comando %',
      v_command
      USING ERRCODE = '42501';
  END IF;

  IF v_command NOT IN ('confirm', 'promote', 'cancel', 'transition') THEN
    RAISE EXCEPTION 'Comando de materialização inválido: %', v_command
      USING ERRCODE = '22023';
  END IF;
  IF length(v_target) = 0 THEN
    RAISE EXCEPTION 'target_status obrigatório' USING ERRCODE = '22023';
  END IF;
  -- TETO DE 200 (fechado em 20270101039800). O piso ja existia; faltava o teto,
  -- e sem ele a fila aceitava chave que o execute_sale_order_command SEMPRE
  -- recusa ("idempotency_key é obrigatório (máximo 200 caracteres)"). Era assim
  -- que um job nascia morto e queimava as 4 tentativas trocando a mensagem de
  -- erro verdadeira pela falsa. Os dois lados tem que concordar no limite.
  IF length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION
      'idempotency_key inválida (precisa ter entre 8 e 200 caracteres, recebi %)',
      length(v_key)
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_order_version IS NULL OR p_expected_order_version < 0 THEN
    RAISE EXCEPTION 'expected_order_version inválida' USING ERRCODE = '22023';
  END IF;

  -- Só a transição compensatória Aprovado→Rascunho usa transition na fila.
  IF v_command = 'transition' AND v_target IS DISTINCT FROM 'Rascunho' THEN
    RAISE EXCEPTION 'transition na fila só cobre Aprovado→Rascunho'
      USING ERRCODE = '22023';
  END IF;

  -- PRE-VOO DE TIRAS (fechado em 20270101039800). confirm e promote passam por
  -- promote_sale_order_*_internal -> refresh_draft_strap_freeze_for_confirmation
  -- -> prepare_sale_order_item_internal_straps, que da RAISE por item quando o
  -- cadastro da tira nao fecha. Sem este pre-voo isso so aparece ~2 min depois,
  -- no worker, como string crua do Postgres num badge. Aqui o usuario real esta
  -- presente e a recusa e imediata, com a lista do que falta.
  --
  -- Roda ANTES do FOR UPDATE de proposito: sao N chamadas de diagnostico, e
  -- segurar o lock do PV durante elas custaria mais do que diagnosticar um PV
  -- que logo abaixo se revelaria "already_current".
  --
  -- cancel e transition NAO entram: nao materializam tira, e bloquear um
  -- cancelamento por lacuna de cadastro seria pior que o problema.
  IF v_command IN ('confirm', 'promote') THEN
    FOR v_item IN
      SELECT soi.reference_id,
             soi.material_variant_id,
             soi.color,
             COALESCE(NULLIF(btrim(ts.code), ''), '?') AS reference_code
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
       ORDER BY ts.code, soi.color
    LOOP
      BEGIN
        v_readiness := public.diagnose_sale_order_internal_strap_readiness(
          v_item.reference_id, v_item.material_variant_id, v_item.color
        );
      EXCEPTION WHEN OTHERS THEN
        -- Falha do DIAGNOSTICO nao vira pendencia. Ele e leitura auxiliar; o
        -- writer continua barrando no worker se houver lacuna de verdade.
        -- Inventar bloqueio por falta de leitura seria pior que o estado
        -- atual (mesma regra do buyReadyVariantKeys = null na copia de tiras).
        v_readiness := NULL;
      END;

      IF v_readiness IS NOT NULL
         AND COALESCE((v_readiness ->> 'ready')::boolean, true) = false THEN
        SELECT string_agg(
                 format('%s / %s — %s',
                        v_item.reference_code,
                        COALESCE(NULLIF(btrim(v_item.color), ''), '?'),
                        COALESCE(
                          NULLIF(btrim(issue.value ->> 'message'), ''),
                          issue.value ->> 'code',
                          'lacuna não descrita'
                        )),
                 E'\n')
          INTO v_gap_text
          FROM jsonb_array_elements(
                 COALESCE(v_readiness -> 'issues', '[]'::jsonb)
               ) AS issue;
        IF NULLIF(btrim(COALESCE(v_gap_text, '')), '') IS NOT NULL THEN
          v_gaps := v_gaps || v_gap_text;
        END IF;
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_gaps, 1), 0) > 0 THEN
      RAISE EXCEPTION
        'Tiras sem cadastro completo — resolva no Hub de Tiras antes de aprovar:%s%s',
        E'\n', array_to_string(v_gaps, E'\n')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  IF v_so.status = v_target AND COALESCE(v_so.command_phase, 'idle') = 'idle' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_current', true,
      'sale_order_id', p_sale_order_id,
      'status', v_so.status,
      'command_phase', 'idle'
    );
  END IF;

  IF COALESCE(v_so.command_phase, 'idle') = 'processing' THEN
    IF v_so.command_target_status IS NOT DISTINCT FROM v_target
       AND v_so.command_job_id IS NOT NULL THEN
      SELECT * INTO v_job
        FROM public.sale_order_materialization_jobs j
       WHERE j.id = v_so.command_job_id;
      RETURN jsonb_build_object(
        'ok', true,
        'enqueued', true,
        'replayed', true,
        'sale_order_id', p_sale_order_id,
        'job_id', v_so.command_job_id,
        'command_phase', 'processing',
        'command_target_status', v_target,
        'status', v_so.status
      );
    END IF;
    RAISE EXCEPTION 'PV % já tem materialização em andamento (→ %)',
      COALESCE(v_so.order_number, p_sale_order_id::text),
      COALESCE(v_so.command_target_status, '?')
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_so.order_version, 0) IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'Versão do PV desatualizada (esperada %, atual %)',
      p_expected_order_version, COALESCE(v_so.order_version, 0)
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sale_order_materialization_jobs (
    sale_order_id,
    command_name,
    target_status,
    expected_order_version,
    payload,
    override_id,
    idempotency_key,
    requested_by,
    status
  ) VALUES (
    p_sale_order_id,
    v_command,
    v_target,
    p_expected_order_version,
    COALESCE(p_payload, '{}'::jsonb),
    p_override_id,
    v_key,
    v_actor,
    'pending'
  )
  ON CONFLICT (sale_order_id, idempotency_key) DO UPDATE
    SET updated_at = now()
  RETURNING * INTO v_job;

  UPDATE public.sale_orders
     SET command_phase = 'processing',
         command_target_status = v_target,
         command_error = NULL,
         command_job_id = v_job.id,
         command_started_at = now(),
         updated_at = now()
   WHERE id = p_sale_order_id;

  BEGIN
    v_wake := public.trigger_sale_order_materialization_worker();
  EXCEPTION WHEN OTHERS THEN
    v_wake := NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', true,
    'sale_order_id', p_sale_order_id,
    'job_id', v_job.id,
    'command_phase', 'processing',
    'command_target_status', v_target,
    'status', v_so.status,
    'wake_request_id', v_wake
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. retry: chave de tamanho CONSTANTE, nao mais concatenada
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_sale_order_materialization(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_new_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;
  IF COALESCE(v_so.command_phase, 'idle') IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'Só é possível retentar PV em command_phase=failed'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_so.command_job_id IS NULL THEN
    RAISE EXCEPTION 'PV sem job de materialização para retentar'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
    FROM public.sale_order_materialization_jobs j
   WHERE j.id = v_so.command_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job de materialização não encontrado';
  END IF;

  -- Chave DERIVADA DA RAIZ, nunca concatenada na anterior.
  --
  -- A versao antiga fazia  v_job.idempotency_key || ':retry:' || uuid, +43
  -- caracteres por tentativa. No PV-00232 isso rendeu 84 -> 127 -> 170 -> 213,
  -- e aos 213 o execute_sale_order_command passou a recusar TODA tentativa com
  -- "idempotency_key é obrigatório (máximo 200 caracteres)" -- erro falso que
  -- substituiu o verdadeiro e tornou o PV impossivel de destravar pela tela,
  -- porque cada novo clique so fazia a chave crescer.
  --
  -- Esta forma tem tamanho fixo (~93 chars, teto 10 do nome do comando), entao
  -- nao cresce com o numero de retentativas; e o uuid novo garante job novo em
  -- vez de reviver o anterior pelo ON CONFLICT (sale_order_id, idempotency_key).
  v_new_key := 'pv:' || p_sale_order_id::text
            || ':' || v_job.command_name
            || ':retry:' || gen_random_uuid()::text;

  IF length(v_new_key) > 200 THEN
    RAISE EXCEPTION
      'idempotency_key de retry passou de 200 caracteres (%). O formato deveria ser de tamanho fixo -- reveja a montagem.',
      length(v_new_key)
      USING ERRCODE = '22023';
  END IF;

  RETURN public.enqueue_sale_order_materialization(
    p_sale_order_id,
    v_job.command_name,
    v_job.target_status,
    COALESCE(v_so.order_version, 0),
    v_new_key,
    COALESCE(v_job.payload, '{}'::jsonb),
    v_job.override_id
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Grants (inalterados em relacao a 20270101028800; repetidos porque o
--    CREATE OR REPLACE acima nao os preserva quando a funcao e recriada noutra
--    ordem, e deixa-los implicitos ja custou caro neste projeto).
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enqueue_sale_order_materialization(
  uuid, text, text, bigint, text, jsonb, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_sale_order_materialization(
  uuid, text, text, bigint, text, jsonb, uuid
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_sale_order_materialization(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_sale_order_materialization(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.tg_sale_order_command_receipt_actor() IS
  'Deriva o ator do comando de PV a partir de sale_order_materialization_jobs.requested_by quando auth.uid() e NULL (worker service_role), exige o papel Comercial/Gerencia desse ator antes de qualquer mutacao, e publica o valor em app.command_actor_id para o gravador de tiras. Vive num trigger, e nao dentro de execute_sale_order_command, porque aquela funcao e recriada por CREATE OR REPLACE em varias migrations e perderia a guarda em silencio.';
