-- fila_corte_somente_leitura_20270101054300
--
-- Hotfix de produção, 22/11/2026 23:58 horário de Brasília: as duas
-- funções da fila foram marcadas voláteis no banco, e o PostgREST
-- foi avisado a recarregar o cache. A Gestão (Kanban) não carregava
-- porque o PostgREST executa função estável numa transação somente
-- leitura, e o motivo do bloqueio chamava o portão do kit, que trava
-- a linha do lote para atualizar.
--
-- Esta migration não repete essa marcação. A trava de linha sai:
-- a fila lê o kit fechado sem gravar e sem travar a linha. As duas
-- funções voltam a STABLE, que agora é honesto.
-- Não altera pedido, PV-00249, PV-00250 nem LOTE-00004.

CREATE OR REPLACE FUNCTION public.atelier_lot_kit_closed_readonly(p_lot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_short boolean;
  v_has_lines boolean;
  v_gate text;
  v_napa numeric;
BEGIN
  IF p_lot_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT status INTO v_status
    FROM public.atelier_lots
   WHERE id = p_lot_id;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'cut' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.atelier_lot_release_lines(p_lot_id) r
            WHERE r.available < r.required - 1e-9
         ),
         EXISTS (SELECT 1 FROM public.atelier_lot_release_lines(p_lot_id))
    INTO v_short, v_has_lines;

  IF NOT v_has_lines THEN
    v_gate := 'ready_to_send';
  ELSIF v_short THEN
    v_gate := 'awaiting_components';
  ELSE
    v_gate := 'ready_to_send';
  END IF;

  SELECT COALESCE(sum(GREATEST(d.pending_qty, 0)), 0)
    INTO v_napa
    FROM public.cabedal_prep_stock_debits d
   WHERE d.lot_id = p_lot_id
     AND d.sector = 'corte_atelier';

  RETURN v_gate = 'ready_to_send' AND COALESCE(v_napa, 0) <= 0.0000001;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_lot_kit_closed_readonly(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_closed_readonly(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_lot_kit_closed_readonly(uuid) IS
  'Mesma resposta de kit fechado da função que grava o portão, sem travar a linha e sem gravar kit_gate. Serve à fila estável.';

CREATE OR REPLACE FUNCTION public.atelier_cut_block_reason(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot uuid;
BEGIN
  SELECT lot_id INTO v_lot FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'Job não encontrado';
  END IF;
  IF v_lot IS NULL THEN
    RETURN 'Sem material disponível';
  END IF;
  IF NOT public.atelier_lot_kit_closed_readonly(v_lot) THEN
    RETURN 'Kit ainda aberto';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_cut_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_cut_block_reason(uuid) TO authenticated, service_role;

ALTER FUNCTION public.list_atelier_cut_queue() STABLE;

COMMENT ON FUNCTION public.list_atelier_cut_queue() IS
  'Fila do corte. Só lê. Pode rodar na transação somente leitura do PostgREST.';

-- Auditoria das funções estáveis de 20270101054100 e 20270101054200.
-- Nenhuma outra trava linha de lote nem regrava o portão do kit:
--   outsourced_sector_key          IMMUTABLE, CASE puro
--   outsourced_pair_ledger         STABLE, só SELECT e funções de leitura
--   list_atelier_launch_reservations STABLE, só SELECT
--   list_complex_upper_not_in_launch STABLE, só SELECT
--   atelier_cut_range_caps         STABLE, só SELECT
-- As que gravam (approve_atelier_cut, save_atelier_launch_reservation,
-- sync_atelier_launch_for_order, atelier_set_job_execution_mode e os
-- triggers) já nascem com efeito de escrita. O único furo era o
-- motivo do corte chamar o portão que grava, e a fila que o chamava.
