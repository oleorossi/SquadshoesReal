-- Rastreabilidade causal e exposição dos furos OP -> reserva -> movimento.
--
-- Esta migration corrige apenas os escritores FUTUROS. Ela não atualiza saldo,
-- não cria movimento compensatório e não reprocessa OP terminal no deploy. Os
-- furos históricos continuam somente nas views/diagnósticos, conforme a decisão
-- explícita de não desmentir inventários já conferidos.

BEGIN;

-- `origin_type` nasceu no módulo de tiras. O mesmo ledger agora identifica a
-- origem genérica de produção sem confundi-la com fábrica/terceiro de tiras.
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_strap_origin_type_ck;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_strap_origin_type_ck CHECK (
    origin_type IS NULL OR origin_type IN (
      'internal_factory', 'internal_contractor', 'buy_ready', 'production_order'
    )
  );

CREATE INDEX IF NOT EXISTS stock_movements_material_reservation_idx
  ON public.stock_movements(material_reservation_id, movement_type)
  WHERE material_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS material_reservations_order_pending_idx
  ON public.material_reservations(order_id, product_id, status)
  WHERE status = 'pending_reconciliation';

CREATE UNIQUE INDEX IF NOT EXISTS material_reservations_finalization_gap_uq
  ON public.material_reservations(correlation_id)
  WHERE source = 'finalization_gap'
    AND correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Todo OUT futuro que já possui uma reserva (ou consegue identificar uma
--    reserva ativa exata da mesma OP/produto) recebe identidade e correlação.
--    O fluxo canônico de tiras fica fora: seus triggers já preservam uma
--    identidade mais granular por demanda/evento.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_trace_op_stock_movement_from_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_res record;
  v_candidate_id uuid;
  v_correlation uuid;
  v_is_canonical_strap_product boolean := false;
BEGIN
  IF NEW.movement_type <> 'out' OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants sv
            WHERE sv.finished_product_id = NEW.product_id
         ) OR EXISTS (
           SELECT 1
             FROM public.orders strap_order
             JOIN public.sale_order_strap_demands demand
               ON demand.sale_order_item_id = strap_order.sale_order_item_id
              AND demand.is_current
            WHERE strap_order.id = NEW.order_id
              AND demand.finished_product_id = NEW.product_id
         )
    INTO v_is_canonical_strap_product;

  IF NEW.material_reservation_id IS NULL
     AND (
       v_is_canonical_strap_product
       OR NEW.correlation_id IS NULL
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.material_reservation_id IS NOT NULL THEN
    SELECT mr.*
      INTO v_res
      FROM public.material_reservations mr
     WHERE mr.id = NEW.material_reservation_id
       AND mr.order_id = NEW.order_id
       AND mr.product_id = NEW.product_id
     FOR UPDATE OF mr;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = pg_catalog.format(
          'Vínculo causal inválido: reserva % não pertence simultaneamente à OP % e ao produto %',
          NEW.material_reservation_id,
          NEW.order_id,
          NEW.product_id
        );
    END IF;
  ELSE
    -- Nunca escolhe "a primeira" reserva de forma ambígua. O bind antecipado
    -- só ocorre quando há uma única reserva cujo saldo casa com o movimento;
    -- writers movimento->reserva são ligados pelo trigger posterior.
    WITH candidates AS MATERIALIZED (
      SELECT mr.id
        FROM public.material_reservations mr
       WHERE mr.order_id = NEW.order_id
         AND mr.product_id = NEW.product_id
         AND mr.correlation_id = NEW.correlation_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND pg_catalog.abs(
               greatest(
                 coalesce(mr.quantity_reserved, 0)
                   - coalesce(mr.quantity_consumed, 0),
                 0
               ) - NEW.quantity
             ) <= 0.0001
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
    )
    SELECT c.id
      INTO v_candidate_id
      FROM candidates c
     WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1;

    IF v_candidate_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- O UUID é só a descoberta. A linha-base é relida, revalidada e travada
    -- depois, evitando confiar no snapshot intermediário da CTE.
    SELECT mr.*
      INTO v_res
      FROM public.material_reservations mr
     WHERE mr.id = v_candidate_id
       AND mr.order_id = NEW.order_id
       AND mr.product_id = NEW.product_id
       AND mr.correlation_id = NEW.correlation_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND pg_catalog.abs(
             greatest(
               coalesce(mr.quantity_reserved, 0)
                 - coalesce(mr.quantity_consumed, 0),
               0
             ) - NEW.quantity
           ) <= 0.0001
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
     FOR UPDATE OF mr;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_res.id IS NULL
     OR coalesce(v_res.source, '') IN (
       'strap_engine_finished', 'strap_engine_base', 'strap_demand'
     )
     OR v_res.strap_variant_id IS NOT NULL
     OR v_res.sale_order_strap_demand_id IS NOT NULL
     OR v_res.strap_stock_floor_contribution_id IS NOT NULL
     OR v_res.strap_batch_item_id IS NOT NULL
     OR v_res.service_order_item_id IS NOT NULL
     OR v_res.base_product_id IS NOT NULL
     OR v_res.finished_product_id IS NOT NULL
     OR v_is_canonical_strap_product THEN
    RETURN NEW;
  END IF;

  v_correlation := coalesce(
    NEW.correlation_id,
    v_res.correlation_id,
    pg_catalog.md5(
      pg_catalog.format('op-reservation:%s', v_res.id)
    )::uuid
  );

  NEW.material_reservation_id := v_res.id;
  NEW.origin_type := coalesce(NEW.origin_type, 'production_order');
  NEW.correlation_id := v_correlation;
  NEW.movement_reason := coalesce(NEW.movement_reason, 'consumo_op');

  UPDATE public.material_reservations
     SET correlation_id = v_correlation,
         updated_at = pg_catalog.now()
   WHERE id = v_res.id
     AND correlation_id IS NULL;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_trace_op_stock_movement_from_reservation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_a_trace_op_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_a_trace_op_stock_movement
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_trace_op_stock_movement_from_reservation();

-- Alguns escritores inserem o movimento antes de criar/consumir a reserva. O
-- segundo trigger só liga quando ambos já carregam o MESMO correlation_id;
-- horário/quantidade sozinhos não provam causalidade entre transações.
CREATE OR REPLACE FUNCTION public.tg_attach_op_movement_after_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_delta numeric;
  v_movement_id uuid;
  v_correlation uuid;
BEGIN
  IF NEW.order_id IS NULL
     OR NEW.correlation_id IS NULL
     OR coalesce(NEW.source, '') IN (
       'strap_engine_finished', 'strap_engine_base', 'strap_demand'
     )
     OR NEW.strap_variant_id IS NOT NULL
     OR NEW.sale_order_strap_demand_id IS NOT NULL
     OR NEW.strap_stock_floor_contribution_id IS NOT NULL
     OR NEW.strap_batch_item_id IS NOT NULL
     OR NEW.service_order_item_id IS NOT NULL
     OR NEW.base_product_id IS NOT NULL
     OR NEW.finished_product_id IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM public.artisanal_strap_variants sv
        WHERE sv.finished_product_id = NEW.product_id
     )
     OR EXISTS (
       SELECT 1
         FROM public.orders strap_order
         JOIN public.sale_order_strap_demands demand
           ON demand.sale_order_item_id = strap_order.sale_order_item_id
          AND demand.is_current
        WHERE strap_order.id = NEW.order_id
          AND demand.finished_product_id = NEW.product_id
     ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_delta := greatest(
      coalesce(NEW.quantity_consumed, 0),
      0
    );
  ELSE
    v_delta := greatest(
      coalesce(NEW.quantity_consumed, 0)
        - coalesce(OLD.quantity_consumed, 0),
      0
    );
  END IF;

  IF v_delta <= 0 THEN
    RETURN NEW;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT sm.id
      FROM public.stock_movements sm
     WHERE sm.order_id = NEW.order_id
       AND sm.product_id = NEW.product_id
       AND sm.movement_type = 'out'
       AND sm.material_reservation_id IS NULL
       AND sm.correlation_id = NEW.correlation_id
       AND sm.strap_variant_id IS NULL
       AND sm.sale_order_strap_demand_id IS NULL
       AND sm.strap_stock_floor_contribution_id IS NULL
       AND sm.strap_batch_item_id IS NULL
       AND sm.service_order_item_id IS NULL
       AND sm.base_product_id IS NULL
       AND sm.finished_product_id IS NULL
       AND pg_catalog.abs(sm.quantity - v_delta) <= 0.0001
  )
  SELECT c.id
    INTO v_movement_id
    FROM candidates c
   WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1;

  IF v_movement_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Assim como no trigger movimento->reserva, a CTE só descobre o UUID. O
  -- movimento real é relido, revalidado e travado antes do vínculo.
  PERFORM 1
    FROM public.stock_movements sm
   WHERE sm.id = v_movement_id
     AND sm.order_id = NEW.order_id
     AND sm.product_id = NEW.product_id
     AND sm.movement_type = 'out'
     AND sm.material_reservation_id IS NULL
     AND sm.correlation_id = NEW.correlation_id
     AND sm.strap_variant_id IS NULL
     AND sm.sale_order_strap_demand_id IS NULL
     AND sm.strap_stock_floor_contribution_id IS NULL
     AND sm.strap_batch_item_id IS NULL
     AND sm.service_order_item_id IS NULL
     AND sm.base_product_id IS NULL
     AND sm.finished_product_id IS NULL
     AND pg_catalog.abs(sm.quantity - v_delta) <= 0.0001
   FOR UPDATE OF sm;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_correlation := NEW.correlation_id;

  UPDATE public.stock_movements
     SET material_reservation_id = NEW.id,
         origin_type = coalesce(origin_type, 'production_order'),
         correlation_id = coalesce(correlation_id, v_correlation),
         movement_reason = coalesce(movement_reason, 'consumo_op')
   WHERE id = v_movement_id;

  UPDATE public.material_reservations
     SET correlation_id = v_correlation,
         updated_at = pg_catalog.now()
   WHERE id = NEW.id
     AND correlation_id IS NULL;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_attach_op_movement_after_reservation_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_b_attach_op_movement_after_reservation
  ON public.material_reservations;
