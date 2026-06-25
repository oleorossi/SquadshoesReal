-- Quadro de Fluxo arrastável (2026-06-25): mover uma OP pra um setor no kanban
-- "ONDE ESTÁ CADA ORDEM". Atômico (1 transação): conclui tudo que vem ANTES do
-- alvo NO FLUXO e inicia o alvo. O guard de pré-requisito (fn_guard_manual_stage_transition)
-- e o trigger de timestamp (tg_stamp_order_stage_wip_timestamps) continuam valendo —
-- se algum pré-requisito faltar, o guard dá RAISE e a transação inteira reverte
-- (nada fica pela metade).
--
-- ⚠ A ordem do fluxo NÃO é o stage_order: na base, Costura tem stage_order 3 mas
-- DEPENDE de Aviamento (stage_order 4). Usamos a ordem topológica real (os 3 prep
-- → Costura → Silk → Colagem → Montagem → Solagem → Acabamento → Expedição),
-- alinhada ao guard e ao computeParallelWindows.

CREATE OR REPLACE FUNCTION public.advance_order_to_sector(
  p_order_id uuid,
  p_target text,
  p_operator uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_flow text[] := ARRAY[
    'Corte Palmilha', 'Corte Forração', 'Aviamento', 'Costura', 'Silk',
    'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'
  ];
  v_target_idx int;
BEGIN
  v_target_idx := array_position(v_flow, p_target);
  IF v_target_idx IS NULL THEN
    RAISE EXCEPTION 'Setor "%" desconhecido no fluxo', p_target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM order_stages WHERE order_id = p_order_id AND stage_name = p_target) THEN
    RAISE EXCEPTION 'Esta OP não passa pelo setor "%"', p_target;
  END IF;

  -- Conclui todas as etapas da OP que vêm ANTES do alvo no fluxo (e ainda não
  -- estão concluídas). completed_at é carimbado pelo trigger.
  UPDATE order_stages s
     SET status = 'concluido',
         completed_by = COALESCE(s.completed_by, auth.uid()),
         operator_employee_id = COALESCE(s.operator_employee_id, p_operator)
   WHERE s.order_id = p_order_id
     AND s.status <> 'concluido'
     AND array_position(v_flow, s.stage_name) IS NOT NULL
     AND array_position(v_flow, s.stage_name) < v_target_idx;

  -- Inicia o alvo se estiver pendente. O guard valida os pré-requisitos; se
  -- faltar algum, RAISE → rollback de tudo acima (atômico). started_at é
  -- carimbado pelo trigger.
  UPDATE order_stages
     SET status = 'em_andamento'
   WHERE order_id = p_order_id AND stage_name = p_target AND status = 'pendente';
END;
$$;
