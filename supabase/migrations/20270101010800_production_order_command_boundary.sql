-- Fronteira transacional das Ordens de Produção e dos comandos logísticos
-- que alteram PV + OP no mesmo fato operacional.
--
-- Objetivos:
--   * nenhum browser grava diretamente em orders;
--   * criação/materialização/status/cancelamento/exclusão da OP são uma
--     transação idempotente, serializada e auditável;
--   * estoque, solado, embalagem e estágios continuam nos motores canônicos;
--   * expedição, promoção administrativa, restauração e reversão fiscal
--     recebem expected_order_version + receipt, sem writers paralelos.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Receipt comum aos comandos operacionais fora do agregado de PV
-- ---------------------------------------------------------------------------

CREATE TABLE public.operational_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_name text NOT NULL CHECK (command_name IN (
    'create_order', 'ensure_order_stages', 'transition_order',
    'cancel_order', 'delete_order', 'register_shipment',
    'force_sale_order_production', 'soft_delete_sale_order',
    'restore_sale_order', 'revert_invoiced_sale_order',
    'auto_promote_sale_order', 'auto_bill_sale_order'
  )),
  aggregate_key text NOT NULL CHECK (length(btrim(aggregate_key)) > 0),
  client_request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  actor_id uuid,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_request_id)
);

ALTER TABLE public.operational_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operational_command_receipts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.operational_command_receipts TO service_role;

COMMENT ON TABLE public.operational_command_receipts IS
  'Receipts imutáveis dos comandos transacionais de OP/logística. Nunca exposta ao browser.';

