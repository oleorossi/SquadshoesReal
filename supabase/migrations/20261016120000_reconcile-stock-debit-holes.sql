-- ============================================================================
-- RECONCILIAÇÃO DA BAIXA PENDENTE (auditoria 2026-07-28 · Crítico #3 + Alto #5)
-- ============================================================================
-- CONTEXTO (verificado no banco vivo, não nas migrations)
--   O achado dizia "faturamento encerra a OP sem baixa física integral —
--   bloquear". Bloquear foi DECISÃO EXPLÍCITA do dono em sentido contrário
--   (PV-67, solado INFANTIL 25 zerado): falta de ESTOQUE não trava faturamento.
--   E o débito parcial já existe: `convert_reservation_to_out` debita o que há,
--   abre um saldo `partial_pending` e a finalização o preserva como
--   `pending_reconciliation` (mig 20260925133000). `list_stock_debit_holes` já
--   lista o furo.
--
--   O que FALTAVA é o outro lado: não existe como FECHAR o furo. Quando o
--   material chega, ninguém debita o saldo devido — a pendência fica listada
--   pra sempre e o estoque segue superavaliado. Sem isso, "reconciliar ao
--   repor estoque" é uma frase na nota, não um processo.
--
-- O QUE ESTA MIGRATION FAZ
--   1) `list_stock_debit_holes` passa a devolver `reservation_id` (a UI precisa
--      dele pra saber o que reconciliar).
--   2) `reconcile_stock_debit_hole()` — baixa compensatória idempotente e
--      parcial-friendly: debita o que o estoque comporta HOJE, registra
--      `stock_movements` e fecha (ou reduz) a pendência.
--   3) Lock ÚNICO entre os dois donos do consumo. `convert_reservation_to_out`
--      travava em 'convert_reservation:<op>' e `consume_all_reservations_for_order`
--      em 'consume_reservations:<op>' — chaves diferentes = os dois caminhos
--      NÃO se serializavam entre si (o Alto #5: "dois caminhos ativos = risco
--      de duplicidade"). Agora ambos travam em 'stock_debit:<op>'.
-- ============================================================================

-- ── 1) reservation_id na lista de furos ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.list_stock_debit_holes(integer);

