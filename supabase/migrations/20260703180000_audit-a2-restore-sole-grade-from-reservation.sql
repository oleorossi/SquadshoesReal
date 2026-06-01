-- =============================================================================
-- AUDITORIA A2 (alto): restore_sole_grade_for_order corrompe stock_grade no cancelamento
-- =============================================================================
-- O débito mapeia tamanhos individuais → chaves CONJUGADAS via get_sole_size_key
-- ('33'+'34'→'33/34'), resolve a cor da palmilha (palmilha_pronta) e escala p/ a
-- quantidade real. O restore antigo re-creditava as chaves CRUAS de orders.grade
-- (individuais, base) num produto resolvido por OUTRA query (sem lógica de palmilha)
-- → criava buckets fantasma ('33','34') enquanto o conjugado ('33/34') ficava
-- depletado, e restaurava a palmilha na cor errada. SUM(stock_grade) batia, então
-- check_grade_quantity_coherence NÃO pegava — corrupção 100% silenciosa.
--
-- Fix: reverter EXATAMENTE o que o débito fez. Lê as reservas 'sole_grade'
-- consumidas/convertidas da própria OP (product_id real + metadata.effective_grade,
-- já conjugado/escalado/cor-resolvida) e credita essas chaves de volta no MESMO
-- produto. Advisory lock + stock_movement de estorno ('in'). Reservas só reservadas
-- (não consumidas) não restauram estoque (o release da reserva basta).
-- =============================================================================
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
    SELECT product_id, metadata
      FROM public.material_reservations
     WHERE order_id = p_order_id
       AND (metadata ->> 'kind') = 'sole_grade'
       AND status IN ('consumed', 'converted')
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
  END LOOP;
END;
$function$;
