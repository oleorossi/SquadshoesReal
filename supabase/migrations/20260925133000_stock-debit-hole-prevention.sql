-- ============================================================================
-- FURO DE BAIXA — prevenção no ciclo de vida da reserva
--
-- CONTEXTO
-- O ERP debita material convertendo RESERVA em stock_movements na finalização
-- da OP (convert_reservation_to_out). Logo, material que nunca teve reserva
-- NUNCA é debitado: sai da fábrica e some do estoque só no papel. Três buracos
-- alimentam isso hoje, todos confirmados em produção:
--
--   1. RESERVA DEFASADA. A OP reserva contra a ficha do dia em que nasceu.
--      Se a ficha ganha componentes depois, nada re-reserva o delta.
--      → PV-00145 (fivela/rebite/binóculo strass consumidos e nunca debitados).
--      Detector já existe: list_ops_with_stale_reservations (mig 20260925120000),
--      hoje acusando 56 linhas em 26 OPs ativas (conferido no banco em
--      2026-07-25: 56 linhas / 26 OPs distintas — 18 delas são o SOLADO).
--
--   2. FALHA DE RESERVA ENGOLIDA. tg_sync_orders_from_sale_order_item envolve
--      cada chamada de reserva em BEGIN/EXCEPTION WHEN OTHERS → RAISE WARNING
--      (mig 20260611132747, "pra não quebrar a edição do PV"). Se TODAS falham,
--      a OP nasce sem reserva nenhuma e ninguém fica sabendo.
--      → PV-00141 (OP-2026-01125/01126/01127): 1.200 pares finalizados e
--        faturados com ZERO reserva e ZERO stock_movements; 40 linhas de
--        production_consumptions com actual_quantity = 0 (~R$ 8,6 mil).
--
--   3. PENDÊNCIA DE RECONCILIAÇÃO APAGADA. convert_reservation_to_out cria
--      linha 'reserved' com metadata.partial_pending justamente pra registrar
--      "saldo de baixa parcial — reconciliar ao repor estoque"; aí
--      tg_release_reservations_on_order_terminal cancela TODA reserva 'reserved'
--      na finalização e apaga a pendência. Verificado: as 12 linhas
--      partial_pending do banco estão TODAS em 'cancelled'.
--
-- Além disso: OP criada pelo trigger de ITEM nasce sempre 'Reservado' e SEM
-- order_stages, mesmo com o PV já em 'Em Produção' — a promoção só acontece na
-- transição do PV, que já passou. Hoje: 15 OPs 'Reservado' sob PV 'Em Produção',
-- 12 delas (PV-00148) sem nenhum order_stages.
--
-- O QUE MUDA
--   A) op_expected_consumption_lines(order) — motor único "o que a ficha pede
--      pra esta OP HOJE". list_ops_with_stale_reservations passa a usá-lo (mesma
--      assinatura e mesmas colunas de antes) e a nova ação de reserva também,
--      então detector e correção nunca divergem.
--      reserve_missing_materials_for_order(order) reserva o DELTA — só o que a
--      ficha pede e a OP ainda não tem reservado/debitado — com a granularidade
--      já validada em 4 iterações: 'Componente Direto' casa por product_id, o
--      resto casa por GRUPO, e filter_caixa_by_packaging_mode é aplicado.
--      resync_op_atomic passa a chamar essa ação no fim (fecha a causa-raiz),
--      e resync_reservations_for_sheet(ficha) faz o mesmo pra todas as OPs
--      ativas de uma referência.
--   B) tg_sync_orders_from_sale_order_item continua NÃO-BLOQUEANTE (falha de
--      reserva não pode quebrar a edição do PV), mas agora, além de marcar
--      orders.material_status = 'erro_reserva', detecta o caso pior — "a ficha
--      pede material e NENHUMA reserva foi criada" — e grava em production_alerts
--      (tabela de alertas que já existe, unique (alert_key, severity)).
--   C) tg_release_reservations_on_order_terminal e
--      auto_release_reservations_on_op_cancel preservam as linhas
--      partial_pending numa FINALIZAÇÃO: viram status 'pending_reconciliation'
--      em vez de 'cancelled'. Esse status fica FORA de
--      sync_product_reserved_stock (que só soma 'reserved'/'partially_consumed'),
--      então reserved_stock é liberado igual antes — só a informação sobrevive.
--      Em CANCELAMENTO segue cancelando tudo (a produção foi abortada).
--   D) list_stock_debit_holes(p_days) — relatório só-leitura com OP, PV, produto,
--      quantidade padrão, quantidade real, diferença e valor estimado, unindo as
--      duas origens ('consumo_sem_debito' e 'reserva_parcial_pendente'). E o
--      trigger trg_zzz_flag_stock_debit_holes deixa o furo EXPLÍCITO em
--      production_alerts na hora da finalização — sem bloquear a fábrica.
--   E) A OP criada pelo trigger de item nasce coerente com o PV ('Em Produção'
--      quando o PV já está lá) e ganha order_stages como as demais. Backfill
--      idempotente cria os stages faltantes das OPs vivas.
--
-- O QUE **NÃO** MUDA
--   * Nenhum saldo FÍSICO (products.quantity / stock_grade / stock_movements) é
--     alterado por esta migration nem pela reserva de delta.
--   * Furos históricos NÃO são regularizados aqui — isso mexe em estoque real.
--     O script do PV-00141 está em sql-scripts/fix-furo-baixa-pv-00141.sql,
--     pra rodar manualmente (padrão entrada + baixa compensatória do PV-00145).
--   * As 15 OPs 'Reservado' sob PV 'Em Produção' NÃO são promovidas em massa
--     (mexe em fila de produção) — o BACKFILL só cria os stages que faltam.
--
-- ⚠ EFEITOS COLATERAIS QUE O REVISOR PRECISA ACEITAR ANTES DE APLICAR
--   1. products.reserved_stock SOBE. material_reservations tem o trigger
--      tg_sync_reserved_stock (AFTER INSERT/UPDATE/DELETE) — toda linha nova de
--      delta reduz o "disponível" em MRP/compras/PV na hora. É o número certo
--      (a reserva estava faltando), mas o efeito é imediato nas OPs detectadas
--      assim que alguém salvar a ficha ou rodar resync. Rode antes com
--      reserve_missing_materials_for_order(op, p_dry_run => true).
--   2. A promoção de status do item (E) NÃO é só para OPs novas: qualquer
--      edição de item de um PV 'Em Produção' promove a OP 'Reservado' →
--      'Em Produção' daquele item. Ou seja, as 15 OPs acabam promovidas uma a
--      uma conforme o PCP mexer nos PVs. Confirmar com o PCP.
--   3. Esta migration substitui 5 funções VIVAS por CREATE OR REPLACE (corpos
--      reproduzidos de pg_get_functiondef em 2026-07-25):
--      list_ops_with_stale_reservations, resync_op_atomic,
--      tg_sync_orders_from_sale_order_item,
--      tg_release_reservations_on_order_terminal e
--      auto_release_reservations_on_op_cancel. Aplicar DEPOIS de
--      202609251300xx/1310xx/1320xx e conferir que nenhuma outra frente da
--      auditoria tocou essas 5 no meio do caminho.
--
-- IDEMPOTENTE: tudo é CREATE OR REPLACE / DROP IF EXISTS / INSERT com NOT EXISTS.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (A.0) Motor único: o que a ficha pede pra esta OP HOJE
--
-- Extraído de list_ops_with_stale_reservations pra que o DETECTOR e a AÇÃO de
-- reserva leiam exatamente a mesma lista. Mesma cadeia usada por
-- try_reserve_materials: grade efetiva → ..._by_grade, senão o motor escalar;
-- e sempre filter_caixa_by_packaging_mode (a reserva filtra pelo modo de
-- embalagem do PV — sem isso a caixa alternativa vira falso positivo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.op_expected_consumption_lines(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT COALESCE(
           public.filter_caixa_by_packaging_mode(
             CASE
               WHEN public.resolve_effective_op_grade(o.grade, COALESCE(o.quantity, 0)::numeric) IS NOT NULL
                 THEN public.calculate_order_consumption_by_grade(
                        o.reference_id,
                        public.resolve_effective_op_grade(o.grade, COALESCE(o.quantity, 0)::numeric),
                        COALESCE(o.color, ''),
                        soi.material_variant_id)
               ELSE public.calculate_order_consumption(
                        o.reference_id,
                        COALESCE(o.quantity, 0),
                        COALESCE(o.color, ''),
                        NULL::integer,
                        soi.material_variant_id)
             END,
             so.packaging_mode),
           '[]'::jsonb)
    FROM public.orders o
    LEFT JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
    LEFT JOIN public.sale_orders so       ON so.id  = o.sale_order_id
   WHERE o.id = p_order_id
     AND o.reference_id IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.op_expected_consumption_lines(uuid) IS
  'Linhas de consumo que a ficha ATUAL pede pra esta OP (grade efetiva + variante + filtro de embalagem). Fonte única do detector list_ops_with_stale_reservations e da ação reserve_missing_materials_for_order.';

-- ─────────────────────────────────────────────────────────────────────────────
-- (B.0) Alerta consultável de falha/furo de reserva
--
-- production_alerts já existe e tem UNIQUE (alert_key, severity) — perfeito pro
-- upsert idempotente. Reabre (dismissed_at = NULL) quando o problema reaparece.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_op_reserve_failure_alert(
  p_order_id uuid,
  p_detail   text,
  p_type     text DEFAULT 'reserva_falhou',
  p_severity text DEFAULT 'critical')
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_op_number text;
  v_pv_number text;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;

  SELECT o.order_number, so.order_number
    INTO v_op_number, v_pv_number
    FROM public.orders o
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = p_order_id;

  INSERT INTO public.production_alerts
    (alert_key, alert_type, severity, title, body, payload)
  VALUES (
    p_type || ':' || p_order_id::text,
    p_type,
    p_severity,
    'Reserva de material — ' || COALESCE(v_op_number, p_order_id::text)
      || COALESCE(' (' || v_pv_number || ')', ''),
    COALESCE(NULLIF(p_detail, ''), 'falha não detalhada')
      || ' — sem reserva, a baixa na finalização NÃO debita esse material (furo de estoque).',
    jsonb_build_object(
      'order_id', p_order_id,
      'order_number', v_op_number,
      'sale_order_number', v_pv_number,
      'detail', p_detail,
      'detected_at', now())
  )
  ON CONFLICT (alert_key, severity) DO UPDATE
    SET body         = EXCLUDED.body,
        payload      = EXCLUDED.payload,
        title        = EXCLUDED.title,
        dismissed_at = NULL,
        dismissed_by = NULL;
EXCEPTION WHEN OTHERS THEN
  -- Alerta NUNCA pode derrubar a operação que o gerou.
  RAISE WARNING '[record_op_reserve_failure_alert] falhou pra OP %: %', p_order_id, SQLERRM;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (A.1) Reserva do DELTA — fecha a causa-raiz
--
-- Reserva o que a ficha pede HOJE e a OP ainda não cobriu. Conservador por
-- construção:
--   * só OP ativa ('Reservado' / 'Em Produção') — não toca OP terminal;
--   * cobertura considera QUALQUER reserva não-cancelada (inclui 'converted' e
--     'consumed'): material já debitado não é re-reservado. O detector usa só as
--     ativas de propósito (ele reporta risco; aqui a gente age);
--   * produto que já tem stock_movements 'out' nesta OP é pulado;
--   * granularidade validada: 'Componente Direto' casa por product_id (a ficha
--     FIXA o produto), o resto casa por GRUPO (o material é resolvido dentro do
--     grupo, então vizinho de grupo cobre);
--   * pula cor não cadastrada (matched_by = 'color_mismatch') e dm²→unidade
--     impossível (conversion_warning) — mesmas guardas de try_reserve_materials,
--     pra nunca reservar a cor errada nem um número 100× inflado;
--   * COMPONENTE: reserva no máximo o DISPONÍVEL (onhand − reservado), pra não
--     inflar reserved_stock além do físico. O que faltar sai em 'shortfalls' e
--     vira alerta;
--   * SOLADO: é a ÚNICA exceção ao teto acima — entra como 'sole_pending_grade'
--     (mesmo kind que convert_reservation_to_out resolve chamando
--     debit_sole_stock_by_grade) com a quantidade CHEIA, porque a resolução é
--     por NUMERAÇÃO (stock_grade) e um valor truncado resolveria a grade errada.
--     Consequência REAL a conferir antes de aplicar em massa: hoje são 18 OPs /
--     252 pares pedidos contra 96 disponíveis, então reserved_stock desses 3
--     solados passa a exceder products.quantity e o "disponível" das telas de
--     MRP/compras vai a zero (é o mesmo comportamento das linhas de shortfall
--     que convert_reservation_to_out já cria). O excedente é reportado em
--     'shortfalls'. Só cria se a OP não tiver nenhuma pendência/baixa de solado;
--   * NÃO gera ordem de compra (isso é papel do MRP / try_reserve_materials).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_missing_materials_for_order(
  p_order_id uuid,
  p_dry_run  boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_op        record;
  v_status    text;
  v_lines     jsonb;
  v_line      jsonb;
  v_pid       uuid;
  v_name      text;
  v_comp      text;
  v_src       text;
  v_req       numeric;
  v_onhand    numeric;
  v_group     uuid;
  v_reserved  numeric;
  v_avail     numeric;
  v_qty       numeric;
  v_covered   boolean;
  v_debited   boolean;
  v_has_sole  boolean;
  v_out       jsonb := '[]'::jsonb;
  v_short     jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_result    jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('reserve_missing:' || p_order_id::text));

  SELECT o.id, o.order_number, o.status, o.reference_id, o.color, o.deleted_at
    INTO v_op
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  -- OP soft-deletada não consome material: reservar aqui vazaria reserved_stock
  -- exatamente como o bug que esta migration existe pra fechar.
  IF v_op.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id, 'skipped', true, 'reason', 'OP excluída (soft delete)');
  END IF;

  v_status := lower(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção', 'em producao') THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id, 'skipped', true,
      'reason', 'OP não ativa — reserva de delta não se aplica', 'status', v_op.status);
  END IF;
  IF v_op.reference_id IS NULL THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id, 'skipped', true, 'reason', 'OP sem ficha técnica');
  END IF;

  v_lines := COALESCE(public.op_expected_consumption_lines(p_order_id), '[]'::jsonb);

  -- Solado: uma pendência por OP, e só se ainda não houver pendência nem baixa.
  SELECT EXISTS (
           SELECT 1 FROM public.material_reservations mr
            WHERE mr.order_id = p_order_id
              AND mr.status <> 'cancelled'
              AND COALESCE(mr.metadata ->> 'kind', '') IN ('sole_grade', 'sole_pending_grade'))
      OR EXISTS (
           SELECT 1 FROM public.stock_movements sm
            WHERE sm.order_id = p_order_id
              AND sm.movement_type = 'out'
              AND sm.description LIKE 'Debito Solado por grade%')
    INTO v_has_sole;

  FOR v_line IN
    SELECT t.value FROM jsonb_array_elements(v_lines) AS t(value)
     ORDER BY t.value ->> 'product_id'
  LOOP
    v_pid := NULL;
    BEGIN
      v_pid := NULLIF(v_line ->> 'product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
    CONTINUE WHEN v_pid IS NULL;

    v_comp := COALESCE(NULLIF(v_line ->> 'component', ''), 'Material');
    v_src  := COALESCE(v_line ->> 'source', '');
    v_name := COALESCE(v_line ->> 'product_name', v_pid::text);
    v_req  := COALESCE(NULLIF(v_line ->> 'required', '')::numeric, 0);
    CONTINUE WHEN v_req <= 0;

    IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'reason', 'cor não cadastrada no grupo — não reservar cor errada');
      CONTINUE;
    END IF;
    IF NULLIF(v_line ->> 'conversion_warning', '') IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'reason', 'largura faltando (dm²→unidade impossível) — cadastrar em Ficha de Componente');
      CONTINUE;
    END IF;

    SELECT p.quantity, p.name, p.group_id
      INTO v_onhand, v_name, v_group
      FROM public.products p
     WHERE p.id = v_pid
     FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    -- Já debitado nesta OP? Então não é furo — é consumo consumado.
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.order_id = p_order_id AND sm.product_id = v_pid AND sm.movement_type = 'out'
    ) INTO v_debited;
    CONTINUE WHEN v_debited;

    -- Cobertura (mesma granularidade do detector, porém contando também as
    -- reservas já convertidas/consumidas).
    SELECT EXISTS (
      SELECT 1
        FROM public.material_reservations mr
        LEFT JOIN public.products rp ON rp.id = mr.product_id
       WHERE mr.order_id = p_order_id
         AND mr.status <> 'cancelled'
         AND (
           mr.product_id = v_pid
           OR (v_comp <> 'Componente Direto'
               AND v_group IS NOT NULL
               AND rp.group_id = v_group)
         )
    ) INTO v_covered;
    CONTINUE WHEN v_covered;

    -- Solado: pendência por numeração, resolvida por debit_sole_stock_by_grade.
    -- Quantidade CHEIA de propósito (ver cabeçalho): a resolução é por
    -- numeração e um valor truncado escolheria a grade errada. O excedente
    -- sobre o disponível é reportado em 'shortfalls' pra ficar explícito que
    -- reserved_stock passou do físico.
    IF v_src IN ('primary_sole', 'variant_sole') THEN
      IF v_has_sole THEN CONTINUE; END IF;

      SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0)
        INTO v_reserved
        FROM public.material_reservations mr
       WHERE mr.product_id = v_pid
         AND mr.status IN ('reserved', 'partially_consumed');
      v_avail := COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0);
      IF v_req > GREATEST(0, v_avail) THEN
        v_short := v_short || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name, 'component', v_comp,
          'qty_required', v_req, 'qty_reserved', v_req,
          'qty_missing', v_req - GREATEST(0, v_avail),
          'nota', 'solado reservado por inteiro (resolução por numeração) — excede o disponível');
      END IF;

      IF NOT p_dry_run THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status,
           reservation_type, source, notes, metadata)
        VALUES (p_order_id, v_pid, v_req, 0, 'reserved', 'soft', 'onhand',
                'Delta resync — solado da ficha sem reserva (pendente por numeração)',
                jsonb_build_object('kind', 'sole_pending_grade', 'component', v_comp,
                                   'color', COALESCE(v_op.color, ''), 'delta_resync', true));
      END IF;
      v_has_sole := true;
      v_out := v_out || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'component', v_comp,
        'qty_reserved', v_req, 'kind', 'sole_pending_grade');
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0)
      INTO v_reserved
      FROM public.material_reservations mr
     WHERE mr.product_id = v_pid
       AND mr.status IN ('reserved', 'partially_consumed');

    v_avail := COALESCE(v_onhand, 0) - COALESCE(v_reserved, 0);
    v_qty   := LEAST(v_req, GREATEST(0, v_avail));

    IF v_qty > 0 THEN
      IF NOT p_dry_run THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status,
           reservation_type, source, notes, metadata)
        VALUES (p_order_id, v_pid, v_qty, 0, 'reserved', 'soft', 'onhand',
                'Delta resync — material da ficha atual sem reserva na OP',
                jsonb_build_object('kind', 'component', 'component', v_comp,
                                   'source', v_src, 'color', COALESCE(v_op.color, ''),
                                   'delta_resync', true));
      END IF;
      v_out := v_out || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'component', v_comp,
        'qty_required', v_req, 'qty_reserved', v_qty);
    END IF;

    IF (v_req - v_qty) > 0 THEN
      v_short := v_short || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'component', v_comp,
        'qty_required', v_req, 'qty_reserved', v_qty, 'qty_missing', v_req - v_qty);
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'dry_run', p_dry_run,
    'reserved', v_out,
    'shortfalls', v_short,
    'skipped', v_skipped,
    'status', CASE
      WHEN jsonb_array_length(v_out) = 0 AND jsonb_array_length(v_short) = 0 THEN 'nothing_missing'
      WHEN jsonb_array_length(v_short) > 0 THEN 'partially_reserved'
      ELSE 'delta_reserved' END);

  IF NOT p_dry_run AND jsonb_array_length(v_short) > 0 THEN
    PERFORM public.record_op_reserve_failure_alert(
      p_order_id,
      jsonb_array_length(v_short) || ' material(is) da ficha sem estoque livre pra reservar (delta resync)',
      'reserva_incompleta', 'warning');
  END IF;

  IF NOT p_dry_run AND (jsonb_array_length(v_out) > 0 OR jsonb_array_length(v_short) > 0) THEN
    BEGIN
      INSERT INTO public.audit_logs (action, resource, resource_id, new_data, success)
      VALUES ('reserve_missing_materials_for_order', 'order', p_order_id::text, v_result, true);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.reserve_missing_materials_for_order(uuid, boolean) IS
  'Reserva o DELTA de material que a ficha atual pede e a OP ativa ainda não cobriu. Não toca OP terminal, não duplica reserva, não gera OC, limita ao estoque disponível. p_dry_run = só simula.';

