-- os_terceirizados_ledger_unico_20270101054100
--
-- Fonte única dos pares de terceirizados. Planejar, Lançar, Na rua,
-- Receber, Relatório e os contadores do PCP leem esta função.
--
-- Data de produção (âncora do período):
--   1. cabedal_prep_demands.ready_date — dia em que o cabedal precisa estar
--      pronto para a fábrica (faturamento menos os dias de
--      atelier_settings.ready_before_billing_days). É a data que o PCP do
--      Ateliê já usa para comprar e cortar.
--   2. Se não houver demanda de cabedal, a segunda-feira da semana de
--      faturamento (resolve_billing_week_for_order).
--
-- O que entra: cabedal complexo (costura e aviamento, sempre prestador)
-- e os outros setores que o item ou a referência mandam para terceiro.
-- Pedido faturado, cancelado, expedido, concluído ou finalizado fica de fora.
-- O par do item entra uma vez por setor. Não multiplica por ficha, OP ou etapa.
-- Já enviado sai do saldo. Capacidade é do prestador no período (não soma
-- a mesma capacidade em cada linha).
--
-- Não grava pedido. Não altera PV-00249, PV-00250 nem LOTE-00004.
-- Job e parte que já existem continuam como estão. O que nasce agora
-- em costura/aviamento de cabedal complexo é prestador.

