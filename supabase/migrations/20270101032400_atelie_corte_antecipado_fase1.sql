-- Ateliê v2 — Fase 1 (specs/atelie-corte-antecipado.md)
--
-- Destrava o ciclo:  job "awaiting_cut" esperava OP + Corte Cabedal concluído,
-- e a OP só nascia após "received_at_factory" (porta 31100). Agora o corte é
-- da FILA DO ATELIÊ, por LOTE (ref × cor × variante, vários PVs), antes da OP.
--
--   awaiting_cut ─(confirmar corte do lote: débito por item)→ cut
--   cut ─(enviar)→ sent_to_contractor ─(receber)→ received_at_factory
--   → gate libera a OP; etapas feitas pelo Ateliê nascem 'concluido'.
--
-- Estoque:
--   * soft = pv_commitment (já cobre o item); o Ateliê NÃO cria soft própria;
--   * corte debita por ITEM a necessidade real (sale_order_material_demand_lines,
--     filtrada pelos componentes do kit), LEAST(disponível) + pendência visível;
--   * pv_commitment ganha quantity_consumed do que saiu → settle da OP só
--     debita o resto; hybrid_debit desconta o que o Ateliê já debitou do item.
--
-- Não há dado a migrar no pipeline: 0 jobs, 0 débitos Ateliê (medido 10/10/2026).

-- order_stages / material_reservations são quentes: falha rápido em vez de enfileirar.
SET LOCAL lock_timeout = '10s';

-- ─── 1. Cadastro: kit e valor por par ───────────────────────────────────────
ALTER TABLE public.atelier_complex_references
  ADD COLUMN IF NOT EXISTS value_per_pair numeric CHECK (value_per_pair IS NULL OR value_per_pair >= 0),
  ADD COLUMN IF NOT EXISTS material_components text[];

COMMENT ON COLUMN public.atelier_complex_references.material_components IS
  'Componentes (calculate_order_consumption_by_grade.component) que vão no kit do lote. NULL = default do setor.';

