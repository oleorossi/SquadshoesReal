-- ════════════════════════════════════════════════════════════════════════════
-- Motor de produção · 1/3 — Prazos do motor (fonte única de configuração),
-- prazo do prestador, capacidade do prestador e reserva automática do kit.
--
-- Pedido do dono (25/11/2026): cabedal complexo vai ao prestador com tempo,
-- o motor reserva o que há em estoque e pede OC (rascunho) do que falta,
-- sem ninguém ficar olhando.
--
-- O que muda:
--  * atelier_settings ganha os campos que faltavam (padrões documentados, não
--    inventados — cada um repete o comportamento de hoje):
--      default_prep_business_days      NULL → usa costura/aviamento_offset_days (5)
--      default_oc_lead_days            10   (era o 10 fixo no código)
--      oc_urgency_window_business_days 2    (OC rascunho "urgente" se comprar-até ≤ hoje+2 úteis)
--      motor_cabedal_gate_sector       'Montagem' (setor que espera o cabedal voltar)
--    + CHECKs de validação em todos os prazos/capacidades.
--  * atelier_effective_prep_business_days(ref, setor): prazo do prestador
--    (dias úteis, envio → retorno) = ref×setor → padrão → offset do setor.
--  * atelier_compute_job_targets usa esse prazo (envio = pronto − prazo).
--  * materialize: pronto = início da semana de faturamento − "pronto antes do
--    faturamento" (dias corridos). prep_business_days deixa de significar
--    "pronto antes do faturamento" (estava vazio em todas as refs).
--  * motor_material_eta(produto, PV): chegada prevista do material (OC aberta
--    → promessa; rascunho → hoje+lead; sem OC → hoje+lead).
--  * atelier_jobs_expected_dates(): envio e retorno previstos de cada serviço
--    do Ateliê, empurrados pela chegada do kit e pela capacidade do prestador
--    (atelier_contractor_sectors.capacity_pairs_per_day).
--  * atelier_link_kit_reservations_for_item(item): ao aprovar, o empenho do PV
--    para o kit do cabedal complexo vira atelier_prep (nunca é encolhido por
--    outro PV) e fica ligado ao item e aos serviços do Ateliê.
--  * get_motor_config() / update_motor_settings(jsonb): leitura/gravação da
--    tela "Prazos do motor". Não liga auto_motor_enabled nem
--    urgent_release_without_material (decisão do dono, fora desta tela).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.atelier_settings
  ADD COLUMN IF NOT EXISTS default_prep_business_days integer,
  ADD COLUMN IF NOT EXISTS default_oc_lead_days integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS oc_urgency_window_business_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS motor_cabedal_gate_sector text NOT NULL DEFAULT 'Montagem';

COMMENT ON COLUMN public.atelier_settings.default_prep_business_days IS
  'Prazo padrão do prestador (dias úteis, envio → retorno) para ref complexa sem prazo próprio. NULL = usa costura_offset_days/aviamento_offset_days.';
COMMENT ON COLUMN public.atelier_settings.default_oc_lead_days IS
  'Lead time padrão de OC (dias corridos) quando o produto/grupo não tem lead do fornecedor.';
COMMENT ON COLUMN public.atelier_settings.oc_urgency_window_business_days IS
  'OC rascunho vira "urgente" quando o comprar-até cai em até N dias úteis (ou o PV é urgente).';
COMMENT ON COLUMN public.atelier_settings.motor_cabedal_gate_sector IS
  'Setor da fábrica a partir do qual a OP de cabedal complexo espera o retorno do prestador.';
