-- ============================================================================
-- Auditoria solados (2026-09-07): parity viva + estorno graduado + inspeção
-- ============================================================================
-- 1) run_sole_live_parity_guards() — lê o CORPO VIVO (pg_get_functiondef), não
--    o arquivo de migration. Trava:
--      - debit_sole_stock_by_grade: gate bom (sem v_variant_id AND …)
--      - calculate_order_consumption_by_grade: COALESCE no pin de variante
--      - list_sole_spec_gaps / consistency checks de cobertura
--      - smoke: by_grade com variante SEM pin de solado (quando existir)
-- 2) restore_product_stocks_for_order: produto com grade real NÃO recebe crédito
--    escalar sem numeração (spec resync-estorno-unificado §4–5). Pendência em
--    op_restore_consistency_report().
-- 3) product_groups.sole_inspection_plan jsonb — limites de lab por família
--    (Shore, abrasão, flexão…). Vazio = sem plano; NÃO inventa tolerâncias.
-- ============================================================================

-- ── 1. Guards vivos de solado ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_sole_live_parity_guards()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_debit   text;
  v_bygrade text;
  v_report  text;
  v_gaps    text;
  v_sheet   uuid;
  v_variant uuid;
  v_size    text;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_debit
    FROM pg_proc
   WHERE proname = 'debit_sole_stock_by_grade'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc
   WHERE proname = 'calculate_order_consumption_by_grade'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_report
    FROM pg_proc
   WHERE proname = 'consumption_consistency_report'
     AND pronamespace = 'public'::regnamespace;

  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_gaps
    FROM pg_proc
   WHERE proname = 'list_sole_spec_gaps'
     AND pronamespace = 'public'::regnamespace;

  case_name := 'debit_sole_existe';
  ok := v_debit IS NOT NULL;
  message := CASE WHEN ok THEN 'debit_sole_stock_by_grade presente'
                  ELSE 'debit_sole_stock_by_grade ausente' END;
  RETURN NEXT;

  case_name := 'debit_sole_fallback_ficha_com_variante';
  -- Gate bom: só produto resolvido. Gate ruim (02000): exige também variante NULL.
  ok := v_debit IS NOT NULL
    AND v_debit ~* 'IF[[:space:]]+v_resolved_product_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN'
    AND v_debit !~* 'IF[[:space:]]+v_variant_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+AND[[:space:]]+v_resolved_product_id[[:space:]]+IS[[:space:]]+NULL';
  message := CASE WHEN ok
    THEN 'gate vivo = IF v_resolved_product_id IS NULL (pin vence; ausência cai na ficha)'
    ELSE 'REGRESSÃO: gate vivo ainda exige v_variant_id IS NULL AND … — solado some com variante sem pin'
  END;
  RETURN NEXT;

  case_name := 'bygrade_variante_nao_clobber_solado';
  ok := v_bygrade IS NOT NULL
    AND v_bygrade ILIKE '%COALESCE(v_variant_sole_pid, v_sole_product_id)%'
    AND position('v_sole_product_id := v_variant_sole_pid;' in v_bygrade) = 0;
  message := CASE WHEN ok
    THEN 'by_grade vivo usa COALESCE(v_variant_sole_pid, v_sole_product_id)'
    ELSE 'REGRESSÃO: by_grade pode clobberar solado com atribuição direta da variante'
  END;
  RETURN NEXT;

  case_name := 'list_sole_spec_gaps_existe';
  ok := v_gaps IS NOT NULL;
  message := CASE WHEN ok THEN 'list_sole_spec_gaps presente'
                  ELSE 'list_sole_spec_gaps ausente' END;
  RETURN NEXT;

  case_name := 'consistency_cobertura_por_numeracao';
  ok := v_report IS NOT NULL
    AND v_report ILIKE '%solado_sem_spec_na_faixa_vendida%'
    AND v_report ILIKE '%forro_palmilha_debita_zero%'
    AND v_report ILIKE '%list_sole_spec_gaps%';
  message := CASE WHEN ok
    THEN 'consumption_consistency_report cobre spec por numeração vendida'
    ELSE 'consistency report perdeu checks de cobertura de spec'
  END;
  RETURN NEXT;

  -- Smoke: by_grade com variante SEM sole_material_product_id — não pode explodir
  -- e (quando a ficha resolve solado) deve emitir componente Solado.
  SELECT v.id INTO v_variant
    FROM public.reference_material_variants v
   WHERE v.sole_material_product_id IS NULL
     AND COALESCE(v.active, true) = true
   ORDER BY v.id
   LIMIT 1;

  SELECT ts.id, COALESCE(ts.reference_size::text, '37')
    INTO v_sheet, v_size
    FROM public.technical_sheets ts
   WHERE ts.primary_sole_id IS NOT NULL
   ORDER BY ts.id
   LIMIT 1;

  case_name := 'runtime_bygrade_variante_sem_pin_solado';
  IF v_sheet IS NULL THEN
    ok := true;
    message := 'sem ficha com primary_sole — smoke pulado';
  ELSIF v_variant IS NULL THEN
    ok := true;
    message := 'sem variante sem pin de solado — smoke estrutural ok; runtime pulado';
  ELSE
    BEGIN
      PERFORM 1
        FROM public.calculate_order_consumption_by_grade(
          v_sheet,
          jsonb_build_object(v_size, 1),
          '',
          v_variant
        );
      ok := true;
      message := 'by_grade executa com variante sem pin de solado (read-only)';
    EXCEPTION WHEN OTHERS THEN
      ok := false;
      message := 'by_grade QUEBRADO com variante sem pin: ' || SQLERRM;
    END;
  END IF;
  RETURN NEXT;

  case_name := 'restore_graded_nao_credita_escalar_cego';
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_debit
    FROM pg_proc
   WHERE proname = 'restore_product_stocks_for_order'
     AND pronamespace = 'public'::regnamespace;
  ok := v_debit IS NOT NULL
    AND (
      v_debit ILIKE '%residuo sem grade rastreavel%'
      OR v_debit ILIKE '%resíduo sem grade rastreável%'
      OR v_debit ILIKE '%op_restore_pending%'
      OR v_debit ILIKE '%nao credita residuo escalar%'
      OR v_debit ILIKE '%não credita resíduo escalar%'
    )
    AND v_debit NOT ILIKE '%residuo escalar de produto com grade; numeracao intacta%';
  message := CASE WHEN ok
    THEN 'restore_product_stocks_for_order não credita escalar cego em produto graduado'
    ELSE 'restore ainda credita resíduo escalar em produto com grade (quebra coerência)'
  END;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.run_sole_live_parity_guards() IS
  'Guards vivos do domínio solado: gate de débito+variante, COALESCE no by_grade, '
  'cobertura de spec, smoke com variante sem pin, e restore sem crédito escalar cego. '
  'Lê pg_get_functiondef — não o arquivo .sql.';

