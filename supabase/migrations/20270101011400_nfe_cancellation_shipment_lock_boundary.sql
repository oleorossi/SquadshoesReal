-- Fecha a corrida expedição x cancelamento de NF-e.
--
-- Ordem canônica de locks para qualquer operação que cruza o limite fiscal e
-- logístico:
--   1. todas as NF-es do(s) PV(s), por id;
--   2. advisory sale-order-command:<PV>, por id de PV;
--   3. linha do PV;
--   4. segundo passe NOWAIT nas NF-es para detectar phantoms.
--
-- A chamada ao provedor continua fora de uma transação longa. O estado local
-- usa begin/complete/abort: begin faz o claim `autorizada -> cancelando`,
-- complete aplica o fato fiscal e o CAS logístico, e abort só desfaz um claim
-- que comprovadamente não chegou ao provedor.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Expedição: mesma ordem NF-e -> PV e autorização fiscal sob row lock
-- ---------------------------------------------------------------------------

DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_after text;
  v_marker text;
BEGIN
  SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'register_order_shipment_command'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
       'p_sale_order_ids uuid[], p_expected_versions jsonb, p_manifest_id uuid, p_checked_by text, p_client_request_id uuid';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'register_order_shipment_command(uuid[],jsonb,uuid,text,uuid) ausente';
  END IF;

  v_marker := E'  -- Mesmo lock lógico do command boundary comercial, adquirido em ordem\n';
  IF pg_catalog.strpos(v_definition, v_marker) = 0 THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: marcador de advisory ausente';
  END IF;
  v_after := pg_catalog.replace(
    v_definition,
    v_marker,
    E'  -- NF-e primeiro, em ordem global determinística. Cancelamento usa a\n'
    || E'  -- mesma ordem antes de tocar o advisory/PV.\n'
    || E'  PERFORM ne.id\n'
    || E'    FROM public.nfe_emitidas ne\n'
    || E'   WHERE ne.sale_order_id = ANY(v_ids)\n'
    || E'   ORDER BY ne.id\n'
    || E'   FOR UPDATE;\n\n'
    || v_marker
  );
  IF v_after = v_definition THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: patch de lock fiscal não aplicado';
  END IF;
  v_definition := v_after;

  v_marker := E'      IF NOT EXISTS (\n'
    || E'        SELECT 1\n'
    || E'          FROM public.nfe_emitidas ne\n'
    || E'         WHERE ne.sale_order_id = v_so.id\n'
    || E'           AND lower(ne.status) IN (''autorizada'', ''aprovada'')\n'
    || E'      ) THEN\n';
  IF pg_catalog.strpos(v_definition, v_marker) = 0 THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: EXISTS fiscal esperado ausente';
  END IF;
  v_after := pg_catalog.replace(
    v_definition,
    v_marker,
    E'      -- O segundo acesso depois do PV nunca espera por writer fiscal:\n'
    || E'      -- se surgiu uma NF-e no intervalo, falha observavelmente em vez\n'
    || E'      -- de formar o ciclo PV -> NF-e. FOUND prova uma NF autorizada\n'
    || E'      -- que permaneceu travada até o commit da expedição.\n'
    || E'      PERFORM ne.id\n'
    || E'        FROM public.nfe_emitidas ne\n'
    || E'       WHERE ne.sale_order_id = v_so.id\n'
    || E'         AND lower(ne.status) IN (''autorizada'', ''aprovada'')\n'
    || E'       ORDER BY ne.id\n'
    || E'       FOR UPDATE NOWAIT;\n'
    || E'      IF NOT FOUND THEN\n'
  );
  IF v_after = v_definition THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: patch de autorização não aplicado';
  END IF;
  v_definition := v_after;

  v_marker := E'  IF v_preflight_count <> array_length(v_ids, 1) THEN\n'
    || E'    RAISE EXCEPTION ''Um ou mais PVs do lote não foram encontrados''\n'
    || E'      USING ERRCODE = ''P0002'';\n'
    || E'  END IF;\n\n'
    || E'  v_previous_sale_internal := pg_catalog.current_setting(\n';
  IF pg_catalog.strpos(v_definition, v_marker) = 0 THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: fim do preflight ausente';
  END IF;
  v_after := pg_catalog.replace(
    v_definition,
    v_marker,
    E'  IF v_preflight_count <> array_length(v_ids, 1) THEN\n'
    || E'    RAISE EXCEPTION ''Um ou mais PVs do lote não foram encontrados''\n'
    || E'      USING ERRCODE = ''P0002'';\n'
    || E'  END IF;\n\n'
    || E'  -- Captura phantoms que entraram antes do lock do PV. NOWAIT é\n'
    || E'  -- intencional: um writer fiscal concorrente vira retry, não deadlock.\n'
    || E'  PERFORM ne.id\n'
    || E'    FROM public.nfe_emitidas ne\n'
    || E'   WHERE ne.sale_order_id = ANY(v_ids)\n'
    || E'   ORDER BY ne.id\n'
    || E'   FOR UPDATE NOWAIT;\n\n'
    || E'  v_previous_sale_internal := pg_catalog.current_setting(\n'
  );
  IF v_after = v_definition THEN
    RAISE EXCEPTION
      'Drift em register_order_shipment_command: patch de phantom não aplicado';
  END IF;

  EXECUTE v_after;
