-- =============================================================================
-- Strass Comprar pronto: reserva/débito do SKU sem variante Hub (D7/R10)
-- =============================================================================
-- Spec tira-comprar-pronto-so-registra D7: strass continua debitando pelo SKU
-- (grupo+cor) sem variante. Após 45600/49800 o prepare congela buy_ready +
-- finished_product_id com strap_variant_id NULL; o enqueue 31900 pula a linha
-- e sale_order_strap_demands exige variante → zero reserva → zero baixa.
--
-- Caminho novo (paralelo ao motor de demanda):
--   sync_buy_ready_strap_sku_reservations_for_sale_order cria reserva soft
--   source='strap_buy_ready_sku' no SKU acabado, ligada à OP do item.
--   settle_canonical trata essa origem como baixa física (como onhand legado).
-- Napa sku_acabado (finished_product_id NULL) continua fora — D1.
--
-- Marcador: strass_buy_ready_sku_reserva_20270101065100
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_buy_ready_strap_sku_reservations_for_sale_order(
  p_sale_order_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_event_type text DEFAULT 'confirmed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_item record;
  v_line record;
  v_order_id uuid;
  v_product_id uuid;
  v_meters numeric;
  v_line_id uuid;
  v_needed jsonb := '[]'::jsonb;
  v_key text;
  v_existing_id uuid;
  v_row record;
  v_created integer := 0;
  v_updated integer := 0;
  v_cancelled integer := 0;
  v_skipped integer := 0;
  v_prev_writer text;
  v_writer_on boolean := false;
BEGIN
  -- strass_buy_ready_sku_reserva_20270101065100
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatorio';
  END IF;
  IF p_correlation_id IS NULL THEN
    p_correlation_id := gen_random_uuid();
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV nao encontrado';
  END IF;

  -- Cancelamento do PV: libera só as reservas reversíveis deste caminho.
  IF p_event_type = 'cancelled'
     OR v_so.status IN ('Cancelado', 'Cancelada') THEN
    FOR v_row IN
      SELECT mr.id
        FROM public.material_reservations mr
        JOIN public.orders o ON o.id = mr.order_id
       WHERE o.sale_order_id = p_sale_order_id
         AND mr.source = 'strap_buy_ready_sku'
         AND mr.status = 'reserved'
         AND coalesce(mr.quantity_consumed, 0) = 0
    LOOP
      UPDATE public.material_reservations
         SET status = 'cancelled',
             updated_at = now(),
             correlation_id = p_correlation_id,
             notes = coalesce(notes, '')
               || ' | liberada: PV cancelado / sync buy_ready sku'
       WHERE id = v_row.id;
      v_cancelled := v_cancelled + 1;
    END LOOP;
    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'event_type', p_event_type,
      'created', 0,
      'updated', 0,
      'cancelled', v_cancelled,
      'skipped', 0,
      'correlation_id', p_correlation_id
    );
  END IF;

  IF v_so.status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'event_type', p_event_type,
      'skipped_status', v_so.status,
      'correlation_id', p_correlation_id
    );
  END IF;

  -- Necessidade atual: buy_ready + SKU + sem variante Hub (strass 45600/49800).
  FOR v_item IN
    SELECT i.id AS item_id, i.strap_sourcing, i.strap_colors
      FROM public.sale_order_items i
     WHERE i.sale_order_id = p_sale_order_id
       AND i.production_excluded_at IS NULL
  LOOP
    IF jsonb_typeof(v_item.strap_sourcing) <> 'object' THEN
      CONTINUE;
    END IF;
    FOR v_line IN
      SELECT key AS line_key, value AS src
        FROM jsonb_each(v_item.strap_sourcing)
    LOOP
      IF coalesce(v_line.src ->> 'source_mode', '') IS DISTINCT FROM 'buy_ready' THEN
        CONTINUE;
      END IF;
      v_product_id := public.try_parse_uuid(v_line.src ->> 'finished_product_id');
      IF v_product_id IS NULL THEN
        CONTINUE; -- napa so-registra (D1): sem SKU
      END IF;
      IF public.try_parse_uuid(v_line.src ->> 'strap_variant_id') IS NOT NULL THEN
        CONTINUE; -- caminho clássico com variante Hub
      END IF;
      v_meters := nullif(v_line.src ->> 'gross_required_m', '')::numeric;
      IF coalesce(v_meters, 0) <= 0 THEN
        CONTINUE;
      END IF;
      v_line_id := public.try_parse_uuid(v_line.line_key);
      IF v_line_id IS NULL THEN
        v_line_id := public.try_parse_uuid(v_line.src ->> 'technical_strap_line_id');
      END IF;

      SELECT o.id INTO v_order_id
        FROM public.orders o
       WHERE o.sale_order_item_id = v_item.item_id
         AND lower(btrim(coalesce(o.status, ''))) NOT IN (
           'finalizado', 'cancelado', 'cancelada', 'completed', 'cancelled'
         )
       ORDER BY o.created_at DESC NULLS LAST
       LIMIT 1;
      IF v_order_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE; -- OP ainda não nasceu; o trigger de orders re-sincroniza
      END IF;

      v_needed := v_needed || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id,
        'item_id', v_item.item_id,
        'line_id', v_line_id,
        'product_id', v_product_id,
        'meters', v_meters
      ));
    END LOOP;
  END LOOP;

  -- Cancela reservas diretas do PV que não batem mais com a necessidade.
  FOR v_row IN
    SELECT mr.id
      FROM public.material_reservations mr
      JOIN public.orders o ON o.id = mr.order_id
     WHERE o.sale_order_id = p_sale_order_id
       AND mr.source = 'strap_buy_ready_sku'
       AND mr.status = 'reserved'
       AND coalesce(mr.quantity_consumed, 0) = 0
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_needed) n(value)
          WHERE (n.value ->> 'order_id')::uuid = mr.order_id
            AND (n.value ->> 'product_id')::uuid = mr.product_id
            AND (
              mr.metadata ->> 'technical_strap_line_id' IS NOT DISTINCT FROM
                nullif(n.value ->> 'line_id', '')
              OR (
                mr.metadata ->> 'technical_strap_line_id' IS NULL
                AND nullif(n.value ->> 'line_id', '') IS NULL
              )
            )
       )
  LOOP
    UPDATE public.material_reservations
       SET status = 'cancelled',
           updated_at = now(),
           correlation_id = p_correlation_id,
           notes = coalesce(notes, '')
             || ' | liberada: necessidade buy_ready sku ausente'
     WHERE id = v_row.id;
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- Upsert por (OP, SKU, linha técnica).
  FOR v_line IN
    SELECT
      (value ->> 'order_id')::uuid AS order_id,
      (value ->> 'item_id')::uuid AS item_id,
      public.try_parse_uuid(value ->> 'line_id') AS line_id,
      (value ->> 'product_id')::uuid AS product_id,
      (value ->> 'meters')::numeric AS meters
      FROM jsonb_array_elements(v_needed) AS t(value)
  LOOP
    SELECT mr.id INTO v_existing_id
      FROM public.material_reservations mr
     WHERE mr.order_id = v_line.order_id
       AND mr.product_id = v_line.product_id
       AND mr.source = 'strap_buy_ready_sku'
       AND mr.status IN ('reserved', 'partially_consumed')
       AND (
         mr.metadata ->> 'technical_strap_line_id' IS NOT DISTINCT FROM
           v_line.line_id::text
         OR (v_line.line_id IS NULL AND mr.metadata ->> 'technical_strap_line_id' IS NULL)
       )
     ORDER BY mr.created_at
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.material_reservations
         SET quantity_reserved = greatest(coalesce(quantity_consumed, 0), v_line.meters),
             updated_at = now(),
             correlation_id = p_correlation_id,
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'strap_buy_ready_sku_direct', true,
               'sale_order_id', p_sale_order_id,
               'sale_order_item_id', v_line.item_id,
               'technical_strap_line_id', v_line.line_id,
               'gross_required_m', v_line.meters
             )
       WHERE id = v_existing_id
         AND quantity_reserved IS DISTINCT FROM
             greatest(coalesce(quantity_consumed, 0), v_line.meters);
      IF FOUND THEN
        v_updated := v_updated + 1;
      END IF;
    ELSE
      INSERT INTO public.material_reservations (
        order_id, product_id, quantity_reserved, quantity_consumed, status,
        reservation_type, source, notes, metadata, correlation_id
      ) VALUES (
        v_line.order_id,
        v_line.product_id,
        v_line.meters,
        0,
        'reserved',
        'soft',
        'strap_buy_ready_sku',
        'Reserva de tira acabada (Comprar pronto sem variante Hub)',
        jsonb_build_object(
          'strap_buy_ready_sku_direct', true,
          'consumption_sector', 'Aviamento',
          'sale_order_id', p_sale_order_id,
          'sale_order_item_id', v_line.item_id,
          'technical_strap_line_id', v_line.line_id,
          'gross_required_m', v_line.meters
        ),
        p_correlation_id
      );
      v_created := v_created + 1;
    END IF;

    -- reserved_stock do SKU de tira exige token do motor.
    IF public.product_requires_strap_engine_write(v_line.product_id) THEN
      v_prev_writer := current_setting('app.strap_engine_write', true);
      PERFORM set_config('app.strap_engine_write', '1', true);
      v_writer_on := true;
    END IF;
    BEGIN
      PERFORM public.sync_product_reserved_stock(v_line.product_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[sync_buy_ready_strap_sku_reservations] sync reserved_stock %: %',
        v_line.product_id, SQLERRM;
    END;
    IF v_writer_on THEN
      PERFORM set_config('app.strap_engine_write', coalesce(v_prev_writer, ''), true);
      v_writer_on := false;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'event_type', p_event_type,
    'needed', jsonb_array_length(v_needed),
    'created', v_created,
    'updated', v_updated,
    'cancelled', v_cancelled,
    'skipped_no_op', v_skipped,
    'correlation_id', p_correlation_id
  );
