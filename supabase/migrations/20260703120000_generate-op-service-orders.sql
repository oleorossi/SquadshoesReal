-- Gerar OS de terceirização por Pedido → Serviço → OP
--
-- Fluxo novo: o usuário escolhe o PV, os serviços (setores) que vão pra rua e,
-- em cada serviço, as OPs que está enviando. Gera UMA OS por (OP × setor)
-- atrelada à OP correta (service_orders.order_id) + target_sector.
--
-- Reusa o schema existente: a OS nasce como service_orders normal (Pendente,
-- is_avulsa=false), aparece no quadro "Na Rua" (v_outsourced_in_field, que já
-- junta orders via so.order_id) e segue o fluxo de envio/retorno/pagamento.
-- NÃO carimba orders.outsourced_* (evita linha duplicada na view e permite mais
-- de um setor terceirizado por OP).

-- 1) Catálogo de terceirização passa a poder mapear serviço → setor, pra
--    pré-preencher contratada + preço por (referência, setor) no assistente.
ALTER TABLE public.reference_terceirizacoes
  ADD COLUMN IF NOT EXISTS sector text;

-- 2) Idempotência: no máximo 1 OS ATIVA por (OP, setor). OS cancelada não conta
--    (pode reenviar). Rows legadas do fluxo por-item têm target_sector NULL e
--    ficam fora do índice (NULL não conflita).
CREATE UNIQUE INDEX IF NOT EXISTS uq_os_per_op_sector
  ON public.service_orders (order_id, target_sector)
  WHERE order_id IS NOT NULL
    AND target_sector IS NOT NULL
    AND status NOT IN ('Cancelado', 'cancelled', 'cancelada');

-- 3) Leitura: linhas terceirizáveis de um PV, uma por (OP × setor).
--    Setores = order_stages da OP (fonte real) ∩ setores terceirizáveis;
--    fallback em technical_sheets.production_sectors quando a OP ainda não tem
--    stages. default_contractor/rate vêm do catálogo (reference_terceirizacoes).
CREATE OR REPLACE FUNCTION public.get_pv_outsourceable_lines(p_sale_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  op_number text,
  reference_id uuid,
  ref_code text,
  ref_name text,
  color text,
  quantity integer,
  sector text,
  sector_label text,
  sector_status text,
  default_contractor_id uuid,
  default_contractor_name text,
  default_rate numeric,
  already_has_os boolean,
  existing_os_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sectors(sector, label, ord) AS (
    VALUES
      ('corte_cabedal',  'Corte Cabedal',  1),
      ('costura',        'Costura',        2),
      ('corte_palmilha', 'Corte Palmilha', 3),
      ('corte_forracao', 'Corte Forração', 4),
      ('silk',           'Silk',           5),
      ('montagem',       'Montagem',       6),
      ('solagem',        'Solagem',        7),
      ('acabamento',     'Acabamento',     8)
  ),
  ops AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.quantity,
           ts.code AS ref_code, ts.name AS ref_name, ts.production_sectors
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    WHERE o.sale_order_id = p_sale_order_id
      AND o.deleted_at IS NULL
      AND COALESCE(o.status, '') NOT IN ('Cancelada', 'cancelada', 'Cancelado', 'cancelled')
  ),
  op_sectors AS (
    SELECT s.order_id, s.stage_name AS sector_label, s.status AS sector_status
    FROM public.order_stages s
    WHERE s.order_id IN (SELECT id FROM ops)
    UNION
    SELECT op.id, ps.value AS sector_label, NULL::text AS sector_status
    FROM ops op
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(op.production_sectors) = 'array'
           THEN op.production_sectors ELSE '[]'::jsonb END
    ) ps(value)
    WHERE NOT EXISTS (SELECT 1 FROM public.order_stages s2 WHERE s2.order_id = op.id)
  )
  SELECT
    op.id AS order_id,
    op.order_number AS op_number,
    op.reference_id,
    op.ref_code,
    op.ref_name,
    op.color,
    op.quantity,
    sc.sector,
    sc.label AS sector_label,
    osx.sector_status,
    rt.contractor_id AS default_contractor_id,
    COALESCE(NULLIF(ct.trade_name, ''), NULLIF(ct.name, '')) AS default_contractor_name,
    COALESCE(rt.value_per_pair,
             public.get_contractor_rate(rt.contractor_id, sc.sector, CURRENT_DATE)) AS default_rate,
    EXISTS (
      SELECT 1 FROM public.service_orders so
      WHERE so.order_id = op.id AND so.target_sector = sc.sector
        AND so.status NOT IN ('Cancelado', 'cancelled', 'cancelada')
    ) AS already_has_os,
    (SELECT so.status FROM public.service_orders so
      WHERE so.order_id = op.id AND so.target_sector = sc.sector
        AND so.status NOT IN ('Cancelado', 'cancelled', 'cancelada')
      ORDER BY so.created_at DESC LIMIT 1) AS existing_os_status
  FROM ops op
  JOIN op_sectors osx ON osx.order_id = op.id
  JOIN sectors sc ON lower(sc.label) = lower(osx.sector_label)
  LEFT JOIN LATERAL (
    SELECT r.contractor_id, r.value_per_pair
    FROM public.reference_terceirizacoes r
    WHERE r.reference_id = op.reference_id
      AND COALESCE(r.active, true)
      AND lower(COALESCE(r.sector, '')) IN (sc.sector, lower(sc.label))
    ORDER BY r.updated_at DESC NULLS LAST
    LIMIT 1
  ) rt ON true
  LEFT JOIN public.contractors ct ON ct.id = rt.contractor_id
  ORDER BY sc.ord, op.order_number;
