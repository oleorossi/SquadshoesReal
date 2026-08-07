-- ============================================================================
-- FINALIZAR A OP DEBITA O QUE TEM — parar de cancelar a reserva e apagar a dívida
-- ============================================================================
--
-- O QUE ESTAVA ACONTECENDO (auditoria 07/08/2026):
--
-- `calculate_order_consumption_by_grade` marca cabedal, forração, palmilha,
-- forração de palmilha, fachete e a maior parte do BOM como `debit_mode='soft'`
-- — ou seja, `hybrid_debit_stock_for_order` só cria `material_reservations`, não
-- mexe em `products.quantity`. A baixa real dependia de alguém rodar o picking
-- (`consume_all_reservations_for_order`) ANTES de finalizar.
--
-- E `tg_release_reservations_on_order_terminal` fazia o oposto: ao entrar em
-- `Finalizado`, TODA reserva ainda em `reserved` virava `cancelled`
-- ("auto-liberada"), sem gerar `stock_movements`. O material saía da fábrica e
-- voltava para o estoque contábil.
--
--   188 OPs Finalizado → 810 reservas canceladas contra 71 consumidas.
--   `list_stock_debit_holes(400)`: 1.191 linhas em 187 OPs,
--   ~223.222 unidades, R$ 226.858 com actual_quantity = 0.
--
-- O sistema já sabia: `record_order_consumption` grava a nota
-- "sem débito registrado (possível furo de baixa)" e `trg_zzz_flag_stock_debit_holes`
-- roda por último justamente pra sinalizar. Sinalizava e seguia.
--
-- DECISÃO DO DONO (07/08/2026): finalizar passa a DEBITAR o que houver em
-- estoque; o saldo que faltar vira pendência VISÍVEL em vez de sumir. Nunca
-- trava a finalização.
--
-- POR QUE NÃO REUSAR `consume_all_reservations_for_order`: ela dá
-- RAISE EXCEPTION quando falta estoque de um componente. Chamada de um trigger
-- de finalização, um cadastro divergente impediria a OP de fechar — travaria o
-- chão de fábrica. Esta função é a variante TOLERANTE: debita LEAST(disponível,
-- reservado) e preserva o resto. É o mesmo padrão que o SOLADO já usava.
--
-- HISTÓRICO: decisão do dono é NÃO tocar nas 187 OPs já finalizadas. Debitar
-- 223 mil unidades retroativas jogaria vários materiais a zero de uma vez e
-- desmentiria inventários já conferidos. Elas seguem visíveis em
-- `list_stock_debit_holes()`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_open_reservations_for_order(
  p_order_id uuid,
  p_reason   text DEFAULT 'finalizacao'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_kind text; v_size text; v_size_qty numeric;
  v_available numeric; v_prev_qty numeric; v_target_name text;
  v_stock_grade jsonb; v_new_grade jsonb; v_prev_total numeric;
  v_effective_grade jsonb; v_debited_grade jsonb; v_shortfall_grade jsonb;
  v_debit numeric; v_total_debited numeric; v_shortfall numeric;
  v_synced uuid[] := '{}';
  v_debited_count integer := 0;
  v_pending_count integer := 0;
  v_pending_qty numeric := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('settle_reservations:' || p_order_id::text));

  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status IN ('reserved', 'partially_consumed')
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    -- ── Solado por grade: baixa por NUMERAÇÃO, nunca pelo total ────────────
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation', updated_at = now(),
               notes = COALESCE(NULLIF(notes,''),'')
                 || ' [pendente: reserva de solado sem grade efetiva — ' || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty + COALESCE(v_res.quantity_reserved, 0);
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      v_stock_grade := COALESCE(v_stock_grade, '{}'::jsonb);

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      v_new_grade := v_stock_grade; v_total_debited := 0; v_shortfall := 0;
      v_debited_grade := '{}'::jsonb; v_shortfall_grade := '{}'::jsonb;

      FOR v_size, v_size_qty IN
        SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_debit := LEAST(v_available, v_size_qty);
        IF v_debit > 0 THEN
          v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_debit));
          v_total_debited := v_total_debited + v_debit;
          v_debited_grade := jsonb_set(v_debited_grade, ARRAY[v_size], to_jsonb(v_debit));
        END IF;
        IF (v_size_qty - v_debit) > 0 THEN
          v_shortfall := v_shortfall + (v_size_qty - v_debit);
          v_shortfall_grade := jsonb_set(v_shortfall_grade, ARRAY[v_size], to_jsonb(v_size_qty - v_debit));
        END IF;
      END LOOP;

      IF v_total_debited > 0 THEN
        UPDATE public.products
           SET stock_grade = v_new_grade,
               quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
         WHERE id = v_res.product_id;

        INSERT INTO public.stock_movements
          (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
          'Baixa na finalização — Solado por grade'
            || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END
            || ' (' || COALESCE(v_target_name,'') || ')', p_order_id);

        UPDATE public.material_reservations
           SET status = 'consumed', reservation_type = 'hard',
               quantity_reserved = v_total_debited, quantity_consumed = v_total_debited,
               consumed_at = now(), updated_at = now(),
               metadata = jsonb_set(metadata, '{effective_grade}', v_debited_grade)
                          || jsonb_build_object('settled_on', p_reason)
         WHERE id = v_res.id;
        v_debited_count := v_debited_count + 1;

        IF v_shortfall > 0 THEN
          INSERT INTO public.material_reservations
            (order_id, product_id, quantity_reserved, quantity_consumed, status,
             reservation_type, source, metadata, notes)
          VALUES (v_res.order_id, v_res.product_id, v_shortfall, 0, 'pending_reconciliation',
            COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
            jsonb_set(v_res.metadata, '{effective_grade}', v_shortfall_grade)
              || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
            '⚠ Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque');
          v_pending_count := v_pending_count + 1;
          v_pending_qty := v_pending_qty + v_shortfall;
        END IF;
      ELSE
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation', updated_at = now(),
               metadata = metadata || jsonb_build_object('partial_pending', true),
               notes = COALESCE(NULLIF(notes,''),'')
                 || ' [pendente: sem estoque do solado na finalização — ' || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty + COALESCE(v_res.quantity_reserved, 0);
      END IF;

      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;

    -- ── Reserva-fantasma de solado: some sem virar dívida ──────────────────
    ELSIF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes,''),'') || ' [auto-cancelled: orphan sole_pending_grade]'
       WHERE id = v_res.id;

    -- ── Demais componentes: LEAST(disponível, reservado) ───────────────────
    ELSE
      SELECT quantity, name INTO v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;

      IF NOT FOUND THEN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation', updated_at = now(),
               notes = COALESCE(NULLIF(notes,''),'') || ' [pendente: produto não encontrado]'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        CONTINUE;
      END IF;

      v_debit := LEAST(GREATEST(COALESCE(v_prev_qty, 0), 0), COALESCE(v_res.quantity_reserved, 0));
      v_shortfall := COALESCE(v_res.quantity_reserved, 0) - v_debit;

      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
         WHERE id = v_res.product_id;

        INSERT INTO public.stock_movements
          (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
          'Baixa na finalização — ' || COALESCE(v_res.metadata ->> 'component', 'Material')
            || ' (' || COALESCE(v_target_name,'') || ')'
            || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END, p_order_id);

        UPDATE public.material_reservations
           SET status = 'consumed', reservation_type = 'hard',
               quantity_reserved = v_debit, quantity_consumed = v_debit,
               consumed_at = now(), updated_at = now(),
               metadata = metadata || jsonb_build_object('settled_on', p_reason)
         WHERE id = v_res.id;
        v_debited_count := v_debited_count + 1;

        IF v_shortfall > 0 THEN
          INSERT INTO public.material_reservations
            (order_id, product_id, quantity_reserved, quantity_consumed, status,
             reservation_type, source, metadata, notes)
          VALUES (v_res.order_id, v_res.product_id, v_shortfall, 0, 'pending_reconciliation',
            COALESCE(v_res.reservation_type, 'soft'), COALESCE(v_res.source, 'onhand'),
            COALESCE(v_res.metadata, '{}'::jsonb)
              || jsonb_build_object('partial_pending', true, 'partial_of', v_res.id::text),
            '⚠ Saldo de baixa parcial (estoque insuficiente na finalização) — reconciliar ao repor');
          v_pending_count := v_pending_count + 1;
          v_pending_qty := v_pending_qty + v_shortfall;
        END IF;
      ELSE
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation', updated_at = now(),
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('partial_pending', true),
               notes = COALESCE(NULLIF(notes,''),'')
                 || ' [pendente: estoque zerado na finalização — ' || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty + COALESCE(v_res.quantity_reserved, 0);
      END IF;

      IF NOT (v_res.product_id = ANY(v_synced)) THEN v_synced := v_synced || v_res.product_id; END IF;
    END IF;
  END LOOP;

  PERFORM public.sync_product_reserved_stock(pid) FROM unnest(v_synced) AS pid;

  IF v_pending_count > 0 THEN
    PERFORM public.record_op_reserve_failure_alert(
      p_order_id,
      v_pending_count || ' material(is) sem estoque na finalização — '
        || round(v_pending_qty, 2) || ' em unidades ficaram como pendência de baixa',
      'baixa_pendente', 'warning');
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id, 'debited', v_debited_count,
    'pending', v_pending_count, 'pending_qty', v_pending_qty);