GRANT EXECUTE ON FUNCTION public.run_sole_live_parity_guards() TO authenticated, service_role;

-- ── 2. Relatório de pendências de estorno graduado ──────────────────────────
CREATE OR REPLACE FUNCTION public.op_restore_consistency_report()
 RETURNS TABLE(
   order_id uuid,
   order_number text,
   order_status text,
   product_id uuid,
   product_name text,
   product_color text,
   qtd_sem_grade numeric,
   motivo text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH net AS (
    SELECT sm.order_id,
           sm.product_id,
           COALESCE(SUM(CASE
             WHEN sm.movement_type = 'out' THEN sm.quantity
             WHEN sm.movement_type = 'in'  THEN -sm.quantity
             ELSE 0
           END), 0) AS net_debit
      FROM public.stock_movements sm
     WHERE sm.order_id IS NOT NULL
     GROUP BY sm.order_id, sm.product_id
    HAVING COALESCE(SUM(CASE
      WHEN sm.movement_type = 'out' THEN sm.quantity
      WHEN sm.movement_type = 'in'  THEN -sm.quantity
      ELSE 0
    END), 0) > 0
  ),
  graded AS (
    SELECT p.id,
           p.name,
           p.color,
           EXISTS (
             SELECT 1
               FROM jsonb_each(COALESCE(p.stock_grade, '{}'::jsonb)) g(key, value)
              WHERE left(g.key, 1) <> '_'
           ) AS has_buckets
      FROM public.products p
  ),
  pending_sole AS (
    SELECT mr.order_id,
           mr.product_id,
           COALESCE(SUM(
             CASE
               WHEN grade.value ~ '^[0-9]+(\.[0-9]+)?$' THEN grade.value::numeric
               ELSE 0
             END
           ), 0) AS pending_qty
      FROM public.material_reservations mr
      CROSS JOIN LATERAL jsonb_each_text(
        CASE
          WHEN jsonb_typeof(COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)) = 'object'
            THEN COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)
          ELSE '{}'::jsonb
        END
      ) AS grade(key, value)
     WHERE mr.metadata ->> 'kind' = 'sole_grade'
       AND mr.status IN ('consumed', 'converted')
       AND NOT COALESCE(mr.metadata ? 'sole_restored_at', false)
     GROUP BY mr.order_id, mr.product_id
  )
  SELECT o.id,
         o.order_number,
         o.status::text,
         n.product_id,
         g.name,
         g.color,
         GREATEST(n.net_debit - COALESCE(ps.pending_qty, 0), 0),
         'Produto com stock_grade real e crédito sem grade rastreável — não estornar escalar; preencher/restaurar por numeração'::text
    FROM net n
    JOIN graded g ON g.id = n.product_id AND g.has_buckets
    JOIN public.orders o ON o.id = n.order_id
    LEFT JOIN pending_sole ps ON ps.order_id = n.order_id AND ps.product_id = n.product_id
   WHERE GREATEST(n.net_debit - COALESCE(ps.pending_qty, 0), 0) > 0.0001
     AND o.status IN ('Finalizado', 'Cancelado', 'Reservado', 'Em Produção')
   ORDER BY o.order_number, g.name;
