-- ============================================================================
-- AUDITORIA 2026-06-09 — suspeitas confirmadas (rodada final):
--
-- 1) hybrid_debit_stock_for_order: o v_size de referência era escolhido com
--    regex `^[0-9]+$` — grade 100% CONJUGADA ("33/34") não casava, v_size
--    ficava NULL e o consumo caía na média escalar da ficha em vez do valor
--    por numeração. Fix: aceita chave conjugada usando o primeiro número
--    (split_part), igual ao calculate_order_consumption_by_grade.
--
-- 2) restore_sole_grade_for_order: não marcava as reservas restauradas —
--    re-execução (retry de cancelamento onde o restore de solado sucedeu e o
--    de produtos falhou) creditava o stock_grade DE NOVO. Agora marca
--    metadata.sole_restored_at e pula reservas já restauradas (idempotente
--    server-side; antes o guard era só client-side).
-- ============================================================================

-- ── 1. hybrid_debit: patch cirúrgico idempotente ────────────────────────────
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='hybrid_debit_stock_for_order' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN
    RAISE WARNING 'hybrid_debit_stock_for_order não encontrada — patch conjugado NÃO aplicado';
    RETURN;
  END IF;
  IF v_src LIKE '%conjugated-size-fix%' THEN RETURN; END IF;
  IF position($f$    SELECT key::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;$f$ IN v_src) = 0 THEN
    RAISE WARNING 'hybrid_debit: padrão do v_size não encontrado — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
$f$    SELECT key::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;$f$,
$f$    -- conjugated-size-fix (auditoria 2026-06-09): aceita chave conjugada
    -- "33/34" via primeiro número — grade 100% conjugada deixava v_size NULL
    -- e o consumo caía na média escalar.
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;$f$);
  EXECUTE v_src;
  RAISE NOTICE 'hybrid_debit: patch conjugado aplicado';
END
$patch$;

-- ── 2. restore_sole_grade_for_order idempotente ─────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_eff jsonb;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_total numeric;
  v_prev_total numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('restore_sole:' || p_order_id::text));

  FOR v_res IN
    SELECT id, product_id, metadata
      FROM public.material_reservations
     WHERE order_id = p_order_id
       AND (metadata ->> 'kind') = 'sole_grade'
       AND status IN ('consumed', 'converted')
       AND NOT (metadata ? 'sole_restored_at')
     FOR UPDATE
  LOOP
    v_eff := v_res.metadata -> 'effective_grade';
    IF v_eff IS NULL OR jsonb_typeof(v_eff) <> 'object' THEN CONTINUE; END IF;

    SELECT stock_grade INTO v_stock_grade FROM public.products WHERE id = v_res.product_id FOR UPDATE;
    v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);

    v_prev_total := 0;
    FOR v_size IN SELECT k FROM jsonb_object_keys(v_new_grade) AS k WHERE left(k, 1) <> '_'
    LOOP v_prev_total := v_prev_total + COALESCE((v_new_grade ->> v_size)::numeric, 0); END LOOP;

    v_total := 0;
    FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_eff) WHERE value::numeric > 0
    LOOP
      v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size],
        to_jsonb(COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty));
      v_total := v_total + v_size_qty;
    END LOOP;

    IF v_total > 0 THEN
      UPDATE public.products
         SET stock_grade = v_new_grade,
             quantity    = COALESCE(quantity, 0) + v_total,
             updated_at  = now()
       WHERE id = v_res.product_id;

      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_res.product_id, 'in', v_total, v_prev_total, v_prev_total + v_total,
              'Estorno Solado por grade (cancelamento OP)', p_order_id);
    END IF;

    -- Idempotência server-side: marca a reserva como restaurada — re-execução
    -- (retry de cancelamento parcial) não credita o solado de novo.
    UPDATE public.material_reservations
       SET metadata = metadata || jsonb_build_object('sole_restored_at', now()::text),
           updated_at = now()
     WHERE id = v_res.id;
  END LOOP;
END;
$function$;
