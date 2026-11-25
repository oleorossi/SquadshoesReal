-- Entrada por NF: OC em rascunho/sugerida/pending pode ser recebida (ação
-- explícita do usuário — NÃO gera OC; Gerar OC continua o único caminho de
-- ordem de compra real). Depois do receive: quita pending_reconciliation,
-- recalcula o gate de material dos PVs e dispara o recálculo do motor.

-- 1) Amplia o gate de receive (15700 deixou só approved/sent/parcial).
DO $patch_receive$
DECLARE
  v_reg regprocedure := 'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure;
  v_def text;
  v_old text := $old$    IF v_po.status NOT IN ('approved', 'sent', 'parcial') THEN
      RAISE EXCEPTION 'OC em estado % nao pode ser recebida', v_po.status
        USING ERRCODE = '55000';
    END IF;$old$;
  v_new text := $new$    IF v_po.status NOT IN ('draft', 'suggested', 'pending', 'approved', 'sent', 'parcial') THEN
      RAISE EXCEPTION 'OC em estado % nao pode ser recebida', v_po.status
        USING ERRCODE = '55000';
    END IF;$new$;
  v_n int;
BEGIN
  v_def := pg_get_functiondef(v_reg);
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_purchase_order_command não encontrada';
  END IF;
  -- Já aplicada (reapply / ramo paralelo).
  IF position(v_new in v_def) > 0 THEN
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Patch 61000 receive gate encontrou % anchors', v_n;
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_receive$;

COMMENT ON FUNCTION public.execute_purchase_order_command(text, jsonb, uuid, uuid, timestamptz) IS
  'Fronteira transacional de OC genérica. O comando receive aceita draft, suggested, pending, approved, sent e parcial. Receber rascunho/sugerida é ação explícita do usuário (Entrada por NF / Dar entrada) e não substitui o clique em Gerar OC.';