CREATE OR REPLACE FUNCTION public.outsourced_sector_key(p_sector text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(translate(btrim(COALESCE(p_sector, '')),
           'áàãâéêíóôõúç', 'aaaaeeiooouc'))
    WHEN 'costura_cabedal' THEN 'costura'
    WHEN 'costura cabedal' THEN 'costura'
    WHEN 'costura de cabedal' THEN 'costura'
    WHEN 'costura' THEN 'costura'
    WHEN 'aviamento' THEN 'aviamento'
    WHEN 'mesa' THEN 'aviamento'
    WHEN 'corte_cabedal' THEN 'corte_cabedal'
    WHEN 'corte cabedal' THEN 'corte_cabedal'
    WHEN 'corte_forracao' THEN 'corte_forracao'
    WHEN 'corte forracao' THEN 'corte_forracao'
    WHEN 'corte_palmilha' THEN 'corte_palmilha'
    WHEN 'corte palmilha' THEN 'corte_palmilha'
    WHEN 'corte fibra' THEN 'corte_palmilha'
    WHEN 'fachete' THEN 'fachete'
    WHEN 'silk' THEN 'silk'
    WHEN 'colagem' THEN 'colagem'
    WHEN 'montagem' THEN 'montagem'
    WHEN 'solagem' THEN 'solagem'
    WHEN 'acabamento' THEN 'acabamento'
    ELSE NULLIF(lower(btrim(COALESCE(p_sector, ''))), '')
  END;
$$;

REVOKE ALL ON FUNCTION public.outsourced_sector_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outsourced_sector_key(text) TO authenticated, service_role;

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
           CASE WHEN p.service_order_id IS NOT NULL THEN trunc(p.pairs)::int ELSE 0 END AS sent_pairs,
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

COMMENT ON FUNCTION public.outsourced_pair_ledger(text) IS
  'Pares de terceirizados por prestador, PV, cor, setor e período. Capacidade e excedente são do prestador no período: não some capacity_period entre linhas.';

-- Job novo de costura/aviamento nasce prestador. Linha já gravada não muda.
CREATE OR REPLACE FUNCTION public.tg_atelier_job_is_contractor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preferred uuid;
  v_default uuid;
BEGIN
  IF public.outsourced_sector_key(NEW.sector) NOT IN ('costura', 'aviamento') THEN
    RETURN NEW;
  END IF;
  NEW.execution_mode := 'contractor';
  IF NEW.contractor_id IS NULL AND NEW.sale_order_item_id IS NOT NULL THEN
    SELECT NULLIF(COALESCE(
             soi.outsourced_sectors ->> NEW.sector,
             soi.outsourced_sectors ->> public.outsourced_sector_key(NEW.sector),
             soi.outsourced_sectors ->> 'costura',
             soi.outsourced_sectors ->> 'aviamento'
           ), '')::uuid
      INTO v_preferred
      FROM public.sale_order_items soi
     WHERE soi.id = NEW.sale_order_item_id;
    NEW.contractor_id := v_preferred;
  END IF;
  IF NEW.contractor_id IS NULL AND NEW.technical_sheet_id IS NOT NULL THEN
    SELECT a.default_contractor_id
      INTO v_default
      FROM public.atelier_complex_references a
     WHERE a.reference_id = NEW.technical_sheet_id
       AND a.sector = NEW.sector
       AND a.active
       AND a.default_contractor_id IS NOT NULL
     LIMIT 1;
    NEW.contractor_id := v_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_job_is_contractor ON public.cabedal_prep_jobs;
CREATE TRIGGER trg_atelier_job_is_contractor
  BEFORE INSERT ON public.cabedal_prep_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_job_is_contractor();

-- Parte nova sem prestador não entra. Parte antiga (interno em aberto) segue recebível.
CREATE OR REPLACE FUNCTION public.tg_atelier_part_requires_contractor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sector text;
BEGIN
  SELECT j.sector INTO v_sector
    FROM public.cabedal_prep_jobs j
   WHERE j.id = NEW.job_id;
  IF public.outsourced_sector_key(v_sector) NOT IN ('costura', 'aviamento') THEN
    RETURN NEW;
  END IF;
  IF NEW.execution_mode IS DISTINCT FROM 'contractor' OR NEW.contractor_id IS NULL THEN
    RAISE EXCEPTION 'Cabedal complexo só vai para prestador. Escolha quem faz esta parte.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_part_requires_contractor ON public.atelier_job_parts;
CREATE TRIGGER trg_atelier_part_requires_contractor
  BEFORE INSERT ON public.atelier_job_parts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_part_requires_contractor();

CREATE OR REPLACE FUNCTION public.tg_atelier_reference_default_contractor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.outsourced_sector_key(NEW.sector) IN ('costura', 'aviamento')
     AND NEW.default_execution_mode IS DISTINCT FROM 'contractor' THEN
    NEW.default_execution_mode := 'contractor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_reference_default_contractor ON public.atelier_complex_references;
CREATE TRIGGER trg_atelier_reference_default_contractor
  BEFORE INSERT OR UPDATE OF default_execution_mode, sector
  ON public.atelier_complex_references
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_reference_default_contractor();

CREATE OR REPLACE FUNCTION public.atelier_set_job_execution_mode(
  p_job_id uuid,
  p_mode text,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('internal', 'contractor') THEN
    RAISE EXCEPTION 'Modo inválido (internal|contractor)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF public.outsourced_sector_key(v_job.sector) IN ('costura', 'aviamento') AND p_mode = 'internal' THEN
    RAISE EXCEPTION 'Cabedal complexo não volta para a fábrica. Escolha um prestador.'
      USING ERRCODE = '22023';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura/Aviamento têm modo interno/prestador' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('awaiting_cut', 'cut') THEN
    RAISE EXCEPTION 'Modo só pode mudar antes do envio/início (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'internal' THEN
    p_contractor_id := NULL;
  ELSIF p_contractor_id IS NOT NULL
        AND NOT public.atelier_contractor_can_take(p_contractor_id, v_job.sector) THEN
    RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cabedal_prep_jobs
     SET execution_mode = p_mode,
         contractor_id = CASE
           WHEN p_mode = 'contractor' THEN COALESCE(p_contractor_id, contractor_id)
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'execution_mode', p_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_set_job_execution_mode(uuid, text, uuid)
  TO authenticated, service_role;

-- Pedido aprovado entra na lista. Cancelar ou tirar a cor tira o que ainda
-- não foi enviado. Não reescreve pedido antigo: só reage à mudança.
CREATE OR REPLACE FUNCTION public.sync_atelier_launch_for_order(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;

  IF v_status IN ('Aprovado', 'Em Produção') THEN
    PERFORM public.materialize_cabedal_prep_demands(p_sale_order_id);
  END IF;

  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.sale_order_id = p_sale_order_id
     AND j.pipeline_status IN ('awaiting_cut', 'cut')
     AND NOT EXISTS (
       SELECT 1 FROM public.atelier_job_parts p
        WHERE p.job_id = j.id AND p.service_order_id IS NOT NULL
     )
     AND (
       v_status IS NULL
       OR v_status NOT IN ('Aprovado', 'Em Produção')
       OR NOT EXISTS (
         SELECT 1
           FROM public.sale_order_items soi
          WHERE soi.id = j.sale_order_item_id
            AND soi.production_excluded_at IS NULL
            AND COALESCE(soi.quantity, 0) > 0
            AND public.outsourced_sector_key(j.sector) = ANY (
              SELECT public.outsourced_sector_key(a.sector)
                FROM public.atelier_complex_references a
               WHERE a.reference_id = soi.reference_id
                 AND a.active
            )
       )
     );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_atelier_launch_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_atelier_launch_for_order(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_atelier_launch_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.sync_atelier_launch_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_launch_on_order_status ON public.sale_orders;
CREATE TRIGGER trg_atelier_launch_on_order_status
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_launch_on_order_status();

CREATE OR REPLACE FUNCTION public.tg_atelier_launch_on_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order uuid := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
BEGIN
  IF v_order IS NOT NULL THEN
    PERFORM public.sync_atelier_launch_for_order(v_order);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_launch_on_item ON public.sale_order_items;
CREATE TRIGGER trg_atelier_launch_on_item
  AFTER INSERT OR DELETE OR UPDATE OF quantity, color, reference_id, production_excluded_at, outsourced_sectors, grade
  ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_launch_on_item();

CREATE TABLE IF NOT EXISTS public.atelier_launch_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.cabedal_prep_jobs(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id),
  grade jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.atelier_launch_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atelier_launch_reservations FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.atelier_launch_reservations IS
  'Divisão reservada da cor, antes do corte. Não é OS e não envia material.';

CREATE OR REPLACE FUNCTION public.save_atelier_launch_reservation(
  p_job_id uuid,
  p_parts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_elem jsonb;
  v_contractor uuid;
  v_grade jsonb;
  v_price numeric;
  v_n int := 0;
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.pipeline_status = 'cancelled' THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' THEN
    RAISE EXCEPTION 'Informe a divisão' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.atelier_launch_reservations WHERE job_id = p_job_id;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_contractor := NULLIF(v_elem ->> 'contractor_id', '')::uuid;
    v_grade := COALESCE(v_elem -> 'grade', '{}'::jsonb);
    v_price := NULLIF(v_elem ->> 'unit_price', '')::numeric;
    IF v_contractor IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT public.atelier_contractor_can_take(v_contractor, v_job.sector) THEN
      RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.atelier_launch_reservations (job_id, contractor_id, grade, unit_price)
    VALUES (p_job_id, v_contractor, v_grade, v_price);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reserved', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.save_atelier_launch_reservation(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_atelier_launch_reservation(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_atelier_launch_reservations(p_order_number text)
RETURNS TABLE (
  job_id uuid,
  contractor_id uuid,
  contractor_name text,
  grade jsonb,
  unit_price numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.job_id, r.contractor_id, c.name, r.grade, r.unit_price
    FROM public.atelier_launch_reservations r
    JOIN public.cabedal_prep_jobs j ON j.id = r.job_id
    JOIN public.sale_orders so ON so.id = j.sale_order_id
    JOIN public.contractors c ON c.id = r.contractor_id
   WHERE so.order_number = NULLIF(btrim(COALESCE(p_order_number, '')), '')
     AND so.deleted_at IS NULL
     AND public.atelier_launch_reader_ok();
$$;

REVOKE ALL ON FUNCTION public.list_atelier_launch_reservations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_launch_reservations(text) TO authenticated, service_role;

-- Leitura: aprovado ou em produção com cabedal complexo e sem job na lista.
CREATE OR REPLACE FUNCTION public.list_complex_upper_not_in_launch()
RETURNS TABLE (
  order_number text,
  status text,
  color text,
  reference_code text,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT so.order_number,
         so.status,
         COALESCE(soi.color, 'Sem cor'),
         COALESCE(ts.code, ts.name),
         'sem job de costura ou aviamento'::text
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE so.deleted_at IS NULL
     AND so.status IN ('Aprovado', 'Em Produção')
     AND soi.production_excluded_at IS NULL
     AND COALESCE(soi.quantity, 0) > 0
     AND EXISTS (
       SELECT 1 FROM public.atelier_complex_references a
        WHERE a.reference_id = soi.reference_id
          AND a.active
          AND a.sector IN ('costura_cabedal', 'aviamento')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cabedal_prep_jobs j
        WHERE j.sale_order_item_id = soi.id
          AND j.pipeline_status <> 'cancelled'
          AND j.sector IN ('costura_cabedal', 'aviamento')
     )
   ORDER BY so.order_number, soi.color;
END;
$$;

REVOKE ALL ON FUNCTION public.list_complex_upper_not_in_launch() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_complex_upper_not_in_launch() TO authenticated, service_role;
