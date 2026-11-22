CREATE OR REPLACE FUNCTION public.outsourced_pair_ledger(p_grain text DEFAULT 'week')
RETURNS TABLE (
  period_start date,
  period_label text,
  anchor_date date,
  anchor_source text,
  sale_order_id uuid,
  order_number text,
  order_status text,
  client_name text,
  item_id uuid,
  job_id uuid,
  service_order_id uuid,
  reference_id uuid,
  reference_code text,
  color text,
  sector_key text,
  sector_label text,
  contractor_id uuid,
  contractor_name text,
  open_internal boolean,
  demand_pairs integer,
  sent_pairs integer,
  received_pairs integer,
  balance_pairs integer,
  street_pairs integer,
  capacity_per_day numeric,
  capacity_period numeric,
  period_excess numeric,
  registration text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grain text := CASE lower(btrim(COALESCE(p_grain, 'week')))
    WHEN 'quinzena' THEN 'fortnight'
    WHEN 'fortnight' THEN 'fortnight'
    WHEN 'mes' THEN 'month'
    WHEN 'mês' THEN 'month'
    WHEN 'month' THEN 'month'
    WHEN 'semana' THEN 'week'
    ELSE 'week'
  END;
  v_days integer := CASE
    WHEN lower(btrim(COALESCE(p_grain, 'week'))) IN ('quinzena', 'fortnight') THEN 10
    WHEN lower(btrim(COALESCE(p_grain, 'week'))) IN ('mes', 'mês', 'month') THEN 22
    ELSE 5
  END;
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH open_orders AS (
    SELECT so.id,
           so.order_number,
           so.status,
           so.client_name,
           public.resolve_billing_week_for_order(so.id) AS billing_monday
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND lower(translate(COALESCE(so.status, ''), 'áàãâéêíóôõúç', 'aaaaeeiooouc'))
           IN ('aprovado', 'em producao', 'pendente')
  ),
  part_alloc AS (
    SELECT p.job_id, COALESCE(sum(trunc(p.pairs))::int, 0) AS allocated
      FROM public.atelier_job_parts p
     GROUP BY p.job_id
  ),
  job_base AS (
    SELECT j.id AS job_id,
           j.sale_order_id,
           j.sale_order_item_id AS item_id,
           j.technical_sheet_id AS reference_id,
           COALESCE(j.reference_code, ts.code) AS reference_code,
           COALESCE(j.color, 'Sem cor') AS color,
           public.outsourced_sector_key(j.sector) AS sector_key,
           j.sector AS sector_raw,
           j.execution_mode,
           j.contractor_id,
           trunc(j.pairs)::int AS job_pairs,
           trunc(COALESCE(j.received_pairs, 0))::int AS job_received,
           COALESCE(pa.allocated, 0) AS allocated,
           o.order_number,
           o.status AS order_status,
           o.client_name,
           COALESCE(d.ready_date, o.billing_monday) AS anchor_date,
           CASE WHEN d.ready_date IS NOT NULL THEN 'ready_date' ELSE 'billing_week' END AS anchor_source,
           COALESCE(
             NULLIF(soi.outsourced_sectors ->> j.sector, ''),
             NULLIF(soi.outsourced_sectors ->> public.outsourced_sector_key(j.sector), ''),
             NULLIF(soi.outsourced_sectors ->> 'costura', ''),
             NULLIF(soi.outsourced_sectors ->> 'aviamento', '')
           ) AS preferred_raw,
           acr.default_contractor_id
      FROM public.cabedal_prep_jobs j
      JOIN open_orders o ON o.id = j.sale_order_id
      LEFT JOIN part_alloc pa ON pa.job_id = j.id
      LEFT JOIN public.cabedal_prep_demands d ON d.id = j.demand_id
      LEFT JOIN public.sale_order_items soi ON soi.id = j.sale_order_item_id
      LEFT JOIN public.technical_sheets ts ON ts.id = j.technical_sheet_id
      LEFT JOIN public.atelier_complex_references acr
        ON acr.reference_id = j.technical_sheet_id
       AND acr.sector = j.sector
       AND acr.active
     WHERE j.pipeline_status <> 'cancelled'
       AND public.outsourced_sector_key(j.sector) IN ('costura', 'aviamento')
       AND (soi.id IS NULL OR soi.production_excluded_at IS NULL)
  ),
  lines AS (
    SELECT b.anchor_date, b.anchor_source, b.sale_order_id, b.order_number, b.order_status,
           b.client_name, b.item_id, b.job_id, p.service_order_id, b.reference_id, b.reference_code,
           b.color, b.sector_key,
           COALESCE(p.contractor_id, b.contractor_id,
             CASE WHEN b.preferred_raw ~* '^[0-9a-f-]{36}$' THEN b.preferred_raw::uuid END,
             b.default_contractor_id) AS contractor_id,
           (COALESCE(p.execution_mode, b.execution_mode) = 'internal') AS open_internal,
           trunc(p.pairs)::int AS demand_pairs,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.service_order_dispatches d
              WHERE d.service_order_id = p.service_order_id
           ) THEN trunc(p.pairs)::int ELSE 0 END AS sent_pairs,
           trunc(COALESCE(p.received_pairs, 0))::int AS received_pairs
      FROM job_base b
      JOIN public.atelier_job_parts p ON p.job_id = b.job_id
    UNION ALL
    SELECT b.anchor_date, b.anchor_source, b.sale_order_id, b.order_number, b.order_status,
           b.client_name, b.item_id, b.job_id, NULL::uuid, b.reference_id, b.reference_code,
           b.color, b.sector_key,
           COALESCE(b.contractor_id,
             CASE WHEN b.preferred_raw ~* '^[0-9a-f-]{36}$' THEN b.preferred_raw::uuid END,
             b.default_contractor_id),
           (b.execution_mode = 'internal'),
           GREATEST(b.job_pairs - b.allocated, 0),
           0,
           CASE WHEN b.allocated = 0 THEN b.job_received ELSE 0 END
      FROM job_base b
     WHERE GREATEST(b.job_pairs - b.allocated, 0) > 0
        OR b.allocated = 0
    UNION ALL
    SELECT COALESCE(o.billing_monday, os.service_date),
           CASE WHEN o.billing_monday IS NOT NULL THEN 'billing_week' ELSE 'service_date' END,
           COALESCE(os.sale_order_id, o.id),
           COALESCE(o.order_number, os.order_number),
           o.status,
           o.client_name,
           NULL::uuid,
           NULL::uuid,
           os.id,
           NULL::uuid,
           os.material_name,
           COALESCE(os.material_color, 'Sem cor'),
           public.outsourced_sector_key(COALESCE(os.target_sector, os.sector)),
           os.contractor_id,
           COALESCE(os.internal_execution, false),
           trunc(COALESCE(os.quantity, 0))::int,
           trunc(COALESCE(d.sent, 0))::int,
           trunc(COALESCE(r.received, 0))::int
      FROM public.service_orders os
      LEFT JOIN open_orders o ON o.id = os.sale_order_id
      LEFT JOIN LATERAL (
        SELECT sum(qty_dispatched) AS sent
          FROM public.service_order_dispatches
         WHERE service_order_id = os.id
      ) d ON true
      LEFT JOIN LATERAL (
        SELECT sum(qty_good) AS received
          FROM public.service_order_returns
         WHERE service_order_id = os.id
           AND reverses_return_id IS NULL
           AND COALESCE(adjustment_kind, '') <> 'reversal'
      ) r ON true
     WHERE lower(translate(COALESCE(os.status, ''), 'áàãâéêíóôõúç', 'aaaaeeiooouc'))
           NOT IN ('cancelado', 'concluido', 'finalizado')
       AND os.id NOT IN (
         SELECT p.service_order_id FROM public.atelier_job_parts p WHERE p.service_order_id IS NOT NULL
       )
       AND (os.sale_order_id IS NULL OR o.id IS NOT NULL)
       AND public.outsourced_sector_key(COALESCE(os.target_sector, os.sector)) IS NOT NULL
       AND public.outsourced_sector_key(COALESCE(os.target_sector, os.sector)) NOT IN ('costura', 'aviamento')
    UNION ALL
    SELECT COALESCE(d.ready_date, o.billing_monday),
           CASE WHEN d.ready_date IS NOT NULL THEN 'ready_date' ELSE 'billing_week' END,
           o.id, o.order_number, o.status, o.client_name, soi.id, NULL::uuid, NULL::uuid,
           soi.reference_id, ts.code, COALESCE(soi.color, 'Sem cor'), src.sector_key,
           src.contractor_id, false,
           trunc(COALESCE(soi.quantity, 0))::int, 0, 0
      FROM open_orders o
      JOIN public.sale_order_items soi ON soi.sale_order_id = o.id
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      LEFT JOIN LATERAL (
        SELECT dem.ready_date
          FROM public.cabedal_prep_demands dem
         WHERE dem.sale_order_item_id = soi.id
         ORDER BY dem.ready_date NULLS LAST
         LIMIT 1
      ) d ON true
      JOIN LATERAL (
        SELECT DISTINCT ON (u.sector_key) u.sector_key, u.contractor_id
          FROM (
            SELECT public.outsourced_sector_key(k.key) AS sector_key,
                   CASE
                     WHEN k.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN k.value::uuid
                   END AS contractor_id
              FROM jsonb_each_text(COALESCE(soi.outsourced_sectors, '{}'::jsonb)) k
            UNION ALL
            SELECT public.outsourced_sector_key(r.sector), r.contractor_id
              FROM public.reference_terceirizacoes r
             WHERE r.reference_id = soi.reference_id
               AND COALESCE(r.active, true)
               AND r.contractor_id IS NOT NULL
            UNION ALL
            SELECT public.outsourced_sector_key(a.sector), a.default_contractor_id
              FROM public.atelier_complex_references a
             WHERE a.reference_id = soi.reference_id
               AND a.active
               AND public.outsourced_sector_key(a.sector) IN ('costura', 'aviamento')
          ) u
         WHERE u.sector_key IS NOT NULL
         ORDER BY u.sector_key, u.contractor_id NULLS LAST
      ) src ON true
     WHERE soi.production_excluded_at IS NULL
       AND trunc(COALESCE(soi.quantity, 0))::int > 0
       AND src.sector_key IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.cabedal_prep_jobs j
          WHERE j.sale_order_item_id = soi.id
            AND j.pipeline_status <> 'cancelled'
            AND public.outsourced_sector_key(j.sector) = src.sector_key
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_orders os
          WHERE os.sale_order_id = o.id
            AND lower(translate(COALESCE(os.status, ''), 'áàãâéêíóôõúç', 'aaaaeeiooouc'))
                NOT IN ('cancelado', 'concluido', 'finalizado')
            AND public.outsourced_sector_key(COALESCE(os.target_sector, os.sector)) = src.sector_key
            AND (
              os.selected_sale_order_item_ids IS NULL
              OR soi.id = ANY (os.selected_sale_order_item_ids)
            )
       )
  ),
  priced AS (
    SELECT l.*,
           COALESCE(c.trade_name, c.name) AS contractor_name,
           cap.per_day AS capacity_per_day
      FROM lines l
      LEFT JOIN public.contractors c ON c.id = l.contractor_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (
            SELECT r.capacity_pairs_per_day
              FROM public.reference_terceirizacoes r
             WHERE r.contractor_id = l.contractor_id
               AND COALESCE(r.active, true)
               AND public.outsourced_sector_key(r.sector) = l.sector_key
               AND (l.reference_id IS NULL OR r.reference_id = l.reference_id)
               AND r.capacity_pairs_per_day > 0
             ORDER BY CASE WHEN r.reference_id = l.reference_id THEN 0 ELSE 1 END,
                      r.capacity_pairs_per_day DESC
             LIMIT 1
          ),
          (
            SELECT max(os.provider_capacity_pairs_per_day)
              FROM public.service_orders os
             WHERE os.contractor_id = l.contractor_id
               AND os.provider_capacity_pairs_per_day > 0
          )
        ) AS per_day
      ) cap ON true
     WHERE l.sector_key IS NOT NULL
       AND l.demand_pairs > 0
  ),
  folded AS (
    SELECT p.*,
           CASE v_grain
             WHEN 'month' THEN date_trunc('month', p.anchor_date)::date
             WHEN 'fortnight' THEN public.billing_fortnight_start(p.anchor_date)
             ELSE date_trunc('week', p.anchor_date)::date
           END AS period_start,
           max(p.capacity_per_day) OVER (
             PARTITION BY CASE v_grain
               WHEN 'month' THEN date_trunc('month', p.anchor_date)::date
               WHEN 'fortnight' THEN public.billing_fortnight_start(p.anchor_date)
               ELSE date_trunc('week', p.anchor_date)::date
             END, p.contractor_id
           ) AS period_capacity_per_day
      FROM priced p
  )
  SELECT f.period_start,
         CASE
           WHEN f.period_start IS NULL THEN 'Sem data de produção'
           WHEN v_grain = 'month' THEN to_char(f.period_start, 'MM/YYYY')
           WHEN v_grain = 'fortnight' THEN to_char(f.period_start, 'DD/MM') || '–' || to_char(f.period_start + 14, 'DD/MM')
           ELSE to_char(f.period_start, 'DD/MM') || '–' || to_char(f.period_start + 6, 'DD/MM')
         END,
         f.anchor_date,
         f.anchor_source,
         f.sale_order_id,
         f.order_number,
         f.order_status,
         f.client_name,
         f.item_id,
         f.job_id,
         f.service_order_id,
         f.reference_id,
         f.reference_code,
         f.color,
         f.sector_key,
         CASE f.sector_key
           WHEN 'costura' THEN 'Costura de cabedal'
           WHEN 'aviamento' THEN 'Aviamento'
           WHEN 'corte_cabedal' THEN 'Corte Cabedal'
           WHEN 'corte_forracao' THEN 'Corte Forração'
           WHEN 'corte_palmilha' THEN 'Corte Palmilha'
           WHEN 'fachete' THEN 'Fachete'
           ELSE initcap(replace(f.sector_key, '_', ' '))
         END,
         f.contractor_id,
         f.contractor_name,
         f.open_internal,
         f.demand_pairs,
         LEAST(f.sent_pairs, f.demand_pairs),
         LEAST(f.received_pairs, f.demand_pairs),
         GREATEST(f.demand_pairs - LEAST(f.sent_pairs, f.demand_pairs), 0),
         GREATEST(LEAST(f.sent_pairs, f.demand_pairs) - LEAST(f.received_pairs, f.demand_pairs), 0),
         f.period_capacity_per_day,
         CASE WHEN f.contractor_id IS NULL OR f.period_capacity_per_day IS NULL THEN NULL
              ELSE f.period_capacity_per_day * v_days END,
         CASE
           WHEN f.contractor_id IS NULL OR f.period_capacity_per_day IS NULL THEN NULL
           ELSE GREATEST(
             sum(GREATEST(f.demand_pairs - LEAST(f.sent_pairs, f.demand_pairs), 0))
               OVER (PARTITION BY f.period_start, f.contractor_id)
             - f.period_capacity_per_day * v_days,
             0
           )
         END,
         CASE
           WHEN f.contractor_id IS NULL THEN 'sem_prestador'
           WHEN f.period_capacity_per_day IS NULL THEN 'sem_capacidade'
           ELSE 'ok'
         END
    FROM folded f;
