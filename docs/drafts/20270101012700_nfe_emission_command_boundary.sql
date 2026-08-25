-- RASCUNHO NAO PROMOVIVEL: a Edge Function emit-nfe ainda nao consome este
-- contrato. Manter fora de supabase/migrations ate integrar e testar o fluxo.
--
-- Limite transacional proposto para a emissao normal de NF-e.
--
-- Invariantes:
--   * preview produz contrato imutavel (order_version + snapshot_hash);
--   * a emissao cria claim local antes do primeiro efeito no provedor;
--   * client_request_id torna replay deterministico;
--   * POST ambiguo nunca e repetido: fica em reconciliacao;
--   * aceite do provedor e persistido antes do polling da SEFAZ;
--   * browser perde DML direto em nfe_emitidas.
--
-- Nenhuma linha fiscal historica e alterada por esta migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.nfe_emission_commands_127 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  nfe_id uuid NOT NULL UNIQUE
    REFERENCES public.nfe_emitidas(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  requested_company_id uuid
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  resolved_company_id uuid
    REFERENCES public.companies(id) ON DELETE RESTRICT,
  first_due_date date,
  expected_order_version bigint NOT NULL CHECK (expected_order_version >= 1),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{32}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{32}$'),
  payload_hash text CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{32}$'),
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN (
      'claimed', 'provider_inflight', 'provider_confirmed',
      'reconciliation_required', 'completed', 'rejected'
    )),
  provider_nfe_id text,
  provider_post_started_at timestamptz,
  provider_confirmed_at timestamptz,
  response jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT nfe_emission_commands_127_completion_ck CHECK (
    (state IN ('completed', 'rejected') AND completed_at IS NOT NULL)
    OR (state NOT IN ('completed', 'rejected') AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS nfe_emission_commands_127_active_order_uq
  ON public.nfe_emission_commands_127(sale_order_id)
  WHERE state IN (
    'claimed', 'provider_inflight', 'provider_confirmed',
    'reconciliation_required'
  );

CREATE INDEX IF NOT EXISTS nfe_emission_commands_127_reconciliation_idx
  ON public.nfe_emission_commands_127(updated_at)
  WHERE state IN ('provider_inflight', 'provider_confirmed', 'reconciliation_required');

ALTER TABLE public.nfe_emission_commands_127 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfe_emission_commands_127
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfe_emission_commands_127 TO service_role;

COMMENT ON TABLE public.nfe_emission_commands_127 IS
  'Receipt duravel da emissao NF-e. provider_inflight sem provider_nfe_id e ambiguidade fail-closed: reconciliar, nunca repetir POST.';

-- ---------------------------------------------------------------------------
-- Snapshot fiscal canonico. A funcao retorna o documento apenas para os
-- wrappers internos; a API publica expoe somente hash e versao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_nfe_emission_snapshot_127(
  p_sale_order_id uuid,
  p_company_id uuid,
  p_first_due_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_order jsonb;
  v_items jsonb := '[]'::jsonb;
  v_client jsonb := 'null'::jsonb;
  v_company jsonb := 'null'::jsonb;
  v_fiscal_config jsonb := 'null'::jsonb;
  v_sheets jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_variants jsonb := '[]'::jsonb;
  v_boxes jsonb := '[]'::jsonb;
  v_resolved_company_id uuid;
  v_source text;
  v_document jsonb;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND pg_catalog.current_setting('app.nfe_emission_command_internal', true) <> '1' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio'
      USING ERRCODE = '42501';
  END IF;

  SELECT so.* INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % nao encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;

  v_order := pg_catalog.to_jsonb(v_so)
    - ARRAY['updated_at', 'search_norm', 'nfe'];

  SELECT COALESCE(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(i) - ARRAY['created_at', 'updated_at', 'search_norm']
             ORDER BY i.id
           ),
           '[]'::jsonb
         )
    INTO v_items
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id;

  IF v_so.client_id IS NOT NULL THEN
    SELECT pg_catalog.to_jsonb(c) - ARRAY['updated_at', 'search_norm', 'gestaoclick_id']
      INTO v_client
      FROM public.clients c
     WHERE c.id = v_so.client_id;
  END IF;
  IF v_client IS NULL OR v_client = 'null'::jsonb THEN
    SELECT pg_catalog.to_jsonb(c) - ARRAY['updated_at', 'search_norm', 'gestaoclick_id']
      INTO v_client
      FROM public.clients c
     WHERE c.razao_social = v_so.client_name
     ORDER BY c.id
     LIMIT 1;
  END IF;
  v_client := COALESCE(v_client, 'null'::jsonb);

  IF p_company_id IS NOT NULL THEN
    SELECT c.id,
           pg_catalog.to_jsonb(c) - ARRAY[
             'updated_at', 'search_norm', 'gestaoclick_loja_id',
             'gestaoclick_transportadora_id'
           ]
      INTO v_resolved_company_id, v_company
      FROM public.companies c
     WHERE c.id = p_company_id
       AND c.active = true;
    v_source := 'requested_company';
  ELSE
    SELECT c.id,
           pg_catalog.to_jsonb(c) - ARRAY[
             'updated_at', 'search_norm', 'gestaoclick_loja_id',
             'gestaoclick_transportadora_id'
           ]
      INTO v_resolved_company_id, v_company
      FROM public.companies c
     WHERE c.is_primary = true
       AND c.active = true
     ORDER BY c.id
     LIMIT 1;
    v_source := 'primary_company';
  END IF;

  IF v_company IS NULL OR v_company = 'null'::jsonb THEN
    SELECT pg_catalog.to_jsonb(fc) - ARRAY['updated_at']
      INTO v_fiscal_config
      FROM public.fiscal_config fc
     ORDER BY fc.id
     LIMIT 1;
    v_source := 'fiscal_config';
  END IF;
  v_company := COALESCE(v_company, 'null'::jsonb);
  v_fiscal_config := COALESCE(v_fiscal_config, 'null'::jsonb);

  SELECT COALESCE(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(ts) - ARRAY[
               'created_at', 'updated_at', 'search_norm', 'gestaoclick_id'
             ] ORDER BY ts.id
           ),
           '[]'::jsonb
         )
    INTO v_sheets
    FROM public.technical_sheets ts
   WHERE ts.id IN (
     SELECT DISTINCT i.reference_id
       FROM public.sale_order_items i
      WHERE i.sale_order_id = p_sale_order_id
        AND i.reference_id IS NOT NULL
   );

  SELECT COALESCE(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(p) - ARRAY[
               'created_at', 'updated_at', 'search_norm', 'gestaoclick_id',
               'quantity', 'reserved_stock', 'stock_grade'
             ] ORDER BY p.id
           ),
           '[]'::jsonb
         )
    INTO v_products
    FROM public.products p
   WHERE p.id IN (
     SELECT DISTINCT i.product_id
       FROM public.sale_order_items i
      WHERE i.sale_order_id = p_sale_order_id
        AND i.product_id IS NOT NULL
   );

  SELECT COALESCE(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(v) - ARRAY['created_at', 'updated_at', 'search_norm']
             ORDER BY v.id
           ),
           '[]'::jsonb
         )
    INTO v_variants
    FROM public.reference_material_variants v
   WHERE v.id IN (
     SELECT DISTINCT i.material_variant_id
       FROM public.sale_order_items i
      WHERE i.sale_order_id = p_sale_order_id
        AND i.material_variant_id IS NOT NULL
   );

  SELECT COALESCE(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'link', pg_catalog.to_jsonb(link) - ARRAY['created_at'],
               'box_type', pg_catalog.to_jsonb(bt) - ARRAY['created_at', 'updated_at', 'quantity']
             )
             ORDER BY link.sheet_id, link.box_type_id
           ),
           '[]'::jsonb
         )
    INTO v_boxes
    FROM public.technical_sheet_box_types link
    JOIN public.box_types bt ON bt.id = link.box_type_id
   WHERE link.sheet_id IN (
     SELECT DISTINCT i.reference_id
       FROM public.sale_order_items i
      WHERE i.sale_order_id = p_sale_order_id
        AND i.reference_id IS NOT NULL
   );

  v_document := pg_catalog.jsonb_build_object(
    'schema', 'nfe-emission-snapshot-127-v1',
    'sale_order', v_order,
    'items', v_items,
    'client', v_client,
    'fiscal_source', v_source,
    'requested_company_id', p_company_id,
    'resolved_company_id', v_resolved_company_id,
    'company', v_company,
    'fiscal_config', v_fiscal_config,
    'technical_sheets', v_sheets,
    'products', v_products,
    'material_variants', v_variants,
    'box_types', v_boxes,
    'first_due_date', p_first_due_date
  );

  RETURN pg_catalog.jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'order_version', v_so.order_version,
    'status', v_so.status,
    'is_standalone_nfe', COALESCE(v_so.is_standalone_nfe, false),
    'nfe_required', COALESCE(v_so.nfe_required, true),
    'resolved_company_id', v_resolved_company_id,
    'snapshot_hash', pg_catalog.md5(v_document::text),
    'document', v_document
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_nfe_emission_snapshot_127(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_nfe_emission_contract_127(
  p_sale_order_id uuid,
  p_company_id uuid DEFAULT NULL,
  p_first_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('app.nfe_emission_command_internal', '1', true);
  v_snapshot := public.build_nfe_emission_snapshot_127(
    p_sale_order_id, p_company_id, p_first_due_date
  );
  RETURN v_snapshot - 'document';
END;
$$;

REVOKE ALL ON FUNCTION public.preview_nfe_emission_contract_127(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_nfe_emission_contract_127(uuid, uuid, date)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Begin: lock NF -> advisory/PV -> itens, valida contrato e cria o claim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_nfe_emission_command_127(
  p_client_request_id uuid,
  p_sale_order_id uuid,
  p_company_id uuid,
  p_first_due_date date,
  p_expected_order_version bigint,
  p_expected_snapshot_hash text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing public.nfe_emission_commands_127%ROWTYPE;
  v_so public.sale_orders%ROWTYPE;
  v_snapshot jsonb;
  v_current_hash text;
  v_resolved_company_id uuid;
  v_request_hash text;
  v_nfe_id uuid;
  v_command_id uuid;
  v_revision integer;
  v_ref text;
  v_total numeric;
  v_actor_allowed boolean := false;
  v_has_granular boolean := false;
  v_can_create boolean := false;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL OR p_sale_order_id IS NULL
     OR p_expected_order_version IS NULL OR p_actor_id IS NULL
     OR COALESCE(p_expected_snapshot_hash, '') !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION
      'client_request_id, sale_order_id, actor_id, expected_order_version e snapshot_hash sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.profiles p
             JOIN public.user_roles ur ON ur.user_id = p.id
            WHERE p.id = p_actor_id
              AND p.approved = true
              AND ur.role::text IN ('admin', 'gerente', 'nfe_operator')
         ),
         EXISTS (
           SELECT 1 FROM public.user_permissions up
            WHERE up.user_id = p_actor_id AND up.can_view = true
         ),
         EXISTS (
           SELECT 1 FROM public.user_permissions up
            WHERE up.user_id = p_actor_id
              AND up.can_view = true
              AND up.can_create = true
              AND up.module IN ('nfe', '/nfe')
         )
    INTO v_actor_allowed, v_has_granular, v_can_create;
  IF NOT v_actor_allowed OR (v_has_granular AND NOT v_can_create) THEN
    RAISE EXCEPTION 'Operador sem permissao para emitir NF-e'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'schema', 'nfe-emission-request-127-v1',
    'sale_order_id', p_sale_order_id,
    'company_id', p_company_id,
    'first_due_date', p_first_due_date,
    'expected_order_version', p_expected_order_version,
    'expected_snapshot_hash', p_expected_snapshot_hash
  )::text);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'nfe-emission-request:' || p_client_request_id::text, 0
  ));
  SELECT * INTO v_existing
    FROM public.nfe_emission_commands_127 c
   WHERE c.client_request_id = p_client_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'client_request_id reutilizado com outro pedido/contrato'
        USING ERRCODE = 'PZ270';
    END IF;
    IF v_existing.state = 'provider_inflight' THEN
      UPDATE public.nfe_emission_commands_127
         SET state = 'reconciliation_required',
             error_message = COALESCE(error_message,
               'Replay encontrou POST iniciado sem aceite persistido; reconciliar provedor.'),
             updated_at = pg_catalog.now()
       WHERE id = v_existing.id;
      v_existing.state := 'reconciliation_required';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', v_existing.state NOT IN ('rejected', 'reconciliation_required'),
      'idempotent_replay', true,
      'command_id', v_existing.id,
      'nfe_id', v_existing.nfe_id,
      'state', v_existing.state,
      'provider_call_required', v_existing.state = 'claimed',
      'resume_polling', v_existing.state = 'provider_confirmed',
      'provider_nfe_id', v_existing.provider_nfe_id,
      'response', v_existing.response,
      'reconciliation_required', v_existing.state = 'reconciliation_required'
    );
  END IF;

  -- Mesma hierarquia do cancelamento: todas as NF-es primeiro.
  PERFORM ne.id
    FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = p_sale_order_id
   ORDER BY ne.id
   FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text, 0
  ));
  SELECT so.* INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % nao encontrado', p_sale_order_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM ne.id
    FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = p_sale_order_id
   ORDER BY ne.id
   FOR UPDATE NOWAIT;
  PERFORM i.id
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
   ORDER BY i.id
   FOR UPDATE;

  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou desde o preview (esperado %, atual %)',
      p_expected_order_version, v_so.order_version
      USING ERRCODE = '40001';
  END IF;
  IF NOT COALESCE(v_so.nfe_required, true) THEN
    RAISE EXCEPTION 'PV informal nao pode emitir NF-e' USING ERRCODE = 'PZ271';
  END IF;
  IF COALESCE(v_so.is_standalone_nfe, false) THEN
    IF v_so.status <> 'Rascunho' THEN
      RAISE EXCEPTION 'NF-e avulsa so pode emitir a partir de Rascunho (atual: %)', v_so.status
        USING ERRCODE = 'PZ271';
    END IF;
  ELSIF v_so.status NOT IN (
    'Aprovado', 'Em Produção', 'Faturado', 'Expedido', 'Concluído'
  ) THEN
    RAISE EXCEPTION 'Status % nao permite emissao fiscal do PV', v_so.status
      USING ERRCODE = 'PZ271';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = p_sale_order_id
       AND ne.status IN ('processando', 'autorizada', 'cancelando')
  ) THEN
    RAISE EXCEPTION 'Ja existe NF-e ativa/em reconciliacao para este PV'
      USING ERRCODE = '23505';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.nfe_emitidas ne
       WHERE ne.sale_order_id = p_sale_order_id) >= 5 THEN
    RAISE EXCEPTION 'Limite de 5 tentativas fiscais atingido; investigue o cadastro antes de reemitir'
      USING ERRCODE = 'PZ272';
  END IF;

  PERFORM pg_catalog.set_config('app.nfe_emission_command_internal', '1', true);
  v_snapshot := public.build_nfe_emission_snapshot_127(
    p_sale_order_id, p_company_id, p_first_due_date
  );
  v_current_hash := v_snapshot ->> 'snapshot_hash';
  v_resolved_company_id := NULLIF(v_snapshot ->> 'resolved_company_id', '')::uuid;
  IF v_current_hash IS DISTINCT FROM p_expected_snapshot_hash THEN
    RAISE EXCEPTION 'Snapshot fiscal mudou desde o preview; gere nova conferencia'
      USING ERRCODE = '40001';
  END IF;
  IF (v_snapshot -> 'document' ->> 'fiscal_source') = 'fiscal_config'
     AND (v_snapshot -> 'document' -> 'fiscal_config') = 'null'::jsonb THEN
    RAISE EXCEPTION 'Configuracao fiscal nao encontrada' USING ERRCODE = 'PZ271';
  END IF;
  IF p_company_id IS NOT NULL AND v_resolved_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa selecionada inativa ou inexistente' USING ERRCODE = 'PZ271';
  END IF;

  SELECT COALESCE(pg_catalog.sum(i.quantity * i.unit_price), 0)
    INTO v_total
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
     AND i.quantity > 0;
  SELECT pg_catalog.count(*)::integer
    INTO v_revision
    FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = p_sale_order_id;
  v_ref := CASE WHEN v_revision = 0
    THEN 'nfe-' || p_sale_order_id::text
    ELSE 'nfe-' || p_sale_order_id::text || '-r' || (v_revision + 1)::text
  END;

  INSERT INTO public.nfe_emitidas(
    sale_order_id, ref_nfe, status, valor_total, data_emissao,
    company_id, nome_destinatario, cnpj_destinatario, motivo_rejeicao
  ) VALUES (
    p_sale_order_id, v_ref, 'processando', v_total, NULL,
    v_resolved_company_id, v_so.client_name, NULLIF(v_so.client_cnpj, ''), ''
  ) RETURNING id INTO v_nfe_id;

  INSERT INTO public.nfe_emission_commands_127(
    client_request_id, sale_order_id, nfe_id, actor_id,
    requested_company_id, resolved_company_id, first_due_date,
    expected_order_version, snapshot_hash, request_hash, state
  ) VALUES (
    p_client_request_id, p_sale_order_id, v_nfe_id, p_actor_id,
    p_company_id, v_resolved_company_id, p_first_due_date,
    p_expected_order_version, p_expected_snapshot_hash, v_request_hash, 'claimed'
  ) RETURNING id INTO v_command_id;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'command_id', v_command_id,
    'nfe_id', v_nfe_id,
    'state', 'claimed',
    'provider_call_required', true,
    'resume_polling', false,
    'ref_nfe', v_ref,
    'revision', v_revision,
    'snapshot_hash', v_current_hash,
    'resolved_company_id', v_resolved_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_nfe_emission_command_127(
  uuid, uuid, uuid, date, bigint, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_nfe_emission_command_127(
  uuid, uuid, uuid, date, bigint, text, uuid
) TO service_role;

-- ---------------------------------------------------------------------------
-- Claim curto imediatamente antes do POST fiscal.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_nfe_provider_submission_127(
  p_command_id uuid,
  p_snapshot_hash text,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_hint record;
  v_command public.nfe_emission_commands_127%ROWTYPE;
  v_snapshot jsonb;
  v_current_hash text;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR COALESCE(p_snapshot_hash, '') !~ '^[0-9a-f]{32}$'
     OR COALESCE(p_payload_hash, '') !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'command_id, snapshot_hash e payload_hash validos sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;

  SELECT c.sale_order_id, c.nfe_id INTO v_hint
    FROM public.nfe_emission_commands_127 c
   WHERE c.id = p_command_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comando fiscal nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  PERFORM ne.id FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = v_hint.sale_order_id
   ORDER BY ne.id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || v_hint.sale_order_id::text, 0
  ));
  PERFORM so.id FROM public.sale_orders so
   WHERE so.id = v_hint.sale_order_id FOR UPDATE;
  PERFORM i.id FROM public.sale_order_items i
   WHERE i.sale_order_id = v_hint.sale_order_id ORDER BY i.id FOR UPDATE;
  SELECT * INTO v_command
    FROM public.nfe_emission_commands_127 c
   WHERE c.id = p_command_id
   FOR UPDATE;

  IF v_command.state = 'provider_confirmed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'provider_call_required', false, 'resume_polling', true,
      'provider_nfe_id', v_command.provider_nfe_id, 'state', v_command.state
    );
  END IF;
  IF v_command.state <> 'claimed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'provider_call_required', false,
      'state', v_command.state,
      'reconciliation_required', v_command.state IN ('provider_inflight', 'reconciliation_required'),
      'response', v_command.response
    );
  END IF;
  IF v_command.snapshot_hash <> p_snapshot_hash THEN
    RAISE EXCEPTION 'Hash apresentado diverge do claim fiscal' USING ERRCODE = 'PZ270';
  END IF;

  PERFORM pg_catalog.set_config('app.nfe_emission_command_internal', '1', true);
  v_snapshot := public.build_nfe_emission_snapshot_127(
    v_command.sale_order_id,
    v_command.requested_company_id,
    v_command.first_due_date
  );
  v_current_hash := v_snapshot ->> 'snapshot_hash';
  IF v_current_hash IS DISTINCT FROM v_command.snapshot_hash THEN
    UPDATE public.nfe_emission_commands_127
       SET state = 'rejected',
           error_message = 'Snapshot mudou entre claim e POST; nenhum efeito fiscal remoto iniciado.',
           completed_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE id = v_command.id;
    UPDATE public.nfe_emitidas
       SET status = 'rejeitada',
           motivo_rejeicao = 'Snapshot mudou antes do envio ao provedor',
           updated_at = pg_catalog.now()
     WHERE id = v_command.nfe_id AND status = 'processando';
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'provider_call_required', false, 'state', 'rejected',
      'error', 'PV/dependencias fiscais mudaram; gere novo preview.'
    );
  END IF;

  UPDATE public.nfe_emission_commands_127
     SET state = 'provider_inflight',
         payload_hash = p_payload_hash,
         provider_post_started_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   WHERE id = v_command.id AND state = 'claimed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim do provedor perdeu o CAS' USING ERRCODE = '40001';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'provider_call_required', true,
    'resume_polling', false, 'state', 'provider_inflight'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_nfe_provider_submission_127(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_nfe_provider_submission_127(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_nfe_provider_acceptance_127(
  p_command_id uuid,
  p_provider_nfe_id text,
  p_request_payload jsonb,
  p_provider_response jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command public.nfe_emission_commands_127%ROWTYPE;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(pg_catalog.btrim(COALESCE(p_provider_nfe_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'provider_nfe_id obrigatorio' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_command FROM public.nfe_emission_commands_127
   WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comando fiscal nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_command.state = 'provider_confirmed'
     AND v_command.provider_nfe_id = p_provider_nfe_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'idempotent_replay', true);
  END IF;
  IF v_command.state <> 'provider_inflight' THEN
    RAISE EXCEPTION 'Estado % nao aceita confirmar provedor', v_command.state
      USING ERRCODE = 'PZ273';
  END IF;
  UPDATE public.nfe_emission_commands_127
     SET state = 'provider_confirmed',
         provider_nfe_id = p_provider_nfe_id,
         provider_confirmed_at = pg_catalog.now(),
         response = pg_catalog.jsonb_build_object('provider_create', p_provider_response),
         updated_at = pg_catalog.now()
   WHERE id = p_command_id;
  UPDATE public.nfe_emitidas
     SET provider_nfe_id = p_provider_nfe_id,
         gc_request_payload = p_request_payload,
         gc_response_payload = p_provider_response,
         updated_at = pg_catalog.now()
   WHERE id = v_command.nfe_id
     AND status = 'processando';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim local da NF-e nao esta processando' USING ERRCODE = '40001';
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'idempotent_replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_nfe_provider_acceptance_127(uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_nfe_provider_acceptance_127(uuid, text, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reject_nfe_emission_command_127(
  p_command_id uuid,
  p_reason text,
  p_request_payload jsonb DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command public.nfe_emission_commands_127%ROWTYPE;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_command FROM public.nfe_emission_commands_127
   WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comando fiscal nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_command.state = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'idempotent_replay', true);
  END IF;
  IF v_command.state NOT IN ('claimed', 'provider_inflight') THEN
    RAISE EXCEPTION 'Estado % nao aceita rejeicao pre-aceite', v_command.state
      USING ERRCODE = 'PZ273';
  END IF;
  UPDATE public.nfe_emission_commands_127
     SET state = 'rejected', error_message = pg_catalog.left(COALESCE(p_reason, ''), 2000),
         response = pg_catalog.jsonb_build_object('provider_create', p_provider_response),
         completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = p_command_id;
  UPDATE public.nfe_emitidas
     SET status = 'rejeitada',
         motivo_rejeicao = pg_catalog.left(COALESCE(p_reason, 'Rejeitada pelo provedor'), 2000),
         gc_request_payload = COALESCE(p_request_payload, gc_request_payload),
         gc_response_payload = COALESCE(p_provider_response, gc_response_payload),
         updated_at = pg_catalog.now()
   WHERE id = v_command.nfe_id AND status = 'processando';
  RETURN pg_catalog.jsonb_build_object('ok', true, 'idempotent_replay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_nfe_emission_command_127(uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_nfe_emission_command_127(uuid, text, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_nfe_emission_reconciliation_127(
  p_command_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command public.nfe_emission_commands_127%ROWTYPE;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_command FROM public.nfe_emission_commands_127
   WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comando fiscal nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_command.state IN ('provider_inflight', 'provider_confirmed', 'reconciliation_required') THEN
    UPDATE public.nfe_emission_commands_127
       SET state = 'reconciliation_required',
           error_message = pg_catalog.left(COALESCE(p_reason, ''), 2000),
           updated_at = pg_catalog.now()
     WHERE id = p_command_id;
    UPDATE public.nfe_emitidas
       SET status = 'processando',
           motivo_rejeicao = pg_catalog.left(COALESCE(p_reason, ''), 2000),
           updated_at = pg_catalog.now()
     WHERE id = v_command.nfe_id
       AND status NOT IN ('autorizada', 'cancelando', 'cancelada');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'state', CASE WHEN v_command.state IN ('completed', 'rejected')
      THEN v_command.state ELSE 'reconciliation_required' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_nfe_emission_reconciliation_127(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_nfe_emission_reconciliation_127(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.abort_nfe_emission_before_provider_127(
  p_command_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command public.nfe_emission_commands_127%ROWTYPE;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_command FROM public.nfe_emission_commands_127
   WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', true, 'missing', true); END IF;
  IF v_command.state = 'claimed' THEN
    UPDATE public.nfe_emission_commands_127
       SET state = 'rejected', error_message = pg_catalog.left(COALESCE(p_reason, ''), 2000),
           completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = p_command_id;
    UPDATE public.nfe_emitidas
       SET status = 'rejeitada', motivo_rejeicao = pg_catalog.left(COALESCE(p_reason, ''), 2000),
           updated_at = pg_catalog.now()
     WHERE id = v_command.nfe_id AND status = 'processando';
    RETURN pg_catalog.jsonb_build_object('ok', true, 'released', true, 'state', 'rejected');
  END IF;
  IF v_command.state IN ('provider_inflight', 'provider_confirmed') THEN
    RETURN public.mark_nfe_emission_reconciliation_127(p_command_id, p_reason);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'released', false, 'state', v_command.state);
END;
$$;

REVOKE ALL ON FUNCTION public.abort_nfe_emission_before_provider_127(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_nfe_emission_before_provider_127(uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Resultado do polling. O aceite do provedor ja foi gravado; aqui somente se
-- observa SEFAZ e persiste metadados do PV na mesma transacao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_nfe_emission_command_127(
  p_command_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_command public.nfe_emission_commands_127%ROWTYPE;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_status text;
  v_data_emissao timestamptz;
  v_numero text;
  v_response jsonb;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: service_role obrigatorio' USING ERRCODE = '42501';
  END IF;
  IF p_command_id IS NULL OR pg_catalog.jsonb_typeof(COALESCE(p_result, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'command_id e result object obrigatorios' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_command FROM public.nfe_emission_commands_127
   WHERE id = p_command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comando fiscal nao encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_nfe FROM public.nfe_emitidas
   WHERE id = v_command.nfe_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim local da NF-e nao encontrado' USING ERRCODE = 'P0002'; END IF;

  v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_result ->> 'status', '')));
  IF v_status NOT IN ('autorizada', 'processando', 'rejeitada') THEN
    RAISE EXCEPTION 'Status fiscal final invalido: %', v_status USING ERRCODE = '22023';
  END IF;
  IF v_command.state = 'completed' AND v_nfe.status = 'autorizada' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'nfe', pg_catalog.to_jsonb(v_nfe)
    );
  END IF;
  IF v_command.state NOT IN ('provider_confirmed', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Estado % nao aceita conclusao fiscal', v_command.state
      USING ERRCODE = 'PZ273';
  END IF;
  IF v_command.provider_nfe_id IS NULL THEN
    RAISE EXCEPTION 'Aceite do provedor nao foi persistido' USING ERRCODE = 'PZ273';
  END IF;
  IF NULLIF(p_result ->> 'provider_nfe_id', '') IS DISTINCT FROM v_command.provider_nfe_id THEN
    RAISE EXCEPTION 'provider_nfe_id diverge do aceite persistido' USING ERRCODE = 'PZ270';
  END IF;

  BEGIN
    v_data_emissao := NULLIF(p_result ->> 'data_emissao', '')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'data_emissao invalida' USING ERRCODE = '22007';
  END;
  v_numero := NULLIF(p_result ->> 'numero', '');
  v_response := pg_catalog.jsonb_build_object(
    'status', v_status,
    'provider_nfe_id', v_command.provider_nfe_id,
    'numero', v_numero,
    'chave_acesso', NULLIF(p_result ->> 'chave_acesso', ''),
    'completed_at', pg_catalog.now()
  );

  UPDATE public.nfe_emitidas ne
     SET status = v_status,
         valor_total = COALESCE(NULLIF(p_result ->> 'valor_total', '')::numeric, ne.valor_total),
         motivo_rejeicao = COALESCE(p_result ->> 'motivo_rejeicao', ne.motivo_rejeicao),
         cnpj_emitente = COALESCE(NULLIF(p_result ->> 'cnpj_emitente', ''), ne.cnpj_emitente),
         chave_acesso = COALESCE(NULLIF(p_result ->> 'chave_acesso', ''), ne.chave_acesso),
         protocolo = COALESCE(NULLIF(p_result ->> 'protocolo', ''), ne.protocolo),
         provider_nfe_id = v_command.provider_nfe_id,
         nome_destinatario = COALESCE(NULLIF(p_result ->> 'nome_destinatario', ''), ne.nome_destinatario),
         cnpj_destinatario = COALESCE(NULLIF(p_result ->> 'cnpj_destinatario', ''), ne.cnpj_destinatario),
         numero = COALESCE(v_numero, ne.numero),
         serie = COALESCE(NULLIF(p_result ->> 'serie', ''), ne.serie),
         data_emissao = COALESCE(v_data_emissao, ne.data_emissao),
         tp_amb_sefaz = COALESCE(NULLIF(p_result ->> 'tp_amb_sefaz', ''), ne.tp_amb_sefaz),
         gc_request_payload = COALESCE(p_result -> 'gc_request_payload', ne.gc_request_payload),
         gc_response_payload = COALESCE(p_result -> 'gc_response_payload', ne.gc_response_payload),
         gc_emit_response = COALESCE(p_result -> 'gc_emit_response', ne.gc_emit_response),
         gc_detail_response = COALESCE(p_result -> 'gc_detail_response', ne.gc_detail_response),
         updated_at = pg_catalog.now()
   WHERE ne.id = v_command.nfe_id
     AND ne.status NOT IN ('cancelando', 'cancelada')
   RETURNING * INTO v_nfe;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e entrou em cancelamento; observacao de emissao nao pode sobrescrever'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.nfe_emission_commands_127
     SET state = CASE
           WHEN v_status = 'autorizada' THEN 'completed'
           WHEN v_status = 'rejeitada' THEN 'rejected'
           ELSE 'provider_confirmed'
         END,
         response = v_response,
         error_message = CASE WHEN v_status = 'rejeitada'
           THEN COALESCE(p_result ->> 'motivo_rejeicao', 'Rejeitada pela SEFAZ')
           ELSE NULL END,
         completed_at = CASE WHEN v_status IN ('autorizada', 'rejeitada')
           THEN pg_catalog.now() ELSE NULL END,
         updated_at = pg_catalog.now()
   WHERE id = p_command_id;

  IF v_status = 'autorizada' THEN
    PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
    UPDATE public.sale_orders so
       SET nfe = COALESCE(v_numero, so.nfe),
           nfe_first_due_date = COALESCE(v_command.first_due_date, so.nfe_first_due_date),
           updated_at = pg_catalog.now()
     WHERE so.id = v_command.sale_order_id
       AND so.status <> 'Cancelado';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'state', CASE
      WHEN v_status = 'autorizada' THEN 'completed'
      WHEN v_status = 'rejeitada' THEN 'rejected'
      ELSE 'provider_confirmed'
    END,
    'nfe', pg_catalog.to_jsonb(v_nfe)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_nfe_emission_command_127(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_nfe_emission_command_127(uuid, jsonb)
  TO service_role;

-- Pollers/cancelamento podem observar o desfecho depois que a Edge original
-- terminou. Sincroniza somente o receipt, sem escrever de volta na NF-e.
CREATE OR REPLACE FUNCTION public.tg_sync_nfe_emission_command_127()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'autorizada' THEN
    UPDATE public.nfe_emission_commands_127 c
       SET state = 'completed',
           provider_nfe_id = COALESCE(c.provider_nfe_id, NEW.provider_nfe_id),
           response = COALESCE(c.response, '{}'::jsonb) || pg_catalog.jsonb_build_object(
             'status', NEW.status, 'provider_nfe_id', NEW.provider_nfe_id,
             'numero', NEW.numero, 'chave_acesso', NEW.chave_acesso,
             'observed_by', 'nfe-status-sync'
           ),
           error_message = NULL,
           completed_at = COALESCE(c.completed_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE c.nfe_id = NEW.id
       AND c.state IN ('provider_confirmed', 'reconciliation_required');
  ELSIF NEW.status = 'rejeitada' THEN
    UPDATE public.nfe_emission_commands_127 c
       SET state = 'rejected',
           error_message = COALESCE(NEW.motivo_rejeicao, c.error_message),
           completed_at = COALESCE(c.completed_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE c.nfe_id = NEW.id
       AND c.state IN ('claimed', 'provider_inflight', 'provider_confirmed', 'reconciliation_required');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_nfe_emission_command_127 ON public.nfe_emitidas;
CREATE TRIGGER trg_sync_nfe_emission_command_127
AFTER UPDATE OF status ON public.nfe_emitidas
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_nfe_emission_command_127();

REVOKE ALL ON FUNCTION public.tg_sync_nfe_emission_command_127()
  FROM PUBLIC, anon, authenticated, service_role;

-- Browser observa fatos fiscais, mas toda mutacao passa pelas Edges/RPCs.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.nfe_emitidas
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.nfe_emitidas TO authenticated;

DO $policies$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN
    SELECT p.policyname FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'nfe_emitidas'
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON public.nfe_emitidas', v_policy.policyname);
  END LOOP;
END;
$policies$;

CREATE POLICY nfe_emitidas_select_127 ON public.nfe_emitidas
FOR SELECT TO authenticated
USING (
  public.is_approved_user()
  AND public.user_has_any_role(ARRAY['admin', 'gerente', 'nfe_operator'])
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = auth.uid() AND up.can_view = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_permissions up
       WHERE up.user_id = auth.uid()
         AND up.can_view = true
         AND up.module IN ('nfe', '/nfe')
    )
  )
);

CREATE OR REPLACE FUNCTION public.run_nfe_emission_command_contracts_127()
RETURNS TABLE(check_name text, passed boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_begin text := pg_catalog.pg_get_functiondef(
    'public.begin_nfe_emission_command_127(uuid,uuid,uuid,date,bigint,text,uuid)'::regprocedure
  );
  v_provider text := pg_catalog.pg_get_functiondef(
    'public.begin_nfe_provider_submission_127(uuid,text,text)'::regprocedure
  );
  v_complete text := pg_catalog.pg_get_functiondef(
    'public.complete_nfe_emission_command_127(uuid,jsonb)'::regprocedure
  );
BEGIN
  check_name := 'claim_precedes_provider';
  passed := v_begin LIKE '%INSERT INTO public.nfe_emitidas%'
    AND v_provider LIKE '%state = ''provider_inflight''%';
  detail := 'Claim local e receipt existem antes do CAS provider_inflight.';
  RETURN NEXT;

  check_name := 'status_allowlist';
  passed := v_begin LIKE '%Aprovado%'
    AND v_begin LIKE '%Em Produção%'
    AND v_begin LIKE '%Rascunho%'
    AND v_begin LIKE '%is_standalone_nfe%';
  detail := 'Normal nao emite Draft/Cancelado; avulsa exige Rascunho.';
  RETURN NEXT;

  check_name := 'snapshot_and_version_required';
  passed := v_begin LIKE '%p_expected_order_version%'
    AND v_begin LIKE '%p_expected_snapshot_hash%'
    AND v_provider LIKE '%build_nfe_emission_snapshot_127%';
  detail := 'Preview, begin e instante pre-POST compartilham o contrato.';
  RETURN NEXT;

  check_name := 'ambiguous_post_is_fail_closed';
  passed := v_provider LIKE '%provider_inflight%'
    AND pg_catalog.pg_get_functiondef(
      'public.mark_nfe_emission_reconciliation_127(uuid,text)'::regprocedure
    ) LIKE '%reconciliation_required%';
  detail := 'POST sem aceite persistido nunca retorna a claimed/retry.';
  RETURN NEXT;

  check_name := 'cancel_state_is_monotonic';
  passed := v_complete LIKE '%status NOT IN (''cancelando'', ''cancelada'')%';
  detail := 'Conclusao tardia da emissao nao ressuscita NF em cancelamento.';
  RETURN NEXT;

  check_name := 'browser_nfe_dml_closed';
  passed := NOT pg_catalog.has_table_privilege('authenticated', 'public.nfe_emitidas', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.nfe_emitidas', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.nfe_emitidas', 'DELETE');
  detail := 'authenticated possui apenas SELECT; Edges usam RPCs.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_nfe_emission_command_contracts_127()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nfe_emission_command_contracts_127()
  TO service_role;

COMMIT;
