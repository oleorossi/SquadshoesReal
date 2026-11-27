-- =============================================================================
-- Solagem parcial: não rebaixa o que o gatilho do estágio já tirou
-- =============================================================================
-- Marcador: solagem_parcial_nao_rebaixa_663
--
-- apontar_producao_setor_impl grava o ESTADO (order_stages.quantity_processed)
-- e só depois o ledger (production_pointings). A 65000 colocou um gatilho em
-- cada um, e debit_sole_grade_up_to deveria ser idempotente via
-- sole_grade_already_debited_pairs.
--
-- Dois furos no apontamento canônico parcial (ex.: 30 de 100 pares):
--
--   1) already_debited só somava quantity_consumed de reservas 'converted'.
--      debit_sole_grade_for_solagem_pointing, na fatia parcial, deixa a
--      reserva 'reserved' e NÃO grava quantity_consumed (só reduz
--      effective_grade). Depois do 1º gatilho already=0.
--
--   2) o gatilho do pointing pedia GREATEST(processed, already + NEW.quantity).
--      No caminho canônico processed já inclui esta qty. Com already certo
--      isso vira already+qty = 2×; com already=0, debit_up_to(processed)
--      ainda rebaixa porque não vê o movimento físico.
--
-- Resultado: apontar 30 na Solagem tirava 60 do estoque (até esgotar a
-- reserva). Sem backfill / sem débito retroativo — só a conta daqui pra frente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sole_grade_already_debited_pairs(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- Fonte de verdade = movimento físico. A reserva parcial continua
  -- 'reserved' com quantity_consumed=0, então somar converted mentia.
  SELECT COALESCE(sum(sm.quantity), 0)
    FROM public.stock_movements sm
   WHERE sm.order_id = p_order_id
     AND sm.movement_type = 'out'
     AND COALESCE(sm.quantity, 0) > 0
     AND (
       sm.description LIKE 'Baixa Solagem%'
       OR EXISTS (
         SELECT 1
           FROM public.material_reservations mr
          WHERE mr.id = sm.material_reservation_id
            AND COALESCE(mr.metadata->>'kind', '') = 'sole_grade'
       )
     );
$function$;

COMMENT ON FUNCTION public.sole_grade_already_debited_pairs(uuid) IS
  'Pares de solado já baixados fisicamente nesta OP (stock_movements out da baixa Solagem / reserva sole_grade). Idempotência entre gatilho do estágio, gatilho do pointing, pulo no Kanban e faturamento.';

REVOKE ALL ON FUNCTION public.sole_grade_already_debited_pairs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_grade_already_debited_pairs(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage text;
  v_processed numeric;
  v_already numeric;
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

  v_already := public.sole_grade_already_debited_pairs(NEW.order_id);
  v_processed := COALESCE(v_processed, 0);

  -- Caminho canônico (estado ANTES do ledger): quantity_processed já inclui
  -- esta qty e o gatilho do estágio já pediu debit_up_to(processed).
  -- already + NEW.quantity nesse caso é 2×. Só soma a qty do pointing
  -- quando o estágio ainda não registrou este apontamento (legado).
  IF v_processed >= NEW.quantity THEN
    v_target := GREATEST(v_processed, v_already);
  ELSE
    v_target := v_already + NEW.quantity;
  END IF;

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
  'Após apontamento em Solagem (qty>0), baixa até o acumulado do estágio (caminho canônico) ou already+qty (legado sem bump do estágio). Não soma a qty de novo quando quantity_processed já a inclui.';

REVOKE ALL ON FUNCTION public.tg_debit_sole_on_solagem_pointing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_debit_sole_on_solagem_pointing() TO authenticated, service_role;