END;
$migration$;

REVOKE ALL ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_order_shipment_command(
  uuid[], jsonb, uuid, text, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Claim curto antes da chamada ao provedor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_nfe_cancellation_command(
  p_nfe_id uuid,
  p_justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale_order_hint uuid;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_so record;
  v_status text;
  v_changed integer;
  v_is_standalone boolean := false;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_nfe_id IS NULL THEN
    RAISE EXCEPTION 'nfe_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_justification, ''))) < 15 THEN
    RAISE EXCEPTION 'Justificativa deve ter ao menos 15 caracteres'
      USING ERRCODE = '22023';
  END IF;

  -- A primeira leitura resolve o conjunto. Nenhum PV é tocado antes de
  -- todas as NF-es desse conjunto terem sido travadas em ordem por id.
  SELECT ne.sale_order_id
    INTO v_sale_order_hint
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % não encontrada', p_nfe_id USING ERRCODE = 'P0002';
  END IF;
  IF v_sale_order_hint IS NOT NULL THEN
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_sale_order_hint
     ORDER BY ne.id
     FOR UPDATE;
  END IF;
  SELECT ne.*
    INTO v_nfe
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % desapareceu durante o claim', p_nfe_id
      USING ERRCODE = '40001';
  END IF;
  IF v_nfe.sale_order_id IS DISTINCT FROM v_sale_order_hint THEN
    RAISE EXCEPTION 'Vínculo da NF-e mudou durante o claim; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  IF v_nfe.sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_nfe.sale_order_id::text,
      0
    ));
    SELECT so.id, so.status, so.is_standalone_nfe, so.nfe
      INTO v_so
      FROM public.sale_orders so
     WHERE so.id = v_nfe.sale_order_id
       AND so.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PV vinculado à NF-e não foi encontrado; cancelamento bloqueado'
        USING ERRCODE = 'PZ220';
    END IF;
    v_is_standalone := COALESCE(v_so.is_standalone_nfe, false);
    -- Mesmo segundo passe do command comercial: nunca espera NF nova depois
    -- de possuir o PV, pois isso reintroduziria PV -> NF-e.
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_nfe.sale_order_id
     ORDER BY ne.id
     FOR UPDATE NOWAIT;
  END IF;

  v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_nfe.status, '')));
  IF v_status = 'cancelada' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'provider_call_required', false,
      'idempotent_replay', true,
      'nfe_id', v_nfe.id,
      'sale_order_id', v_nfe.sale_order_id,
      'nfe_number', v_nfe.numero,
      'provider_nfe_id', v_nfe.provider_nfe_id,
      'data_emissao', v_nfe.data_emissao,
      'is_standalone_nfe', v_is_standalone
    );
  END IF;
  IF v_status = 'cancelando' THEN
    RAISE EXCEPTION
      'NF-e já possui cancelamento em andamento; reconcilie o provedor antes de repetir'
      USING ERRCODE = 'PZ220';
  END IF;
  IF v_status <> 'autorizada' THEN
    RAISE EXCEPTION 'Somente NF-e autorizada pode iniciar cancelamento'
      USING ERRCODE = 'PZ220';
  END IF;
  IF v_nfe.provider_nfe_id IS NULL
     OR pg_catalog.btrim(v_nfe.provider_nfe_id) = '' THEN
    RAISE EXCEPTION
      'NF-e sem ID do provedor; cancelamento pela API recusado'
      USING ERRCODE = 'PZ220';
  END IF;
  IF v_nfe.data_emissao IS NULL THEN
    RAISE EXCEPTION
      'NF-e sem data de emissão; sincronize antes de cancelar'
      USING ERRCODE = 'PZ220';
  END IF;
  IF v_nfe.sale_order_id IS NOT NULL AND v_so.status <> 'Faturado' THEN
    IF pg_catalog.lower(pg_catalog.btrim(COALESCE(v_so.status, ''))) IN (
      'expedido', 'concluído', 'concluido', 'finalizado',
      'finalizado s/ nf', 'entregue'
    ) THEN
      RAISE EXCEPTION
        'PV já avançou para %; reverta a expedição explicitamente antes de cancelar a NF-e',
        v_so.status USING ERRCODE = 'PZ221';
    END IF;
    RAISE EXCEPTION
      'PV vinculado precisa estar Faturado para iniciar o cancelamento (atual: %)',
      v_so.status USING ERRCODE = 'PZ221';
  END IF;

  UPDATE public.nfe_emitidas ne
     SET status = 'cancelando',
         updated_at = pg_catalog.now()
   WHERE ne.id = p_nfe_id
     AND pg_catalog.lower(pg_catalog.btrim(ne.status)) = 'autorizada';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'Claim fiscal perdeu o CAS autorizada -> cancelando'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'provider_call_required', true,
    'idempotent_replay', false,
    'nfe_id', v_nfe.id,
    'sale_order_id', v_nfe.sale_order_id,
    'nfe_number', v_nfe.numero,
    'provider_nfe_id', v_nfe.provider_nfe_id,
    'data_emissao', v_nfe.data_emissao,
    'is_standalone_nfe', v_is_standalone
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Aborta somente claim comprovadamente anterior/recusado pelo provedor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.abort_nfe_cancellation_command(
  p_nfe_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale_order_hint uuid;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_status text;
  v_changed integer;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_nfe_id IS NULL THEN
    RAISE EXCEPTION 'nfe_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Motivo do abort é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT ne.sale_order_id
    INTO v_sale_order_hint
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % não encontrada', p_nfe_id USING ERRCODE = 'P0002';
  END IF;
  IF v_sale_order_hint IS NOT NULL THEN
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_sale_order_hint
     ORDER BY ne.id
     FOR UPDATE;
  END IF;
  SELECT ne.* INTO v_nfe
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id
   FOR UPDATE;
  IF NOT FOUND OR v_nfe.sale_order_id IS DISTINCT FROM v_sale_order_hint THEN
    RAISE EXCEPTION 'Contexto fiscal mudou durante o abort; tente novamente'
      USING ERRCODE = '40001';
  END IF;
  IF v_nfe.sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_nfe.sale_order_id::text,
      0
    ));
    PERFORM so.id
      FROM public.sale_orders so
     WHERE so.id = v_nfe.sale_order_id
       AND so.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV vinculado desapareceu durante o abort'
        USING ERRCODE = 'PZ220';
    END IF;
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_nfe.sale_order_id
     ORDER BY ne.id
     FOR UPDATE NOWAIT;
  END IF;

  v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_nfe.status, '')));
  IF v_status = 'autorizada' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'idempotent_replay', true,
      'nfe_id', p_nfe_id, 'status', 'autorizada'
    );
  END IF;
  IF v_status <> 'cancelando' THEN
    RAISE EXCEPTION
      'Abort só aceita NF-e cancelando; status atual %', v_nfe.status
      USING ERRCODE = 'PZ220';
  END IF;

  UPDATE public.nfe_emitidas ne
     SET status = 'autorizada',
         updated_at = pg_catalog.now()
   WHERE ne.id = p_nfe_id
     AND pg_catalog.lower(pg_catalog.btrim(ne.status)) = 'cancelando';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'Abort perdeu o CAS cancelando -> autorizada'
      USING ERRCODE = '40001';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'idempotent_replay', false,
    'nfe_id', p_nfe_id, 'status', 'autorizada',
    'reason', pg_catalog.left(pg_catalog.btrim(p_reason), 500)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Commit local atômico depois da confirmação do provedor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_nfe_cancellation_command(
  p_nfe_id uuid,
  p_justification text,
  p_cancellation_protocol text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale_order_hint uuid;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_so record;
  v_status text;
  v_changed integer;
  v_idempotent boolean := false;
  v_active_nfe_number text;
  v_has_other_active boolean := false;
  v_reopened boolean := false;
  v_reverse jsonb;
  v_hold_status text;
  v_hold_reason text;
  v_current_order_status text;
  v_reconciliation boolean := false;
  v_reconciliation_reason text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true), ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_nfe_id IS NULL THEN
    RAISE EXCEPTION 'nfe_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_justification, ''))) < 15 THEN
    RAISE EXCEPTION 'Justificativa deve ter ao menos 15 caracteres'
      USING ERRCODE = '22023';
  END IF;

  SELECT ne.sale_order_id
    INTO v_sale_order_hint
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e % não encontrada', p_nfe_id USING ERRCODE = 'P0002';
  END IF;
  IF v_sale_order_hint IS NOT NULL THEN
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_sale_order_hint
     ORDER BY ne.id
     FOR UPDATE;
  END IF;
  SELECT ne.* INTO v_nfe
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_id
   FOR UPDATE;
  IF NOT FOUND OR v_nfe.sale_order_id IS DISTINCT FROM v_sale_order_hint THEN
    RAISE EXCEPTION 'Contexto fiscal mudou durante o commit; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  IF v_nfe.sale_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_nfe.sale_order_id::text,
      0
    ));
    SELECT so.id, so.status, so.is_standalone_nfe, so.nfe
      INTO v_so
      FROM public.sale_orders so
     WHERE so.id = v_nfe.sale_order_id
       AND so.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PV vinculado à NF-e não foi encontrado; commit local bloqueado'
        USING ERRCODE = 'PZ220';
    END IF;
    PERFORM ne.id
      FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_nfe.sale_order_id
     ORDER BY ne.id
     FOR UPDATE NOWAIT;
  END IF;

  v_status := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_nfe.status, '')));
  IF v_status NOT IN ('cancelando', 'cancelada') THEN
    RAISE EXCEPTION
      'Commit de cancelamento exige NF-e cancelando/cancelada; status atual %',
      v_nfe.status USING ERRCODE = 'PZ220';
  END IF;
  v_idempotent := v_status = 'cancelada';

  IF v_nfe.sale_order_id IS NOT NULL THEN
    IF NOT v_idempotent AND v_so.status <> 'Faturado' THEN
      IF pg_catalog.lower(pg_catalog.btrim(COALESCE(v_so.status, ''))) IN (
        'expedido', 'concluído', 'concluido', 'finalizado',
        'finalizado s/ nf', 'entregue'
      ) THEN
        RAISE EXCEPTION
          'PV avançou para % durante o cancelamento; reverta a expedição explicitamente',
          v_so.status USING ERRCODE = 'PZ221';
      END IF;
      RAISE EXCEPTION
        'CAS de reabertura exige PV Faturado; status atual %', v_so.status
        USING ERRCODE = 'PZ221';
    ELSIF v_idempotent THEN
      IF COALESCE(v_so.is_standalone_nfe, false)
         AND v_so.status NOT IN ('Faturado', 'Rascunho') THEN
        RAISE EXCEPTION
          'Replay avulso recusado no status logístico %', v_so.status
          USING ERRCODE = 'PZ221';
      ELSIF NOT COALESCE(v_so.is_standalone_nfe, false)
            AND v_so.status NOT IN ('Faturado', 'Em Produção') THEN
        RAISE EXCEPTION
          'Replay fiscal recusado no status logístico %', v_so.status
          USING ERRCODE = 'PZ221';
      END IF;
    END IF;
  END IF;

  IF NOT v_idempotent THEN
    UPDATE public.nfe_emitidas ne
       SET status = 'cancelada',
           justificativa_cancelamento = pg_catalog.btrim(p_justification),
           data_cancelamento = pg_catalog.now(),
           protocolo_cancelamento = COALESCE(
             pg_catalog.nullif(pg_catalog.btrim(p_cancellation_protocol), ''),
             ne.protocolo_cancelamento
           ),
           updated_at = pg_catalog.now()
     WHERE ne.id = p_nfe_id
       AND pg_catalog.lower(pg_catalog.btrim(ne.status)) = 'cancelando';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION 'Commit fiscal perdeu o CAS cancelando -> cancelada'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Financeiro pertence ao mesmo commit local. O row lock da NF-e serializa
  -- retries, então o pré-check de reversão não pode produzir duplicata. Uma
  -- falha aqui mantém a NF em cancelando para reconciliação, em vez de publicar
  -- estado fiscal/logístico parcial depois da confirmação externa.
  IF v_nfe.sale_order_id IS NOT NULL THEN
    PERFORM fe.id
      FROM public.financial_entries fe
     WHERE fe.reference_type = 'sale_order'
       AND fe.reference_id = v_nfe.sale_order_id::text
     ORDER BY fe.id
     FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1
        FROM public.financial_entries reversal
       WHERE reversal.reference_type = 'sale_order_cancel_nfe'
         AND reversal.reference_id = p_nfe_id::text
    ) THEN
      INSERT INTO public.financial_entries(
        type, amount, description, account_id, entry_date, due_date, status,
        reference_id, reference_type, nfe_id
      )
      SELECT fe.type,
             -COALESCE(fe.amount, 0),
             'Estorno NF-e cancelada — ' || COALESCE(fe.description, ''),
             fe.account_id,
             CURRENT_DATE,
             fe.due_date,
             'confirmed',
             p_nfe_id::text,
             'sale_order_cancel_nfe',
             p_nfe_id
        FROM public.financial_entries fe
       WHERE fe.reference_type = 'sale_order'
         AND fe.reference_id = v_nfe.sale_order_id::text
         AND fe.status IN ('posted', 'reconciled', 'paid', 'confirmed')
       ORDER BY fe.id;

      DELETE FROM public.financial_entries fe
       WHERE fe.reference_type = 'sale_order'
         AND fe.reference_id = v_nfe.sale_order_id::text
         AND fe.status NOT IN ('posted', 'reconciled', 'paid', 'confirmed');
    END IF;

    UPDATE public.accounts_receivable ar
       SET status = 'cancelled',
           updated_at = pg_catalog.now()
     WHERE ar.sale_order_id = v_nfe.sale_order_id
       AND ar.status NOT IN ('received', 'cancelled');
  END IF;

  IF v_nfe.sale_order_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'idempotent_replay', v_idempotent,
      'nfe_id', p_nfe_id, 'sale_order_id', NULL,
      'is_standalone_nfe', false, 'reopened', false,
      'reconciliation_needed', false
    );
  END IF;

  IF COALESCE(v_so.is_standalone_nfe, false) THEN
    -- O trigger da 107 tenta o settlement na transição. A chamada
    -- explícita aqui torna replay e falha transitória idempotentes sem
    -- devolver escrita física para a Edge Function.
    BEGIN
      v_reverse := public.reverse_standalone_nfe_stock_for_cancel(p_nfe_id);
      IF NOT COALESCE((v_reverse ->> 'ok')::boolean, false) THEN
        v_reconciliation := true;
        v_reconciliation_reason := COALESCE(
          v_reverse ->> 'code',
          'Estorno de estoque avulso não concluído'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_reconciliation := true;
      v_reconciliation_reason := SQLERRM;
    END;

    SELECT h.status, h.reconciliation_reason
      INTO v_hold_status, v_hold_reason
      FROM public.standalone_nfe_stock_holds h
     WHERE h.nfe_id = p_nfe_id
     FOR UPDATE;
    IF NOT FOUND OR v_hold_status NOT IN ('reversed', 'released') THEN
      v_reconciliation := true;
      v_reconciliation_reason := COALESCE(
        v_hold_reason,
        v_reconciliation_reason,
        'Hold avulso ausente ou sem estorno conclusivo'
      );
    END IF;
    SELECT so.status INTO v_current_order_status
      FROM public.sale_orders so
     WHERE so.id = v_nfe.sale_order_id;
    IF v_current_order_status <> 'Rascunho' THEN
      v_reconciliation := true;
      v_reconciliation_reason := COALESCE(
        v_reconciliation_reason,
        format('PV avulso permaneceu em %s após o estorno', v_current_order_status)
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'idempotent_replay', v_idempotent,
      'nfe_id', p_nfe_id,
      'sale_order_id', v_nfe.sale_order_id,
      'is_standalone_nfe', true,
      'reopened', v_current_order_status = 'Rascunho',
      'reopen_status', v_current_order_status,
      'stock_reversal', v_reverse,
      'hold_status', v_hold_status,
      'reconciliation_needed', v_reconciliation,
      'reconciliation_reason', v_reconciliation_reason
    );
  END IF;

  SELECT ne.numero
    INTO v_active_nfe_number
    FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = v_nfe.sale_order_id
     AND ne.id <> p_nfe_id
     AND pg_catalog.lower(pg_catalog.btrim(ne.status)) IN (
       'autorizada', 'aprovada', 'processando', 'cancelando'
     )
   ORDER BY ne.created_at DESC, ne.id DESC
   LIMIT 1;
  v_has_other_active := FOUND;

  IF v_has_other_active THEN
    -- Outra NF ativa mantém o PV faturado. Se o número visível ainda
    -- era o cancelado, reponta-o sob o mesmo lock do PV.
    UPDATE public.sale_orders so
       SET nfe = CASE
             WHEN so.nfe IS NOT DISTINCT FROM v_nfe.numero
               THEN COALESCE(v_active_nfe_number, so.nfe)
             ELSE so.nfe
           END,
           updated_at = pg_catalog.now()
     WHERE so.id = v_nfe.sale_order_id
       AND so.status = 'Faturado';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION 'PV com outra NF ativa deixou de estar Faturado'
        USING ERRCODE = '40001';
    END IF;
  ELSIF v_so.status = 'Faturado' THEN
    -- CAS load-bearing: nunca reabre Expedido/Concluído/Finalizado.
    UPDATE public.sale_orders so
       SET status = 'Em Produção',
           nfe = CASE
             WHEN so.nfe IS NOT DISTINCT FROM v_nfe.numero THEN NULL
             ELSE so.nfe
           END,
           updated_at = pg_catalog.now()
     WHERE so.id = v_nfe.sale_order_id
       AND so.status = 'Faturado';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION 'CAS Faturado -> Em Produção perdeu a corrida'
        USING ERRCODE = '40001';
    END IF;
    v_reopened := true;
  ELSE
    -- Replay que já concluiu o mesmo CAS.
    v_reopened := v_idempotent AND v_so.status = 'Em Produção';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'idempotent_replay', v_idempotent,
    'nfe_id', p_nfe_id,
    'sale_order_id', v_nfe.sale_order_id,
    'is_standalone_nfe', false,
    'reopened', v_reopened,
    'reopen_status', CASE
      WHEN v_has_other_active THEN 'Faturado'
      WHEN v_reopened THEN 'Em Produção'
      ELSE v_so.status
    END,
    'reconciliation_needed', false
  );
