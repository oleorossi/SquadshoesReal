-- ============================================================================
-- CONCORRÊNCIA SEM LOCK — incrementos atômicos (auditoria 2026-07-28 · T4)
-- ============================================================================
-- Padrão repetido e perigoso: read-modify-write NO CLIENTE em saldo e contador.
-- A tela lê o valor, soma/subtrai em JavaScript e grava o ABSOLUTO. Com dois
-- operadores (ou duas abas), a segunda escrita apaga a primeira em silêncio —
-- não há erro, só some unidade.
--
-- Três casos fechados aqui:
--   1) Bipagem do picking (`picked_qty + 1` no cliente) — duas bipagens leem 0
--      e gravam 1; some uma unidade separada de verdade.
--   2) Entrada/saída manual na ficha do produto — grava `products.quantity`
--      absoluto calculado do snapshot React, atropelando débito concorrente.
--   3) Baixa manual validada contra `quantity` em vez de `quantity − reserved`:
--      100 em estoque com 90 reservado aceitava baixa de 50 e deixava o
--      disponível NEGATIVO pras OPs que já contavam com o material.
-- ============================================================================

-- ── 1) Bipagem do picking: incremento atômico ───────────────────────────────
CREATE OR REPLACE FUNCTION public.pick_item_increment(
  p_item_id uuid,
  p_ean     text    DEFAULT NULL,
  p_delta   numeric DEFAULT 1
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_new  numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- FOR UPDATE: a segunda bipagem espera a primeira COMMITAR e só então lê o
  -- picked_qty já incrementado. É isso que impede a perda de unidade.
  SELECT * INTO v_item FROM public.picking_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item de separação % não encontrado', p_item_id;
  END IF;

  v_new := LEAST(
    COALESCE(v_item.picked_qty, 0) + GREATEST(COALESCE(p_delta, 1), 0),
    COALESCE(v_item.expected_qty, 0)
  );

  UPDATE public.picking_items
     SET picked_qty  = v_new,
         ean_scanned = COALESCE(NULLIF(p_ean, ''), ean_scanned),
         picked_at   = now(),
         status      = CASE WHEN v_new >= COALESCE(expected_qty, 0)
                            THEN 'separado' ELSE 'em_andamento' END
   WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'id',          p_item_id,
    'picked_qty',  v_new,
    'expected_qty', COALESCE(v_item.expected_qty, 0),
    'completo',    v_new >= COALESCE(v_item.expected_qty, 0),
    -- true = a bipagem não somou porque o item JÁ estava completo. A tela
    -- avisa em vez de fingir que contou.
    'ja_completo', COALESCE(v_item.picked_qty, 0) >= COALESCE(v_item.expected_qty, 0)
  );
END;
$function$;

COMMENT ON FUNCTION public.pick_item_increment(uuid, text, numeric) IS
  'Incremento ATÔMICO da bipagem de picking (FOR UPDATE). Substitui o picked_qty+1 calculado no cliente, que perdia unidade sob concorrência.';

GRANT EXECUTE ON FUNCTION public.pick_item_increment(uuid, text, numeric) TO authenticated;

-- ── 2) Movimento manual por DELTA (nunca por absoluto) ──────────────────────
CREATE OR REPLACE FUNCTION public.move_stock_delta(
  p_product_id  uuid,
  p_type        text,                       -- 'in' | 'out'
  p_qty         numeric,
  p_description text    DEFAULT NULL,
  p_lot_number  text    DEFAULT NULL,
  p_created_at  timestamptz DEFAULT NULL,
  p_responsible text    DEFAULT NULL,
  p_order_id    uuid    DEFAULT NULL,
  -- Saída manual não pode comer o que já está reservado pra OP aberta. A tela
  -- pode liberar conscientemente (contagem que achou menos, perda, etc.).
  p_enforce_reserved boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev     numeric;
  v_reserved numeric;
  v_new      numeric;
  v_disp     numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF p_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido: %', p_type;
  END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantidade do movimento tem que ser maior que zero';
  END IF;

  -- Saldo lido do BANCO sob lock — não do snapshot da tela, que pode estar
  -- velho por segundos ou minutos.
  SELECT quantity, COALESCE(reserved_stock, 0)
    INTO v_prev, v_reserved
    FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % não encontrado', p_product_id;
  END IF;

  v_new := CASE WHEN p_type = 'in' THEN v_prev + p_qty ELSE v_prev - p_qty END;

  IF v_new < 0 THEN
    RETURN jsonb_build_object('success', false, 'erro', 'ESTOQUE_INSUFICIENTE',
                              'disponivel', v_prev, 'solicitado', p_qty);
  END IF;

  IF p_type = 'out' AND p_enforce_reserved AND p_order_id IS NULL THEN
    v_disp := GREATEST(0, v_prev - v_reserved);
    IF p_qty > v_disp THEN
      RETURN jsonb_build_object('success', false, 'erro', 'RESERVADO_PARA_OP',
                                'estoque', v_prev, 'reservado', v_reserved,
                                'disponivel', v_disp, 'solicitado', p_qty);
    END IF;
  END IF;

  UPDATE public.products
     SET quantity      = v_new,
         current_stock = v_new,
         lot_number    = COALESCE(NULLIF(p_lot_number, ''), lot_number),
         updated_at    = now()
   WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock,
    description, lot_number, created_at, responsible, order_id
  ) VALUES (
    p_product_id, p_type, p_qty, v_prev, v_new,
    COALESCE(NULLIF(p_description, ''),
             CASE WHEN p_type = 'in' THEN 'Entrada manual' ELSE 'Saída manual' END),
    NULLIF(p_lot_number, ''), COALESCE(p_created_at, now()),
    NULLIF(p_responsible, ''), p_order_id
  );

  RETURN jsonb_build_object('success', true, 'anterior', v_prev, 'novo', v_new);
