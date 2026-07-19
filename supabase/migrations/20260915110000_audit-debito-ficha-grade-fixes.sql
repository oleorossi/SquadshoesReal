-- ============================================================================
-- Auditoria débito ficha × grade (specs/auditoria-debito-ficha-grade.md) — FIXES
-- ============================================================================
-- Bugs confirmados pela auditoria 2026-07-18/19 (motores lidos do banco VIVO,
-- verificação adversarial por achado + evidência em dados de produção):
--
--  DEB-1/RES-2 (CRÍTICO) convert_reservation_to_out: ramo componente debitava
--    LEAST(estoque, reserva) mas gravava quantity_consumed = reserva CHEIA —
--    ledger de reservas superdeclara consumo (ex.: OP-2026-01128 PLACA EVA
--    consumed=1965,6 dm² com débito real de 76,04; TIRA 1428 m com débito 0).
--    Fix: paridade com o ramo sole_grade — consumed = debitado real, flag
--    partial_debit, linha de shortfall 'reserved' e aviso na OP.
--  DEB-2 (ALTO) hybrid_debit_stock_for_order: só adiava solado com
--    source='primary_sole'; solado PINADO na variante sai como 'variant_sole'
--    e seria debitado 2× (escalar no hybrid + por grade no debit_sole).
--  DEB-3/RES-1 (ALTO) record_order_consumption passava orders.grade CRUA ao
--    motor — OP legada com grade BASE (soma 12, quantity 600) tinha consumo
--    padrão computado pra 12 pares (OP-00801: std 70,1 pra 600 pares). Fix:
--    resolve_effective_op_grade (escala como o débito/reserva já fazem).
--  DEB-4 (MÉDIO) hybrid_debit derivava o item do PV por (reference_id, color)
--    LIMIT 1 — usa orders.sale_order_item_id primeiro (fallback mantido).
--  DEB-6 (ALTO) tg_debit_service_order_base: gravava movimento com quantidade
--    CHEIA debitando clampado; idempotência por description colidia com
--    order_number NULL (bloqueava débitos legítimos). Fix: movimento = débito
--    real + marcador [os:<id>].
--  RES-3 (MÉDIO) aviso "reservas ainda em aberto" do finalize era código morto:
--    trg_auto_release_... ('a') rodava ANTES de trg_record_consumption_... no
--    mesmo UPDATE e cancelava as reservas. Fix: rename pra trg_zz_release_...
--  RES-7 (BAIXO) debit_sole_stock_by_grade sem advisory lock nem guarda de
--    movimento duplicado — retry podia debitar solado 2×.
--  DEB-7 (BAIXO) debit_sole usava a chave conjugada sem checar existência no
--    stock_grade (fallback legado da mig 20260426140000 tinha se perdido).
--  AUD-1 (ALTO, achado de dados) tg_sync_orders_from_sale_order_item engolia
--    falha dos débitos soft como RAISE WARNING invisível — OPs nasciam SEM
--    NENHUMA reserva e ninguém via (OP-2026-01125/26/27, OP-2026-00890/91:
--    finalizadas sem débito algum). Fix: falha vira material_status =
--    'erro_reserva' + aviso em orders.notes.
--
-- + run_debit_guard_tests(): trava de regressão (introspecção das definições
--   vivas + casos puros do resolve_effective_op_grade). Exposta em /diagnostics.
-- Idempotente (CREATE OR REPLACE + renames condicionais).
-- Pré-requisito: 20260915100000 (resolve_effective_op_grade).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DEB-3/RES-1 — record_order_consumption com grade efetiva (escalada)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_order_consumption(p_order_id uuid, p_reason text DEFAULT 'finalizacao'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o record;
  v_variant uuid;
  v_strap_colors jsonb;
  v_grade_efetiva jsonb;
  v_cons jsonb;
  v_rows integer := 0;
  v_std_total numeric := 0;
  v_act_total numeric := 0;
  v_reservas_pendentes integer := 0;
  v_avisos text[] := ARRAY[]::text[];
BEGIN
  SELECT id, reference_id, quantity, color, grade, status, sale_order_item_id
    INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('record_consumption:' || p_order_id::text));

  UPDATE public.production_consumptions
     SET superseded_at = now(), superseded_reason = p_reason
   WHERE order_id = p_order_id AND superseded_at IS NULL;

  SELECT i.material_variant_id, i.strap_colors INTO v_variant, v_strap_colors
    FROM public.sale_order_items i WHERE i.id = v_o.sale_order_item_id;

  -- Grade EFETIVA: escala grade BASE legada (soma ≈ 12 com quantity real) pro
  -- total da OP — paridade com debit_sole/try_reserve (scale_grade_to_total).
  -- Antes: grade crua ⇒ std ~30-50× subestimado (auditoria 2026-07-19, DEB-3).
  v_grade_efetiva := public.resolve_effective_op_grade(v_o.grade, COALESCE(v_o.quantity, 0)::numeric);

  IF v_o.reference_id IS NOT NULL THEN
    IF v_grade_efetiva IS NOT NULL THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_o.reference_id, v_grade_efetiva, COALESCE(v_o.color, ''), v_variant);
    ELSE
      v_cons := public.calculate_order_consumption(
        v_o.reference_id, COALESCE(v_o.quantity, 0), COALESCE(v_o.color, ''), NULL::integer, v_variant);
    END IF;
  END IF;
  v_cons := COALESCE(v_cons, '[]'::jsonb);

  WITH std_raw AS (
    SELECT (e->>'product_id')::uuid AS product_id,
           COALESCE(e->>'component', '?') AS component,
           e->>'product_name' AS product_name,
           (e->>'required')::numeric AS required,
           e->>'unit' AS unit
      FROM jsonb_array_elements(v_cons) e
     WHERE (e->>'product_id') IS NOT NULL
       AND COALESCE((e->>'required')::numeric, 0) > 0
  ),
  std_conv AS (
    SELECT s.product_id, s.component, s.product_name,
           COALESCE(
             public.convert_to_product_unit(s.required, s.unit, COALESCE(p.unit, '')),
             CASE WHEN conv.dm2_per_unit IS NOT NULL AND conv.dm2_per_unit > 0
                   AND public.convert_to_product_unit(s.required, s.unit, 'dm²') IS NOT NULL
                  THEN public.convert_to_product_unit(s.required, s.unit, 'dm²') / conv.dm2_per_unit
             END,
             s.required) AS required_prod_unit,
           p.unit_price
      FROM std_raw s
      LEFT JOIN public.products p ON p.id = s.product_id
      LEFT JOIN LATERAL public.get_material_conversion_info(s.product_id) conv ON true
  ),
  std AS (
    SELECT product_id,
           string_agg(DISTINCT component, ' + ') AS component_name,
           max(product_name) AS product_name,
           sum(required_prod_unit) AS std_qty,
           max(unit_price) AS unit_price
      FROM std_conv
     GROUP BY product_id
  ),
  straps AS (
    SELECT sn.product_id, 'Tira'::text AS component_name, sn.product_name,
           sn.required_m AS std_qty, p.unit_price
      FROM public.order_strap_needs(v_strap_colors, COALESCE(v_o.quantity, 0),
             COALESCE(v_grade_efetiva, v_o.grade)) sn
      LEFT JOIN public.products p ON p.id = sn.product_id
     WHERE sn.product_id IS NOT NULL AND sn.required_m > 0
       AND NOT EXISTS (SELECT 1 FROM std WHERE std.product_id = sn.product_id)
  ),
  std_all AS (
    SELECT * FROM std UNION ALL SELECT * FROM straps
  ),
  act AS (
    SELECT sm.product_id,
           sum(sm.quantity) AS act_qty,
           sum(sm.quantity * COALESCE(sm.unit_price_at_movement, p.unit_price, 0)) AS act_cost
      FROM public.stock_movements sm
      LEFT JOIN public.products p ON p.id = sm.product_id
     WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
     GROUP BY sm.product_id
  ),
  merged AS (
    SELECT COALESCE(s.product_id, a.product_id) AS product_id,
           s.component_name,
           COALESCE(s.product_name, pr.name) AS product_name,
           COALESCE(s.std_qty, 0) AS std_qty,
           COALESCE(a.act_qty, 0) AS act_qty,
           COALESCE(s.std_qty, 0) * COALESCE(s.unit_price, pr.unit_price, 0) AS std_cost,
           COALESCE(a.act_cost, 0) AS act_cost
      FROM std_all s
      FULL OUTER JOIN act a ON a.product_id = s.product_id
      LEFT JOIN public.products pr ON pr.id = COALESCE(s.product_id, a.product_id)
  ),
  ins AS (
    INSERT INTO public.production_consumptions
      (order_id, product_id, component_type, component_name,
       standard_quantity, actual_quantity, standard_cost, actual_cost, notes)
    SELECT p_order_id, m.product_id,
           CASE
             WHEN m.component_name = 'Tira' THEN 'strap'
             WHEN m.component_name ~* '(cabedal|forr|palmilha|fachete|solado)' THEN 'spec'
             ELSE 'bom'
           END,
           COALESCE(NULLIF(m.component_name, '?'), m.product_name, 'Movimento sem par no motor'),
           round(m.std_qty, 4), round(m.act_qty, 4),
           round(m.std_cost, 4), round(m.act_cost, 4),
           CASE
             WHEN m.std_qty = 0 THEN 'só movimento (débito sem par no motor de consumo) — ' || p_reason
             WHEN m.act_qty = 0 THEN 'sem débito registrado (possível furo de baixa) — ' || p_reason
             ELSE p_reason
           END
      FROM merged m
     WHERE m.std_qty > 0 OR m.act_qty > 0
    RETURNING standard_cost, actual_cost
  )
  SELECT count(*), COALESCE(sum(standard_cost), 0), COALESCE(sum(actual_cost), 0)
    INTO v_rows, v_std_total, v_act_total FROM ins;

  SELECT count(*) INTO v_reservas_pendentes
    FROM public.material_reservations
   WHERE order_id = p_order_id AND status = 'reserved';
  IF v_reservas_pendentes > 0 THEN
    v_avisos := array_append(v_avisos,
      v_reservas_pendentes || ' reserva(s) ainda em aberto — consumo real pode estar incompleto');
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'linhas', v_rows,
    'standard_total', v_std_total,
    'actual_total', v_act_total,
    'reservas_pendentes', v_reservas_pendentes,
    'avisos', to_jsonb(v_avisos));
