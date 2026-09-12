-- =============================================================================
-- Apontamento: um RPC para pulos + agenda sem tempestade de tiras
-- =============================================================================
-- Sintoma (12/09/2026, OP-2026-03247 / PV-00169, Corte Fibra → Expedição):
--   Erro no apontamento: cancelling statement due to statement timeout
--
-- Dois amplificadores no mesmo clique "Apontar" com 8 setores pulados:
--
-- 1) O cliente faz 1 RPC da origem + 1 RPC por setor pulado (qty 0 /
--    finalize). Cada INSERT em production_pointings dispara
--    tg_pointings_recompute → recompute_production_schedule (DELETE+INSERT
--    da agenda inteira, ~3480 linhas). app.recompute_txid só colapsa DENTRO
--    da mesma transação — 9 RPCs = 9 rebuilds, cada um precisando de novo
--    do FOR UPDATE em sale_orders.
--
-- 2) Cada rebuild dispara o constraint trigger DEFERRABLE
--    trg_enqueue_strap_demands_on_schedule_change POR LINHA. Mesmo com o
--    "um job por PV/tx" da 14200, cada linha ainda faz JOIN + EXISTS; a
--    primeira por PV chama enqueue_sale_order_strap_demands, que segura
--    sale_orders FOR UPDATE e roda o preview operacional. No COMMIT isso
--    segura o PV (e o lock global de alocação) além dos 8s do PostgREST.
--    O timeout medido travou exatamente no tuple (8,7) = PV-00169.
--
-- Esta migration:
--   a) GUC app.skip_schedule_strap_enqueue no rebuild da agenda — o trigger
--      row-level sai no primeiro IF, sem JOIN. Fora de apontamento, o
--      wrapper publica UM schedule_changed por PV com demanda corrente.
--      No apontamento o needed_at das tiras fica até o próximo rebuild
--      (ficha / fila / cron 03:05 UTC). Aceitável vs. travar o chão.
--   b) p_skip_stage_names no command — os pulos rodam na MESMA transação
--      (um lock de PV, um recompute).
--
-- Carimbo 24900: o banco já registrou 24700/24800 via MCP sem arquivo neste
-- repo (purchase_shortages_compute_before_row_locks /
-- kanban_alias_corte_palmilha_fibra). Não reutilizar esses números.
-- Marcador: apontamento_skip_batch_sem_enqueue_agenda_20270101024900
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Trigger da agenda: sai cedo quando o rebuild pediu silêncio
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_sale_order_id uuid;
  v_status text;
  v_correlation_id uuid;
  v_idempotency_key text;
