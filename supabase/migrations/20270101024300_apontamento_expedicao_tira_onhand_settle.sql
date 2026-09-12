-- =============================================================================
-- Apontamento da Expedição: baixa de tira onhand não pode usar o writer legado
-- =============================================================================
-- Sintoma (OP-2026-01221, 12/09/2026, Central de Produção):
--   "Erro no apontamento: Escritor legado de produto de tira congelado;
--    use o catalogo canonico"
--
-- Causa:
--   Finalizar Expedição (36/36) marca a OP Finalizado. O settlement genérico
--   tenta UPDATE products.quantity em reservas source=onhand de SKU congelado
--   pelo catálogo (Meia Cana 10mm is_artisanal; Tira Strass no variants).
--   O loop de tira só reconhecia UUID/source do motor — Meia Cana escapava.
--   O UPDATE dispara tg_guard_legacy_artisanal_product_writer. O trigger de
--   settle engole a exceção, mas trg_release_reservations_on_order_terminal
--   tenta cancelar o que sobrou e sync_product_reserved_stock atualiza
--   reserved_stock SEM o token → o apontamento estoura no toast.
--
-- Correção:
--   A) product_requires_strap_engine_write espelha o guard do produto
--   B) settle roteia esses SKUs ao writer UUID (loop genérico não os escreve)
--   C) writer canônico debita reserva onhand/híbrida do próprio product_id
--      (LEAST); identidade UUID inválida de reserva do motor continua pendente
--   D) sync_product_reserved_stock liga/restaura o GUC só nesses SKUs
--
-- Marcador: apontamento_expedicao_tira_onhand_settle_20270101024300
-- =============================================================================

CREATE OR REPLACE FUNCTION public.product_requires_strap_engine_write(
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.id = p_product_id
       AND (
         coalesce(p.is_artisanal, false)
         OR coalesce(pg.is_artisanal_strap, false)
         OR coalesce(
           p.strap_migration_status IN (
             'review_required', 'resolved', 'migrated'
           ),
           false
         )
         OR public.is_legacy_strap_migration_controlled_product(p.id)
       )
  );
$function$;

COMMENT ON FUNCTION public.product_requires_strap_engine_write(uuid) IS
  'Espelha tg_guard_legacy_artisanal_product_writer: fato físico/WAC desse SKU só com token do motor de tiras.';