$function$;

-- 4) Escrita: cria as OS (uma por linha), atreladas à OP + setor. Idempotente
--    por (OP, setor): OS ativa existente → 'exists'; cancelada → reativa.
CREATE OR REPLACE FUNCTION public.generate_op_service_orders(
  p_sale_order_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD;
  v_line jsonb;
  v_order RECORD;
  v_out jsonb := '[]'::jsonb;
  v_ref_code text;
  v_sector text;
  v_label text;
  v_contractor uuid;
  v_qty integer;
  v_price numeric;
  v_deadline date;
  v_desc text;
  v_notes text;
  v_existing RECORD;
  v_os_id uuid;
  v_active constant text[] := ARRAY['Cancelado', 'cancelled', 'cancelada'];
BEGIN
  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sale_order_not_found'); END IF;
  IF lower(btrim(COALESCE(v_so.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'sale_order_cancelled');
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_sector    := v_line->>'sector';
    v_contractor:= NULLIF(v_line->>'contractor_id', '')::uuid;
    v_qty       := COALESCE((v_line->>'quantity')::numeric, 0)::integer;
    v_price     := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_deadline  := NULLIF(v_line->>'quoted_deadline', '')::date;

    SELECT o.id, o.order_number, o.color, o.quantity, o.reference_id
      INTO v_order FROM public.orders o
      WHERE o.id = NULLIF(v_line->>'order_id', '')::uuid
        AND o.sale_order_id = p_sale_order_id
        AND o.deleted_at IS NULL;
    IF NOT FOUND THEN
      v_out := v_out || jsonb_build_object('order_id', v_line->>'order_id', 'sector', v_sector, 'action', 'op_not_in_pv');
      CONTINUE;
    END IF;
    IF v_contractor IS NULL OR v_sector IS NULL OR v_qty <= 0 OR v_price <= 0 THEN
      v_out := v_out || jsonb_build_object('order_id', v_order.id, 'sector', v_sector, 'action', 'invalid_line');
      CONTINUE;
    END IF;

    v_label := COALESCE((SELECT m.label FROM (VALUES
        ('corte_cabedal', 'Corte Cabedal'), ('costura', 'Costura'),
        ('corte_palmilha', 'Corte Palmilha'), ('corte_forracao', 'Corte Forração'),
        ('silk', 'Silk'), ('montagem', 'Montagem'),
        ('solagem', 'Solagem'), ('acabamento', 'Acabamento')
      ) AS m(v, label) WHERE m.v = v_sector), v_sector);

    SELECT code INTO v_ref_code FROM public.technical_sheets WHERE id = v_order.reference_id;

    v_desc := v_label
      || ' · ' || COALESCE(v_ref_code, '?')
      || COALESCE(' ' || NULLIF(btrim(COALESCE(v_order.color, '')), ''), '')
      || ' · OP ' || COALESCE(v_order.order_number, v_order.id::text)
      || ' (lote ' || COALESCE(v_so.order_number, p_sale_order_id::text) || ')';

    IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
      v_notes := 'PV cliente: ' || btrim(v_so.client_order_number)
              || ' | PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
    ELSE
      v_notes := 'PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
    END IF;

    -- idempotência: ativa preferida sobre cancelada
    SELECT * INTO v_existing FROM public.service_orders so
      WHERE so.order_id = v_order.id AND so.target_sector = v_sector
      ORDER BY (CASE WHEN so.status = ANY (v_active) THEN 1 ELSE 0 END), so.created_at DESC
      LIMIT 1;

    IF FOUND THEN
      IF v_existing.status <> ALL (v_active) THEN
        v_out := v_out || jsonb_build_object('order_id', v_order.id, 'sector', v_sector, 'action', 'exists', 'os_id', v_existing.id);
        CONTINUE;
      ELSE
        UPDATE public.service_orders so SET
          contractor_id = v_contractor, description = v_desc, service_date = CURRENT_DATE,
          quantity = v_qty, unit_price = v_price, total_value = v_qty * v_price,
          quoted_deadline = v_deadline, status = 'Pendente', dispatch_tracked = false,
          sector = v_sector, notes = v_notes, updated_at = now()
        WHERE so.id = v_existing.id;
        v_out := v_out || jsonb_build_object('order_id', v_order.id, 'sector', v_sector, 'action', 'reactivated', 'os_id', v_existing.id);
        CONTINUE;
      END IF;
    END IF;

    BEGIN
      INSERT INTO public.service_orders (
        contractor_id, description, service_date, quantity, unit_price, total_value, status, notes,
        quoted_deadline, is_avulsa, sale_order_id, source_sale_order_id, source_item_key,
        order_id, target_sector, sector, dispatch_tracked
      ) VALUES (
        v_contractor, v_desc, CURRENT_DATE, v_qty, v_price, v_qty * v_price, 'Pendente', v_notes,
        v_deadline, false, p_sale_order_id, p_sale_order_id, v_order.id::text || '::' || v_sector,
        v_order.id, v_sector, v_sector, false
      ) RETURNING id INTO v_os_id;
      v_out := v_out || jsonb_build_object('order_id', v_order.id, 'sector', v_sector, 'action', 'created', 'os_id', v_os_id);
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_os_id FROM public.service_orders
        WHERE order_id = v_order.id AND target_sector = v_sector
          AND status <> ALL (v_active) LIMIT 1;
      v_out := v_out || jsonb_build_object('order_id', v_order.id, 'sector', v_sector, 'action', 'exists', 'os_id', v_os_id);
    END;
  END LOOP;

  RETURN jsonb_build_object('lines', v_out);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.generate_op_service_orders(uuid, jsonb) TO authenticated, service_role;
