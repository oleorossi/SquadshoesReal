-- =============================================================================
-- tg_sale_order_creates_ops_on_production: passa a chamar débitos SOFT
-- =============================================================================
-- Descoberto na auditoria de estoque (24/05/2026):
--
-- 185 de 222 OPs nos últimos 90 dias estavam sem nenhum débito de estoque
-- (15.120 pares "produzidos no ar"). Causa: a trigger criava OPs ao mover
-- PV pra Aprovado/Em Produção mas NÃO chamava as 4 RPCs de débito
-- (hybrid/sole/strap/packaging). Hook useSaleOrders.ts:1278+ faz isso
-- corretamente, mas só em alguns caminhos da UI — a maioria dos PVs caía
-- na trigger silenciosa.
--
-- Fix: após criar a OP, dispara as 4 RPCs com p_force_soft=true.
-- Soft = cria reservas em material_reservations sem mexer no estoque
-- físico. Quando o operador efetivar produção (via UI), as reservas viram
-- consumed (ou re-debit hard).
--
-- Cada chamada de débito é envelopada em EXCEPTION pra não bloquear a
-- criação da OP por falha em uma das RPCs. Falhas logam WARNING.
--
-- Só dispara débito quando a OP foi RECÉM-CRIADA (v_was_created=true) —
-- evita duplicar reserva em transições Aprovado→Em Produção sobre OP que
-- já existe.
--
-- NÃO faz backfill das 185 OPs antigas — usuário escolheu fix arquitetural
-- só. Backfill fica como ação manual caso seja necessário.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_ops_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_op_id uuid;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_target_op_status text;
  v_grade jsonb;
  v_strap_colors jsonb;
  v_packaging_mode text;
  v_was_created boolean;
BEGIN
  IF NEW.status = 'Aprovado' THEN
    v_target_op_status := 'Reservado';
  ELSIF NEW.status = 'Em Produção' THEN
    v_target_op_status := 'Em Produção';
  ELSE
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_packaging_mode := COALESCE(NEW.packaging_mode, 'individual_amarrado');

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation, strap_colors
      FROM public.sale_order_items
     WHERE sale_order_id = NEW.id
  LOOP
    SELECT id INTO v_op_id
      FROM public.orders
     WHERE sale_order_item_id = v_item.id LIMIT 1;

    v_was_created := false;

    IF v_op_id IS NULL THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        NEW.id, v_item.id,
        CASE v_target_op_status
          WHEN 'Reservado' THEN 'OP criada automaticamente ao aprovar PV'
          ELSE 'OP criada automaticamente ao mover PV pra Em Produção'
        END,
        v_target_op_status,
        v_item.observation,
        NEW.delivery_deadline
      ) RETURNING id INTO v_op_id;
      v_was_created := true;
    ELSIF v_target_op_status = 'Em Produção' THEN
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.order_stages WHERE order_id = v_op_id) THEN
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name,
          public.canonical_stage_order(v_stage_name),
          'pendente',
          v_item.quantity, 0
        );
      END LOOP;
    END IF;

    IF v_was_created THEN
      v_grade := CASE
        WHEN v_item.grade IS NOT NULL AND v_item.grade <> '{}'::jsonb
        THEN v_item.grade
        ELSE NULL
      END;
      v_strap_colors := v_item.strap_colors;

      BEGIN
        PERFORM public.hybrid_debit_stock_for_order(
          p_reference_id  => v_item.reference_id,
          p_order_quantity => v_item.quantity::numeric,
          p_color         => COALESCE(v_item.color, ''),
          p_order_id      => v_op_id,
          p_order_grade   => v_grade,
          p_force_soft    => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_creates_ops] hybrid_debit falhou pra OP %: %', v_op_id, SQLERRM;
      END;

      IF v_grade IS NOT NULL THEN
        BEGIN
          PERFORM public.debit_sole_stock_by_grade(
            p_reference_id => v_item.reference_id,
            p_order_id     => v_op_id,
            p_color        => COALESCE(v_item.color, ''),
            p_order_grade  => v_grade,
            p_force_soft   => true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[tg_creates_ops] debit_sole falhou pra OP %: %', v_op_id, SQLERRM;
        END;
      END IF;

      IF v_strap_colors IS NOT NULL
         AND jsonb_typeof(v_strap_colors) = 'array'
         AND jsonb_array_length(v_strap_colors) > 0 THEN
        BEGIN
          PERFORM public.debit_strap_stock(
            p_strap_colors  => v_strap_colors,
            p_order_quantity => v_item.quantity,
            p_order_id      => v_op_id,
            p_order_grade   => v_grade,
            p_force_soft    => true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[tg_creates_ops] debit_strap falhou pra OP %: %', v_op_id, SQLERRM;
        END;
      END IF;

      BEGIN
        PERFORM public.debit_packaging_for_order(
          p_sale_order_id  => NEW.id,
          p_order_id       => v_op_id,
          p_reference_id   => v_item.reference_id,
          p_order_quantity => v_item.quantity,
          p_packaging_mode => v_packaging_mode,
          p_force_soft     => true
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[tg_creates_ops] debit_packaging falhou pra OP %: %', v_op_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
