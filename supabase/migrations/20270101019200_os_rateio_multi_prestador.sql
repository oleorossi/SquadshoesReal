-- Rateio multi-prestador de OS por OP × setor.
-- Permite N OS ativas (prestadores distintos) + sobra na fábrica,
-- com teto Σ qty ≤ orders.quantity e ledger por prestador/data/valor.

-- ---------------------------------------------------------------------------
-- 1) Unicidade: OP × setor × prestador (não mais OP × setor)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_os_per_op_sector;

CREATE UNIQUE INDEX uq_os_per_op_sector_contractor
  ON public.service_orders (order_id, target_sector, contractor_id)
  WHERE order_id IS NOT NULL
    AND target_sector IS NOT NULL
    AND contractor_id IS NOT NULL
    AND public.normalize_service_order_status(status) <> 'Cancelado';

COMMENT ON INDEX public.uq_os_per_op_sector_contractor IS
  'Uma OS ativa por OP × atividade × prestador. Rateio multi-prestador; sobra sem OS = fábrica.';

-- ---------------------------------------------------------------------------
-- 2) Ficha: vários prestadores ativos por atividade
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_reference_terceirizacoes_active_ref_sector;

CREATE UNIQUE INDEX uq_reference_terceirizacoes_active_ref_sector_contractor
  ON public.reference_terceirizacoes (
    reference_id,
    public.normalize_outsource_sector(sector),
    contractor_id
  )
  WHERE active = true
    AND public.normalize_outsource_sector(sector) IS NOT NULL
    AND contractor_id IS NOT NULL;

COMMENT ON INDEX public.uq_reference_terceirizacoes_active_ref_sector_contractor IS
  'Uma configuração ativa por ficha × atividade × prestador (rateio multi-prestador).';

-- ---------------------------------------------------------------------------
-- 3) Teto de rateio: Σ qty ativas (OP×setor) ≤ quantidade da OP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_cap_os_allocation_per_op_sector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_qty numeric;
  v_sector text;
  v_allocated numeric;
  v_new_qty numeric;
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.normalize_service_order_status(NEW.status) = 'Cancelado' THEN
    RETURN NEW;
  END IF;

  v_sector := public.normalize_outsource_sector(COALESCE(NEW.target_sector, NEW.sector));
  IF v_sector IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.quantity
    INTO v_order_qty
    FROM public.orders o
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL;
  IF v_order_qty IS NULL THEN
    RAISE EXCEPTION 'OP de origem não encontrada para o rateio da OS.';
  END IF;

  v_new_qty := COALESCE(NEW.quantity, 0);
  IF v_new_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_new_qty <= 0
     OR v_new_qty <> pg_catalog.trunc(v_new_qty) THEN
    RAISE EXCEPTION 'Quantidade da OS deve ser um inteiro de pares maior que zero.';
  END IF;

  SELECT COALESCE(SUM(so.quantity), 0)
    INTO v_allocated
    FROM public.service_orders so
   WHERE so.order_id = NEW.order_id
     AND public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector)) = v_sector
     AND public.normalize_service_order_status(so.status) <> 'Cancelado'
     AND so.id IS DISTINCT FROM NEW.id;

  IF v_allocated + v_new_qty > v_order_qty THEN
    RAISE EXCEPTION
      'Rateio excede a OP: % pares já alocados + % = % > % pares da OP. Reduza a parcela ou cancele outra OS.',
      v_allocated, v_new_qty, v_allocated + v_new_qty, v_order_qty;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cap_os_allocation_per_op_sector ON public.service_orders;
CREATE TRIGGER trg_cap_os_allocation_per_op_sector
  BEFORE INSERT OR UPDATE OF quantity, status, order_id, target_sector, sector, contractor_id
  ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cap_os_allocation_per_op_sector();

COMMENT ON FUNCTION public.tg_cap_os_allocation_per_op_sector() IS
  'Garante que a soma das OS ativas por OP×setor não ultrapasse a quantidade da OP (sobra = fábrica).';

