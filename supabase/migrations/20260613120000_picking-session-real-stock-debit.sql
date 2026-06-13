-- ============================================================
-- Picking por SESSÃO que move estoque de verdade (baixa por botão)
-- ============================================================
-- Contexto: `picking_sessions`/`picking_items` (página /picking-sessions)
-- tinha UI de bipagem, mas o "picking" só fazia UPDATE em
-- picking_items.picked_qty — NUNCA tocava products.quantity,
-- material_reservations nem stock_movements. Era decorativo.
--
-- Além disso o frontend lia products.code/products.ean (colunas que NÃO
-- existem nesse schema — EAN mora em technical_sheets.ean_by_size), então
-- a página errava ao carregar. Corrigido no frontend em paralelo.
--
-- Este patch liga a sessão ao débito real e idempotente, sem depender de
-- leitor de código de barras: o operador digita/clica a quantidade
-- separada e dá baixa por botão. Espelha a lógica já validada de
-- `commit_picking_for_sale_order` (lock + FOR UPDATE + skip sem estoque +
-- marca picking_individually_done_at pra sair do Picking Semanal).

-- ── Schema: vínculo reserva + idempotência ────────────────────────────
ALTER TABLE public.picking_items
  ADD COLUMN IF NOT EXISTS reservation_id uuid
    REFERENCES public.material_reservations(id) ON DELETE SET NULL,
  -- Quanto já foi debitado do estoque por este item. A baixa processa só o
  -- delta (picked_qty - committed_qty), então o botão pode ser apertado
  -- várias vezes (picking parcial) sem nunca debitar 2x.
  ADD COLUMN IF NOT EXISTS committed_qty numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_picking_items_reservation
  ON public.picking_items(reservation_id);

ALTER TABLE public.picking_sessions
  ADD COLUMN IF NOT EXISTS stock_committed_at timestamptz;

COMMENT ON COLUMN public.picking_items.reservation_id IS
  'Reserva (material_reservations) de origem quando o item foi puxado de um PV. NULL em item livre/manual.';
COMMENT ON COLUMN public.picking_items.committed_qty IS
  'Quantidade já debitada do estoque por commit_picking_session. Idempotência: baixa só o delta picked_qty - committed_qty.';
COMMENT ON COLUMN public.picking_sessions.stock_committed_at IS
  'Primeira vez que a sessão deu baixa no estoque. NULL = ainda não debitou.';