END;
$function$;

-- ----------------------------------------------------------------------------
-- DEB-1/RES-2 — convert_reservation_to_out: ledger honesto no ramo componente
-- (ramos sole_grade e sole_pending_grade preservados byte a byte da versão viva)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id uuid, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD; v_kind text; v_size text; v_size_qty numeric; v_available numeric; v_debit_size numeric;
  v_stock_grade jsonb; v_new_grade jsonb; v_debited_grade jsonb; v_shortfall_grade jsonb;
  v_total_debited numeric; v_shortfall_total numeric; v_prev_total numeric; v_prev_qty numeric;
  v_target_name text; v_effective_grade jsonb; v_debit numeric; v_synced uuid[] := '{}';
  v_op_ref uuid; v_op_color text; v_op_grade jsonb;
  v_before_debited numeric; v_after_debited numeric; v_pend_debited numeric; v_pend_shortfall numeric;
  v_comp_shortfall numeric; v_msg text;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuário não aprovado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || p_order_id::text));
  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id AND (p_product_id IS NULL OR product_id = p_product_id) AND status = 'reserved'
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations SET status = 'cancelled', updated_at = now() WHERE id = v_res.id; CONTINUE;
      END IF;
      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;
      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;
      v_new_grade := v_stock_grade; v_total_debited := 0; v_shortfall_total := 0;
      v_debited_grade := '{}'::jsonb; v_shortfall_grade := '{}'::jsonb;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_debit_size := LEAST(v_available, v_size_qty);
        IF v_debit_size > 0 THEN
          v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_debit_size));
          v_total_debited := v_total_debited + v_debit_size;
          v_debited_grade := jsonb_set(v_debited_grade, ARRAY[v_size], to_jsonb(v_debit_size));
        END IF;
        IF (v_size_qty - v_debit_size) > 0 THEN
          v_shortfall_total := v_shortfall_total + (v_size_qty - v_debit_size);
          v_shortfall_grade := jsonb_set(v_shortfall_grade, ARRAY[v_size], to_jsonb(v_size_qty - v_debit_size));
        END IF;
      END LOOP;
      IF v_total_debited <= 0 THEN CONTINUE; END IF;
      UPDATE public.products SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
              'Conversão Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
              || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      UPDATE public.material_reservations
         SET status = 'converted', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited,
             metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;
      IF v_shortfall_total > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (v_res.order_id, v_res.product_id, v_shortfall_total, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
      END IF;
      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
    ELSIF v_kind = 'sole_pending_grade' THEN
      IF EXISTS (
        SELECT 1 FROM public.material_reservations mr2
         WHERE mr2.order_id = p_order_id AND mr2.id <> v_res.id
           AND (mr2.metadata ->> 'kind') = 'sole_grade'
           AND mr2.status IN ('reserved', 'consumed', 'converted')
      ) THEN
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
         WHERE id = v_res.id;
      ELSE
        SELECT o.reference_id, o.color, o.grade INTO v_op_ref, v_op_color, v_op_grade
          FROM public.orders o WHERE o.id = p_order_id;
        v_before_debited := COALESCE((
          SELECT SUM(sm.quantity) FROM public.stock_movements sm
           WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
             AND sm.description LIKE 'Debito Solado por grade%'), 0);
        IF v_op_ref IS NOT NULL AND v_op_grade IS NOT NULL AND jsonb_typeof(v_op_grade) = 'object' THEN
          PERFORM public.debit_sole_stock_by_grade(v_op_ref, p_order_id, COALESCE(v_op_color, ''), v_op_grade, false);
        END IF;
        v_after_debited := COALESCE((
          SELECT SUM(sm.quantity) FROM public.stock_movements sm
           WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
             AND sm.description LIKE 'Debito Solado por grade%'), 0);
        v_pend_debited := GREATEST(0, v_after_debited - v_before_debited);
        v_pend_shortfall := GREATEST(0, COALESCE(v_res.quantity_reserved, 0) - v_pend_debited);
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') ||
                 CASE WHEN v_pend_debited > 0
                   THEN ' [convert: débito by-grade executado no produto canônico — pendência substituída]'
                   ELSE ' [cancelled at convert: sole_pending_grade sem baixa (sem estoque ou produto não resolvido)]'
                 END
         WHERE id = v_res.id AND status = 'reserved';
        IF v_pend_shortfall > 0 THEN
          SELECT p.name INTO v_target_name FROM public.products WHERE id = v_res.product_id;
          UPDATE public.orders
             SET notes = COALESCE(NULLIF(notes, '') || E'\n', '')
                 || '⚠ Solado em falta na conversão: ' || round(v_pend_shortfall)::text
                 || ' de ' || round(COALESCE(v_res.quantity_reserved, 0))::text
                 || ' pares sem baixa (' || COALESCE(v_target_name, 'Solado')
                 || ') — reconciliar ao repor estoque'
           WHERE id = p_order_id;
        END IF;
        IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
      END IF;
    ELSE
      -- Componente/tira genérico. FIX DEB-1/RES-2 (auditoria 2026-07-19):
      -- antes, debitava LEAST(estoque, reserva) mas gravava quantity_consumed =
      -- reserva CHEIA — sem shortfall, sem aviso. Agora espelha o ramo
      -- sole_grade: consumed = debitado real, flag partial_debit, linha de
      -- shortfall 'reserved' (reconciliável ao repor) e aviso na OP.
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_debit := LEAST(COALESCE(v_res.quantity_reserved, 0), GREATEST(0, COALESCE(v_prev_qty, 0)));
      v_comp_shortfall := GREATEST(0, COALESCE(v_res.quantity_reserved, 0) - v_debit);
      IF v_debit <= 0 THEN
        -- Sem estoque NENHUM: não converte (a reserva fica 'reserved' — pendência
        -- visível e conversível após reposição; na finalização o release cancela
        -- e o furo aparece no debit_consistency_report). Aviso 1× na OP.
        v_msg := '⚠ Componente sem estoque na conversão: ' || COALESCE(v_target_name, v_res.product_id::text)
                 || ' (' || round(COALESCE(v_res.quantity_reserved, 0), 2)::text || ' sem baixa)';
        UPDATE public.orders o
           SET notes = COALESCE(NULLIF(o.notes, '') || E'\n', '') || v_msg
         WHERE o.id = p_order_id AND (o.notes IS NULL OR position(v_msg IN o.notes) = 0);
        CONTINUE;
      END IF;
      UPDATE public.products SET quantity = quantity - v_debit, updated_at = now() WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
              'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material')
              || CASE WHEN v_comp_shortfall > 0 THEN ' (parcial)' ELSE '' END
              || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      UPDATE public.material_reservations
         SET status = 'converted', quantity_reserved = v_debit, quantity_consumed = v_debit,
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || CASE WHEN v_comp_shortfall > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res.id;
      IF v_comp_shortfall > 0 THEN
        INSERT INTO public.material_reservations
          (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, metadata, notes)
        VALUES (v_res.order_id, v_res.product_id, v_comp_shortfall, 0, 'reserved',
          COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
          COALESCE(v_res.metadata, '{}'::jsonb)
            || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
          '⚠ Saldo de baixa parcial (componente em falta) — reconciliar ao repor estoque');
        v_msg := '⚠ Componente com baixa PARCIAL na conversão: ' || COALESCE(v_target_name, v_res.product_id::text)
                 || ' (' || round(v_comp_shortfall, 2)::text || ' sem baixa)';
        UPDATE public.orders o
           SET notes = COALESCE(NULLIF(o.notes, '') || E'\n', '') || v_msg
         WHERE o.id = p_order_id AND (o.notes IS NULL OR position(v_msg IN o.notes) = 0);
      END IF;
      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
    END IF;
  END LOOP;
  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;