COMMENT ON COLUMN public.atelier_complex_references.prep_business_days IS
  'Prazo do prestador para esta ref×setor (dias úteis, envio → retorno). Vazio = padrão de Prazos do motor.';

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atelier_settings_motor_prazos_ck') THEN
    ALTER TABLE public.atelier_settings ADD CONSTRAINT atelier_settings_motor_prazos_ck CHECK (
      (default_prep_business_days IS NULL OR default_prep_business_days BETWEEN 1 AND 60)
      AND default_oc_lead_days BETWEEN 1 AND 120
      AND oc_urgency_window_business_days BETWEEN 0 AND 30
      AND (costura_offset_days IS NULL OR costura_offset_days BETWEEN 0 AND 60)
      AND (aviamento_offset_days IS NULL OR aviamento_offset_days BETWEEN 0 AND 60)
      AND (ready_before_billing_days IS NULL OR ready_before_billing_days BETWEEN 0 AND 60)
      AND (weekly_purchase_cap_brl IS NULL OR weekly_purchase_cap_brl > 0)
      AND (purchase_horizon_business_days IS NULL OR purchase_horizon_business_days BETWEEN 1 AND 60)
      AND (buffer_business_days IS NULL OR buffer_business_days BETWEEN 0 AND 30)
      AND btrim(motor_cabedal_gate_sector) <> ''
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atelier_complex_references_prep_days_ck') THEN
    ALTER TABLE public.atelier_complex_references ADD CONSTRAINT atelier_complex_references_prep_days_ck
      CHECK (prep_business_days IS NULL OR prep_business_days BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atelier_contractor_sectors_capacity_ck') THEN
    ALTER TABLE public.atelier_contractor_sectors ADD CONSTRAINT atelier_contractor_sectors_capacity_ck
      CHECK (capacity_pairs_per_day IS NULL OR capacity_pairs_per_day >= 0);
  END IF;
END
$chk$;

-- ─── Prazos efetivos ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.motor_default_oc_lead_days()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s.default_oc_lead_days FROM public.atelier_settings s WHERE s.id = 1), 10);
$function$;