-- ---------------------------------------------------------------------------
-- 4) Writer: existência por OP×setor×prestador + teto de rateio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_op_service_order_impl_115(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_quoted_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order record;
  v_sale record;
  v_sale_order_id uuid;
  v_existing record;
  v_sector text;
  v_qty numeric;
  v_price numeric;
  v_config_id uuid;
  v_config_price numeric;
  v_deadline date;
  v_desc text;
  v_notes text;
  v_os_id uuid;
  v_label text;
  v_previous_writer_marker text;
  v_writer_marker text;
  v_today date := public.br_today();
  v_allocated numeric;
BEGIN
  IF p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Prestador obrigatório.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contractors
     WHERE id = p_contractor_id AND active
  ) THEN
    RAISE EXCEPTION 'Prestador inexistente ou inativo.';
  END IF;

  v_sector := public.normalize_outsource_sector(p_sector);

  SELECT o.sale_order_id
    INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF NOT FOUND OR v_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'OP não encontrada ou sem PV de origem.';
  END IF;

  SELECT sale.id, sale.order_number, sale.client_order_number,
         sale.delivery_deadline, sale.status
    INTO v_sale
    FROM public.sale_orders sale
   WHERE sale.id = v_sale_order_id
   FOR SHARE OF sale;
  IF NOT FOUND
     OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_sale.status, '')))
        IN ('cancelado', 'cancelada', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado ou cancelado.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('op_os:' || p_order_id::text || ':' || COALESCE(v_sector, ''))
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('outsource_queue:' || p_contractor_id::text || ':' || COALESCE(v_sector, ''))
  );

  SELECT o.id, o.order_number, o.quantity, o.color, o.sale_order_id,
         o.reference_id, o.sale_order_item_id,
         ts.code AS ref_code, ts.name AS ref_name
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
     AND NOT public.is_inactive_production_order_status(o.status);
  IF NOT FOUND OR v_order.sale_order_id IS DISTINCT FROM v_sale_order_id THEN
    RAISE EXCEPTION 'OP não encontrada ou inativa.';
  END IF;

  -- Idempotência por OP × setor × prestador (não bloqueia outro prestador).
  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND contractor_id = p_contractor_id
     AND public.normalize_outsource_sector(COALESCE(target_sector, sector)) = v_sector
     AND public.normalize_service_order_status(status) = 'Concluído'
   ORDER BY created_at DESC, id
   LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'action', 'exists',
      'os_id', v_existing.id,
      'os_number', v_existing.order_number
    );
  END IF;

  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND contractor_id = p_contractor_id
     AND public.normalize_outsource_sector(COALESCE(target_sector, sector)) = v_sector
     AND public.normalize_service_order_status(status)
         NOT IN ('Concluído', 'Cancelado')
   ORDER BY created_at DESC, id
   LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'action', 'exists',
      'os_id', v_existing.id,
      'os_number', v_existing.order_number
    );
  END IF;

  SELECT COALESCE(SUM(so.quantity), 0)
    INTO v_allocated
    FROM public.service_orders so
   WHERE so.order_id = p_order_id
     AND public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector)) = v_sector
     AND public.normalize_service_order_status(so.status) <> 'Cancelado';

  v_qty := COALESCE(p_quantity, v_order.quantity - v_allocated, 0);
  IF v_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_qty <= 0
     OR v_allocated + v_qty > COALESCE(v_order.quantity, 0) THEN
    RAISE EXCEPTION
      'Quantidade da OS deve estar entre 1 e % pares restantes (OP %; já alocados %).',
      GREATEST(COALESCE(v_order.quantity, 0) - v_allocated, 0),
      v_order.quantity,
      v_allocated;
  END IF;
  IF v_qty <> pg_catalog.trunc(v_qty) THEN
    RAISE EXCEPTION 'Quantidade da OS deve ser um número inteiro de pares.';
  END IF;

  SELECT r.id, r.value_per_pair
    INTO v_config_id, v_config_price
    FROM public.reference_terceirizacoes r
   WHERE r.reference_id = v_order.reference_id
     AND r.contractor_id = p_contractor_id
     AND COALESCE(r.active, true)
     AND public.normalize_outsource_sector(r.sector) = v_sector
   ORDER BY r.updated_at DESC NULLS LAST, r.id
   LIMIT 1
   FOR SHARE OF r;

  v_price := COALESCE(
    p_unit_price,
    NULLIF(v_config_price, 0),
    public.get_contractor_rate(p_contractor_id, v_sector, v_today),
    0
  );
  IF v_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_price <= 0 THEN
    RAISE EXCEPTION 'Sem tarifa para este prestador e setor. Cadastre o R$/par antes de gerar a OS.';
  END IF;

  v_deadline := CASE
    WHEN v_config_id IS NOT NULL THEN p_quoted_deadline
    ELSE COALESCE(p_quoted_deadline, v_sale.delivery_deadline, public.add_business_days(v_today, 14))
  END;
  v_label := CASE v_sector
    WHEN 'corte_cabedal'  THEN 'Corte Cabedal'
    WHEN 'costura'        THEN 'Costura'
    WHEN 'corte_palmilha' THEN 'Corte Palmilha'
    WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'fachete'        THEN 'Fachete'
    WHEN 'silk'           THEN 'Silk'
    WHEN 'mesa'           THEN 'Aviamento'
    WHEN 'colagem'        THEN 'Colagem'
    WHEN 'montagem'       THEN 'Montagem'
    WHEN 'solagem'        THEN 'Solagem'
    WHEN 'acabamento'     THEN 'Acabamento'
    ELSE v_sector
  END;

  v_desc := v_label || ' · ' || COALESCE(v_order.ref_code, v_order.ref_name, 'Referência')
    || COALESCE(' · ' || NULLIF(pg_catalog.btrim(v_order.color), ''), '')
    || ' · OP ' || COALESCE(v_order.order_number, v_order.id::text);
  v_notes := CASE
    WHEN NULLIF(pg_catalog.btrim(v_sale.client_order_number), '') IS NOT NULL
      THEN 'PV cliente: ' || pg_catalog.btrim(v_sale.client_order_number)
        || ' | PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
    ELSE 'PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
  END;

  v_previous_writer_marker := pg_catalog.current_setting(
    'app.outsource_op_writer',
    true
  );
  v_writer_marker := 'canonical:' || pg_catalog.pg_current_xact_id()::text;
  PERFORM pg_catalog.set_config(
    'app.outsource_op_writer',
    v_writer_marker,
    true
  );

  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value,
    status, notes, quoted_deadline, is_avulsa, sale_order_id, source_sale_order_id,
    source_sale_order_item_id, source_item_key, order_id, target_sector, sector,
    dispatch_tracked, selected_sale_order_item_ids, source_terceirizacao_id
  ) VALUES (
    p_contractor_id, v_desc, v_today, v_qty, v_price, v_qty * v_price,
    'Pendente', v_notes, v_deadline, false, v_sale.id, v_sale.id,
    v_order.sale_order_item_id, p_order_id::text || '::' || v_sector || '::' || p_contractor_id::text,
    p_order_id, v_sector, v_sector, true,
    CASE
      WHEN v_order.sale_order_item_id IS NOT NULL
        THEN ARRAY[v_order.sale_order_item_id]::uuid[]
      ELSE ARRAY[]::uuid[]
    END,
    v_config_id
  )
  RETURNING id INTO v_os_id;

  PERFORM pg_catalog.set_config(
    'app.outsource_op_writer',
    COALESCE(v_previous_writer_marker, ''),
    true
  );

  UPDATE public.orders
     SET outsourced_to_contractor_id = COALESCE(outsourced_to_contractor_id, p_contractor_id),
         outsourced_sector = COALESCE(outsourced_sector, v_sector),
         outsourced_at = COALESCE(outsourced_at, pg_catalog.now())
   WHERE id = p_order_id;

  RETURN pg_catalog.jsonb_build_object('action', 'created', 'os_id', v_os_id);