-- ─────────────────────────────────────────────────────────────────────────────
-- (A.2) Resync de reservas de todas as OPs ativas de uma ficha
-- Chamável depois de salvar a ficha técnica (resyncOPsForSheet), ou sob demanda.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resync_reservations_for_sheet(p_reference_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_op       record;
  v_res      jsonb;
  v_results  jsonb := '[]'::jsonb;
  v_touched  integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_op IN
    SELECT o.id FROM public.orders o
     WHERE o.reference_id = p_reference_id
       AND o.status IN ('Reservado', 'Em Produção')
       AND o.deleted_at IS NULL
     ORDER BY o.order_number
  LOOP
    BEGIN
      v_res := public.reserve_missing_materials_for_order(v_op.id);
      IF COALESCE(v_res ->> 'status', '') <> 'nothing_missing' THEN
        v_touched := v_touched + 1;
        v_results := v_results || v_res;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.record_op_reserve_failure_alert(
        v_op.id, 'resync de ficha: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'reference_id', p_reference_id, 'ops_ajustadas', v_touched, 'detalhe', v_results);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (A.3) Detector passa a ler o motor único (mesmas colunas de antes)
--
-- Só reporta o lado "a ficha pede e não há reserva" — o inverso daria falso
-- positivo nas tiras, que reservam por caminho próprio (order_strap_needs).
-- Superfície: /diagnostics → painel "Reserva defasada vs ficha atual".
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_ops_with_stale_reservations();

CREATE FUNCTION public.list_ops_with_stale_reservations()
 RETURNS TABLE(order_id uuid, order_number text, sale_order_number text, reference_name text,
               op_status text, product_id uuid, product_name text, required_qty numeric,
               consumption_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
  WITH ativas AS (
    SELECT o.id, o.order_number, o.status,
           so.order_number AS pv_number,
           ts.name AS ref_name
      FROM public.orders o
      LEFT JOIN public.sale_orders so     ON so.id = o.sale_order_id
      LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE o.status IN ('Reservado', 'Em Produção')
       AND o.reference_id IS NOT NULL
       AND o.deleted_at IS NULL
  ),
  esperado AS (
    SELECT a.id AS order_id, a.order_number, a.pv_number, a.ref_name, a.status,
           (line ->> 'product_id')::uuid AS product_id,
           (line ->> 'product_name') AS product_name,
           COALESCE((line ->> 'source'), '?') AS src,
           COALESCE((line ->> 'component'), '') AS comp,
           COALESCE((line ->> 'required')::numeric, 0) AS required_qty
      FROM ativas a
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(public.op_expected_consumption_lines(a.id), '[]'::jsonb)) AS line
     WHERE (line ->> 'product_id') IS NOT NULL
       AND COALESCE((line ->> 'required')::numeric, 0) > 0
  )
  SELECT e.order_id, e.order_number, e.pv_number, e.ref_name, e.status,
         e.product_id, COALESCE(p.name, e.product_name), e.required_qty, e.src
    FROM esperado e
    LEFT JOIN public.products p ON p.id = e.product_id
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.material_reservations mr
       LEFT JOIN public.products rp ON rp.id = mr.product_id
      WHERE mr.order_id = e.order_id
        AND mr.status IN ('reserved', 'partially_consumed')
        AND (
          mr.product_id = e.product_id
          OR (e.comp <> 'Componente Direto'
              AND p.group_id IS NOT NULL
              AND rp.group_id = p.group_id)
        )
   )
   ORDER BY e.pv_number, e.order_number, COALESCE(p.name, e.product_name);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (A.4) resync_op_atomic passa a re-reservar o delta no fim
--
-- Corpo idêntico ao vivo, com UM passo novo no fim: reserve_missing_materials.
-- Necessário porque o resync APAGA material_reservations e reconstrói a reserva
-- pelo snapshot congelado (hybrid_debit) — se o snapshot não refletir a ficha
-- atual, o delta continuaria de fora. A falha aqui não aborta o resync, mas
-- vira alerta consultável em vez de sumir.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
  v_delta jsonb := NULL;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte Palmilha','Corte Forração','Costura','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  -- NOVO (2026-07-25): fecha a causa-raiz do furo de baixa. hybrid_debit
  -- reconstrói a reserva a partir do snapshot; qualquer componente que a ficha
  -- ATUAL pede e ficou de fora entra aqui como reserva de delta.
  BEGIN
    v_delta := public.reserve_missing_materials_for_order(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || ('reserva de delta falhou: ' || SQLERRM);
    PERFORM public.record_op_reserve_failure_alert(p_order_id, 'resync_op_atomic: ' || SQLERRM);
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'delta_reservations', v_delta,
    'resynced_at', now()
  );
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (B + E) Trigger de sincronização do item do PV
--
-- Mantém o comportamento NÃO-BLOQUEANTE (uma falha de reserva não pode quebrar
-- a edição do PV), mas:
--   (E) a OP nasce com o status coerente com o PV e ganha order_stages;
--       OP 'Reservado' sob PV 'Em Produção' é promovida quando o item é editado;
--   (B) além de material_status = 'erro_reserva' + nota (que já existiam),
--       detecta o caso do PV-00141 — a ficha pede material e NENHUMA reserva
--       foi criada — e grava em production_alerts, consultável pela UI.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_orders_from_sale_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_so_status text;
  v_sale_order_id uuid;
  v_existing_op_id uuid;
  v_op_id uuid;
  v_op_status text;
  v_packaging_mode text;
  v_grade jsonb;
  v_do_reserve boolean := false;
  v_release_first boolean := false;
  v_fail_msgs text[] := ARRAY[]::text[];
  v_target_op_status text;
  v_sectors text[];
  v_stage_name text;
  v_stage_ref_id uuid;
  v_stage_qty integer;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sem_reserva boolean;
  v_expected jsonb;
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF current_setting('app.suppress_item_op_sync', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status, COALESCE(packaging_mode, 'individual_amarrado')
    INTO v_so_status, v_packaging_mode
    FROM public.sale_orders WHERE id = v_sale_order_id;
  IF v_so_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- (E) OP nasce coerente com o PV. Antes nascia sempre 'Reservado', e a
  -- promoção só vinha da transição do PV — que, pra item adicionado DEPOIS,
  -- já tinha acontecido. Resultado: 15 OPs 'Reservado' sob PV 'Em Produção'.
  v_target_op_status := CASE WHEN v_so_status = 'Em Produção' THEN 'Em Produção' ELSE 'Reservado' END;

  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_existing_op_id
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL THEN RETURN NEW; END IF;

    INSERT INTO public.orders (
      reference_id, quantity, color, grade,
      sale_order_id, sale_order_item_id, status, notes
    )
    VALUES (
      NEW.reference_id, NEW.quantity, COALESCE(NEW.color,''),
      public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
      v_sale_order_id, NEW.id, v_target_op_status,
      'Auto-criada por alteração em PV (item adicionado)'
    )
    RETURNING id INTO v_op_id;
    v_do_reserve := true;
    v_release_first := false;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id, status INTO v_op_id, v_op_status
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_op_id IS NOT NULL
       AND (NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.color IS DISTINCT FROM OLD.color
            OR NEW.grade IS DISTINCT FROM OLD.grade
            OR NEW.reference_id IS DISTINCT FROM OLD.reference_id)
    THEN
      UPDATE public.orders
         SET reference_id = NEW.reference_id,
             quantity = NEW.quantity,
             color = COALESCE(NEW.color,''),
             grade = public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
             updated_at = now(),
             notes = COALESCE(notes,'') || E'\n' || 'Atualizada por alteração em PV — qty=' || NEW.quantity::text
       WHERE id = v_op_id;
      IF v_op_status IN ('Pendente', 'Reservado', 'Rascunho') THEN
        v_do_reserve := true;
        v_release_first := true;
      END IF;
    END IF;

    -- (E) auto-cura: OP 'Reservado' sob PV já 'Em Produção' é promovida.
    -- 'Rascunho' fica de fora de propósito — nunca teve débito de estoque.
    IF v_op_id IS NOT NULL AND v_so_status = 'Em Produção' THEN
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id AND status = 'Reservado';
    END IF;
  END IF;

  -- (E) order_stages: o trigger de item nunca criava etapas (o de PV cria).
  -- Vale pro INSERT e como auto-cura de OP existente sem etapas.
  --
  -- ⚠ TUDO dentro de BEGIN/EXCEPTION: este trigger é NÃO-BLOQUEANTE por
  -- contrato (mig 20260611132747) e criar etapas é acessório. order_stages tem
  -- UNIQUE (order_id, stage_name) e stage_name NOT NULL — um
  -- production_sectors com nome repetido, vazio ou JSON null derrubaria o SAVE
  -- DO ITEM DO PV inteiro. Por isso também: nomes normalizados/deduplicados e
  -- ON CONFLICT DO NOTHING.
  IF v_op_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.order_stages os WHERE os.order_id = v_op_id) THEN
    BEGIN
      -- Quantidade/ficha vêm da OP (fonte de verdade das etapas), não do item:
      -- na auto-cura de UPDATE a OP pode não ter sido reescrita nesta chamada.
      SELECT o.reference_id, COALESCE(o.quantity, 0)
        INTO v_stage_ref_id, v_stage_qty
        FROM public.orders o WHERE o.id = v_op_id;

      -- O CASE dentro do LATERAL não é decorativo: o SRF é avaliado ANTES do
      -- WHERE poder filtrar por jsonb_typeof, então um production_sectors
      -- escalar ('"Corte"') estouraria "cannot extract elements from a scalar".
      SELECT ARRAY(
        SELECT DISTINCT btrim(s.v)
          FROM public.technical_sheets ts
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'
                 THEN ts.production_sectors ELSE '[]'::jsonb END) AS s(v)
         WHERE ts.id = v_stage_ref_id
           AND NULLIF(btrim(COALESCE(s.v, '')), '') IS NOT NULL
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status, quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name, public.canonical_stage_order(v_stage_name),
          'pendente', v_stage_qty, 0
        )
        ON CONFLICT (order_id, stage_name) DO NOTHING;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_sync_item] criação de order_stages falhou pra OP %: %', v_op_id, SQLERRM;
    END;
  END IF;

  IF v_do_reserve AND v_op_id IS NOT NULL THEN
    v_grade := CASE
      WHEN NEW.grade IS NOT NULL AND NEW.grade <> '{}'::jsonb THEN NEW.grade
      ELSE NULL
    END;

    IF v_release_first THEN
      BEGIN
        PERFORM public.release_order_reservations(v_op_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] release falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'release: ' || SQLERRM);
      END;
    END IF;

    BEGIN
      PERFORM public.hybrid_debit_stock_for_order(
        p_reference_id   => NEW.reference_id,
        p_order_quantity => NEW.quantity::numeric,
        p_color          => COALESCE(NEW.color, ''),
        p_order_id       => v_op_id,
        p_order_grade    => v_grade,
        p_force_soft     => true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_sync_item] hybrid_debit falhou pra OP %: %', v_op_id, SQLERRM;
      v_fail_msgs := array_append(v_fail_msgs, 'materiais: ' || SQLERRM);
    END;

    IF v_grade IS NOT NULL THEN
      BEGIN
        PERFORM public.debit_sole_stock_by_grade(
          p_reference_id => NEW.reference_id,
          p_order_id     => v_op_id,
          p_color        => COALESCE(NEW.color, ''),
          p_order_grade  => v_grade,
          p_force_soft   => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] debit_sole falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'solado: ' || SQLERRM);
      END;
    END IF;

    IF NEW.strap_colors IS NOT NULL
       AND jsonb_typeof(NEW.strap_colors) = 'array'
       AND jsonb_array_length(NEW.strap_colors) > 0 THEN
      BEGIN
        PERFORM public.debit_strap_stock(
          p_strap_colors   => NEW.strap_colors,
          p_order_quantity => NEW.quantity,
          p_order_id       => v_op_id,
          p_order_grade    => v_grade,
          p_force_soft     => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_sync_item] debit_strap falhou pra OP %: %', v_op_id, SQLERRM;
        v_fail_msgs := array_append(v_fail_msgs, 'tiras: ' || SQLERRM);
      END;
    END IF;

    BEGIN
      PERFORM public.debit_packaging_for_order(
        p_sale_order_id  => v_sale_order_id,
        p_order_id       => v_op_id,
        p_reference_id   => NEW.reference_id,
        p_order_quantity => NEW.quantity,
        p_packaging_mode => v_packaging_mode,
        p_force_soft     => true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_sync_item] debit_packaging falhou pra OP %: %', v_op_id, SQLERRM;
      v_fail_msgs := array_append(v_fail_msgs, 'embalagem: ' || SQLERRM);
    END;

    -- (B) O caso do PV-00141: nenhuma das chamadas acima produziu reserva.
    -- Sem isso a OP seguia "normal" até ser finalizada sem NENHUM débito.
    SELECT NOT EXISTS (
      SELECT 1 FROM public.material_reservations mr
       WHERE mr.order_id = v_op_id AND mr.status <> 'cancelled'
    ) INTO v_sem_reserva;

    IF v_sem_reserva THEN
      BEGIN
        v_expected := COALESCE(public.op_expected_consumption_lines(v_op_id), '[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_expected := '[]'::jsonb;
      END;
      IF jsonb_array_length(v_expected) > 0 THEN
        v_fail_msgs := array_append(
          v_fail_msgs,
          'reserva VAZIA: a ficha pede ' || jsonb_array_length(v_expected)
            || ' material(is) e nenhuma reserva foi criada');
      END IF;
    END IF;

    IF COALESCE(array_length(v_fail_msgs, 1), 0) > 0 THEN
      UPDATE public.orders
         SET material_status = 'erro_reserva',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '')
               || '⚠ Reserva automática FALHOU — rodar reserva manual (MRP). Detalhe: '
               || array_to_string(v_fail_msgs, ' | ')
       WHERE id = v_op_id;

      PERFORM public.record_op_reserve_failure_alert(
        v_op_id, array_to_string(v_fail_msgs, ' | '));
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) Preservar a pendência de reconciliação na finalização
--
-- convert_reservation_to_out cria linha 'reserved' com metadata.partial_pending
-- pra registrar o saldo que NÃO foi debitado por falta de estoque. Os dois
-- triggers terminais cancelavam essa linha junto com as demais — as 12 linhas
-- partial_pending do banco estão TODAS em 'cancelled'.
--
-- Agora, em FINALIZAÇÃO, elas viram 'pending_reconciliation'. Esse status não
-- entra em sync_product_reserved_stock (que só soma 'reserved' e
-- 'partially_consumed'), então products.reserved_stock é liberado exatamente
-- como antes — muda só a rastreabilidade. Em CANCELAMENTO segue cancelando
-- tudo: a produção foi abortada, não há saldo a reconciliar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_release_reservations_on_order_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  r RECORD;
  v_finalizada boolean;
  v_preservadas integer := 0;