CREATE OR REPLACE FUNCTION public.atelier_effective_prep_business_days(p_reference_id uuid, p_sector text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(0, COALESCE(
    (SELECT MAX(a.prep_business_days)
       FROM public.atelier_complex_references a
      WHERE a.reference_id = p_reference_id
        AND a.active IS TRUE
        AND a.sector = p_sector
        AND a.prep_business_days > 0),
    (SELECT s.default_prep_business_days FROM public.atelier_settings s WHERE s.id = 1),
    (SELECT CASE WHEN p_sector = 'aviamento' THEN s.aviamento_offset_days ELSE s.costura_offset_days END
       FROM public.atelier_settings s WHERE s.id = 1),
    5
  ));
$function$;

-- Lead do fornecedor: a única mudança é o fallback 10 fixo → Prazos do motor.
CREATE OR REPLACE FUNCTION public.get_effective_supplier_lead_days(p_product_id uuid, p_prod_deadline_days integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_po_eta int; v_group_lead int; v_product_lead int;
BEGIN
  SELECT MIN(po.eta_days) INTO v_po_eta
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
   WHERE poi.product_id = p_product_id AND po.status IN ('pending', 'approved') AND po.eta_days IS NOT NULL;
  IF v_po_eta IS NOT NULL THEN RETURN v_po_eta; END IF;
  SELECT gs.lead_time_days INTO v_group_lead
    FROM products p JOIN group_suppliers gs ON gs.group_id = p.group_id
   WHERE p.id = p_product_id AND COALESCE(gs.lead_time_days, 0) > 0
   ORDER BY gs.updated_at DESC LIMIT 1;
  IF v_group_lead IS NOT NULL AND v_group_lead > 0 THEN RETURN v_group_lead; END IF;
  SELECT supplier_lead_time_days INTO v_product_lead FROM products WHERE id = p_product_id;
  RETURN COALESCE(NULLIF(v_product_lead, 0), public.motor_default_oc_lead_days());
END;
$function$;

-- Envio ao prestador = pronto − prazo do prestador (dias úteis) da ref×setor.
CREATE OR REPLACE FUNCTION public.atelier_compute_job_targets(p_sale_order_item_id uuid, p_sale_order_id uuid, p_sector text, p_ready_date date DEFAULT NULL::date)
 RETURNS TABLE(target_start date, target_end date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anchor date;
  v_offset int := 5;
  v_start date;
  v_ref uuid;
BEGIN
  SELECT soi.reference_id INTO v_ref FROM public.sale_order_items soi WHERE soi.id = p_sale_order_item_id;
  v_offset := public.atelier_effective_prep_business_days(v_ref, p_sector);

  SELECT MIN(ps.date)
    INTO v_anchor
    FROM public.orders o
    JOIN public.production_schedule ps ON ps.order_id = o.id
   WHERE o.deleted_at IS NULL
     AND COALESCE(o.status, '') <> 'Cancelado'
     AND (
       (p_sale_order_item_id IS NOT NULL AND o.sale_order_item_id = p_sale_order_item_id)
       OR (p_sale_order_item_id IS NULL AND p_sale_order_id IS NOT NULL AND o.sale_order_id = p_sale_order_id)
     )
     AND ps.sector IN (
       'Corte Cabedal', 'Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Corte'
     );

  IF v_anchor IS NULL THEN
    v_anchor := p_ready_date;
  END IF;

  IF v_anchor IS NULL THEN
    target_start := NULL;
    target_end := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_start := public.add_business_days(v_anchor, -v_offset);
  target_start := v_start;
  target_end := v_anchor;
  RETURN NEXT;
END;
$function$;

-- Retorno do prestador a partir do envio (prazo padrão do setor).
CREATE OR REPLACE FUNCTION public.atelier_job_return_date(p_anchor date, p_sector text)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offset int;
BEGIN
  IF p_anchor IS NULL THEN
    RETURN NULL;
  END IF;
  v_offset := public.atelier_effective_prep_business_days(NULL, p_sector);
  RETURN public.add_business_days(p_anchor, v_offset);
END;
$function$;

-- ─── Chegada prevista do material ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.motor_material_eta(p_product_id uuid, p_sale_order_id uuid DEFAULT NULL)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH lead AS (
    SELECT GREATEST(1, COALESCE(public.get_effective_supplier_lead_days(p_product_id, NULL),
                                public.motor_default_oc_lead_days())) AS d
  ),
  oc AS (
    SELECT CASE
             WHEN po.status IN ('draft', 'suggested')
               THEN GREATEST(public.br_today() + (SELECT d FROM lead),
                             COALESCE(po.promised_date, public.br_today()))
             ELSE COALESCE(po.promised_date,
                           (po.created_at AT TIME ZONE 'America/Sao_Paulo')::date
                             + COALESCE(po.eta_days, (SELECT d FROM lead)))
           END AS eta,
           (p_sale_order_id IS NOT NULL
            AND (p_sale_order_id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
                 OR p_sale_order_id = ANY (COALESCE(po.source_pv_ids, ARRAY[]::uuid[])))) AS linked
      FROM public.purchase_orders po
      JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE poi.product_id = p_product_id
       AND COALESCE(po.status, '') NOT IN ('cancelled', 'received')
       AND po.cancelled_at IS NULL
       AND po.received_at IS NULL
       AND poi.received_at IS NULL
  )
  SELECT GREATEST(public.br_today(), COALESCE(
    (SELECT min(eta) FROM oc WHERE linked),
    (SELECT min(eta) FROM oc),
    public.br_today() + (SELECT d FROM lead)
  ));
$function$;

COMMENT ON FUNCTION public.motor_material_eta(uuid, uuid) IS
  'Chegada prevista do material: OC aberta do PV → promessa; OC rascunho → hoje + lead; sem OC → hoje + lead (Prazos do motor).';

-- ─── Envio/retorno previstos de cada serviço do Ateliê ──────────────────────
CREATE OR REPLACE FUNCTION public.atelier_jobs_expected_dates()
RETURNS TABLE(
  job_id uuid, sale_order_id uuid, sale_order_item_id uuid, sector text,
  contractor_id uuid, prep_business_days integer,
  target_start date, target_end date, kit_material_eta date,
  planned_send date, expected_return date,
  capacity_pushed boolean, returned boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT j.id, j.sale_order_id, j.sale_order_item_id, j.sector, j.pairs,
           COALESCE(j.received_pairs, 0) AS received_pairs,
           j.sent_at, j.received_at, j.updated_at, j.target_start, j.target_end,
           soi.reference_id,
           public.atelier_effective_prep_business_days(soi.reference_id, j.sector) AS prep,
           CASE WHEN COALESCE(j.execution_mode, '') = 'internal' THEN NULL
                ELSE COALESCE(j.contractor_id, acr.default_contractor_id) END AS ctr,
           (j.pipeline_status IN ('received_at_factory', 'done')
            OR (COALESCE(j.pairs, 0) > 0 AND COALESCE(j.received_pairs, 0) >= j.pairs)) AS is_ret
      FROM public.cabedal_prep_jobs j
      JOIN public.sale_order_items soi ON soi.id = j.sale_order_item_id
      JOIN public.sale_orders so ON so.id = j.sale_order_id AND so.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT a.default_contractor_id
          FROM public.atelier_complex_references a
         WHERE a.reference_id = soi.reference_id AND a.sector = j.sector AND a.active
         ORDER BY a.updated_at DESC NULLS LAST
         LIMIT 1
      ) acr ON true
     WHERE j.pipeline_status <> 'cancelled'
       AND so.status IN ('Aprovado', 'Em Produção')
  ),
  kit AS (
    SELECT b.id, MAX(public.motor_material_eta(mr.product_id, b.sale_order_id)) AS eta
      FROM base b
      CROSS JOIN LATERAL (
        SELECT k.product_id FROM public.atelier_resolve_sector_product_ids(b.sale_order_item_id, b.sector) k
        UNION
        SELECT unnest(COALESCE(public.atelier_lot_kit_product_ids(b.reference_id), ARRAY[]::uuid[]))
      ) kp
      JOIN public.material_reservations mr
        ON mr.sale_order_id = b.sale_order_id
       AND mr.product_id = kp.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.quantity_short, 0) > 0
     WHERE NOT b.is_ret AND b.sent_at IS NULL
     GROUP BY b.id
  ),
  planned AS (
    SELECT b.*, k.eta AS kit_eta,
           CASE
             WHEN b.sent_at IS NOT NULL THEN (b.sent_at AT TIME ZONE 'America/Sao_Paulo')::date
             ELSE GREATEST(COALESCE(b.target_start, public.br_today()),
                           COALESCE(k.eta, public.br_today()),
                           public.br_today())
           END AS send_d
      FROM base b
      LEFT JOIN kit k ON k.id = b.id
  ),
  cap AS (
    SELECT p.*,
           cs.capacity_pairs_per_day AS cap_day,
           SUM(GREATEST(0, COALESCE(p.pairs, 0) - p.received_pairs)) OVER (
             PARTITION BY p.ctr, p.sector ORDER BY p.send_d, p.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_pairs,
           MIN(p.send_d) OVER (PARTITION BY p.ctr, p.sector) AS queue_start
      FROM planned p
      LEFT JOIN public.atelier_contractor_sectors cs
        ON cs.contractor_id = p.ctr AND cs.sector = p.sector AND cs.active
       AND COALESCE(cs.capacity_pairs_per_day, 0) > 0
     WHERE NOT p.is_ret
  ),
  ret AS (
    SELECT c.id,
           GREATEST(
             public.add_business_days(c.send_d, c.prep),
             CASE WHEN c.sent_at IS NOT NULL THEN public.br_today() END
           ) AS base_ret,
           CASE WHEN c.cap_day IS NOT NULL THEN
             public.add_business_days(GREATEST(c.queue_start, public.br_today()),
                                      CEIL(c.cum_pairs / c.cap_day)::int)
           END AS cap_ret
      FROM cap c
  )
  SELECT p.id, p.sale_order_id, p.sale_order_item_id, p.sector, p.ctr, p.prep,
         p.target_start, p.target_end, p.kit_eta,
         CASE WHEN p.is_ret THEN NULL ELSE p.send_d END,
         CASE WHEN p.is_ret THEN (COALESCE(p.received_at, p.updated_at) AT TIME ZONE 'America/Sao_Paulo')::date
              ELSE GREATEST(r.base_ret, r.cap_ret) END,
         COALESCE(r.cap_ret > r.base_ret, false),
         p.is_ret
    FROM planned p
    LEFT JOIN ret r ON r.id = p.id;
$function$;

COMMENT ON FUNCTION public.atelier_jobs_expected_dates() IS
  'Envio e retorno previstos por serviço do Ateliê: envio = max(meta, chegada do kit, hoje); retorno = envio + prazo do prestador (dias úteis), empurrado pela capacidade diária do prestador.';

-- ─── Reserva automática do kit do cabedal complexo ──────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_link_kit_reservations_for_item(p_sale_order_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so uuid;
  v_ref uuid;
  v_jobs uuid[];
  v_kit uuid[];
  v_item_products uuid[];
  v_n int := 0;
BEGIN
  SELECT soi.sale_order_id, soi.reference_id INTO v_so, v_ref
    FROM public.sale_order_items soi WHERE soi.id = p_sale_order_item_id;
  IF v_so IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found');
  END IF;

  SELECT COALESCE(array_agg(j.id ORDER BY j.sector), ARRAY[]::uuid[])
    INTO v_jobs
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_item_id = p_sale_order_item_id
     AND j.pipeline_status <> 'cancelled';
  IF cardinality(v_jobs) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'linked', 0, 'reason', 'sem_servico_atelie');
  END IF;

  -- só o que este item realmente consome (cor certa)
  SELECT COALESCE(array_agg(DISTINCT d.product_id), ARRAY[]::uuid[])
    INTO v_item_products
    FROM public.sale_order_material_demand_lines(v_so) d
   WHERE d.sale_order_item_id = p_sale_order_item_id;

  SELECT COALESCE(array_agg(DISTINCT x.pid), ARRAY[]::uuid[])
    INTO v_kit
    FROM (
      SELECT k.product_id AS pid
        FROM public.cabedal_prep_jobs j
        CROSS JOIN LATERAL public.atelier_resolve_sector_product_ids(j.sale_order_item_id, j.sector) k
       WHERE j.id = ANY (v_jobs)
      UNION
      SELECT unnest(COALESCE(public.atelier_lot_kit_product_ids(v_ref), ARRAY[]::uuid[]))
    ) x
   WHERE x.pid IS NOT NULL
     AND x.pid = ANY (v_item_products);

  IF cardinality(v_kit) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'linked', 0, 'reason', 'kit_sem_produto');
  END IF;

  -- Empenho do PV (nível PV, sem OP) → atelier_prep: nunca é encolhido por
  -- outro PV na realocação (reallocate_product_commitments). Quantidade não muda:
  -- o empenhado continua empenhado, a falta continua falta (→ OC rascunho).
  UPDATE public.material_reservations mr
     SET metadata = COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object(
           'kind', 'atelier_prep',
           'adopted_from', COALESCE(NULLIF(mr.metadata ->> 'kind', ''), 'pv_commitment'),
           'sale_order_id', v_so,
           'atelier_item_ids', (
             SELECT to_jsonb(array_agg(DISTINCT e))
               FROM unnest(
                 COALESCE(ARRAY(SELECT jsonb_array_elements_text(mr.metadata -> 'atelier_item_ids')), ARRAY[]::text[])
                 || ARRAY[p_sale_order_item_id::text]) e),
           'atelier_job_ids', (
             SELECT to_jsonb(array_agg(DISTINCT e))
               FROM unnest(
                 COALESCE(ARRAY(SELECT jsonb_array_elements_text(mr.metadata -> 'atelier_job_ids')), ARRAY[]::text[])
                 || ARRAY(SELECT unnest(v_jobs)::text)) e),
           'motor_link', 'kit_cabedal_complexo'
         ),
         notes = CASE WHEN COALESCE(mr.notes, '') LIKE '%· kit Ateliê%' THEN mr.notes
                      ELSE COALESCE(mr.notes, '') || ' · kit Ateliê' END,
         updated_at = now()
   WHERE mr.sale_order_id = v_so
     AND mr.order_id IS NULL
     AND mr.product_id = ANY (v_kit)
     AND mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component', 'atelier_prep')
     AND mr.strap_variant_id IS NULL
     AND mr.sale_order_strap_demand_id IS NULL
     AND NOT (
       COALESCE(mr.metadata ->> 'kind', '') = 'atelier_prep'
       AND COALESCE(mr.metadata -> 'atelier_item_ids', '[]'::jsonb) ? p_sale_order_item_id::text
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'linked', v_n, 'kit_products', cardinality(v_kit));
END;
$function$;

COMMENT ON FUNCTION public.atelier_link_kit_reservations_for_item(uuid) IS
  'Ao aprovar PV com cabedal complexo: o empenho do kit (o que há em estoque) fica atelier_prep, ligado ao item e aos serviços do Ateliê — não é consumido por outro pedido. Falta continua em quantity_short.';

-- ─── materialize: pronto = faturamento − pronto antes; liga o kit ao item ──
CREATE OR REPLACE FUNCTION public.materialize_cabedal_prep_demands(p_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_billing text;
  v_billing_start date;
  v_upserted int := 0;
  v_skipped int := 0;
  r record;
  v_cap numeric;
  v_assembly_days int;
  v_lead int;
  v_ready date;
  v_sectors text[];
  v_demand_id uuid;
BEGIN
  SELECT so.status, so.billing_week
    INTO v_status, v_billing
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado', 'status', v_status);
  END IF;

  v_billing_start := public.cabedal_prep_billing_start(v_billing);

  FOR r IN
    SELECT soi.id AS item_id,
           soi.reference_id,
           soi.color,
           soi.quantity AS pairs,
           COALESCE(
             NULLIF(btrim(ts.code), ''),
             NULLIF(btrim(ts.model), ''),
             NULLIF(btrim(ts.name), '')
           ) AS reference_code,
           ts.assembly_capacity_per_day
      FROM public.sale_order_items soi
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.production_excluded_at IS NULL
       AND COALESCE(soi.quantity, 0) > 0
  LOOP
    v_sectors := public.atelier_reference_street_sectors(r.reference_id);

    IF cardinality(v_sectors) = 0 THEN
      UPDATE public.cabedal_prep_jobs j
         SET pipeline_status = 'cancelled', updated_at = now()
       WHERE j.sale_order_item_id = r.item_id
         AND j.pipeline_status = 'awaiting_cut';
      UPDATE public.cabedal_prep_demands d
         SET status = 'cancelled', updated_at = now(), stale_reason = 'fora_do_atelier'
       WHERE d.sale_order_item_id = r.item_id
         AND d.status IN ('open', 'planned', 'stale')
         AND NOT EXISTS (
           SELECT 1 FROM public.cabedal_prep_jobs j
            WHERE j.demand_id = d.id AND j.pipeline_status NOT IN ('awaiting_cut', 'cancelled')
         );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
    ELSE
      v_assembly_days := NULL;
    END IF;
    -- Pronto no Ateliê (motor_prazos_20270101054700): início da semana de
    -- faturamento − "pronto antes do faturamento" (dias corridos, Prazos do motor).
    -- O prazo do PRESTADOR (dias úteis, envio → retorno) não entra aqui: ele
    -- define a data de envio (atelier_compute_job_targets) e a OC do kit.
    v_lead := COALESCE(
      (SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1),
      7
    );
    v_ready := CASE
      WHEN v_billing_start IS NULL THEN NULL
      ELSE v_billing_start - v_lead
    END;

    INSERT INTO public.cabedal_prep_demands (
      sale_order_id, sale_order_item_id, technical_sheet_id, reference_code,
      color, pairs, billing_week, billing_start_date, assembly_capacity_per_day,
      assembly_days, ready_date, requires_cut, requires_sewing, requires_aviamento,
      status, updated_at
    ) VALUES (
      p_sale_order_id, r.item_id, r.reference_id, r.reference_code,
      r.color, r.pairs, v_billing, v_billing_start, v_cap,
      v_assembly_days, v_ready,
      true,
      'costura_cabedal' = ANY (v_sectors),
      'aviamento' = ANY (v_sectors),
      'open', now()
    )
    ON CONFLICT (sale_order_item_id) DO UPDATE SET
      pairs = CASE WHEN EXISTS (
                SELECT 1 FROM public.atelier_lots l
                 WHERE l.id = public.cabedal_prep_demands.lot_id AND l.status = 'cut')
              THEN public.cabedal_prep_demands.pairs ELSE EXCLUDED.pairs END,
      color = CASE WHEN EXISTS (
                SELECT 1 FROM public.atelier_lots l
                 WHERE l.id = public.cabedal_prep_demands.lot_id AND l.status = 'cut')
              THEN public.cabedal_prep_demands.color ELSE EXCLUDED.color END,
      stale_reason = CASE WHEN EXISTS (
                SELECT 1 FROM public.atelier_lots l
                 WHERE l.id = public.cabedal_prep_demands.lot_id AND l.status = 'cut')
                 AND (public.cabedal_prep_demands.pairs IS DISTINCT FROM EXCLUDED.pairs
                      OR public.cabedal_prep_demands.color IS DISTINCT FROM EXCLUDED.color)
              THEN 'item_mudou_apos_corte' ELSE NULL END,
      billing_week = EXCLUDED.billing_week,
      billing_start_date = EXCLUDED.billing_start_date,
      assembly_capacity_per_day = EXCLUDED.assembly_capacity_per_day,
      assembly_days = EXCLUDED.assembly_days,
      ready_date = EXCLUDED.ready_date,
      requires_cut = EXCLUDED.requires_cut,
      requires_sewing = EXCLUDED.requires_sewing,
      requires_aviamento = EXCLUDED.requires_aviamento,
      technical_sheet_id = EXCLUDED.technical_sheet_id,
      reference_code = EXCLUDED.reference_code,
      status = CASE WHEN public.cabedal_prep_demands.status = 'cancelled'
                    THEN 'open' ELSE public.cabedal_prep_demands.status END,
      updated_at = now()
    RETURNING id INTO v_demand_id;

    PERFORM public.atelier_sync_jobs_for_demand(v_demand_id);
    -- Reserva automática do kit (motor_prazos_20270101054700): o que existe em
    -- estoque fica empenhado para o item/serviço do Ateliê e não é encolhido
    -- por outro PV; o que falta segue como falta (quantity_short) → OC rascunho.
    PERFORM public.atelier_link_kit_reservations_for_item(r.item_id);
    v_upserted := v_upserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'skipped', v_skipped,
    'billing_week', v_billing,
    'billing_start_date', v_billing_start
  );
END;
$function$
;

-- ─── Tela "Prazos do motor": leitura e gravação ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_motor_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.atelier_settings%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.atelier_settings WHERE id = 1;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'default_prep_business_days', s.default_prep_business_days,
      'effective_default_prep_business_days', COALESCE(s.default_prep_business_days,
                                                      GREATEST(COALESCE(s.costura_offset_days, 5), COALESCE(s.aviamento_offset_days, 5))),
      'costura_offset_days', COALESCE(s.costura_offset_days, 5),
      'aviamento_offset_days', COALESCE(s.aviamento_offset_days, 5),
      'ready_before_billing_days', COALESCE(s.ready_before_billing_days, 7),
      'default_oc_lead_days', COALESCE(s.default_oc_lead_days, 10),
      'oc_urgency_window_business_days', COALESCE(s.oc_urgency_window_business_days, 2),
      'weekly_purchase_cap_brl', s.weekly_purchase_cap_brl,
      'purchase_horizon_business_days', COALESCE(s.purchase_horizon_business_days, 10),
      'buffer_business_days', COALESCE(s.buffer_business_days, 2),
      'motor_cabedal_gate_sector', COALESCE(s.motor_cabedal_gate_sector, 'Montagem'),
      'auto_motor_enabled', COALESCE(s.auto_motor_enabled, false),
      'urgent_release_without_material', COALESCE(s.urgent_release_without_material, false),
      'updated_at', s.updated_at
    ),
    'references', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id,
               'reference_id', a.reference_id,
               'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name),
               'sector', a.sector,
               'prep_business_days', a.prep_business_days,
               'effective_prep_business_days', CASE WHEN a.sector IN ('costura_cabedal', 'aviamento')
                 THEN public.atelier_effective_prep_business_days(a.reference_id, a.sector) END,
               'default_execution_mode', a.default_execution_mode,
               'default_contractor_id', a.default_contractor_id,
               'default_contractor_name', c.name,
               'contractor_capacity_pairs_per_day', cs.capacity_pairs_per_day
             ) ORDER BY COALESCE(NULLIF(btrim(ts.code), ''), ts.name), a.sector)
        FROM public.atelier_complex_references a
        LEFT JOIN public.technical_sheets ts ON ts.id = a.reference_id
        LEFT JOIN public.contractors c ON c.id = a.default_contractor_id
        LEFT JOIN public.atelier_contractor_sectors cs
          ON cs.contractor_id = a.default_contractor_id AND cs.sector = a.sector AND cs.active
       WHERE a.active IS TRUE
    ), '[]'::jsonb),
    'contractors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contractor_id', c.id,
               'name', c.name,
               'sector', cs.sector,
               'capacity_pairs_per_day', cs.capacity_pairs_per_day,
               'active', cs.active
             ) ORDER BY c.name, cs.sector)
        FROM public.atelier_contractor_sectors cs
        JOIN public.contractors c ON c.id = cs.contractor_id
    ), '[]'::jsonb),
    'sectors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'sector', ss.sector,
               'flow_order', ss.flow_order,
               'enabled', ss.enabled,
               'daily_capacity_pairs', ss.daily_capacity_pairs
             ) ORDER BY ss.flow_order, ss.sector)
        FROM public.sector_settings ss
    ), '[]'::jsonb),
    'lead_time_categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'shoe_category', d.shoe_category,
               'corte', d.lead_time_corte_dias,
               'costura', d.lead_time_costura_dias,
               'silk', d.lead_time_silk_dias,
               'colagem', d.lead_time_colagem_dias,
               'montagem', d.lead_time_montagem_dias,
               'acabamento', d.lead_time_acabamento_dias,
               'expedicao', d.lead_time_expedicao_dias,
               'buffer_material', d.lead_time_buffer_material_dias
             ) ORDER BY d.shoe_category)
        FROM public.default_lead_times d
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_motor_settings(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_allowed text[] := ARRAY[
    'default_prep_business_days', 'costura_offset_days', 'aviamento_offset_days',
    'ready_before_billing_days', 'default_oc_lead_days', 'oc_urgency_window_business_days',
    'weekly_purchase_cap_brl', 'purchase_horizon_business_days', 'buffer_business_days',
    'motor_cabedal_gate_sector'
  ];
  v_int int;
  v_num numeric;
  v_gate text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Prazos do motor: envie um objeto com os campos a alterar';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'Prazos do motor: campo % não pode ser alterado aqui', v_key;
    END IF;
  END LOOP;

  INSERT INTO public.atelier_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  IF p_patch ? 'default_prep_business_days' THEN
    v_int := NULLIF(p_patch ->> 'default_prep_business_days', '')::int;
    IF v_int IS NOT NULL AND (v_int < 1 OR v_int > 60) THEN
      RAISE EXCEPTION 'Prazo padrão do prestador: use de 1 a 60 dias úteis (vazio = usa Costura/Aviamento)';
    END IF;
    UPDATE public.atelier_settings SET default_prep_business_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'costura_offset_days' THEN
    v_int := (p_patch ->> 'costura_offset_days')::int;
    IF v_int IS NULL OR v_int < 0 OR v_int > 60 THEN RAISE EXCEPTION 'Costura: use de 0 a 60 dias úteis'; END IF;
    UPDATE public.atelier_settings SET costura_offset_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'aviamento_offset_days' THEN
    v_int := (p_patch ->> 'aviamento_offset_days')::int;
    IF v_int IS NULL OR v_int < 0 OR v_int > 60 THEN RAISE EXCEPTION 'Aviamento: use de 0 a 60 dias úteis'; END IF;
    UPDATE public.atelier_settings SET aviamento_offset_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'ready_before_billing_days' THEN
    v_int := (p_patch ->> 'ready_before_billing_days')::int;
    IF v_int IS NULL OR v_int < 0 OR v_int > 60 THEN RAISE EXCEPTION 'Pronto antes do faturamento: use de 0 a 60 dias'; END IF;
    UPDATE public.atelier_settings SET ready_before_billing_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'default_oc_lead_days' THEN
    v_int := (p_patch ->> 'default_oc_lead_days')::int;
    IF v_int IS NULL OR v_int < 1 OR v_int > 120 THEN RAISE EXCEPTION 'Lead padrão de OC: use de 1 a 120 dias'; END IF;
    UPDATE public.atelier_settings SET default_oc_lead_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'oc_urgency_window_business_days' THEN
    v_int := (p_patch ->> 'oc_urgency_window_business_days')::int;
    IF v_int IS NULL OR v_int < 0 OR v_int > 30 THEN RAISE EXCEPTION 'Janela de urgência da OC: use de 0 a 30 dias úteis'; END IF;
    UPDATE public.atelier_settings SET oc_urgency_window_business_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'weekly_purchase_cap_brl' THEN
    v_num := NULLIF(p_patch ->> 'weekly_purchase_cap_brl', '')::numeric;
    IF v_num IS NOT NULL AND v_num <= 0 THEN RAISE EXCEPTION 'Teto semanal de compra: valor maior que zero (vazio = sem teto)'; END IF;
    UPDATE public.atelier_settings SET weekly_purchase_cap_brl = v_num WHERE id = 1;
  END IF;
  IF p_patch ? 'purchase_horizon_business_days' THEN
    v_int := (p_patch ->> 'purchase_horizon_business_days')::int;
    IF v_int IS NULL OR v_int < 1 OR v_int > 60 THEN RAISE EXCEPTION 'Horizonte de compra: use de 1 a 60 dias úteis'; END IF;
    UPDATE public.atelier_settings SET purchase_horizon_business_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'buffer_business_days' THEN
    v_int := (p_patch ->> 'buffer_business_days')::int;
    IF v_int IS NULL OR v_int < 0 OR v_int > 30 THEN RAISE EXCEPTION 'Folga de material: use de 0 a 30 dias úteis'; END IF;
    UPDATE public.atelier_settings SET buffer_business_days = v_int WHERE id = 1;
  END IF;
  IF p_patch ? 'motor_cabedal_gate_sector' THEN
    v_gate := btrim(COALESCE(p_patch ->> 'motor_cabedal_gate_sector', ''));
    IF NOT EXISTS (SELECT 1 FROM public.sector_settings ss WHERE ss.sector = v_gate) THEN
      RAISE EXCEPTION 'Setor que espera o cabedal: % não existe em Setores', v_gate;
    END IF;
    UPDATE public.atelier_settings SET motor_cabedal_gate_sector = v_gate WHERE id = 1;
  END IF;

  UPDATE public.atelier_settings SET updated_at = now() WHERE id = 1;
  RETURN public.get_motor_config();
END;
$function$;

REVOKE ALL ON FUNCTION public.get_motor_config() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_motor_settings(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atelier_link_kit_reservations_for_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atelier_jobs_expected_dates() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.motor_material_eta(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atelier_effective_prep_business_days(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.motor_default_oc_lead_days() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_motor_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_motor_settings(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atelier_link_kit_reservations_for_item(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.atelier_jobs_expected_dates() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motor_material_eta(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atelier_effective_prep_business_days(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.motor_default_oc_lead_days() TO authenticated, service_role;