REVOKE ALL ON FUNCTION public.product_requires_strap_engine_write(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_requires_strap_engine_write(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_product_reserved_stock(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_previous_writer text;
  v_writer_enabled boolean := false;
BEGIN
  -- apontamento_expedicao_tira_onhand_settle_20270101024300
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(quantity_reserved - quantity_consumed), 0)
    INTO v_total
    FROM public.material_reservations
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed');

  IF public.product_requires_strap_engine_write(p_product_id) THEN
    v_previous_writer := pg_catalog.current_setting(
      'app.strap_engine_write',
      true
    );
    PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);
    v_writer_enabled := true;
  END IF;

  UPDATE public.products
     SET reserved_stock = GREATEST(0, v_total),
         updated_at = now()
   WHERE id = p_product_id
     AND reserved_stock IS DISTINCT FROM GREATEST(0, v_total);

  IF v_writer_enabled THEN
    PERFORM pg_catalog.set_config(
      'app.strap_engine_write',
      coalesce(v_previous_writer, ''),
      true
    );
    v_writer_enabled := false;
  END IF;
EXCEPTION WHEN OTHERS THEN
  IF v_writer_enabled THEN
    BEGIN
      PERFORM pg_catalog.set_config(
        'app.strap_engine_write',
        coalesce(v_previous_writer, ''),
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[sync_product_reserved_stock] falha ao restaurar GUC: %',
        SQLERRM;
    END;
  END IF;
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_canonical_strap_reservation_for_order(
  p_reservation_id uuid,
  p_reason text DEFAULT 'finalizacao_op'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_res public.material_reservations%ROWTYPE;
  v_product_qty numeric;
  v_product_name text;
  v_remaining numeric;
  v_debit numeric;
  v_shortfall numeric;
  v_correlation uuid;
  v_identity_valid boolean := false;
  v_legacy_physical boolean := false;
  v_previous_writer text;
  v_writer_enabled boolean := false;
BEGIN
  SELECT mr.*
    INTO v_res
    FROM public.material_reservations mr
   WHERE mr.id = p_reservation_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_res.status NOT IN ('reserved', 'partially_consumed') THEN
    RETURN pg_catalog.jsonb_build_object(
      'reservation_id', p_reservation_id,
      'debited', 0,
      'pending', 0,
      'skipped', true
    );
  END IF;

  v_correlation := coalesce(
    v_res.correlation_id,
    pg_catalog.md5(
      pg_catalog.format('strap-op-settlement:%s', v_res.id)
    )::uuid
  );
  v_remaining := greatest(
    coalesce(v_res.quantity_reserved, 0)
      - coalesce(v_res.quantity_consumed, 0),
    0
  );

  SELECT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
      JOIN public.artisanal_strap_variants sv
        ON sv.id = d.strap_variant_id
       AND sv.finished_product_id = d.finished_product_id
      JOIN public.orders o
        ON o.id = v_res.order_id
       AND o.sale_order_item_id = d.sale_order_item_id
     WHERE d.id = v_res.sale_order_strap_demand_id
       AND d.is_current
       AND d.strap_variant_id = v_res.strap_variant_id
       AND d.finished_product_id = v_res.product_id
       AND sv.id = v_res.strap_variant_id
       AND sv.finished_product_id = v_res.finished_product_id
  ) INTO v_identity_valid;

  -- Reserva onhand/híbrida de SKU congelado pelo catálogo: a identidade UUID
  -- canônica não existe (OP anterior ao motor). Debita o próprio product_id
  -- da reserva com o token, em vez de estourar o writer legado ou cancelar.
  v_legacy_physical :=
    public.product_requires_strap_engine_write(v_res.product_id)
    AND coalesce(v_res.source, '') NOT IN (
      'strap_engine_finished', 'strap_engine_base', 'strap_demand'
    )
    AND v_res.strap_variant_id IS NULL
    AND v_res.sale_order_strap_demand_id IS NULL
    AND v_res.finished_product_id IS NULL
    AND v_res.base_product_id IS NULL
    AND v_res.strap_stock_floor_contribution_id IS NULL
    AND v_res.strap_batch_item_id IS NULL
    AND v_res.service_order_item_id IS NULL;

  -- O token é local a este writer estreito. Ele nunca envolve o settlement
  -- genérico nem habilita escolha por order/product.
  v_previous_writer := pg_catalog.current_setting(
    'app.strap_engine_write',
    true
  );
  PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);
  v_writer_enabled := true;

  IF NOT v_legacy_physical
     AND (
       v_res.source <> 'strap_engine_finished'
       OR v_res.sale_order_strap_demand_id IS NULL
       OR v_res.strap_variant_id IS NULL
       OR v_res.finished_product_id IS DISTINCT FROM v_res.product_id
       OR NOT v_identity_valid
     ) THEN
    UPDATE public.material_reservations
       SET status = 'pending_reconciliation',
           correlation_id = v_correlation,
           updated_at = pg_catalog.now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'canonical_strap_pending', true,
                  'pending_reason', 'invalid_cross_entity_strap_identity',
                  'requires_manual_reconciliation', true,
                  'retroactive_debit_forbidden', true
                ),
           notes = coalesce(nullif(notes, ''), '')
             || ' [pendente: identidade canônica de tira inválida no settlement]'
     WHERE id = v_res.id;
    BEGIN
      PERFORM public.sync_product_reserved_stock(v_res.product_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_canonical_strap_reservation_for_order] sync falhou para produto %: %',
        v_res.product_id,
        SQLERRM;
    END;
    PERFORM pg_catalog.set_config(
      'app.strap_engine_write',
      coalesce(v_previous_writer, ''),
      true
    );
    v_writer_enabled := false;
    RETURN pg_catalog.jsonb_build_object(
      'reservation_id', v_res.id,
      'debited', 0,
      'pending', 1,
      'pending_qty', v_remaining,
      'reason', 'invalid_canonical_strap_identity'
    );
  END IF;

  SELECT p.quantity, p.name
    INTO v_product_qty, v_product_name
    FROM public.products p
   WHERE p.id = v_res.product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.material_reservations
       SET status = 'pending_reconciliation',
           correlation_id = v_correlation,
           updated_at = pg_catalog.now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'canonical_strap_pending', true,
                  'pending_reason', 'finished_product_not_found',
                  'requires_manual_reconciliation', true,
                  'retroactive_debit_forbidden', true
                ),
           notes = coalesce(nullif(notes, ''), '')
             || ' [pendente: produto acabado da tira não encontrado]'
     WHERE id = v_res.id;
    BEGIN
      PERFORM public.sync_product_reserved_stock(v_res.product_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_canonical_strap_reservation_for_order] sync falhou para produto ausente %: %',
        v_res.product_id,
        SQLERRM;
    END;
    PERFORM pg_catalog.set_config(
      'app.strap_engine_write',
      coalesce(v_previous_writer, ''),
      true
    );
    v_writer_enabled := false;
    RETURN pg_catalog.jsonb_build_object(
      'reservation_id', v_res.id,
      'debited', 0,
      'pending', 1,
      'pending_qty', v_remaining,
      'reason', 'finished_product_not_found'
    );
  END IF;

  v_debit := least(
    greatest(coalesce(v_product_qty, 0), 0),
    v_remaining
  );
  v_shortfall := greatest(v_remaining - v_debit, 0);

  IF v_debit > 0 THEN
    UPDATE public.products
       SET quantity = greatest(0, coalesce(quantity, 0) - v_debit),
           updated_at = pg_catalog.now()
     WHERE id = v_res.product_id;

    -- Reserva do motor: enrich preenche origem/WAC. Onhand legado declara
    -- production_order porque não há demanda UUID para o enrich casar.
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      description,
      movement_reason,
      order_id,
      material_reservation_id,
      origin_type,
      correlation_id
    ) VALUES (
      v_res.product_id,
      'out',
      v_debit,
      v_product_qty,
      v_product_qty - v_debit,
      CASE WHEN v_legacy_physical
           THEN 'Baixa de tira onhand na finalização — '
           ELSE 'Baixa canônica de tira acabada na finalização — '
      END
        || coalesce(v_product_name, v_res.product_id::text)
        || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END,
      'consumo_op',
      v_res.order_id,
      v_res.id,
      CASE WHEN v_legacy_physical THEN 'production_order' ELSE NULL END,
      v_correlation
    );

    UPDATE public.material_reservations
       SET status = 'consumed',
           reservation_type = 'hard',
           quantity_reserved = coalesce(quantity_consumed, 0) + v_debit,
           quantity_consumed = coalesce(quantity_consumed, 0) + v_debit,
           consumed_at = pg_catalog.now(),
           updated_at = pg_catalog.now(),
           correlation_id = v_correlation,
           metadata = coalesce(metadata, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'settled_on', p_reason,
                  'canonical_strap_writer', true,
                  'legacy_onhand_strap_settle', v_legacy_physical
                )
     WHERE id = v_res.id;

    IF v_shortfall > 0 THEN
      INSERT INTO public.material_reservations (
        order_id,
        product_id,
        quantity_reserved,
        quantity_consumed,
        status,
        reservation_type,
        source,
        notes,
        metadata,
        strap_variant_id,
        sale_order_strap_demand_id,
        strap_stock_floor_contribution_id,
        strap_batch_item_id,
        service_order_item_id,
        base_product_id,
        finished_product_id,
        correlation_id
      ) VALUES (
        v_res.order_id,
        v_res.product_id,
        v_shortfall,
        0,
        'pending_reconciliation',
        coalesce(v_res.reservation_type, 'soft'),
        v_res.source,
        'Saldo canônico de tira acabada em falta — reconciliar no motor de tiras',
        coalesce(v_res.metadata, '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
               'partial_pending', true,
               'partial_of', v_res.id::text,
               'canonical_strap_pending', true,
               'requires_manual_reconciliation', true,
               'retroactive_debit_forbidden', true
             ),
        v_res.strap_variant_id,
        v_res.sale_order_strap_demand_id,
        v_res.strap_stock_floor_contribution_id,
        v_res.strap_batch_item_id,
        v_res.service_order_item_id,
        v_res.base_product_id,
        v_res.finished_product_id,
        v_correlation
      );
    END IF;
  ELSE
    UPDATE public.material_reservations
       SET status = 'pending_reconciliation',
           updated_at = pg_catalog.now(),
           correlation_id = v_correlation,
           metadata = coalesce(metadata, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'canonical_strap_pending', true,
                  'requires_manual_reconciliation', true,
                  'retroactive_debit_forbidden', true
                ),
           notes = coalesce(nullif(notes, ''), '')
             || ' [pendente: tira acabada sem estoque na finalização — '
             || p_reason || ']'
     WHERE id = v_res.id;
  END IF;

  BEGIN
    PERFORM public.sync_product_reserved_stock(v_res.product_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      '[settle_canonical_strap_reservation_for_order] sync final falhou para produto %: %',
      v_res.product_id,
      SQLERRM;
  END;
  PERFORM pg_catalog.set_config(
    'app.strap_engine_write',
    coalesce(v_previous_writer, ''),
    true
  );
  v_writer_enabled := false;

  RETURN pg_catalog.jsonb_build_object(
    'reservation_id', v_res.id,
    'debited', CASE WHEN v_debit > 0 THEN 1 ELSE 0 END,
    'debited_qty', v_debit,
    'pending', CASE WHEN v_shortfall > 0 THEN 1 ELSE 0 END,
    'pending_qty', v_shortfall,
    'canonical_strap_writer', true
  );
EXCEPTION WHEN OTHERS THEN
  IF v_writer_enabled THEN
    BEGIN
      PERFORM pg_catalog.set_config(
        'app.strap_engine_write',
        coalesce(v_previous_writer, ''),
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_canonical_strap_reservation_for_order] falha ao restaurar GUC: %',
        SQLERRM;
    END;
  END IF;
  RAISE;
END;
$function$;


CREATE OR REPLACE FUNCTION public.settle_open_reservations_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'finalizacao'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_res record;
  v_kind text;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_prev_qty numeric;
  v_target_name text;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_prev_total numeric;
  v_effective_grade jsonb;
  v_debited_grade jsonb;
  v_shortfall_grade jsonb;
  v_debit numeric;
  v_total_debited numeric;
  v_shortfall numeric;
  v_correlation uuid;
  v_strap record;
  v_strap_result jsonb;
  v_gap_result jsonb := '{}'::jsonb;
  v_synced uuid[] := '{}'::uuid[];
  v_debited_count integer := 0;
  v_pending_count integer := 0;
  v_pending_qty numeric := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('settle_reservations:' || p_order_id::text, 0)
  );

  -- A fronteira canônica de tiras é processada por reserva UUID no writer
  -- estreito. O loop genérico nunca recebe uma identidade canônica.
  FOR v_strap IN
    SELECT mr.id
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND (
         coalesce(mr.source, '') IN (
           'strap_engine_finished', 'strap_engine_base', 'strap_demand'
         )
         OR mr.strap_variant_id IS NOT NULL
         OR mr.sale_order_strap_demand_id IS NOT NULL
         OR mr.strap_stock_floor_contribution_id IS NOT NULL
         OR mr.strap_batch_item_id IS NOT NULL
         OR mr.service_order_item_id IS NOT NULL
         OR mr.base_product_id IS NOT NULL
         OR mr.finished_product_id IS NOT NULL
         OR EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants sv
            WHERE sv.finished_product_id = mr.product_id
         )
         OR EXISTS (
           SELECT 1
             FROM public.orders strap_order
             JOIN public.sale_order_strap_demands demand
               ON demand.sale_order_item_id = strap_order.sale_order_item_id
              AND demand.is_current
            WHERE strap_order.id = p_order_id
              AND demand.finished_product_id = mr.product_id
         )
         OR public.product_requires_strap_engine_write(mr.product_id)
       )
     ORDER BY mr.created_at, mr.id
  LOOP
    BEGIN
      v_strap_result := public.settle_canonical_strap_reservation_for_order(
        v_strap.id,
        p_reason
      );
      v_debited_count := v_debited_count
        + coalesce((v_strap_result ->> 'debited')::integer, 0);
      v_pending_count := v_pending_count
        + coalesce((v_strap_result ->> 'pending')::integer, 0);
      v_pending_qty := v_pending_qty
        + coalesce((v_strap_result ->> 'pending_qty')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        PERFORM public.record_op_reserve_failure_alert(
          p_order_id,
          'Writer canônico de tira falhou para reserva ' || v_strap.id
            || ': ' || SQLERRM,
          'settlement_tira_canonica_falhou',
          'critical'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
          '[settle_open_reservations_for_order] alerta da tira % também falhou: %',
          v_strap.id,
          SQLERRM;
      END;
      RAISE WARNING
        '[settle_open_reservations_for_order] writer canônico de tira % falhou: %',
        v_strap.id,
        SQLERRM;
    END;
  END LOOP;

  FOR v_res IN
    SELECT mr.*
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND coalesce(mr.source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       )
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
       AND mr.strap_stock_floor_contribution_id IS NULL
       AND mr.strap_batch_item_id IS NULL
       AND mr.service_order_item_id IS NULL
       AND mr.base_product_id IS NULL
       AND mr.finished_product_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.artisanal_strap_variants sv
          WHERE sv.finished_product_id = mr.product_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.orders strap_order
           JOIN public.sale_order_strap_demands demand
             ON demand.sale_order_item_id = strap_order.sale_order_item_id
            AND demand.is_current
          WHERE strap_order.id = p_order_id
            AND demand.finished_product_id = mr.product_id
       )
       AND NOT public.product_requires_strap_engine_write(mr.product_id)
     ORDER BY
       CASE WHEN mr.metadata ->> 'kind' = 'sole_grade' THEN 0 ELSE 1 END,
       mr.created_at,
       mr.id
     FOR UPDATE
  LOOP
    v_kind := coalesce(v_res.metadata ->> 'kind', 'component');
    v_correlation := coalesce(
      v_res.correlation_id,
      pg_catalog.md5(
        pg_catalog.format('op-settlement:%s:%s', p_order_id, v_res.id)
      )::uuid
    );

    UPDATE public.material_reservations
       SET correlation_id = v_correlation,
           updated_at = pg_catalog.now()
     WHERE id = v_res.id
       AND correlation_id IS NULL;

    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL
         OR pg_catalog.jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'partial_pending', true,
                      'pending_reason', 'sole_without_effective_grade'
                    ),
               notes = coalesce(nullif(notes, ''), '')
                 || ' [pendente: reserva de solado sem grade efetiva — '
                 || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty
          + greatest(
              coalesce(v_res.quantity_reserved, 0)
                - coalesce(v_res.quantity_consumed, 0),
              0
            );
        CONTINUE;
      END IF;

      SELECT p.stock_grade, p.quantity, p.name
        INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products p
       WHERE p.id = v_res.product_id
       FOR UPDATE;

      IF NOT FOUND THEN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'partial_pending', true,
                      'pending_reason', 'product_not_found'
                    ),
               notes = coalesce(nullif(notes, ''), '')
                 || ' [pendente: produto de solado não encontrado]'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty
          + greatest(
              coalesce(v_res.quantity_reserved, 0)
                - coalesce(v_res.quantity_consumed, 0),
              0
            );
        CONTINUE;
      END IF;

      v_stock_grade := coalesce(v_stock_grade, '{}'::jsonb);
      v_prev_total := 0;
      FOR v_size IN
        SELECT key
          FROM pg_catalog.jsonb_object_keys(v_stock_grade) AS key
         WHERE pg_catalog.left(key, 1) <> '_'
      LOOP
        v_prev_total := v_prev_total
          + coalesce((v_stock_grade ->> v_size)::numeric, 0);
      END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      v_shortfall := 0;
      v_debited_grade := '{}'::jsonb;
      v_shortfall_grade := '{}'::jsonb;

      FOR v_size, v_size_qty IN
        SELECT grade.key, grade.value::numeric
          FROM pg_catalog.jsonb_each_text(v_effective_grade) AS grade(key, value)
         WHERE grade.value::numeric > 0
      LOOP
        v_available := coalesce(
          (v_stock_grade ->> v_size)::numeric,
          0
        );
        v_debit := least(v_available, v_size_qty);
        IF v_debit > 0 THEN
          v_new_grade := pg_catalog.jsonb_set(
            v_new_grade,
            ARRAY[v_size],
            pg_catalog.to_jsonb(v_available - v_debit)
          );
          v_total_debited := v_total_debited + v_debit;
          v_debited_grade := pg_catalog.jsonb_set(
            v_debited_grade,
            ARRAY[v_size],
            pg_catalog.to_jsonb(v_debit)
          );
        END IF;
        IF v_size_qty - v_debit > 0 THEN
          v_shortfall := v_shortfall + (v_size_qty - v_debit);
          v_shortfall_grade := pg_catalog.jsonb_set(
            v_shortfall_grade,
            ARRAY[v_size],
            pg_catalog.to_jsonb(v_size_qty - v_debit)
          );
        END IF;
      END LOOP;

      IF v_total_debited > 0 THEN
        UPDATE public.products
           SET stock_grade = v_new_grade,
               quantity = greatest(
                 0,
                 coalesce(quantity, 0) - v_total_debited
               ),
               updated_at = pg_catalog.now()
         WHERE id = v_res.product_id;

        INSERT INTO public.stock_movements (
          product_id,
          movement_type,
          quantity,
          previous_stock,
          new_stock,
          description,
          movement_reason,
          order_id,
          material_reservation_id,
          origin_type,
          correlation_id
        ) VALUES (
          v_res.product_id,
          'out',
          v_total_debited,
          v_prev_total,
          v_prev_total - v_total_debited,
          'Baixa na finalização — Solado por grade'
            || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END
            || ' (' || coalesce(v_target_name, '') || ')',
          'consumo_op',
          p_order_id,
          v_res.id,
          'production_order',
          v_correlation
        );

        UPDATE public.material_reservations
           SET status = 'consumed',
               reservation_type = 'hard',
               quantity_reserved = coalesce(quantity_consumed, 0)
                 + v_total_debited,
               quantity_consumed = coalesce(quantity_consumed, 0)
                 + v_total_debited,
               consumed_at = pg_catalog.now(),
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = pg_catalog.jsonb_set(
                   coalesce(metadata, '{}'::jsonb),
                   '{effective_grade}',
                   v_debited_grade
                 ) || pg_catalog.jsonb_build_object('settled_on', p_reason)
         WHERE id = v_res.id;
        v_debited_count := v_debited_count + 1;

        IF v_shortfall > 0 THEN
          INSERT INTO public.material_reservations (
            order_id,
            product_id,
            quantity_reserved,
            quantity_consumed,
            status,
            reservation_type,
            source,
            metadata,
            notes,
            correlation_id
          ) VALUES (
            v_res.order_id,
            v_res.product_id,
            v_shortfall,
            0,
            'pending_reconciliation',
            coalesce(v_res.reservation_type, 'soft'),
            coalesce(v_res.source, 'onhand'),
            pg_catalog.jsonb_set(
              coalesce(v_res.metadata, '{}'::jsonb),
              '{effective_grade}',
              v_shortfall_grade
            ) || pg_catalog.jsonb_build_object(
              'partial_pending', true,
              'partial_of', v_res.id::text,
              'requires_manual_reconciliation', true,
              'retroactive_debit_forbidden', true
            ),
            'Saldo de baixa parcial (solado em falta) — reconciliar ao repor estoque',
            pg_catalog.md5(
              pg_catalog.format('op-pending:%s:sole', v_res.id)
            )::uuid
          );
          v_pending_count := v_pending_count + 1;
          v_pending_qty := v_pending_qty + v_shortfall;
        END IF;
      ELSE
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'partial_pending', true,
                      'requires_manual_reconciliation', true,
                      'retroactive_debit_forbidden', true
                    ),
               notes = coalesce(nullif(notes, ''), '')
                 || ' [pendente: sem estoque do solado na finalização — '
                 || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty
          + greatest(
              coalesce(v_res.quantity_reserved, 0)
                - coalesce(v_res.quantity_consumed, 0),
              0
            );
      END IF;

      IF NOT v_res.product_id = ANY(v_synced) THEN
        v_synced := v_synced || v_res.product_id;
      END IF;
    ELSIF v_kind = 'sole_pending_grade' THEN
      -- A linha sem grade não pode comandar baixa por total. Ela é encerrada e
      -- o detector de consumo esperado, logo abaixo, cria a pendência causal.
      UPDATE public.material_reservations
         SET status = 'cancelled',
             updated_at = pg_catalog.now(),
             correlation_id = v_correlation,
             notes = coalesce(nullif(notes, ''), '')
               || ' [auto-cancelled: orphan sole_pending_grade; pendência será exposta]'
       WHERE id = v_res.id;
    ELSE
      SELECT p.quantity, p.name
        INTO v_prev_qty, v_target_name
        FROM public.products p
       WHERE p.id = v_res.product_id
       FOR UPDATE;

      IF NOT FOUND THEN
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'partial_pending', true,
                      'pending_reason', 'product_not_found',
                      'requires_manual_reconciliation', true
                    ),
               notes = coalesce(nullif(notes, ''), '')
                 || ' [pendente: produto não encontrado]'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty
          + greatest(
              coalesce(v_res.quantity_reserved, 0)
                - coalesce(v_res.quantity_consumed, 0),
              0
            );
        CONTINUE;
      END IF;

      v_debit := least(
        greatest(coalesce(v_prev_qty, 0), 0),
        greatest(
          coalesce(v_res.quantity_reserved, 0)
            - coalesce(v_res.quantity_consumed, 0),
          0
        )
      );
      v_shortfall := greatest(
        coalesce(v_res.quantity_reserved, 0)
          - coalesce(v_res.quantity_consumed, 0)
          - v_debit,
        0
      );

      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = greatest(
                 0,
                 coalesce(quantity, 0) - v_debit
               ),
               updated_at = pg_catalog.now()
         WHERE id = v_res.product_id;

        INSERT INTO public.stock_movements (
          product_id,
          movement_type,
          quantity,
          previous_stock,
          new_stock,
          description,
          movement_reason,
          order_id,
          material_reservation_id,
          origin_type,
          correlation_id
        ) VALUES (
          v_res.product_id,
          'out',
          v_debit,
          v_prev_qty,
          v_prev_qty - v_debit,
          'Baixa na finalização — '
            || coalesce(v_res.metadata ->> 'component', 'Material')
            || ' (' || coalesce(v_target_name, '') || ')'
            || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END,
          'consumo_op',
          p_order_id,
          v_res.id,
          'production_order',
          v_correlation
        );

        UPDATE public.material_reservations
           SET status = 'consumed',
               reservation_type = 'hard',
               quantity_reserved = coalesce(quantity_consumed, 0)
                 + v_debit,
               quantity_consumed = coalesce(quantity_consumed, 0)
                 + v_debit,
               consumed_at = pg_catalog.now(),
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object('settled_on', p_reason)
         WHERE id = v_res.id;
        v_debited_count := v_debited_count + 1;

        IF v_shortfall > 0 THEN
          INSERT INTO public.material_reservations (
            order_id,
            product_id,
            quantity_reserved,
            quantity_consumed,
            status,
            reservation_type,
            source,
            metadata,
            notes,
            correlation_id
          ) VALUES (
            v_res.order_id,
            v_res.product_id,
            v_shortfall,
            0,
            'pending_reconciliation',
            coalesce(v_res.reservation_type, 'soft'),
            coalesce(v_res.source, 'onhand'),
            coalesce(v_res.metadata, '{}'::jsonb)
              || pg_catalog.jsonb_build_object(
                   'partial_pending', true,
                   'partial_of', v_res.id::text,
                   'requires_manual_reconciliation', true,
                   'retroactive_debit_forbidden', true
                 ),
            'Saldo de baixa parcial (estoque insuficiente na finalização) — reconciliar ao repor',
            pg_catalog.md5(
              pg_catalog.format('op-pending:%s:component', v_res.id)
            )::uuid
          );
          v_pending_count := v_pending_count + 1;
          v_pending_qty := v_pending_qty + v_shortfall;
        END IF;
      ELSE
        UPDATE public.material_reservations
           SET status = 'pending_reconciliation',
               updated_at = pg_catalog.now(),
               correlation_id = v_correlation,
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'partial_pending', true,
                      'requires_manual_reconciliation', true,
                      'retroactive_debit_forbidden', true
                    ),
               notes = coalesce(nullif(notes, ''), '')
                 || ' [pendente: estoque zerado na finalização — '
                 || p_reason || ']'
         WHERE id = v_res.id;
        v_pending_count := v_pending_count + 1;
        v_pending_qty := v_pending_qty
          + greatest(
              coalesce(v_res.quantity_reserved, 0)
                - coalesce(v_res.quantity_consumed, 0),
              0
            );
      END IF;

      IF NOT v_res.product_id = ANY(v_synced) THEN
        v_synced := v_synced || v_res.product_id;
      END IF;
    END IF;
  END LOOP;

  BEGIN
    PERFORM public.sync_product_reserved_stock(product_id)
      FROM pg_catalog.unnest(v_synced) AS product_id;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        p_order_id,
        'Baixas foram gravadas, mas a sincronização de reserved_stock falhou: '
          || SQLERRM,
        'sync_reserved_stock_pos_baixa_falhou',
        'warning'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_open_reservations_for_order] alerta de sync também falhou para OP %: %',
        p_order_id,
        SQLERRM;
    END;
    RAISE WARNING
      '[settle_open_reservations_for_order] sync de reserved_stock falhou para OP %: %',
      p_order_id,
      SQLERRM;
  END;

  BEGIN
    v_gap_result := public.expose_expected_consumption_gaps_for_order(
      p_order_id,
      p_reason
    );
    v_pending_count := v_pending_count
      + coalesce((v_gap_result ->> 'pending_affected')::integer, 0);
    v_pending_qty := v_pending_qty
      + coalesce((v_gap_result ->> 'pending_qty')::numeric, 0);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        p_order_id,
        'Falha ao expor consumo esperado sem reserva: ' || SQLERRM,
        'exposicao_furo_reserva_falhou',
        'critical'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_open_reservations_for_order] o alerta da exposição também falhou para OP %: %',
        p_order_id,
        SQLERRM;
    END;
    RAISE WARNING
      '[settle_open_reservations_for_order] exposição de lacunas falhou para OP %: %',
      p_order_id,
      SQLERRM;
  END;

  IF v_pending_count > 0 THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        p_order_id,
        v_pending_count || ' material(is) sem baixa completa na finalização — '
          || pg_catalog.round(v_pending_qty, 2)
          || ' ficaram como pendência de reconciliação',
        'baixa_pendente',
        'warning'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[settle_open_reservations_for_order] alerta de pendência falhou para OP %: %',
        p_order_id,
        SQLERRM;
    END;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', p_order_id,
    'debited', v_debited_count,
    'pending', v_pending_count,
    'pending_qty', v_pending_qty,
    'expected_gap_result', v_gap_result
  );
