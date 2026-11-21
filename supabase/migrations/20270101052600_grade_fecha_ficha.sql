-- grade_fecha_ficha_20270101052600
--
-- Grade nova, ou grade alterada, só entra se fechar em fichas inteiras de
-- 12, 15 ou 18 (a mesma conta de resolveFicha; exact false é inválido).
-- Pedido antigo que já viola continua salvável enquanto a grade não mudar.
-- OP gerada a partir desse item antigo também passa. Não reescreve dado.
-- Não toca PV-00249.

CREATE OR REPLACE FUNCTION public.grade_ficha_violation_message(
  p_total numeric,
  p_grade jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total numeric := COALESCE(p_total, 0);
  v_sum numeric := 0;
  v_grid jsonb := '{}'::jsonb;
  v_cell record;
  v_c integer;
  v_fichas numeric;
  v_k numeric;
  v_ok boolean;
  v_broken text;
  v_curve text;
  v_add integer;
  v_best_add integer;
  v_best_c integer;
BEGIN
  IF p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object' THEN
    FOR v_cell IN SELECT key, value FROM jsonb_each_text(p_grade) LOOP
      IF left(v_cell.key, 1) = '_' THEN
        CONTINUE;
      END IF;
      IF v_cell.value ~ '^[0-9]+(\.[0-9]+)?$' AND v_cell.value::numeric > 0 THEN
        v_grid := v_grid || jsonb_build_object(v_cell.key, v_cell.value::numeric);
        v_sum := v_sum + v_cell.value::numeric;
      END IF;
    END LOOP;
  END IF;

  IF v_total <= 0 AND v_sum <= 0 THEN
    RETURN NULL;
  END IF;

  IF v_total > 0 AND v_sum > 0 THEN
    IF v_sum IN (12, 15, 18) AND v_total % v_sum = 0 THEN
      RETURN NULL;
    END IF;
    IF v_sum = v_total THEN
      FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
        IF v_total % v_c = 0 AND v_total / v_c >= 1 THEN
          v_fichas := v_total / v_c;
          v_ok := true;
          FOR v_cell IN SELECT value FROM jsonb_each_text(v_grid) LOOP
            IF v_cell.value::numeric % v_fichas <> 0 THEN
              v_ok := false;
            END IF;
          END LOOP;
          IF v_ok THEN
            RETURN NULL;
          END IF;
        END IF;
      END LOOP;
    END IF;
    IF v_sum <> v_total AND v_total % v_sum = 0 THEN
      FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
        IF v_sum % v_c <> 0 THEN
          CONTINUE;
        END IF;
        v_k := v_sum / v_c;
        v_ok := true;
        FOR v_cell IN SELECT value FROM jsonb_each_text(v_grid) LOOP
          IF v_cell.value::numeric % v_k <> 0 THEN
            v_ok := false;
          END IF;
        END LOOP;
        IF v_ok THEN
          RETURN NULL;
        END IF;
      END LOOP;
    END IF;
  END IF;

  SELECT string_agg(part.key || ':' || part.value, ' ' ORDER BY part.key)
    INTO v_curve
    FROM jsonb_each_text(v_grid) part;
  v_curve := CASE WHEN COALESCE(v_curve, '') = '' THEN ' Sem grade por numeração.'
                  ELSE ' Grade ' || v_curve || '.' END;

  IF v_total > 0 AND v_sum > 0 THEN
    FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
      IF v_total % v_c = 0 AND v_total / v_c >= 1 THEN
        v_fichas := v_total / v_c;
        SELECT string_agg(format('%s (%s)', part.key, part.value), ', ' ORDER BY part.key)
          INTO v_broken
          FROM jsonb_each_text(v_grid) part
         WHERE part.value::numeric % v_fichas <> 0;
        RETURN format(
          'A grade não fecha em ficha de 12, 15 ou 18. Total %s pares caberia em %s fichas de %s, mas a numeração %s não fecha ficha inteira.%s',
          v_total, v_fichas, v_c, COALESCE(v_broken, 'informada'), v_curve
        );
      END IF;
    END LOOP;
  END IF;

  v_best_add := NULL;
  v_best_c := NULL;
  IF v_total > 0 THEN
    FOREACH v_c IN ARRAY ARRAY[12, 15, 18] LOOP
      v_add := v_c - (v_total % v_c);
      IF v_total % v_c = 0 THEN
        CONTINUE;
      END IF;
      IF v_best_add IS NULL OR v_add < v_best_add THEN
        v_best_add := v_add;
        v_best_c := v_c;
      END IF;
    END LOOP;
  END IF;

  RETURN format(
    'A grade não fecha em ficha de 12, 15 ou 18. Total %s pares.%s%s',
    v_total,
    v_curve,
    CASE WHEN v_best_add IS NULL THEN ''
         ELSE format(' Faltam %s pares para fechar em %s.', v_best_add, v_best_c) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_ficha_violation_message(numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_ficha_violation_message(numeric, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_grade_must_close_ficha()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_msg text;
  v_legacy boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.grade IS NOT DISTINCT FROM OLD.grade THEN
    RETURN NEW;
  END IF;

  -- OP copiada de item antigo que já não fecha: o promote não pode travar.
  IF TG_TABLE_NAME = 'orders'
     AND TG_OP = 'INSERT'
     AND NEW.sale_order_item_id IS NOT NULL THEN
    SELECT public.grade_ficha_violation_message(
             COALESCE(soi.quantity, 0),
             COALESCE(soi.grade, '{}'::jsonb)
           ) IS NOT NULL
      INTO v_legacy
      FROM public.sale_order_items soi
     WHERE soi.id = NEW.sale_order_item_id;
    IF COALESCE(v_legacy, false) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_msg := public.grade_ficha_violation_message(
    COALESCE(NEW.quantity, 0),
    COALESCE(NEW.grade, '{}'::jsonb)
  );
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION '%', v_msg USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grade_must_close_ficha ON public.sale_order_items;
CREATE TRIGGER trg_grade_must_close_ficha
  BEFORE INSERT OR UPDATE OF grade ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_grade_must_close_ficha();

DROP TRIGGER IF EXISTS trg_grade_must_close_ficha ON public.orders;
CREATE TRIGGER trg_grade_must_close_ficha
  BEFORE INSERT OR UPDATE OF grade ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_grade_must_close_ficha();

-- Leitura. Não corrige pedido nenhum.
DO $ficha_auditoria$
DECLARE
  v_row record;
  v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT so.order_number,
           so.status,
           soi.color,
           COALESCE(soi.quantity, 0) AS total,
           public.grade_ficha_violation_message(COALESCE(soi.quantity, 0), COALESCE(soi.grade, '{}'::jsonb)) AS motivo
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND so.status NOT IN (
         'Faturado', 'Concluído', 'Concluido', 'Finalizado s/ NF', 'Finalizado',
         'Cancelado', 'Expedido', 'Entregue'
       )
       AND public.grade_ficha_violation_message(COALESCE(soi.quantity, 0), COALESCE(soi.grade, '{}'::jsonb)) IS NOT NULL
     ORDER BY so.order_number, soi.color
  LOOP
    v_n := v_n + 1;
    IF v_n <= 80 THEN
      RAISE NOTICE 'ficha_fora_pv % status=% cor=% total=% %',
        v_row.order_number, v_row.status, v_row.color, v_row.total, v_row.motivo;
    END IF;
  END LOOP;
  RAISE NOTICE 'ficha_fora_pv_total %', v_n;

  v_n := 0;
  FOR v_row IN
    SELECT COALESCE(so.order_number, o.order_number) AS pedido,
           o.order_number AS op,
           o.status,
           COALESCE(o.quantity, 0) AS total
      FROM public.orders o
      LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.status, '') NOT IN (
         'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
         'Concluída', 'Concluida', 'Concluído', 'Concluido', 'Faturado', 'Rascunho'
       )
       AND public.grade_ficha_violation_message(COALESCE(o.quantity, 0), COALESCE(o.grade, '{}'::jsonb)) IS NOT NULL
     ORDER BY pedido, o.order_number
  LOOP
    v_n := v_n + 1;
    IF v_n <= 40 THEN
      RAISE NOTICE 'ficha_fora_op pv=% op=% status=% total=%',
        v_row.pedido, v_row.op, v_row.status, v_row.total;
    END IF;
  END LOOP;
  RAISE NOTICE 'ficha_fora_op_total %', v_n;
END;
$ficha_auditoria$;
