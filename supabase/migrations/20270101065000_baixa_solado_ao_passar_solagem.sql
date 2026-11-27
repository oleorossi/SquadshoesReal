-- Baixa o solado ao passar/concluir o setor de Solagem (apontamento com
-- quantidade, finalização do setor, avanço no Kanban que pula a Solagem, ou
-- aumento de quantity_processed). Idempotente com o faturamento.
--
-- Por que não disparava (medido em 27/11/2026):
--   trg_debit_sole_on_solagem_pointing só age em INSERT de production_pointings
--   com quantity > 0. Desde 16/10 (quando o gatilho entrou), 28 Solagens foram
--   concluídas (7.248 pares) e NENHUMA teve pointing com qty > 0.
--   No Kanban, avançar para um setor posterior chama o command com
--   p_skip_stage_names e fecha a Solagem com qty 0 ("Setor pulado…"); o
--   gatilho ignora. O restante ficou pendente até o faturamento, quando
--   tg_close_stages_on_op_finalize preenche quantity_processed e
--   convert_reservation_to_out faz a baixa.
--
-- Regra nova (daqui pra frente, SEM backfill / SEM débito retroativo):
--   1) quantity_processed da Solagem sobe → baixa até esse acumulado.
--   2) Apontamento Solagem com qty > 0 → mesma função (idempotente).
--   3) Kanban pula a Solagem no mesmo apontamento → baixa a quantidade da
--      origem (os pares que acabaram de "passar" pela Solagem).
--   4) Faturamento/finalização da OP continua como fallback: só toca
--      reservas ainda 'reserved'.
--   5) Pulo com qty 0 isolado (sem origem) não baixa; o faturamento cobre.
--   6) stock_movements passa a gravar previous_grade / new_grade.