CREATE OR REPLACE FUNCTION public.atelier_default_kit_components(p_sector text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_sector
    WHEN 'costura_cabedal' THEN ARRAY['Cabedal', 'Forração']
    WHEN 'aviamento' THEN ARRAY['Componente Direto', 'BOM']
    ELSE ARRAY[]::text[]
  END;
$$;

-- A ficha suporta o setor? Fonte única (writer, gate e tela).
CREATE OR REPLACE FUNCTION public.atelier_sheet_supports_sector(
  p_reference_id uuid,
  p_sector text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      (
        NULLIF(btrim(COALESCE(ts.upper_material, '')), '') IS NOT NULL
        OR ts.upper_material_group_id IS NOT NULL
        OR ts.upper_material_product_id IS NOT NULL
        OR COALESCE(ts.upper_consumption, 0) > 0
        OR (jsonb_typeof(ts.components_accessories) = 'array'
            AND jsonb_array_length(ts.components_accessories) > 0)
      ) AS has_cut,
      COALESCE(ts.upper_corte_a_fio, false) AS corte_a_fio,
      (
        COALESCE(ts.has_straps, false)
        OR (jsonb_typeof(ts.aviamento_steps) = 'array'
            AND jsonb_array_length(ts.aviamento_steps) > 0)
      ) AS has_avi
    FROM public.technical_sheets ts
    WHERE ts.id = p_reference_id
  )
  SELECT COALESCE((
    SELECT CASE p_sector
      WHEN 'corte_cabedal' THEN s.has_cut
      WHEN 'costura_cabedal' THEN s.has_cut AND NOT s.corte_a_fio
      WHEN 'aviamento' THEN s.has_avi
      ELSE false
    END
    FROM s
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sheet_supports_sector(uuid, text)
  TO authenticated, service_role;

-- Setores de RUA efetivos da referência: cadastro ativo ∩ ficha suporta.
CREATE OR REPLACE FUNCTION public.atelier_reference_street_sectors(p_reference_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(a.sector ORDER BY a.sector), ARRAY[]::text[])
    FROM public.atelier_complex_references a
   WHERE a.reference_id = p_reference_id
     AND a.active
     AND a.sector IN ('costura_cabedal', 'aviamento')
     AND public.atelier_sheet_supports_sector(p_reference_id, a.sector);
$$;

GRANT EXECUTE ON FUNCTION public.atelier_reference_street_sectors(uuid)
  TO authenticated, service_role;

-- Referências que efetivamente passam pelo Ateliê (lookahead/sequência no TS).
CREATE OR REPLACE FUNCTION public.list_atelier_gated_reference_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.reference_id
    FROM public.atelier_complex_references a
   WHERE a.active
     AND cardinality(public.atelier_reference_street_sectors(a.reference_id)) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.list_atelier_gated_reference_ids()
  TO authenticated, service_role;

-- Validação no cadastro (R1.1): recusa setor que a ficha não tem.
CREATE OR REPLACE FUNCTION public.tg_atelier_catalog_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active AND NOT public.atelier_sheet_supports_sector(NEW.reference_id, NEW.sector) THEN
    RAISE EXCEPTION '%', CASE NEW.sector
      WHEN 'costura_cabedal' THEN
        'Ficha sem material de cabedal (ou cabedal em corte a fio) — não tem Costura. Cadastre o material de cabedal na ficha ou use Aviamento.'
      WHEN 'aviamento' THEN
        'Ficha sem etapas de aviamento nem tiras — não tem Aviamento. Cadastre o aviamento na ficha.'
      ELSE
        'Ficha sem material de cabedal — não tem Corte.'
    END
    USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_catalog_validate ON public.atelier_complex_references;
CREATE TRIGGER trg_atelier_catalog_validate
  BEFORE INSERT OR UPDATE OF active, sector, reference_id
  ON public.atelier_complex_references
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_catalog_validate();

-- ─── 2. Lotes ───────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.atelier_lot_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.atelier_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_number text NOT NULL UNIQUE
    DEFAULT 'LOTE-' || lpad(nextval('public.atelier_lot_number_seq')::text, 5, '0'),
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  color text,
  color_norm text NOT NULL DEFAULT '',
  material_variant_id uuid REFERENCES public.reference_material_variants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cut', 'cancelled')),
  cut_at timestamptz,
  cut_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um lote ABERTO por ref × cor × variante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_lots_open
  ON public.atelier_lots (
    reference_id, color_norm,
    COALESCE(material_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'open';

ALTER TABLE public.atelier_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_lots_all ON public.atelier_lots;
CREATE POLICY atelier_lots_all ON public.atelier_lots
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

ALTER TABLE public.cabedal_prep_demands
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.atelier_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_demands_lot ON public.cabedal_prep_demands (lot_id);

ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.atelier_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cut_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_cabedal_prep_jobs_lot ON public.cabedal_prep_jobs (lot_id);

-- Pipeline novo. 0 jobs no banco → só troca o CHECK.
UPDATE public.cabedal_prep_jobs
   SET pipeline_status = CASE pipeline_status
         WHEN 'awaiting_debit' THEN 'awaiting_cut'
         WHEN 'debited' THEN 'cut'
         ELSE pipeline_status
       END
 WHERE pipeline_status IN ('awaiting_debit', 'debited');

ALTER TABLE public.cabedal_prep_jobs
  DROP CONSTRAINT IF EXISTS cabedal_prep_jobs_pipeline_status_check;
ALTER TABLE public.cabedal_prep_jobs
  ADD CONSTRAINT cabedal_prep_jobs_pipeline_status_check
  CHECK (pipeline_status = ANY (ARRAY[
    'awaiting_cut'::text, 'cut'::text, 'sent_to_contractor'::text,
    'received_at_factory'::text, 'cancelled'::text
  ]));
ALTER TABLE public.cabedal_prep_jobs ALTER COLUMN pipeline_status SET DEFAULT 'awaiting_cut';

-- ─── 3. Ledger por item, com pendência ─────────────────────────────────────
ALTER TABLE public.cabedal_prep_stock_debits
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.atelier_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS required_qty numeric,
  ADD COLUMN IF NOT EXISTS pending_qty numeric NOT NULL DEFAULT 0 CHECK (pending_qty >= 0),
  ADD COLUMN IF NOT EXISTS component text;

ALTER TABLE public.cabedal_prep_stock_debits
  DROP CONSTRAINT IF EXISTS cabedal_prep_stock_debits_quantity_check;
ALTER TABLE public.cabedal_prep_stock_debits
  ADD CONSTRAINT cabedal_prep_stock_debits_quantity_check CHECK (quantity >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cabedal_prep_stock_debits_item_product_lot
  ON public.cabedal_prep_stock_debits (sale_order_item_id, product_id)
  WHERE lot_id IS NOT NULL;

COMMENT ON COLUMN public.cabedal_prep_stock_debits.pending_qty IS
  'Necessidade do item que NÃO saiu no corte do lote (faltou estoque). A OP reserva/debita esse resto.';

-- Quanto o Ateliê já debitou deste produto PARA ESTE ITEM (só o efetivo).
CREATE OR REPLACE FUNCTION public.atelier_item_product_debited_qty(
  p_sale_order_item_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(d.quantity), 0)
    FROM public.cabedal_prep_stock_debits d
   WHERE p_sale_order_item_id IS NOT NULL
     AND d.sale_order_item_id = p_sale_order_item_id
     AND d.product_id = p_product_id;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_item_product_debited_qty(uuid, uuid)
  TO authenticated, service_role;

-- ─── 4. Remove o gate antigo (dependia da OP) ──────────────────────────────
DROP TRIGGER IF EXISTS trg_atelier_unlock_on_order_stage ON public.order_stages;
DROP FUNCTION IF EXISTS public.tg_atelier_unlock_on_order_stage();
DROP FUNCTION IF EXISTS public.atelier_unlock_jobs_after_cut(uuid);
DROP FUNCTION IF EXISTS public.atelier_cut_gate_released(uuid, uuid);
-- Débito por job (pares como quantidade, PV inteiro) → substituído pelo corte do lote.
DROP FUNCTION IF EXISTS public.atelier_confirm_job_debit(uuid);

-- ─── 5. Lote aberto da demanda ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_assign_lot_for_demand(p_demand_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.cabedal_prep_demands%ROWTYPE;
  v_variant uuid;
  v_norm text;
  v_lot public.atelier_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT soi.material_variant_id INTO v_variant
    FROM public.sale_order_items soi WHERE soi.id = v_d.sale_order_item_id;
  v_norm := lower(btrim(COALESCE(v_d.color, '')));

  IF v_d.lot_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM public.atelier_lots WHERE id = v_d.lot_id;
    -- Lote já cortado não muda; lote aberto que ainda casa fica.
    IF FOUND AND (
      v_lot.status = 'cut'
      OR (v_lot.status = 'open'
          AND v_lot.reference_id = v_d.technical_sheet_id
          AND v_lot.color_norm = v_norm
          AND v_lot.material_variant_id IS NOT DISTINCT FROM v_variant)
    ) THEN
      RETURN v_lot.id;
    END IF;
  END IF;

  SELECT * INTO v_lot
    FROM public.atelier_lots l
   WHERE l.status = 'open'
     AND l.reference_id = v_d.technical_sheet_id
     AND l.color_norm = v_norm
     AND l.material_variant_id IS NOT DISTINCT FROM v_variant
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.atelier_lots (reference_id, color, color_norm, material_variant_id)
    VALUES (v_d.technical_sheet_id, NULLIF(btrim(COALESCE(v_d.color, '')), ''), v_norm, v_variant)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_lot;
    IF v_lot.id IS NULL THEN
      SELECT * INTO v_lot
        FROM public.atelier_lots l
       WHERE l.status = 'open'
         AND l.reference_id = v_d.technical_sheet_id
         AND l.color_norm = v_norm
         AND l.material_variant_id IS NOT DISTINCT FROM v_variant
       LIMIT 1;
    END IF;
  END IF;

  UPDATE public.cabedal_prep_demands SET lot_id = v_lot.id, updated_at = now() WHERE id = p_demand_id;
  UPDATE public.cabedal_prep_jobs SET lot_id = v_lot.id, updated_at = now()
   WHERE demand_id = p_demand_id AND pipeline_status = 'awaiting_cut';
  RETURN v_lot.id;
END;
$$;

-- ─── 6. Sync de jobs (sem soft própria; status herda o lote) ────────────────
CREATE OR REPLACE FUNCTION public.atelier_sync_jobs_for_demand(p_demand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.cabedal_prep_demands%ROWTYPE;
  v_sectors text[];
  v_sec text;
  v_lot_id uuid;
  v_lot_status text;
  v_initial text;
  v_t_start date;
  v_t_end date;
  v_n int := 0;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'demand_not_found');
  END IF;
  IF v_d.technical_sheet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_sheet');
  END IF;

  v_sectors := public.atelier_reference_street_sectors(v_d.technical_sheet_id);

  -- Setor que saiu do cadastro: cancela só o que ainda não foi cortado.
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
   WHERE j.demand_id = p_demand_id
     AND j.pipeline_status = 'awaiting_cut'
     AND NOT (j.sector = ANY (v_sectors));

  IF cardinality(v_sectors) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'sectors', '[]'::jsonb, 'jobs', 0);
  END IF;

  v_lot_id := public.atelier_assign_lot_for_demand(p_demand_id);
  SELECT status INTO v_lot_status FROM public.atelier_lots WHERE id = v_lot_id;
  v_initial := CASE WHEN v_lot_status = 'cut' THEN 'cut' ELSE 'awaiting_cut' END;

  FOREACH v_sec IN ARRAY v_sectors LOOP
    SELECT t.target_start, t.target_end
      INTO v_t_start, v_t_end
      FROM public.atelier_compute_job_targets(
        v_d.sale_order_item_id, v_d.sale_order_id, v_sec, v_d.ready_date
      ) t;

    INSERT INTO public.cabedal_prep_jobs (
      demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
      sector, pairs, color, reference_code, pipeline_status,
      target_start, target_end, lot_id
    ) VALUES (
      p_demand_id, v_d.sale_order_id, v_d.sale_order_item_id, v_d.technical_sheet_id,
      v_sec, v_d.pairs, v_d.color, v_d.reference_code, v_initial,
      v_t_start, v_t_end, v_lot_id
    )
    ON CONFLICT (demand_id, sector) DO UPDATE SET
      pairs = EXCLUDED.pairs,
      color = EXCLUDED.color,
      reference_code = EXCLUDED.reference_code,
      target_start = EXCLUDED.target_start,
      target_end = EXCLUDED.target_end,
      lot_id = EXCLUDED.lot_id,
      pipeline_status = EXCLUDED.pipeline_status,
      updated_at = now()
    WHERE public.cabedal_prep_jobs.pipeline_status IN ('awaiting_cut', 'cancelled');
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'sectors', to_jsonb(v_sectors), 'jobs', v_n, 'lot_id', v_lot_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sync_jobs_for_demand(uuid) TO authenticated, service_role;

-- ─── 7. Materializador: Aprovado + Em Produção sem OP; gate pela ficha ─────
CREATE OR REPLACE FUNCTION public.materialize_cabedal_prep_demands(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
           ts.assembly_capacity_per_day,
           EXISTS (
             SELECT 1 FROM public.orders o
              WHERE o.sale_order_item_id = soi.id
                AND o.deleted_at IS NULL
                AND COALESCE(o.status, '') <> 'Cancelado'
           ) AS has_op
      FROM public.sale_order_items soi
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.production_excluded_at IS NULL
       AND COALESCE(soi.quantity, 0) > 0
  LOOP
    v_sectors := public.atelier_reference_street_sectors(r.reference_id);

    IF cardinality(v_sectors) = 0 THEN
      -- Fora do Ateliê: cancela o que ainda não foi cortado.
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

    -- Item que já virou OP sem passar pelo Ateliê não volta pra rua.
    IF r.has_op AND NOT EXISTS (
      SELECT 1 FROM public.cabedal_prep_demands d
       WHERE d.sale_order_item_id = r.item_id AND d.status <> 'cancelled'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
      v_lead := v_assembly_days + 1;
    ELSE
      v_assembly_days := NULL;
      v_lead := NULL;
    END IF;
    v_ready := CASE WHEN v_billing_start IS NOT NULL AND v_lead IS NOT NULL
                    THEN v_billing_start - v_lead END;

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
      -- Demanda de lote já cortado não muda pares/cor (o que saiu, saiu).
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
$$;

REVOKE ALL ON FUNCTION public.materialize_cabedal_prep_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_cabedal_prep_demands(uuid)
  TO authenticated, service_role;

-- Reaplicar: Aprovado E Em Produção.
CREATE OR REPLACE FUNCTION public.reapply_atelier_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remat int := 0;
  v_before int;
  v_after int;
  r record;
  v_res jsonb;
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_before FROM public.cabedal_prep_jobs WHERE pipeline_status = 'cancelled';

  -- Demandas de PV que saiu de Aprovado/Em Produção (ex.: cancelado).
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'cancelled', updated_at = now()
    FROM public.sale_orders so
   WHERE so.id = j.sale_order_id
     AND j.pipeline_status = 'awaiting_cut'
     AND (so.deleted_at IS NOT NULL OR so.status NOT IN ('Aprovado', 'Em Produção'));

  FOR r IN
    SELECT so.id FROM public.sale_orders so
     WHERE so.deleted_at IS NULL AND so.status IN ('Aprovado', 'Em Produção')
  LOOP
    v_res := public.materialize_cabedal_prep_demands(r.id);
    IF COALESCE((v_res ->> 'upserted')::int, 0) > 0 THEN
      v_remat := v_remat + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_after FROM public.cabedal_prep_jobs WHERE pipeline_status = 'cancelled';

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_demands', GREATEST(v_after - v_before, 0),
    'sale_orders_touched', v_remat
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reapply_atelier_eligibility() TO authenticated, service_role;

-- Outbox: erro do materializador SOBE (outbox registra e re-tenta). Antes o
-- EXCEPTION WHEN OTHERS devolvia ok:false e ninguém via.
DO $patch_outbox$
DECLARE
  v_def text;
  v_old text := $o$PERFORM public.materialize_cabedal_prep_demands(p_sale_order_id);$o$;
BEGIN
  SELECT pg_get_functiondef('public.process_cabedal_prep_purchase_shortages(uuid)'::regprocedure)
    INTO v_def;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora materialize em process_cabedal_prep_purchase_shortages não encontrada';
  END IF;
  -- Materializa ANTES do bloco com handler: renomeia a função interna e cria wrapper.
  EXECUTE replace(
    replace(v_def, v_old, '-- materialize roda no wrapper (erro sobe)'),
    'FUNCTION public.process_cabedal_prep_purchase_shortages(',
    'FUNCTION public.process_cabedal_prep_purchase_shortages_po('
  );
END;
$patch_outbox$;

CREATE OR REPLACE FUNCTION public.process_cabedal_prep_purchase_shortages(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mat jsonb;
  v_po jsonb;
BEGIN
  v_mat := public.materialize_cabedal_prep_demands(p_sale_order_id);
  v_po := public.process_cabedal_prep_purchase_shortages_po(p_sale_order_id);
  RETURN COALESCE(v_po, '{}'::jsonb) || jsonb_build_object('atelier', v_mat);
END;
$$;

REVOKE ALL ON FUNCTION public.process_cabedal_prep_purchase_shortages_po(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_cabedal_prep_purchase_shortages(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_cabedal_prep_purchase_shortages_po(uuid) TO service_role;

-- ─── 8. Confirmar corte do LOTE (débito por item + pendência) ─────────────
CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_dem record;
  v_line record;
  v_components text[];
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_items int := 0;
  v_lines int := 0;
  v_pending int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status = 'cut' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', 'cut');
  END IF;
  IF v_lot.status <> 'open' THEN
    RAISE EXCEPTION 'Lote % está %', v_lot.lot_number, v_lot.status USING ERRCODE = '22023';
  END IF;

  -- Componentes do kit = união dos setores de rua da referência.
  SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[])
    INTO v_components
    FROM public.atelier_complex_references a
    CROSS JOIN LATERAL unnest(
      COALESCE(a.material_components, public.atelier_default_kit_components(a.sector))
    ) c
   WHERE a.reference_id = v_lot.reference_id
     AND a.active
     AND a.sector = ANY (public.atelier_reference_street_sectors(v_lot.reference_id));

  FOR v_dem IN
    SELECT d.id, d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id
       AND d.status <> 'cancelled'
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.demand_id = d.id AND j.pipeline_status = 'awaiting_cut'
       )
     ORDER BY d.created_at
  LOOP
    v_items := v_items + 1;

    FOR v_line IN
      SELECT l.product_id, min(l.component) AS component, sum(l.required)::numeric AS required
        FROM public.sale_order_material_demand_lines(v_dem.sale_order_id) l
       WHERE l.sale_order_item_id = v_dem.sale_order_item_id
         AND l.component = ANY (v_components)
       GROUP BY l.product_id
       ORDER BY l.product_id
    LOOP
      IF COALESCE(v_line.required, 0) <= 0 THEN
        CONTINUE;
      END IF;
      -- Idempotente por item × produto.
      IF EXISTS (
        SELECT 1 FROM public.cabedal_prep_stock_debits s
         WHERE s.sale_order_item_id = v_dem.sale_order_item_id
           AND s.product_id = v_line.product_id
           AND s.lot_id IS NOT NULL
      ) THEN
        CONTINUE;
      END IF;

      SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
      v_mov := NULL;

      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = quantity - v_debit, updated_at = now()
         WHERE id = v_line.product_id;

        INSERT INTO public.stock_movements (
          product_id, order_id, movement_type, quantity,
          previous_stock, new_stock, description, movement_reason
        ) VALUES (
          v_line.product_id, NULL, 'out', v_debit,
          v_prev, v_prev - v_debit,
          'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'atelier_prep'
        )
        RETURNING id INTO v_mov;

        -- Comprometimento do PV: o que saiu vira consumido (settle da OP só
        -- debita o resto: reserved − consumed).
        SELECT mr.id INTO v_res_id
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = v_dem.sale_order_id
           AND mr.product_id = v_line.product_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
           AND mr.strap_variant_id IS NULL
           AND mr.sale_order_strap_demand_id IS NULL
         ORDER BY mr.created_at
         LIMIT 1
         FOR UPDATE;

        IF v_res_id IS NOT NULL THEN
          UPDATE public.material_reservations
             SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
                 quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
                 status = CASE
                   WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                        <= COALESCE(quantity_consumed, 0) + v_debit
                     THEN 'consumed'
                   ELSE 'partially_consumed'
                 END,
                 consumed_at = now(),
                 metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('atelier_consumed', true),
                 updated_at = now()
           WHERE id = v_res_id;
        END IF;
      ELSE
        v_res_id := NULL;
      END IF;

      INSERT INTO public.cabedal_prep_stock_debits (
        sale_order_id, sale_order_item_id, product_id, quantity,
        required_qty, pending_qty, component,
        stock_movement_id, sector, lot_id, reservation_id
      ) VALUES (
        v_dem.sale_order_id, v_dem.sale_order_item_id, v_line.product_id, v_debit,
        v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
        v_mov, 'corte_atelier', p_lot_id, v_res_id
      );

      v_lines := v_lines + 1;
      IF v_line.required - v_debit > 0 THEN
        v_pending := v_pending + 1;
      END IF;
    END LOOP;

    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = 'cut', cut_at = now(), updated_at = now()
     WHERE demand_id = v_dem.id AND pipeline_status = 'awaiting_cut';
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Lote % não tem itens aguardando corte', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_lots
     SET status = 'cut', cut_at = now(), cut_by = auth.uid(), updated_at = now()
   WHERE id = p_lot_id;

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'items', v_items, 'lines', v_lines, 'pending_lines', v_pending
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_cut(uuid) TO authenticated, service_role;

-- Envio passa a exigir corte.
CREATE OR REPLACE FUNCTION public.atelier_mark_job_sent(
  p_job_id uuid,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_num text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Corte o lote antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = COALESCE(p_contractor_id, contractor_id),
         atelier_service_number = v_num,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'atelier_service_number', v_num);
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid) TO authenticated, service_role;

-- ─── 9. Gate de fábrica: só bloqueia setor de rua que a ficha tem ──────────
CREATE OR REPLACE FUNCTION public.atelier_item_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref uuid;
  v_sectors text[];
  v_sec text;
  v_status text;
BEGIN
  SELECT soi.reference_id INTO v_ref FROM public.sale_order_items soi WHERE soi.id = p_item_id;
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;
  v_sectors := public.atelier_reference_street_sectors(v_ref);
  IF cardinality(v_sectors) = 0 THEN
    RETURN NULL;
  END IF;
  FOREACH v_sec IN ARRAY v_sectors LOOP
    SELECT j.pipeline_status INTO v_status
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = p_item_id
       AND j.sector = v_sec
       AND j.pipeline_status <> 'cancelled'
     ORDER BY j.updated_at DESC
     LIMIT 1;
    IF v_status IS DISTINCT FROM 'received_at_factory' THEN
      RETURN format(
        'Ateliê — %s só libera após o retorno do prestador (status: %s)',
        CASE v_sec WHEN 'costura_cabedal' THEN 'costura' ELSE 'aviamento' END,
        COALESCE(v_status, 'sem job — rode Reaplicar no Ateliê')
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_item_block_reason(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sale_order_item_factory_gate_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference_id uuid;
  v_reason text;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN 'item ausente';
  END IF;

  SELECT soi.reference_id INTO v_reference_id
    FROM public.sale_order_items soi
   WHERE soi.id = p_item_id;
  IF NOT FOUND THEN
    RETURN 'item nao encontrado';
  END IF;
  IF v_reference_id IS NULL THEN
    RETURN 'item sem referencia';
  END IF;

  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;

  RETURN public.sale_order_item_corte_material_gate_block_reason(p_item_id);
END;
$$;

COMMENT ON FUNCTION public.sale_order_item_factory_gate_block_reason(uuid) IS
  'Null = elegivel pra promote/liberacao de fabrica; texto = motivo (Ateliê v2 + material de corte).';

-- ─── 10. OP nasce com as etapas feitas pelo Ateliê já concluídas ───────────
CREATE OR REPLACE FUNCTION public.tg_atelier_stage_born_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_soi uuid;
  v_done boolean := false;
BEGIN
  IF COALESCE(NEW.status, '') = 'concluido'
     OR NEW.stage_name NOT IN ('Corte Cabedal', 'Costura Cabedal', 'Aviamento') THEN
    RETURN NEW;
  END IF;

  SELECT o.sale_order_item_id INTO v_soi FROM public.orders o WHERE o.id = NEW.order_id;
  IF v_soi IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_name = 'Corte Cabedal' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_soi
         AND j.pipeline_status IN ('cut', 'sent_to_contractor', 'received_at_factory')
    ) INTO v_done;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_soi
         AND j.pipeline_status = 'received_at_factory'
         AND j.sector = CASE NEW.stage_name
               WHEN 'Costura Cabedal' THEN 'costura_cabedal'
               ELSE 'aviamento'
             END
    ) INTO v_done;
  END IF;

  IF v_done THEN
    NEW.status := 'concluido';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.quantity_processed := COALESCE(NEW.quantity_total, NEW.quantity_processed);
    NEW.observations := concat_ws(' · ', NULLIF(NEW.observations, ''), 'Feito no Ateliê');
  END IF;
  RETURN NEW;
END;
$$;

-- Nome "trg_zz_…": roda DEPOIS do guarda trg_000_ (ordem alfabética).
DROP TRIGGER IF EXISTS trg_zz_atelier_stage_born_done ON public.order_stages;
CREATE TRIGGER trg_zz_atelier_stage_born_done
  BEFORE INSERT ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_stage_born_done();

-- ─── 11. Anti-2× na OP por ITEM ────────────────────────────────────────────
-- (a) gatilho antigo bloqueava a reserva da OP por (PV, produto) — inclusive de
--     itens FORA do Ateliê e do resto pendente. Fica só a regra pv_commitment.
CREATE OR REPLACE FUNCTION public.tg_block_op_reserve_if_atelier_debited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.metadata ->> 'kind', '') IN ('atelier_prep', 'pv_commitment') THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NOT NULL THEN
    SELECT o.sale_order_id INTO v_so FROM public.orders o WHERE o.id = NEW.order_id;
  END IF;
  IF v_so IS NULL AND NEW.sale_order_id IS NOT NULL THEN
    v_so := NEW.sale_order_id;
  END IF;
  IF v_so IS NULL AND NEW.metadata ? 'sale_order_id' THEN
    v_so := (NEW.metadata ->> 'sale_order_id')::uuid;
  END IF;
  IF v_so IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_reservations mr
     WHERE mr.product_id = NEW.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND mr.metadata ->> 'kind' = 'pv_commitment'
       AND mr.sale_order_id = v_so
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- (b) hybrid_debit: necessidade da OP − o que o Ateliê já debitou do item.
DO $patch_hybrid$
DECLARE
  v_def text;
  v_old text := $o$v_required := (v_item ->> 'required')::numeric;$o$;
  v_new text := $n$v_required := (v_item ->> 'required')::numeric;
      -- Ateliê v2: o item já levou este material no corte do lote.
      v_required := GREATEST(
        v_required - public.atelier_item_product_debited_qty(v_soi_id, (v_item ->> 'product_id')::uuid),
        0
      );$n$;
BEGIN
  SELECT pg_get_functiondef(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure
  ) INTO v_def;
  IF strpos(v_def, 'atelier_item_product_debited_qty') > 0 THEN
    RAISE NOTICE 'hybrid_debit já desconta Ateliê — skip';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 THEN
    RAISE EXCEPTION 'hybrid_debit: esperava 2 âncoras de v_required';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_hybrid$;

-- Linha zerada pelo desconto não deve virar reserva/débito de 0.
DO $patch_hybrid_zero$
DECLARE
  v_def text;
  v_old text := $o$    IF p_force_soft OR v_mode = 'soft' THEN$o$;
  v_new text := $n$    IF v_required <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', 0, 'type', 'atelier_already_debited'
      );
      CONTINUE;
    END IF;

    IF p_force_soft OR v_mode = 'soft' THEN$n$;
BEGIN
  SELECT pg_get_functiondef(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure
  ) INTO v_def;
  IF strpos(v_def, 'atelier_already_debited') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'hybrid_debit: âncora do ramo soft não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_hybrid_zero$;

-- ─── 12. Listagem de lotes p/ a fila ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_atelier_lots()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lots AS (
    SELECT l.*
      FROM public.atelier_lots l
     WHERE l.status <> 'cancelled'
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled'
       )
  ),
  items AS (
    SELECT d.lot_id,
           d.id AS demand_id,
           d.sale_order_item_id,
           d.pairs,
           d.ready_date,
           so.id AS sale_order_id,
           so.order_number,
           so.client_name,
           so.billing_week,
           soi.grade,
           GREATEST(COALESCE(soi.fichas, 1), 1) AS fichas
      FROM public.cabedal_prep_demands d
      JOIN lots ON lots.id = d.lot_id
      JOIN public.sale_orders so ON so.id = d.sale_order_id
      JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
     WHERE d.status <> 'cancelled'
  ),
  grade AS (
    SELECT i.lot_id, g.key AS size, SUM(COALESCE(NULLIF(g.value, '')::numeric, 0) * i.fichas) AS qty
      FROM items i
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.grade, '{}'::jsonb)) g
     GROUP BY i.lot_id, g.key
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY (row ->> 'min_ready_date') NULLS LAST, row ->> 'lot_number'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', l.id,
        'lot_number', l.lot_number,
        'status', l.status,
        'reference_id', l.reference_id,
        'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name),
        'reference_name', ts.name,
        'color', l.color,
        'material_variant_id', l.material_variant_id,
        'cut_at', l.cut_at,
        'pairs', (SELECT COALESCE(SUM(i.pairs), 0) FROM items i WHERE i.lot_id = l.id),
        'min_ready_date', (SELECT MIN(i.ready_date) FROM items i WHERE i.lot_id = l.id),
        'grade', (SELECT COALESCE(jsonb_object_agg(g.size, g.qty), '{}'::jsonb)
                    FROM grade g WHERE g.lot_id = l.id AND g.qty > 0),
        'orders', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                      'sale_order_id', i.sale_order_id,
                      'order_number', i.order_number,
                      'client_name', i.client_name,
                      'billing_week', i.billing_week)), '[]'::jsonb)
                     FROM items i WHERE i.lot_id = l.id),
        'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', j.id,
                    'sector', j.sector,
                    'pipeline_status', j.pipeline_status,
                    'pairs', j.pairs,
                    'sale_order_item_id', j.sale_order_item_id,
                    'order_number', so.order_number,
                    'contractor_id', j.contractor_id,
                    'contractor_name', c.name,
                    'atelier_service_number', j.atelier_service_number,
                    'target_end', j.target_end
                  ) ORDER BY j.sector, so.order_number), '[]'::jsonb)
                   FROM public.cabedal_prep_jobs j
                   JOIN public.sale_orders so ON so.id = j.sale_order_id
                   LEFT JOIN public.contractors c ON c.id = j.contractor_id
                  WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled'),
        'debits', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'product_id', s.product_id,
                     'product_name', p.name,
                     'unit', p.unit,
                     'component', s.component,
                     'quantity', s.quantity,
                     'pending_qty', s.pending_qty
                   ) ORDER BY p.name), '[]'::jsonb)
                    FROM public.cabedal_prep_stock_debits s
                    JOIN public.products p ON p.id = s.product_id
                   WHERE s.lot_id = l.id)
      ) AS row
      FROM lots l
      JOIN public.technical_sheets ts ON ts.id = l.reference_id
    ) x;
