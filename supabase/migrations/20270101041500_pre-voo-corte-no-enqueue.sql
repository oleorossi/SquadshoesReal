-- Pré-voo de corte no enfileiramento do PV (Q4a de 13/10/2026).
-- Par da 20270101041400 (gate de corte = fonte única do motor); o rationale
-- completo está no cabeçalho daquele arquivo.

-- PRÉ-VOO DE CORTE no enfileiramento (Q4a).
--
-- O corpo abaixo é o da `20270101039800` COPIADO, com UM bloco acrescentado.
-- Motivo de copiar em vez de alterar: `CREATE OR REPLACE` exige o corpo inteiro.
-- Travado por `src/__tests__/corteGateEspelhaMotor.contract.test.ts`, que confere
-- que as guardas da versão anterior (portão de papel lido DIRETO em user_roles,
-- teto de 200 da idempotency_key, pré-voo de tiras, replay de `processing`)
-- continuam todas presentes — é a lição do `napaBaseWidthProfileAutoProvision`:
-- cópia que perde uma guarda não quebra teste nenhum.
--
-- O QUE O BLOCO NOVO FAZ: roda `sale_order_item_factory_gate_block_reason` nos
-- itens do PV antes de enfileirar. Antes, um item com cadastro de corte incompleto
-- só estourava ~2,5 min depois, dentro do worker, como string crua do Postgres num
-- badge, depois de queimar as 4 tentativas do job. É o mesmo raciocínio que o
-- pré-voo de tiras já aplicava — o gate de corte só tinha ficado fora dele.
--
-- ⚠ USA O FACTORY GATE, NÃO O GATE DE CORTE CRU. É o factory gate que rebaixa
-- `'falta %'` a não-bloqueio ("o empenho parcial registra a falta e a compra
-- automática cobre" — spec integracao-estoque-pv-compras Q12) e é ele que
-- `promote_sale_order_item` consulta. Chamar o gate de corte direto recusaria
-- aprovação por falta de ESTOQUE, que é decisão de produto já tomada em contrário.
--
-- ⚠ ESPELHA `v_active_count = 0` DO MOTOR. `promote_sale_order_atomic_internal`
-- só chama `promote_sale_order_item` — e portanto só consulta o gate — para item
-- SEM OP ativa. Sem repetir essa condição aqui, a reaprovação de um PV que já tem
-- OPs passaria a ser recusada no clique enquanto o motor a aceitaria: exatamente a
-- classe de bloqueio falso que esta migration existe para fechar.
--
-- ⚠ `cancel` e `transition` ficam FORA, igual ao pré-voo de tiras: bloquear um
-- cancelamento por lacuna de cadastro é pior que o problema.
CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization(p_sale_order_id uuid, p_command text, p_target_status text, p_expected_order_version bigint, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb, p_override_id uuid DEFAULT NULL::uuid)
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

  -- PRE-VOO DE CORTE (20270101041400). Ver o cabecalho desta migration: usa o
  -- FACTORY gate (que rebaixa 'falta %') e espelha o v_active_count = 0 do motor.
  IF v_command IN ('confirm', 'promote') THEN
    v_gaps := ARRAY[]::text[];
    FOR v_item IN
      SELECT soi.id AS item_id,
             soi.color,
             COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
         AND soi.production_excluded_at IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.orders o
            WHERE o.sale_order_item_id = soi.id
              AND o.deleted_at IS NULL
              AND o.status NOT IN (
                'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
                'Concluído', 'Concluido', 'Concluída'
              )
         )
       ORDER BY ts.code, soi.color
    LOOP
      BEGIN
        v_gap_text := public.sale_order_item_factory_gate_block_reason(v_item.item_id);
      EXCEPTION WHEN OTHERS THEN
        -- Mesma regra do pre-voo de tiras: falha de LEITURA do diagnostico nao
        -- vira pendencia. O motor continua barrando no worker se houver bloqueio
        -- de verdade; inventar recusa por falta de leitura seria pior.
        v_gap_text := NULL;
      END;

      IF NULLIF(btrim(COALESCE(v_gap_text, '')), '') IS NOT NULL THEN
        v_gaps := v_gaps || format(
          '%s / %s — %s',
          v_item.reference_code,
          COALESCE(NULLIF(btrim(v_item.color), ''), '?'),
          v_gap_text
        );
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_gaps, 1), 0) > 0 THEN
      RAISE EXCEPTION
        'Itens bloqueados para produção — resolva o cadastro antes de aprovar:%s%s',
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