-- ---------------------------------------------------------------------------
-- 1. Quanto já foi baixado de solado nesta OP (reservas convertidas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sole_grade_already_debited_pairs(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(mr.quantity_consumed), 0)
    FROM public.material_reservations mr
   WHERE mr.order_id = p_order_id
     AND mr.status = 'converted'
     AND COALESCE(mr.metadata->>'kind', '') = 'sole_grade';
$function$;

COMMENT ON FUNCTION public.sole_grade_already_debited_pairs(uuid) IS
  'Pares de solado já baixados (reservas sole_grade converted) nesta OP. Usado para tornar a baixa na Solagem idempotente com apontamento parcial e com o faturamento.';

REVOKE ALL ON FUNCTION public.sole_grade_already_debited_pairs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_grade_already_debited_pairs(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Baixa até um acumulado-alvo (nunca rebaixa o que já saiu)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_sole_grade_up_to(
  p_order_id uuid,
  p_target_pairs numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_already numeric;
  v_take numeric;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL OR COALESCE(p_target_pairs, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'target_pairs', p_target_pairs,
      'already_debited', 0,
      'requested_pairs', 0,
      'skipped', true
    );
  END IF;

  v_already := public.sole_grade_already_debited_pairs(p_order_id);
  v_take := GREATEST(0, p_target_pairs - v_already);
  IF v_take <= 0 THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'target_pairs', p_target_pairs,
      'already_debited', v_already,
      'requested_pairs', 0,
      'skipped', true
    );
  END IF;

  v_result := public.debit_sole_grade_for_solagem_pointing(
    p_order_id,
    CEIL(v_take)::integer
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'target_pairs', p_target_pairs,
    'already_debited_before', v_already
  );
END;
$function$;

COMMENT ON FUNCTION public.debit_sole_grade_up_to(uuid, numeric) IS
  'Baixa solado reserved por numeração até o acumulado p_target_pairs desta OP. Idempotente: desconta o que já foi convertido (apontamento parcial, pulo no Kanban ou faturamento).';

REVOKE ALL ON FUNCTION public.debit_sole_grade_up_to(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debit_sole_grade_up_to(uuid, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Gravar previous_grade / new_grade no movimento da baixa Solagem
-- ---------------------------------------------------------------------------
DO $patch_mov$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'debit_sole_grade_for_solagem_pointing'
     AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid, p_quantity integer';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'debit_sole_grade_for_solagem_pointing(uuid, integer) não encontrada';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF v_def LIKE '%previous_grade, new_grade%' THEN
    RAISE NOTICE 'previous_grade/new_grade já estão no movimento da baixa Solagem';
    RETURN;
  END IF;

  v_old := $old$INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, movement_reason, order_id, material_reservation_id, origin_type
      ) VALUES (
        v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
        'Baixa Solagem — Solado por grade' || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
          || ' (' || COALESCE(v_target_name, '') || ')',
        'consumo_op', p_order_id, v_res.id, 'production_pointing'
      );$old$;

  -- Variante com quebras/espaços da definição viva (pg_get_functiondef).
  IF position(v_old in v_def) = 0 THEN
    v_old := $old2$INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, movement_reason, order_id, material_reservation_id, origin_type
      ) VALUES (
        v_res.product_id,
        'out',
        v_total_debited,
        v_prev_total,
        v_prev_total - v_total_debited,
        'Baixa Solagem — Solado por grade'
          || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
          || ' (' || COALESCE(v_target_name, '') || ')',
        'consumo_op',
        p_order_id,
        v_res.id,
        'production_pointing'
      );$old2$;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'bloco INSERT stock_movements da baixa Solagem não encontrado para patch de grade';
  END IF;

  v_new := $new$INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        previous_grade, new_grade,
        description, movement_reason, order_id, material_reservation_id, origin_type
      ) VALUES (
        v_res.product_id,
        'out',
        v_total_debited,
        v_prev_total,
        v_prev_total - v_total_debited,
        v_stock_grade,
        v_new_grade,
        'Baixa Solagem — Solado por grade'
          || CASE WHEN v_shortfall_total > 0 THEN ' (parcial)' ELSE '' END
          || ' (' || COALESCE(v_target_name, '') || ')',
        'consumo_op',
        p_order_id,
        v_res.id,
        'production_pointing'
      );$new$;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_mov$;

-- ---------------------------------------------------------------------------
-- 4. Gatilho do ledger: usa acumulado (não rebaixa)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage text;
  v_processed numeric;
  v_target numeric;
BEGIN
  IF NEW.order_id IS NULL OR COALESCE(NEW.quantity, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_stage := public.canonical_stage_name(NEW.stage_name);
  IF v_stage IS DISTINCT FROM 'Solagem' THEN
    RETURN NEW;
  END IF;

  SELECT os.quantity_processed
    INTO v_processed
    FROM public.order_stages os
   WHERE os.order_id = NEW.order_id
     AND public.canonical_stage_name(os.stage_name) = 'Solagem'
   ORDER BY os.stage_order, os.id
   LIMIT 1;

  v_target := GREATEST(
    COALESCE(v_processed, 0),
    public.sole_grade_already_debited_pairs(NEW.order_id) + NEW.quantity
  );

  BEGIN
    PERFORM public.debit_sole_grade_up_to(NEW.order_id, v_target);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        NEW.order_id,
        'Baixa de solado na Solagem falhou: ' || SQLERRM,
        'solagem_sole_debit_falhou',
        'critical'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[tg_debit_sole_on_solagem_pointing] alerta também falhou OP %: %',
        NEW.order_id, SQLERRM;
    END;
    RAISE WARNING
      '[tg_debit_sole_on_solagem_pointing] OP % Solagem qty=% falhou: %',
      NEW.order_id, NEW.quantity, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_debit_sole_on_solagem_pointing() IS
  'Após apontamento em Solagem (qty>0), baixa solado reserved até o acumulado apontado. Idempotente com faturamento e com o gatilho em order_stages.';

-- ---------------------------------------------------------------------------
-- 5. Gatilho no estágio: qualquer aumento de quantity_processed na Solagem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_stage_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.canonical_stage_name(NEW.stage_name) IS DISTINCT FROM 'Solagem' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.quantity_processed, 0) <= COALESCE(OLD.quantity_processed, 0) THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.debit_sole_grade_up_to(NEW.order_id, NEW.quantity_processed);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        NEW.order_id,
        'Baixa de solado na Solagem (avanço da etapa) falhou: ' || SQLERRM,
        'solagem_sole_debit_falhou',
        'critical'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[tg_debit_sole_on_solagem_stage_progress] alerta também falhou OP %: %',
        NEW.order_id, SQLERRM;
    END;
    RAISE WARNING
      '[tg_debit_sole_on_solagem_stage_progress] OP % processed %→% falhou: %',
      NEW.order_id, OLD.quantity_processed, NEW.quantity_processed, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_debit_sole_on_solagem_stage_progress() IS
  'Quando quantity_processed da Solagem sobe (apontamento, finalização do setor, close-on-finalize), baixa solado até esse acumulado. Sem backfill: só UPDATE novos.';

DROP TRIGGER IF EXISTS trg_debit_sole_on_solagem_stage_progress ON public.order_stages;
CREATE TRIGGER trg_debit_sole_on_solagem_stage_progress
  AFTER UPDATE OF quantity_processed ON public.order_stages
  FOR EACH ROW
  WHEN (NEW.quantity_processed IS DISTINCT FROM OLD.quantity_processed)
  EXECUTE FUNCTION public.tg_debit_sole_on_solagem_stage_progress();

REVOKE ALL ON FUNCTION public.tg_debit_sole_on_solagem_stage_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_debit_sole_on_solagem_stage_progress() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Kanban: pulo da Solagem (qty 0) baixa a quantidade do apontamento origem
-- ---------------------------------------------------------------------------
DO $patch_skip$
DECLARE
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'execute_production_pointing_command'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_skip_stage_names%';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'execute_production_pointing_command(...p_skip_stage_names...) não encontrada';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF v_def LIKE '%debit_sole_grade_up_to%' THEN
    RAISE NOTICE 'pulo da Solagem já baixa solado no command';
    RETURN;
  END IF;

  v_old := $old$        IF COALESCE((v_skip_result ->> 'needs_confirmation')::boolean, false) THEN
          RAISE EXCEPTION
            'Setor pulado % ainda exige confirmação depois do aceite do pulo',
            v_skip_name
            USING ERRCODE = 'P0001';
        END IF;$old$;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'bloco de pulo confirmado não encontrado em execute_production_pointing_command';
  END IF;

  v_new := $new$        IF COALESCE((v_skip_result ->> 'needs_confirmation')::boolean, false) THEN
          RAISE EXCEPTION
            'Setor pulado % ainda exige confirmação depois do aceite do pulo',
            v_skip_name
            USING ERRCODE = 'P0001';
        END IF;
        -- Avanço no Kanban fecha a Solagem com qty 0 ("setor pulado").
        -- A quantidade que de fato passou é a do apontamento origem.
        IF v_skip_canon = 'Solagem' AND COALESCE(p_quantity, 0) > 0 THEN
          PERFORM public.debit_sole_grade_up_to(
            p_order_id,
            public.sole_grade_already_debited_pairs(p_order_id) + p_quantity
          );
        END IF;$new$;

  v_def := replace(v_def, v_old, v_new);
  IF v_def NOT LIKE '%debit_sole_grade_up_to%' THEN
    RAISE EXCEPTION 'patch do pulo da Solagem não aplicou';
  END IF;
  EXECUTE v_def;
END;
$patch_skip$;
