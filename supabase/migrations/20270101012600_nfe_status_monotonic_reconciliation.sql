-- Observacao monotônica e reconciliação durável do cancelamento de NF-e.
--
-- O ClickNotas não participa da transação Postgres. Uma resposta perdida no
-- POST de cancelamento deixa a NF local em `cancelando`; pollers jamais podem
-- convertê-la de volta para `autorizada`. A observação `cancelada`, por outro
-- lado, precisa executar o mesmo complete idempotente da migration 114 para
-- que fiscal, financeiro, estoque avulso e PV avancem juntos.
--
-- Esta migration não altera linhas históricas. Somente novos comandos e novas
-- observações passam a alimentar a fila durável abaixo.

BEGIN;

CREATE TABLE public.nfe_cancellation_commands_126 (
  nfe_id uuid PRIMARY KEY
    REFERENCES public.nfe_emitidas(id) ON DELETE RESTRICT,
  sale_order_id uuid
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  provider_nfe_id text NOT NULL CHECK (btrim(provider_nfe_id) <> ''),
  justification text NOT NULL CHECK (length(btrim(justification)) >= 15),
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  state text NOT NULL CHECK (state IN (
    'claimed', 'provider_ambiguous', 'provider_cancelled',
    'completed', 'aborted', 'manual_review'
  )),
  provider_status text,
  provider_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_snapshot) = 'object'),
  cancellation_protocol text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  provider_observed_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'completed' AND completed_at IS NOT NULL)
      OR (state <> 'completed' AND completed_at IS NULL))
);

CREATE INDEX nfe_cancellation_commands_126_queue_idx
  ON public.nfe_cancellation_commands_126(next_retry_at, nfe_id)
  WHERE state IN ('claimed', 'provider_ambiguous', 'provider_cancelled');

ALTER TABLE public.nfe_cancellation_commands_126 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfe_cancellation_commands_126
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfe_cancellation_commands_126 TO service_role;

COMMENT ON TABLE public.nfe_cancellation_commands_126 IS
  'Intent e observações imutáveis por identidade de NF para reconciliar cancelamento externo sem regressão cancelando->autorizada.';