$$;

GRANT EXECUTE ON FUNCTION public.list_atelier_lots() TO authenticated, service_role;

-- Prévia do kit (antes do corte): necessidade por produto do lote × estoque.
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_preview(p_lot_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  component text,
  required numeric,
  available numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lot AS (SELECT * FROM public.atelier_lots WHERE id = p_lot_id),
  comps AS (
    SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) AS c
      FROM public.atelier_complex_references a, lot
      CROSS JOIN LATERAL unnest(
        COALESCE(a.material_components, public.atelier_default_kit_components(a.sector))
      ) c
     WHERE a.reference_id = lot.reference_id
       AND a.active
       AND a.sector = ANY (public.atelier_reference_street_sectors(lot.reference_id))
  ),
  dems AS (
    SELECT DISTINCT d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id AND d.status <> 'cancelled'
  ),
  so AS (SELECT DISTINCT sale_order_id FROM dems)
  SELECT l.product_id, p.name, p.unit, min(l.component), sum(l.required)::numeric,
         GREATEST(COALESCE(p.quantity, 0), 0)
    FROM so
    CROSS JOIN LATERAL public.sale_order_material_demand_lines(so.sale_order_id) l
    JOIN dems ON dems.sale_order_item_id = l.sale_order_item_id
    JOIN public.products p ON p.id = l.product_id
    CROSS JOIN comps
   WHERE l.component = ANY (comps.c)
   GROUP BY l.product_id, p.name, p.unit, p.quantity
   ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_preview(uuid) TO authenticated, service_role;

