-- Fronteira transacional de order_stages.
--
-- Depois desta migration o browser apenas lê a tabela. Criação, edição e
-- exclusão passam por um command idempotente, com CAS e receipt. Os motores de
-- apontamento/onda que continuam vivos recebem wrappers estreitos; endpoints
-- redundantes são aposentados. Triggers internos só atravessam os guards por
-- marcadores explícitos do command que originou a transação.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Receipt e autorização do command de etapa
-- ---------------------------------------------------------------------------

ALTER TABLE public.operational_command_receipts
  DROP CONSTRAINT IF EXISTS operational_command_receipts_command_name_check;
ALTER TABLE public.operational_command_receipts
  ADD CONSTRAINT operational_command_receipts_command_name_check
  CHECK (command_name IN (
    'create_order', 'ensure_order_stages', 'transition_order',
    'cancel_order', 'delete_order', 'register_shipment',
    'force_sale_order_production', 'soft_delete_sale_order',
    'restore_sale_order', 'revert_invoiced_sale_order',
    'auto_promote_sale_order', 'auto_bill_sale_order',
    'create_order_stages', 'update_order_stage', 'delete_order_stage',
    'production_pointing', 'advance_wave_stage'
  ));

CREATE OR REPLACE FUNCTION public.can_execute_order_stage_command()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) = 'service_role' THEN
    RETURN true;
  END IF;

  RETURN public.can_execute_production_pointing();
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_order_stage_command()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Command único: create/update/delete, com lock, CAS e receipt
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_order_stage_command(
  p_command text,
  p_order_id uuid,
  p_stage_id uuid,
  p_expected_updated_at timestamptz,
  p_client_request_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_command_name text;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_actor_id uuid := auth.uid();
  v_aggregate_key text;
  v_request_hash text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_stage public.order_stages%ROWTYPE;
  v_stage_before public.order_stages%ROWTYPE;
  v_sale_order_id uuid;
  v_expected_quantity integer;
  v_expected_reference_id uuid;
  v_target_status text;
  v_actual_time numeric;
  v_route_result jsonb;
  v_result jsonb;
  v_previous_stage_internal text;
  v_previous_order_internal text;
BEGIN
  IF NOT public.can_execute_order_stage_command() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Permission denied: usuário sem permissão de edição para apontar produção';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;
  IF v_command NOT IN ('create', 'update', 'delete') THEN
    RAISE EXCEPTION 'Comando de etapa inválido: %', p_command
      USING ERRCODE = '22023';
  END IF;
  IF v_command = 'create' AND p_stage_id IS NOT NULL THEN
    RAISE EXCEPTION 'create não aceita stage_id'
      USING ERRCODE = '22023';
  END IF;
  IF v_command IN ('update', 'delete') AND p_stage_id IS NULL THEN
    RAISE EXCEPTION '% exige stage_id', v_command
      USING ERRCODE = '22004';
  END IF;
  IF v_command IN ('update', 'delete') AND p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION '% exige expected_updated_at para CAS', v_command
      USING ERRCODE = '22004';
  END IF;

  v_command_name := CASE v_command
    WHEN 'create' THEN 'create_order_stages'
    WHEN 'update' THEN 'update_order_stage'
    ELSE 'delete_order_stage'
  END;
  v_aggregate_key := CASE
    WHEN v_command = 'create'
      THEN 'production-order:' || p_order_id::text || ':stages'
    ELSE 'order-stage:' || p_stage_id::text
  END;
  v_request_hash := md5(jsonb_build_object(
    'command', v_command,
    'order_id', p_order_id,
    'stage_id', p_stage_id,
    'expected_updated_at', p_expected_updated_at,
    'payload', v_payload
  )::text);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name IS DISTINCT FROM v_command_name
       OR v_receipt.aggregate_key IS DISTINCT FROM v_aggregate_key
       OR v_receipt.request_hash IS DISTINCT FROM v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  -- A 111 estabelece época -> produtos para impedir ciclo com cálculo de OC.
  PERFORM public.lock_sale_order_purchase_allocation();

  -- Ordem global de locks: PV -> OP -> etapa. É a mesma dos boundaries 103,
  -- 104 e 108 e evita deadlock com promoção/faturamento automáticos.
  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    ));
    PERFORM 1
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_command IN ('update', 'delete') THEN
    SELECT * INTO v_stage_before
      FROM public.order_stages os
     WHERE os.id = p_stage_id
       AND os.order_id = p_order_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa % não encontrada na OP %', p_stage_id, p_order_id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_stage_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION
        'Etapa mudou simultaneamente; recarregue (esperado %, atual %)',
        p_expected_updated_at,
        v_stage_before.updated_at
        USING ERRCODE = '40001';
    END IF;
  END IF;

  v_previous_stage_internal := pg_catalog.current_setting(
    'app.order_stage_command_internal',
    true
  );
  v_previous_order_internal := pg_catalog.current_setting(
    'app.production_order_command_internal',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.order_stage_command_internal',
    '1',
    true
  );
  -- Compatibilidade estreita com ensure_production_order_stages_internal
  -- (boundary 108). Só este corpo SECURITY DEFINER controla a duração.
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    '1',
    true
  );

  BEGIN
    CASE v_command
      WHEN 'create' THEN
        IF EXISTS (
          SELECT 1
            FROM jsonb_object_keys(v_payload) AS payload_key(key)
           WHERE payload_key.key NOT IN (
             'expected_quantity', 'expected_reference_id'
           )
        ) THEN
          RAISE EXCEPTION 'Payload de create contém campo não permitido'
            USING ERRCODE = '22023';
        END IF;
        IF COALESCE(v_payload ->> 'expected_quantity', '') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'expected_quantity inteiro é obrigatório'
            USING ERRCODE = '22023';
        END IF;
        v_expected_quantity := (v_payload ->> 'expected_quantity')::integer;
        IF v_expected_quantity <= 0
           OR v_order.quantity IS DISTINCT FROM v_expected_quantity THEN
          RAISE EXCEPTION
            'Quantidade da OP mudou simultaneamente (esperado %, atual %)',
            v_expected_quantity,
            v_order.quantity
            USING ERRCODE = '40001';
        END IF;
        IF v_payload ? 'expected_reference_id'
           AND v_payload -> 'expected_reference_id' <> 'null'::jsonb THEN
          BEGIN
            v_expected_reference_id := NULLIF(
              btrim(v_payload ->> 'expected_reference_id'),
              ''
            )::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'expected_reference_id inválido'
              USING ERRCODE = '22023';
          END;
          IF v_expected_reference_id IS DISTINCT FROM v_order.reference_id THEN
            RAISE EXCEPTION 'Ficha técnica da OP mudou simultaneamente'
              USING ERRCODE = '40001';
          END IF;
        END IF;

        -- O servidor deriva quantidade e rota da OP/ficha viva. A função é
        -- naturalmente idempotente pelo UNIQUE(order_id, stage_name).
        v_route_result := public.ensure_production_order_stages_internal(
          p_order_id,
          false
        );
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'route', v_route_result
        );

      WHEN 'update' THEN
        IF v_payload = '{}'::jsonb THEN
          RAISE EXCEPTION 'Payload de update não pode ser vazio'
            USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1
            FROM jsonb_object_keys(v_payload) AS payload_key(key)
           WHERE payload_key.key NOT IN (
             'status', 'started_at', 'operator_employee_id',
             'observations', 'defects', 'actual_time_minutes'
           )
        ) THEN
          RAISE EXCEPTION
            'Update aceita apenas início, operário, observações, defeitos e tempo real; quantidade/finalização usam apontar_producao_setor'
            USING ERRCODE = '22023';
        END IF;

        IF v_payload ? 'status' THEN
          v_target_status := NULLIF(btrim(v_payload ->> 'status'), '');
          IF v_target_status <> 'em_andamento' THEN
            RAISE EXCEPTION
              'Transição genérica inválida; conclusão exige apontar_producao_setor'
              USING ERRCODE = '22023';
          END IF;
          IF v_stage_before.status <> 'pendente' THEN
            RAISE EXCEPTION
              'Etapa já mudou de status (esperado pendente, atual %)',
              v_stage_before.status
              USING ERRCODE = '40001';
          END IF;
        END IF;

        IF v_payload ? 'actual_time_minutes'
           AND v_payload -> 'actual_time_minutes' <> 'null'::jsonb THEN
          BEGIN
            v_actual_time := (v_payload ->> 'actual_time_minutes')::numeric;
          EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'actual_time_minutes inválido'
              USING ERRCODE = '22023';
          END;
          IF v_actual_time < 0 OR v_actual_time > 100000 THEN
            RAISE EXCEPTION 'actual_time_minutes fora da faixa permitida'
              USING ERRCODE = '22023';
          END IF;
        END IF;
        IF length(COALESCE(v_payload ->> 'observations', '')) > 5000
           OR length(COALESCE(v_payload ->> 'defects', '')) > 5000 THEN
          RAISE EXCEPTION 'Observações/defeitos excedem 5000 caracteres'
            USING ERRCODE = '22023';
        END IF;

        UPDATE public.order_stages os
           SET status = CASE
                 WHEN v_payload ? 'status' THEN v_target_status
                 ELSE os.status
               END,
               -- Hora de início é autoridade do servidor. O campo do cliente
               -- existe só por compatibilidade com callers antigos.
               started_at = CASE
                 WHEN v_target_status = 'em_andamento'
                   THEN COALESCE(os.started_at, pg_catalog.now())
                 ELSE os.started_at
               END,
               operator_employee_id = CASE
                 WHEN v_payload ? 'operator_employee_id'
                   THEN NULLIF(v_payload ->> 'operator_employee_id', '')::uuid
                 ELSE os.operator_employee_id
               END,
               observations = CASE
                 WHEN v_payload ? 'observations'
                   THEN COALESCE(v_payload ->> 'observations', '')
                 ELSE os.observations
               END,
               defects = CASE
                 WHEN v_payload ? 'defects'
                   THEN COALESCE(v_payload ->> 'defects', '')
                 ELSE os.defects
               END,
               actual_time_minutes = CASE
                 WHEN v_payload ? 'actual_time_minutes' THEN v_actual_time
                 ELSE os.actual_time_minutes
               END,
               updated_at = pg_catalog.now()
         WHERE os.id = p_stage_id
           AND os.order_id = p_order_id
           AND os.updated_at = p_expected_updated_at
        RETURNING os.* INTO v_stage;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Etapa mudou simultaneamente; recarregue'
            USING ERRCODE = '40001';
        END IF;
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'stage_id', p_stage_id,
          'stage', to_jsonb(v_stage)
        );

      WHEN 'delete' THEN
        IF v_payload <> '{}'::jsonb THEN
          RAISE EXCEPTION 'delete não aceita payload'
            USING ERRCODE = '22023';
        END IF;
        IF v_stage_before.status <> 'pendente'
           OR COALESCE(v_stage_before.quantity_processed, 0) <> 0 THEN
          RAISE EXCEPTION
            'Etapa iniciada/apontada não pode ser excluída; preserve o histórico'
            USING ERRCODE = 'PZ220';
        END IF;

        DELETE FROM public.order_stages os
         WHERE os.id = p_stage_id
           AND os.order_id = p_order_id
           AND os.updated_at = p_expected_updated_at;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Etapa mudou simultaneamente; recarregue'
            USING ERRCODE = '40001';
        END IF;
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'stage_id', p_stage_id,
          'deleted', true,
          'stage_before', to_jsonb(v_stage_before)
        );
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.order_stage_command_internal',
      COALESCE(v_previous_stage_internal, ''),
      true
    );
    PERFORM pg_catalog.set_config(
      'app.production_order_command_internal',
      COALESCE(v_previous_order_internal, ''),
      true
    );
    RAISE;
  END;

  PERFORM pg_catalog.set_config(
    'app.order_stage_command_internal',
    COALESCE(v_previous_stage_internal, ''),
    true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    COALESCE(v_previous_order_internal, ''),
    true
  );

  -- Triggers de auto-promoção, auto-faturamento, auto-finalização e baixa de
  -- reservas já executaram antes daqui. Qualquer falha neles aborta esta mesma
  -- transação e portanto também elimina a mutação e o receipt.
  INSERT INTO public.operational_command_receipts (
    command_name,
    aggregate_key,
    client_request_id,
    request_hash,
    actor_id,
    response
  ) VALUES (
    v_command_name,
    v_aggregate_key,
    p_client_request_id,
    v_request_hash,
    v_actor_id,
    v_result
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource,
    resource_id,
    old_data,
    new_data,
    success,
    created_at
  ) VALUES (
    v_actor_id,
    'order_stage_command_' || v_command,
    'order_stages',
    p_stage_id,
    CASE
      WHEN v_command IN ('update', 'delete') THEN to_jsonb(v_stage_before)
      ELSE NULL
    END,
    v_result,
    true,
    pg_catalog.now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_order_stage_command(
  text, uuid, uuid, timestamptz, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_order_stage_command(
  text, uuid, uuid, timestamptz, uuid, jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_order_stage_command(
  text, uuid, uuid, timestamptz, uuid, jsonb
) IS
  'CRUD transacional de order_stages com RBAC de apontamento, locks PV->OP->etapa, CAS, receipt e auditoria.';

-- ---------------------------------------------------------------------------
-- 3) Cutover da tabela e guards sem pg_trigger_depth
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_enforce_order_stage_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) = 'service_role'
     OR COALESCE(
       pg_catalog.current_setting('app.order_stage_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'DML direto em order_stages foi encerrado; use execute_order_stage_command ou apontar_producao_setor'
    USING ERRCODE = 'PZ220';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_order_stage_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_enforce_order_stage_command_boundary
  ON public.order_stages;
CREATE TRIGGER trg_000_enforce_order_stage_command_boundary
BEFORE INSERT OR UPDATE OR DELETE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_order_stage_command_boundary();

-- O guard de orders criado em 108 não pode aceitar todo trigger aninhado. A
-- etapa canônica recebe um marcador próprio e as demais origens continuam nos
-- dois boundaries já existentes.
CREATE OR REPLACE FUNCTION public.tg_enforce_production_order_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) = 'service_role'
     OR COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.order_stage_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'DML direto em orders foi encerrado; use execute_production_order_command'
    USING ERRCODE = 'PZ215';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_production_order_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

-- Policies de SELECT são preservadas. Apenas policies de escrita históricas
-- são removidas.
DO $drop_order_stage_write_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT pol.polname
      FROM pg_catalog.pg_policy pol
     WHERE pol.polrelid = 'public.order_stages'::regclass
       AND pol.polcmd <> 'r'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.order_stages',
      v_policy.polname
    );
  END LOOP;
END;
$drop_order_stage_write_policies$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.order_stages
  FROM PUBLIC, anon, authenticated;

-- REVOKE da tabela não elimina grants por coluna já concedidos.
DO $revoke_order_stage_column_writes$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_stages'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.order_stages FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.order_stages FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE REFERENCES (%s) ON TABLE public.order_stages FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END;
$revoke_order_stage_column_writes$;

GRANT SELECT ON TABLE public.order_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_stages TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Apontamento e onda: wrappers estreitos; RPCs redundantes aposentadas
-- ---------------------------------------------------------------------------

-- O impl histórico soma quantidade. Por isso um retry sem identidade é
-- materialmente perigoso: o mesmo apontamento seria lançado duas vezes. Esta
-- é a única superfície pública e exige request id + CAS da etapa.
CREATE OR REPLACE FUNCTION public.execute_production_pointing_command(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid,
  p_note text,
  p_finalize boolean,
  p_confirmed_warnings text[],
  p_expected_stage_updated_at timestamptz,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_stage_internal text;
  v_previous_order_internal text;
  v_sale_order_id uuid;
  v_actor_id uuid := auth.uid();
  v_stage public.order_stages%ROWTYPE;
  v_aggregate_key text;
  v_request_hash text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Permission denied: usuário sem permissão de edição para apontar produção';
  END IF;
  IF p_order_id IS NULL OR NULLIF(btrim(COALESCE(p_stage_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'order_id e stage_name são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF p_client_request_id IS NULL OR p_expected_stage_updated_at IS NULL THEN
    RAISE EXCEPTION 'client_request_id e expected_stage_updated_at são obrigatórios'
      USING ERRCODE = '22004';
  END IF;

  v_aggregate_key := 'production-order:' || p_order_id::text
    || ':stage:' || lower(btrim(p_stage_name));
  v_request_hash := md5(jsonb_build_object(
    'order_id', p_order_id,
    'stage_name', p_stage_name,
    'quantity', p_quantity,
    'operator_employee_id', p_operator_employee_id,
    'note', p_note,
    'finalize', COALESCE(p_finalize, false),
    'confirmed_warnings', p_confirmed_warnings,
    'expected_stage_updated_at', p_expected_stage_updated_at
  )::text);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'production_pointing'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro apontamento/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();

  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    ));
    PERFORM 1
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  PERFORM 1
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT os.* INTO v_stage
    FROM public.order_stages os
   WHERE os.order_id = p_order_id
     AND public.canonical_stage_name(os.stage_name)
         = public.canonical_stage_name(p_stage_name)
   ORDER BY (os.stage_name = p_stage_name) DESC, os.stage_order, os.id
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa % não encontrada na OP %', p_stage_name, p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_stage.updated_at IS DISTINCT FROM p_expected_stage_updated_at THEN
    RAISE EXCEPTION
      'Etapa mudou simultaneamente; recarregue (esperado %, atual %)',
      p_expected_stage_updated_at,
      v_stage.updated_at
      USING ERRCODE = '40001';
  END IF;

  v_previous_stage_internal := pg_catalog.current_setting(
    'app.order_stage_command_internal', true
  );
  v_previous_order_internal := pg_catalog.current_setting(
    'app.production_order_command_internal', true
  );
  PERFORM pg_catalog.set_config('app.order_stage_command_internal', '1', true);
  PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);
  BEGIN
    v_result := public.apontar_producao_setor_impl(
      p_order_id,
      p_stage_name,
      p_quantity,
      p_operator_employee_id,
      p_note,
      p_finalize,
      p_confirmed_warnings
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.order_stage_command_internal',
      COALESCE(v_previous_stage_internal, ''),
      true
    );
    PERFORM pg_catalog.set_config(
      'app.production_order_command_internal',
      COALESCE(v_previous_order_internal, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.order_stage_command_internal',
    COALESCE(v_previous_stage_internal, ''),
    true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    COALESCE(v_previous_order_internal, ''),
    true
  );

  -- O impl garante que needs_confirmation não grava nada. Não persistimos um
  -- receipt de preflight: o mesmo request id pode voltar com os códigos
  -- confirmados, ainda sob o mesmo CAS, e só então virar fato idempotente.
  IF COALESCE((v_result ->> 'needs_confirmation')::boolean, false) THEN
    RETURN v_result;
  END IF;

  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'production_pointing', v_aggregate_key, p_client_request_id, v_request_hash,
    v_actor_id, v_result
  );
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data,
    success, created_at
  ) VALUES (
    v_actor_id,
    'production_pointing_command',
    'order_stages',
    v_stage.id,
    to_jsonb(v_stage),
    v_result,
    true,
    pg_catalog.now()
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid
) TO authenticated, service_role;

-- A assinatura sem request id fica somente para dependências SQL do owner. O
-- browser e service_role não podem mais somar quantidade fora do receipt.
REVOKE ALL ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) FROM PUBLIC, anon, authenticated, service_role;

