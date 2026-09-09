-- Hotfix da auditoria de paridade consumo -> reserva -> baixa (25/08/2026).
--
-- Estado vivo encontrado antes desta migration:
--   * restore_product_stocks_for_order somava TODAS as saidas em cada chamada,
--     ignorava entradas de estorno anteriores e nao tratava stock_grade;
--   * restore_sole_grade_for_order tinha regredido para a grade original da OP,
--     sem ler o debito efetivo, sem movimento de entrada e sem idempotencia;
--   * o overload hybrid_debit_stock_for_order de cinco argumentos continuava
--     executavel por PUBLIC/anon e continha uma implementacao divergente;
--   * G4/G5/G22 de run_debit_guard_tests inspecionavam o wrapper ou um overload
--     arbitrario, produzindo falsos negativos depois dos wrappers de 202701.
--
-- Esta migration e autonoma contra esse estado vivo e tambem e segura na ordem
-- completa do repo (103/105 podem ja ter removido o overload de cinco args).
-- Nao reconcilia historico nem altera saldo durante o deploy: apenas redefine
-- funcoes e executa guards de introspeccao read-only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Estorno de solado: grade efetivamente debitada, ledger e idempotencia.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restore_sole_grade_for_order(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_res record;
  v_eff jsonb;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_current_qty numeric;
  v_size text;
  v_size_qty numeric;
  v_total numeric;
  v_net_debit numeric;
  v_unrestored_total numeric;
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

  -- A mesma trava do command boundary cobre, numa unica fila, grade e saldo
  -- escalar. Chamadas subsequentes dentro da transacao sao reentrantes.
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

  FOR v_res IN
    SELECT mr.id, mr.product_id, mr.metadata
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.metadata ->> 'kind' = 'sole_grade'
       AND mr.status IN ('consumed', 'converted')
       AND NOT COALESCE(mr.metadata ? 'sole_restored_at', false)
     ORDER BY mr.product_id, mr.id
     FOR UPDATE
  LOOP
    v_eff := v_res.metadata -> 'effective_grade';
    IF v_eff IS NULL OR pg_catalog.jsonb_typeof(v_eff) <> 'object' THEN
      RAISE EXCEPTION
        'Reserva de solado % da OP % nao possui effective_grade valido',
        v_res.id,
        p_order_id
        USING ERRCODE = '22023';
    END IF;

    SELECT p.quantity, p.stock_grade
      INTO v_current_qty, v_stock_grade
      FROM public.products p
     WHERE p.id = v_res.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Produto de solado % da reserva % nao existe',
        v_res.product_id,
        v_res.id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_stock_grade IS NOT NULL
       AND pg_catalog.jsonb_typeof(v_stock_grade) <> 'object' THEN
      RAISE EXCEPTION 'stock_grade invalido no solado %', v_res.product_id
        USING ERRCODE = '22023';
    END IF;

    v_new_grade := COALESCE(v_stock_grade, '{}'::jsonb);
    v_total := 0;
    FOR v_size, v_size_qty IN
      SELECT grade.key, (grade.value #>> '{}')::numeric
        FROM pg_catalog.jsonb_each(v_eff) AS grade(key, value)
       WHERE pg_catalog.left(grade.key, 1) <> '_'
    LOOP
      IF v_size_qty < 0 OR pg_catalog.trunc(v_size_qty) <> v_size_qty THEN
        RAISE EXCEPTION
          'Grade efetiva da reserva % contem quantidade invalida em %',
          v_res.id,
          v_size
          USING ERRCODE = '22023';
      END IF;
      CONTINUE WHEN v_size_qty = 0;
      v_new_grade := pg_catalog.jsonb_set(
        v_new_grade,
        ARRAY[v_size],
        pg_catalog.to_jsonb(
          COALESCE((v_new_grade ->> v_size)::numeric, 0) + v_size_qty
        )
      );
      v_total := v_total + v_size_qty;
    END LOOP;

    IF v_total <= 0 THEN
      RAISE EXCEPTION
        'Reserva de solado % da OP % nao possui quantidade efetivamente debitada',
        v_res.id,
        p_order_id
        USING ERRCODE = '22023';
    END IF;

    -- quantity_consumed/effective_grade nao provam que houve saida fisica:
    -- o estado vivo contem OPs finalizadas marcadas como consumidas, mas sem
    -- stock_movement. Creditar essas linhas criaria estoque fantasma. O ledger
    -- e a prova; quando ha apenas parte do debito, nao se inventa distribuicao
    -- por numero e a operacao para para reconciliacao.
    SELECT COALESCE(SUM(CASE
             WHEN sm.movement_type = 'out' THEN sm.quantity
             WHEN sm.movement_type = 'in'  THEN -sm.quantity
             ELSE 0
           END), 0)
      INTO v_net_debit
      FROM public.stock_movements sm
     WHERE sm.order_id = p_order_id
       AND sm.product_id = v_res.product_id;

    SELECT COALESCE(SUM((grade.value #>> '{}')::numeric), 0)
      INTO v_unrestored_total
      FROM public.material_reservations pending
      CROSS JOIN LATERAL pg_catalog.jsonb_each(
        pending.metadata -> 'effective_grade'
      ) AS grade(key, value)
     WHERE pending.order_id = p_order_id
       AND pending.product_id = v_res.product_id
       AND pending.metadata ->> 'kind' = 'sole_grade'
       AND pending.status IN ('consumed', 'converted')
       AND NOT COALESCE(pending.metadata ? 'sole_restored_at', false)
       AND pg_catalog.left(grade.key, 1) <> '_';

    IF v_net_debit <= 0.0001 THEN
      UPDATE public.material_reservations
         SET metadata = COALESCE(metadata, '{}'::jsonb)
              || pg_catalog.jsonb_build_object(
                   'sole_restored_at', pg_catalog.now()::text,
                   'sole_restored_quantity', 0,
                   'sole_restore_reason', 'sem_debito_fisico_no_ledger'
                 ),
             updated_at = pg_catalog.now()
       WHERE id = v_res.id;
      CONTINUE;
    END IF;

    IF v_net_debit + 0.0001 < v_unrestored_total THEN
      RAISE EXCEPTION
        'Ledger parcial do solado % na OP %: debito liquido %, grade pendente %. Reconciliacao manual obrigatoria',
        v_res.product_id,
        p_order_id,
        v_net_debit,
        v_unrestored_total
        USING ERRCODE = 'PZ212';
    END IF;

    -- quantity e stock_grade mudam no mesmo UPDATE para o guard de coerencia
    -- observar sempre o mesmo fato fisico.
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity = COALESCE(v_current_qty, 0) + v_total,
           updated_at = pg_catalog.now()
     WHERE id = v_res.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id
    ) VALUES (
      v_res.product_id,
      'in',
      v_total,
      COALESCE(v_current_qty, 0),
      COALESCE(v_current_qty, 0) + v_total,
      'Estorno Solado por grade (cancelamento OP)',
      p_order_id
    );

    UPDATE public.material_reservations
       SET metadata = COALESCE(metadata, '{}'::jsonb)
            || pg_catalog.jsonb_build_object(
                 'sole_restored_at', pg_catalog.now()::text,
                 'sole_restored_quantity', v_total,
                 'sole_restore_reason', 'debito_liquido_estornado'
               ),
           updated_at = pg_catalog.now()
     WHERE id = v_res.id;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.restore_sole_grade_for_order(uuid) IS
  'Estorna somente effective_grade realmente consumida, atualiza grade + quantity, gera stock_movement e marca a reserva. Serializado e idempotente.';

REVOKE ALL ON FUNCTION public.restore_sole_grade_for_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid)
  TO service_role;

DO $sole_restore_acl_compat$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.execute_production_order_command(text,uuid,uuid,jsonb)'
     ) IS NULL THEN
    GRANT EXECUTE ON FUNCTION public.restore_sole_grade_for_order(uuid)
      TO authenticated;
  END IF;
END;
$sole_restore_acl_compat$;

-- ---------------------------------------------------------------------------
-- 2. Estorno geral: credito = SUM(out) - SUM(in), serializado por OP.
-- ---------------------------------------------------------------------------

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

  -- Mesma chave do command boundary de OP. A aquisicao e reentrante quando a
  -- funcao e chamada por cancel_production_order_internal e serializa chamadas
  -- diretas legadas que poderiam calcular o mesmo net_debit simultaneamente.
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
        -- O restore por grade devolve os buckets e grava seu proprio movimento
        -- de entrada. Antes dele rodar, subtrair a grade ainda pendente evita
        -- creditar o mesmo solado no saldo escalar. Depois dele rodar, a entrada
        -- ja reduz o net_debit e sole_restored_at tira a reserva desta soma.
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
        IF v_net_credit > 0 THEN
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
            'Estorno de debitos da OP (restore - residuo escalar de produto com grade; numeracao intacta)',
            p_order_id
          );
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

    -- Embalagem legada grava stock_movements.product_id = box_types.id.
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
  'Estorna por OP somente o debito liquido SUM(out)-SUM(in). Serializado, idempotente, grade-aware e compativel com box_types; repetir a chamada com ledger zerado e no-op.';

-- Compatibilidade no deploy isolado: enquanto o novo command boundary de OP
-- nao existir, o frontend legado ainda chama esta RPC diretamente. Depois da
-- migration 108, o browser usa execute_production_order_command e o helper fica
-- restrito a service_role/implementacoes SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.restore_product_stocks_for_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid)
  TO service_role;

