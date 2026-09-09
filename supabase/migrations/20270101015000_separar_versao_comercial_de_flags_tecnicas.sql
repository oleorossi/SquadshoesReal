-- Separa a revisão otimista do agregado editável de PV dos flags assíncronos
-- de custo/reserva.
--
-- Incidente PV-00162 (30/08/2026): o formulário carregou order_version=46.
-- Uma alteração de ficha marcou costs_dirty_at e reservations_outdated_at
-- (versões 47/48); os crons limparam os dois flags (49/50). Nenhum campo do
-- PV, item ou OP mudou, mas o preflight recusou a edição como concorrente.
--
-- Contrato após esta migration:
--   * cabeçalho comercial/operacional real avança order_version;
--   * INSERT/UPDATE/DELETE de item continua avançando via GUC explícito;
--   * updated_at/search_norm e os dois flags derivados não avançam a versão;
--   * a marcação de dirty ainda emite UM evento por transação, necessário para
--     recompor compras; a limpeza dos crons não produz fan-out;
--   * override de readiness fica ligado ao hash material e à assinatura exata
--     dos blockers técnicos que o administrador decidiu relevar;
--   * o editor lê cabeçalho, itens e versão no mesmo snapshot SQL.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. order_version representa somente o agregado editável
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_bump_sale_order_order_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- O touch de item altera somente updated_at no pai. O marcador é a prova de
  -- que houve mudança no agregado-filho e, por isso, vence a lista de campos
  -- derivados abaixo.
  IF current_setting('app.sale_order_version_touch', true) = '1' THEN
    NEW.order_version := OLD.order_version + 1;
    RETURN NEW;
  END IF;

  -- O cliente nunca escolhe a versão. Se apenas metadados/flags derivados
  -- mudaram, restaura a versão anterior; qualquer outra diferença avança 1.
  IF (
    to_jsonb(NEW) - ARRAY[
      'order_version',
      'updated_at',
      'search_norm',
      'costs_dirty_at',
      'reservations_outdated_at'
    ]
  ) IS NOT DISTINCT FROM (
    to_jsonb(OLD) - ARRAY[
      'order_version',
      'updated_at',
      'search_norm',
      'costs_dirty_at',
      'reservations_outdated_at'
    ]
  ) THEN
    NEW.order_version := OLD.order_version;
  ELSE
    NEW.order_version := OLD.order_version + 1;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_bump_sale_order_order_version()
  FROM PUBLIC, anon, authenticated, service_role;

