-- ============================================================================
-- M20 lado SQL (auditoria 2026-07-28) — listas-default de criação de etapas
-- ainda geravam etapa 'Costura' legada.
--
-- Para ficha sem production_sectors, resync_op_atomic e
-- tg_sync_orders_from_sale_order_item (vivas = 20260925133000) criavam
-- order_stages a partir de um ARRAY default com 'Costura' — setor que a
-- 20261001120000 deletou de sector_settings. A etapa órfã nunca era agendada
-- (INNER JOIN do recompute descarta), virava coluna extra no Kanban
-- (flow_order 999) e o fn_guard da Colagem (que exige as duas costuras novas)
-- pulava o pré-requisito em silêncio.
--
-- Fix (diff mínimo sobre as definições vivas): os defaults passam a gerar
-- 'Costura Palmilha' e 'Costura Cabedal' na ordem canônica
-- (canonical_stage_order). O default frontend (useOrders.ts) é corrigido em
-- pacote separado. Idempotente (CREATE OR REPLACE).
-- ============================================================================

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
          -- M20: 'Costura' não existe mais em sector_settings (split
          -- 20261001120000) — o default gera as duas costuras na ordem canônica.
          ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
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
  -- M20: 'Costura' não existe mais em sector_settings (split 20261001120000)
  -- — o default gera as duas costuras na ordem canônica.
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
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