-- ---------------------------------------------------------------------------
-- 2) Autorização e implementações internas de OP
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_execute_production_order_command()
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

  RETURN public.is_approved_user()
     AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     AND public.can_execute_production_pointing();
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_production_order_command()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_production_order_stages_internal(
  p_order_id uuid,
  p_allow_draft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_route text[];
  v_created integer := 0;
  v_total integer := 0;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: use execute_production_order_command'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status IN (
    'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
    'Concluído', 'Concluido', 'Concluída'
  ) THEN
    RAISE EXCEPTION 'OP % está terminal e não aceita criação de etapas',
      p_order_id USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'Rascunho' AND NOT COALESCE(p_allow_draft, false) THEN
    RAISE EXCEPTION
      'OP em Rascunho não pode entrar no Kanban sem materialização de estoque'
      USING ERRCODE = 'PZ210';
  END IF;

  SELECT array_agg(route.stage_name ORDER BY route.first_ord)
    INTO v_route
    FROM (
      SELECT public.canonical_stage_name(s.value) AS stage_name,
             min(s.ord)::bigint AS first_ord
        FROM public.technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(ts.production_sectors) = 'array'
              THEN ts.production_sectors
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS s(value, ord)
       WHERE ts.id = v_order.reference_id
         AND NULLIF(btrim(public.canonical_stage_name(s.value)), '') IS NOT NULL
       GROUP BY public.canonical_stage_name(s.value)
    ) route;

  IF COALESCE(array_length(v_route, 1), 0) = 0 THEN
    v_route := ARRAY[
      'Corte Fibra', 'Corte Forração', 'Costura Palmilha',
      'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem',
      'Solagem', 'Acabamento', 'Expedição'
    ];
  ELSIF NOT ('Expedição' = ANY(v_route)) THEN
    v_route := array_append(v_route, 'Expedição');
  END IF;

  INSERT INTO public.order_stages (
    order_id,
    stage_name,
    stage_order,
    status,
    quantity_total,
    quantity_processed,
    observations,
    defects
  )
  SELECT v_order.id,
         route.stage_name,
         CASE
           WHEN public.canonical_stage_order(route.stage_name) = 99
             THEN route.ord::integer
           ELSE public.canonical_stage_order(route.stage_name)
         END,
         'pendente',
         v_order.quantity,
         0,
         '',
         ''
    FROM unnest(v_route) WITH ORDINALITY AS route(stage_name, ord)
  ON CONFLICT (order_id, stage_name) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  SELECT count(*)::integer INTO v_total
    FROM public.order_stages os
   WHERE os.order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'created_stages', v_created,
    'total_stages', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_production_order_stages_internal(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.materialize_production_order_internal(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_packaging_mode text;
  v_materials jsonb;
  v_packaging jsonb;
  v_stages jsonb;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: use execute_production_order_command'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT so.packaging_mode INTO v_packaging_mode
    FROM public.sale_orders so
   WHERE so.id = v_order.sale_order_id
     AND so.deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV vinculado à OP % não foi encontrado', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Fonte única para materiais não-solado. A sobrecarga estreita deriva
  -- referência/quantidade/cor/grade da OP bloqueada.
  v_materials := public.initialize_order_material_reservations(
    p_order_id => v_order.id,
    p_force_soft => true
  );

  IF NULLIF(COALESCE(v_order.grade, '{}'::jsonb), '{}'::jsonb) IS NOT NULL THEN
    PERFORM public.debit_sole_stock_by_grade(
      p_reference_id => v_order.reference_id,
      p_order_id => v_order.id,
      p_color => COALESCE(v_order.color, ''),
      p_order_grade => v_order.grade,
      p_force_soft => true
    );
  END IF;

  -- Fonte única de embalagem. O reconciliador é idempotente por OP e
  -- devolve shortages em JSON em vez de inventar caixa/quantidade.
  v_packaging := public.debit_packaging_for_order(
    p_sale_order_id => v_order.sale_order_id,
    p_order_id => v_order.id,
    p_reference_id => v_order.reference_id,
    p_order_quantity => v_order.quantity::integer,
    p_packaging_mode => COALESCE(v_packaging_mode, 'individual_amarrado'),
    p_force_soft => false
  );

  v_stages := public.ensure_production_order_stages_internal(v_order.id, true);

  RETURN jsonb_build_object(
    'materials', COALESCE(v_materials, '{}'::jsonb),
    'packaging', COALESCE(v_packaging, '[]'::jsonb),
    'stages', COALESCE(v_stages, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_production_order_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_production_order_internal(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_parent_status text;
  v_has_physical_sole boolean := false;
  v_has_positive_net_debit boolean := false;
  v_has_prior_inbound boolean := false;
  v_status_before text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: use execute_production_order_command'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  v_status_before := v_order.status;

  IF v_order.status IN ('Cancelada', 'Cancelado') THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status_before', v_status_before,
      'status', 'Cancelada',
      'already_cancelled', true
    );
  END IF;

  SELECT so.status INTO v_parent_status
    FROM public.sale_orders so
   WHERE so.id = v_order.sale_order_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV vinculado à OP % não encontrado', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_parent_status IN (
    'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
  ) THEN
    RAISE EXCEPTION
      'OP vinculada a PV faturado/finalizado; reverta NF/PV antes de cancelar a OP'
      USING ERRCODE = 'PZ211';
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.stock_movements sm
            WHERE sm.order_id = v_order.id
              AND sm.movement_type = 'out'
              AND (
                sm.description ILIKE 'Debito Solado por grade%'
                OR sm.description ILIKE 'Débito Solado por grade%'
                OR sm.description ILIKE 'Baixa na finalização — Solado por grade%'
              )
         ),
         EXISTS (
           SELECT 1
             FROM public.stock_movements sm
            WHERE sm.order_id = v_order.id
              AND sm.movement_type = 'in'
         ),
         EXISTS (
           SELECT 1
             FROM (
               SELECT sm.product_id,
                      sum(CASE
                        WHEN sm.movement_type = 'out' THEN sm.quantity
                        WHEN sm.movement_type = 'in' THEN -sm.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements sm
                WHERE sm.order_id = v_order.id
                GROUP BY sm.product_id
             ) ledger
            WHERE ledger.net_debit > 0
         )
    INTO v_has_physical_sole,
         v_has_prior_inbound,
         v_has_positive_net_debit;

  -- O restore canônico vivo em instalações legadas soma todas as saídas.
  -- Se já houver entrada parcial e ainda restar débito, abortar é mais seguro
  -- que creditar duas vezes. O ledger fica intacto para reconciliação manual.
  IF v_has_prior_inbound AND v_has_positive_net_debit THEN
    RAISE EXCEPTION
      'Ledger da OP % possui estorno parcial anterior; reconciliação manual obrigatória',
      v_order.id USING ERRCODE = 'PZ212';
  END IF;

  PERFORM public.release_order_reservations(v_order.id);

  -- Reserva soft de solado não altera stock_grade. Só chamar o restore quando
  -- existir a saída física correspondente evita inflar a grade de Reservados.
  -- A saída pode nascer tanto no débito inicial quanto no settle tolerante da
  -- finalização; os dois textos canônicos são reconhecidos acima.
  -- No fluxo legado o restore de solado sempre precedia o restore geral, que
  -- registra a entrada. Se já há IN completa, repetir o restore de grade seria
  -- inflação; se há IN parcial, o guard acima já abortou para reconciliação.
  IF v_has_physical_sole AND NOT v_has_prior_inbound THEN
    PERFORM public.restore_sole_grade_for_order(v_order.id);
  END IF;
  IF v_has_positive_net_debit THEN
    PERFORM public.restore_product_stocks_for_order(v_order.id);
  END IF;

  UPDATE public.orders
     SET status = 'Cancelada',
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status_before', v_status_before,
    'status', 'Cancelada',
    'already_cancelled', false,
    'restored_sole_grade', v_has_physical_sole AND NOT v_has_prior_inbound,
    'restored_product_stock', v_has_positive_net_debit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_production_order_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Entry point único de OP
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_production_order_command(
  p_command text,
  p_order_id uuid,
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
  v_aggregate_key text;
  v_request_hash text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_reference_id uuid;
  v_sale_order_id uuid;
  v_quantity numeric;
  v_grade jsonb;
  v_target_status text;
  v_expected_status text;
  v_parent_status text;
  v_parent_standalone boolean := false;
  v_materialization jsonb := '{}'::jsonb;
  v_result jsonb;
  v_previous_internal text;
  v_previous_stock_sync text;
BEGIN
  IF v_command NOT IN ('create', 'ensure_stages', 'transition', 'cancel', 'delete') THEN
    RAISE EXCEPTION 'Comando de OP não suportado: %', p_command
      USING ERRCODE = '22023';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload do comando deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;
  IF v_command <> 'create' AND p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id é obrigatório para o comando %', v_command
      USING ERRCODE = '22004';
  END IF;
  IF v_command = 'create' AND p_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'create não aceita order_id fornecido pelo cliente'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_execute_production_order_command() THEN
    RAISE EXCEPTION
      'Permission denied: comando de OP exige Produção/Gerência e edição em /orders'
      USING ERRCODE = '42501';
  END IF;

  v_command_name := CASE v_command
    WHEN 'create' THEN 'create_order'
    WHEN 'ensure_stages' THEN 'ensure_order_stages'
    WHEN 'transition' THEN 'transition_order'
    WHEN 'cancel' THEN 'cancel_order'
    ELSE 'delete_order'
  END;
  v_aggregate_key := CASE
    WHEN p_order_id IS NULL THEN 'production-order:new'
    ELSE 'production-order:' || p_order_id::text
  END;
  v_request_hash := md5(jsonb_build_object(
    'command', v_command,
    'order_id', p_order_id,
    'payload', v_payload
  )::text);

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
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

  -- Ordem global de locks entre agregados: PV -> OP. Os commands comerciais
  -- seguem a mesma ordem; inverter aqui (OP -> PV) permite deadlock entre
  -- cancelamento de OP e promoção/edição do PV.
  IF p_order_id IS NULL THEN
    BEGIN
      v_sale_order_id := NULLIF(
        btrim(COALESCE(v_payload ->> 'sale_order_id', '')),
        ''
      )::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'sale_order_id inválido'
        USING ERRCODE = '22023';
    END;
  ELSE
    SELECT o.sale_order_id INTO v_sale_order_id
      FROM public.orders o
     WHERE o.id = p_order_id;
  END IF;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    ));
    PERFORM 1
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'production-order:' || p_order_id::text,
      0
    ));
  END IF;

  v_previous_internal := pg_catalog.current_setting(
    'app.production_order_command_internal',
    true
  );
  v_previous_stock_sync := pg_catalog.current_setting(
    'app.internal_stock_sync',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    '1',
    true
  );
  PERFORM pg_catalog.set_config('app.internal_stock_sync', '1', true);

  CASE v_command
    WHEN 'create' THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_payload) AS payload_key(key)
         WHERE payload_key.key NOT IN (
           'reference_id', 'sale_order_id', 'quantity', 'notes', 'color',
           'grade', 'planned_start', 'planned_delivery', 'production_line',
           'responsible', 'status'
         )
      ) THEN
        RAISE EXCEPTION 'Payload de create contém campo não permitido'
          USING ERRCODE = '22023';
      END IF;

      v_reference_id := NULLIF(btrim(COALESCE(v_payload ->> 'reference_id', '')), '')::uuid;
      v_sale_order_id := NULLIF(btrim(COALESCE(v_payload ->> 'sale_order_id', '')), '')::uuid;
      v_quantity := NULLIF(btrim(COALESCE(v_payload ->> 'quantity', '')), '')::numeric;
      v_target_status := COALESCE(NULLIF(btrim(v_payload ->> 'status'), ''), 'Reservado');
      v_grade := CASE
        WHEN NOT (v_payload ? 'grade') OR v_payload -> 'grade' = 'null'::jsonb
          THEN NULL
        WHEN jsonb_typeof(v_payload -> 'grade') = 'object'
          THEN v_payload -> 'grade'
        ELSE NULL
      END;

      IF v_reference_id IS NULL OR v_sale_order_id IS NULL THEN
        RAISE EXCEPTION 'reference_id e sale_order_id são obrigatórios'
          USING ERRCODE = '22004';
      END IF;
      IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION 'quantity deve ser inteiro positivo'
          USING ERRCODE = '22023';
      END IF;
      IF v_target_status NOT IN ('Rascunho', 'Reservado') THEN
        RAISE EXCEPTION 'Status inicial inválido: %', v_target_status
          USING ERRCODE = '22023';
      END IF;
      IF (v_payload ? 'grade')
         AND v_payload -> 'grade' <> 'null'::jsonb
         AND jsonb_typeof(v_payload -> 'grade') <> 'object' THEN
        RAISE EXCEPTION 'grade deve ser objeto JSON ou null'
          USING ERRCODE = '22023';
      END IF;
      IF length(COALESCE(v_payload ->> 'notes', '')) > 4000
         OR length(COALESCE(v_payload ->> 'color', '')) > 200
         OR length(COALESCE(v_payload ->> 'production_line', '')) > 200
         OR length(COALESCE(v_payload ->> 'responsible', '')) > 200 THEN
        RAISE EXCEPTION 'Texto excede o limite do comando de OP'
          USING ERRCODE = '22023';
      END IF;

      PERFORM 1
        FROM public.technical_sheets ts
       WHERE ts.id = v_reference_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ficha técnica % não encontrada', v_reference_id
          USING ERRCODE = 'P0002';
      END IF;

      SELECT so.status, COALESCE(so.is_standalone_nfe, false)
        INTO v_parent_status, v_parent_standalone
        FROM public.sale_orders so
       WHERE so.id = v_sale_order_id
         AND so.deleted_at IS NULL
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PV % não encontrado', v_sale_order_id
          USING ERRCODE = 'P0002';
      END IF;
      IF v_parent_standalone THEN
        RAISE EXCEPTION 'NF-e avulsa não cria Ordem de Produção'
          USING ERRCODE = 'PZ213';
      END IF;
      IF v_parent_status IN (
        'Cancelado', 'Cancelada', 'Faturado', 'Expedido', 'Concluído',
        'Finalizado s/ NF'
      ) THEN
        RAISE EXCEPTION 'PV em status % não aceita nova OP', v_parent_status
          USING ERRCODE = 'PZ214';
      END IF;

      INSERT INTO public.orders (
        reference_id,
        sale_order_id,
        quantity,
        notes,
        status,
        color,
        grade,
        planned_start,
        planned_delivery,
        production_line,
        responsible
      ) VALUES (
        v_reference_id,
        v_sale_order_id,
        v_quantity::integer,
        NULLIF(v_payload ->> 'notes', ''),
        'Rascunho',
        COALESCE(v_payload ->> 'color', ''),
        v_grade,
        NULLIF(v_payload ->> 'planned_start', '')::date,
        NULLIF(v_payload ->> 'planned_delivery', '')::date,
        COALESCE(v_payload ->> 'production_line', ''),
        COALESCE(v_payload ->> 'responsible', '')
      )
      RETURNING * INTO v_order;

      IF v_target_status = 'Reservado' THEN
        v_materialization := public.materialize_production_order_internal(v_order.id);
        UPDATE public.orders
           SET status = 'Reservado',
               updated_at = now()
         WHERE id = v_order.id
        RETURNING * INTO v_order;
      END IF;

      v_result := jsonb_build_object(
        'ok', true,
        'command', v_command,
        'order', to_jsonb(v_order),
        'order_id', v_order.id,
        'status', v_order.status,
        'materialization', v_materialization
      );

    WHEN 'ensure_stages' THEN
      IF v_payload <> '{}'::jsonb THEN
        RAISE EXCEPTION 'ensure_stages não aceita payload'
          USING ERRCODE = '22023';
      END IF;
      v_result := jsonb_build_object(
        'ok', true,
        'command', v_command,
        'order_id', p_order_id,
        'stages', public.ensure_production_order_stages_internal(
          p_order_id,
          false
        )
      );

    WHEN 'transition' THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_payload) AS payload_key(key)
         WHERE payload_key.key NOT IN ('target_status', 'expected_status')
      ) THEN
        RAISE EXCEPTION 'transition aceita somente target_status/expected_status'
          USING ERRCODE = '22023';
      END IF;
      v_target_status := NULLIF(btrim(COALESCE(v_payload ->> 'target_status', '')), '');
      v_expected_status := NULLIF(btrim(COALESCE(v_payload ->> 'expected_status', '')), '');
      IF v_target_status NOT IN (
        'Reservado', 'Em Produção', 'Finalizado', 'Cancelada'
      ) THEN
        RAISE EXCEPTION 'Status alvo inválido: %', v_target_status
          USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_order
        FROM public.orders o
       WHERE o.id = p_order_id
         AND o.deleted_at IS NULL
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OP % não encontrada', p_order_id
          USING ERRCODE = 'P0002';
      END IF;
      IF v_expected_status IS NOT NULL
         AND v_order.status IS DISTINCT FROM v_expected_status THEN
        RAISE EXCEPTION
          'Status da OP mudou simultaneamente (% -> %); recarregue',
          v_expected_status,
          v_order.status USING ERRCODE = '40001';
      END IF;

      IF v_target_status = 'Cancelada' THEN
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'result', public.cancel_production_order_internal(p_order_id)
        );
      ELSIF v_order.status = v_target_status THEN
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'status', v_order.status,
          'already_applied', true
        );
      ELSE
        IF v_target_status = 'Reservado'
           AND v_order.status <> 'Rascunho' THEN
          RAISE EXCEPTION 'Transição de OP inválida: % -> %',
            v_order.status, v_target_status USING ERRCODE = '22023';
        ELSIF v_target_status = 'Em Produção'
              AND v_order.status NOT IN ('Rascunho', 'Reservado') THEN
          RAISE EXCEPTION 'Transição de OP inválida: % -> %',
            v_order.status, v_target_status USING ERRCODE = '22023';
        ELSIF v_target_status = 'Finalizado'
              AND v_order.status NOT IN ('Em Produção', 'Concluída') THEN
          RAISE EXCEPTION 'Transição de OP inválida: % -> %',
            v_order.status, v_target_status USING ERRCODE = '22023';
        END IF;

        IF v_order.status = 'Rascunho'
           AND v_target_status IN ('Reservado', 'Em Produção') THEN
          v_materialization := public.materialize_production_order_internal(
            v_order.id
          );
        ELSIF v_target_status = 'Em Produção' THEN
          PERFORM public.ensure_production_order_stages_internal(
            v_order.id,
            false
          );
        END IF;

        UPDATE public.orders
           SET status = v_target_status,
               updated_at = now()
         WHERE id = v_order.id
        RETURNING * INTO v_order;

        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', v_order.id,
          'status', v_order.status,
          'status_before', v_expected_status,
          'materialization', v_materialization
        );
      END IF;

    WHEN 'cancel' THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_payload) AS payload_key(key)
         WHERE payload_key.key <> 'expected_status'
      ) THEN
        RAISE EXCEPTION 'cancel aceita somente expected_status'
          USING ERRCODE = '22023';
      END IF;
      v_expected_status := NULLIF(btrim(COALESCE(v_payload ->> 'expected_status', '')), '');
      SELECT * INTO v_order
        FROM public.orders o
       WHERE o.id = p_order_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OP % não encontrada', p_order_id
          USING ERRCODE = 'P0002';
      END IF;
      IF v_expected_status IS NOT NULL
         AND v_order.status IS DISTINCT FROM v_expected_status THEN
        RAISE EXCEPTION 'Status da OP mudou simultaneamente; recarregue'
          USING ERRCODE = '40001';
      END IF;
      v_result := jsonb_build_object(
        'ok', true,
        'command', v_command,
        'order_id', p_order_id,
        'result', public.cancel_production_order_internal(p_order_id)
      );

    WHEN 'delete' THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_payload) AS payload_key(key)
         WHERE payload_key.key <> 'expected_status'
      ) THEN
        RAISE EXCEPTION 'delete aceita somente expected_status'
          USING ERRCODE = '22023';
      END IF;
      v_expected_status := NULLIF(btrim(COALESCE(v_payload ->> 'expected_status', '')), '');
      SELECT * INTO v_order
        FROM public.orders o
       WHERE o.id = p_order_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OP % não encontrada', p_order_id
          USING ERRCODE = 'P0002';
      END IF;
      IF v_order.deleted_at IS NOT NULL THEN
        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', p_order_id,
          'already_deleted', true
        );
      ELSE
        IF v_expected_status IS NOT NULL
           AND v_order.status IS DISTINCT FROM v_expected_status THEN
          RAISE EXCEPTION 'Status da OP mudou simultaneamente; recarregue'
            USING ERRCODE = '40001';
        END IF;
        IF v_order.status NOT IN ('Cancelada', 'Cancelado') THEN
          PERFORM public.cancel_production_order_internal(v_order.id);
        END IF;

        UPDATE public.orders
           SET deleted_at = now(),
               updated_at = now()
         WHERE id = v_order.id;

        v_result := jsonb_build_object(
          'ok', true,
          'command', v_command,
          'order_id', v_order.id,
          'deleted', true,
          'deletion_mode', 'soft',
          'audit_preserved', true
        );
      END IF;
  END CASE;

  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    COALESCE(v_previous_internal, ''),
    true
  );
  PERFORM pg_catalog.set_config(
    'app.internal_stock_sync',
    COALESCE(v_previous_stock_sync, ''),
    true
  );

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
    new_data,
    success,
    created_at
  ) VALUES (
    v_actor_id,
    'production_order_command_' || v_command,
    'orders',
    COALESCE(p_order_id, NULLIF(v_result ->> 'order_id', '')::uuid),
    v_result,
    true,
    now()
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_production_order_command(
  text, uuid, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_production_order_command(
  text, uuid, uuid, jsonb
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Cutover de orders: grants + RLS + trigger de defesa em profundidade
-- ---------------------------------------------------------------------------

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
     -- Escritas originadas por triggers canônicos (ex.: conclusão do último
     -- setor) entram com profundidade > 1; a chamada DML original entra em 1.
     OR pg_catalog.pg_trigger_depth() > 1 THEN
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

DROP TRIGGER IF EXISTS trg_000_enforce_production_order_command_boundary
  ON public.orders;
CREATE TRIGGER trg_000_enforce_production_order_command_boundary
BEFORE INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_production_order_command_boundary();

-- Remove toda policy de escrita histórica. SELECT continua visível somente
-- para usuário aprovado e para OP não excluída logicamente.
DO $drop_orders_write_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT pol.polname
      FROM pg_catalog.pg_policy pol
     WHERE pol.polrelid = 'public.orders'::regclass
       AND pol.polcmd <> 'r'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.orders',
      v_policy.polname
    );
  END LOOP;
END;
$drop_orders_write_policies$;

DROP POLICY IF EXISTS orders_select_approved ON public.orders;
CREATE POLICY orders_select_approved
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_approved_user() AND deleted_at IS NULL);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.orders
  FROM PUBLIC, anon, authenticated;
-- TRUNCATE não dispara trigger nem respeita RLS; REFERENCES/TRIGGER também
-- não pertencem à superfície do browser.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.orders
  FROM PUBLIC, anon, authenticated;
-- Grants por coluna sobrevivem ao REVOKE da tabela.
DO $revoke_orders_column_writes$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.orders FROM PUBLIC, anon, authenticated',
      v_columns
    );
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.orders FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END;
$revoke_orders_column_writes$;
GRANT SELECT ON TABLE public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;