-- ─── 12b. Kanban: novos status ──────────────────────────────────────────────
-- atelier_job_status_for_order_sector (29100) continua válido: só lê pipeline_status.

-- ─── 13. Antecipação não volta por dado (R7.25) ─────────────────────────────
ALTER TABLE public.sector_settings
  DROP CONSTRAINT IF EXISTS sector_settings_atelier_no_early_release;
ALTER TABLE public.sector_settings
  ADD CONSTRAINT sector_settings_atelier_no_early_release
  CHECK (sector NOT IN ('Costura Cabedal', 'Aviamento') OR COALESCE(start_offset_days, 0) = 0);

-- ─── 14. Dados do dono (D3, D4) ─────────────────────────────────────────────
-- I704: Costura → Aviamento (ficha sem cabedal; tem aviamento + tiras).
UPDATE public.atelier_complex_references a
   SET active = false
  FROM public.technical_sheets ts
 WHERE ts.id = a.reference_id
   AND ts.name = 'I704'
   AND a.sector = 'costura_cabedal';

INSERT INTO public.atelier_complex_references (reference_id, sector, active, notes)
SELECT ts.id, 'aviamento', true, 'Movida de Costura (ficha sem cabedal) — 10/10/2026'
  FROM public.technical_sheets ts
 WHERE ts.name = 'I704'
   AND public.atelier_sheet_supports_sector(ts.id, 'aviamento')
