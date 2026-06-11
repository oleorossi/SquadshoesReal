-- =============================================================================
-- REFINO — item-sync reserve (achados da auditoria pós-fix 2026-06-11)
-- =============================================================================
-- A migration 20260611132747 fez tg_sync_orders_from_sale_order_item reservar.
-- A auditoria adversarial achou 2 refinamentos (nenhum dano observado ainda):
--
-- #1 BURACO RESIDUAL (Aprovado + add item fora do form): o gatilho só agia em
--    status='Em Produção'. Item adicionado a um PV 'Aprovado' por caminho que
--    NÃO passe por update_sale_order_atomic ficava sem OP/reserva até a
--    transição pra produção. Fix: o gatilho passa a agir também em 'Aprovado'
--    (simétrico ao gatilho de aprovação, que cria OPs já em 'Aprovado').
--
-- #3 ASSIMETRIA (UPDATE re-reservava OP em produção): o branch UPDATE chamava
--    release_order_reservations + re-reserva pra QUALQUER OP ativa, inclusive
--    'Em Produção' — sem o guard op_in_production que refresh_order_reservations
--    tem de propósito. Editar a qty de um item cuja OP já está em produção
--    estornaria/refaria as reservas dela. Fix: o re-reserva do branch UPDATE só
--    roda quando a OP ainda é PRÉ-PRODUÇÃO (Pendente/Reservado/Rascunho); OP em
--    produção continua tendo a qty atualizada (comportamento pré-existente) mas
--    NÃO tem as reservas mexidas.
--
-- (#2 da auditoria — ~15 OPs históricas sem reserva em 4 PVs — é backlog de
--  dado fora do escopo escolhido; reparado só 67/92/93 a pedido do usuário.)
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
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF current_setting('app.suppress_item_op_sync', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status, COALESCE(packaging_mode, 'individual_amarrado')
    INTO v_so_status, v_packaging_mode
    FROM public.sale_orders WHERE id = v_sale_order_id;
  -- #1: age em PV pré/produção acionável (antes só 'Em Produção').
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
    v_do_reserve := true;        -- OP nova é sempre 'Reservado' (pré-produção)
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
      -- #3: só re-reserva se a OP ainda é PRÉ-PRODUÇÃO. OP em produção tem a qty
      -- atualizada mas as reservas NÃO são mexidas (espelha o guard
      -- op_in_production de refresh_order_reservations).
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
    END;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