CREATE FUNCTION public.list_stock_debit_holes(p_days integer DEFAULT 90)
 RETURNS TABLE(origem text, order_id uuid, order_number text, sale_order_number text,
               reference_name text, op_status text, product_id uuid, product_name text,
               unit text, standard_quantity numeric, actual_quantity numeric,
               diferenca numeric, valor_estimado numeric, detectado_em timestamp with time zone,
               reservation_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT 'consumo_sem_debito'::text AS origem,
         o.id, o.order_number, so.order_number, ts.name, o.status,
         p.id, COALESCE(p.name, pc.component_name), p.unit,
         round(pc.standard_quantity, 4),
         round(pc.actual_quantity, 4),
         round(pc.standard_quantity - pc.actual_quantity, 4),
         round(COALESCE(pc.standard_cost, 0) - COALESCE(pc.actual_cost, 0), 2),
         pc.created_at,
         NULL::uuid
    FROM public.production_consumptions pc
    JOIN public.orders o            ON o.id  = pc.order_id
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.products p     ON p.id  = pc.product_id
   WHERE pc.superseded_at IS NULL
     AND o.deleted_at IS NULL
     AND COALESCE(pc.standard_quantity, 0) > 0
     AND COALESCE(pc.actual_quantity, 0) = 0
     AND pc.created_at >= now() - make_interval(days => GREATEST(1, COALESCE(p_days, 90)))

  UNION ALL

  SELECT 'reserva_parcial_pendente'::text,
         o.id, o.order_number, so.order_number, ts.name, o.status,
         p.id, p.name, p.unit,
         round(mr.quantity_reserved, 4),
         round(mr.quantity_consumed, 4),
         round(mr.quantity_reserved - mr.quantity_consumed, 4),
         round((mr.quantity_reserved - mr.quantity_consumed) * COALESCE(p.unit_price, 0), 2),
         mr.updated_at,
         mr.id
    FROM public.material_reservations mr
    JOIN public.orders o            ON o.id  = mr.order_id
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.products p     ON p.id  = mr.product_id
   WHERE mr.status = 'pending_reconciliation'
     AND o.deleted_at IS NULL
     AND (mr.quantity_reserved - mr.quantity_consumed) > 0
     AND mr.updated_at >= now() - make_interval(days => GREATEST(1, COALESCE(p_days, 90)))

   ORDER BY 13 DESC NULLS LAST, 3, 8;
$function$;

GRANT EXECUTE ON FUNCTION public.list_stock_debit_holes(integer) TO authenticated;

-- ── 2) Baixa compensatória ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_stock_debit_hole(
  p_reservation_id uuid,
  p_qty            numeric DEFAULT NULL   -- NULL = tudo que couber
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res        RECORD;
  v_kind       text;
  v_pendente   numeric;
  v_alvo       numeric;
  v_prev_qty   numeric;
  v_nome       text;
  v_debitado   numeric := 0;
  v_stock_grade jsonb;
  v_new_grade  jsonb;
  v_prev_total numeric := 0;
  v_size       text;
  v_size_qty   numeric;
  v_disp       numeric;
  v_deb_size   numeric;
  v_grade      jsonb;
  v_restante   numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_res
    FROM public.material_reservations
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Pendência % não encontrada', p_reservation_id;
  END IF;
  IF v_res.status <> 'pending_reconciliation' THEN
    -- Idempotente: reconciliar 2× não erra nem debita de novo.
    RETURN jsonb_build_object('debitado', 0, 'restante', 0,
                              'status', v_res.status, 'ja_reconciliada', true);
  END IF;

  -- Mesmo lock dos dois donos do consumo: reconciliar é débito, não pode
  -- correr em paralelo com conversão/consumo da mesma OP.
  PERFORM pg_advisory_xact_lock(hashtext('stock_debit:' || v_res.order_id::text));

  v_pendente := GREATEST(0, COALESCE(v_res.quantity_reserved, 0) - COALESCE(v_res.quantity_consumed, 0));
  IF v_pendente <= 0 THEN
    UPDATE public.material_reservations
       SET status = 'converted', updated_at = now() WHERE id = v_res.id;
    RETURN jsonb_build_object('debitado', 0, 'restante', 0, 'status', 'converted');
  END IF;

  v_alvo := LEAST(COALESCE(NULLIF(p_qty, 0), v_pendente), v_pendente);
  v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

  IF v_kind = 'sole_grade' THEN
    -- Solado: o saldo devido está por NUMERAÇÃO no metadata; debita número a
    -- número o que o stock_grade comportar (mesma regra do débito parcial).
    v_grade := v_res.metadata -> 'effective_grade';
    IF v_grade IS NULL OR jsonb_typeof(v_grade) <> 'object' THEN
      RAISE EXCEPTION 'Pendência de solado sem grade no metadata — reconcilie por ajuste manual';
    END IF;
    SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_nome
      FROM public.products WHERE id = v_res.product_id FOR UPDATE;
    v_stock_grade := COALESCE(v_stock_grade, '{}'::jsonb);
    v_new_grade   := v_stock_grade;
    FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
    LOOP
      v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    END LOOP;

    FOR v_size, v_size_qty IN
      SELECT key, value::numeric FROM jsonb_each_text(v_grade) WHERE value::numeric > 0
    LOOP
      EXIT WHEN v_debitado >= v_alvo;
      v_disp     := COALESCE((v_new_grade ->> v_size)::numeric, 0);
      v_deb_size := LEAST(v_disp, v_size_qty, v_alvo - v_debitado);
      IF v_deb_size > 0 THEN
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_disp - v_deb_size));
        v_debitado  := v_debitado + v_deb_size;
      END IF;
    END LOOP;

    IF v_debitado > 0 THEN
      UPDATE public.products
         SET stock_grade = v_new_grade,
             quantity    = GREATEST(0, quantity - v_debitado),
             updated_at  = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_debitado, v_prev_total, v_prev_total - v_debitado,
              'Baixa compensatória (reconciliação de furo) — Solado por grade ('
              || COALESCE(v_nome, '') || ')', v_res.order_id);
    END IF;
  ELSE
    SELECT quantity, name INTO v_prev_qty, v_nome
      FROM public.products WHERE id = v_res.product_id FOR UPDATE;
    v_debitado := LEAST(v_alvo, GREATEST(0, COALESCE(v_prev_qty, 0)));
    IF v_debitado > 0 THEN
      UPDATE public.products
         SET quantity = quantity - v_debitado, updated_at = now()
       WHERE id = v_res.product_id;
      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'out', v_debitado, v_prev_qty, v_prev_qty - v_debitado,
              'Baixa compensatória (reconciliação de furo) — '
              || COALESCE(v_res.metadata ->> 'component', 'Material')
              || ' (' || COALESCE(v_nome, '') || ')', v_res.order_id);
    END IF;
  END IF;

  IF v_debitado <= 0 THEN
    RETURN jsonb_build_object('debitado', 0, 'restante', v_pendente,
                              'status', 'pending_reconciliation',
                              'motivo', 'sem estoque disponível para a baixa compensatória');
  END IF;

  v_restante := v_pendente - v_debitado;
  UPDATE public.material_reservations
     SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debitado,
         status            = CASE WHEN v_restante > 0 THEN 'pending_reconciliation' ELSE 'converted' END,
         notes             = COALESCE(NULLIF(notes, ''), '')
                             || ' [reconciliado ' || round(v_debitado, 4)::text
                             || CASE WHEN v_restante > 0
                                     THEN ' — restam ' || round(v_restante, 4)::text || ']'
                                     ELSE ' — furo fechado]' END,
         updated_at        = now()
   WHERE id = v_res.id;

  PERFORM public.sync_product_reserved_stock(v_res.product_id);

  RETURN jsonb_build_object(
    'debitado', round(v_debitado, 4),
    'restante', round(v_restante, 4),
    'status',   CASE WHEN v_restante > 0 THEN 'pending_reconciliation' ELSE 'converted' END,
    'product_id', v_res.product_id,
    'order_id',   v_res.order_id
  );
