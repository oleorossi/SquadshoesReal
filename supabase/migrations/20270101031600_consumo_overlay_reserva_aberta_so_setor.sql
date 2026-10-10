-- Overlay de setor do relatório marcava `ambiguous` sem dois destinos reais.
-- Causa medida (PV-00195 / OP-2026-04266): DISTINCT de setor|origem em TODAS
-- as reservas da OP, inclusive canceladas. Reserva viva sem chave + cancelada
-- `legacy_fallback` (setor nulo nos dois) travava Imprimir/PDF.
--
-- Esta função só anota setor. Não clobba component/source (16800).
-- Não altera resolve_consumption_sector_context (ficha / SKU duplicado).

CREATE OR REPLACE FUNCTION private.resolve_report_consumption_sector_context(
  p_scope_type text,
  p_scope_key uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_product_id uuid,
  p_component text,
  p_source text,
  p_current_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- sector_keys_only_20270101016800
  -- reservation_open_sector_only_20270101031600
  v_status text;
  v_context jsonb;
  v_snapshot jsonb;
  v_open_count integer := 0;
  v_sector_count integer := 0;
  v_annotated integer := 0;
  v_sector text;
  v_origin text;
  v_sale_order_found boolean := false;
BEGIN
  SELECT sale_order.status
    INTO v_status
   FROM public.sale_orders sale_order
   WHERE sale_order.id = p_sale_order_id;
  v_sale_order_found := FOUND;

  IF v_sale_order_found
     AND NOT private.is_committed_sale_order_status(v_status) THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector',
        CASE WHEN p_current_context IS NULL THEN NULL
             ELSE p_current_context -> 'consumption_sector' END,
      'consumption_sector_source', COALESCE(
        p_current_context ->> 'consumption_sector_source',
        'legacy_fallback'
      )
    );
  END IF;

  IF p_scope_type = 'production_order'
     AND p_scope_key IS NOT NULL
     AND p_product_id IS NOT NULL THEN
    SELECT pg_catalog.count(*),
           pg_catalog.count(DISTINCT NULLIF(pg_catalog.btrim(
             reservation.metadata ->> 'consumption_sector'), '')),
           pg_catalog.count(*) FILTER (
             WHERE reservation.metadata ->> 'consumption_sector_source'
                   = 'ambiguous'
           ),
           pg_catalog.min(NULLIF(pg_catalog.btrim(
             reservation.metadata ->> 'consumption_sector'), '')),
           pg_catalog.min(reservation.metadata ->> 'consumption_sector_source')
      INTO v_open_count, v_sector_count, v_annotated, v_sector, v_origin
      FROM public.material_reservations reservation
     WHERE reservation.order_id = p_scope_key
       AND reservation.product_id = p_product_id
       AND reservation.status IN ('reserved', 'pending_reconciliation')
       AND (p_component IS NULL OR p_component = ''
         OR reservation.metadata ->> 'component' IS NULL
         OR reservation.metadata ->> 'component' = p_component)
       AND (p_source IS NULL OR p_source = ''
         OR reservation.metadata ->> 'source' IS NULL
         OR reservation.metadata ->> 'source' = p_source);

    -- Dois nomes de setor nas reservas abertas: conflito real.
    IF v_sector_count > 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous'
      );
    END IF;

    -- reservation_ambiguous_passthrough_20270101015500
    -- v_origin = 'ambiguous' permanece bloqueante em vez de virar reservation.
    IF v_annotated > 0
       AND v_sector_count <= 1
       AND v_origin = 'ambiguous' THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous',
        'consumption_sector_origin', 'ambiguous'
      );
    END IF;

    IF v_sector_count = 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_sector,
        'consumption_sector_source', 'reservation',
        'consumption_sector_origin', v_origin
      );
    END IF;
    -- v_open_count com zero setores nomeados: cair no snapshot / contexto atual.
    -- Cancelada/consumida/convertida já ficou de fora do SELECT.
  END IF;

  IF NOT v_sale_order_found THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector',
        CASE WHEN p_current_context IS NULL THEN NULL
             ELSE p_current_context -> 'consumption_sector' END,
      'consumption_sector_source', COALESCE(
        p_current_context ->> 'consumption_sector_source',
        'legacy_fallback'
      )
    );
  END IF;

  SELECT snapshot.consumption_snapshot
    INTO v_snapshot
    FROM public.technical_sheet_snapshots snapshot
   WHERE snapshot.sale_order_item_id = p_sale_order_item_id
     AND snapshot.sale_order_id IS NOT DISTINCT FROM p_sale_order_id
   ORDER BY snapshot.frozen_at DESC, snapshot.id DESC
   LIMIT 1;
  IF FOUND THEN
    v_context := private.snapshot_sector_context_for_product(
      v_snapshot, p_product_id, p_component, p_source
    );
    IF v_context ->> 'consumption_sector_source'
         NOT IN ('snapshot_missing', 'ambiguous') THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_context -> 'consumption_sector',
        'consumption_sector_source', 'snapshot',
        'consumption_sector_origin',
          v_context ->> 'consumption_sector_source'
      );
    END IF;
    -- Antes: RETURN v_context (com component/source) — clobber.
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', v_context -> 'consumption_sector',
      'consumption_sector_source', v_context ->> 'consumption_sector_source'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'consumption_sector', NULL,
    'consumption_sector_source', 'snapshot_missing'
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_report_consumption_sector_context(
  text, uuid, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

DO $guard$
DECLARE
  v_resolve text;
  v_ctx jsonb;
  v_order_id uuid := '98fe8b88-ee68-4f21-a4e2-85fa74c0fb5b';
  v_sale_order_id uuid := '05af4ea7-a981-4092-9d65-16bbff153d2a';
  v_sale_item_id uuid := '7b11cf46-adfc-4e09-99fe-f23da2c30f86';
  v_hotmelt uuid := 'ffb56ae8-5c8c-4c06-9fc5-fccbaae33151';
  v_eva uuid := '4d188ffd-9a85-4a21-80a5-591ba83171ad';
  v_fallback jsonb := pg_catalog.jsonb_build_object(
    'consumption_sector', NULL,
    'consumption_sector_source', 'legacy_fallback'
  );
BEGIN
  v_resolve := pg_catalog.pg_get_functiondef(
    'private.resolve_report_consumption_sector_context(text,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  );
  IF position('reservation_open_sector_only_20270101031600' IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: resolve_report sem marca reservation_open_sector_only_20270101031600';
  END IF;
  IF position('sector_keys_only_20270101016800' IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: resolve_report perdeu sector_keys_only_20270101016800';
  END IF;
  IF position('RETURN v_context;' IN v_resolve) > 0 THEN
    RAISE EXCEPTION 'Preflight: resolve_report ainda devolve v_context cru';
  END IF;
  IF position($needle$status IN ('reserved', 'pending_reconciliation')$needle$
        IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: overlay ainda lê reserva morta';
  END IF;
  IF position(
       $needle$count(DISTINCT NULLIF(pg_catalog.btrim($needle$
       IN v_resolve
     ) = 0 THEN
    RAISE EXCEPTION 'Preflight: overlay não distingue só o nome de setor';
  END IF;
  IF position(
       $needle$|| '|' || COALESCE($needle$
       IN v_resolve
     ) > 0
     OR position(
       $needle$|| COALESCE(
               reservation.metadata ->> 'consumption_sector_source'$needle$
       IN v_resolve
     ) > 0 THEN
    RAISE EXCEPTION 'Preflight: overlay ainda concatena origem no DISTINCT';
  END IF;
  IF position('v_sector_count > 1' IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: overlay não bloqueia dois nomes de setor';
  END IF;
  IF position('reservation_ambiguous_passthrough_20270101015500' IN v_resolve) = 0
     OR position($needle$v_origin = 'ambiguous'$needle$ IN v_resolve) = 0 THEN
    RAISE EXCEPTION 'Preflight: perdeu passthrough de reserva já ambígua';
  END IF;

  -- Caso vivo PV-00195 / OP-2026-04266: cancelada vs viva, setor nulo.
  IF EXISTS (
    SELECT 1 FROM public.orders production_order
     WHERE production_order.id = v_order_id
  ) THEN
    v_ctx := private.resolve_report_consumption_sector_context(
      'production_order', v_order_id, v_sale_order_id, v_sale_item_id,
      v_hotmelt, 'Item padrão (solado)', 'sole_standard_per_size', v_fallback
    );
    IF v_ctx ->> 'consumption_sector_source' = 'ambiguous' THEN
      RAISE EXCEPTION 'OP-2026-04266 HOTMELT ainda ambiguous após overlay 31600';
    END IF;
    v_ctx := private.resolve_report_consumption_sector_context(
      'production_order', v_order_id, v_sale_order_id, v_sale_item_id,
      v_eva, 'Palmilha', 'sheet_per_size', v_fallback
    );
    IF v_ctx ->> 'consumption_sector_source' = 'ambiguous' THEN
      RAISE EXCEPTION 'OP-2026-04266 EVA 3MM ainda ambiguous após overlay 31600';
    END IF;
  END IF;
END
$guard$;