END;
$$;

-- As três entradas são exclusivamente server-side. A autorização do
-- operador permanece na Edge, antes de usar o cliente service_role.
DO $acl$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'begin_nfe_cancellation_command(uuid,text)',
    'abort_nfe_cancellation_command(uuid,text)',
    'complete_nfe_cancellation_command(uuid,text,text)'
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_signature);
  END LOOP;
END;
$acl$;

COMMENT ON FUNCTION public.begin_nfe_cancellation_command(uuid, text) IS
  'Claim fiscal curto: locks NF-e->PV, recusa estado logístico avançado e faz CAS autorizada->cancelando.';
COMMENT ON FUNCTION public.abort_nfe_cancellation_command(uuid, text) IS
  'Compensa somente claim cancelando comprovadamente não confirmado pelo provedor.';
COMMENT ON FUNCTION public.complete_nfe_cancellation_command(uuid, text, text) IS
  'Commit local idempotente do cancelamento: locks NF-e->PV, CAS fiscal, estorno avulso e reabertura exclusiva de PV Faturado.';

-- ---------------------------------------------------------------------------
-- 5) Contrato executável: ACL, ordem de lock e estados fail-closed
-- ---------------------------------------------------------------------------

DO $contract$
DECLARE
  v_shipment text := pg_catalog.pg_get_functiondef(
    'public.register_order_shipment_command(uuid[],jsonb,uuid,text,uuid)'::regprocedure
  );
  v_begin text := pg_catalog.pg_get_functiondef(
    'public.begin_nfe_cancellation_command(uuid,text)'::regprocedure
  );
  v_complete text := pg_catalog.pg_get_functiondef(
    'public.complete_nfe_cancellation_command(uuid,text,text)'::regprocedure
  );
  v_nfe_lock integer;
  v_command_lock integer;
  v_pv_lock integer;