ON CONFLICT (reference_id, sector) DO UPDATE SET active = true, updated_at = now();

-- BT01/BT02: vêm da aba Terceirizados da ficha com valor/par e kit.
-- reference_terceirizacoes fica intacta (custeio lê value_per_pair dela).
INSERT INTO public.atelier_complex_references (
  reference_id, sector, active, value_per_pair, material_components, notes
)
SELECT rt.reference_id,
       'costura_cabedal',
       true,
       rt.value_per_pair,
       CASE WHEN rt.material_components IS NOT NULL
                 AND cardinality(rt.material_components) > 0
            THEN rt.material_components END,
       'Migrada da aba Terceirizados da ficha — 10/10/2026'
  FROM public.reference_terceirizacoes rt
 WHERE rt.active
   AND rt.sector = 'costura'
   AND public.atelier_sheet_supports_sector(rt.reference_id, 'costura_cabedal')
ON CONFLICT (reference_id, sector) DO UPDATE SET
  active = true,
  value_per_pair = COALESCE(public.atelier_complex_references.value_per_pair, EXCLUDED.value_per_pair),
  material_components = COALESCE(public.atelier_complex_references.material_components, EXCLUDED.material_components),
  updated_at = now();

-- Rematerializa o que estiver aberto.
SELECT public.reapply_atelier_eligibility();