END;
$$;

REVOKE ALL ON FUNCTION public.outsourced_pair_ledger(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outsourced_pair_ledger(text) TO authenticated, service_role;

-- corte_parcial_gera_os_20270101054200
--
-- Cada lançamento de corte é independente. Aprovar o corte é o único
-- gerador de OS de cabedal complexo. Não debita estoque: o kit continua
-- saindo uma vez só, quando o lote do ateliê fecha.
-- OS nova nasce sem despacho (Aguardando envio). O ledger só conta
-- enviado quando existe service_order_dispatches.
-- Não altera PV-00249, PV-00250 nem LOTE-00004. Não liga o motor automático.

COMMENT ON FUNCTION public.outsourced_pair_ledger(text) IS
  'Pares de terceirizados. Enviado só entra com despacho físico. OS de corte aguardando envio não conta como enviada. Capacidade não se soma por linha.';

CREATE TABLE IF NOT EXISTS public.atelier_cut_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES public.cabedal_prep_jobs(id) ON DELETE CASCADE,
  ranges jsonb NOT NULL,
  total_pairs integer NOT NULL CHECK (total_pairs > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atelier_cut_launches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atelier_cut_launches FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.atelier_cut_launches IS
  'Um lançamento de corte. O seguinte pode trocar os prestadores. Não debita estoque.';

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS cut_launch_id uuid REFERENCES public.atelier_cut_launches(id);

CREATE INDEX IF NOT EXISTS idx_service_orders_cut_launch
  ON public.service_orders (cut_launch_id)
  WHERE cut_launch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.atelier_cut_block_reason(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot uuid;
BEGIN
  SELECT lot_id INTO v_lot FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'Job não encontrado';
  END IF;
  IF v_lot IS NULL THEN
    RETURN 'Sem material disponível';
  END IF;
  IF NOT public.atelier_lot_kit_is_closed(v_lot) THEN
    RETURN 'Kit ainda aberto';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_cut_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_cut_block_reason(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_cut_range_caps(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet uuid;
  v_item uuid;
  v_ranges jsonb;
  v_grade jsonb;
  v_used jsonb := '{}'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_bucket jsonb;
  v_label text;
  v_sizes jsonb;
  v_size text;
  v_qty int;
  v_cap int;
  v_known jsonb := '{}'::jsonb;
BEGIN
  SELECT j.technical_sheet_id, j.sale_order_item_id
    INTO v_sheet, v_item
    FROM public.cabedal_prep_jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT ts.knife_size_ranges INTO v_ranges
    FROM public.technical_sheets ts
   WHERE ts.id = v_sheet;
  SELECT COALESCE(soi.grade, '{}'::jsonb) INTO v_grade
    FROM public.sale_order_items soi
   WHERE soi.id = v_item;

  SELECT COALESCE(jsonb_object_agg(key, qty), '{}'::jsonb)
    INTO v_used
    FROM (
      SELECT e.key, sum(trunc(e.value::numeric))::int AS qty
        FROM public.atelier_job_parts p
        CROSS JOIN LATERAL jsonb_each_text(COALESCE(p.grade, '{}'::jsonb)) e
       WHERE p.job_id = p_job_id
         AND e.key !~ '^[0-9]'
       GROUP BY e.key
    ) u;

  IF v_ranges IS NULL OR jsonb_typeof(v_ranges) <> 'array' OR jsonb_array_length(v_ranges) = 0 THEN
    SELECT GREATEST(trunc(j.pairs)::int - COALESCE(sum(trunc(p.pairs))::int, 0), 0)
      INTO v_cap
      FROM public.cabedal_prep_jobs j
      LEFT JOIN public.atelier_job_parts p ON p.job_id = j.id
     WHERE j.id = p_job_id
     GROUP BY j.pairs;
    RETURN jsonb_build_array(jsonb_build_object(
      'label', 'total', 'sizes', '[]'::jsonb, 'cap', COALESCE(v_cap, 0), 'mode', 'total'
    ));
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(v_ranges) LOOP
    v_label := COALESCE(v_bucket ->> 'label', '?');
    v_sizes := COALESCE(v_bucket -> 'sizes', '[]'::jsonb);
    v_cap := 0;
    FOR v_size IN SELECT value FROM jsonb_array_elements_text(v_sizes) LOOP
      v_qty := trunc(COALESCE((v_grade ->> v_size)::numeric, 0))::int;
      v_cap := v_cap + GREATEST(v_qty, 0);
      v_known := v_known || jsonb_build_object(v_size, true);
    END LOOP;
    v_cap := GREATEST(v_cap - COALESCE((v_used ->> v_label)::int, 0), 0);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'label', v_label, 'sizes', v_sizes, 'cap', v_cap, 'mode', 'range'
    ));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_cut_range_caps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_cut_range_caps(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_atelier_cut_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY ready_date NULLS LAST, order_number, sector), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT j.id,
             d.ready_date,
             so.order_number,
             j.sector,
             jsonb_build_object(
               'job_id', j.id,
               'order_number', so.order_number,
               'client_name', so.client_name,
               'billing_week', so.billing_week,
               'reference_code', COALESCE(j.reference_code, ts.code),
               'reference_name', ts.name,
               'sheet_id', j.technical_sheet_id,
               'image_url', ts.image_url,
               'images', ts.images,
               'variant_image_url', (
                 SELECT v.image_url
                   FROM public.reference_color_variants v
                  WHERE v.reference_id = j.technical_sheet_id
                    AND lower(btrim(COALESCE(v.color, ''))) = lower(btrim(COALESCE(j.color, '')))
                    AND NULLIF(btrim(v.image_url), '') IS NOT NULL
                  LIMIT 1
               ),
               'preto_image_url', (
                 SELECT v.image_url
                   FROM public.reference_color_variants v
                  WHERE v.reference_id = j.technical_sheet_id
                    AND lower(btrim(COALESCE(v.color, ''))) = 'preto'
                    AND NULLIF(btrim(v.image_url), '') IS NOT NULL
                  LIMIT 1
               ),
               'item_grade', COALESCE(soi.grade, '{}'::jsonb),
               'color', j.color,
               'sector', j.sector,
               'sector_label', CASE j.sector
                 WHEN 'costura_cabedal' THEN 'Costura de cabedal'
                 WHEN 'aviamento' THEN 'Aviamento'
                 ELSE j.sector END,
               'total_pairs', trunc(j.pairs)::int,
               'cut_pairs', COALESCE((
                 SELECT sum(l.total_pairs)::int FROM public.atelier_cut_launches l WHERE l.job_id = j.id
               ), 0),
               'remaining_pairs', GREATEST(trunc(j.pairs)::int - COALESCE((
                 SELECT sum(trunc(p.pairs))::int FROM public.atelier_job_parts p WHERE p.job_id = j.id
               ), 0), 0),
               'preferred_contractor_id', COALESCE(
                 NULLIF(soi.outsourced_sectors ->> j.sector, ''),
                 NULLIF(soi.outsourced_sectors ->> 'costura', ''),
                 NULLIF(soi.outsourced_sectors ->> 'aviamento', ''),
                 j.contractor_id::text
               ),
               'last_contractor_ids', COALESCE((
                 SELECT jsonb_agg(DISTINCT os.contractor_id)
                   FROM public.service_orders os
                  WHERE os.cut_launch_id = (
                    SELECT l.id FROM public.atelier_cut_launches l
                     WHERE l.job_id = j.id
                     ORDER BY l.created_at DESC
                     LIMIT 1
                  )
               ), '[]'::jsonb),
               'ranges', public.atelier_cut_range_caps(j.id),
               'block_reason', public.atelier_cut_block_reason(j.id),
               'in_queue', public.atelier_cut_block_reason(j.id) IS NULL
                 AND GREATEST(trunc(j.pairs)::int - COALESCE((
                   SELECT sum(trunc(p.pairs))::int FROM public.atelier_job_parts p WHERE p.job_id = j.id
                 ), 0), 0) > 0,
               'history', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id', l.id,
                   'at', l.created_at,
                   'ranges', l.ranges,
                   'total_pairs', l.total_pairs,
                   'orders', COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                       'id', os.id,
                       'number', os.order_number,
                       'contractor_id', os.contractor_id,
                       'contractor_name', COALESCE(c.trade_name, c.name),
                       'quantity', os.quantity,
                       'unit_price', os.unit_price,
                       'total_value', os.total_value,
                       'grade', (
                         SELECT p.grade FROM public.atelier_job_parts p
                          WHERE p.service_order_id = os.id
                          ORDER BY p.created_at
                          LIMIT 1
                       )
                     ) ORDER BY c.name)
                       FROM public.service_orders os
                       JOIN public.contractors c ON c.id = os.contractor_id
                      WHERE os.cut_launch_id = l.id
                   ), '[]'::jsonb)
                 ) ORDER BY l.created_at)
                   FROM public.atelier_cut_launches l
                  WHERE l.job_id = j.id
               ), '[]'::jsonb)
             ) AS row_data
        FROM public.cabedal_prep_jobs j
        JOIN public.sale_orders so ON so.id = j.sale_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.sale_order_items soi ON soi.id = j.sale_order_item_id
        LEFT JOIN public.technical_sheets ts ON ts.id = j.technical_sheet_id
        LEFT JOIN public.cabedal_prep_demands d ON d.id = j.demand_id
       WHERE so.status IN ('Aprovado', 'Em Produção')
         AND j.pipeline_status <> 'cancelled'
         AND j.sector IN ('costura_cabedal', 'aviamento')
         AND (soi.id IS NULL OR soi.production_excluded_at IS NULL)
    ) built;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.list_atelier_cut_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_cut_queue() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_atelier_cut(
  p_job_id uuid,
  p_ranges jsonb,
  p_parts jsonb,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_existing uuid;
  v_launch uuid;
  v_reason text;
  v_caps jsonb;
  v_cap int;
  v_label text;
  v_cut int;
  v_sum int;
  v_total int := 0;
  v_elem jsonb;
  v_part jsonb;
  v_contractor uuid;
  v_price numeric;
  v_suggested numeric;
  v_pairs int;
  v_os uuid;
  v_os_number text;
  v_part_id uuid;
  v_sector text;
  v_due date;
  v_orders uuid[];
  v_result jsonb;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing
    FROM public.atelier_cut_launches
   WHERE client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', os.id, 'number', os.order_number,
             'contractor_id', os.contractor_id, 'quantity', os.quantity
           )), '[]'::jsonb)
      INTO v_result
      FROM public.service_orders os
     WHERE os.cut_launch_id = v_existing;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'launch_id', v_existing, 'orders', v_result);
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.pipeline_status = 'cancelled' THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Este corte não é de cabedal complexo' USING ERRCODE = '22023';
  END IF;

  v_reason := public.atelier_cut_block_reason(p_job_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason USING ERRCODE = '22023';
  END IF;

  v_caps := public.atelier_cut_range_caps(p_job_id);
  IF p_ranges IS NULL OR jsonb_typeof(p_ranges) <> 'array' OR jsonb_array_length(p_ranges) = 0 THEN
    RAISE EXCEPTION 'Informe as faixas do corte' USING ERRCODE = '22023';
  END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um prestador' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
    v_label := v_elem ->> 'label';
    v_cut := trunc(COALESCE((v_elem ->> 'pairs')::numeric, 0))::int;
    IF v_cut < 0 OR (v_elem ->> 'pairs')::numeric <> trunc((v_elem ->> 'pairs')::numeric) THEN
      RAISE EXCEPTION 'A faixa só aceita pares inteiros' USING ERRCODE = '22023';
    END IF;
    SELECT trunc(COALESCE((c ->> 'cap')::numeric, 0))::int INTO v_cap
      FROM jsonb_array_elements(v_caps) c
     WHERE c ->> 'label' = v_label
     LIMIT 1;
    IF v_cap IS NULL THEN
      RAISE EXCEPTION 'Faixa % não está cadastrada nesta ficha', v_label USING ERRCODE = '22023';
    END IF;
    IF v_cut > v_cap THEN
      RAISE EXCEPTION 'A faixa % passa do saldo: % de %', v_label, v_cut, v_cap USING ERRCODE = '22023';
    END IF;
    v_sum := 0;
    FOR v_part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
      v_sum := v_sum + trunc(COALESCE((v_part -> 'ranges' ->> v_label)::numeric, 0))::int;
    END LOOP;
    IF v_sum <> v_cut THEN
      RAISE EXCEPTION 'A faixa % não fecha: prestadores somam % e o corte é %', v_label, v_sum, v_cut
        USING ERRCODE = '22023';
    END IF;
    v_total := v_total + v_cut;
  END LOOP;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos 1 par' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.atelier_cut_launches (client_request_id, job_id, ranges, total_pairs)
  VALUES (p_client_request_id, p_job_id, p_ranges, v_total)
  RETURNING id INTO v_launch;

  PERFORM set_config('app.atelier_cut_os', '1', true);
  v_sector := public.atelier_rate_sector(v_job.sector);
  v_orders := ARRAY[v_job.sale_order_id];
  v_due := CURRENT_DATE + 5;

  FOR v_contractor IN
    SELECT DISTINCT NULLIF(value ->> 'contractor_id', '')::uuid AS contractor_id
      FROM jsonb_array_elements(p_parts)
  LOOP
    IF v_contractor IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT public.atelier_contractor_can_take(v_contractor, v_job.sector) THEN
      RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
    END IF;
    v_pairs := 0;
    v_price := NULL;
    FOR v_part IN
      SELECT value FROM jsonb_array_elements(p_parts)
       WHERE NULLIF(value ->> 'contractor_id', '')::uuid = v_contractor
    LOOP
      FOR v_elem IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
        v_label := v_elem ->> 'label';
        v_pairs := v_pairs + trunc(COALESCE((v_part -> 'ranges' ->> v_label)::numeric, 0))::int;
      END LOOP;
      v_price := round(COALESCE((v_part ->> 'unit_price')::numeric, 0), 2);
    END LOOP;
    IF v_pairs <= 0 THEN
      CONTINUE;
    END IF;
    SELECT s.price INTO v_suggested
      FROM public.atelier_suggested_pair_price(v_contractor, v_job.sector, v_job.technical_sheet_id, CURRENT_DATE) s
     LIMIT 1;
    IF v_price IS NULL OR v_price <= 0 THEN
      v_price := round(COALESCE(v_suggested, 0), 2);
    END IF;
    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'Informe o R$/par deste prestador' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.service_orders (
      contractor_id, status, service_date, description, notes,
      dispatch_tracked, quantity, unit_price, total_value,
      service_order_domain, material_requirements, is_avulsa,
      sale_order_id, source_sale_order_id, linked_sale_order_ids,
      selected_sale_order_item_ids, target_sector, sector, cut_launch_id,
      quoted_deadline
    ) VALUES (
      v_contractor, 'Pendente', CURRENT_DATE,
      'Aguardando envio',
      'OS do corte parcial. Ainda não foi enviada.',
      true, v_pairs, v_price, round(v_pairs * v_price, 2),
      'generic', '{}'::jsonb, false,
      v_job.sale_order_id, v_job.sale_order_id, v_orders,
      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL ELSE ARRAY[v_job.sale_order_item_id] END,
      v_sector, v_sector, v_launch, v_due
    ) RETURNING id, order_number INTO v_os, v_os_number;

    SELECT COALESCE(jsonb_object_agg(e ->> 'label', trunc(COALESCE((src.ranges ->> (e ->> 'label'))::numeric, 0))::int), '{}'::jsonb)
      INTO v_elem
      FROM jsonb_array_elements(p_ranges) e
      CROSS JOIN LATERAL (
        SELECT value -> 'ranges' AS ranges
          FROM jsonb_array_elements(p_parts) value
         WHERE NULLIF(value ->> 'contractor_id', '')::uuid = v_contractor
         LIMIT 1
      ) src;

    INSERT INTO public.atelier_job_parts (
      job_id, execution_mode, contractor_id, pairs, grade, service_order_id,
      unit_price, suggested_unit_price, price_source, return_on, pipeline_status
    ) VALUES (
      p_job_id, 'contractor', v_contractor, v_pairs, COALESCE(v_elem, '{}'::jsonb),
      v_os, v_price, v_suggested, 'corte', v_due, 'cut'
    ) RETURNING id INTO v_part_id;

    INSERT INTO public.service_order_items (
      service_order_id, atelier_job_id, atelier_part_id, source_item_key,
      material_name, description, sale_order_id, color,
      target_sector, sector, quantity, unit, unit_price, total_value, line_status
    ) VALUES (
      v_os, p_job_id, v_part_id, 'cut:' || v_launch::text || ':' || v_contractor::text,
      COALESCE(NULLIF(btrim(v_job.reference_code), ''), 'Ateliê'),
      trim(both ' · ' FROM concat_ws(' · ', v_job.reference_code, v_job.color)),
      v_job.sale_order_id, NULLIF(btrim(v_job.color), ''),
      v_sector, v_sector, v_pairs, 'par', v_price, round(v_pairs * v_price, 2),
      'open'
    );
  END LOOP;

  PERFORM set_config('app.atelier_cut_os', '', true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', os.id,
           'number', os.order_number,
           'contractor_id', os.contractor_id,
           'contractor_name', COALESCE(c.trade_name, c.name),
           'phone', c.phone,
           'address', c.address,
           'city', c.city,
           'state', c.state,
           'quantity', os.quantity,
           'unit_price', os.unit_price,
           'total_value', os.total_value,
           'grade', p.grade,
           'return_on', p.return_on
         ) ORDER BY c.name), '[]'::jsonb)
    INTO v_result
    FROM public.service_orders os
    JOIN public.contractors c ON c.id = os.contractor_id
    LEFT JOIN public.atelier_job_parts p ON p.service_order_id = os.id
   WHERE os.cut_launch_id = v_launch;

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', false,
    'launch_id', v_launch,
    'total_pairs', v_total,
    'orders', v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_atelier_cut(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_atelier_cut(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_atelier_cut(uuid, jsonb, jsonb, uuid) IS
  'Aprova um lançamento de corte e cria uma OS nova por prestador. Não debita estoque e não despacha. O mesmo client_request_id devolve as OS já criadas.';

-- Envio antigo do Lançar não cria mais OS de cabedal complexo.
CREATE OR REPLACE FUNCTION public.tg_atelier_os_only_from_cut()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sector text;
BEGIN
  IF current_setting('app.atelier_cut_os', true) = '1' THEN
    RETURN NEW;
  END IF;
  SELECT j.sector INTO v_sector FROM public.cabedal_prep_jobs j WHERE j.id = NEW.job_id;
  IF public.outsourced_sector_key(v_sector) IN ('costura', 'aviamento')
     AND NEW.pipeline_status = 'sent_to_contractor' THEN
    RAISE EXCEPTION 'A OS de cabedal complexo nasce na aprovação do corte.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_os_only_from_cut ON public.atelier_job_parts;
CREATE TRIGGER trg_atelier_os_only_from_cut
  BEFORE INSERT ON public.atelier_job_parts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_os_only_from_cut();