CREATE TRIGGER trg_b_attach_op_movement_after_reservation
  AFTER INSERT OR UPDATE OF quantity_consumed, status
  ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_attach_op_movement_after_reservation_write();

-- O binder canônico vivo (migration 032) deixava o bypass de tiras ligado pelo
-- resto da transação de mudança de status. A versão abaixo encapsula o token e
-- restaura exatamente o valor anterior, inclusive em exceção.
CREATE OR REPLACE FUNCTION public.bind_strap_finished_reservations_to_order(
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer := 0;
  v_previous_writer text;
  v_writer_enabled boolean := false;
BEGIN
  v_previous_writer := pg_catalog.current_setting(
    'app.strap_engine_write',
    true
  );
  PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);
  v_writer_enabled := true;

  UPDATE public.material_reservations r
     SET order_id = p_order_id,
         metadata = coalesce(r.metadata, '{}'::jsonb)
           || pg_catalog.jsonb_build_object('bound_order_id', p_order_id),
         updated_at = pg_catalog.now()
    FROM public.sale_order_strap_demands d,
         public.orders o
   WHERE o.id = p_order_id
     AND o.sale_order_item_id = d.sale_order_item_id
     AND d.is_current
     AND r.sale_order_strap_demand_id = d.id
     AND r.strap_variant_id = d.strap_variant_id
     AND r.finished_product_id = d.finished_product_id
     AND r.product_id = d.finished_product_id
     AND r.source = 'strap_engine_finished'
     AND r.order_id IS NULL
     AND r.status IN ('reserved', 'partially_consumed');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'app.strap_engine_write',
    coalesce(v_previous_writer, ''),
    true
  );
  v_writer_enabled := false;
  RETURN v_count;
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
        '[bind_strap_finished_reservations_to_order] falha ao restaurar GUC: %',
        SQLERRM;
    END;
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.bind_strap_finished_reservations_to_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_bind_strap_finished_reservations_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_error text;
BEGIN
  IF NEW.sale_order_item_id IS NOT NULL THEN
    PERFORM public.bind_strap_finished_reservations_to_order(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  v_error := SQLERRM;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN (
         'Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido'
       )
       AND coalesce(OLD.status, '') IS DISTINCT FROM NEW.status THEN
      BEGIN
        PERFORM public.record_op_reserve_failure_alert(
          NEW.id,
          'Binder de tira acabada falhou antes da finalização; reconciliar demanda/reserva: '
            || v_error,
          'bind_tira_finalizacao_falhou',
          'critical'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
          '[tg_bind_strap_finished_reservations_to_order] alerta também falhou para OP %: %',
          NEW.id,
          SQLERRM;
      END;
      RAISE WARNING
        '[tg_bind_strap_finished_reservations_to_order] OP % seguirá terminal sem bind: %',
        NEW.id,
        v_error;
      RETURN NEW;
    END IF;
  END IF;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_bind_strap_finished_reservations_to_order()
  FROM PUBLIC, anon, authenticated, service_role;

-- O writer explícito desta migration já insere material_reservation_id. O
-- attach legado passa a aceitar idempotentemente o MESMO UUID, mas continua
-- falhando fechado se o event key apontar outra reserva/OP/produto/quantidade.
CREATE OR REPLACE FUNCTION public.tg_attach_strap_finished_movement_to_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_delta numeric;
  v_event_id uuid;
  v_existing_reservation_id uuid;
  v_source text;
  v_cost numeric;
  v_previous_writer text;
  v_writer_enabled boolean := false;
BEGIN
  IF NEW.source <> 'strap_engine_finished'
     OR NEW.sale_order_strap_demand_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := greatest(
    coalesce(NEW.quantity_consumed, 0) - coalesce(OLD.quantity_consumed, 0),
    0
  );
  IF v_delta <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_event_id := nullif(
      pg_catalog.current_setting('app.strap_last_movement_event', true),
      ''
    )::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_event_id := NULL;
  END;

  SELECT sm.material_reservation_id
    INTO v_existing_reservation_id
    FROM public.stock_movements sm
   WHERE sm.strap_movement_event_id = v_event_id
     AND sm.order_id IS NOT DISTINCT FROM NEW.order_id
     AND sm.product_id = NEW.product_id
     AND sm.movement_type = 'out'
     AND pg_catalog.abs(sm.quantity - v_delta) <= 0.0001
   FOR UPDATE OF sm;

  IF NOT FOUND
     OR (
       v_existing_reservation_id IS NOT NULL
       AND v_existing_reservation_id IS DISTINCT FROM NEW.id
     ) THEN
    RAISE EXCEPTION
      'Baixa da reserva canônica % sem event key causal exata de quantidade %',
      NEW.id,
      v_delta;
  END IF;

  SELECT d.source_mode, p.unit_price
    INTO v_source, v_cost
    FROM public.sale_order_strap_demands d
    JOIN public.products p ON p.id = NEW.product_id
   WHERE d.id = NEW.sale_order_strap_demand_id
     AND d.is_current
     AND d.strap_variant_id = NEW.strap_variant_id
     AND d.finished_product_id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Reserva canônica % diverge da demanda/variante/produto',
      NEW.id;
  END IF;

  v_previous_writer := pg_catalog.current_setting(
    'app.strap_engine_write',
    true
  );
  PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);
  v_writer_enabled := true;

  UPDATE public.stock_movements
     SET material_reservation_id = NEW.id,
         strap_variant_id = NEW.strap_variant_id,
         sale_order_strap_demand_id = NEW.sale_order_strap_demand_id,
         finished_product_id = NEW.finished_product_id,
         origin_type = CASE
           WHEN v_source = 'buy_ready' THEN 'buy_ready'
           ELSE 'internal_factory'
         END,
         effective_unit_cost = coalesce(v_cost, 0),
         correlation_id = NEW.correlation_id
   WHERE strap_movement_event_id = v_event_id
     AND (
       material_reservation_id IS NULL
       OR material_reservation_id = NEW.id
     );

  PERFORM pg_catalog.set_config(
    'app.strap_engine_write',
    coalesce(v_previous_writer, ''),
    true
  );
  v_writer_enabled := false;
  PERFORM pg_catalog.set_config('app.strap_last_movement_event', '', true);
  RETURN NEW;
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
        '[tg_attach_strap_finished_movement_to_reservation] falha ao restaurar GUC: %',
        SQLERRM;
    END;
  END IF;
  BEGIN
    PERFORM pg_catalog.set_config('app.strap_last_movement_event', '', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_attach_strap_finished_movement_to_reservation()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Depois de liquidar as reservas existentes, material esperado pela ficha
--    que nunca foi reservado, cuja reserva já foi cancelada ou cuja baixa não
--    cobriu o necessário vira pending_reconciliation. A função não movimenta
--    estoque e é idempotente por OP/produto.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expose_expected_consumption_gaps_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'finalizacao_op'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lines jsonb;
  v_expected record;
  v_net_debited numeric;
  v_pending numeric;
  v_missing numeric;
  v_cancelled_count integer;
  v_cancelled_qty numeric;
  v_gap_key text;
  v_correlation uuid;
  v_existing_gap_id uuid;
  v_existing_gap_qty numeric;
  v_gap_exists boolean;
  v_orphan_gap record;
  v_created integer := 0;
  v_updated integer := 0;
  v_resolved integer := 0;
  v_affected integer := 0;
  v_created_qty numeric := 0;
  v_causes jsonb := '[]'::jsonb;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'order_id', p_order_id,
      'created', 0,
      'affected', 0,
      'pending_qty', 0,
      'warning', 'order_id ausente'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('op-consumption-gap:' || p_order_id::text, 0)
  );

  v_lines := coalesce(
    public.op_expected_consumption_lines(p_order_id),
    '[]'::jsonb
  );

  FOR v_expected IN
    SELECT
      (line.value ->> 'product_id')::uuid AS product_id,
      pg_catalog.sum((line.value ->> 'required')::numeric) AS required_qty,
      pg_catalog.string_agg(
        DISTINCT coalesce(
          nullif(line.value ->> 'component', ''),
          'Material'
        ),
        ', ' ORDER BY coalesce(
          nullif(line.value ->> 'component', ''),
          'Material'
        )
      ) AS components,
      pg_catalog.string_agg(
        DISTINCT coalesce(
          nullif(line.value ->> 'source', ''),
          'unknown'
        ),
        ', ' ORDER BY coalesce(
          nullif(line.value ->> 'source', ''),
          'unknown'
        )
      ) AS sources,
      pg_catalog.bool_or(
        nullif(line.value ->> 'conversion_warning', '') IS NOT NULL
      ) AS has_conversion_warning,
      pg_catalog.bool_or(
        coalesce(line.value ->> 'matched_by', '') = 'color_mismatch'
      ) AS has_color_mismatch
    FROM pg_catalog.jsonb_array_elements(v_lines) AS line(value)
    WHERE coalesce(line.value ->> 'product_id', '')
            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND coalesce(line.value ->> 'required', '')
            ~ '^[0-9]+([.][0-9]+)?$'
      AND (line.value ->> 'required')::numeric > 0
      -- Tira canônica pertence exclusivamente ao motor 031/032/119. Nem uma
      -- variante cadastrada nem uma demanda corrente podem virar pendência
      -- genérica baseada no BOM.
      AND NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants sv
         WHERE sv.finished_product_id = (line.value ->> 'product_id')::uuid
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public.orders strap_order
          JOIN public.sale_order_strap_demands demand
            ON demand.sale_order_item_id = strap_order.sale_order_item_id
           AND demand.is_current
         WHERE strap_order.id = p_order_id
           AND demand.finished_product_id = (line.value ->> 'product_id')::uuid
      )
    GROUP BY (line.value ->> 'product_id')::uuid
    ORDER BY (line.value ->> 'product_id')::uuid
  LOOP
    SELECT greatest(
             coalesce(pg_catalog.sum(
               CASE
                 WHEN sm.movement_type = 'out' THEN sm.quantity
                 WHEN sm.movement_type = 'in' THEN -sm.quantity
                 ELSE 0
               END
             ), 0),
             0
           )
      INTO v_net_debited
      FROM public.stock_movements sm
     WHERE sm.order_id = p_order_id
       AND sm.product_id = v_expected.product_id;

    v_gap_key := pg_catalog.md5(
      pg_catalog.format(
        'expected-gap:%s:%s',
        p_order_id,
        v_expected.product_id
      )
    );
    v_correlation := pg_catalog.md5(
      pg_catalog.format('op-gap:%s', v_gap_key)
    )::uuid;

    v_existing_gap_id := NULL;
    v_existing_gap_qty := 0;
    SELECT mr.id,
           greatest(
             coalesce(mr.quantity_reserved, 0)
               - coalesce(mr.quantity_consumed, 0),
             0
           )
      INTO v_existing_gap_id, v_existing_gap_qty
      FROM public.material_reservations mr
     WHERE mr.source = 'finalization_gap'
       AND mr.correlation_id = v_correlation
     FOR UPDATE OF mr;
    v_gap_exists := v_existing_gap_id IS NOT NULL;

    -- Pendências de outras causas continuam cobrindo a necessidade. A linha
    -- determinística finalization_gap é excluída para poder ser redimensionada
    -- exatamente numa refinalização, para cima ou para baixo.
    SELECT coalesce(pg_catalog.sum(
             greatest(
               coalesce(mr.quantity_reserved, 0)
                 - coalesce(mr.quantity_consumed, 0),
               0
             )
           ), 0)
      INTO v_pending
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.product_id = v_expected.product_id
       AND mr.status = 'pending_reconciliation'
       AND mr.correlation_id IS DISTINCT FROM v_correlation;

    v_missing := greatest(
      v_expected.required_qty
        - coalesce(v_net_debited, 0)
        - coalesce(v_pending, 0),
      0
    );

    IF v_missing <= 0.0001 THEN
      IF v_gap_exists AND v_existing_gap_qty > 0.0001 THEN
        UPDATE public.material_reservations
           SET quantity_reserved = coalesce(quantity_consumed, 0),
               metadata = coalesce(metadata, '{}'::jsonb)
                 || pg_catalog.jsonb_build_object(
                      'auto_resolved_on', p_reason,
                      'auto_resolved_at', pg_catalog.now(),
                      'auto_resolved_without_stock_debit', true,
                      'retroactive_debit_forbidden', true
                    ),
               updated_at = pg_catalog.now()
         WHERE id = v_existing_gap_id;
        v_resolved := v_resolved + 1;
        v_affected := v_affected + 1;
      END IF;
      CONTINUE;
    END IF;

    IF v_gap_exists
       AND pg_catalog.abs(v_existing_gap_qty - v_missing) <= 0.0001 THEN
      CONTINUE;
    END IF;

    SELECT pg_catalog.count(*)::integer,
           coalesce(pg_catalog.sum(
             greatest(
               coalesce(mr.quantity_reserved, 0)
                 - coalesce(mr.quantity_consumed, 0),
               0
             )
           ), 0)
      INTO v_cancelled_count, v_cancelled_qty
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.product_id = v_expected.product_id
       AND mr.status IN ('cancelled', 'canceled');

    INSERT INTO public.material_reservations AS gap (
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
    )
    VALUES (
      p_order_id,
      v_expected.product_id,
      v_missing,
      0,
      'pending_reconciliation',
      'soft',
      'finalization_gap',
      pg_catalog.jsonb_build_object(
        'kind', 'expected_unreserved_gap',
        'gap_key', v_gap_key,
        'components', v_expected.components,
        'expected_sources', v_expected.sources,
        'expected_quantity', v_expected.required_qty,
        'net_debited_quantity', coalesce(v_net_debited, 0),
        'previous_pending_quantity', coalesce(v_pending, 0),
        'cancelled_reservation_count', v_cancelled_count,
        'cancelled_reservation_quantity', v_cancelled_qty,
        'has_conversion_warning', v_expected.has_conversion_warning,
        'has_color_mismatch', v_expected.has_color_mismatch,
        'detected_on', p_reason,
        'detected_at', pg_catalog.now(),
        'requires_manual_reconciliation', true,
        'retroactive_debit_forbidden', true
      ),
      'Consumo esperado sem baixa física suficiente na finalização; revisar cadastro/reserva e reconciliar sem débito retroativo automático',
      v_correlation
    )
    ON CONFLICT (correlation_id)
      WHERE source = 'finalization_gap'
        AND correlation_id IS NOT NULL
    DO UPDATE
      SET order_id = EXCLUDED.order_id,
          product_id = EXCLUDED.product_id,
          quantity_reserved = coalesce(gap.quantity_consumed, 0)
            + EXCLUDED.quantity_reserved,
          status = 'pending_reconciliation',
          reservation_type = 'soft',
          metadata = coalesce(gap.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          notes = EXCLUDED.notes,
          updated_at = pg_catalog.now();

    v_affected := v_affected + 1;
    IF v_gap_exists THEN
      v_updated := v_updated + 1;
    ELSE
      v_created := v_created + 1;
    END IF;
    v_created_qty := v_created_qty + v_missing;
    v_causes := v_causes || pg_catalog.jsonb_build_object(
      'product_id', v_expected.product_id,
      'quantity', v_missing,
      'change', CASE WHEN v_gap_exists THEN 'resized' ELSE 'created' END,
      'cause', CASE
        WHEN v_cancelled_count > 0 THEN 'reservation_cancelled_or_insufficient'
        ELSE 'never_reserved_or_not_debited'
      END,
      'components', v_expected.components
    );
  END LOOP;

  -- Se o material deixou completamente de aparecer na ficha atual, ele não
  -- entra no LOOP acima. Zera somente a pendência genérica determinística; não
  -- cancela reserva canônica, não cria movimento e não altera products.
  FOR v_orphan_gap IN
    SELECT gap.id
      FROM public.material_reservations gap
     WHERE gap.order_id = p_order_id
       AND gap.source = 'finalization_gap'
       AND gap.status = 'pending_reconciliation'
       AND greatest(
             coalesce(gap.quantity_reserved, 0)
               - coalesce(gap.quantity_consumed, 0),
             0
           ) > 0.0001
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(v_lines) AS line(value)
          WHERE coalesce(line.value ->> 'product_id', '')
                  ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND (line.value ->> 'product_id')::uuid = gap.product_id
            AND coalesce(line.value ->> 'required', '')
                  ~ '^[0-9]+([.][0-9]+)?$'
            AND (line.value ->> 'required')::numeric > 0
            AND NOT EXISTS (
              SELECT 1
                FROM public.artisanal_strap_variants sv
               WHERE sv.finished_product_id = gap.product_id
            )
            AND NOT EXISTS (
              SELECT 1
                FROM public.orders strap_order
                JOIN public.sale_order_strap_demands demand
                  ON demand.sale_order_item_id = strap_order.sale_order_item_id
                 AND demand.is_current
               WHERE strap_order.id = p_order_id
                 AND demand.finished_product_id = gap.product_id
            )
       )
     FOR UPDATE OF gap
  LOOP
    UPDATE public.material_reservations
       SET quantity_reserved = coalesce(quantity_consumed, 0),
           metadata = coalesce(metadata, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'auto_resolved_on', p_reason,
                  'auto_resolved_at', pg_catalog.now(),
                  'auto_resolved_reason', 'expected_line_removed',
                  'auto_resolved_without_stock_debit', true,
                  'retroactive_debit_forbidden', true
                ),
           updated_at = pg_catalog.now()
     WHERE id = v_orphan_gap.id;
    v_resolved := v_resolved + 1;
    v_affected := v_affected + 1;
  END LOOP;

  IF v_created + v_updated > 0 THEN
    BEGIN
      PERFORM public.record_op_reserve_failure_alert(
        p_order_id,
        pg_catalog.format(
          '%s material(is) esperado(s) não possuíam baixa nem pendência suficiente; %s ficaram em pending_reconciliation',
          v_created + v_updated,
          pg_catalog.round(v_created_qty, 4)
        ),
        'consumo_esperado_sem_reserva',
        'critical'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[expose_expected_consumption_gaps_for_order] alerta falhou para OP %: %',
        p_order_id,
      SQLERRM;
    END;
  ELSIF v_resolved > 0
        AND NOT EXISTS (
          SELECT 1
            FROM public.material_reservations gap
           WHERE gap.order_id = p_order_id
             AND gap.source = 'finalization_gap'
             AND gap.status = 'pending_reconciliation'
             AND greatest(
                   coalesce(gap.quantity_reserved, 0)
                     - coalesce(gap.quantity_consumed, 0),
                   0
                 ) > 0.0001
        ) THEN
    BEGIN
      UPDATE public.production_alerts
         SET dismissed_at = coalesce(dismissed_at, pg_catalog.now()),
             payload = coalesce(payload, '{}'::jsonb)
               || pg_catalog.jsonb_build_object(
                    'auto_resolved_at', pg_catalog.now(),
                    'auto_resolved_reason', 'expected_gap_zeroed_without_stock_debit'
                  )
       WHERE alert_key = 'consumo_esperado_sem_reserva:' || p_order_id::text
         AND severity = 'critical'
         AND dismissed_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        '[expose_expected_consumption_gaps_for_order] falha ao encerrar alerta resolvido da OP %: %',
        p_order_id,
        SQLERRM;
    END;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', p_order_id,
    'created', v_created,
    'updated', v_updated,
    'resolved', v_resolved,
    'affected', v_affected,
    'pending_affected', v_created + v_updated,
    'pending_qty', v_created_qty,
    'causes', v_causes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expose_expected_consumption_gaps_for_order(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Writer EXPLÍCITO e estreito das reservas canônicas de tira acabada.
--    O bypass do guard de tiras vive somente aqui, por uma reserva UUID
--    bloqueada e validada contra demanda/variante/produto. O loop genérico logo
--    abaixo nunca recebe identidade canônica de tira.
-- ---------------------------------------------------------------------------

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

  -- O token é local a este writer estreito. Ele nunca envolve o settlement
  -- genérico nem habilita escolha por order/product.
  v_previous_writer := pg_catalog.current_setting(
    'app.strap_engine_write',
    true
  );
  PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);
  v_writer_enabled := true;

  IF v_res.source <> 'strap_engine_finished'
     OR v_res.sale_order_strap_demand_id IS NULL
     OR v_res.strap_variant_id IS NULL
     OR v_res.finished_product_id IS DISTINCT FROM v_res.product_id
     OR NOT v_identity_valid THEN
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

    -- tg_enrich_strap_finished_stock_movement preenche origem canônica/WAC a
    -- partir desta reserva UUID; não usamos origin_type genérico aqui.
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
      correlation_id
    ) VALUES (
      v_res.product_id,
      'out',
      v_debit,
      v_product_qty,
      v_product_qty - v_debit,
      'Baixa canônica de tira acabada na finalização — '
        || coalesce(v_product_name, v_res.product_id::text)
        || CASE WHEN v_shortfall > 0 THEN ' (parcial)' ELSE '' END,
      'consumo_op',
      v_res.order_id,
      v_res.id,
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
                  'canonical_strap_writer', true
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

REVOKE ALL ON FUNCTION public.settle_canonical_strap_reservation_for_order(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Settlement tolerante com vínculo causal em cada OUT. Mantém a regra de
--    LEAST(disponível, reservado), nunca debita além do físico e nunca chama o
--    writer estrito que impediria a OP de fechar.
-- ---------------------------------------------------------------------------

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

REVOKE ALL ON FUNCTION public.settle_open_reservations_for_order(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.settle_open_reservations_for_order(uuid, text) IS
  'Settlement futuro tolerante: baixa LEAST(disponível, saldo reservado), vincula movimento à reserva/correlação e expõe consumo esperado não coberto como pending_reconciliation. Não reconcilia histórico.';

-- Mesmo uma falha inesperada de cadastro/ledger vira alerta; não trava o chão
-- de fábrica nem impede a transição da OP.
CREATE OR REPLACE FUNCTION public.tg_settle_reservations_on_op_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN (
       'Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido'
     )
     AND coalesce(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    BEGIN
      PERFORM public.settle_open_reservations_for_order(
        NEW.id,
        'finalizacao_op'
      );
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        PERFORM public.record_op_reserve_failure_alert(
          NEW.id,
          'Settlement tolerante falhou; OP foi finalizada e exige reconciliação: '
            || SQLERRM,
          'settlement_finalizacao_falhou',
          'critical'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
          '[tg_settle_reservations_on_op_finalize] o alerta também falhou para OP %: %',
          NEW.id,
          SQLERRM;
      END;
      RAISE WARNING
        '[tg_settle_reservations_on_op_finalize] OP % finalizada com falha de settlement: %',
        NEW.id,
        SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_settle_reservations_on_op_finalize()
  FROM PUBLIC, anon, authenticated, service_role;

-- O nome load-bearing continua anterior a trg_record_consumption_on_finalize.
DROP TRIGGER IF EXISTS trg_aa_settle_reservations_on_finalize ON public.orders;
CREATE TRIGGER trg_aa_settle_reservations_on_finalize
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_settle_reservations_on_op_finalize();

-- ---------------------------------------------------------------------------
-- 4. Views vivas e acionáveis. Elas mostram o histórico sem alterá-lo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_faturado_op_integrity_alerts
WITH (security_invoker = true)
AS
WITH item_totals AS (
  SELECT
    so.id AS sale_order_id,
    so.order_number AS sale_order_number,
    soi.id AS sale_order_item_id,
    coalesce(soi.quantity, 0)::numeric AS expected_quantity
  FROM public.sale_orders so
  JOIN public.sale_order_items soi
    ON soi.sale_order_id = so.id
   AND soi.reference_id IS NOT NULL
  WHERE so.status = 'Faturado'
    AND so.deleted_at IS NULL
    AND NOT coalesce(so.is_standalone_nfe, false)
    AND coalesce(soi.quantity, 0) > 0
), op_totals AS (
  SELECT
    o.sale_order_id,
    o.sale_order_item_id,
    pg_catalog.count(*) FILTER (
      WHERE o.deleted_at IS NULL
    )::bigint AS total_order_count,
    pg_catalog.count(*) FILTER (
      WHERE o.deleted_at IS NULL
        AND pg_catalog.lower(pg_catalog.btrim(coalesce(o.status, '')))
          IN ('cancelado', 'cancelada')
    )::bigint AS cancelled_order_count,
    coalesce(pg_catalog.sum(o.quantity) FILTER (
      WHERE o.deleted_at IS NULL
        AND pg_catalog.lower(pg_catalog.btrim(coalesce(o.status, '')))
          NOT IN ('cancelado', 'cancelada')
    ), 0)::numeric AS noncancelled_quantity,
    coalesce(pg_catalog.sum(o.quantity) FILTER (
      WHERE o.deleted_at IS NULL
        AND pg_catalog.lower(pg_catalog.btrim(coalesce(o.status, '')))
          IN (
            'finalizado', 'faturado', 'concluído', 'concluido',
            'concluída', 'concluida'
          )
    ), 0)::numeric AS finalized_quantity,
    coalesce(pg_catalog.sum(o.quantity) FILTER (
      WHERE o.deleted_at IS NULL
        AND pg_catalog.lower(pg_catalog.btrim(coalesce(o.status, '')))
          IN ('cancelado', 'cancelada')
    ), 0)::numeric AS cancelled_quantity
  FROM public.orders o
  WHERE o.sale_order_id IS NOT NULL
    AND o.sale_order_item_id IS NOT NULL
  GROUP BY o.sale_order_id, o.sale_order_item_id
), item_calculated AS (
  SELECT
    i.sale_order_id,
    i.sale_order_number,
    i.sale_order_item_id,
    i.expected_quantity,
    coalesce(o.total_order_count, 0) AS total_order_count,
    coalesce(o.cancelled_order_count, 0) AS cancelled_order_count,
    coalesce(o.noncancelled_quantity, 0) AS noncancelled_quantity,
    coalesce(o.finalized_quantity, 0) AS finalized_quantity,
    coalesce(o.cancelled_quantity, 0) AS cancelled_quantity,
    greatest(
      i.expected_quantity - coalesce(o.finalized_quantity, 0),
      0
    ) AS missing_finalized_quantity,
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN coalesce(o.total_order_count, 0) = 0
          THEN 'op_ausente'
      END,
      CASE
        WHEN coalesce(o.total_order_count, 0) > 0
             AND coalesce(o.noncancelled_quantity, 0) = 0
          THEN 'todas_op_canceladas'
      END,
      CASE
        WHEN coalesce(o.finalized_quantity, 0) < i.expected_quantity
          THEN 'cobertura_finalizada_parcial'
      END,
      CASE
        WHEN coalesce(o.finalized_quantity, 0) > i.expected_quantity
          THEN 'cobertura_finalizada_excedente'
      END,
      CASE
        WHEN coalesce(o.noncancelled_quantity, 0)
             > coalesce(o.finalized_quantity, 0)
          THEN 'op_nao_finalizada_em_pv_faturado'
      END
    ], NULL)::text[] AS issue_codes
  FROM item_totals i
  LEFT JOIN op_totals o
    ON o.sale_order_id = i.sale_order_id
   AND o.sale_order_item_id = i.sale_order_item_id
), pv_rollup AS (
  SELECT
    c.sale_order_id,
    c.sale_order_number,
    pg_catalog.sum(c.expected_quantity) AS expected_quantity,
    pg_catalog.sum(c.total_order_count) AS total_order_count,
    pg_catalog.sum(c.cancelled_order_count) AS cancelled_order_count,
    pg_catalog.sum(c.noncancelled_quantity) AS noncancelled_quantity,
    pg_catalog.sum(c.finalized_quantity) AS finalized_quantity,
    pg_catalog.sum(c.cancelled_quantity) AS cancelled_quantity,
    pg_catalog.sum(c.missing_finalized_quantity) AS missing_finalized_quantity,
    pg_catalog.count(*) FILTER (
      WHERE pg_catalog.cardinality(c.issue_codes) > 0
    )::bigint AS affected_item_count,
    pg_catalog.array_agg(
      c.sale_order_item_id ORDER BY c.sale_order_item_id
    ) FILTER (
      WHERE pg_catalog.cardinality(c.issue_codes) > 0
    ) AS affected_sale_order_item_ids,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sale_order_item_id', c.sale_order_item_id,
        'expected_quantity', c.expected_quantity,
        'finalized_quantity', c.finalized_quantity,
        'noncancelled_quantity', c.noncancelled_quantity,
        'cancelled_quantity', c.cancelled_quantity,
        'issue_codes', c.issue_codes
      ) ORDER BY c.sale_order_item_id
    ) FILTER (
      WHERE pg_catalog.cardinality(c.issue_codes) > 0
    ) AS item_issues
  FROM item_calculated c
  GROUP BY c.sale_order_id, c.sale_order_number
  HAVING pg_catalog.bool_or(pg_catalog.cardinality(c.issue_codes) > 0)
), issue_rollup AS (
  SELECT
    c.sale_order_id,
    pg_catalog.array_agg(
      DISTINCT issue.code ORDER BY issue.code
    )::text[] AS issue_codes
  FROM item_calculated c
  CROSS JOIN LATERAL pg_catalog.unnest(c.issue_codes) AS issue(code)
  GROUP BY c.sale_order_id
)
SELECT
  p.sale_order_id,
  p.sale_order_number,
  p.expected_quantity,
  p.total_order_count,
  p.cancelled_order_count,
  p.noncancelled_quantity,
  p.finalized_quantity,
  p.cancelled_quantity,
  p.missing_finalized_quantity,
  i.issue_codes,
  p.affected_item_count,
  p.affected_sale_order_item_ids,
  p.item_issues
FROM pv_rollup p
JOIN issue_rollup i ON i.sale_order_id = p.sale_order_id;

CREATE OR REPLACE VIEW public.v_finalized_op_consumption_gaps
WITH (security_invoker = true)
AS
SELECT
  pc.id AS production_consumption_id,
  pc.order_id,
  o.order_number,
  o.sale_order_id,
  so.order_number AS sale_order_number,
  pc.product_id,
  coalesce(p.name, pc.component_name, 'Material sem produto') AS product_name,
  pc.component_type,
  pc.component_name,
  pc.standard_quantity,
  pc.actual_quantity,
  greatest(
    coalesce(pc.standard_quantity, 0) - coalesce(pc.actual_quantity, 0),
    0
  ) AS gap_quantity,
  pc.standard_cost,
  pc.actual_cost,
  greatest(
    coalesce(pc.standard_cost, 0)
      - coalesce(pc.actual_cost, 0),
    0
  ) AS estimated_gap_value,
  coalesce(ledger.net_quantity, 0) AS ledger_net_quantity,
  coalesce(cancelled.cancelled_reservation_count, 0)
    AS cancelled_reservation_count,
  CASE
    WHEN coalesce(pc.actual_quantity, 0) <= 0.0001
      THEN 'consumo_zero_sem_pendencia'
    ELSE 'consumo_parcial_sem_pendencia'
  END AS issue_code,
  CASE
    WHEN coalesce(cancelled.cancelled_reservation_count, 0) > 0
      THEN 'reserva_cancelada_sem_pendencia'
    ELSE NULL
  END AS reservation_evidence_code
FROM public.production_consumptions pc
JOIN public.orders o ON o.id = pc.order_id
LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
LEFT JOIN public.products p ON p.id = pc.product_id
LEFT JOIN LATERAL (
  SELECT coalesce(pg_catalog.sum(
           CASE
             WHEN sm.movement_type = 'out' THEN sm.quantity
             WHEN sm.movement_type = 'in' THEN -sm.quantity
             ELSE 0
           END
         ), 0) AS net_quantity
  FROM public.stock_movements sm
  WHERE sm.order_id = pc.order_id
    AND sm.product_id IS NOT DISTINCT FROM pc.product_id
) ledger ON true
LEFT JOIN LATERAL (
  SELECT pg_catalog.count(*)::bigint AS cancelled_reservation_count
  FROM public.material_reservations mr
  WHERE mr.order_id = pc.order_id
    AND mr.product_id IS NOT DISTINCT FROM pc.product_id
    AND mr.status IN ('cancelled', 'canceled')
) cancelled ON true
WHERE pc.superseded_at IS NULL
  AND pc.standard_quantity > 0
  AND coalesce(pc.actual_quantity, 0) + 0.0001 < pc.standard_quantity
  AND o.deleted_at IS NULL
  AND pg_catalog.lower(pg_catalog.btrim(coalesce(o.status, '')))
      IN (
        'finalizado', 'faturado', 'concluído', 'concluido',
        'concluída', 'concluida'
      )
  AND NOT EXISTS (
    SELECT 1
      FROM public.material_reservations pending
     WHERE pending.order_id = pc.order_id
       AND pending.product_id IS NOT DISTINCT FROM pc.product_id
       AND pending.status = 'pending_reconciliation'
       AND greatest(
             coalesce(pending.quantity_reserved, 0)
               - coalesce(pending.quantity_consumed, 0),
             0
           ) > 0.0001
  );

CREATE OR REPLACE VIEW public.v_op_stock_movement_trace_gaps
WITH (security_invoker = true)
AS
SELECT
  sm.id AS stock_movement_id,
  sm.order_id,
  o.order_number,
  o.sale_order_id,
  so.order_number AS sale_order_number,
  sm.product_id,
  p.name AS product_name,
  sm.quantity,
  sm.description,
  sm.movement_reason,
  sm.origin_type,
  sm.correlation_id,
  sm.created_at
FROM public.stock_movements sm
JOIN public.orders o ON o.id = sm.order_id
LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
LEFT JOIN public.products p ON p.id = sm.product_id
WHERE sm.movement_type = 'out'
  AND sm.order_id IS NOT NULL
  AND sm.material_reservation_id IS NULL
  -- Embalagem canônica mantém estoque em box_types e não passa por
  -- material_reservations (que referencia products). A identidade UUID evita
  -- esconder produtos legados apenas por nome, grupo ou categoria.
  AND NOT EXISTS (
    SELECT 1
      FROM public.box_types canonical_box
     WHERE canonical_box.id = sm.product_id
  )
  AND (
    sm.movement_reason = 'consumo_op'
    OR sm.description ILIKE '%OP%'
    OR sm.description ILIKE '%finaliza%'
    OR sm.description ILIKE '%solado por grade%'
  );

REVOKE ALL ON TABLE
  public.v_faturado_op_integrity_alerts,
  public.v_finalized_op_consumption_gaps,
  public.v_op_stock_movement_trace_gaps
FROM PUBLIC, anon;
GRANT SELECT ON TABLE
  public.v_faturado_op_integrity_alerts,
  public.v_finalized_op_consumption_gaps,
  public.v_op_stock_movement_trace_gaps
TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Alertas somente para transições futuras. As views acima são a leitura do
--    passivo histórico; não há INSERT/UPDATE de backfill nesta migration.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_sale_order_op_integrity_alert(
  p_sale_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_issue record;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_issue
    FROM public.v_faturado_op_integrity_alerts v
   WHERE v.sale_order_id = p_sale_order_id;

  IF FOUND THEN
    INSERT INTO public.production_alerts (
      alert_key,
      alert_type,
      severity,
      title,
      body,
      payload
    ) VALUES (
      'pv_op_integrity:' || p_sale_order_id::text,
      'pv_op_integrity',
      'critical',
      'PV faturado sem cobertura íntegra de OP — '
        || v_issue.sale_order_number,
      'Esperado ' || v_issue.expected_quantity
        || ', finalizado ' || v_issue.finalized_quantity
        || ', faltante ' || v_issue.missing_finalized_quantity
        || '. Ocorrências: '
        || pg_catalog.array_to_string(v_issue.issue_codes, ', ') || '.',
      pg_catalog.to_jsonb(v_issue)
        || pg_catalog.jsonb_build_object('detected_at', pg_catalog.now())
    )
    ON CONFLICT (alert_key, severity) DO UPDATE
      SET title = EXCLUDED.title,
          body = EXCLUDED.body,
          payload = EXCLUDED.payload,
          dismissed_at = NULL,
          dismissed_by = NULL;
  ELSE
    UPDATE public.production_alerts
       SET dismissed_at = coalesce(dismissed_at, pg_catalog.now()),
           payload = coalesce(payload, '{}'::jsonb)
             || pg_catalog.jsonb_build_object(
                  'auto_resolved_at', pg_catalog.now(),
                  'auto_resolved_reason', 'cobertura_op_regularizada'
                )
     WHERE alert_key = 'pv_op_integrity:' || p_sale_order_id::text
       AND severity = 'critical'
       AND dismissed_at IS NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING
    '[refresh_sale_order_op_integrity_alert] falhou para PV %: %',
    p_sale_order_id,
    SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_sale_order_op_integrity_alert(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_refresh_sale_order_op_integrity_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_sale_order_op_integrity_alert(OLD.sale_order_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.refresh_sale_order_op_integrity_alert(OLD.sale_order_id);
  END IF;
  v_sale_order_id := NEW.sale_order_id;
  PERFORM public.refresh_sale_order_op_integrity_alert(v_sale_order_id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_refresh_sale_order_op_integrity_alert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_refresh_pv_op_integrity_on_order_write
  ON public.orders;
CREATE TRIGGER trg_refresh_pv_op_integrity_on_order_write
  AFTER INSERT OR UPDATE OF
    status, quantity, deleted_at, sale_order_id, sale_order_item_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_sale_order_op_integrity_alert();

DROP TRIGGER IF EXISTS trg_refresh_pv_op_integrity_on_order_delete
  ON public.orders;
CREATE TRIGGER trg_refresh_pv_op_integrity_on_order_delete
  AFTER DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_sale_order_op_integrity_alert();

DROP TRIGGER IF EXISTS trg_refresh_pv_op_integrity_on_item_write
  ON public.sale_order_items;
CREATE TRIGGER trg_refresh_pv_op_integrity_on_item_write
  AFTER INSERT OR UPDATE OF sale_order_id, quantity, reference_id
  ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_sale_order_op_integrity_alert();

DROP TRIGGER IF EXISTS trg_refresh_pv_op_integrity_on_item_delete
  ON public.sale_order_items;
CREATE TRIGGER trg_refresh_pv_op_integrity_on_item_delete
  AFTER DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_sale_order_op_integrity_alert();

CREATE OR REPLACE FUNCTION public.tg_refresh_faturado_op_integrity_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'Faturado' THEN
    PERFORM public.refresh_sale_order_op_integrity_alert(NEW.id);
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Ao sair de Faturado, o refresh não encontra linha na view e encerra o
    -- alerta persistente em vez de deixá-lo stale.
    PERFORM public.refresh_sale_order_op_integrity_alert(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_refresh_faturado_op_integrity_alert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_refresh_faturado_op_integrity
  ON public.sale_orders;
CREATE TRIGGER trg_refresh_faturado_op_integrity
  AFTER INSERT OR UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_refresh_faturado_op_integrity_alert();

-- Roda depois de trg_record... e trg_zzz_flag_stock_debit_holes. Distingue o
-- furo realmente sem pendência daquele que já está visível para reconciliação.
CREATE OR REPLACE FUNCTION public.tg_flag_untracked_consumption_gap_on_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
  v_value numeric;
  v_sample text;
BEGIN
  IF NEW.status IN (
       'Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido'
     )
     AND coalesce(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    SELECT pg_catalog.count(*)::integer,
           coalesce(pg_catalog.sum(v.estimated_gap_value), 0),
           (pg_catalog.array_agg(
             v.product_name ORDER BY v.product_name
           ))[1:5]::text
      INTO v_count, v_value, v_sample
      FROM public.v_finalized_op_consumption_gaps v
     WHERE v.order_id = NEW.id;

    IF v_count > 0 THEN
      INSERT INTO public.production_alerts (
        alert_key,
        alert_type,
        severity,
        title,
        body,
        payload
      ) VALUES (
        'furo_baixa_sem_pendencia:' || NEW.id::text,
        'furo_baixa_sem_pendencia',
        'critical',
        'Furo de baixa sem pendência — OP '
          || coalesce(NEW.order_number, NEW.id::text),
        v_count
          || ' material(is) terminaram com consumo abaixo do padrão e nenhuma pending_reconciliation (≈ R$ '
          || pg_catalog.round(v_value, 2) || '). Amostra: '
          || coalesce(v_sample, '—') || '.',
        pg_catalog.jsonb_build_object(
          'order_id', NEW.id,
          'order_number', NEW.order_number,
          'line_count', v_count,
          'estimated_value', pg_catalog.round(v_value, 2),
          'sample', v_sample,
          'detected_at', pg_catalog.now(),
          'retroactive_debit_forbidden', true
        )
      )
      ON CONFLICT (alert_key, severity) DO UPDATE
        SET title = EXCLUDED.title,
            body = EXCLUDED.body,
            payload = EXCLUDED.payload,
            dismissed_at = NULL,
            dismissed_by = NULL;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING
    '[tg_flag_untracked_consumption_gap_on_finalize] falhou para OP %: %',
    NEW.id,
    SQLERRM;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_flag_untracked_consumption_gap_on_finalize()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_zzzz_flag_untracked_consumption_gap
  ON public.orders;
CREATE TRIGGER trg_zzzz_flag_untracked_consumption_gap
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.status IN (
      'Finalizado', 'FINALIZADO', 'Faturado', 'Concluído', 'Concluido'
    )
    AND OLD.status IS DISTINCT FROM NEW.status
  )
  EXECUTE FUNCTION public.tg_flag_untracked_consumption_gap_on_finalize();

-- ---------------------------------------------------------------------------
-- 6. Helper normalizado para composição em get_sale_order_command_diagnostics.
--    A migration de composição chama este helper; não há renome/wrapper
--    concorrente sobre o RPC principal nesta frente.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_op_stock_integrity_diagnostics(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  check_name text,
  category text,
  severity text,
  item_count bigint,
  sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(
         ARRAY['admin', 'gerente', 'producao']
       )
     ) THEN
    RAISE EXCEPTION
      'Diagnóstico OP–estoque exige Administração/Gerência/Produção'
      USING ERRCODE = '42501';
  END IF;

  IF p_sale_order_id IS NULL
     AND coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Visão global OP–estoque exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    'faturado_op_integrity'::text,
    'production'::text,
    CASE WHEN pg_catalog.count(*) > 0 THEN 'critical' ELSE 'ok' END::text,
    pg_catalog.count(*)::bigint,
    (pg_catalog.array_agg(
      pg_catalog.concat(
        v.sale_order_number,
        ':',
        pg_catalog.array_to_string(v.issue_codes, '+'),
        ':faltam=',
        v.missing_finalized_quantity
      ) ORDER BY v.sale_order_number
    ))[1:5]::text
  FROM public.v_faturado_op_integrity_alerts v
  WHERE p_sale_order_id IS NULL OR v.sale_order_id = p_sale_order_id

  UNION ALL

  SELECT
    'finalized_consumption_zero_without_pending',
    'stock',
    CASE WHEN pg_catalog.count(*) > 0 THEN 'critical' ELSE 'ok' END,
    pg_catalog.count(*)::bigint,
    (pg_catalog.array_agg(
      pg_catalog.concat(
        v.sale_order_number,
        ':',
        v.order_number,
        ':',
        v.product_name
      ) ORDER BY v.sale_order_number, v.order_number, v.product_name
    ))[1:5]::text
  FROM public.v_finalized_op_consumption_gaps v
  WHERE p_sale_order_id IS NULL OR v.sale_order_id = p_sale_order_id

  UNION ALL

  SELECT
    'op_stock_movement_without_reservation_trace',
    'stock_trace',
    CASE WHEN pg_catalog.count(*) > 0 THEN 'warning' ELSE 'ok' END,
    pg_catalog.count(*)::bigint,
    (pg_catalog.array_agg(
      pg_catalog.concat(
        v.sale_order_number,
        ':',
        v.order_number,
        ':',
        v.product_name,
        ':',
        v.quantity
      ) ORDER BY v.created_at DESC, v.stock_movement_id
    ))[1:5]::text
  FROM public.v_op_stock_movement_trace_gaps v
  WHERE p_sale_order_id IS NULL OR v.sale_order_id = p_sale_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_op_stock_integrity_diagnostics(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_op_stock_integrity_diagnostics(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_op_stock_integrity_diagnostics(uuid) IS
  'CheckRows normalizados para composição no diagnóstico de PV: cobertura de OP faturada, consumo zero/parcial sem pendência e movimento sem identidade de reserva.';

-- ---------------------------------------------------------------------------
-- 7. Contratos live read-only. Falham o deploy se a migration perder a ordem
--    dos triggers, rastreabilidade, ACL ou segurança das views.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_op_stock_integrity_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settle text;
  v_gap text;
  v_strap_writer text;
  v_strap_bind text;
  v_strap_bind_trigger text;
  v_strap_attach text;
  v_settle_trigger text;
  v_before_trace text;
  v_late_trace text;
  v_diagnostic text;
  v_origin_constraint text;
  v_trace_view text;
  v_faturado_view text;
  v_consumption_view text;
  v_order_alert_trigger text;
  v_pv_alert_trigger text;
BEGIN
  v_settle := pg_catalog.pg_get_functiondef(
    'public.settle_open_reservations_for_order(uuid,text)'::regprocedure
  );
  v_gap := pg_catalog.pg_get_functiondef(
    'public.expose_expected_consumption_gaps_for_order(uuid,text)'::regprocedure
  );
  v_strap_writer := pg_catalog.pg_get_functiondef(
    'public.settle_canonical_strap_reservation_for_order(uuid,text)'::regprocedure
  );
  v_strap_bind := pg_catalog.pg_get_functiondef(
    'public.bind_strap_finished_reservations_to_order(uuid)'::regprocedure
  );
  v_strap_bind_trigger := pg_catalog.pg_get_functiondef(
    'public.tg_bind_strap_finished_reservations_to_order()'::regprocedure
  );
  v_strap_attach := pg_catalog.pg_get_functiondef(
    'public.tg_attach_strap_finished_movement_to_reservation()'::regprocedure
  );
  v_settle_trigger := pg_catalog.pg_get_functiondef(
    'public.tg_settle_reservations_on_op_finalize()'::regprocedure
  );
  v_before_trace := pg_catalog.pg_get_functiondef(
    'public.tg_trace_op_stock_movement_from_reservation()'::regprocedure
  );
  v_late_trace := pg_catalog.pg_get_functiondef(
    'public.tg_attach_op_movement_after_reservation_write()'::regprocedure
  );
  v_diagnostic := pg_catalog.pg_get_functiondef(
    'public.get_op_stock_integrity_diagnostics(uuid)'::regprocedure
  );
  v_trace_view := pg_catalog.pg_get_viewdef(
    'public.v_op_stock_movement_trace_gaps'::regclass,
    true
  );
  v_faturado_view := pg_catalog.pg_get_viewdef(
    'public.v_faturado_op_integrity_alerts'::regclass,
    true
  );
  v_consumption_view := pg_catalog.pg_get_viewdef(
    'public.v_finalized_op_consumption_gaps'::regclass,
    true
  );
  v_order_alert_trigger := pg_catalog.pg_get_functiondef(
    'public.tg_refresh_sale_order_op_integrity_alert()'::regprocedure
  );
  v_pv_alert_trigger := pg_catalog.pg_get_functiondef(
    'public.tg_refresh_faturado_op_integrity_alert()'::regprocedure
  );
  SELECT pg_catalog.pg_get_constraintdef(c.oid)
    INTO v_origin_constraint
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.stock_movements'::regclass
     AND c.conname = 'stock_movements_strap_origin_type_ck';

  RETURN QUERY SELECT
    'OS1 settlement vincula reserva, origem e correlação'::text,
    pg_catalog.strpos(v_settle, 'material_reservation_id') > 0
      AND pg_catalog.strpos(v_settle, 'production_order') > 0
      AND pg_catalog.strpos(v_settle, 'correlation_id') > 0
      AND pg_catalog.strpos(v_settle, 'movement_reason') > 0,
    'cada OUT futuro de settlement precisa carregar sua causa'::text;

  RETURN QUERY SELECT
    'OS2 settlement continua tolerante e parcial'::text,
    pg_catalog.strpos(v_settle, 'least') > 0
      AND pg_catalog.strpos(v_settle, 'pending_reconciliation') > 0
      AND pg_catalog.strpos(v_settle_trigger, 'EXCEPTION WHEN OTHERS') > 0
      AND pg_catalog.strpos(v_settle_trigger, 'RAISE WARNING') > 0
      AND pg_catalog.strpos(v_settle_trigger, 'o alerta também falhou') > 0
      AND pg_catalog.strpos(v_gap, 'alerta falhou para OP') > 0,
    'falta de estoque ou falha de diagnóstico não pode impedir fechamento'::text;

  RETURN QUERY SELECT
    'OS3 consumo nunca reservado vira pendência sem débito retroativo'::text,
    pg_catalog.strpos(v_gap, 'op_expected_consumption_lines') > 0
      AND pg_catalog.strpos(v_gap, 'expected_unreserved_gap') > 0
      AND pg_catalog.strpos(v_gap, 'retroactive_debit_forbidden') > 0
      AND pg_catalog.strpos(v_gap, 'artisanal_strap_variants') > 0
      AND pg_catalog.strpos(v_gap, 'sale_order_strap_demands') > 0
      AND pg_catalog.strpos(v_gap, 'finished_product_id') > 0
      AND pg_catalog.strpos(v_gap, 'ON CONFLICT (correlation_id)') > 0
      AND pg_catalog.strpos(v_gap, 'pending_affected') > 0
      AND pg_catalog.strpos(v_gap, 'INSERT INTO public.stock_movements') = 0
      AND pg_catalog.strpos(v_gap, 'UPDATE public.products') = 0,
    'detector pode inserir apenas material_reservations/alerta'::text;

  RETURN QUERY SELECT
    'OS4 ordem de triggers preserva settle antes do consumo e detector depois'::text,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.orders'::regclass
         AND t.tgname = 'trg_aa_settle_reservations_on_finalize'
         AND NOT t.tgisinternal
    )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.orders'::regclass
           AND t.tgname = 'trg_record_consumption_on_finalize'
           AND NOT t.tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid = 'public.orders'::regclass
           AND t.tgname = 'trg_zzzz_flag_untracked_consumption_gap'
           AND NOT t.tgisinternal
      )
      AND 'trg_aa_settle_reservations_on_finalize'
          < 'trg_record_consumption_on_finalize'
      AND 'trg_record_consumption_on_finalize'
          < 'trg_zzzz_flag_untracked_consumption_gap',
    'nomes são load-bearing porque triggers do mesmo evento rodam alfabeticamente'::text;

  RETURN QUERY SELECT
    'OS5 views obedecem RLS e não são públicas'::text,
    NOT pg_catalog.has_table_privilege(
      'anon', 'public.v_faturado_op_integrity_alerts', 'SELECT'
    )
      AND NOT pg_catalog.has_table_privilege(
        'anon', 'public.v_finalized_op_consumption_gaps', 'SELECT'
      )
      AND NOT pg_catalog.has_table_privilege(
        'anon', 'public.v_op_stock_movement_trace_gaps', 'SELECT'
      )
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class c
         WHERE c.oid = 'public.v_faturado_op_integrity_alerts'::regclass
           AND c.reloptions @> ARRAY['security_invoker=true']
      )
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class c
         WHERE c.oid = 'public.v_finalized_op_consumption_gaps'::regclass
           AND c.reloptions @> ARRAY['security_invoker=true']
      ),
    'views de diagnóstico não podem contornar RLS'::text;

  RETURN QUERY SELECT
    'OS6 origem production_order é aceita sem relaxar tiras'::text,
    pg_catalog.strpos(v_origin_constraint, 'production_order') > 0
      AND pg_catalog.strpos(v_origin_constraint, 'internal_factory') > 0
      AND pg_catalog.strpos(v_origin_constraint, 'internal_contractor') > 0
      AND pg_catalog.strpos(v_origin_constraint, 'buy_ready') > 0,
    'o domínio novo é aditivo; as três origens canônicas de tiras permanecem'::text;

  RETURN QUERY SELECT
    'OS7 helper entrega os três sinais normalizados'::text,
    pg_catalog.strpos(v_diagnostic, 'faturado_op_integrity') > 0
      AND pg_catalog.strpos(
        v_diagnostic, 'finalized_consumption_zero_without_pending'
      ) > 0
      AND pg_catalog.strpos(
        v_diagnostic, 'op_stock_movement_without_reservation_trace'
      ) > 0,
    'migration de composição pode anexar o helper ao diagnóstico principal'::text;

  RETURN QUERY SELECT
    'OS8 helpers mutantes não são RPC pública'::text,
    NOT pg_catalog.has_function_privilege(
      'anon',
      'public.settle_open_reservations_for_order(uuid,text)'::regprocedure,
      'EXECUTE'
    )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'public.settle_open_reservations_for_order(uuid,text)'::regprocedure,
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'public.expose_expected_consumption_gaps_for_order(uuid,text)'::regprocedure,
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'public.settle_canonical_strap_reservation_for_order(uuid,text)'::regprocedure,
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'public.settle_canonical_strap_reservation_for_order(uuid,text)'::regprocedure,
        'EXECUTE'
      ),
    'somente triggers/owner podem liquidar ou criar pendência'::text;

  RETURN QUERY SELECT
    'OS9 bypass de tira é estreito e restaura o GUC'::text,
    pg_catalog.strpos(v_settle, 'app.strap_engine_write') = 0
      AND pg_catalog.strpos(v_settle, 'strap_engine_finished') > 0
      AND pg_catalog.strpos(v_settle, 'sale_order_strap_demand_id IS NULL') > 0
      AND pg_catalog.strpos(v_settle, 'sv.finished_product_id = mr.product_id') > 0
      AND pg_catalog.strpos(
        v_settle,
        'demand.finished_product_id = mr.product_id'
      ) > 0
      AND pg_catalog.strpos(v_strap_writer, 'WHERE mr.id = p_reservation_id') > 0
      AND pg_catalog.strpos(v_strap_writer, 'v_previous_writer') > 0
      AND pg_catalog.strpos(v_strap_writer, 'v_writer_enabled') > 0
      AND pg_catalog.strpos(v_strap_writer, 'EXCEPTION WHEN OTHERS') > 0
      AND pg_catalog.strpos(v_strap_writer, 'falha ao restaurar GUC') > 0
      AND pg_catalog.strpos(v_strap_writer, 'material_reservation_id') > 0
      AND pg_catalog.strpos(v_strap_writer, 'sale_order_item_id') > 0
      AND pg_catalog.strpos(v_strap_bind, 'v_previous_writer') > 0
      AND pg_catalog.strpos(v_strap_bind, 'EXCEPTION WHEN OTHERS') > 0
      AND pg_catalog.strpos(v_strap_bind_trigger, 'app.strap_engine_write') = 0
      AND pg_catalog.strpos(
        v_strap_attach,
        'material_reservation_id = NEW.id'
      ) > 0
      AND pg_catalog.strpos(v_strap_attach, 'v_previous_writer') > 0,
    'writer genérico não ganha bypass; writer canônico usa reserva UUID e restaura o estado anterior mesmo em erro'::text;

  RETURN QUERY SELECT
    'OS10 rastreio só liga candidato causalmente único'::text,
    pg_catalog.strpos(
      v_before_trace,
      'WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1'
    ) > 0
      AND pg_catalog.strpos(v_before_trace, 'Vínculo causal inválido') > 0
      AND pg_catalog.strpos(v_before_trace, 'RAISE EXCEPTION') > 0
      AND pg_catalog.strpos(
        v_before_trace,
        'IF v_candidate_id IS NULL THEN'
      ) > 0
      AND pg_catalog.strpos(
        v_before_trace,
        'OR NEW.correlation_id IS NULL'
      ) > 0
      AND pg_catalog.strpos(
        v_before_trace,
        'mr.correlation_id = NEW.correlation_id'
      ) > 0
      AND pg_catalog.strpos(v_before_trace, 'FOR UPDATE OF mr') > 0
      AND pg_catalog.strpos(
        v_before_trace,
        'sv.finished_product_id = NEW.product_id'
      ) > 0
      AND pg_catalog.strpos(
        v_late_trace,
        'WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1'
      ) > 0
      AND pg_catalog.strpos(v_late_trace, 'FOR UPDATE OF sm') > 0
      AND pg_catalog.strpos(
        v_late_trace,
        'sm.sale_order_strap_demand_id IS NULL'
      ) > 0
      AND pg_catalog.strpos(
        v_late_trace,
        'sm.correlation_id = NEW.correlation_id'
      ) > 0
      AND pg_catalog.strpos(v_late_trace, 'transaction_timestamp') = 0,
    'zero, múltiplos ou candidatos sem token causal permanecem sem vínculo e aparecem no diagnóstico'::text;

  RETURN QUERY SELECT
    'OS11 embalagem canônica não exige reserva de produto'::text,
    pg_catalog.strpos(v_trace_view, 'box_types canonical_box') > 0
      AND pg_catalog.strpos(
        v_trace_view,
        'canonical_box.id = sm.product_id'
      ) > 0
      AND pg_catalog.strpos(v_trace_view, 'NOT (EXISTS') > 0
      AND pg_catalog.strpos(v_trace_view, 'products p') > 0,
    'UUID de box_types é excluído; movimentos de products continuam diagnosticados'::text;

  RETURN QUERY SELECT
    'OS12 cobertura é por item, parcial e alertas não ficam stale'::text,
    pg_catalog.strpos(v_faturado_view, 'sale_order_item_id') > 0
      AND pg_catalog.strpos(v_faturado_view, 'item_issues') > 0
      AND pg_catalog.strpos(
        v_consumption_view,
        'consumo_parcial_sem_pendencia'
      ) > 0
      AND pg_catalog.strpos(v_consumption_view, 'gap_quantity') > 0
      AND pg_catalog.strpos(v_order_alert_trigger, 'OLD.sale_order_id') > 0
      AND pg_catalog.strpos(
        v_pv_alert_trigger,
        'NEW.status IS DISTINCT FROM OLD.status'
      ) > 0,
    'excesso de outro item não mascara falta; gaps parciais aparecem e OLD/saída de Faturado são refrescados'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_op_stock_integrity_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_op_stock_integrity_contract_tests()
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
    FROM public.run_op_stock_integrity_contract_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION
      'Contratos OP–estoque falharam:%',
      E'\n' || v_failures;
  END IF;
END;
$self_test$;

NOTIFY pgrst, 'reload schema';

COMMIT;