BEGIN
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN

    v_finalizada := NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido');

    IF v_finalizada THEN
      FOR r IN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               notes = COALESCE(NULLIF(notes, ''), '')
                       || ' [preservada: saldo de baixa PARCIAL não debitado — OP -> ' || NEW.status || ']',
               updated_at = now()
         WHERE order_id = NEW.id
           AND status IN ('reserved', 'partially_consumed')
           AND COALESCE((metadata ->> 'partial_pending')::boolean, false) IS TRUE
        RETURNING product_id
      LOOP
        v_preservadas := v_preservadas + 1;
        PERFORM public.sync_product_reserved_stock(r.product_id);
      END LOOP;

      IF v_preservadas > 0 THEN
        PERFORM public.record_op_reserve_failure_alert(
          NEW.id,
          v_preservadas || ' saldo(s) de baixa parcial preservado(s) — material consumido sem débito, reconciliar ao repor estoque',
          'baixa_parcial_pendente', 'warning');
      END IF;
    END IF;

    FOR r IN
      UPDATE public.material_reservations
         SET status = 'cancelled',
             notes = COALESCE(NULLIF(notes, ''), '')
                     || ' [auto-liberada: OP -> ' || NEW.status || ']',
             updated_at = now()
       WHERE order_id = NEW.id
         AND status IN ('reserved', 'partially_consumed')
      RETURNING product_id
    LOOP
      PERFORM public.sync_product_reserved_stock(r.product_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  r RECORD;
  v_finalizada boolean;
BEGIN
  -- Matriz unificada com tg_release_reservations_on_order_terminal (RES-6) —
  -- inclui 'Faturado'/'FINALIZADO', que antes só a outra trigger conhecia.
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelado', 'Cancelada', 'Concluído', 'Concluido')
     AND NEW.status IS DISTINCT FROM OLD.status THEN

    v_finalizada := NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido');

    IF v_finalizada THEN
      FOR r IN
        UPDATE public.material_reservations
           SET status     = 'pending_reconciliation',
               notes      = COALESCE(NULLIF(notes, ''), '')
                            || ' [preservada: saldo de baixa PARCIAL não debitado — OP -> ' || NEW.status || ']',
               updated_at = now()
         WHERE order_id = NEW.id
           AND status IN ('reserved', 'partially_consumed')
           AND COALESCE((metadata ->> 'partial_pending')::boolean, false) IS TRUE
        RETURNING product_id
      LOOP
        PERFORM public.sync_product_reserved_stock(r.product_id);
      END LOOP;
    END IF;

    FOR r IN
      UPDATE public.material_reservations
         SET status     = 'cancelled',
             notes      = COALESCE(NULLIF(notes, ''), '')
                          || ' [auto-liberada: OP -> ' || NEW.status || ']',
             updated_at = now()
       WHERE order_id = NEW.id
         AND status IN ('reserved', 'partially_consumed')
      RETURNING product_id
    LOOP
      PERFORM public.sync_product_reserved_stock(r.product_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (D) Relatório de furos de baixa — só leitura, idempotente
--
-- Duas origens:
--   'consumo_sem_debito'         — production_consumptions com
--                                  standard_quantity > 0 e actual_quantity = 0.
--                                  É a detecção que record_order_consumption já
--                                  fazia ("sem débito registrado (possível furo
--                                  de baixa)") e que ninguém via.
--   'reserva_parcial_pendente'   — o saldo preservado pelo item (C): reserva
--                                  cujo débito não coube no estoque.
--
-- Superfície: /diagnostics → painel "Furo de baixa — material sem débito".
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_stock_debit_holes(integer);

CREATE FUNCTION public.list_stock_debit_holes(p_days integer DEFAULT 90)
 RETURNS TABLE(origem text, order_id uuid, order_number text, sale_order_number text,
               reference_name text, op_status text, product_id uuid, product_name text,
               unit text, standard_quantity numeric, actual_quantity numeric,
               diferenca numeric, valor_estimado numeric, detectado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT 'consumo_sem_debito'::text AS origem,
         o.id, o.order_number, so.order_number, ts.name, o.status,
         p.id, COALESCE(p.name, pc.component_name), p.unit,
         round(pc.standard_quantity, 4),
         round(pc.actual_quantity, 4),
         round(pc.standard_quantity - pc.actual_quantity, 4),
         round(COALESCE(pc.standard_cost, 0) - COALESCE(pc.actual_cost, 0), 2),
         pc.created_at
    FROM public.production_consumptions pc
    JOIN public.orders o            ON o.id  = pc.order_id
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.products p     ON p.id  = pc.product_id
   WHERE pc.superseded_at IS NULL
     AND o.deleted_at IS NULL
     AND COALESCE(pc.standard_quantity, 0) > 0
     AND COALESCE(pc.actual_quantity, 0) = 0
     AND pc.created_at >= now() - make_interval(days => GREATEST(1, COALESCE(p_days, 90)))

  UNION ALL

  SELECT 'reserva_parcial_pendente'::text,
         o.id, o.order_number, so.order_number, ts.name, o.status,
         p.id, p.name, p.unit,
         round(mr.quantity_reserved, 4),
         round(mr.quantity_consumed, 4),
         round(mr.quantity_reserved - mr.quantity_consumed, 4),
         round((mr.quantity_reserved - mr.quantity_consumed) * COALESCE(p.unit_price, 0), 2),
         mr.updated_at
    FROM public.material_reservations mr
    JOIN public.orders o            ON o.id  = mr.order_id
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.products p     ON p.id  = mr.product_id
   WHERE mr.status = 'pending_reconciliation'
     AND o.deleted_at IS NULL
     AND (mr.quantity_reserved - mr.quantity_consumed) > 0
     AND mr.updated_at >= now() - make_interval(days => GREATEST(1, COALESCE(p_days, 90)))

   ORDER BY 13 DESC NULLS LAST, 3, 8;
$fn$;

COMMENT ON FUNCTION public.list_stock_debit_holes(integer) IS
  'Material que a ficha pedia e NÃO foi debitado do estoque (furo de baixa), nas OPs dos últimos p_days dias. Só leitura.';

-- ─────────────────────────────────────────────────────────────────────────────
-- (D) Guard de finalização — NÃO bloqueia, mas grita
--
-- A finalização continua acontecendo (a fábrica não pode parar), só que o furo
-- vira alerta consultável em production_alerts na mesma transação.
-- Nome com 'zzz' de propósito: triggers AFTER UPDATE em orders disparam em
-- ordem alfabética, e este precisa rodar DEPOIS de
-- trg_record_consumption_on_finalize (que é quem grava production_consumptions).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_flag_stock_debit_holes_on_finalize()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_n     integer := 0;
  v_valor numeric := 0;
BEGIN
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN

    SELECT count(*), COALESCE(sum(pc.standard_cost - COALESCE(pc.actual_cost, 0)), 0)
      INTO v_n, v_valor
      FROM public.production_consumptions pc
     WHERE pc.order_id = NEW.id
       AND pc.superseded_at IS NULL
       AND COALESCE(pc.standard_quantity, 0) > 0
       AND COALESCE(pc.actual_quantity, 0) = 0;

    IF v_n > 0 THEN
      BEGIN
        INSERT INTO public.production_alerts
          (alert_key, alert_type, severity, title, body, payload)
        VALUES (
          'furo_baixa:' || NEW.id::text,
          'furo_baixa',
          'critical',
          'Furo de baixa — OP ' || COALESCE(NEW.order_number, NEW.id::text),
          v_n || ' material(is) da ficha saíram da fábrica SEM débito de estoque (≈ R$ '
            || round(v_valor, 2)::text || '). Regularizar com entrada + baixa compensatória.',
          jsonb_build_object(
            'order_id', NEW.id, 'order_number', NEW.order_number,
            'linhas', v_n, 'valor_estimado', round(v_valor, 2),
            'op_status', NEW.status, 'detected_at', now())
        )
        ON CONFLICT (alert_key, severity) DO UPDATE
          SET body = EXCLUDED.body, payload = EXCLUDED.payload,
              title = EXCLUDED.title, dismissed_at = NULL, dismissed_by = NULL;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_flag_stock_debit_holes] alerta falhou pra OP %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- AFTER UPDATE **OF status** + WHEN: mesma forma de
-- trg_record_consumption_on_finalize (conferido em pg_get_triggerdef). Sem isso
-- o trigger acordava em TODO update de orders (planned dates, notas, kanban) só
-- pra cair no IF — e a fábrica atualiza `orders` o tempo todo.
DROP TRIGGER IF EXISTS trg_zzz_flag_stock_debit_holes ON public.orders;
CREATE TRIGGER trg_zzz_flag_stock_debit_holes
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido')
        AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_flag_stock_debit_holes_on_finalize();

-- ─────────────────────────────────────────────────────────────────────────────
-- (E) BACKFILL — order_stages faltantes das OPs vivas
--
-- 12 OPs do PV-00148 (e qualquer outra na mesma situação) nasceram pelo trigger
-- de item sem nenhuma etapa: não aparecem no Kanban nem nas fichas de operador.
-- Idempotente: só insere onde não existe NENHUMA etapa. NÃO promove status
-- (isso mexe em fila de produção — decisão do usuário).
--
-- ⚠ Nomes de setor DEDUPLICADOS e sem vazio/NULL, mais ON CONFLICT DO NOTHING:
-- order_stages tem UNIQUE (order_id, stage_name) e stage_name NOT NULL, e
-- production_sectors é JSONB editado por usuário. Hoje o banco está limpo
-- (conferido em 2026-07-25: 0 fichas com nome repetido ou não-string), mas sem
-- essas guardas UMA ficha suja abortaria a migration INTEIRA.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.order_stages
  (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
SELECT o.id,
       s.name,
       public.canonical_stage_order(s.name),
       'pendente',
       COALESCE(o.quantity, 0),
       0
  FROM public.orders o
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN array_length(x.arr, 1) IS NULL
               THEN ARRAY['Corte Palmilha','Corte Forração','Costura','Aviamento',
                          'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
             ELSE x.arr
           END AS names
      FROM (
        SELECT ARRAY(
          SELECT DISTINCT btrim(v.value)
            FROM public.technical_sheets ts
            CROSS JOIN LATERAL jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'
                   THEN ts.production_sectors ELSE '[]'::jsonb END) AS v(value)
           WHERE ts.id = o.reference_id
             AND NULLIF(btrim(COALESCE(v.value, '')), '') IS NOT NULL
        ) AS arr
      ) x
  ) g
  CROSS JOIN LATERAL unnest(g.names) AS s(name)
 WHERE o.status IN ('Reservado', 'Em Produção')
   AND o.reference_id IS NOT NULL
   AND o.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.order_stages os WHERE os.order_id = o.id)
ON CONFLICT (order_id, stage_name) DO NOTHING;