-- Um item movido entre PVs pertenceu a dois agregados na mesma escrita. A
-- implementação fundadora usava COALESCE(NEW.sale_order_id, OLD.sale_order_id)
-- e tocava somente o destino; aqui ambos recebem a revisão correspondente.
CREATE OR REPLACE FUNCTION public.tg_touch_sale_order_version_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid;
  v_old_sale_order_id uuid;
  v_new_sale_order_id uuid;
  v_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_sale_order_id := OLD.sale_order_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_sale_order_id := NEW.sale_order_id;
  END IF;

  v_previous := current_setting('app.sale_order_version_touch', true);
  PERFORM set_config('app.sale_order_version_touch', '1', true);

  FOR v_sale_order_id IN
    SELECT DISTINCT candidate
      FROM unnest(ARRAY[v_old_sale_order_id, v_new_sale_order_id]) AS candidate
     WHERE candidate IS NOT NULL
     ORDER BY candidate
  LOOP
    UPDATE public.sale_orders
       SET updated_at = GREATEST(updated_at, now())
     WHERE id = v_sale_order_id;
  END LOOP;

  PERFORM set_config(
    'app.sale_order_version_touch',
    COALESCE(v_previous, ''),
    true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_touch_sale_order_version_from_item()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Evento causal de material sem ruído dos crons
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_record_passive_sale_order_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text;
  v_key text;
  v_hash text;
  v_receipt_id uuid;
  v_technical_invalidation boolean := false;
BEGIN
  IF current_setting('app.sale_order_command_internal', true) = '1'
     OR current_setting('app.sale_order_version_touch', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.order_version IS NOT DISTINCT FROM OLD.order_version THEN
    -- Marcar um flag dirty significa que cadastro mestre alterou o plano e a
    -- compra automática precisa recompor. Os dois UPDATEs da mesma transação
    -- colidem na mesma idempotency_key e publicam um único evento.
    v_technical_invalidation := (
      NEW.costs_dirty_at IS NOT NULL
      AND NEW.costs_dirty_at IS DISTINCT FROM OLD.costs_dirty_at
    ) OR (
      NEW.reservations_outdated_at IS NOT NULL
      AND NEW.reservations_outdated_at IS DISTINCT FROM OLD.reservations_outdated_at
    );

    -- updated_at-only, search_norm-only e limpeza dos flags pelos crons não
    -- representam nem edição do PV nem nova invalidação material.
    IF NOT v_technical_invalidation THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_command := 'create';
  ELSIF NEW.status IN ('Cancelado', 'Cancelada', 'cancelado')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_command := 'cancel';
  ELSIF NEW.status = 'Aprovado'
        AND OLD.status IN ('Rascunho', 'Pendente') THEN
    v_command := 'confirm';
  ELSIF NEW.status = 'Em Produção'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_command := 'promote';
  ELSE
    v_command := 'update';
  END IF;

  v_key := concat(
    'trigger:', txid_current()::text, ':', NEW.id::text, ':',
    NEW.order_version::text, ':', v_command
  );
  v_hash := md5((to_jsonb(NEW) - ARRAY['updated_at', 'search_norm'])::text);

  INSERT INTO public.sale_order_command_receipts(
    sale_order_id,
    aggregate_key,
    command_name,
    idempotency_key,
    request_hash,
    order_version_before,
    order_version_after,
    status,
    response,
    actor_id,
    completed_at
  ) VALUES (
    NEW.id,
    NEW.id::text,
    v_command,
    v_key,
    v_hash,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.order_version ELSE NULL END,
    NEW.order_version,
    'succeeded',
    jsonb_build_object(
      'passive', true,
      'operation', TG_OP,
      'status_before', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      'status_after', NEW.status,
      'technical_invalidation', v_technical_invalidation
    ),
    auth.uid(),
    now()
  )
  ON CONFLICT (command_name, aggregate_key, idempotency_key) DO NOTHING;

  SELECT id
    INTO v_receipt_id
    FROM public.sale_order_command_receipts
   WHERE sale_order_id = NEW.id
     AND command_name = v_command
     AND aggregate_key = NEW.id::text
     AND idempotency_key = v_key;

  INSERT INTO public.sale_order_command_outbox(
    sale_order_id,
    aggregate_key,
    command_receipt_id,
    event_type,
    aggregate_version,
    idempotency_key,
    payload
  ) VALUES (
    NEW.id,
    NEW.id::text,
    v_receipt_id,
    'sale_order.' || CASE v_command
      WHEN 'create' THEN 'created'
      WHEN 'cancel' THEN 'cancelled'
      WHEN 'confirm' THEN 'confirmed'
      WHEN 'promote' THEN 'promoted'
      ELSE 'updated'
    END,
    NEW.order_version,
    v_key,
    jsonb_build_object(
      'sale_order_id', NEW.id,
      'command', v_command,
      'order_version', NEW.order_version,
      'status', NEW.status,
      'passive', true,
      'technical_invalidation', v_technical_invalidation
    )
  )
  ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_record_passive_sale_order_command()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Override técnico também acompanha o conteúdo do plano material
-- ---------------------------------------------------------------------------

-- A assinatura considera somente blockers que um override pode efetivamente
-- relevar. A ordenação canônica evita invalidar pela ordem de montagem do JSON;
-- qualquer mudança de identidade/detalhe em um blocker relevante muda o hash.
CREATE OR REPLACE FUNCTION public.sale_order_readiness_blockers_hash(
  p_blockers jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$
  SELECT md5(COALESCE((
    SELECT jsonb_agg(issue ORDER BY issue::text)
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(COALESCE(p_blockers, '[]'::jsonb)) = 'array'
            THEN COALESCE(p_blockers, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS blockers(issue)
     WHERE COALESCE((issue ->> 'overridable')::boolean, false)
  ), '[]'::jsonb)::text);
$$;

REVOKE ALL ON FUNCTION public.sale_order_readiness_blockers_hash(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $blocker_hash_contract$
DECLARE
  v_a jsonb := '[{"code":"a","overridable":true}]'::jsonb;
  v_b jsonb := '[{"code":"b","overridable":true}]'::jsonb;
  v_ab jsonb := '[{"code":"a","overridable":true},{"code":"b","overridable":true}]'::jsonb;
  v_ba jsonb := '[{"code":"b","overridable":true},{"code":"a","overridable":true}]'::jsonb;
BEGIN
  IF public.sale_order_readiness_blockers_hash(v_a)
     = public.sale_order_readiness_blockers_hash(v_b) THEN
    RAISE EXCEPTION 'Blockers distintos produziram a mesma assinatura';
  END IF;
  IF public.sale_order_readiness_blockers_hash(v_ab)
     <> public.sale_order_readiness_blockers_hash(v_ba) THEN
    RAISE EXCEPTION 'Ordem dos blockers alterou a assinatura canônica';
  END IF;
  IF public.sale_order_readiness_blockers_hash(v_a)
     <> public.sale_order_readiness_blockers_hash(
       v_a || '[{"code":"fatal","overridable":false}]'::jsonb
     ) THEN
    RAISE EXCEPTION 'Blocker não relevável entrou na assinatura do override';
  END IF;
END;
$blocker_hash_contract$;

ALTER TABLE public.sale_order_readiness_overrides
  ADD COLUMN IF NOT EXISTS material_source_hash text,
  ADD COLUMN IF NOT EXISTS readiness_blockers_hash text;

DO $backfill_override_hash$
DECLARE
  v_previous_role text;
BEGIN
  -- build_sale_order_material_plan é corretamente fechado para callers sem
  -- sessão. A própria migration assume o contexto interno só durante este
  -- backfill e o restaura antes de seguir.
  v_previous_role := current_setting('request.jwt.claim.role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  UPDATE public.sale_order_readiness_overrides ro
     SET material_source_hash = (
         public.build_sale_order_material_plan(ro.sale_order_id) ->> 'source_hash'
       ),
       readiness_blockers_hash = public.sale_order_readiness_blockers_hash(
         public.preflight_sale_order_command(
           ro.sale_order_id,
           ro.command_name,
           so.order_version,
           NULL::uuid,
           '{}'::jsonb
         ) -> 'blockers'
       )
    FROM public.sale_orders so
   WHERE (
       ro.material_source_hash IS NULL
       OR ro.readiness_blockers_hash IS NULL
     )
     AND so.id = ro.sale_order_id;

  PERFORM set_config(
    'request.jwt.claim.role',
    COALESCE(v_previous_role, ''),
    true
  );
END;
$backfill_override_hash$;

ALTER TABLE public.sale_order_readiness_overrides
  ALTER COLUMN material_source_hash SET NOT NULL,
  ALTER COLUMN readiness_blockers_hash SET NOT NULL;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.sale_order_readiness_overrides'::regclass
       AND conname = 'sale_order_readiness_override_material_hash_length'
  ) THEN
    ALTER TABLE public.sale_order_readiness_overrides
      ADD CONSTRAINT sale_order_readiness_override_material_hash_length
      CHECK (length(material_source_hash) = 32);
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.sale_order_readiness_overrides'::regclass
       AND conname = 'sale_order_readiness_override_blockers_hash_length'
  ) THEN
    ALTER TABLE public.sale_order_readiness_overrides
      ADD CONSTRAINT sale_order_readiness_override_blockers_hash_length
      CHECK (length(readiness_blockers_hash) = 32);
  END IF;
END;
$constraint$;

COMMENT ON COLUMN public.sale_order_readiness_overrides.material_source_hash IS
  'Hash material justificado. Mudança em ficha/BOM/material invalida o override mesmo sem alterar a versão comercial do PV.';
COMMENT ON COLUMN public.sale_order_readiness_overrides.readiness_blockers_hash IS
  'Assinatura canônica dos blockers releváveis justificados. Blocker novo ou alterado exige novo override.';
COMMENT ON TABLE public.sale_order_readiness_overrides IS
  'Override administrativo sem expiração cronológica, limitado à versão comercial, ao plano material e aos blockers releváveis expressamente justificados.';

-- O preflight é grande e recebeu patches posteriores à migration fundadora.
-- Altera somente a cláusula estável de validação, preservando a definição viva.
DO $patch_preflight$
DECLARE
  v_definition text;
  v_old text := $old$      AND v_override.revoked_at IS NULL;$old$;
  v_new text := $new$      AND v_override.revoked_at IS NULL
      AND v_override.material_source_hash = COALESCE(
        v_plan ->> 'source_hash',
        ''
      )
      AND v_override.readiness_blockers_hash =
        public.sale_order_readiness_blockers_hash(v_blockers);$new$;
  v_old_return text := $old$    'warnings', v_warnings,$old$;
  v_new_return text := $new$    'warnings', v_warnings,
    'readiness_blockers_hash',
      public.sale_order_readiness_blockers_hash(v_blockers),$new$;
BEGIN
  SELECT pg_get_functiondef(
           'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'::regprocedure
         )
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'preflight_sale_order_command(uuid,text,bigint,uuid,jsonb) ausente';
  END IF;
  IF position('v_override.readiness_blockers_hash' IN v_definition) = 0 THEN
    IF (
      length(v_definition) - length(replace(v_definition, v_old, ''))
    ) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'Cláusula de override do preflight divergiu do contrato esperado';
    END IF;
    IF (
      length(v_definition) - length(replace(v_definition, v_old_return, ''))
    ) / length(v_old_return) <> 1 THEN
      RAISE EXCEPTION 'Retorno de blockers do preflight divergiu do contrato esperado';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    v_definition := replace(v_definition, v_old_return, v_new_return);
    EXECUTE v_definition;
  ELSIF position($needle$'readiness_blockers_hash',$needle$ IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Preflight valida o hash de blockers, mas não o retorna';
  END IF;
END;
$patch_preflight$;

CREATE OR REPLACE FUNCTION public.create_sale_order_readiness_override(
  p_sale_order_id uuid,
  p_command text,
  p_justification text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_version bigint;
  v_source_hash text;
  v_readiness jsonb;
  v_blockers_hash text;
  v_id uuid;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Somente administrador pode justificar override de readiness'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para override'
      USING ERRCODE = '42501';
  END IF;

  IF v_command NOT IN ('confirm', 'promote') THEN
    RAISE EXCEPTION 'Override permitido somente para confirm/promote'
      USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória deve ter ao menos 10 caracteres'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sale-order-command:' || p_sale_order_id::text, 0)
  );
  SELECT order_version
    INTO v_version
    FROM public.sale_orders
   WHERE id = p_sale_order_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_readiness := public.preflight_sale_order_command(
    p_sale_order_id,
    v_command,
    v_version,
    NULL::uuid,
    '{}'::jsonb
  );
  -- Os dois fingerprints vêm do mesmo statement/snapshot de preflight. Uma
  -- ficha não pode mudar entre duas leituras e criar um override híbrido.
  v_source_hash := v_readiness -> 'material_plan' ->> 'source_hash';
  v_blockers_hash := public.sale_order_readiness_blockers_hash(
    v_readiness -> 'blockers'
  );
  IF length(COALESCE(v_source_hash, '')) <> 32 THEN
    RAISE EXCEPTION 'Plano material do PV não produziu source_hash válido';
  END IF;
  IF length(COALESCE(v_blockers_hash, '')) <> 32 THEN
    RAISE EXCEPTION 'Preflight do PV não produziu readiness_blockers_hash válido';
  END IF;

  INSERT INTO public.sale_order_readiness_overrides(
    sale_order_id,
    command_name,
    order_version,
    material_source_hash,
    readiness_blockers_hash,
    justification,
    created_by
  ) VALUES (
    p_sale_order_id,
    v_command,
    v_version,
    v_source_hash,
    v_blockers_hash,
    btrim(p_justification),
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  )
  ON CONFLICT (sale_order_id, command_name, order_version)
    WHERE revoked_at IS NULL
  DO UPDATE
     SET material_source_hash = EXCLUDED.material_source_hash,
         readiness_blockers_hash = EXCLUDED.readiness_blockers_hash,
         justification = EXCLUDED.justification,
         created_by = EXCLUDED.created_by,
         created_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_sale_order_command(
  uuid, text, bigint, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_command(
  uuid, text, bigint, uuid, jsonb
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_sale_order_readiness_override(
  uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order_readiness_override(
  uuid, text, text
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Snapshot coerente do editor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sale_order_editor_snapshot(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'order', to_jsonb(so),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(soi) ORDER BY soi.created_at, soi.id)
        FROM public.sale_order_items soi
       WHERE soi.sale_order_id = so.id
    ), '[]'::jsonb)
  )
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_sale_order_editor_snapshot(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_editor_snapshot(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_editor_snapshot(uuid) IS
  'Lê cabeçalho, itens e order_version do PV no mesmo snapshot SQL, sob as RLS do chamador.';

-- ---------------------------------------------------------------------------
-- 5. Prova executável do trigger (tabela temporária, nenhum PV é tocado)
-- ---------------------------------------------------------------------------

DO $version_contract$
DECLARE
  v_version bigint;
  v_previous_touch text;
BEGIN
  CREATE TEMP TABLE sale_order_version_probe (
    order_version bigint NOT NULL,
    updated_at timestamptz,
    search_norm text,
    costs_dirty_at timestamptz,
    reservations_outdated_at timestamptz,
    notes text
  ) ON COMMIT DROP;

  CREATE TRIGGER trg_probe_sale_order_version
  BEFORE UPDATE ON sale_order_version_probe
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_bump_sale_order_order_version();

  INSERT INTO sale_order_version_probe(order_version, notes)
  VALUES (7, 'original');

  UPDATE sale_order_version_probe
     SET costs_dirty_at = now(),
         reservations_outdated_at = now(),
         updated_at = now(),
         search_norm = 'derivado';
  SELECT order_version INTO v_version FROM sale_order_version_probe;
  IF v_version <> 7 THEN
    RAISE EXCEPTION 'Flags derivados avançaram order_version: %', v_version;
  END IF;

  UPDATE sale_order_version_probe SET notes = 'edição real';
  SELECT order_version INTO v_version FROM sale_order_version_probe;
  IF v_version <> 8 THEN
    RAISE EXCEPTION 'Campo real não avançou order_version exatamente uma vez: %', v_version;
  END IF;

  -- Nem uma atribuição direta pode escolher/resetar a versão.
  UPDATE sale_order_version_probe SET order_version = 1;
  SELECT order_version INTO v_version FROM sale_order_version_probe;
  IF v_version <> 8 THEN
    RAISE EXCEPTION 'Atribuição direta escolheu order_version: %', v_version;
  END IF;

  v_previous_touch := current_setting('app.sale_order_version_touch', true);
  PERFORM set_config('app.sale_order_version_touch', '1', true);
  UPDATE sale_order_version_probe SET updated_at = clock_timestamp();
  PERFORM set_config(
    'app.sale_order_version_touch',
    COALESCE(v_previous_touch, ''),
    true
  );
  SELECT order_version INTO v_version FROM sale_order_version_probe;
  IF v_version <> 9 THEN
    RAISE EXCEPTION 'Touch de item não avançou order_version: %', v_version;
  END IF;

  DROP TABLE sale_order_version_probe;
END;
$version_contract$;

COMMIT;