END;
$function$;

-- ----------------------------------------------------------------------------
-- DEB-2 + DEB-4 — hybrid_debit: adia variant_sole; deriva item via
-- orders.sale_order_item_id (fallback por ref+cor mantido)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid, p_order_grade jsonb DEFAULT NULL::jsonb, p_force_soft boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
  v_eff_grade jsonb;
  v_packaging_mode text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_eff_grade := CASE WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity) ELSE p_order_grade END;

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  -- DEB-4 (auditoria 2026-07-19): o item do PV vem de orders.sale_order_item_id
  -- (vínculo canônico); o match por (reference_id, color) LIMIT 1 vira fallback
  -- — dois itens da mesma ref+cor no PV podiam trocar snapshot/variante.
  SELECT sale_order_id, sale_order_item_id INTO v_sale_order_id, v_soi_id
    FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT packaging_mode INTO v_packaging_mode
      FROM public.sale_orders
     WHERE id = v_sale_order_id;
  END IF;

  IF v_soi_id IS NULL AND v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, v_eff_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color, NULL);
      ELSE
        v_items := public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size, NULL);
      END IF;
    END IF;
  END IF;

  -- snapshots antigos ainda contêm as DUAS caixas — filtrar na leitura
  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);

  IF NOT p_force_soft THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items) AS value
       ORDER BY value ->> 'product_id'
    LOOP
      IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;

      v_pid    := (v_item ->> 'product_id')::uuid;
      v_source := v_item ->> 'source';

      -- DEB-2: solado pinado na VARIANTE sai como 'variant_sole' — também é
      -- tratado pelo débito por grade (senão debitaria 2×).
      IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
        CONTINUE;
      END IF;

      SELECT id, quantity, name INTO v_product
        FROM public.products WHERE id = v_pid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
      END IF;

      v_required := (v_item ->> 'required')::numeric;
      IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
        RAISE EXCEPTION
          'Estoque insuficiente para % "%": disponível %, necessário %',
          v_item ->> 'component', v_product.name, v_product.quantity, v_required;
      END IF;
    END LOOP;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
      IF p_force_soft THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'sole_deferred_to_grade_soft'
        );
        CONTINUE;
      END IF;

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object('kind', 'sole_pending_grade', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF p_force_soft OR v_mode = 'soft' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object(
                'kind', 'component',
                'component', v_item->>'component',
                'source', v_source,
                'color', p_color
              ));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    ELSE
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard',
              jsonb_build_object('kind', 'component', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result, 'force_soft', p_force_soft);