BEGIN
  -- Primeiro IF de propósito: rebuild da agenda toca milhares de linhas e
  -- o corpo abaixo (JOIN + EXISTS + enqueue) no COMMIT estoura o timeout
  -- de apontamento. GUC é transaction-local e vale nos DEFERRABLE.
  IF current_setting('app.skip_schedule_strap_enqueue', true) = '1' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.sale_order_id, so.status
    INTO v_sale_order_id, v_status
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = v_order_id;

  IF v_sale_order_id IS NULL
     OR v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- schedule_changed revisa uma demanda corrente; nunca cria a primeira
  -- baseline derivada do planejamento.
  IF NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_id = v_sale_order_id
       AND d.is_current
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Constraint triggers da mesma transacao rodam em sequencia. A chave e
  -- especifica deste fan-out; um schedule_changed do cabecalho do PV, criado
  -- antes do rebuild, usa outra correlation_id e nao mascara o estado final.
  v_correlation_id := md5(format(
    'production_schedule_changed:%s:%s',
    pg_catalog.pg_current_xact_id()::text,
    v_sale_order_id
  ))::uuid;
  v_idempotency_key := format(
    'sale_order:%s:event:%s',
    v_sale_order_id,
    v_correlation_id
  );

  IF EXISTS (
    SELECT 1
      FROM public.strap_demand_jobs j
     WHERE j.source_type = 'sale_order'
       AND j.source_id = v_sale_order_id
       AND j.event_type = 'schedule_changed'
       AND j.idempotency_key = v_idempotency_key
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM public.enqueue_sale_order_strap_demands(
    v_sale_order_id,
    'schedule_changed',
    v_correlation_id
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change() IS
  'Publica no maximo um schedule_changed da agenda por PV/transacao, sem confundir evento autoritativo do cabecalho; preserva DELETE-only via OLD. GUC app.skip_schedule_strap_enqueue=1 silencia o fan-out durante recompute_production_schedule.';

-- -----------------------------------------------------------------------------
-- 2) Wrapper do rebuild: liga o GUC e, fora de apontamento, enfileira 1×/PV
-- -----------------------------------------------------------------------------
-- Não reescreve o algoritmo da agenda (corpo vivo ~14k, com limpeza de
-- production_queue da era 14500). RENAME preserva o OID/definição; o nome
-- público vira um envelope que só ajusta o fan-out de tiras.
DO $rename_recompute$
BEGIN
  IF to_regprocedure('public.recompute_production_schedule_impl_249(text)') IS NOT NULL THEN
    RETURN;
  END IF;
  IF to_regprocedure('public.recompute_production_schedule(text)') IS NULL THEN
    RAISE EXCEPTION 'recompute_production_schedule(text) ausente';
  END IF;
  ALTER FUNCTION public.recompute_production_schedule(text)
    RENAME TO recompute_production_schedule_impl_249;
END;
$rename_recompute$;

REVOKE ALL ON FUNCTION public.recompute_production_schedule_impl_249(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_production_schedule(
  p_triggered_by text DEFAULT 'manual'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('app.skip_schedule_strap_enqueue', '1', true);
  v_result := public.recompute_production_schedule_impl_249(p_triggered_by);

  -- Rebuild pulou o fan-out row-level. Fora do apontamento, um job por PV
  -- com demanda corrente (ficha / fila / cron). Apontamento NÃO chama:
  -- já segura sale_orders FOR UPDATE e o preview estoura os 8s.
  IF COALESCE(p_triggered_by, '') IS DISTINCT FROM 'apontamento' THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      d.sale_order_id,
      'schedule_changed',
      md5(format(
        'production_schedule_recompute:%s:%s',
        pg_catalog.pg_current_xact_id()::text,
        d.sale_order_id::text
      ))::uuid
    )
    FROM (
      SELECT DISTINCT d.sale_order_id
        FROM public.sale_order_strap_demands d
        JOIN public.sale_orders so ON so.id = d.sale_order_id
       WHERE d.is_current
         AND so.status IN ('Aprovado', 'Em Produção')
    ) d;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_production_schedule(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_production_schedule(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.recompute_production_schedule(text) IS
  'Rebuild da agenda com GUC app.skip_schedule_strap_enqueue. Fora de apontamento, publica um schedule_changed por PV corrente; apontamento deixa needed_at das tiras para o próximo rebuild não-apontamento.';

-- -----------------------------------------------------------------------------
-- 3) Command de apontamento: pulos na mesma transação
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE não acrescenta argumento — DROP da assinatura de 9 args
-- e recria com default. Callers nomeados que omitam o 10º continuam válidos.
DROP FUNCTION IF EXISTS public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid
);
DROP FUNCTION IF EXISTS public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[]
);

CREATE FUNCTION public.execute_production_pointing_command(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid,
  p_note text,
  p_finalize boolean,
  p_confirmed_warnings text[],
  p_expected_stage_updated_at timestamptz,
  p_client_request_id uuid,
  p_skip_stage_names text[] DEFAULT NULL
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
  v_skip_name text;
  v_skip_canon text;
  v_skip_result jsonb;
  v_skip_codes text[];
  v_skipped_canon text[] := '{}';
  v_main_canon text;
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
    'expected_stage_updated_at', p_expected_stage_updated_at,
    'skip_stage_names', COALESCE(p_skip_stage_names, '{}'::text[])
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

    -- Pulos só depois da origem gravar. needs_confirmation da origem não
    -- escreve nada — devolve o preflight sem fechar setor nenhum.
    IF NOT COALESCE((v_result ->> 'needs_confirmation')::boolean, false) THEN
      v_main_canon := public.canonical_stage_name(p_stage_name);
      FOREACH v_skip_name IN ARRAY COALESCE(p_skip_stage_names, '{}'::text[])
      LOOP
        v_skip_name := btrim(COALESCE(v_skip_name, ''));
        IF v_skip_name = '' THEN
          CONTINUE;
        END IF;
        v_skip_canon := public.canonical_stage_name(v_skip_name);
        IF v_skip_canon IS NOT DISTINCT FROM v_main_canon THEN
          CONTINUE;
        END IF;
        IF v_skip_canon = ANY (v_skipped_canon) THEN
          CONTINUE;
        END IF;
        v_skipped_canon := array_append(v_skipped_canon, v_skip_canon);

        v_skip_result := public.apontar_producao_setor_impl(
          p_order_id,
          v_skip_name,
          0,
          p_operator_employee_id,
          'Setor pulado no mesmo apontamento (confirmado)',
          true,
          p_confirmed_warnings
        );
        -- Aceite do pulo já aconteceu na UI (skipAcknowledged). Avisos do
        -- setor pulado (material_nao_reservado em pendente/qty 0) não podem
        -- devolver needs_confirmation depois da origem já gravada — confirma
        -- e grava, ou aborta a transação inteira.
        IF COALESCE((v_skip_result ->> 'needs_confirmation')::boolean, false) THEN
          SELECT COALESCE(array_agg(elem ->> 'code'), '{}')
            INTO v_skip_codes
            FROM jsonb_array_elements(
              COALESCE(v_skip_result -> 'warnings', '[]'::jsonb)
            ) AS elem
           WHERE NULLIF(elem ->> 'code', '') IS NOT NULL;
          v_skip_result := public.apontar_producao_setor_impl(
            p_order_id,
            v_skip_name,
            0,
            p_operator_employee_id,
            'Setor pulado no mesmo apontamento (confirmado)',
            true,
            COALESCE(p_confirmed_warnings, '{}'::text[]) || COALESCE(v_skip_codes, '{}'::text[])
          );
        END IF;
        IF COALESCE((v_skip_result ->> 'needs_confirmation')::boolean, false) THEN
          RAISE EXCEPTION
            'Setor pulado % ainda exige confirmação depois do aceite do pulo',
            v_skip_name
            USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
      IF array_length(v_skipped_canon, 1) > 0 THEN
        v_result := v_result || jsonb_build_object(
          'skipped_stages', to_jsonb(v_skipped_canon)
        );
      END IF;
    END IF;
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
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[]
) TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_production_pointing_command(
  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid, text[]
) IS
  'Command canônico de apontamento. p_skip_stage_names fecha setores pulados (qty 0 / finalize) na mesma transação da origem.';

-- -----------------------------------------------------------------------------
-- 4) Contratos de instalação
-- -----------------------------------------------------------------------------
DO $assertions$
DECLARE
  v_enqueue text;
  v_recompute text;
  v_pointing text;
  v_nargs int;