EXCEPTION WHEN unique_violation THEN
  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND contractor_id = p_contractor_id
     AND public.normalize_outsource_sector(COALESCE(target_sector, sector))
         = public.normalize_outsource_sector(p_sector)
     AND public.normalize_service_order_status(status) <> 'Cancelado'
   ORDER BY
     CASE
       WHEN public.normalize_service_order_status(status) = 'Concluído' THEN 0
       ELSE 1
     END,
     created_at DESC,
     id
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'action', 'exists',
    'os_id', v_existing.id,
    'os_number', v_existing.order_number
  );
END;
$function$;

COMMENT ON FUNCTION public.create_op_service_order_impl_115(uuid, text, uuid, numeric, numeric, date) IS
  'Writer canônico OP×setor×prestador com rateio: várias OS ativas até o teto da OP; sobra = fábrica.';

-- ---------------------------------------------------------------------------
-- 5) Prévia do PV: saldo restante + alocações existentes + prestadores da ficha
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_pv_outsourceable_lines(uuid);

CREATE FUNCTION public.get_pv_outsourceable_lines(p_sale_order_id uuid)
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
  existing_os_status text,
  default_terceirizacao_id uuid,
  capacity_pairs_per_day numeric,
  return_before_sector text,
  planning_anchor_sector text,
  material_components text[],
  execution_days integer,
  queue_days integer,
  lead_days integer,
  recommended_send_date date,
  required_return_date date,
  planning_source text,
  planning_warning text,
  planning_config_ready boolean,
  planning_config_issue text,
  allocated_quantity integer,
  remaining_quantity integer,
  existing_allocations jsonb,
  available_contractors jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH sectors(sector, label, stage_label, ord, alias_rank) AS (
    VALUES
      ('costura',        'Costura de cabedal', 'Costura Cabedal',  1, 0),
      ('costura',        'Costura de cabedal', 'Costura',          1, 1),
      ('mesa',           'Aviamento',           'Aviamento',        2, 0),
      ('mesa',           'Aviamento',           'Mesa',             2, 1),
      ('corte_cabedal',  'Corte Cabedal',       'Corte Cabedal',    4, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Fibra',      5, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Palmilha',   5, 1),
      ('corte_forracao', 'Corte Forração',      'Corte Forração',   6, 0),
      ('silk',           'Silk',                'Silk',             7, 0),
      ('colagem',        'Colagem',             'Colagem',          8, 0),
      ('montagem',       'Montagem',            'Montagem',         9, 0),
      ('solagem',        'Solagem',             'Solagem',         10, 0),
      ('acabamento',     'Acabamento',          'Acabamento',      11, 0)
  ),
  ops AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.quantity,
           ts.code AS ref_code, ts.name AS ref_name, ts.production_sectors
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND (
         public.is_approved_user()
         OR session_user::text IN ('postgres', 'supabase_admin', 'service_role')
         OR COALESCE(
              pg_catalog.current_setting('request.jwt.claim.role', true),
              ''
            ) = 'service_role'
       )
       AND NOT public.is_inactive_production_order_status(o.status)
  ),
  op_sectors AS (
    SELECT s.order_id, s.stage_name AS sector_label, s.status AS sector_status
      FROM public.order_stages s
     WHERE s.order_id IN (SELECT id FROM ops)
    UNION
    SELECT op.id, ps.value AS sector_label, NULL::text AS sector_status
      FROM ops op
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
        CASE WHEN pg_catalog.jsonb_typeof(op.production_sectors) = 'array'
             THEN op.production_sectors ELSE '[]'::jsonb END
      ) ps(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_stages s2 WHERE s2.order_id = op.id
     )
  ),
  routed AS (
    SELECT DISTINCT ON (op.id, sc.sector)
      op.id, op.order_number, op.reference_id, op.ref_code, op.ref_name,
      op.color, op.quantity, sc.sector, sc.label, sc.ord,
      osx.sector_status
      FROM ops op
      JOIN op_sectors osx ON osx.order_id = op.id
      JOIN sectors sc
        ON pg_catalog.lower(pg_catalog.btrim(sc.stage_label))
         = pg_catalog.lower(pg_catalog.btrim(osx.sector_label))
     ORDER BY op.id, sc.sector, sc.alias_rank
  ),
  synthetic_fachete AS (
    SELECT op.id, op.order_number, op.reference_id, op.ref_code, op.ref_name,
           op.color, op.quantity, 'fachete'::text AS sector,
           'Fachete'::text AS label, 3 AS ord, NULL::text AS sector_status
      FROM ops op
     WHERE EXISTS (
       SELECT 1
         FROM public.reference_terceirizacoes r
        JOIN public.contractors c ON c.id = r.contractor_id AND c.active
        WHERE r.reference_id = op.reference_id
          AND COALESCE(r.active, true)
          AND public.normalize_outsource_sector(r.sector) = 'fachete'
     )
       AND NOT EXISTS (
         SELECT 1 FROM routed m
          WHERE m.id = op.id AND m.sector = 'fachete'
       )
  ),
  matched AS (
    SELECT * FROM routed
    UNION ALL
    SELECT * FROM synthetic_fachete
  ),
  alloc AS (
    SELECT
      so.order_id,
      public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector)) AS sector,
      COALESCE(SUM(so.quantity), 0)::integer AS allocated_quantity,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'os_id', so.id,
          'os_number', so.order_number,
          'contractor_id', so.contractor_id,
          'contractor_name', COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')),
          'quantity', so.quantity,
          'unit_price', so.unit_price,
          'total_value', so.total_value,
          'status', so.status,
          'created_at', so.created_at,
          'service_date', so.service_date
        )
        ORDER BY so.created_at, so.id
      ) AS existing_allocations
      FROM public.service_orders so
      LEFT JOIN public.contractors c ON c.id = so.contractor_id
     WHERE so.order_id IN (SELECT id FROM ops)
       AND public.normalize_service_order_status(so.status) <> 'Cancelado'
     GROUP BY so.order_id, public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector))
  )
  SELECT
    m.id AS order_id,
    m.order_number AS op_number,
    m.reference_id,
    m.ref_code,
    m.ref_name,
    m.color,
    m.quantity,
    m.sector,
    m.label AS sector_label,
    m.sector_status,
    rt.contractor_id AS default_contractor_id,
    rt.contractor_name AS default_contractor_name,
    COALESCE(
      NULLIF(rt.value_per_pair, 0),
      public.get_contractor_rate(rt.contractor_id, m.sector, public.br_today())
    ) AS default_rate,
    (COALESCE(al.allocated_quantity, 0) >= m.quantity) AS already_has_os,
    (
      SELECT so.status
        FROM public.service_orders so
       WHERE so.order_id = m.id
         AND public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector)) = m.sector
         AND public.normalize_service_order_status(so.status) <> 'Cancelado'
       ORDER BY so.created_at DESC
       LIMIT 1
    ) AS existing_os_status,
    rt.id AS default_terceirizacao_id,
    rt.capacity_pairs_per_day,
    COALESCE(
      NULLIF(pg_catalog.btrim(rt.return_before_sector), ''),
      public.default_outsource_return_before_sector(m.sector)
    ) AS return_before_sector,
    NULLIF(plan.payload ->> 'schedule_anchor_sector', '') AS planning_anchor_sector,
    COALESCE(rt.material_components, ARRAY[]::text[]) AS material_components,
    NULLIF(plan.payload ->> 'execution_days', '')::integer AS execution_days,
    NULLIF(plan.payload ->> 'queue_days', '')::integer AS queue_days,
    NULLIF(plan.payload ->> 'lead_days', '')::integer AS lead_days,
    NULLIF(plan.payload ->> 'recommended_send_date', '')::date AS recommended_send_date,
    NULLIF(plan.payload ->> 'required_return_date', '')::date AS required_return_date,
    NULLIF(plan.payload ->> 'source', '') AS planning_source,
    COALESCE(
      NULLIF(plan.payload ->> 'warning', ''),
      CASE WHEN rt.id IS NULL THEN
        'Sem configuração ativa da ficha para esta atividade; capacidade, prazo reverso e materiais não foram calculados.'
      END
    ) AS planning_warning,
    (
      rt.id IS NOT NULL
      AND config_check.issue IS NULL
      AND NULLIF(plan.payload ->> 'schedule_anchor_sector', '') IS NOT NULL
      AND anchor_stage.stage_name IS NOT NULL
      AND public.normalize_service_order_status(anchor_stage.status)
          NOT IN ('Em Andamento', 'Concluído')
      AND COALESCE(anchor_stage.quantity_processed, 0) = 0
      AND (
        m.sector = 'fachete'
        OR public.normalize_service_order_status(m.sector_status) <> 'Concluído'
      )
      AND COALESCE(al.allocated_quantity, 0) < m.quantity
    ) AS planning_config_ready,
    CASE
      WHEN COALESCE(al.allocated_quantity, 0) >= m.quantity THEN
        'Rateio completo — todos os pares desta OP/atividade já têm OS (ou a OP ficou sem sobra para a fábrica).'
      WHEN m.sector <> 'fachete'
       AND public.normalize_service_order_status(m.sector_status) = 'Concluído'
        THEN 'Etapa já concluída internamente.'
      WHEN rt.id IS NULL THEN
        'Sem configuração ativa para a ficha, prestador padrão e atividade.'
      WHEN config_check.issue IS NOT NULL THEN config_check.issue
      WHEN NULLIF(plan.payload ->> 'schedule_anchor_sector', '') IS NULL
        THEN 'Etapa real de retorno não encontrada na rota atual da OP.'
      WHEN anchor_stage.stage_name IS NULL
        THEN 'Etapa real de retorno não existe mais na rota atual da OP.'
      WHEN public.normalize_service_order_status(anchor_stage.status)
             IN ('Em Andamento', 'Concluído')
        OR COALESCE(anchor_stage.quantity_processed, 0) > 0
        THEN 'Etapa de retorno ' || anchor_stage.stage_name
          || ' já iniciou internamente.'
      ELSE NULL
    END AS planning_config_issue,
    COALESCE(al.allocated_quantity, 0) AS allocated_quantity,
    GREATEST(m.quantity - COALESCE(al.allocated_quantity, 0), 0) AS remaining_quantity,
    COALESCE(al.existing_allocations, '[]'::jsonb) AS existing_allocations,
    COALESCE(contractors_cfg.available_contractors, '[]'::jsonb) AS available_contractors
  FROM matched m
  LEFT JOIN alloc al
    ON al.order_id = m.id AND al.sector = m.sector
  LEFT JOIN LATERAL (
    SELECT r.id, r.contractor_id, r.value_per_pair,
           r.capacity_pairs_per_day, r.return_before_sector,
           r.material_components,
           COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')) AS contractor_name
      FROM public.reference_terceirizacoes r
      JOIN public.contractors c ON c.id = r.contractor_id AND c.active
     WHERE r.reference_id = m.reference_id
       AND COALESCE(r.active, true)
       AND public.normalize_outsource_sector(r.sector) = m.sector
     ORDER BY r.updated_at DESC NULLS LAST, r.id
     LIMIT 1
  ) rt ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'terceirizacao_id', r.id,
        'contractor_id', r.contractor_id,
        'contractor_name', COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')),
        'value_per_pair', COALESCE(
          NULLIF(r.value_per_pair, 0),
          public.get_contractor_rate(r.contractor_id, m.sector, public.br_today())
        ),
        'capacity_pairs_per_day', r.capacity_pairs_per_day,
        'return_before_sector', COALESCE(
          NULLIF(pg_catalog.btrim(r.return_before_sector), ''),
          public.default_outsource_return_before_sector(m.sector)
        ),
        'material_components', COALESCE(r.material_components, ARRAY[]::text[]),
        'config_issue', public.outsource_config_issue(
          m.sector,
          r.capacity_pairs_per_day,
          r.return_before_sector,
          r.material_components
        )
      )
      ORDER BY COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')), r.id
    ) AS available_contractors
      FROM public.reference_terceirizacoes r
      JOIN public.contractors c ON c.id = r.contractor_id AND c.active
     WHERE r.reference_id = m.reference_id
       AND COALESCE(r.active, true)
       AND public.normalize_outsource_sector(r.sector) = m.sector
  ) contractors_cfg ON true
  LEFT JOIN LATERAL (
    SELECT public.outsource_config_issue(
      m.sector,
      rt.capacity_pairs_per_day,
      rt.return_before_sector,
      rt.material_components
    ) AS issue
     WHERE rt.id IS NOT NULL
  ) config_check ON true
  LEFT JOIN LATERAL (
    SELECT public.calculate_outsource_plan(
      m.id, m.sector, rt.contractor_id, m.quantity, NULL, NULL
    ) AS payload
     WHERE rt.contractor_id IS NOT NULL
  ) plan ON true
  LEFT JOIN LATERAL (
    SELECT stage.stage_name, stage.status, stage.quantity_processed
      FROM public.order_stages stage
     WHERE stage.order_id = m.id
       AND public.normalize_outsource_sector(stage.stage_name)
           = public.normalize_outsource_sector(
               NULLIF(plan.payload ->> 'schedule_anchor_sector', '')
             )
     ORDER BY stage.stage_order
     LIMIT 1
  ) anchor_stage ON true
  ORDER BY m.ord, m.order_number;