END;
$fn$;

COMMENT ON FUNCTION public.sync_buy_ready_strap_sku_reservations_for_sale_order(uuid, uuid, text) IS
  'D7: reserva soft do SKU de strass Comprar pronto sem variante Hub; napa sku_acabado (sem finished_product_id) nao entra.';

REVOKE ALL ON FUNCTION public.sync_buy_ready_strap_sku_reservations_for_sale_order(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_buy_ready_strap_sku_reservations_for_sale_order(uuid, uuid, text)
  TO authenticated, service_role;

-- Chama o sync em todo enqueue (approve/cancel/item/schedule).
DO $patch_enqueue$
DECLARE
  v_fn regprocedure := 'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure;
  v_def text;
  v_old text := $old$  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;$old$;
  v_new text := $new$  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  -- strass_buy_ready_sku_reserva_20270101065100
  PERFORM public.sync_buy_ready_strap_sku_reservations_for_sale_order(
    p_sale_order_id, p_correlation_id, p_event_type
  );$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.enqueue_sale_order_strap_demands(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'enqueue_sale_order_strap_demands ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strass_buy_ready_sku_reserva_20270101065100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Portao de permissao do enqueue nao encontrado (hits=%); revise 65100',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_enqueue$;

-- Quando a OP nasce depois do approve, amarra a reserva ao order_id.
CREATE OR REPLACE FUNCTION public.tg_sync_buy_ready_strap_sku_on_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE
  v_sale_order_id uuid;
  v_status text;
BEGIN
  -- strass_buy_ready_sku_reserva_20270101065100
  IF NEW.sale_order_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT i.sale_order_id, so.status
    INTO v_sale_order_id, v_status
    FROM public.sale_order_items i
    JOIN public.sale_orders so ON so.id = i.sale_order_id
   WHERE i.id = NEW.sale_order_item_id;
  IF v_sale_order_id IS NOT NULL
     AND v_status IN ('Aprovado', 'Em Produção') THEN
    PERFORM public.sync_buy_ready_strap_sku_reservations_for_sale_order(
      v_sale_order_id, gen_random_uuid(), 'op_created'
    );
  END IF;
  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_sync_buy_ready_strap_sku_on_op ON public.orders;
CREATE CONSTRAINT TRIGGER trg_sync_buy_ready_strap_sku_on_op
  AFTER INSERT OR UPDATE OF sale_order_item_id, status
  ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_buy_ready_strap_sku_on_op();

-- settle_canonical: origem strap_buy_ready_sku debita como onhand legado.
DO $patch_settle$
DECLARE
  v_fn regprocedure :=
    'public.settle_canonical_strap_reservation_for_order(uuid,text)'::regprocedure;
  v_def text;
  v_old text := $old$  v_legacy_physical :=
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
    AND v_res.service_order_item_id IS NULL;$old$;
  v_new text := $new$  -- strass_buy_ready_sku_reserva_20270101065100
  -- D7: buy_ready sem variante Hub baixa o SKU pinado (sem demanda/variante).
  v_legacy_physical :=
    (
      coalesce(v_res.source, '') = 'strap_buy_ready_sku'
      AND v_res.strap_variant_id IS NULL
      AND v_res.sale_order_strap_demand_id IS NULL
      AND v_res.finished_product_id IS NULL
      AND v_res.base_product_id IS NULL
      AND v_res.strap_stock_floor_contribution_id IS NULL
      AND v_res.strap_batch_item_id IS NULL
      AND v_res.service_order_item_id IS NULL
    )
    OR (
      public.product_requires_strap_engine_write(v_res.product_id)
      AND coalesce(v_res.source, '') NOT IN (
        'strap_engine_finished', 'strap_engine_base', 'strap_demand',
        'strap_buy_ready_sku'
      )
      AND v_res.strap_variant_id IS NULL
      AND v_res.sale_order_strap_demand_id IS NULL
      AND v_res.finished_product_id IS NULL
      AND v_res.base_product_id IS NULL
      AND v_res.strap_stock_floor_contribution_id IS NULL
      AND v_res.strap_batch_item_id IS NULL
      AND v_res.service_order_item_id IS NULL
    );$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure(
    'public.settle_canonical_strap_reservation_for_order(uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'settle_canonical_strap_reservation_for_order ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strass_buy_ready_sku_reserva_20270101065100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Bloco v_legacy_physical do settle_canonical nao encontrado (hits=%); revise 65100',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_settle$;

-- settle_open: inclui a origem nova no loop canônico de tira.
DO $patch_settle_open$
DECLARE
  v_fn regprocedure :=
    'public.settle_open_reservations_for_order(uuid,text)'::regprocedure;
  v_def text;
  v_old text := $old$         coalesce(mr.source, '') IN (
           'strap_engine_finished', 'strap_engine_base', 'strap_demand'
         )$old$;
  v_new text := $new$         coalesce(mr.source, '') IN (
           'strap_engine_finished', 'strap_engine_base', 'strap_demand',
           'strap_buy_ready_sku'
         )$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure(
    'public.settle_open_reservations_for_order(uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'settle_open_reservations_for_order ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('''strap_buy_ready_sku''' IN v_def) > 0
     AND position('strass_buy_ready_sku_reserva_20270101065100' IN v_def) = 0 THEN
    -- Pode já ter a string por outro motivo; marcamos com comentário via replace
    -- só se o bloco clássico de 3 fontes ainda existir.
    NULL;
  END IF;
  IF position('strap_buy_ready_sku' IN v_def) > 0
     AND position('''strap_engine_finished'', ''strap_engine_base'', ''strap_demand'',
           ''strap_buy_ready_sku''' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Lista de sources do settle_open nao encontrada (hits=%); revise 65100',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  -- Marcador em COMMENT da função (se existir) não é obrigatório; o source basta.
  EXECUTE v_def;
END;
$patch_settle_open$;

-- Backfill: PVs abertos com strass buy_ready sem variante ganham a reserva.
DO $backfill$
DECLARE
  v_id uuid;
  v_n integer := 0;
BEGIN
  FOR v_id IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      JOIN public.sale_order_items i ON i.sale_order_id = so.id
     WHERE so.status IN ('Aprovado', 'Em Produção')
       AND i.production_excluded_at IS NULL
       AND EXISTS (
         SELECT 1
           FROM jsonb_each(coalesce(i.strap_sourcing, '{}'::jsonb)) x(key, value)
          WHERE coalesce(x.value ->> 'source_mode', '') = 'buy_ready'
            AND nullif(x.value ->> 'finished_product_id', '') IS NOT NULL
            AND nullif(x.value ->> 'strap_variant_id', '') IS NULL
            AND coalesce(nullif(x.value ->> 'gross_required_m', '')::numeric, 0) > 0
       )
  LOOP
    PERFORM public.sync_buy_ready_strap_sku_reservations_for_sale_order(
      v_id, gen_random_uuid(), 'backfill'
    );
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'strass_buy_ready_sku backfill: % PVs sincronizados', v_n;
END;
$backfill$;