BEGIN
  v_enqueue := pg_get_functiondef(
    'public.tg_enqueue_strap_demands_on_schedule_change()'::regprocedure
  );
  IF v_enqueue NOT LIKE '%app.skip_schedule_strap_enqueue%' THEN
    RAISE EXCEPTION 'tg_enqueue sem GUC skip_schedule_strap_enqueue';
  END IF;
  IF position('app.skip_schedule_strap_enqueue' in v_enqueue)
     > position('FROM public.orders o' in v_enqueue) THEN
    RAISE EXCEPTION 'GUC skip precisa vir ANTES do JOIN em orders';
  END IF;

  v_recompute := pg_get_functiondef(
    'public.recompute_production_schedule(text)'::regprocedure
  );
  IF v_recompute NOT LIKE '%app.skip_schedule_strap_enqueue%' THEN
    RAISE EXCEPTION 'recompute_production_schedule sem GUC skip';
  END IF;
  IF v_recompute NOT LIKE '%recompute_production_schedule_impl_249%' THEN
    RAISE EXCEPTION 'wrapper não chama impl_249';
  END IF;
  IF v_recompute NOT LIKE '%apontamento%'
     OR v_recompute NOT LIKE '%enqueue_sale_order_strap_demands%' THEN
    RAISE EXCEPTION 'wrapper tem que pular enqueue no apontamento';
  END IF;

  SELECT p.pronargs INTO v_nargs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'execute_production_pointing_command';
  IF v_nargs <> 10 THEN
    RAISE EXCEPTION 'execute_production_pointing_command deve ter 10 args, tem %', v_nargs;
  END IF;

  v_pointing := pg_get_functiondef(
    to_regprocedure(
      'public.execute_production_pointing_command(uuid,text,integer,uuid,text,boolean,text[],timestamptz,uuid,text[])'
    )
  );
  IF v_pointing NOT LIKE '%p_skip_stage_names%' THEN
    RAISE EXCEPTION 'command sem p_skip_stage_names';
  END IF;
  IF v_pointing NOT LIKE '%FOREACH v_skip_name%' THEN
    RAISE EXCEPTION 'command sem loop de pulo';
  END IF;
END;
$assertions$;

NOTIFY pgrst, 'reload schema';