$function$;

REVOKE ALL ON FUNCTION public.get_pv_outsourceable_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pv_outsourceable_lines(uuid) IS
  'Lista OP×setor do PV com rateio: saldo restante, alocações existentes e prestadores ativos da ficha.';

-- ---------------------------------------------------------------------------
-- 6) Ledger do PV: prestador × data × valor (OS + remessa)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_pv_outsourcing_ledger
WITH (security_invoker = true)
AS
SELECT
  so.id AS service_order_id,
  so.order_number AS os_number,
  COALESCE(so.source_sale_order_id, so.sale_order_id) AS sale_order_id,
  so.order_id,
  o.order_number AS op_number,
  o.color AS op_color,
  public.normalize_outsource_sector(COALESCE(so.target_sector, so.sector)) AS sector,
  so.contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')) AS contractor_name,
  so.quantity,
  so.unit_price,
  so.total_value,
  so.status,
  so.service_date,
  so.created_at,
  (
    SELECT MIN(d.dispatched_at)
      FROM public.service_order_dispatches d
     WHERE d.service_order_id = so.id
  ) AS first_dispatched_at,
  (
    SELECT COALESCE(SUM(d.qty_dispatched), 0)
      FROM public.service_order_dispatches d
     WHERE d.service_order_id = so.id
  ) AS qty_dispatched,
  (
    SELECT COALESCE(SUM(r.qty_good), 0)
      FROM public.service_order_returns r
     WHERE r.service_order_id = so.id
  ) AS qty_returned_good
FROM public.service_orders so
LEFT JOIN public.orders o ON o.id = so.order_id
LEFT JOIN public.contractors c ON c.id = so.contractor_id
WHERE so.archived_at IS NULL
  AND public.normalize_service_order_status(so.status) <> 'Cancelado'
  AND COALESCE(so.source_sale_order_id, so.sale_order_id) IS NOT NULL;

COMMENT ON VIEW public.v_pv_outsourcing_ledger IS
  'Ledger de terceirização por PV: OS × prestador × data × valor, com remessa/retorno agregados.';

GRANT SELECT ON public.v_pv_outsourcing_ledger TO authenticated, service_role;
