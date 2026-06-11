-- =============================================================================
-- FIX — Reservas pré-produção: fechar o buraco do item-sync + aposentar o
--        auto-refresh morto do cron
-- =============================================================================
-- Contexto (investigação 2026-06-11): o cron 'auto-refresh-reservations' →
--   process_outdated_reservations → refresh_order_reservations NUNCA funcionou:
--   refresh chama release_order_reservations / try_reserve_materials, ambas
--   guardadas por is_approved_user() (= profiles.approved p/ auth.uid()). No
--   cron auth.uid() é NULL → permission denied 100% das vezes; o erro é engolido
--   e o job aparece "succeeded". As reservas reais são criadas/mantidas pelo
--   fluxo de usuário aprovado (aprovação/produção via tg_sale_order_creates_ops
--   _on_production, edição de PV via update_sale_order_atomic, resync de ficha).
--
-- BURACO REAL: tg_sync_orders_from_sale_order_item (item adicionado/editado num
--   PV já 'Em Produção', fora do update_sale_order_atomic) CRIAVA/ATUALIZAVA a OP
--   mas NÃO reservava — gerando OPs órfãs de reserva (ex.: PV-2026-00067, 6 OPs
--   "Auto-criada por alteração em PV" com 0 reservas).
--
-- Decisão (confirmada com o usuário): (b) aposentar o auto-refresh + FECHAR o
--   buraco na origem; NÃO abrir o guard is_approved_user.
--
-- ─── PARTE 1 — Fechar o buraco: o item-sync passa a RESERVAR ──────────────────
-- Espelha EXATAMENTE o bloco de reserva do gatilho de aprovação
-- (tg_sale_order_creates_ops_on_production): hybrid_debit + sole + strap +
-- packaging, todos p_force_soft, cada um em BEGIN/EXCEPTION WHEN OTHERS (uma
-- falha de reserva não quebra a edição do item). Roda no contexto do usuário
-- aprovado que editou o item (is_approved_user passa).
-- Segurança: nenhuma dessas funções cria purchase_orders nem debita
--   products.quantity (só cria reservas 'soft'); reserved_stock é derivado
--   (idempotente). Nenhuma delas ESCREVE em sale_order_items → sem recursão.
-- Idempotência: hybrid_debit pula se já há reserva não-cancelada (por order_id).
--   No UPDATE com mudança de qty/cor/grade, libera (release) e re-reserva.
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
  v_packaging_mode text;
  v_grade jsonb;
  v_do_reserve boolean := false;
  v_release_first boolean := false;
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- O2: suprimido durante update_sale_order_atomic (front recria OPs completas)
  IF current_setting('app.suppress_item_op_sync', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status, COALESCE(packaging_mode, 'individual_amarrado')
    INTO v_so_status, v_packaging_mode
    FROM public.sale_orders WHERE id = v_sale_order_id;
  IF v_so_status <> 'Em Produção' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    -- Dedupe: não criar segunda OP pro mesmo item
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
      -- O3: grade ESCALADA (convenção do front: soma(grade) == quantity)
      public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
      v_sale_order_id, NEW.id, 'Reservado',
      'Auto-criada por alteração em PV (item adicionado)'
    )
    RETURNING id INTO v_op_id;
    v_do_reserve := true;
    v_release_first := false;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id INTO v_op_id
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
      v_do_reserve := true;
      -- qty/cor/grade mudaram → a reserva antiga é stale; libera e re-reserva.
      v_release_first := true;
    END IF;
  END IF;

  -- ── Reserva (espelha o gatilho de aprovação) ──────────────────────────────
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
      END;
    END IF;

    -- 1. Materiais BOM
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
    END;

    -- 2. Solado por grade
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
      END;
    END IF;

    -- 3. Tiras
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
      END;
    END IF;

    -- 4. Embalagem
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
    END;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;


-- ─── PARTE 2 — Aposentar o auto-refresh morto do cron ────────────────────────
-- process_outdated_reservations deixa de TENTAR refresh (sempre permission-denied
-- sob cron, era dead code) e vira só HOUSEKEEPING do flag do badge: varre as OPs
-- "loop-elegíveis" (PV pré-prod + sem snapshot + OP Pendente/Reservado) e limpa
-- reservations_outdated_at por VISITA (batch-safe via LIMIT). A re-reserva real é
-- feita pelo fluxo de usuário aprovado (incl. agora o item-sync, Parte 1).
CREATE OR REPLACE FUNCTION public.process_outdated_reservations(p_max_orders integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_visited_ops uuid[] := ARRAY[]::uuid[];
  v_cleared int := 0;
  v_started_at timestamptz := now();
BEGIN
  -- Enumera (batch) as OPs loop-elegíveis pra varredura.
  SELECT COALESCE(array_agg(elig.order_id), ARRAY[]::uuid[])
    INTO v_visited_ops
  FROM (
    SELECT o.id AS order_id
      FROM public.orders o
      JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE so.reservations_outdated_at IS NOT NULL
       AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
       AND o.status IN ('Pendente', 'Reservado')
       AND NOT EXISTS (
         SELECT 1 FROM public.technical_sheet_snapshots
          WHERE sale_order_id = so.id
       )
     ORDER BY so.reservations_outdated_at ASC
     LIMIT p_max_orders
  ) elig;

  -- Limpa o flag de PVs sem nenhuma OP loop-elegível pendente de visita
  -- (terminal/snapshot → vacuamente limpa; pré-prod sem snapshot → limpa quando
  -- toda OP reservável foi varrida neste run).
  WITH cleared AS (
    UPDATE public.sale_orders so
       SET reservations_outdated_at = NULL
     WHERE so.reservations_outdated_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.sale_order_id = so.id
            AND o.status IN ('Pendente', 'Reservado')
            AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
            AND NOT EXISTS (
              SELECT 1 FROM public.technical_sheet_snapshots tss
               WHERE tss.sale_order_id = so.id
            )
            AND o.id <> ALL (v_visited_ops)
       )
    RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM cleared;

  RETURN jsonb_build_object(
    'cleared_flags', v_cleared,
    'swept_ops', COALESCE(array_length(v_visited_ops, 1), 0),
    'note', 'auto-refresh aposentado (era dead code permission-denied); só housekeeping do flag',
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$function$;