END;
$function$;

COMMENT ON FUNCTION public.move_stock_delta(uuid, text, numeric, text, text, timestamptz, text, uuid, boolean) IS
  'Entrada/saída manual por DELTA sob FOR UPDATE. Substitui o cálculo no cliente que gravava quantity absoluto e atropelava movimento concorrente. Saída avulsa respeita reserved_stock.';

GRANT EXECUTE ON FUNCTION public.move_stock_delta(uuid, text, numeric, text, text, timestamptz, text, uuid, boolean) TO authenticated;

-- ── 3) adjust_stock: guarda opcional do reservado ───────────────────────────
-- DROP + CREATE (não CREATE OR REPLACE): o parâmetro novo criaria uma
-- sobrecarga ambígua com a assinatura antiga de 7 args.
DROP FUNCTION IF EXISTS public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb, uuid);

CREATE FUNCTION public.adjust_stock(
  p_product_id uuid,
  p_expected_previous_qty numeric,
  p_new_qty numeric,
  p_delta numeric,
  p_reason text,
  p_new_grade jsonb DEFAULT NULL::jsonb,
  p_order_id uuid DEFAULT NULL::uuid,
  -- Padrão false: CONTAGEM de inventário tem que poder registrar que o físico
  -- é menor que o reservado — a realidade manda. Quem liga é a BAIXA manual,
  -- que é consumo e não pode comer material comprometido com OP aberta.
  p_enforce_reserved boolean DEFAULT false
)
 RETURNS TABLE(success boolean, current_db_qty numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actual_qty NUMERIC;
    v_reserved   NUMERIC;
    v_movement_type TEXT;
    v_actual_delta NUMERIC;
BEGIN
    IF NOT public.is_approved_user() THEN
        RAISE EXCEPTION 'Permission denied: usuário não aprovado';
    END IF;
    IF p_new_qty < 0 THEN
        RETURN QUERY SELECT false, p_expected_previous_qty, 'NEGATIVE_QTY_NOT_ALLOWED'::TEXT;
        RETURN;
    END IF;
    SELECT quantity, COALESCE(reserved_stock, 0)
      INTO v_actual_qty, v_reserved
      FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;
    -- Comparação tolerante a precisão (round 4 casas) — evita conflito falso pelo
    -- round-trip float64 da tela vs numeric de alta precisão do banco.
    IF round(v_actual_qty, 4) <> round(p_expected_previous_qty, 4) THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;
    IF p_enforce_reserved AND p_new_qty < v_reserved AND p_order_id IS NULL THEN
        RETURN QUERY SELECT false, v_actual_qty, 'RESERVADO_PARA_OP'::TEXT;
        RETURN;
    END IF;
    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;
    UPDATE public.products
    SET quantity = p_new_qty, current_stock = p_new_qty, stock_grade = COALESCE(p_new_grade, stock_grade), updated_at = NOW()
    WHERE id = p_product_id;
    INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock, description, order_id, user_id, user_email
    ) VALUES (
        p_product_id, v_movement_type, ABS(v_actual_delta), v_actual_qty, p_new_qty, p_reason, p_order_id,
        auth.uid(), COALESCE(auth.jwt() ->> 'email', '')
    );
    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb, uuid, boolean) TO authenticated;
