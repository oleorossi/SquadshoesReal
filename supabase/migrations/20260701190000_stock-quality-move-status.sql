-- Quarentena / Bloqueio operável — paridade Tutor32, estoque #1.
--
-- products.quarantine_qty e blocked_qty existiam mas eram colunas MORTAS (sem RPC/UI).
-- Esta RPC move quantidade entre os baldes (disponível = products.quantity,
-- quarentena = quarantine_qty, bloqueado = blocked_qty) e 'descarte' (sumidouro),
-- com lock pessimista, validação de saldo, rastro em stock_movements (quando o
-- disponível muda) e auditoria em quarantine_stock.

CREATE OR REPLACE FUNCTION public.move_stock_status(
  p_product_id uuid,
  p_qty numeric,
  p_from text,           -- 'disponivel' | 'quarentena' | 'bloqueado'
  p_to text,             -- 'disponivel' | 'quarentena' | 'bloqueado' | 'descarte'
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_avail numeric;
  v_quar numeric;
  v_block numeric;
  v_src numeric;
  v_prev_avail numeric;
  v_audit_status text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser positiva';
  END IF;
  IF p_from NOT IN ('disponivel','quarentena','bloqueado') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_from;
  END IF;
  IF p_to NOT IN ('disponivel','quarentena','bloqueado','descarte') THEN
    RAISE EXCEPTION 'Destino inválido: %', p_to;
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'Origem e destino iguais';
  END IF;

  SELECT quantity, quarantine_qty, blocked_qty
    INTO v_avail, v_quar, v_block
  FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % não encontrado', p_product_id;
  END IF;

  v_src := CASE p_from WHEN 'disponivel' THEN v_avail WHEN 'quarentena' THEN v_quar ELSE v_block END;
  IF v_src < p_qty THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: tem %, pediu %', p_from, v_src, p_qty;
  END IF;

  v_prev_avail := v_avail;

  -- debita origem
  IF p_from = 'disponivel' THEN v_avail := v_avail - p_qty;
  ELSIF p_from = 'quarentena' THEN v_quar := v_quar - p_qty;
  ELSE v_block := v_block - p_qty;
  END IF;

  -- credita destino (descarte = sumidouro, não credita nada)
  IF p_to = 'disponivel' THEN v_avail := v_avail + p_qty;
  ELSIF p_to = 'quarentena' THEN v_quar := v_quar + p_qty;
  ELSIF p_to = 'bloqueado' THEN v_block := v_block + p_qty;
  END IF;

  UPDATE public.products
     SET quantity = v_avail,
         current_stock = v_avail,
         quarantine_qty = v_quar,
         blocked_qty = v_block,
         updated_at = now()
   WHERE id = p_product_id;

  -- rastro em stock_movements apenas quando o DISPONÍVEL mudou
  IF v_avail <> v_prev_avail THEN
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (
      p_product_id,
      CASE WHEN v_avail > v_prev_avail THEN 'in' ELSE 'out' END,
      p_qty, v_prev_avail, v_avail,
      format('Mov. estoque %s → %s%s', p_from, p_to, CASE WHEN p_reason <> '' THEN ' — '||p_reason ELSE '' END)
    );
  END IF;

  -- auditoria em quarantine_stock
  v_audit_status := CASE p_to
    WHEN 'quarentena' THEN 'quarantine'
    WHEN 'bloqueado' THEN 'blocked'
    WHEN 'disponivel' THEN 'released'
    WHEN 'descarte' THEN 'scrapped'
  END;
  INSERT INTO public.quarantine_stock (product_id, quantity, reason, status, resolution_notes)
  VALUES (p_product_id, p_qty, COALESCE(NULLIF(p_reason,''), p_from||'→'||p_to), v_audit_status,
          format('%s → %s', p_from, p_to));

  RETURN jsonb_build_object('disponivel', v_avail, 'quarentena', v_quar, 'bloqueado', v_block);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.move_stock_status(uuid, numeric, text, text, text) TO authenticated;