$function$;

COMMENT ON FUNCTION public.op_restore_consistency_report() IS
  'Pendências de estorno: produto graduado com resíduo sem grade rastreável. '
  'O motor não inventa numeração — a UI só lista.';

GRANT EXECUTE ON FUNCTION public.op_restore_consistency_report() TO authenticated, service_role;

-- ── 3. restore_product_stocks_for_order — não credita escalar cego ───────────
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rec record;
  v_current_qty numeric;
  v_stock_grade jsonb;
  v_grade_nonempty boolean;
  v_net_credit numeric;
  v_updated boolean;
  v_pending_sole numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id e obrigatorio' USING ERRCODE = '22004';
  END IF;

  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));

  PERFORM 1
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % nao encontrada', p_order_id USING ERRCODE = 'P0002';
  END IF;

  FOR v_rec IN
    SELECT
      sm.product_id,
      COALESCE(SUM(CASE
        WHEN sm.movement_type = 'out' THEN sm.quantity
        WHEN sm.movement_type = 'in'  THEN -sm.quantity
        ELSE 0
      END), 0) AS net_debit
    FROM public.stock_movements sm
    WHERE sm.order_id = p_order_id
    GROUP BY sm.product_id
    HAVING COALESCE(SUM(CASE
      WHEN sm.movement_type = 'out' THEN sm.quantity
      WHEN sm.movement_type = 'in'  THEN -sm.quantity
      ELSE 0
    END), 0) > 0
    ORDER BY sm.product_id
  LOOP
    v_net_credit := v_rec.net_debit;
    v_updated := false;

    SELECT p.quantity, p.stock_grade
      INTO v_current_qty, v_stock_grade
      FROM public.products p
     WHERE p.id = v_rec.product_id
     FOR UPDATE;

    IF FOUND THEN
      v_grade_nonempty := false;
      IF v_stock_grade IS NOT NULL
         AND pg_catalog.jsonb_typeof(v_stock_grade) = 'object' THEN
        SELECT EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_each(v_stock_grade) AS grade(key, value)
           WHERE pg_catalog.left(grade.key, 1) <> '_'
        ) INTO v_grade_nonempty;
      END IF;

      IF v_grade_nonempty THEN
        SELECT COALESCE(SUM(
                 CASE
                   WHEN grade.value ~ '^[0-9]+(\.[0-9]+)?$'
                     THEN grade.value::numeric
                   ELSE 0
                 END
               ), 0)
          INTO v_pending_sole
          FROM public.material_reservations mr
          CROSS JOIN LATERAL pg_catalog.jsonb_each_text(
            CASE
              WHEN pg_catalog.jsonb_typeof(
                     COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)
                   ) = 'object'
                THEN COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)
              ELSE '{}'::jsonb
            END
          ) AS grade(key, value)
         WHERE mr.order_id = p_order_id
           AND mr.product_id = v_rec.product_id
           AND mr.metadata ->> 'kind' = 'sole_grade'
           AND mr.status IN ('consumed', 'converted')
           AND NOT COALESCE(mr.metadata ? 'sole_restored_at', false);

        v_net_credit := v_net_credit - COALESCE(v_pending_sole, 0);
        -- Spec resync-estorno-unificado: resíduo SEM grade rastreável NÃO é
        -- creditado no escalar (quebraria SUM(stock_grade)==quantity). Fica
        -- visível em op_restore_consistency_report(). Nunca inventa numeração.
        IF v_net_credit > 0 THEN
          RAISE WARNING
            'restore_product_stocks_for_order: OP % produto % tem % sem grade rastreavel — nao credita residuo escalar (op_restore_pending)',
            p_order_id,
            v_rec.product_id,
            v_net_credit;
        END IF;
        v_updated := true;
      ELSE
        UPDATE public.products
           SET quantity = COALESCE(v_current_qty, 0) + v_net_credit,
               updated_at = pg_catalog.now()
         WHERE id = v_rec.product_id;

        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, COALESCE(v_current_qty, 0),
          COALESCE(v_current_qty, 0) + v_net_credit,
          'Estorno de debitos da OP (restore)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;

    IF NOT v_updated THEN
      SELECT bt.quantity
        INTO v_current_qty
        FROM public.box_types bt
       WHERE bt.id = v_rec.product_id
       FOR UPDATE;

      IF FOUND THEN
        UPDATE public.box_types
           SET quantity = COALESCE(v_current_qty, 0) + v_net_credit,
               updated_at = pg_catalog.now()
         WHERE id = v_rec.product_id;

        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, COALESCE(v_current_qty, 0),
          COALESCE(v_current_qty, 0) + v_net_credit,
          'Estorno de debitos da OP (restore - caixa)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;

    IF NOT v_updated THEN
      RAISE WARNING
        'restore_product_stocks_for_order: destino % da OP % nao existe em products/box_types; ledger permaneceu aberto',
        v_rec.product_id,
        p_order_id;
    END IF;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.restore_product_stocks_for_order(uuid) IS
  'Restaura estoque escalar da OP. Produto COM buckets reais em stock_grade: '
  'desconta pending sole_grade e NÃO credita resíduo sem numeração (pendência '
  'em op_restore_consistency_report). Sem grade: credita o net out-in.';

-- ── 4. Plano de inspeção por família de solado ──────────────────────────────
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS sole_inspection_plan jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.product_groups.sole_inspection_plan IS
  'Limites de inspeção aprovados com fornecedor/lab por família de solado '
  '(dureza Shore, abrasão ISO 20871, flexão ISO 17707, rasgo, atrito, '
  'delaminação, etc.). Objeto livre; vazio = sem plano. NÃO inventar valores.';