END;
$function$;

-- ----------------------------------------------------------------------------
-- RES-7 + DEB-7 — debit_sole_stock_by_grade: advisory lock + dedup de retry +
-- fallback de conjugação quando a chave conjugada não existe no stock_grade
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(p_reference_id uuid, p_order_id uuid, p_color text, p_order_grade jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_product_id uuid; target_name text; v_stock_grade jsonb; v_size text; v_size_qty numeric;
  v_available numeric; v_new_grade jsonb; v_total_debited numeric := 0; v_prev_total numeric;
  v_product_group_id uuid; v_effective_grade jsonb; v_conj_key text; v_existing_qty numeric;
  v_has_conjugations boolean; v_is_palmilha_pronta boolean := false; v_effective_color text;
  v_palmilha_color text; v_grade_total_units numeric := 0; v_input_grade jsonb; v_order_qty numeric;
  v_debit_size numeric; v_shortfall_total numeric := 0; v_debited_grade jsonb; v_shortfall_grade jsonb;
  v_resolved_product_id uuid; v_resolved_color text; v_res_id uuid;
  v_variant_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuario nao aprovado'; END IF;
  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN RETURN; END IF;

  -- RES-7 (auditoria 2026-07-19): serializa por OP e não debita 2× em retry —
  -- o débito hard de solado já registrado pra OP torna a chamada idempotente
  -- (o saldo de baixa parcial é reconciliado pela reserva de shortfall, não
  -- por re-execução desta função).
  PERFORM pg_advisory_xact_lock(hashtext('debit_sole:' || p_order_id::text));
  IF NOT p_force_soft AND EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
       AND description LIKE 'Debito Solado por grade%'
  ) THEN
    RETURN;
  END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = p_order_id;
  v_input_grade := public.scale_grade_to_total(p_order_grade, COALESCE(v_order_qty, 0));

  -- VARIANTE DO ITEM (2026-07-11): solado PINADO na variante de material do
  -- item do PV prevalece sobre a cascata de cor — paridade com o motor de
  -- consumo/reserva (source='variant_sole'). Derivada via sale_order_item_id;
  -- OP avulsa (sem PV) não tem variante e cai direto na cascata.
  SELECT soi.material_variant_id INTO v_variant_id
    FROM public.orders o
    JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.id = p_order_id;
  IF v_variant_id IS NOT NULL THEN
    SELECT rsv.product_id INTO v_resolved_product_id
      FROM public.resolve_sole_for_variant(v_variant_id) rsv
     LIMIT 1;
    IF v_resolved_product_id IS NOT NULL THEN
      SELECT p.color INTO v_resolved_color FROM public.products p WHERE p.id = v_resolved_product_id;
    END IF;
  END IF;

  -- Resolução canônica (cascata de cor) quando a variante não pina solado.
  -- Se não resolver, NÃO debita (nunca baixar cor/produto errado).
  IF v_resolved_product_id IS NULL THEN
    SELECT rsc.sole_product_id, rsc.sole_color
      INTO v_resolved_product_id, v_resolved_color
      FROM public.resolve_sole_color(p_reference_id, p_color) rsc
     LIMIT 1;
  END IF;
  IF v_resolved_product_id IS NULL THEN RETURN; END IF;

  SELECT p.id, p.name, p.stock_grade, p.group_id,
         (COALESCE(p.sole_classification::text, '') = 'palmilha_pronta')
    INTO target_product_id, target_name, v_stock_grade, v_product_group_id, v_is_palmilha_pronta
    FROM public.products p
   WHERE p.id = v_resolved_product_id AND p.active = true
   FOR UPDATE;
  IF target_product_id IS NULL THEN RETURN; END IF;

  v_effective_color := COALESCE(NULLIF(v_resolved_color, ''), p_color, '');
  IF v_is_palmilha_pronta THEN v_palmilha_color := NULLIF(v_effective_color, ''); END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;
  SELECT EXISTS (SELECT 1 FROM public.sole_size_conjugations WHERE sole_group_id = v_product_group_id) INTO v_has_conjugations;
  v_effective_grade := '{}'::jsonb;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_input_grade) WHERE value::numeric > 0 AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT public.get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE v_conj_key := v_size; END IF;
    -- DEB-7 (auditoria 2026-07-19): usar a chave conjugada SÓ se ela existir no
    -- stock_grade; senão cair na numeração individual quando ela existe
    -- (compatibilidade com estoque legado — recupera o fix da mig 20260426140000).
    IF v_conj_key <> v_size AND NOT (v_stock_grade ? v_conj_key) AND (v_stock_grade ? v_size) THEN
      v_conj_key := v_size;
    END IF;
    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    v_grade_total_units := v_grade_total_units + v_size_qty;
  END LOOP;

  IF p_force_soft THEN
    DELETE FROM public.material_reservations
     WHERE order_id = p_order_id AND status = 'reserved' AND (metadata ->> 'kind') IN ('sole_pending_grade', 'sole_grade');
    INSERT INTO public.material_reservations
      (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
    VALUES (p_order_id, target_product_id, v_grade_total_units, 0, 'reserved', 'soft',
      jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_effective_grade, 'color', p_color,
        'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
        'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name));
    RETURN;
  END IF;

  v_prev_total := 0;
  FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
  LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;
  v_new_grade := v_stock_grade; v_total_debited := 0; v_shortfall_total := 0;
  v_debited_grade := '{}'::jsonb; v_shortfall_grade := '{}'::jsonb;
  FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_debit_size := LEAST(v_available, v_size_qty);
    IF v_debit_size > 0 THEN
      v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_debit_size));
      v_total_debited := v_total_debited + v_debit_size;
      v_debited_grade := jsonb_set(v_debited_grade, ARRAY[v_size], to_jsonb(v_debit_size));
    END IF;
    IF (v_size_qty - v_debit_size) > 0 THEN
      v_shortfall_total := v_shortfall_total + (v_size_qty - v_debit_size);
      v_shortfall_grade := jsonb_set(v_shortfall_grade, ARRAY[v_size], to_jsonb(v_size_qty - v_debit_size));
    END IF;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
     WHERE id = target_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
      'Debito Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END || ' (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cabedal: ' || p_color ELSE '' END ||
        CASE WHEN v_is_palmilha_pronta AND v_palmilha_color IS NOT NULL THEN ' -> Palmilha: ' || v_palmilha_color ELSE '' END,
      p_order_id);

    SELECT mr.id INTO v_res_id
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id AND mr.product_id = target_product_id AND mr.status = 'reserved'
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('sole_grade', 'sole_pending_grade')
     ORDER BY (CASE WHEN mr.metadata ->> 'kind' = 'sole_grade' THEN 0 ELSE 1 END), mr.created_at, mr.id
     LIMIT 1
     FOR UPDATE;
    IF v_res_id IS NOT NULL THEN
      UPDATE public.material_reservations
         SET status = 'consumed', quantity_reserved = v_total_debited, quantity_consumed = v_total_debited, reservation_type = 'hard',
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{effective_grade}', v_debited_grade)
                        || jsonb_build_object('kind', 'sole_grade')
                        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = v_res_id;
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, target_product_id, v_total_debited, v_total_debited, 'consumed', 'hard',
        jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_debited_grade, 'color', p_color,
          'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
          'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name)
        || CASE WHEN v_shortfall_total > 0 THEN jsonb_build_object('partial_debit', true) ELSE '{}'::jsonb END);
    END IF;

    IF v_shortfall_total > 0 THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata, notes)
      VALUES (p_order_id, target_product_id, v_shortfall_total, 0, 'reserved', 'soft',
        jsonb_build_object('kind', 'sole_grade', 'effective_grade', v_shortfall_grade, 'color', p_color,
          'effective_color', v_effective_color, 'palmilha_color', v_palmilha_color,
          'is_palmilha_pronta', v_is_palmilha_pronta, 'target_name', target_name, 'partial_pending', true),
        '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
    END IF;
    PERFORM public.sync_product_reserved_stock(target_product_id);
  END IF;
END;
$function$;

-- ----------------------------------------------------------------------------
-- AUD-1 — tg_sync_orders_from_sale_order_item: falha de débito soft fica VISÍVEL
-- (material_status='erro_reserva' + aviso em orders.notes); warnings mantidos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sync_orders_from_sale_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      v_sale_order_id, NEW.id, 'Reservado',
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
            OR NEW.grade IS DISTINCT FROM OLD.grade)
    THEN
      UPDATE public.orders
         SET quantity = NEW.quantity,
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

    -- AUD-1 (auditoria 2026-07-19): falha nos débitos soft NÃO pode ser só
    -- RAISE WARNING (invisível) — OPs nasciam sem NENHUMA reserva e finalizavam
    -- sem débito (OP-2026-01125/26/27, 00890/91). Marca a OP de forma visível;
    -- a reserva manual (botão MRP/try_reserve) limpa o status.
    IF COALESCE(array_length(v_fail_msgs, 1), 0) > 0 THEN
      UPDATE public.orders
         SET material_status = 'erro_reserva',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '')
               || '⚠ Reserva automática FALHOU — rodar reserva manual (MRP). Detalhe: '
               || array_to_string(v_fail_msgs, ' | ')
       WHERE id = v_op_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ----------------------------------------------------------------------------