END;
$function$;

COMMENT ON FUNCTION public.reconcile_stock_debit_hole(uuid, numeric) IS
  'Baixa compensatória do saldo pendente (pending_reconciliation): debita o que o estoque comporta hoje, registra stock_movement e fecha/reduz a pendência. Idempotente.';

GRANT EXECUTE ON FUNCTION public.reconcile_stock_debit_hole(uuid, numeric) TO authenticated;

-- ── 3) Lock único entre os dois donos do consumo ────────────────────────────
-- Reescreve as duas funções trocando SÓ a chave do advisory lock, a partir da
-- definição VIVA (não de uma cópia colada aqui, que envelheceria).
DO $do$
DECLARE
  v_def text;
BEGIN
  FOR v_def IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('convert_reservation_to_out', 'consume_all_reservations_for_order')
  LOOP
    IF position('stock_debit:' IN v_def) = 0 THEN
      v_def := replace(v_def,
        'hashtext(''convert_reservation:'' || p_order_id::text)',
        'hashtext(''stock_debit:'' || p_order_id::text)');
      v_def := replace(v_def,
        'hashtext(''consume_reservations:'' || p_order_id::text)',
        'hashtext(''stock_debit:'' || p_order_id::text)');
      EXECUTE v_def;
    END IF;
  END LOOP;
END
$do$;