-- ── Auto-popular a sessão a partir das reservas do PV ─────────────────
DROP FUNCTION IF EXISTS public.populate_picking_session_from_sale_order(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.populate_picking_session_from_sale_order(
  p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so       uuid;
  v_inserted integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT sale_order_id INTO v_so
    FROM public.picking_sessions
   WHERE id = p_session_id;
  IF v_so IS NULL THEN
    RAISE EXCEPTION 'Sessão % não tem PV vinculado — nada a puxar', p_session_id;
  END IF;

  -- Puxa as reservas soft (status='reserved') das OPs do PV. Solados já
  -- vêm 'consumed' da criação da OP (debit_sole_stock_by_grade) então não
  -- aparecem aqui — igual ao commit_picking_for_sale_order. bin/cor saem
  -- do próprio produto pra ordenar a coleta e exibir.
  INSERT INTO public.picking_items (
    picking_session_id, product_id, reservation_id,
    expected_qty, color, bin_location, status
  )
  SELECT p_session_id, mr.product_id, mr.id,
         (mr.quantity_reserved - mr.quantity_consumed),
         p.color, p.location, 'pendente'
    FROM public.material_reservations mr
    JOIN public.orders   o ON o.id = mr.order_id
    JOIN public.products p ON p.id = mr.product_id
   WHERE o.sale_order_id = v_so
     AND mr.status = 'reserved'
     AND (mr.quantity_reserved - mr.quantity_consumed) > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.picking_items pi
        WHERE pi.picking_session_id = p_session_id
          AND pi.reservation_id = mr.id
     );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'sale_order_id', v_so,
    'inserted',      v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.populate_picking_session_from_sale_order(uuid) TO authenticated;

-- ── Baixa de estoque por botão (idempotente, por delta) ───────────────
DROP FUNCTION IF EXISTS public.commit_picking_session(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.commit_picking_session(
  p_session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session      RECORD;
  v_item         RECORD;
  v_cur          numeric;
  v_delta        numeric;
  v_committed    integer := 0;
  v_skipped      integer := 0;
  v_insufficient text[] := '{}';
  v_pending      integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_session
    FROM public.picking_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão de picking não encontrada: %', p_session_id;
  END IF;
  IF v_session.status = 'cancelada' THEN
    RAISE EXCEPTION 'Sessão cancelada não pode dar baixa no estoque';
  END IF;

  -- Só itens com algo novo a debitar (picked > já comitado). Ordena por bin
  -- pra estabilidade. Lock só nas linhas de picking_items.
  FOR v_item IN
    SELECT pi.id, pi.product_id, pi.picked_qty, pi.committed_qty,
           pi.expected_qty, pi.reservation_id,
           p.name AS product_name,
           mr.order_id AS res_order_id
      FROM public.picking_items pi
      JOIN public.products p ON p.id = pi.product_id
      LEFT JOIN public.material_reservations mr ON mr.id = pi.reservation_id
     WHERE pi.picking_session_id = p_session_id
       AND pi.picked_qty > pi.committed_qty
       AND pi.product_id IS NOT NULL
     ORDER BY pi.bin_location NULLS LAST, p.name
       FOR UPDATE OF pi
  LOOP
    v_delta := v_item.picked_qty - v_item.committed_qty;

    SELECT quantity INTO v_cur
      FROM public.products
     WHERE id = v_item.product_id
       FOR UPDATE;

    IF v_cur < v_delta THEN
      v_insufficient := v_insufficient ||
        format('%s: disponível %s · separar %s',
               v_item.product_name, v_cur::text, v_delta::text);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity = quantity - v_delta,
           updated_at = now()
     WHERE id = v_item.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id, user_id
    ) VALUES (
      v_item.product_id, 'out', v_delta, v_cur, v_cur - v_delta,
      'Picking sessão ' || v_session.session_number,
      v_item.res_order_id, auth.uid()
    );

    -- Consome a reserva proporcionalmente (espelha commit_picking_for_sale_order:
    -- não mexe em reserved_stock — o resync periódico do Round 6 cuida do drift).
    IF v_item.reservation_id IS NOT NULL THEN
      UPDATE public.material_reservations
         SET quantity_consumed = LEAST(quantity_reserved, quantity_consumed + v_delta),
             status = CASE WHEN quantity_consumed + v_delta >= quantity_reserved
                           THEN 'consumed' ELSE 'partially_consumed' END,
             reservation_type = 'hard',
             consumed_at = CASE WHEN quantity_consumed + v_delta >= quantity_reserved
                                THEN now() ELSE consumed_at END,
             updated_at = now()
       WHERE id = v_item.reservation_id;
    END IF;

    UPDATE public.picking_items
       SET committed_qty = picked_qty,
           status = CASE WHEN picked_qty >= expected_qty THEN 'separado' ELSE 'em_andamento' END,
           picked_at = COALESCE(picked_at, now())
     WHERE id = v_item.id;

    v_committed := v_committed + 1;
  END LOOP;

  -- Status da sessão: concluída quando não há mais nada pendente de separar.
  SELECT count(*) INTO v_pending
    FROM public.picking_items
   WHERE picking_session_id = p_session_id
     AND picked_qty < expected_qty;

  UPDATE public.picking_sessions
     SET stock_committed_at = COALESCE(stock_committed_at, now()),
         status = CASE WHEN v_pending = 0 THEN 'concluida' ELSE 'em_separacao' END,
         completed_at = CASE WHEN v_pending = 0 THEN now() ELSE completed_at END
   WHERE id = p_session_id;

  -- Se a sessão é de um PV e todas as reservas do PV já foram consumidas,
  -- marca picking_individually_done_at pra sair do Picking Semanal (mesmo
  -- guard anti-duplo-débito do fluxo do drawer).
  IF v_session.sale_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.material_reservations mr
        JOIN public.orders o ON o.id = mr.order_id
       WHERE o.sale_order_id = v_session.sale_order_id
         AND mr.status = 'reserved'
    ) THEN
      UPDATE public.sale_orders
         SET picking_individually_done_at = COALESCE(picking_individually_done_at, now()),
             updated_at = now()
       WHERE id = v_session.sale_order_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id',      p_session_id,
    'committed_count', v_committed,
    'skipped_count',   v_skipped,
    'insufficient',    v_insufficient,
    'session_status',  CASE WHEN v_pending = 0 THEN 'concluida' ELSE 'em_separacao' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_picking_session(uuid) TO authenticated;

COMMENT ON FUNCTION public.commit_picking_session(uuid) IS
  'Baixa de estoque por botão a partir de uma sessão de picking. Debita o delta '
  '(picked_qty - committed_qty) de cada item, grava stock_movements, consome a '
  'reserva vinculada e marca picking_individually_done_at quando o PV zera. Idempotente.';