DO $restore_acl_compat$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.execute_production_order_command(text,uuid,uuid,jsonb)'
     ) IS NULL THEN
    GRANT EXECUTE ON FUNCTION public.restore_product_stocks_for_order(uuid)
      TO authenticated;
  END IF;
END;
$restore_acl_compat$;

-- ---------------------------------------------------------------------------
-- 3. Neutraliza o overload legado de cinco argumentos sem quebrar o resync
--    vivo que ainda pode depender dele. Na ordem completa 103/105 ja o droparam.
-- ---------------------------------------------------------------------------

DO $neutralize_legacy_hybrid$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Motor canonico hybrid_debit_stock_for_order(6 args) ausente';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'
     ) IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
        p_reference_id uuid,
        p_order_quantity numeric,
        p_color text,
        p_order_id uuid,
        p_order_grade jsonb DEFAULT NULL::jsonb
      )
      RETURNS jsonb
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = ''
      AS $shim$
        SELECT public.hybrid_debit_stock_for_order(
          p_reference_id => p_reference_id,
          p_order_quantity => p_order_quantity,
          p_color => p_color,
          p_order_id => p_order_id,
          p_order_grade => p_order_grade,
          p_force_soft => true
        )
      $shim$
    $ddl$;

    EXECUTE
      'REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role';

    EXECUTE
      'COMMENT ON FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb) IS '
      || quote_literal(
        'Shim interno temporario: delega ao motor canonico de seis argumentos com force_soft=true. Sem EXECUTE externo; migrations 103/105 o removem na ordem completa.'
      );
  END IF;

  -- O motor canonico nunca deve voltar a ficar anonimo, mesmo quando a migration
  -- e aplicada sozinha contra o estado vivo anterior ao command boundary.
  REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(
    uuid, numeric, text, uuid, jsonb, boolean
  ) FROM PUBLIC, anon;