-- O corpo histórico da onda vira impl privado. O command trava todos os PVs,
-- depois todas as OPs e só então a onda/etapas, sempre em ordem determinística.
-- Essa é a mesma ordem dos commands unitários e evita o ciclo onda -> PV contra
-- PV -> OP -> etapa -> onda dos triggers de conclusão.
ALTER FUNCTION public.advance_wave_stage(uuid, public.production_stage_enum)
  RENAME TO advance_wave_stage_impl_113;
REVOKE ALL ON FUNCTION public.advance_wave_stage_impl_113(
  uuid, public.production_stage_enum
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.execute_production_wave_stage_command(
  p_wave_id uuid,
  p_expected_stage public.production_stage_enum,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_stage_internal text;
  v_actor_id uuid := auth.uid();
  v_wave public.production_waves%ROWTYPE;
  v_target_status public.stage_status_enum;
  v_next_stage public.production_stage_enum;
  v_scope record;
  v_scope_sale_order_ids uuid[] := '{}'::uuid[];
  v_current_sale_order_ids uuid[] := '{}'::uuid[];
  v_scope_order_ids uuid[] := '{}'::uuid[];
  v_current_order_ids uuid[] := '{}'::uuid[];
  v_request_hash text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Permission denied: usuário sem permissão de edição para avançar onda';
  END IF;
  IF p_wave_id IS NULL OR p_expected_stage IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'wave_id, expected_stage e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'wave_id', p_wave_id,
    'expected_stage', p_expected_stage
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'advance_wave_stage'
       OR v_receipt.aggregate_key <> 'production-wave:' || p_wave_id::text
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outra onda/etapa'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();

  -- O snapshot inicial serve apenas para descobrir a ordem dos locks. Depois de
  -- travar a onda e suas linhas de composição, o escopo é relido e comparado.
  SELECT COALESCE(
           pg_catalog.array_agg(scope_row.id ORDER BY scope_row.id),
           '{}'::uuid[]
         )
    INTO v_scope_sale_order_ids
    FROM (
      SELECT DISTINCT pwis.sale_order_id AS id
      FROM public.production_wave_items pwi
      JOIN public.production_wave_item_sources pwis
        ON pwis.wave_item_id = pwi.id
     WHERE pwi.wave_id = p_wave_id
       AND pwis.sale_order_id IS NOT NULL
    ) AS scope_row;

  -- Ordem global: PV -> OP -> onda -> etapas. Nenhum GUC interno é aberto
  -- antes de todo o agregado estar serializado.
  FOR v_scope IN
    SELECT scope_id AS id
      FROM pg_catalog.unnest(v_scope_sale_order_ids) AS scope_ids(scope_id)
     ORDER BY scope_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_scope.id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.sale_orders so
   WHERE so.id = ANY(v_scope_sale_order_ids)
   ORDER BY so.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_row.id ORDER BY scope_row.id),
           '{}'::uuid[]
         )
    INTO v_scope_order_ids
    FROM (
      SELECT o.id
        FROM public.orders o
       WHERE o.deleted_at IS NULL
         AND o.sale_order_id = ANY(v_scope_sale_order_ids)
    ) AS scope_row;

  FOR v_scope IN
    SELECT scope_id AS id
      FROM pg_catalog.unnest(v_scope_order_ids) AS scope_ids(scope_id)
     ORDER BY scope_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'production-order:' || v_scope.id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.orders o
   WHERE o.id = ANY(v_scope_order_ids)
   ORDER BY o.id
   FOR UPDATE;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-wave:' || p_wave_id::text,
    0
  ));
  SELECT * INTO v_wave
    FROM public.production_waves pw
   WHERE pw.id = p_wave_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onda % não encontrada', p_wave_id
      USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1
    FROM public.production_wave_items pwi
   WHERE pwi.wave_id = p_wave_id
   ORDER BY pwi.id
   FOR UPDATE;
  PERFORM 1
    FROM public.production_wave_item_sources pwis
   WHERE pwis.wave_item_id IN (
     SELECT pwi.id
       FROM public.production_wave_items pwi
      WHERE pwi.wave_id = p_wave_id
   )
   ORDER BY pwis.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_row.id ORDER BY scope_row.id),
           '{}'::uuid[]
         )
    INTO v_current_sale_order_ids
    FROM (
      SELECT DISTINCT pwis.sale_order_id AS id
        FROM public.production_wave_items pwi
        JOIN public.production_wave_item_sources pwis
          ON pwis.wave_item_id = pwi.id
       WHERE pwi.wave_id = p_wave_id
         AND pwis.sale_order_id IS NOT NULL
    ) AS scope_row;
  IF v_current_sale_order_ids IS DISTINCT FROM v_scope_sale_order_ids THEN
    RAISE EXCEPTION 'Escopo de PVs da onda mudou durante o avanço; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_row.id ORDER BY scope_row.id),
           '{}'::uuid[]
         )
    INTO v_current_order_ids
    FROM (
      SELECT o.id
        FROM public.orders o
       WHERE o.deleted_at IS NULL
         AND o.sale_order_id = ANY(v_scope_sale_order_ids)
    ) AS scope_row;
  IF v_current_order_ids IS DISTINCT FROM v_scope_order_ids THEN
    RAISE EXCEPTION 'Escopo de OPs da onda mudou durante o avanço; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  SELECT pws.status INTO v_target_status
    FROM public.production_wave_stages pws
   WHERE pws.wave_id = p_wave_id
     AND pws.stage = p_expected_stage
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa % não existe na onda %', p_expected_stage, p_wave_id
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.order_stages os
   WHERE os.order_id = ANY(v_scope_order_ids)
   ORDER BY os.order_id, os.id
   FOR UPDATE;

  IF v_target_status = 'completed' THEN
    v_result := jsonb_build_object(
      'ok', true,
      'wave_id', p_wave_id,
      'expected_stage', p_expected_stage,
      'already_completed', true,
      'next_stage', v_wave.current_stage
    );
  ELSE
    IF v_wave.current_stage IS DISTINCT FROM p_expected_stage
       OR v_wave.status IN ('finished', 'cancelled')
       OR v_target_status <> 'in_progress' THEN
      RAISE EXCEPTION
        'Etapa da onda mudou simultaneamente (onda %, etapa %, status %)',
        v_wave.status,
        p_expected_stage,
        v_target_status
        USING ERRCODE = '40001';
    END IF;

    v_previous_stage_internal := pg_catalog.current_setting(
      'app.order_stage_command_internal', true
    );
    PERFORM pg_catalog.set_config('app.order_stage_command_internal', '1', true);
    BEGIN
      v_next_stage := public.advance_wave_stage_impl_113(
        p_wave_id,
        p_expected_stage
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config(
        'app.order_stage_command_internal',
        COALESCE(v_previous_stage_internal, ''),
        true
      );
      RAISE;
    END;
    PERFORM pg_catalog.set_config(
      'app.order_stage_command_internal',
      COALESCE(v_previous_stage_internal, ''),
      true
    );
    v_result := jsonb_build_object(
      'ok', true,
      'wave_id', p_wave_id,
      'expected_stage', p_expected_stage,
      'next_stage', v_next_stage
    );
  END IF;

  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'advance_wave_stage',
    'production-wave:' || p_wave_id::text,
    p_client_request_id,
    v_request_hash,
    v_actor_id,
    v_result
  );
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data,
    success, created_at
  ) VALUES (
    v_actor_id,
    'advance_wave_stage_command',
    'production_waves',
    p_wave_id,
    to_jsonb(v_wave),
    v_result,
    true,
    pg_catalog.now()
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_production_wave_stage_command(
  uuid, public.production_stage_enum, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_production_wave_stage_command(
  uuid, public.production_stage_enum, uuid
) TO authenticated, service_role;

-- Compatibilidade de deploy: versões anteriores do frontend ainda chegam à
-- assinatura antiga, mas ela apenas delega ao command com request determinístico.
CREATE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage public.production_stage_enum DEFAULT NULL
)
RETURNS public.production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_request_id uuid;
BEGIN
  IF p_stage IS NULL THEN
    RAISE EXCEPTION 'stage explícito é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  v_request_id := md5(
    'legacy-wave-stage:' || p_wave_id::text || ':' || p_stage::text || ':'
    || COALESCE(auth.uid()::text, 'service_role')
  )::uuid;
  v_result := public.execute_production_wave_stage_command(
    p_wave_id,
    p_stage,
    v_request_id
  );
  RETURN NULLIF(v_result ->> 'next_stage', '')::public.production_stage_enum;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_wave_stage(
  uuid, public.production_stage_enum
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_wave_stage(
  uuid, public.production_stage_enum
) TO authenticated, service_role;

-- Sem caller vivo: finalizar passa pelo ledger apontar_producao_setor;
-- complete/start eram atalhos approved-only que furavam o RBAC granular.
REVOKE ALL ON FUNCTION public.complete_order_stages_bulk(uuid, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_production_sector(
  uuid, text, integer, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_production_prep_parallel(uuid)
  FROM PUBLIC, anon, authenticated;

-- Trigger functions não são endpoints. Revogar EXECUTE não impede o trigger e
-- elimina a superfície SECURITY DEFINER acidental.
REVOKE ALL ON FUNCTION public.sync_order_stages_with_kanban()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_close_stages_on_op_finalize()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_sale_order_creates_ops_on_production()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_sync_orders_from_sale_order_item()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.auto_finalize_order_on_all_stages_done()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Contrato live, somente leitura
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_order_stage_command_contract_tests()
RETURNS TABLE(case_name text, passed boolean, details text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execute text;
  v_stage_guard text;
  v_order_guard text;
  v_pointing text;
  v_wave text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION 'Contratos de etapa exigem Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  v_execute := pg_catalog.pg_get_functiondef(
    'public.execute_order_stage_command(text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure
  );
  v_stage_guard := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_order_stage_command_boundary()'::regprocedure
  );
  v_order_guard := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_production_order_command_boundary()'::regprocedure
  );
  v_pointing := pg_catalog.pg_get_functiondef(
    'public.execute_production_pointing_command(uuid,text,integer,uuid,text,boolean,text[],timestamptz,uuid)'::regprocedure
  );
  v_wave := pg_catalog.pg_get_functiondef(
    'public.execute_production_wave_stage_command(uuid,public.production_stage_enum,uuid)'::regprocedure
  );

  case_name := 'order_stages_acl_cutover';
  passed := NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.order_stages', 'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.order_stages', 'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.order_stages', 'DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.order_stages', 'TRUNCATE'
    )
    AND pg_catalog.has_table_privilege(
      'authenticated', 'public.order_stages', 'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.order_stages'::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND (
           pg_catalog.has_column_privilege(
             'authenticated', 'public.order_stages', a.attname, 'INSERT'
           )
           OR pg_catalog.has_column_privilege(
             'authenticated', 'public.order_stages', a.attname, 'UPDATE'
           )
           OR pg_catalog.has_column_privilege(
             'authenticated', 'public.order_stages', a.attname, 'REFERENCES'
           )
         )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_policy pol
       WHERE pol.polrelid = 'public.order_stages'::regclass
         AND pol.polcmd <> 'r'
    );
  details := 'Browser mantém SELECT; tabela, colunas e RLS não expõem I/U/D.';
  RETURN NEXT;

  case_name := 'order_stage_command_surface';
  passed := pg_catalog.has_function_privilege(
      'authenticated',
      'public.execute_order_stage_command(text,uuid,uuid,timestamptz,uuid,jsonb)',
      'EXECUTE'
    )
    AND position('public.can_execute_order_stage_command()' IN v_execute) > 0
    AND position('public.can_execute_production_pointing()' IN pg_catalog.pg_get_functiondef(
      'public.can_execute_order_stage_command()'::regprocedure
    )) > 0
    AND position('operational_command_receipts' IN v_execute) > 0
    AND position('p_expected_updated_at' IN v_execute) > 0
    AND position('FOR UPDATE' IN v_execute) > 0
    AND position('pg_advisory_xact_lock' IN v_execute) > 0
    AND position('app.order_stage_command_internal' IN v_execute) > 0;
  details := 'CRUD tem RBAC de apontamento, lock, CAS, marker e receipt.';
  RETURN NEXT;

  case_name := 'guards_are_explicit_not_trigger_depth';
  passed := position('pg_trigger_depth' IN v_stage_guard) = 0
    AND position('pg_trigger_depth' IN v_order_guard) = 0
    AND position('app.order_stage_command_internal' IN v_stage_guard) > 0
    AND position('app.production_order_command_internal' IN v_stage_guard) > 0
    AND position('app.sale_order_command_internal' IN v_stage_guard) > 0
    AND position('app.order_stage_command_internal' IN v_order_guard) > 0;
  details := 'Triggers atravessam os boundaries apenas por GUCs internos explícitos.';
  RETURN NEXT;

  case_name := 'legacy_stage_writers_closed';
  passed := NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.complete_order_stages_bulk(uuid,text[])',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.finalize_production_sector(uuid,text,integer,uuid)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.start_production_prep_parallel(uuid)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.apontar_producao_setor(uuid,text,integer,uuid,text,boolean,text[])',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'authenticated',
      'public.execute_production_pointing_command(uuid,text,integer,uuid,text,boolean,text[],timestamptz,uuid)',
      'EXECUTE'
    )
    AND position('public.can_execute_production_pointing()' IN v_pointing) > 0
    AND position('app.order_stage_command_internal' IN v_pointing) > 0
    AND position('operational_command_receipts' IN v_pointing) > 0
    AND position('p_expected_stage_updated_at' IN v_pointing) > 0
    AND position('public.can_execute_production_pointing()' IN v_wave) > 0
    AND position('app.order_stage_command_internal' IN v_wave) > 0
    AND position('operational_command_receipts' IN v_wave) > 0
    AND position('production-wave:' IN v_wave) > 0
    AND position('sale-order-command:' IN v_wave) > 0
    AND position('production-order:' IN v_wave) > 0
    AND position('v_target_status <> ''in_progress''' IN v_wave) > 0
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.advance_wave_stage_impl_113(uuid,public.production_stage_enum)',
      'EXECUTE'
    );
  details := 'Apontamento/onda têm receipt, CAS e escopo travado; atalhos redundantes estão revogados.';
  RETURN NEXT;

  case_name := 'stage_automation_is_same_transaction';
  passed := EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.order_stages'::regclass
         AND t.tgname = 'trg_auto_finalize_order'
         AND t.tgenabled <> 'D'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.order_stages'::regclass
         AND t.tgname = 'trg_auto_bill_sale_order_on_finishing'
         AND t.tgenabled <> 'D'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.orders'::regclass
         AND t.tgname = 'trg_aa_settle_reservations_on_finalize'
         AND t.tgenabled <> 'D'
    )
    AND position('operational_command_receipts' IN v_execute) > 0;
  details := 'Finalize, bill e settle disparam antes do receipt; erro reverte a transação inteira.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_order_stage_command_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_order_stage_command_contract_tests()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.run_order_stage_command_contract_tests() IS
  'Guard live do boundary de order_stages, sem mutação de dados.';

COMMIT;

NOTIFY pgrst, 'reload schema';