-- 2) Quita reservas pending_reconciliation quando a entrada cobre a falta.
CREATE OR REPLACE FUNCTION public.settle_pending_reconciliation_for_product(
  p_product_id uuid,
  p_movement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_flipped int := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_null');
  END IF;

  -- reallocate_product_commitments já pode ter abatido quantity_short.
  -- Aqui só reabre a reserva quando a falta zera.
  FOR v_row IN
    SELECT mr.id,
           COALESCE(mr.quantity_reserved, 0) AS reserved,
           COALESCE(mr.quantity_consumed, 0) AS consumed,
           COALESCE(mr.quantity_short, 0) AS short
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status = 'pending_reconciliation'
     FOR UPDATE OF mr
  LOOP
    IF v_row.short > 0.0001 THEN
      CONTINUE;
    END IF;
    IF v_row.reserved - v_row.consumed <= 0.0001 THEN
      UPDATE public.material_reservations
         SET status = CASE WHEN v_row.consumed > 0.0001 THEN 'consumed' ELSE 'cancelled' END,
             updated_at = now()
       WHERE id = v_row.id;
    ELSE
      UPDATE public.material_reservations
         SET status = CASE WHEN v_row.consumed > 0.0001 THEN 'partially_consumed' ELSE 'reserved' END,
             updated_at = now()
       WHERE id = v_row.id;
    END IF;
    v_flipped := v_flipped + 1;
    v_ids := v_ids || v_row.id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'settled', v_flipped,
    'reservation_ids', to_jsonb(v_ids),
    'movement_id', p_movement_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_pending_reconciliation_for_product(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_pending_reconciliation_for_product(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.settle_pending_reconciliation_for_product(uuid, uuid) IS
  'Depois da entrada (e do rateio), reabre reservas pending_reconciliation cuja falta (quantity_short) já foi coberta.';

-- 3) Encadeia rateio + quitação + gate de material + recálculo do motor.
CREATE OR REPLACE FUNCTION public.apply_purchase_receive_followup(
  p_purchase_order_id uuid,
  p_product_ids uuid[] DEFAULT NULL,
  p_movement_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products uuid[] := COALESCE(p_product_ids, ARRAY[]::uuid[]);
  v_movements uuid[] := COALESCE(p_movement_ids, ARRAY[]::uuid[]);
  v_pid uuid;
  v_mid uuid;
  v_i int;
  v_settled jsonb := '[]'::jsonb;
  v_realloc jsonb := '[]'::jsonb;
  v_pvs uuid[] := ARRAY[]::uuid[];
  v_gate jsonb := NULL;
  v_motor jsonb := NULL;
  v_motor_error text := NULL;
  v_prio jsonb := NULL;
BEGIN
  IF p_purchase_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'po_null');
  END IF;

  IF array_length(v_products, 1) IS NULL THEN
    SELECT coalesce(array_agg(DISTINCT item.product_id) FILTER (WHERE item.product_id IS NOT NULL), ARRAY[]::uuid[])
      INTO v_products
      FROM public.purchase_order_items item
     WHERE item.purchase_order_id = p_purchase_order_id
       AND (item.received_at IS NOT NULL OR COALESCE(item.received_quantity, 0) > 0);
  END IF;

  IF array_length(v_products, 1) IS NOT NULL THEN
    FOR v_i IN 1 .. array_length(v_products, 1) LOOP
      v_pid := v_products[v_i];
      v_mid := CASE WHEN array_length(v_movements, 1) IS NOT NULL AND v_i <= array_length(v_movements, 1)
                    THEN v_movements[v_i] ELSE NULL END;
      -- O trigger de stock_movements já chama apply_atelier_inbound + reallocate.
      -- Chamamos de novo de forma idempotente para o caso de receive sem trigger
      -- (teste) ou movimento ainda não visível.
      BEGIN
        v_realloc := v_realloc || jsonb_build_array(public.reallocate_product_commitments(v_pid, v_mid));
      EXCEPTION WHEN OTHERS THEN
        v_realloc := v_realloc || jsonb_build_array(jsonb_build_object('ok', false, 'product_id', v_pid, 'error', SQLERRM));
      END;
      BEGIN
        v_settled := v_settled || jsonb_build_array(public.settle_pending_reconciliation_for_product(v_pid, v_mid));
      EXCEPTION WHEN OTHERS THEN
        v_settled := v_settled || jsonb_build_array(jsonb_build_object('ok', false, 'product_id', v_pid, 'error', SQLERRM));
      END;
    END LOOP;
  END IF;

  SELECT coalesce(po.source_pv_ids, ARRAY[]::uuid[])
    INTO v_pvs
    FROM public.purchase_orders po
   WHERE po.id = p_purchase_order_id;

  SELECT coalesce(array_agg(DISTINCT x.sale_order_id) FILTER (WHERE x.sale_order_id IS NOT NULL), v_pvs)
    INTO v_pvs
    FROM (
      SELECT unnest(v_pvs) AS sale_order_id
      UNION
      SELECT a.sale_order_id
        FROM public.stock_inbound_allocations a
       WHERE a.product_id = ANY (v_products)
         AND a.created_at >= now() - interval '15 minutes'
      UNION
      SELECT mr.sale_order_id
        FROM public.material_reservations mr
       WHERE mr.product_id = ANY (v_products)
         AND mr.sale_order_id IS NOT NULL
         AND mr.status IN ('reserved', 'partially_consumed', 'pending_reconciliation')
    ) x;

  IF array_length(v_pvs, 1) IS NOT NULL THEN
    BEGIN
      v_gate := public.recompute_material_gate_for_sale_orders(v_pvs);
    EXCEPTION WHEN OTHERS THEN
      v_gate := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
  END IF;

  BEGIN
    v_motor := public.recompute_production_schedule('nf-receive');
  EXCEPTION WHEN OTHERS THEN
    v_motor_error := SQLERRM;
    v_motor := jsonb_build_object('ok', false, 'error', v_motor_error);
  END;

  BEGIN
    PERFORM public.refresh_purchase_order_motor_priority();
    v_prio := jsonb_build_object('ok', true);
  EXCEPTION WHEN OTHERS THEN
    v_prio := jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'ok', v_motor_error IS NULL,
    'purchase_order_id', p_purchase_order_id,
    'product_ids', to_jsonb(v_products),
    'sale_order_ids', to_jsonb(v_pvs),
    'reallocated', v_realloc,
    'settled', v_settled,
    'material_gate', v_gate,
    'motor', v_motor,
    'priority', v_prio
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_purchase_receive_followup(uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_purchase_receive_followup(uuid, uuid[], uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_purchase_receive_followup(uuid, uuid[], uuid[]) IS
  'Pós-receive: rateio, quitação de pending_reconciliation, gate de material dos PVs e recálculo imediato do motor (triggered_by=nf-receive). Erro no motor não desfaz a entrada quando chamado em bloco EXCEPTION (no gatilho).';

-- 4) Dispara o followup automaticamente após um receive bem-sucedido.
--    O EXCEPTION interno garante que falha do motor NÃO desfaz o estoque.
CREATE OR REPLACE FUNCTION public.tg_after_purchase_order_receive_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products uuid[] := ARRAY[]::uuid[];
  v_movements uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NEW.command_name IS DISTINCT FROM 'receive' THEN
    RETURN NEW;
  END IF;
  IF NEW.purchase_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(DISTINCT (elem ->> 'product_id')::uuid) FILTER (WHERE elem ? 'product_id'), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT (elem ->> 'movement_id')::uuid) FILTER (WHERE elem ? 'movement_id'), ARRAY[]::uuid[])
    INTO v_products, v_movements
    FROM jsonb_array_elements(COALESCE(NEW.response -> 'received_items', '[]'::jsonb)) elem;

  BEGIN
    PERFORM public.apply_purchase_receive_followup(NEW.purchase_order_id, v_products, v_movements);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'apply_purchase_receive_followup falhou na OC %: %', NEW.purchase_order_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_purchase_order_receive_followup ON public.purchase_order_command_receipts;
CREATE TRIGGER trg_after_purchase_order_receive_followup
  AFTER INSERT ON public.purchase_order_command_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_after_purchase_order_receive_followup();

COMMENT ON FUNCTION public.tg_after_purchase_order_receive_followup() IS
  'Após execute_purchase_order_command receive, dispara apply_purchase_receive_followup. Falha do motor vira WARNING e não desfaz a entrada.';

-- 5) Contrato: o gate de receive contém os 3 status novos.
CREATE OR REPLACE FUNCTION public.run_entrada_nf_receive_contract_tests()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure);
  IF position($$IF v_po.status NOT IN ('draft', 'suggested', 'pending', 'approved', 'sent', 'parcial')$$ in v_def) = 0 THEN
    RAISE EXCEPTION 'receive não aceita draft/suggested/pending';
  END IF;
  IF to_regprocedure('public.apply_purchase_receive_followup(uuid,uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'apply_purchase_receive_followup ausente';
  END IF;
  IF to_regprocedure('public.settle_pending_reconciliation_for_product(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'settle_pending_reconciliation_for_product ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_after_purchase_order_receive_followup'
       AND tgrelid = 'public.purchase_order_command_receipts'::regclass
  ) THEN
    RAISE EXCEPTION 'trigger de followup ausente';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.run_entrada_nf_receive_contract_tests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_entrada_nf_receive_contract_tests() TO authenticated, service_role;