BEGIN
  v_nfe_lock := pg_catalog.strpos(
    v_shipment,
    E'WHERE ne.sale_order_id = ANY(v_ids)\n   ORDER BY ne.id\n   FOR UPDATE;'
  );
  v_command_lock := pg_catalog.strpos(v_shipment, '''sale-order-command:''');
  v_pv_lock := pg_catalog.strpos(
    v_shipment,
    E'FROM public.sale_orders so\n     WHERE so.id = ANY(v_ids)'
  );
  IF v_nfe_lock = 0 OR v_command_lock = 0 OR v_pv_lock = 0
     OR NOT (v_nfe_lock < v_command_lock AND v_command_lock < v_pv_lock) THEN
    RAISE EXCEPTION 'Contrato de ordem NF-e -> advisory -> PV da expedição violado';
  END IF;
  IF pg_catalog.strpos(v_shipment, 'FOR UPDATE NOWAIT') = 0
     OR pg_catalog.strpos(v_shipment, 'FOUND prova uma NF autorizada') = 0 THEN
    RAISE EXCEPTION 'Expedição sem lock fiscal autoritativo/NOWAIT';
  END IF;
  IF pg_catalog.strpos(v_begin, '''expedido'', ''concluído'', ''concluido'', ''finalizado''') = 0
     OR pg_catalog.strpos(v_begin, 'v_so.status <> ''Faturado''') = 0 THEN
    RAISE EXCEPTION 'Begin de cancelamento não recusa estado logístico avançado';
  END IF;
  IF pg_catalog.strpos(v_complete, 'AND so.status = ''Faturado''') = 0
     OR pg_catalog.strpos(v_complete, 'GET DIAGNOSTICS v_changed = ROW_COUNT') = 0 THEN
    RAISE EXCEPTION 'Complete sem CAS Faturado de reabertura';
  END IF;
  IF has_function_privilege(
       'anon', 'public.begin_nfe_cancellation_command(uuid,text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.complete_nfe_cancellation_command(uuid,text,text)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.complete_nfe_cancellation_command(uuid,text,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACL privada dos commands de cancelamento violada';
  END IF;
END;
$contract$;

COMMIT;