-- DEB-6 — tg_debit_service_order_base: movimento = débito REAL (clampado) +
-- idempotência por marcador [os:<id>] (order_number NULL não colide mais)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_debit_service_order_base()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_recipe      RECORD;
  v_group_id    uuid;
  v_base_color  text;
  v_product_id  uuid;
  v_product_qty numeric;
  v_required    numeric;
  v_debit       numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada') THEN
    RETURN NEW;
  END IF;
  -- Idempotência por OS (marcador [os:<id>]); formato legado com order_number
  -- ainda é honrado pra não re-debitar OS antigas. Antes: order_number NULL
  -- virava '?' e UMA OS sem número bloqueava o débito de TODAS as seguintes.
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE movement_type = 'out'
       AND (description LIKE '%[os:' || NEW.id || ']%'
            OR (NEW.order_number IS NOT NULL
                AND description LIKE 'OS Artesanal ' || NEW.order_number || ' — base%'))
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
  IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
    RETURN NEW;
  END IF;

  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;
  v_base_color := COALESCE(NULLIF(trim(NEW.artisanal_base_color), ''), NEW.artisanal_output_color, '');

  SELECT id INTO v_group_id
    FROM public.product_groups
   WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(v_recipe.base_product_name)))
   LIMIT 1;

  SELECT p.id, p.quantity INTO v_product_id, v_product_qty
    FROM public.products p
   WHERE p.active = true
     AND (p.group_id = v_group_id
          OR lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name))))
     AND (v_base_color = ''
          OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(v_base_color))))
   ORDER BY (p.group_id = v_group_id) DESC NULLS LAST, p.quantity DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'OS %: base "%" na cor "%" não encontrada — não debitando (cadastre a NAPA nessa cor).',
      NEW.order_number, v_recipe.base_product_name, v_base_color;
    RETURN NEW;
  END IF;

  -- DEB-6 (auditoria 2026-07-19): debita e REGISTRA o valor clampado — antes o
  -- movimento saía com a quantidade CHEIA enquanto o estoque caía só até zero
  -- (ledger inconsistente com products.quantity).
  v_debit := LEAST(v_required, GREATEST(0, COALESCE(v_product_qty, 0)));

  IF v_product_qty < v_required THEN
    RAISE WARNING 'OS %: estoque insuficiente de "%" (%) — disponível %, necessário % (debitando %)',
      NEW.order_number, v_recipe.base_product_name, v_base_color, v_product_qty, v_required, v_debit;
  END IF;

  IF v_debit <= 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
     SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
   WHERE id = v_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    v_product_id, 'out', v_debit, v_product_qty, GREATEST(0, v_product_qty - v_debit),
    'OS Artesanal ' || COALESCE(NEW.order_number, '?') ||
      ' — base "' || v_recipe.base_product_name || '"' ||
      CASE WHEN v_base_color <> '' THEN ' (' || v_base_color || ')' ELSE '' END ||
      CASE WHEN v_debit < v_required THEN ' (parcial ' || round(v_debit, 2) || ' de ' || round(v_required, 2) || ')' ELSE '' END ||
      ' [os:' || NEW.id || ']',
    NULL
  );
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- RES-3 — rename: release de reservas deve rodar DEPOIS do record de consumo
-- no mesmo UPDATE (ordem alfabética de triggers). 'trg_a...' < 'trg_record...'
-- matava o aviso "reservas ainda em aberto" (sempre 0). Com 'trg_zz...', o
-- record enxerga as reservas ainda vivas e o aviso volta a funcionar.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_auto_release_reservations_on_op_cancel'
       AND tgrelid = 'public.orders'::regclass AND NOT tgisinternal
  ) THEN
    ALTER TRIGGER trg_auto_release_reservations_on_op_cancel ON public.orders
      RENAME TO trg_zz_release_reservations_on_op_cancel;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Trava de regressão — run_debit_guard_tests() (exposta em /diagnostics; wrapper
-- vitest com RUN_DB_INTEGRATION). Introspecção das definições VIVAS + casos
-- puros do resolve_effective_op_grade. Padrão auto-derivado: se alguém recriar
-- uma função sem o fix, o caso correspondente falha.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_debit_guard_tests()
RETURNS TABLE (case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_def text;
  v_grade jsonb;
  v_sum numeric;
BEGIN
  -- G1: grade base é escalada pro total
  v_grade := public.resolve_effective_op_grade('{"35":6,"36":6}'::jsonb, 360);
  SELECT COALESCE(sum(value::numeric), 0) INTO v_sum FROM jsonb_each_text(v_grade);
  RETURN QUERY SELECT 'G1 resolve_effective_op_grade escala grade base pro total'::text,
    (v_sum = 360), 'soma=' || v_sum::text;

  -- G2: grade inválida/vazia → NULL (caminho escalar)
  RETURN QUERY SELECT 'G2 resolve_effective_op_grade rejeita grade vazia/inválida'::text,
    (public.resolve_effective_op_grade('{}'::jsonb, 360) IS NULL
     AND public.resolve_effective_op_grade(NULL, 360) IS NULL
     AND public.resolve_effective_op_grade('{"x":"1"}'::jsonb, 360) IS NULL), NULL::text;

  -- G3: record_order_consumption usa a grade efetiva
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_order_consumption';
  RETURN QUERY SELECT 'G3 record_order_consumption escala grade base (DEB-3)'::text,
    (v_def LIKE '%resolve_effective_op_grade%'), NULL::text;

  -- G4: convert_reservation_to_out com ledger honesto no ramo componente
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'convert_reservation_to_out';
  RETURN QUERY SELECT 'G4 convert_reservation_to_out: consumed = debitado real (DEB-1)'::text,
    (v_def NOT LIKE '%quantity_consumed = COALESCE(quantity_reserved%'
     AND v_def LIKE '%Componente sem estoque na conversão%'), NULL::text;

  -- G5: hybrid_debit adia solado da variante (variant_sole)
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'hybrid_debit_stock_for_order';
  RETURN QUERY SELECT 'G5 hybrid_debit adia variant_sole pro débito por grade (DEB-2)'::text,
    (v_def LIKE '%variant_sole%'), NULL::text;

  -- G6: debit_sole com lock + dedup de retry
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'debit_sole_stock_by_grade';
  RETURN QUERY SELECT 'G6 debit_sole: advisory lock + idempotência de retry (RES-7)'::text,
    (v_def LIKE '%debit_sole:%' AND v_def LIKE '%Debito Solado por grade!%%' ESCAPE '!'), NULL::text;

  -- G7: falha de reserva automática fica visível na OP
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_sync_orders_from_sale_order_item';
  RETURN QUERY SELECT 'G7 tg_sync_item: falha de reserva vira erro_reserva visível (AUD-1)'::text,
    (v_def LIKE '%erro_reserva%'), NULL::text;

  -- G8: OS artesanal com movimento clampado + marcador
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_debit_service_order_base';
  RETURN QUERY SELECT 'G8 tg_debit_service_order_base: débito clampado + [os:id] (DEB-6)'::text,
    (v_def LIKE '%[os:%'), NULL::text;

  -- G9: release roda DEPOIS do record (rename aplicado)
  RETURN QUERY SELECT 'G9 release de reservas roda após record_order_consumption (RES-3)'::text,
    (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_release_reservations_on_op_cancel' AND tgrelid = 'public.orders'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auto_release_reservations_on_op_cancel' AND tgrelid = 'public.orders'::regclass)), NULL::text;

  -- G10: relatório vivo existe
  RETURN QUERY SELECT 'G10 debit_consistency_report() existe (R8 da spec)'::text,
    (EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'debit_consistency_report')), NULL::text;
END;
$$;

COMMENT ON FUNCTION public.run_debit_guard_tests() IS
  'Trava de regressão dos fixes da auditoria débito ficha×grade (specs/auditoria-debito-ficha-grade.md). Rodar em /diagnostics.';