-- O apontamento canônico pode concluir a OP ao fechar o último setor. Marca
-- toda a chamada (incluindo triggers internos) sem abrir DML direto ao browser.
CREATE OR REPLACE FUNCTION public.apontar_producao_setor(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_finalize boolean DEFAULT false,
  p_confirmed_warnings text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_internal text;
  v_sale_order_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Permission denied: usuário sem permissão de edição para apontar produção';
  END IF;

  -- Mantém a mesma ordem PV -> OP do command boundary antes de o impl tocar
  -- etapa/OP. Sem isto, o trigger automático que promove o PV poderia entrar
  -- em deadlock com uma edição comercial concorrente.
  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    ));
    PERFORM 1
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;
  END IF;

  v_previous_internal := pg_catalog.current_setting(
    'app.production_order_command_internal',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    '1',
    true
  );
  v_result := public.apontar_producao_setor_impl(
    p_order_id,
    p_stage_name,
    p_quantity,
    p_operator_employee_id,
    p_note,
    p_finalize,
    p_confirmed_warnings
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    COALESCE(v_previous_internal, ''),
    true
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) TO authenticated, service_role;

-- Os dois gatilhos históricos de order_stages promoviam/faturavam o PV com
-- UPDATE direto. Depois do boundary 105 isso abortaria o apontamento inteiro.
-- Este command interno preserva somente as duas arestas históricas, com lock,
-- versão na identidade idempotente, receipt e marcador explícito do agregado.
CREATE OR REPLACE FUNCTION public.apply_sale_order_stage_transition_internal(
  p_sale_order_id uuid,
  p_target_status text,
  p_source_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_command_name text;
  v_request_id uuid;
  v_request_hash text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_pending_count integer := 0;
  v_previous_sale_internal text;
  v_result jsonb;
BEGIN
  IF p_sale_order_id IS NULL OR p_source_stage_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id e source_stage_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF p_target_status NOT IN ('Em Produção', 'Faturado') THEN
    RAISE EXCEPTION 'Transição automática não suportada: %', p_target_status
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.pg_trigger_depth() = 0
     AND COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: transição exige gatilho de etapa'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'sale_order_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.order_stages os
      JOIN public.orders o ON o.id = os.order_id
     WHERE os.id = p_source_stage_id
       AND o.sale_order_id = v_so.id
       AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Etapa % não pertence ao PV %',
      p_source_stage_id,
      p_sale_order_id USING ERRCODE = '22023';
  END IF;

  IF p_target_status = 'Em Produção' THEN
    IF v_so.status <> 'Aprovado' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', 'status_not_approved',
        'status', v_so.status
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.id = p_source_stage_id
         AND os.status IN ('em_andamento', 'in_progress', 'iniciado')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'stage_not_started');
    END IF;
    v_command_name := 'auto_promote_sale_order';
  ELSE
    IF NOT COALESCE(v_so.nfe_required, true)
       OR v_so.status IN (
         'Faturado', 'Finalizado s/ NF', 'Expedido', 'Concluído',
         'Cancelado', 'Rascunho'
       ) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', 'billing_not_applicable',
        'status', v_so.status
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.id = p_source_stage_id
         AND os.stage_name = 'Acabamento'
         AND os.status = 'concluido'
    ) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'finishing_not_completed');
    END IF;

    SELECT count(*)::integer INTO v_pending_count
      FROM public.orders o
     WHERE o.sale_order_id = v_so.id
       AND COALESCE(o.status, '') NOT IN (
         'cancelada', 'Cancelada', 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.order_stages os
          WHERE os.order_id = o.id
            AND os.stage_name = 'Acabamento'
            AND os.status = 'concluido'
       );
    IF v_pending_count <> 0 THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', 'finishing_stages_pending',
        'pending_count', v_pending_count
      );
    END IF;
    v_command_name := 'auto_bill_sale_order';
  END IF;

  -- A versão faz uma nova passagem válida após um estorno gerar outra chave,
  -- sem permitir que dois triggers concorrentes apliquem a mesma aresta.
  v_request_id := md5(
    'stage-transition:' || v_so.id::text || ':' || p_target_status || ':' ||
    COALESCE(v_so.order_version, 0)::text
  )::uuid;
  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', v_so.id,
    'status_before', v_so.status,
    'target_status', p_target_status,
    'expected_order_version', v_so.order_version
  )::text);
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = v_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> v_command_name
       OR v_receipt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'Colisão na identidade da transição automática do PV'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  v_previous_sale_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal', true
  );
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  UPDATE public.sale_orders
     SET status = p_target_status,
         updated_at = now()
   WHERE id = v_so.id;
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal',
    COALESCE(v_previous_sale_internal, ''),
    true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'sale_order_id', v_so.id,
    'status_before', v_so.status,
    'status', p_target_status,
    'expected_order_version', v_so.order_version,
    'source_stage_id', p_source_stage_id
  );
  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    v_command_name,
    'sale-order:' || v_so.id::text,
    v_request_id,
    v_request_hash,
    auth.uid(),
    v_result
  );
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data,
    success, created_at
  ) VALUES (
    auth.uid(),
    v_command_name,
    'sale_orders',
    v_so.id,
    jsonb_build_object(
      'status', v_so.status,
      'order_version', v_so.order_version
    ),
    v_result,
    true,
    now()
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_sale_order_stage_transition_internal(
  uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_promote_sale_order_to_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale_order_id uuid;
BEGIN
  IF NEW.status NOT IN ('em_andamento', 'in_progress', 'iniciado') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM public.apply_sale_order_stage_transition_internal(
      v_sale_order_id,
      'Em Produção',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_promote_sale_order_to_production()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_auto_promote_sale_order_to_production
  ON public.order_stages;
CREATE TRIGGER trg_auto_promote_sale_order_to_production
AFTER INSERT OR UPDATE OF status ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_promote_sale_order_to_production();

CREATE OR REPLACE FUNCTION public.auto_bill_sale_order_on_finishing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale_order_id uuid;
BEGIN
  IF NEW.stage_name <> 'Acabamento' OR NEW.status <> 'concluido' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM public.apply_sale_order_stage_transition_internal(
      v_sale_order_id,
      'Faturado',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_bill_sale_order_on_finishing()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_auto_bill_sale_order_on_finishing
  ON public.order_stages;
CREATE TRIGGER trg_auto_bill_sale_order_on_finishing
AFTER INSERT OR UPDATE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_bill_sale_order_on_finishing();

-- ---------------------------------------------------------------------------
-- 5) Expedição: PV + estágios + OP + manifesto na mesma transação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_execute_order_shipment_command()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_granular boolean := false;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  IF public.user_has_any_role(ARRAY['admin']) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF v_has_granular THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.user_permissions up
       WHERE up.user_id = v_user_id
         AND up.can_view
         AND up.can_edit
         AND up.module IN ('expedicao', '/conferencia-saida')
    );
  END IF;

  RETURN public.user_has_any_role(ARRAY['gerente', 'producao']);
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_order_shipment_command()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_order_shipment_command(
  p_sale_order_ids uuid[],
  p_expected_versions jsonb,
  p_manifest_id uuid,
  p_checked_by text,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_so record;
  v_expected bigint;
  v_target_status text;
  v_transitioned_ids uuid[] := '{}'::uuid[];
  v_count integer := 0;
  v_preflight_count integer := 0;
  v_request_hash text;
  v_aggregate_key text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_result jsonb;
  v_previous_sale_internal text;
  v_previous_order_internal text;
BEGIN
  IF NOT public.can_execute_order_shipment_command() THEN
    RAISE EXCEPTION
      'Permission denied: expedição exige edição em /conferencia-saida'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  IF p_sale_order_ids IS NULL OR array_length(p_sale_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'sale_order_ids é obrigatório'
      USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(COALESCE(p_expected_versions, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'expected_versions deve ser objeto {sale_order_id: version}'
      USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(p_checked_by, '')) > 200 THEN
    RAISE EXCEPTION 'checked_by excede 200 caracteres'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT x.id ORDER BY x.id)
    INTO v_ids
    FROM unnest(p_sale_order_ids) AS x(id)
   WHERE x.id IS NOT NULL;
  IF COALESCE(array_length(v_ids, 1), 0) <> array_length(p_sale_order_ids, 1) THEN
    RAISE EXCEPTION 'sale_order_ids contém nulo ou duplicata'
      USING ERRCODE = '22023';
  END IF;

  v_aggregate_key := 'shipment:' || md5(to_jsonb(v_ids)::text);
  v_request_hash := md5(jsonb_build_object(
    'sale_order_ids', v_ids,
    'expected_versions', COALESCE(p_expected_versions, '{}'::jsonb),
    'manifest_id', p_manifest_id,
    'checked_by', p_checked_by
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'register_shipment'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  -- Mesmo lock lógico do command boundary comercial, adquirido em ordem
  -- determinística antes dos row locks do lote.
  FOR v_so IN
    SELECT x.id
      FROM unnest(v_ids) AS x(id)
     ORDER BY x.id
  LOOP
    PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_so.id::text,
      0
    ));
  END LOOP;

  -- Locks determinísticos e TODO o preflight acontecem antes da primeira
  -- escrita. Assim o lote nunca fica parcialmente expedido.
  FOR v_so IN
    SELECT so.id,
           so.order_number,
           so.status,
           so.order_version,
           so.nfe_required,
           so.nfe_external,
           so.shipped_at
      FROM public.sale_orders so
     WHERE so.id = ANY(v_ids)
       AND so.deleted_at IS NULL
     ORDER BY so.id
     FOR UPDATE
  LOOP
    v_preflight_count := v_preflight_count + 1;
    IF NOT (COALESCE(p_expected_versions, '{}'::jsonb) ? v_so.id::text)
       OR COALESCE(p_expected_versions ->> v_so.id::text, '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'expected_version ausente/inválida para PV %', v_so.id
        USING ERRCODE = '22023';
    END IF;
    v_expected := (p_expected_versions ->> v_so.id::text)::bigint;
    IF v_expected IS DISTINCT FROM v_so.order_version THEN
      RAISE EXCEPTION
        'PV % mudou simultaneamente (esperado v%, atual v%)',
        v_so.order_number,
        v_expected,
        v_so.order_version USING ERRCODE = '40001';
    END IF;

    -- O status comercial ainda fica Em Produção nos dois caminhos que o
    -- próprio shipment vai fechar (informal e NF externa). Neles a prontidão
    -- vem das OPs: pelo menos uma ativa e nenhuma ainda aberta.
    IF v_so.status = 'Em Produção'
       AND (
         NOT EXISTS (
           SELECT 1
             FROM public.orders o
            WHERE o.sale_order_id = v_so.id
              AND o.deleted_at IS NULL
              AND o.status NOT IN ('Cancelado', 'Cancelada')
         )
         OR EXISTS (
           SELECT 1
             FROM public.orders o
            WHERE o.sale_order_id = v_so.id
              AND o.deleted_at IS NULL
              AND o.status NOT IN (
                'Finalizado', 'FINALIZADO', 'Faturado',
                'Concluída', 'Concluído', 'Concluido', 'completed',
                'Cancelado', 'Cancelada'
              )
         )
       ) THEN
      RAISE EXCEPTION 'PV % ainda possui OP em produção', v_so.order_number
        USING ERRCODE = 'PZ216';
    END IF;

    IF v_so.nfe_required AND NOT COALESCE(v_so.nfe_external, false) THEN
      IF v_so.status <> 'Faturado' THEN
        RAISE EXCEPTION 'PV % formal precisa estar Faturado para expedir',
          v_so.order_number USING ERRCODE = 'PZ216';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.nfe_emitidas ne
         WHERE ne.sale_order_id = v_so.id
           AND lower(ne.status) IN ('autorizada', 'aprovada')
      ) THEN
        RAISE EXCEPTION 'PV % não possui NF-e autorizada', v_so.order_number
          USING ERRCODE = 'PZ216';
      END IF;
    ELSIF NOT v_so.nfe_required THEN
      IF v_so.status <> 'Em Produção' THEN
        RAISE EXCEPTION 'PV % informal precisa estar Em Produção para concluir',
          v_so.order_number USING ERRCODE = 'PZ216';
      END IF;
    ELSE
      -- NF externa é a única allow-list que pode ir de Em Produção
      -- diretamente a Expedido. O guard depende dos dois flags, nunca de texto.
      IF NOT COALESCE(v_so.nfe_external, false)
         OR v_so.status NOT IN ('Em Produção', 'Faturado') THEN
        RAISE EXCEPTION 'PV % externo está incoerente para expedição',
          v_so.order_number USING ERRCODE = 'PZ216';
      END IF;
    END IF;
  END LOOP;
  IF v_preflight_count <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais PVs do lote não foram encontrados'
      USING ERRCODE = 'P0002';
  END IF;

  v_previous_sale_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal',
    true
  );
  v_previous_order_internal := pg_catalog.current_setting(
    'app.production_order_command_internal',
    true
  );
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);

  FOR v_so IN
    SELECT so.id,
           so.order_number,
           so.status,
           so.nfe_required,
           so.nfe_external
      FROM public.sale_orders so
     WHERE so.id = ANY(v_ids)
       AND so.deleted_at IS NULL
     ORDER BY so.id
     FOR UPDATE
  LOOP
    v_target_status := CASE
      WHEN NOT v_so.nfe_required THEN 'Finalizado s/ NF'
      ELSE 'Expedido'
    END;

    -- Transição logística estreita. O preflight acima é a allow-list
    -- completa, inclusive o caso NF externa que não pertence ao comando
    -- comercial genérico.
    UPDATE public.sale_orders
       SET shipped_at = COALESCE(shipped_at, now()),
           checked_by = COALESCE(NULLIF(p_checked_by, ''), checked_by),
           status = v_target_status,
           updated_at = now()
     WHERE id = v_so.id;

    v_transitioned_ids := array_append(v_transitioned_ids, v_so.id);
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.order_stages os
     SET status = 'concluido',
         quantity_processed = COALESCE(os.quantity_total, os.quantity_processed),
         completed_by = COALESCE(os.completed_by, v_actor_id),
         started_at = COALESCE(os.started_at, now()),
         completed_at = COALESCE(os.completed_at, now()),
         updated_at = now()
   WHERE os.status <> 'concluido'
     AND os.order_id IN (
       SELECT o.id
         FROM public.orders o
        WHERE o.sale_order_id = ANY(v_transitioned_ids)
          AND o.deleted_at IS NULL
          AND o.status NOT IN ('Cancelado', 'Cancelada')
     );

  UPDATE public.orders o
     SET status = 'Finalizado',
         last_sector_finished_at = COALESCE(o.last_sector_finished_at, now()),
         updated_at = now()
   WHERE o.sale_order_id = ANY(v_transitioned_ids)
     AND o.deleted_at IS NULL
     AND o.status NOT IN ('Finalizado', 'Cancelado', 'Cancelada');

  IF p_manifest_id IS NOT NULL THEN
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS input(id)
    ),
    ordered_items AS (
      SELECT lmi.id,
             row_number() OVER (ORDER BY lmi.created_at, lmi.id) AS rn
        FROM public.loading_manifest_items lmi
       WHERE lmi.manifest_id = p_manifest_id
         AND lmi.sale_order_id IS NULL
    )
    UPDATE public.loading_manifest_items lmi
       SET sale_order_id = ordered_ids.id
      FROM ordered_items
      JOIN ordered_ids USING (rn)
     WHERE lmi.id = ordered_items.id;
  END IF;

  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal',
    COALESCE(v_previous_sale_internal, ''),
    true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal',
    COALESCE(v_previous_order_internal, ''),
    true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'shipped_count', v_count,
    'sale_order_ids', to_jsonb(v_transitioned_ids),
    'manifest_id', p_manifest_id
  );
  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'register_shipment', v_aggregate_key, p_client_request_id, v_request_hash,
    v_actor_id, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Commands estreitos dos legados de PV que também escrevem em orders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.force_sale_order_production_command(
  p_sale_order_id uuid,
  p_expected_order_version bigint,
  p_client_request_id uuid,
  p_override_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_request_hash text;
  v_aggregate_key text := 'sale-order:' || p_sale_order_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_envelope jsonb;
  v_result jsonb;
BEGIN
  IF p_sale_order_id IS NULL OR p_expected_order_version IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id, expected_order_version e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Apenas administradores podem promover produção por este comando'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'expected_order_version', p_expected_order_version,
    'override_id', p_override_id
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'force_sale_order_production'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou simultaneamente (esperado v%, atual v%)',
      p_expected_order_version,
      v_so.order_version USING ERRCODE = '40001';
  END IF;
  IF COALESCE(v_so.is_standalone_nfe, false) THEN
    RAISE EXCEPTION 'NF-e avulsa não pode ser promovida para produção'
      USING ERRCODE = 'PZ217';
  END IF;

  v_envelope := public.execute_sale_order_command(
    p_sale_order_id,
    'promote',
    p_expected_order_version,
    'force-production:' || p_client_request_id::text,
    '{}'::jsonb,
    p_override_id
  );
  IF NOT COALESCE((v_envelope ->> 'ok')::boolean, false) THEN
    v_result := jsonb_build_object(
      'ok', false,
      'sale_order_id', p_sale_order_id,
      'error', COALESCE(
        v_envelope -> 'error',
        jsonb_build_object(
          'code', 'P0001',
          'message', 'Promoção recusada pelo command boundary de PV'
        )
      ),
      'sale_order_receipt_id', v_envelope -> 'receipt_id'
    );
  ELSE
    v_result := jsonb_build_object(
      'ok', true,
      'sale_order_id', p_sale_order_id,
      'result', COALESCE(v_envelope -> 'result', '{}'::jsonb),
      'sale_order_receipt_id', v_envelope -> 'receipt_id'
    );
  END IF;
  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'force_sale_order_production', v_aggregate_key, p_client_request_id,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.force_sale_order_production_command(
  uuid, bigint, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_sale_order_production_command(
  uuid, bigint, uuid, uuid
) TO authenticated, service_role;

-- Os motores antigos de soft delete/reversão permanecem apenas como
-- implementação. Seus efeitos são preservados literalmente; o wrapper novo
-- adiciona auth, versão, receipt e os marcadores dos dois boundaries.
DO $rename_sale_order_legacy_writers$
BEGIN
  IF to_regprocedure('public.soft_delete_sale_order(uuid)') IS NOT NULL
     AND to_regprocedure('public.soft_delete_sale_order_internal_108(uuid)') IS NULL THEN
    ALTER FUNCTION public.soft_delete_sale_order(uuid)
      RENAME TO soft_delete_sale_order_internal_108;
  END IF;
  IF to_regprocedure('public.revert_invoiced_sale_order(uuid,text)') IS NOT NULL
     AND to_regprocedure('public.revert_invoiced_sale_order_internal_108(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.revert_invoiced_sale_order(uuid, text)
      RENAME TO revert_invoiced_sale_order_internal_108;
  END IF;
END;
$rename_sale_order_legacy_writers$;

CREATE OR REPLACE FUNCTION public.soft_delete_sale_order_command(
  p_sale_order_id uuid,
  p_expected_order_version bigint,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_request_hash text;
  v_aggregate_key text := 'sale-order:' || p_sale_order_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_previous_sale_internal text;
  v_previous_order_internal text;
  v_result jsonb;
BEGIN
  IF p_sale_order_id IS NULL OR p_expected_order_version IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id, expected_order_version e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Permission denied: exclusão lógica exige edição em /sales'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'expected_order_version', p_expected_order_version
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'soft_delete_sale_order'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado/ativo', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou simultaneamente (esperado v%, atual v%)',
      p_expected_order_version,
      v_so.order_version USING ERRCODE = '40001';
  END IF;

  v_previous_sale_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal', true
  );
  v_previous_order_internal := pg_catalog.current_setting(
    'app.production_order_command_internal', true
  );
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);
  v_result := public.soft_delete_sale_order_internal_108(p_sale_order_id);
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal', COALESCE(v_previous_sale_internal, ''), true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal', COALESCE(v_previous_order_internal, ''), true
  );

  v_result := jsonb_build_object('ok', true, 'result', v_result);
  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'soft_delete_sale_order', v_aggregate_key, p_client_request_id,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_sale_order_command(uuid, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_sale_order_command(uuid, bigint, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_deleted_sale_order_restore_context(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Permission denied: restauração exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'sale_order_id', v_so.id,
    'order_number', v_so.order_number,
    'order_version', v_so.order_version,
    'deleted_at', v_so.deleted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_deleted_sale_order_restore_context(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deleted_sale_order_restore_context(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_sale_order_command(
  p_sale_order_id uuid,
  p_expected_order_version bigint,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_request_hash text;
  v_aggregate_key text := 'sale-order:' || p_sale_order_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_previous_sale_internal text;
  v_previous_order_internal text;
  v_ops_restored integer := 0;
  v_result jsonb;
BEGIN
  IF p_sale_order_id IS NULL OR p_expected_order_version IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id, expected_order_version e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Permission denied: restauração exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'expected_order_version', p_expected_order_version
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'restore_sale_order'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou simultaneamente (esperado v%, atual v%)',
      p_expected_order_version,
      v_so.order_version USING ERRCODE = '40001';
  END IF;

  IF v_so.deleted_at IS NULL THEN
    v_result := jsonb_build_object(
      'ok', true,
      'sale_order_id', v_so.id,
      'order_number', v_so.order_number,
      'already_restored', true,
      'ops_restored', 0
    );
  ELSE
    v_previous_sale_internal := pg_catalog.current_setting(
      'app.sale_order_command_internal', true
    );
    v_previous_order_internal := pg_catalog.current_setting(
      'app.production_order_command_internal', true
    );
    PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
    PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);

    UPDATE public.sale_orders
       SET deleted_at = NULL,
           updated_at = now()
     WHERE id = v_so.id;
    UPDATE public.orders
       SET deleted_at = NULL,
           updated_at = now()
     WHERE sale_order_id = v_so.id
       AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_ops_restored = ROW_COUNT;

    PERFORM pg_catalog.set_config(
      'app.sale_order_command_internal', COALESCE(v_previous_sale_internal, ''), true
    );
    PERFORM pg_catalog.set_config(
      'app.production_order_command_internal', COALESCE(v_previous_order_internal, ''), true
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_order_id', v_so.id,
      'order_number', v_so.order_number,
      'already_restored', false,
      'ops_restored', v_ops_restored
    );
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, new_data, success, created_at
    ) VALUES (
      v_actor_id, 'sale_order_restored', 'sale_orders', v_so.id,
      v_result, true, now()
    );
  END IF;

  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'restore_sale_order', v_aggregate_key, p_client_request_id,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_sale_order_command(uuid, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_sale_order_command(uuid, bigint, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revert_invoiced_sale_order_command(
  p_sale_order_id uuid,
  p_expected_order_version bigint,
  p_reason text,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_request_hash text;
  v_aggregate_key text := 'sale-order:' || p_sale_order_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_previous_sale_internal text;
  v_previous_order_internal text;
  v_legacy_result jsonb;
  v_result jsonb;
BEGIN
  IF p_sale_order_id IS NULL OR p_expected_order_version IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id, expected_order_version e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (10 a 500 caracteres)'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Permission denied: reversão fiscal exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'expected_order_version', p_expected_order_version,
    'reason', v_reason
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'revert_invoiced_sale_order'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou simultaneamente (esperado v%, atual v%)',
      p_expected_order_version,
      v_so.order_version USING ERRCODE = '40001';
  END IF;
  IF COALESCE(v_so.is_standalone_nfe, false) THEN
    RAISE EXCEPTION
      'NF-e avulsa usa o estorno próprio de hold/estoque e volta para Rascunho'
      USING ERRCODE = 'PZ218';
  END IF;

  v_previous_sale_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal', true
  );
  v_previous_order_internal := pg_catalog.current_setting(
    'app.production_order_command_internal', true
  );
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);
  v_legacy_result := public.revert_invoiced_sale_order_internal_108(
    p_sale_order_id,
    v_reason
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal', COALESCE(v_previous_sale_internal, ''), true
  );
  PERFORM pg_catalog.set_config(
    'app.production_order_command_internal', COALESCE(v_previous_order_internal, ''), true
  );

  v_result := jsonb_build_object('ok', true, 'result', v_legacy_result);
  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'revert_invoiced_sale_order', v_aggregate_key, p_client_request_id,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.revert_invoiced_sale_order_command(
  uuid, bigint, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_invoiced_sale_order_command(
  uuid, bigint, text, uuid
) TO authenticated, service_role;

-- Entry points paralelos deixam de ser APIs. service_role também usa os
-- commands novos, preservando receipt/versão em jobs e Edge Functions.
REVOKE ALL ON FUNCTION public.register_order_shipment(uuid[], uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.force_sale_order_production(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_sale_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Contrato executável da fronteira
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_production_order_command_contract_tests()
RETURNS TABLE(case_name text, passed boolean, details text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execute text;
  v_materialize text;
  v_cancel text;
  v_boundary text;
  v_shipment text;
  v_force text;
  v_delete text;
  v_restore text;
  v_revert text;
  v_stage_transition text;
  v_auto_promote text;
  v_auto_bill text;
  v_initializer text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION 'Contratos de OP exigem Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  v_execute := pg_catalog.pg_get_functiondef(
    'public.execute_production_order_command(text,uuid,uuid,jsonb)'::regprocedure
  );
  v_materialize := pg_catalog.pg_get_functiondef(
    'public.materialize_production_order_internal(uuid)'::regprocedure
  );
  v_cancel := pg_catalog.pg_get_functiondef(
    'public.cancel_production_order_internal(uuid)'::regprocedure
  );
  v_boundary := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_production_order_command_boundary()'::regprocedure
  );
  v_shipment := pg_catalog.pg_get_functiondef(
    'public.register_order_shipment_command(uuid[],jsonb,uuid,text,uuid)'::regprocedure
  );
  v_force := pg_catalog.pg_get_functiondef(
    'public.force_sale_order_production_command(uuid,bigint,uuid,uuid)'::regprocedure
  );
  v_delete := pg_catalog.pg_get_functiondef(
    'public.soft_delete_sale_order_command(uuid,bigint,uuid)'::regprocedure
  );
  v_restore := pg_catalog.pg_get_functiondef(
    'public.restore_sale_order_command(uuid,bigint,uuid)'::regprocedure
  );
  v_revert := pg_catalog.pg_get_functiondef(
    'public.revert_invoiced_sale_order_command(uuid,bigint,text,uuid)'::regprocedure
  );
  v_stage_transition := pg_catalog.pg_get_functiondef(
    'public.apply_sale_order_stage_transition_internal(uuid,text,uuid)'::regprocedure
  );
  v_auto_promote := pg_catalog.pg_get_functiondef(
    'public.auto_promote_sale_order_to_production()'::regprocedure
  );
  v_auto_bill := pg_catalog.pg_get_functiondef(
    'public.auto_bill_sale_order_on_finishing()'::regprocedure
  );
  v_initializer := pg_catalog.pg_get_functiondef(
    'public.initialize_order_material_reservations(uuid,boolean)'::regprocedure
  );

  case_name := 'orders_acl_cutover';
  passed := NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.orders', 'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.orders', 'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.orders', 'DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.orders', 'TRUNCATE'
    )
    AND pg_catalog.has_table_privilege(
      'authenticated', 'public.orders', 'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.orders'::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND (
           pg_catalog.has_column_privilege(
             'authenticated', 'public.orders', a.attname, 'INSERT'
           )
           OR pg_catalog.has_column_privilege(
             'authenticated', 'public.orders', a.attname, 'UPDATE'
           )
         )
    )
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.orders'::regclass
         AND t.tgname = 'trg_000_enforce_production_order_command_boundary'
         AND NOT t.tgisinternal
         AND t.tgenabled <> 'D'
    )
    AND position('app.production_order_command_internal' IN v_boundary) > 0
    AND position('app.sale_order_command_internal' IN v_boundary) > 0;
  details := 'Browser só lê orders; trigger admite apenas commands/triggers internos.';
  RETURN NEXT;

  case_name := 'production_order_command_surface';
  passed := pg_catalog.has_function_privilege(
      'authenticated',
      'public.execute_production_order_command(text,uuid,uuid,jsonb)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.materialize_production_order_internal(uuid)',
      'EXECUTE'
    )
    AND position('operational_command_receipts' IN v_execute) > 0
    AND position('pg_advisory_xact_lock' IN v_execute) > 0
    AND position('expected_status' IN v_execute) > 0
    AND position('FOR UPDATE' IN v_execute) > 0;
  details := 'Create/status/cancel/delete têm receipt, lock e CAS server-side.';
  RETURN NEXT;

  case_name := 'canonical_stock_materialization';
  passed := position('initialize_order_material_reservations' IN v_materialize) > 0
    AND position('debit_sole_stock_by_grade' IN v_materialize) > 0
    AND position('debit_packaging_for_order' IN v_materialize) > 0
    AND position('ensure_production_order_stages_internal' IN v_materialize) > 0
    AND position('waste_pct' IN v_materialize) = 0
    AND position('consumption_loss_pct' IN v_materialize) = 0
    AND position('app.production_order_command_internal' IN v_initializer) > 0;
  details := 'Materialização delega aos motores canônicos e não reintroduz perda.';
  RETURN NEXT;

  case_name := 'cancel_and_delete_preserve_audit';
  passed := position('release_order_reservations' IN v_cancel) > 0
    AND position('restore_sole_grade_for_order' IN v_cancel) > 0
    AND position('restore_product_stocks_for_order' IN v_cancel) > 0
    AND position('v_has_physical_sole' IN v_cancel) > 0
    AND position('v_has_prior_inbound' IN v_cancel) > 0
    AND position('deleted_at = now()' IN v_execute) > 0
    AND position('audit_preserved' IN v_execute) > 0;
  details := 'Cancel estorna uma vez; delete é lógico e mantém ledger/consumos.';
  RETURN NEXT;

  case_name := 'shipment_is_one_transaction';
  passed := position('p_expected_versions' IN v_shipment) > 0
    AND position('FOR UPDATE' IN v_shipment) > 0
    AND position('v_preflight_count' IN v_shipment) > 0
    AND position('nfe_emitidas' IN v_shipment) > 0
    AND position('nfe_external' IN v_shipment) > 0
    AND position('UPDATE public.order_stages' IN v_shipment) > 0
    AND position('UPDATE public.orders' IN v_shipment) > 0
    AND position('loading_manifest_items' IN v_shipment) > 0
    AND position('operational_command_receipts' IN v_shipment) > 0;
  details := 'Preflight do lote precede PV/rota/OP/manifesto e fecha tudo atomicamente.';
  RETURN NEXT;

  case_name := 'legacy_sale_order_commands_wrapped';
  passed := position('p_expected_order_version' IN v_force) > 0
    AND position('execute_sale_order_command' IN v_force) > 0
    AND position('p_expected_order_version' IN v_delete) > 0
    AND position('soft_delete_sale_order_internal_108' IN v_delete) > 0
    AND position('p_expected_order_version' IN v_restore) > 0
    AND position('app.production_order_command_internal' IN v_restore) > 0
    AND position('length(v_reason) < 10' IN v_revert) > 0
    AND position('is_standalone_nfe' IN v_revert) > 0
    AND position('revert_invoiced_sale_order_internal_108' IN v_revert) > 0
    AND pg_catalog.to_regprocedure(
      'public.soft_delete_sale_order(uuid)'
    ) IS NULL
    AND pg_catalog.to_regprocedure(
      'public.revert_invoiced_sale_order(uuid,text)'
    ) IS NULL
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.register_order_shipment(uuid[],uuid,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.force_sale_order_production(uuid)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.restore_sale_order(uuid)',
      'EXECUTE'
    );
  details := 'Legados viraram implementações privadas ou foram revogados.';
  RETURN NEXT;

  case_name := 'stage_automation_crosses_boundary';
  passed := position('operational_command_receipts' IN v_stage_transition) > 0
    AND position('order_version' IN v_stage_transition) > 0
    AND position('app.sale_order_command_internal' IN v_stage_transition) > 0
    AND position('apply_sale_order_stage_transition_internal' IN v_auto_promote) > 0
    AND position('apply_sale_order_stage_transition_internal' IN v_auto_bill) > 0
    AND position('UPDATE public.sale_orders' IN v_auto_promote) = 0
    AND position('UPDATE public.sale_orders' IN v_auto_bill) = 0;
  details := 'Início/Acabamento não furam o boundary nem abortam PZ117.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_production_order_command_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_production_order_command_contract_tests()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.run_production_order_command_contract_tests() IS
  'Guard live de ACL, receipts, estoque canônico, logística e automações de OP/PV.';

COMMIT;

NOTIFY pgrst, 'reload schema';