END;
$function$;


COMMENT ON FUNCTION public.settle_canonical_strap_reservation_for_order(uuid, text) IS
  'Settlement UUID de tira: identidade canônica válida ou reserva onhand de SKU congelado. Token local; restaura GUC mesmo em erro.';

COMMENT ON FUNCTION public.settle_open_reservations_for_order(uuid, text) IS
  'Settlement futuro tolerante: tira congelada vai ao writer UUID; o loop genérico nunca escreve products desses SKUs. Não reconcilia histórico.';

CREATE OR REPLACE FUNCTION public.run_strap_onhand_settle_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_helper text;
  v_guard text;
  v_settle text;
  v_writer text;
  v_sync text;
BEGIN
  v_helper := pg_catalog.pg_get_functiondef(
    'public.product_requires_strap_engine_write(uuid)'::regprocedure
  );
  v_guard := pg_catalog.pg_get_functiondef(
    'public.tg_guard_legacy_artisanal_product_writer()'::regprocedure
  );
  v_settle := pg_catalog.pg_get_functiondef(
    'public.settle_open_reservations_for_order(uuid,text)'::regprocedure
  );
  v_writer := pg_catalog.pg_get_functiondef(
    'public.settle_canonical_strap_reservation_for_order(uuid,text)'::regprocedure
  );
  v_sync := pg_catalog.pg_get_functiondef(
    'public.sync_product_reserved_stock(uuid)'::regprocedure
  );

  RETURN QUERY SELECT
    'helper espelha o guard de produto de tira'::text,
    pg_catalog.strpos(v_helper, 'is_artisanal') > 0
      AND pg_catalog.strpos(v_helper, 'is_artisanal_strap') > 0
      AND pg_catalog.strpos(v_helper, 'strap_migration_status') > 0
      AND pg_catalog.strpos(
        v_helper,
        'is_legacy_strap_migration_controlled_product'
      ) > 0
      AND pg_catalog.strpos(v_guard, 'Escritor legado de produto de tira congelado') > 0,
    'classificação única compartilhada com tg_guard_legacy_artisanal_product_writer'::text;

  RETURN QUERY SELECT
    'settle roteia SKU congelado e não liga o GUC genérico'::text,
    pg_catalog.strpos(v_settle, 'app.strap_engine_write') = 0
      AND pg_catalog.strpos(
        v_settle,
        'public.product_requires_strap_engine_write(mr.product_id)'
      ) > 0
      AND pg_catalog.strpos(
        v_settle,
        'AND NOT public.product_requires_strap_engine_write(mr.product_id)'
      ) > 0
      AND pg_catalog.strpos(v_settle, 'settle_canonical_strap_reservation_for_order') > 0,
    'Meia Cana/Strass onhand não passam pelo UPDATE genérico de products'::text;

  RETURN QUERY SELECT
    'writer debita onhand e preserva pendência de identidade do motor'::text,
    pg_catalog.strpos(v_writer, 'v_legacy_physical') > 0
      AND pg_catalog.strpos(
        v_writer,
        'public.product_requires_strap_engine_write(v_res.product_id)'
      ) > 0
      AND pg_catalog.strpos(v_writer, 'NOT v_legacy_physical') > 0
      AND pg_catalog.strpos(v_writer, 'invalid_cross_entity_strap_identity') > 0
      AND pg_catalog.strpos(v_writer, 'legacy_onhand_strap_settle') > 0
      AND pg_catalog.strpos(v_writer, 'falha ao restaurar GUC') > 0
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(v_writer, 'app\.strap_engine_write', 'g')) >= 4,
    'reserva do motor com UUID quebrado continua pendente; onhand debita LEAST'::text;

  RETURN QUERY SELECT
    'sync de reserved_stock restaura o GUC do SKU congelado'::text,
    pg_catalog.strpos(v_sync, 'product_requires_strap_engine_write') > 0
      AND pg_catalog.strpos(v_sync, 'app.strap_engine_write') > 0
      AND pg_catalog.strpos(v_sync, 'v_previous_writer') > 0
      AND pg_catalog.strpos(v_sync, 'falha ao restaurar GUC') > 0
      AND pg_catalog.strpos(v_sync, 'EXCEPTION WHEN OTHERS') > 0,
    'cancelar/liquidar reserva no finalize não explode o writer legado'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_strap_onhand_settle_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_strap_onhand_settle_contract_tests()
  TO authenticated, service_role;

DO $self_test$
DECLARE
  v_failures text;
BEGIN
  SELECT pg_catalog.string_agg(
           t.case_name || ': ' || coalesce(t.message, 'falhou'),
           E'\n'
         )
    INTO v_failures
    FROM public.run_strap_onhand_settle_contract_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION
      'Contratos de settlement onhand de tira falharam:%',
      E'\n' || v_failures;
  END IF;
END;
$self_test$;

NOTIFY pgrst, 'reload schema';