END;
$neutralize_legacy_hybrid$;

-- ---------------------------------------------------------------------------
-- 4. Guard dedicado do hotfix.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_stock_restore_hardening_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $guard$
DECLARE
  v_sole_restore regprocedure := pg_catalog.to_regprocedure(
    'public.restore_sole_grade_for_order(uuid)'
  );
  v_restore regprocedure := pg_catalog.to_regprocedure(
    'public.restore_product_stocks_for_order(uuid)'
  );
  v_canonical regprocedure := pg_catalog.to_regprocedure(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'
  );
  v_legacy regprocedure := pg_catalog.to_regprocedure(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'
  );
  v_sole_restore_src text;
  v_restore_src text;
  v_canonical_src text;
  v_legacy_src text;
  v_boundary_exists boolean := pg_catalog.to_regprocedure(
    'public.execute_production_order_command(text,uuid,uuid,jsonb)'
  ) IS NOT NULL;
BEGIN
  IF v_sole_restore IS NOT NULL THEN
    v_sole_restore_src := pg_catalog.pg_get_functiondef(v_sole_restore);
  END IF;
  IF v_restore IS NOT NULL THEN
    v_restore_src := pg_catalog.pg_get_functiondef(v_restore);
  END IF;
  IF v_canonical IS NOT NULL THEN
    v_canonical_src := pg_catalog.pg_get_functiondef(v_canonical);
  END IF;
  IF v_legacy IS NOT NULL THEN
    v_legacy_src := pg_catalog.pg_get_functiondef(v_legacy);
  END IF;

  RETURN QUERY SELECT
    'SR1 restore usa debito liquido out-in'::text,
    v_restore IS NOT NULL
      AND position('WHEN sm.movement_type = ''out'' THEN sm.quantity' IN v_restore_src) > 0
      AND position('WHEN sm.movement_type = ''in''  THEN -sm.quantity' IN v_restore_src) > 0
      AND position('HAVING COALESCE(SUM(CASE' IN v_restore_src) > 0,
    'credito deve derivar do ledger liquido; uma entrada anterior zera/reduz o proximo estorno'::text;

  RETURN QUERY SELECT
    'SR2 restore e serializado por OP'::text,
    position('pg_advisory_xact_lock' IN COALESCE(v_restore_src, '')) > 0
      AND position('production-order:' IN COALESCE(v_restore_src, '')) > 0
      AND position('FOR UPDATE' IN COALESCE(v_restore_src, '')) > 0,
    'retry concorrente nao pode calcular o mesmo net_debit duas vezes'::text;

  RETURN QUERY SELECT
    'SR3 restore preserva grade e embalagem'::text,
    position('sole_restored_at' IN COALESCE(v_restore_src, '')) > 0
      AND position('effective_grade' IN COALESCE(v_restore_src, '')) > 0
      AND position('public.box_types' IN COALESCE(v_restore_src, '')) > 0
      AND position('residuo escalar' IN COALESCE(v_restore_src, '')) > 0,
    'solado por numero e caixa exigem caminhos de estorno distintos'::text;

  RETURN QUERY SELECT
    'SR4 restore exige origem autorizada'::text,
    position('public.is_approved_user()' IN COALESCE(v_restore_src, '')) > 0
      AND position('request.jwt.claim.role' IN COALESCE(v_restore_src, '')) > 0
      AND NOT pg_catalog.has_function_privilege(
        'anon', v_restore::oid, 'EXECUTE'
      )
      AND (
        NOT v_boundary_exists
        OR NOT pg_catalog.has_function_privilege(
          'authenticated', v_restore::oid, 'EXECUTE'
        )
      ),
    CASE
      WHEN v_boundary_exists THEN 'command boundary presente: helper nao pode ser RPC do browser'
      ELSE 'compatibilidade legada: authenticated passa pelo guard is_approved_user'
    END::text;

  RETURN QUERY SELECT
    'SR5 overload hybrid legado ausente ou shim interno seguro'::text,
    v_legacy IS NULL OR (
      position('p_force_soft => true' IN COALESCE(v_legacy_src, '')) > 0
      AND NOT pg_catalog.has_function_privilege('anon', v_legacy::oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', v_legacy::oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', v_legacy::oid, 'EXECUTE')
    ),
    CASE
      WHEN v_legacy IS NULL THEN 'overload removido pelas migrations 103/105'
      ELSE 'shim preservado apenas para caller SECURITY DEFINER legado; sem ACL externa'
    END::text;

  RETURN QUERY SELECT
    'SR6 motor hybrid canonico mantem guards operacionais'::text,
    v_canonical IS NOT NULL
      AND position('is_approved_user' IN COALESCE(v_canonical_src, '')) > 0
      AND position('pg_advisory_xact_lock' IN COALESCE(v_canonical_src, '')) > 0
      AND position('idempotent_skip' IN COALESCE(v_canonical_src, '')) > 0
      AND position('color_mismatch' IN COALESCE(v_canonical_src, '')) > 0
      AND position('variant_sole' IN COALESCE(v_canonical_src, '')) > 0
      AND NOT pg_catalog.has_function_privilege('anon', v_canonical::oid, 'EXECUTE'),
    'o shim nunca pode substituir nem rebaixar o motor de seis argumentos'::text;

  RETURN QUERY SELECT
    'SR7 restore de solado usa grade efetivamente debitada'::text,
    v_sole_restore IS NOT NULL
      AND position('effective_grade' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('material_reservations' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('stock_movements' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('sem_debito_fisico_no_ledger' IN COALESCE(v_sole_restore_src, '')) > 0,
    'grade original/quantity_consumed nao podem substituir o debito fisico provado no ledger'::text;

  RETURN QUERY SELECT
    'SR8 restore de solado fecha ledger e retry'::text,
    position('INSERT INTO public.stock_movements' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('sole_restored_at' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('Reconciliacao manual obrigatoria' IN COALESCE(v_sole_restore_src, '')) > 0
      AND position('pg_advisory_xact_lock' IN COALESCE(v_sole_restore_src, '')) > 0,
    'cada credito por grade precisa de entrada auditavel e marcador idempotente'::text;

  RETURN QUERY SELECT
    'SR9 restore de solado exige origem autorizada'::text,
    position('public.is_approved_user()' IN COALESCE(v_sole_restore_src, '')) > 0
      AND NOT pg_catalog.has_function_privilege(
        'anon', v_sole_restore::oid, 'EXECUTE'
      )
      AND (
        NOT v_boundary_exists
        OR NOT pg_catalog.has_function_privilege(
          'authenticated', v_sole_restore::oid, 'EXECUTE'
        )
      ),
    CASE
      WHEN v_boundary_exists THEN 'command boundary presente: helper de grade nao pode ser RPC do browser'
      ELSE 'compatibilidade legada: authenticated passa pelo guard is_approved_user'
    END::text;
END;
$guard$;

REVOKE ALL ON FUNCTION public.run_stock_restore_hardening_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_stock_restore_hardening_tests()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.run_stock_restore_hardening_tests() IS
  'Guard read-only do estorno liquido/idempotente, ACL do overload legado e contrato do hybrid canonico.';

-- ---------------------------------------------------------------------------
-- 5. Atualiza o guard historico sem confundir wrappers com implementacoes nem
--    escolher overload de hybrid sem assinatura. Mantem os 23 casos existentes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_debit_guard_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_def text;
  v_entry text;
  v_impl text;
  v_grade jsonb;
  v_sum numeric;
BEGIN
  v_grade := public.resolve_effective_op_grade('{"35":6,"36":6}'::jsonb, 360);
  SELECT COALESCE(SUM(value::numeric), 0)
    INTO v_sum
    FROM pg_catalog.jsonb_each_text(v_grade);
  RETURN QUERY SELECT 'G1 resolve_effective_op_grade escala grade base pro total'::text,
    (v_sum = 360), 'soma=' || v_sum::text;

  RETURN QUERY SELECT 'G2 resolve_effective_op_grade rejeita grade vazia/invalida'::text,
    (public.resolve_effective_op_grade('{}'::jsonb, 360) IS NULL
     AND public.resolve_effective_op_grade(NULL, 360) IS NULL
     AND public.resolve_effective_op_grade('{"x":"1"}'::jsonb, 360) IS NULL), NULL::text;

  v_def := pg_catalog.pg_get_functiondef(
    'public.record_order_consumption(uuid,text)'::regprocedure
  );
  RETURN QUERY SELECT 'G3 record_order_consumption escala grade base (DEB-3)'::text,
    (v_def LIKE '%resolve_effective_op_grade%'), NULL::text;

  v_entry := pg_catalog.pg_get_functiondef(
    'public.convert_reservation_to_out(uuid,uuid)'::regprocedure
  );
  IF pg_catalog.to_regprocedure(
       'public.convert_reservation_to_out_legacy_202701(uuid,uuid)'
     ) IS NOT NULL THEN
    v_impl := pg_catalog.pg_get_functiondef(
      'public.convert_reservation_to_out_legacy_202701(uuid,uuid)'::regprocedure
    );
  ELSE
    v_impl := v_entry;
  END IF;
  RETURN QUERY SELECT 'G4 convert_reservation_to_out: consumed = debitado real (DEB-1)'::text,
    (v_impl NOT LIKE '%quantity_consumed = COALESCE(quantity_reserved%'
     AND (
       v_impl LIKE '%Componente sem estoque na conversao%'
       OR v_impl LIKE '%Componente sem estoque na conversão%'
     )),
    CASE WHEN v_entry LIKE '%_legacy_202701%' THEN 'wrapper + implementacao inspecionados' ELSE NULL END;

  v_def := pg_catalog.pg_get_functiondef(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure
  );
  RETURN QUERY SELECT 'G5 hybrid_debit adia variant_sole pro debito por grade (DEB-2)'::text,
    (v_def LIKE '%variant_sole%'), 'assinatura canonica de 6 args inspecionada'::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'debit_sole_stock_by_grade';
  RETURN QUERY SELECT 'G6 debit_sole: advisory lock + idempotencia de retry (RES-7)'::text,
    (v_def LIKE '%debit_sole:%' AND v_def LIKE '%Debito Solado por grade!%%' ESCAPE '!'), NULL::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_sync_orders_from_sale_order_item';
  RETURN QUERY SELECT 'G7 tg_sync_item: falha de reserva vira erro_reserva visivel (AUD-1)'::text,
    (v_def LIKE '%erro_reserva%'), NULL::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_debit_service_order_base';
  RETURN QUERY SELECT 'G8 tg_debit_service_order_base: debito clampado + [os:id] (DEB-6)'::text,
    (v_def LIKE '%[os:%'), NULL::text;

  RETURN QUERY SELECT 'G9 release de reservas roda apos record_order_consumption (RES-3)'::text,
    (EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgname = 'trg_zz_release_reservations_on_op_cancel'
          AND tgrelid = 'public.orders'::regclass
     ) AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgname = 'trg_auto_release_reservations_on_op_cancel'
          AND tgrelid = 'public.orders'::regclass
     )), NULL::text;

  RETURN QUERY SELECT 'G10 debit_consistency_report() existe (R8 da spec)'::text,
    (pg_catalog.to_regprocedure(
       'public.debit_consistency_report(date,date,boolean)'
     ) IS NOT NULL), NULL::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade';
  RETURN QUERY SELECT 'G11 by_grade marca fallback_average + consumption_warning (CONS-1)'::text,
    (v_def LIKE '%fallback_average%' AND v_def LIKE '%consumption_warning%'), NULL::text;

  RETURN QUERY SELECT 'G12 check_stock_availability recebe variante (CONS-4)'::text,
    (EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'check_stock_availability'
          AND pg_catalog.pg_get_function_identity_arguments(p.oid)
              LIKE '%p_material_variant_id%'
     ) AND (
       SELECT COUNT(*)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability'
     ) = 1), NULL::text;

  v_def := pg_catalog.pg_get_functiondef(
    'public.record_order_consumption(uuid,text)'::regprocedure
  );
  RETURN QUERY SELECT 'G13 record_order_consumption ignora movimento de box_types (DEB-5)'::text,
    (v_def LIKE '%pp.id = sm.product_id%'), NULL::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'list_orphan_reservations';
  RETURN QUERY SELECT 'G14 list_orphan_reservations enxerga partially_consumed/residuo (RES-5)'::text,
    (v_def LIKE '%partially_consumed%' AND v_def LIKE '%> 0%'), NULL::text;

  v_def := pg_catalog.pg_get_functiondef(
    'public.restore_product_stocks_for_order(uuid)'::regprocedure
  );
  RETURN QUERY SELECT 'G15 restore estorna residuo de produto com grade (RES-9)'::text,
    (v_def LIKE '%sole_restored_at%'
     AND v_def LIKE '%residuo escalar%'
     AND v_def LIKE '%movement_type = ''in''  THEN -sm.quantity%'), NULL::text;

  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_order_consumption_by_grade';
  RETURN QUERY SELECT 'G16 by_grade usa get_effective_bom (SQL-1)'::text,
    (v_def LIKE '%get_effective_bom%'), NULL::text;

  RETURN QUERY SELECT 'G17 sobrecargas 4-arg dos resolvers dropadas (CONS-5)'::text,
    (NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'resolve_upper_material_for_variant',
            'resolve_lining_material_for_variant'
          )
          AND p.pronargs = 4
     )), NULL::text;

  RETURN QUERY SELECT 'G18 fachete resolve por fachete_material_group_id (CONS-6)'::text,
    (v_def LIKE '%fachete_material_group_id%'), NULL::text;

  RETURN QUERY SELECT 'G19 forro do cabedal sem gate de insole_has_lining (CONS-7)'::text,
    (v_def LIKE '%CONS-7%'
     AND (
       SELECT pg_catalog.pg_get_functiondef(p.oid)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'check_stock_availability'
     ) LIKE '%CONS-7%'), NULL::text;

  RETURN QUERY SELECT 'G20 guard implausivel cobre sole_technical_specs (CONS-8)'::text,
    EXISTS (
      SELECT 1
        FROM pg_catalog.pg_trigger
       WHERE tgname = 'tg_guard_implausible_sole_spec'
         AND tgrelid = 'public.sole_technical_specs'::regclass
    ), NULL::text;

  RETURN QUERY SELECT 'G21 matriz de release unificada nas 2 triggers (RES-6)'::text,
    ((
       SELECT pg_catalog.pg_get_functiondef(p.oid)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'tg_release_reservations_on_order_terminal'
     ) LIKE '%partially_consumed%'
     AND (
       SELECT pg_catalog.pg_get_functiondef(p.oid)
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'auto_release_reservations_on_op_cancel'
     ) LIKE '%Faturado%'), NULL::text;

  v_entry := pg_catalog.pg_get_functiondef(
    'public.confirm_picking_reservation(uuid,text)'::regprocedure
  );
  IF pg_catalog.to_regprocedure(
       'public.confirm_picking_reservation_legacy_202701(uuid,text)'
     ) IS NOT NULL THEN
    v_impl := pg_catalog.pg_get_functiondef(
      'public.confirm_picking_reservation_legacy_202701(uuid,text)'::regprocedure
    );
  ELSE
    v_impl := v_entry;
  END IF;
  RETURN QUERY SELECT 'G22 confirm_picking: is_approved_user + rejeita sole_grade (RES-8)'::text,
    (v_impl LIKE '%is_approved_user%'
     AND v_impl LIKE '%sole_pending_grade%'),
    CASE WHEN v_entry LIKE '%_legacy_202701%' THEN 'wrapper + implementacao inspecionados' ELSE NULL END;

  RETURN QUERY
  SELECT 'G23 quem escreve quantity_consumed tambem gera stock_movement (FURO-1)'::text,
         NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc pp
             JOIN pg_catalog.pg_namespace nn ON nn.oid = pp.pronamespace
            WHERE nn.nspname = 'public'
              AND pp.proname <> 'run_debit_guard_tests'
              AND pp.prosrc ~* 'set[^;]*quantity_consumed[[:space:]]*='
              AND pp.prosrc !~* 'insert[[:space:]]+into[[:space:]]+(public[.])?stock_movements'
         ),
         COALESCE((
           SELECT 'violam: ' || pg_catalog.string_agg(
                    pp.proname, ', ' ORDER BY pp.proname
                  )
             FROM pg_catalog.pg_proc pp
             JOIN pg_catalog.pg_namespace nn ON nn.oid = pp.pronamespace
            WHERE nn.nspname = 'public'
              AND pp.proname <> 'run_debit_guard_tests'
              AND pp.prosrc ~* 'set[^;]*quantity_consumed[[:space:]]*='
              AND pp.prosrc !~* 'insert[[:space:]]+into[[:space:]]+(public[.])?stock_movements'
         ), 'ok: toda funcao que marca consumo gera movimento');
END;
$function$;

COMMENT ON FUNCTION public.run_debit_guard_tests() IS
  'Guards de debito/reserva. Desde 20270101011200 inspeciona assinaturas canonicas e atravessa wrappers *_legacy_202701 antes de validar a implementacao.';

-- Falha o deploy antes de COMMIT se o hotfix ou qualquer um dos 23 contratos
-- historicos nao estiver efetivamente ativo. Ambas as suites sao read-only.
DO $self_test$
DECLARE
  v_failures text;
BEGIN
  SELECT pg_catalog.string_agg(
           t.case_name || ': ' || COALESCE(t.message, 'falhou'),
           E'\n'
         )
    INTO v_failures
    FROM public.run_stock_restore_hardening_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Stock restore hardening self-test falhou:%', E'\n' || v_failures;
  END IF;

  SELECT pg_catalog.string_agg(
           t.case_name || ': ' || COALESCE(t.message, 'falhou'),
           E'\n'
         )
    INTO v_failures
    FROM public.run_debit_guard_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'run_debit_guard_tests falhou apos hotfix:%', E'\n' || v_failures;
  END IF;
END;
$self_test$;

COMMIT;