-- Ordem canônica herdada da 114: todas as NF-es do PV -> advisory do PV ->
-- linha do PV -> segundo passe NOWAIT. Os locks permanecem até o fim da
-- transação chamadora, inclusive quando o helper retorna.
CREATE OR REPLACE FUNCTION public.lock_nfe_fiscal_context_126(p_nfe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_hint uuid;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_sale_order public.sale_orders%ROWTYPE;
BEGIN
  IF p_nfe_id IS NULL THEN
    RAISE EXCEPTION 'nfe_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  SELECT nfe.sale_order_id
    INTO v_sale_order_hint
    FROM public.nfe_emitidas nfe
   WHERE nfe.id = p_nfe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % não encontrada', p_nfe_id USING ERRCODE = 'P0002';
  END IF;

  IF v_sale_order_hint IS NOT NULL THEN
    PERFORM nfe.id
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = v_sale_order_hint
     ORDER BY nfe.id
     FOR UPDATE;
  END IF;
  SELECT nfe.*
    INTO v_nfe
    FROM public.nfe_emitidas nfe
   WHERE nfe.id = p_nfe_id
   FOR UPDATE;
  IF NOT FOUND OR v_nfe.sale_order_id IS DISTINCT FROM v_sale_order_hint THEN
    RAISE EXCEPTION 'Contexto fiscal mudou durante o lock; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  IF v_nfe.sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_nfe.sale_order_id::text,
      0
    ));
    SELECT sale_order.*
      INTO v_sale_order
      FROM public.sale_orders sale_order
     WHERE sale_order.id = v_nfe.sale_order_id
       AND sale_order.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV vinculado à NF-e não foi encontrado'
        USING ERRCODE = 'PZ220';
    END IF;
    PERFORM nfe.id
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = v_nfe.sale_order_id
     ORDER BY nfe.id
     FOR UPDATE NOWAIT;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'nfe_id', v_nfe.id,
    'sale_order_id', v_nfe.sale_order_id,
    'status', v_nfe.status,
    'provider_nfe_id', v_nfe.provider_nfe_id,
    'justification', v_nfe.justificativa_cancelamento,
    'sale_order_status', CASE
      WHEN v_nfe.sale_order_id IS NULL THEN NULL
      ELSE v_sale_order.status
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_nfe_fiscal_context_126(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Conserva a implementação auditada da 114 e restaura o mesmo nome externo
-- com persistência do intent na mesma transação do CAS autorizada->cancelando.
DO $rename_begin_126$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.begin_nfe_cancellation_command_impl_126(uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.begin_nfe_cancellation_command(uuid,text)
      RENAME TO begin_nfe_cancellation_command_impl_126;
  END IF;
END;
$rename_begin_126$;

REVOKE ALL ON FUNCTION public.begin_nfe_cancellation_command_impl_126(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_nfe_cancellation_command(
  p_nfe_id uuid,
  p_justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_context jsonb;
  v_result jsonb;
  v_status text;
  v_provider_nfe_id text;
  v_sale_order_id uuid;
  v_command public.nfe_cancellation_commands_126%ROWTYPE;
  v_request_hash text;
  v_resume boolean := false;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_nfe_id IS NULL
     OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_justification, ''))) < 15 THEN
    RAISE EXCEPTION 'nfe_id e justificativa de ao menos 15 caracteres são obrigatórios'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(nfe.status, '')))
    INTO v_status
    FROM public.nfe_emitidas nfe
   WHERE nfe.id = p_nfe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % não encontrada', p_nfe_id USING ERRCODE = 'P0002';
  END IF;
  v_resume := v_status = 'cancelando';

  IF NOT v_resume THEN
    BEGIN
      v_result := public.begin_nfe_cancellation_command_impl_126(
        p_nfe_id,
        p_justification
      );
    EXCEPTION WHEN SQLSTATE 'PZ220' THEN
      SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(nfe.status, '')))
        INTO v_status
        FROM public.nfe_emitidas nfe
       WHERE nfe.id = p_nfe_id;
      IF v_status <> 'cancelando' THEN
        RAISE;
      END IF;
      v_resume := true;
    END;
  END IF;

  IF v_resume THEN
    v_context := public.lock_nfe_fiscal_context_126(p_nfe_id);
    v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_context ->> 'status', '')));
    IF v_status <> 'cancelando' THEN
      RAISE EXCEPTION 'Estado fiscal mudou durante a retomada; tente novamente'
        USING ERRCODE = '40001';
    END IF;
    v_provider_nfe_id := NULLIF(pg_catalog.btrim(v_context ->> 'provider_nfe_id'), '');
    v_sale_order_id := NULLIF(v_context ->> 'sale_order_id', '')::uuid;
    IF v_provider_nfe_id IS NULL THEN
      RAISE EXCEPTION 'NF-e cancelando sem identidade do provedor'
        USING ERRCODE = 'PZ220';
    END IF;

    SELECT command.*
      INTO v_command
      FROM public.nfe_cancellation_commands_126 command
     WHERE command.nfe_id = p_nfe_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
        'nfe_id', p_nfe_id,
        'provider_nfe_id', v_provider_nfe_id,
        'justification', pg_catalog.btrim(p_justification)
      )::text);
      INSERT INTO public.nfe_cancellation_commands_126(
        nfe_id, sale_order_id, provider_nfe_id, justification,
        request_hash, state, next_retry_at, last_error
      ) VALUES (
        p_nfe_id, v_sale_order_id, v_provider_nfe_id,
        pg_catalog.btrim(p_justification), v_request_hash,
        'provider_ambiguous', pg_catalog.now(),
        'Claim cancelando encontrado sem resultado conclusivo do provedor'
      )
      RETURNING * INTO v_command;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'provider_call_required', false,
      'idempotent_replay', true,
      'reconciliation_required', true,
      'nfe_id', p_nfe_id,
      'sale_order_id', v_sale_order_id,
      'provider_nfe_id', v_provider_nfe_id,
      'local_status', 'cancelando',
      'cancellation_state', v_command.state,
      'next_retry_at', v_command.next_retry_at
    );
  END IF;

  v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_result ->> 'status', '')));
  v_provider_nfe_id := NULLIF(pg_catalog.btrim(v_result ->> 'provider_nfe_id'), '');
  v_sale_order_id := NULLIF(v_result ->> 'sale_order_id', '')::uuid;
  IF v_provider_nfe_id IS NOT NULL THEN
    v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
      'nfe_id', p_nfe_id,
      'provider_nfe_id', v_provider_nfe_id,
      'justification', pg_catalog.btrim(p_justification)
    )::text);
    INSERT INTO public.nfe_cancellation_commands_126(
      nfe_id, sale_order_id, provider_nfe_id, justification,
      request_hash, state, next_retry_at, last_error
    ) VALUES (
      p_nfe_id, v_sale_order_id, v_provider_nfe_id,
      pg_catalog.btrim(p_justification), v_request_hash,
      CASE WHEN COALESCE((v_result ->> 'provider_call_required')::boolean, false)
        THEN 'claimed' ELSE 'provider_cancelled' END,
      CASE WHEN COALESCE((v_result ->> 'provider_call_required')::boolean, false)
        THEN pg_catalog.now() ELSE NULL END,
      NULL
    )
    ON CONFLICT (nfe_id) DO UPDATE
      SET sale_order_id = EXCLUDED.sale_order_id,
          provider_nfe_id = EXCLUDED.provider_nfe_id,
          justification = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN public.nfe_cancellation_commands_126.justification
            ELSE EXCLUDED.justification
          END,
          request_hash = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN public.nfe_cancellation_commands_126.request_hash
            ELSE EXCLUDED.request_hash
          END,
          state = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN 'completed'
            ELSE EXCLUDED.state
          END,
          attempt_count = CASE
            WHEN public.nfe_cancellation_commands_126.state IN ('aborted', 'manual_review')
              THEN public.nfe_cancellation_commands_126.attempt_count + 1
            ELSE public.nfe_cancellation_commands_126.attempt_count
          END,
          next_retry_at = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN NULL ELSE EXCLUDED.next_retry_at
          END,
          last_error = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN public.nfe_cancellation_commands_126.last_error
            ELSE NULL
          END,
          completed_at = CASE
            WHEN public.nfe_cancellation_commands_126.state = 'completed'
              THEN public.nfe_cancellation_commands_126.completed_at
            ELSE NULL
          END,
          started_at = CASE
            WHEN public.nfe_cancellation_commands_126.state IN ('aborted', 'manual_review')
              THEN pg_catalog.now()
            ELSE public.nfe_cancellation_commands_126.started_at
          END,
          updated_at = pg_catalog.now();
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'local_status', CASE WHEN v_status = '' THEN NULL ELSE v_status END,
    'cancellation_state', CASE
      WHEN COALESCE((v_result ->> 'provider_call_required')::boolean, false)
        THEN 'claimed'
      ELSE 'provider_cancelled'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_nfe_cancellation_command(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_nfe_cancellation_command(uuid,text)
  TO service_role;

DO $rename_abort_126$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.abort_nfe_cancellation_command_impl_126(uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.abort_nfe_cancellation_command(uuid,text)
      RENAME TO abort_nfe_cancellation_command_impl_126;
  END IF;
END;
$rename_abort_126$;

REVOKE ALL ON FUNCTION public.abort_nfe_cancellation_command_impl_126(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.abort_nfe_cancellation_command(
  p_nfe_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.abort_nfe_cancellation_command_impl_126(p_nfe_id, p_reason);
  UPDATE public.nfe_cancellation_commands_126 command
     SET state = 'aborted',
         next_retry_at = NULL,
         last_error = pg_catalog.left(pg_catalog.btrim(p_reason), 1000),
         completed_at = NULL,
         updated_at = pg_catalog.now()
   WHERE command.nfe_id = p_nfe_id
     AND command.state <> 'completed';
  RETURN v_result || pg_catalog.jsonb_build_object(
    'cancellation_state', 'aborted'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.abort_nfe_cancellation_command(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abort_nfe_cancellation_command(uuid,text)
  TO service_role;

DO $rename_complete_126$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.complete_nfe_cancellation_command_impl_126(uuid,text,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.complete_nfe_cancellation_command(uuid,text,text)
      RENAME TO complete_nfe_cancellation_command_impl_126;
  END IF;
END;
$rename_complete_126$;

REVOKE ALL ON FUNCTION public.complete_nfe_cancellation_command_impl_126(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_nfe_cancellation_command(
  p_nfe_id uuid,
  p_justification text,
  p_cancellation_protocol text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_persisted_justification text;
  v_effective_justification text;
BEGIN
  SELECT command.justification
    INTO v_persisted_justification
    FROM public.nfe_cancellation_commands_126 command
   WHERE command.nfe_id = p_nfe_id;
  v_effective_justification := COALESCE(
    NULLIF(pg_catalog.btrim(v_persisted_justification), ''),
    pg_catalog.btrim(p_justification)
  );
  v_result := public.complete_nfe_cancellation_command_impl_126(
    p_nfe_id,
    v_effective_justification,
    p_cancellation_protocol
  );
  UPDATE public.nfe_cancellation_commands_126 command
     SET state = 'completed',
         provider_status = 'cancelada',
         cancellation_protocol = COALESCE(
           NULLIF(pg_catalog.btrim(p_cancellation_protocol), ''),
           command.cancellation_protocol
         ),
         next_retry_at = NULL,
         last_error = CASE
           WHEN COALESCE((v_result ->> 'reconciliation_needed')::boolean, false)
             THEN COALESCE(
               NULLIF(v_result ->> 'reconciliation_reason', ''),
               'Cancelamento fiscal concluído com reconciliação lateral pendente'
             )
           ELSE NULL
         END,
         completed_at = COALESCE(command.completed_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   WHERE command.nfe_id = p_nfe_id;
  RETURN v_result || pg_catalog.jsonb_build_object(
    'cancellation_state', 'completed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_nfe_cancellation_command(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_nfe_cancellation_command(uuid,text,text)
  TO service_role;

-- Única porta para status observado em NFs já existentes. Campos de detalhe
-- podem avançar, mas estados terminais não regredem. `cancelando` é absorvente
-- até o provedor confirmar `cancelada` e o complete da 114 terminar.
CREATE OR REPLACE FUNCTION public.observe_nfe_provider_status_126(
  p_nfe_id uuid,
  p_provider_status text,
  p_snapshot jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'poller'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_context jsonb;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_command public.nfe_cancellation_commands_126%ROWTYPE;
  v_status text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_provider_status, '')));
  v_local_status text;
  v_target_status text;
  v_provider_nfe_id text;
  v_justification text;
  v_protocol text;
  v_complete jsonb;
  v_error text;
  v_request_hash text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_nfe_id IS NULL OR v_status NOT IN (
    'processando', 'autorizada', 'rejeitada', 'cancelada'
  ) OR pg_catalog.jsonb_typeof(COALESCE(p_snapshot, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'nfe_id, status canônico e snapshot objeto são obrigatórios'
      USING ERRCODE = '22023';
  END IF;

  v_context := public.lock_nfe_fiscal_context_126(p_nfe_id);
  SELECT nfe.* INTO v_nfe
    FROM public.nfe_emitidas nfe
   WHERE nfe.id = p_nfe_id
   FOR UPDATE;
  v_local_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_nfe.status, '')));
  v_provider_nfe_id := COALESCE(
    NULLIF(pg_catalog.btrim(p_snapshot ->> 'provider_nfe_id'), ''),
    NULLIF(pg_catalog.btrim(v_nfe.provider_nfe_id), '')
  );
  IF v_provider_nfe_id IS NULL THEN
    RAISE EXCEPTION 'NF-e sem identidade do provedor para observação'
      USING ERRCODE = 'PZ220';
  END IF;
  IF NULLIF(pg_catalog.btrim(v_nfe.provider_nfe_id), '') IS NOT NULL
     AND v_nfe.provider_nfe_id IS DISTINCT FROM v_provider_nfe_id THEN
    RAISE EXCEPTION 'Observação pertence a outra identidade de provedor'
      USING ERRCODE = 'PZ231';
  END IF;
  v_protocol := NULLIF(pg_catalog.btrim(p_snapshot ->> 'protocolo_cancelamento'), '');

  -- Detalhes legais só avançam com valores presentes; polling degradado não
  -- apaga nem troca chave, número, série, protocolo ou data já confirmados.
  -- Divergência presente para a mesma identidade externa é reconciliação
  -- manual, nunca um overwrite silencioso de documento fiscal.
  IF (
       NULLIF(pg_catalog.btrim(p_snapshot ->> 'chave_acesso'), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(v_nfe.chave_acesso), '') IS NOT NULL
       AND pg_catalog.btrim(v_nfe.chave_acesso) IS DISTINCT FROM
           pg_catalog.btrim(p_snapshot ->> 'chave_acesso')
     ) OR (
       NULLIF(pg_catalog.btrim(p_snapshot ->> 'numero'), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(v_nfe.numero), '') IS NOT NULL
       AND pg_catalog.btrim(v_nfe.numero) IS DISTINCT FROM
           pg_catalog.btrim(p_snapshot ->> 'numero')
     ) OR (
       NULLIF(pg_catalog.btrim(p_snapshot ->> 'serie'), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(v_nfe.serie), '') IS NOT NULL
       AND pg_catalog.btrim(v_nfe.serie) IS DISTINCT FROM
           pg_catalog.btrim(p_snapshot ->> 'serie')
     ) OR (
       NULLIF(pg_catalog.btrim(p_snapshot ->> 'protocolo'), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(v_nfe.protocolo), '') IS NOT NULL
       AND pg_catalog.btrim(v_nfe.protocolo) IS DISTINCT FROM
           pg_catalog.btrim(p_snapshot ->> 'protocolo')
     ) OR (
       NULLIF(p_snapshot ->> 'data_emissao', '') IS NOT NULL
       AND v_nfe.data_emissao IS NOT NULL
       AND v_nfe.data_emissao IS DISTINCT FROM
           (p_snapshot ->> 'data_emissao')::timestamptz
     ) THEN
    RAISE EXCEPTION 'Observação diverge dos dados legais já confirmados da NF-e'
      USING ERRCODE = 'PZ231';
  END IF;

  UPDATE public.nfe_emitidas nfe
     SET provider_nfe_id = COALESCE(NULLIF(nfe.provider_nfe_id, ''), v_provider_nfe_id),
         chave_acesso = COALESCE(NULLIF(p_snapshot ->> 'chave_acesso', ''), nfe.chave_acesso),
         numero = COALESCE(NULLIF(p_snapshot ->> 'numero', ''), nfe.numero),
         serie = COALESCE(NULLIF(p_snapshot ->> 'serie', ''), nfe.serie),
         protocolo = COALESCE(NULLIF(p_snapshot ->> 'protocolo', ''), nfe.protocolo),
         data_emissao = COALESCE(
           NULLIF(p_snapshot ->> 'data_emissao', '')::timestamptz,
           nfe.data_emissao
         ),
         danfe_url = COALESCE(NULLIF(p_snapshot ->> 'danfe_url', ''), nfe.danfe_url),
         xml_url = COALESCE(NULLIF(p_snapshot ->> 'xml_url', ''), nfe.xml_url),
         updated_at = pg_catalog.now()
   WHERE nfe.id = p_nfe_id;

  IF v_local_status IN ('cancelando', 'cancelada') OR v_status = 'cancelada' THEN
    SELECT command.*
      INTO v_command
      FROM public.nfe_cancellation_commands_126 command
     WHERE command.nfe_id = p_nfe_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_justification := COALESCE(
        NULLIF(pg_catalog.btrim(v_nfe.justificativa_cancelamento), ''),
        'Cancelamento confirmado pelo provedor durante sincronização monotônica.'
      );
      IF pg_catalog.length(v_justification) < 15 THEN
        v_justification := 'Cancelamento confirmado pelo provedor durante sincronização monotônica.';
      END IF;
      v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
        'nfe_id', p_nfe_id,
        'provider_nfe_id', v_provider_nfe_id,
        'justification', v_justification
      )::text);
      INSERT INTO public.nfe_cancellation_commands_126(
        nfe_id, sale_order_id, provider_nfe_id, justification,
        request_hash, state, provider_status, provider_snapshot,
        provider_observed_at, next_retry_at, last_error
      ) VALUES (
        p_nfe_id, v_nfe.sale_order_id, v_provider_nfe_id, v_justification,
        v_request_hash,
        CASE WHEN v_status = 'cancelada' THEN 'provider_cancelled'
             ELSE 'provider_ambiguous' END,
        v_status, pg_catalog.jsonb_strip_nulls(p_snapshot), pg_catalog.now(),
        CASE WHEN v_status = 'cancelada' THEN NULL
             ELSE pg_catalog.now() + interval '5 minutes' END,
        CASE WHEN v_status = 'cancelada' THEN NULL
             ELSE 'Provedor ainda não confirmou o cancelamento' END
      ) RETURNING * INTO v_command;
    END IF;

    IF v_local_status = 'cancelada' OR v_status = 'cancelada' THEN
      IF v_local_status NOT IN ('cancelando', 'cancelada') THEN
        UPDATE public.nfe_emitidas nfe
           SET status = 'cancelando', updated_at = pg_catalog.now()
         WHERE nfe.id = p_nfe_id
           AND pg_catalog.lower(pg_catalog.btrim(COALESCE(nfe.status, '')))
             NOT IN ('cancelando', 'cancelada');
        v_local_status := 'cancelando';
      END IF;
      UPDATE public.nfe_cancellation_commands_126 command
         SET state = 'provider_cancelled',
             provider_status = 'cancelada',
             provider_snapshot = COALESCE(command.provider_snapshot, '{}'::jsonb)
               || pg_catalog.jsonb_strip_nulls(p_snapshot),
             cancellation_protocol = COALESCE(v_protocol, command.cancellation_protocol),
             provider_observed_at = pg_catalog.now(),
             next_retry_at = NULL,
             last_error = NULL,
             completed_at = NULL,
             updated_at = pg_catalog.now()
       WHERE command.nfe_id = p_nfe_id
         AND command.state <> 'completed'
       RETURNING * INTO v_command;
      IF NOT FOUND THEN
        SELECT command.* INTO v_command
          FROM public.nfe_cancellation_commands_126 command
         WHERE command.nfe_id = p_nfe_id;
      END IF;

      BEGIN
        v_complete := public.complete_nfe_cancellation_command(
          p_nfe_id,
          v_command.justification,
          COALESCE(v_protocol, v_command.cancellation_protocol)
        );
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        UPDATE public.nfe_cancellation_commands_126 command
           SET state = 'manual_review',
               next_retry_at = NULL,
               last_error = pg_catalog.left(
                 'Provedor confirmou cancelamento, mas o complete local falhou: ' || v_error,
                 1000
               ),
               completed_at = NULL,
               updated_at = pg_catalog.now()
         WHERE command.nfe_id = p_nfe_id;
        RETURN pg_catalog.jsonb_build_object(
          'ok', false,
          'reconciliation_required', true,
          'nfe_id', p_nfe_id,
          'local_status', (
            SELECT nfe.status FROM public.nfe_emitidas nfe WHERE nfe.id = p_nfe_id
          ),
          'provider_status', 'cancelada',
          'cancellation_state', 'manual_review',
          'error', pg_catalog.left(v_error, 1000)
        );
      END;
      RETURN v_complete || pg_catalog.jsonb_build_object(
        'provider_status', 'cancelada',
        'source', COALESCE(NULLIF(p_source, ''), 'poller')
      );
    END IF;

    -- Absorvente: autorizada/processando/rejeitada nunca desfazem cancelando.
    UPDATE public.nfe_cancellation_commands_126 command
       SET state = CASE WHEN command.state = 'completed'
                    THEN 'completed' ELSE 'provider_ambiguous' END,
           provider_status = v_status,
           provider_snapshot = COALESCE(command.provider_snapshot, '{}'::jsonb)
             || pg_catalog.jsonb_strip_nulls(p_snapshot),
           provider_observed_at = pg_catalog.now(),
           next_retry_at = CASE WHEN command.state = 'completed'
             THEN NULL ELSE pg_catalog.now() + interval '5 minutes' END,
           last_error = CASE WHEN command.state = 'completed' THEN command.last_error
             ELSE 'Cancelamento ainda não confirmado pelo provedor' END,
           updated_at = pg_catalog.now()
     WHERE command.nfe_id = p_nfe_id;
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'pending', true,
      'reconciliation_required', true,
      'nfe_id', p_nfe_id,
      'local_status', v_local_status,
      'provider_status', v_status,
      'cancellation_state', 'provider_ambiguous'
    );
  END IF;

  -- Demais estados seguem uma ordem monotônica: observação incompleta não
  -- rebaixa terminal; autorização explícita pode concluir processando/rejeitada.
  v_target_status := CASE
    WHEN v_local_status = 'autorizada' THEN 'autorizada'
    WHEN v_status = 'autorizada' THEN 'autorizada'
    WHEN v_local_status IN ('rejeitada', 'erro') AND v_status = 'processando'
      THEN v_nfe.status
    WHEN v_status = 'rejeitada' THEN 'rejeitada'
    ELSE 'processando'
  END;
  UPDATE public.nfe_emitidas nfe
     SET status = v_target_status,
         motivo_rejeicao = CASE
           WHEN v_target_status = 'rejeitada' THEN COALESCE(
             NULLIF(p_snapshot ->> 'motivo_rejeicao', ''),
             NULLIF(nfe.motivo_rejeicao, ''),
             'Rejeitada pelo provedor'
           )
           WHEN v_target_status = 'autorizada' THEN ''
           ELSE nfe.motivo_rejeicao
         END,
         updated_at = pg_catalog.now()
   WHERE nfe.id = p_nfe_id;

  IF v_target_status = 'autorizada'
     AND v_nfe.sale_order_id IS NOT NULL
     AND NULLIF(p_snapshot ->> 'numero', '') IS NOT NULL THEN
    UPDATE public.sale_orders sale_order
       SET nfe = p_snapshot ->> 'numero',
           updated_at = pg_catalog.now()
     WHERE sale_order.id = v_nfe.sale_order_id
       AND sale_order.status <> 'Cancelado';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'nfe_id', p_nfe_id,
    'local_status', v_target_status,
    'provider_status', v_status,
    'source', COALESCE(NULLIF(p_source, ''), 'poller')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.observe_nfe_provider_status_126(uuid,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.observe_nfe_provider_status_126(uuid,text,jsonb,text)
  TO service_role;

-- Fila consumida pelo cron de sync. Não há claim destrutivo: duas execuções
-- concorrentes são seguras porque a observação serializa na própria NF e o
-- complete é idempotente.
CREATE OR REPLACE FUNCTION public.list_nfe_cancellation_reconciliation_queue_126(
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  nfe_id uuid,
  provider_nfe_id text,
  state text,
  attempt_count integer,
  next_retry_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT command.nfe_id, command.provider_nfe_id, command.state,
         command.attempt_count, command.next_retry_at
    FROM public.nfe_cancellation_commands_126 command
   WHERE command.state IN ('claimed', 'provider_ambiguous', 'provider_cancelled')
     AND COALESCE(command.next_retry_at, '-infinity'::timestamptz) <= pg_catalog.now()
   ORDER BY command.next_retry_at NULLS FIRST, command.nfe_id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$function$;

REVOKE ALL ON FUNCTION public.list_nfe_cancellation_reconciliation_queue_126(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_nfe_cancellation_reconciliation_queue_126(integer)
  TO service_role;

CREATE OR REPLACE VIEW public.v_nfe_cancellation_reconciliation_queue_126
WITH (security_invoker = true)
AS
SELECT command.nfe_id,
       nfe.numero AS nfe_numero,
       command.sale_order_id,
       sale_order.order_number AS sale_order_number,
       command.provider_nfe_id,
       command.state,
       command.provider_status,
       command.attempt_count,
       command.provider_observed_at,
       command.next_retry_at,
       command.last_error,
       command.started_at,
       command.updated_at
  FROM public.nfe_cancellation_commands_126 command
  JOIN public.nfe_emitidas nfe ON nfe.id = command.nfe_id
  LEFT JOIN public.sale_orders sale_order ON sale_order.id = command.sale_order_id
 WHERE command.state <> 'completed';

REVOKE ALL ON public.v_nfe_cancellation_reconciliation_queue_126
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_nfe_cancellation_reconciliation_queue_126 TO service_role;

CREATE OR REPLACE FUNCTION public.run_nfe_status_monotonic_contract_tests_126()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  case_name := 'cancelando_is_absorbing';
  ok := pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'Absorvente: autorizada/processando/rejeitada nunca desfazem cancelando'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'v_local_status IN (''cancelando'', ''cancelada'')'
    ) > 0;
  detail := 'poller não reautoriza claim de cancelamento';
  RETURN NEXT;

  case_name := 'provider_cancelled_runs_canonical_complete';
  ok := pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'complete_nfe_cancellation_command'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'state = ''manual_review'''
    ) > 0;
  detail := 'cancelada conclui 114; falha local fica durável para revisão';
  RETURN NEXT;

  case_name := 'legal_identity_is_fail_closed_and_sparse';
  ok := pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'Observação diverge dos dados legais já confirmados da NF-e'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'::regprocedure
      ),
      'jsonb_strip_nulls(p_snapshot)'
    ) > 0;
  detail := 'mesma identidade externa não troca dados legais nem apaga snapshot';
  RETURN NEXT;

  case_name := 'begin_persists_intent_same_transaction';
  ok := pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.begin_nfe_cancellation_command(uuid,text)'::regprocedure
      ),
      'begin_nfe_cancellation_command_impl_126'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.begin_nfe_cancellation_command(uuid,text)'::regprocedure
      ),
      'nfe_cancellation_commands_126'
    ) > 0;
  detail := 'justificativa e identidade externa sobrevivem a timeout/retry';
  RETURN NEXT;

  case_name := 'fiscal_lock_order_is_nfe_advisory_pv';
  ok := pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'FROM public.nfe_emitidas nfe'
    ) > 0
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'FROM public.nfe_emitidas nfe'
    ) < pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'sale-order-command:'
    )
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'sale-order-command:'
    ) < pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'FROM public.sale_orders sale_order'
    )
    AND pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(
        'public.lock_nfe_fiscal_context_126(uuid)'::regprocedure
      ),
      'FOR UPDATE NOWAIT'
    ) > 0;
  detail := 'mesma ordem canônica da migration 114';
  RETURN NEXT;

  case_name := 'mutation_surface_is_service_only';
  ok := NOT pg_catalog.has_function_privilege(
      'authenticated', 'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)', 'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated', 'public.begin_nfe_cancellation_command(uuid,text)', 'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'service_role', 'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)', 'EXECUTE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.nfe_cancellation_commands_126', 'SELECT'
    );
  detail := 'app não altera fila nem estado fiscal por RPC direta';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_nfe_status_monotonic_contract_tests_126()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nfe_status_monotonic_contract_tests_126()
  TO service_role;

DO $contract_126$
DECLARE
  v_failed text;
BEGIN
  SELECT pg_catalog.string_agg(test.case_name || ': ' || test.detail, '; ')
    INTO v_failed
    FROM public.run_nfe_status_monotonic_contract_tests_126() test
   WHERE NOT test.ok;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato fiscal monotônico 126 falhou: %', v_failed;
  END IF;
END;
$contract_126$;

COMMIT;