END;
$function$;

-- SECURITY DEFINER sem checagem de papel: só o trigger (que roda como owner)
-- deve chamar. O Postgres concede EXECUTE a PUBLIC por padrão — revogar.
REVOKE ALL ON FUNCTION public.settle_open_reservations_for_order(uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.settle_open_reservations_for_order(uuid, text) IS
  'Variante TOLERANTE de consume_all_reservations_for_order: debita LEAST(disponível, reservado), '
  'nunca lança exceção por falta de estoque e transforma o saldo em pending_reconciliation. '
  'Chamada pelo trigger de finalização — antes, a finalização cancelava a reserva sem debitar nada.';

-- ── O gatilho ──────────────────────────────────────────────────────────────
-- ⚠ O NOME importa: triggers do mesmo evento disparam em ordem ALFABÉTICA.
-- `trg_aa_...` tem que vir ANTES de `trg_record_consumption_on_finalize`, senão
-- `production_consumptions.actual_quantity` é calculado antes dos
-- stock_movements existirem e o relatório de furos continuaria acusando 0.
-- Ordem resultante: ... trg_aa_settle → trg_close_stages → trg_record_consumption
--                   → trg_release_reservations → trg_zzz_flag_stock_debit_holes.
CREATE OR REPLACE FUNCTION public.tg_settle_reservations_on_op_finalize()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    PERFORM public.settle_open_reservations_for_order(NEW.id, 'finalizacao_op');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aa_settle_reservations_on_finalize ON public.orders;
CREATE TRIGGER trg_aa_settle_reservations_on_finalize
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_settle_reservations_on_op_finalize();

-- `tg_release_reservations_on_order_terminal` continua no lugar e não muda:
-- numa OP FINALIZADA ele não encontra mais nada em `reserved` (o settle já
-- resolveu tudo em consumed/pending_reconciliation), e numa OP CANCELADA ele
-- segue liberando a reserva — que ali é o comportamento certo, porque nada foi
-- produzido e o material não saiu.
