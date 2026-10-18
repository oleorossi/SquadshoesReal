-- Ateliê: puxar cabedal complexo mesmo com OP viva.
--
-- O guard "já virou OP sem Ateliê não volta pra rua" impedia criar demanda/jobs
-- quando a ref entrava no catálogo DEPOIS da promoção (caso SP301 / PV-00237):
-- item ficava impedido ("sem job") e a fila/relatório vazios. Reaplicar chamava
-- a mesma função e também pulava.
--
-- Decisão do dono: item com OP viva + ref no Ateliê ENTRA na fila; gate segue
-- travando até done (interno) / received_at_factory (prestador). Ao marcar a
-- ficha, materializa PVs Aprovado/Em Produção dessa ref.

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
           ts.assembly_capacity_per_day
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

    -- Cabedal complexo no catálogo: cria/atualiza demanda mesmo com OP viva.
    -- Gate (atelier_item_block_reason) continua impedindo apontamento até
    -- done/received_at_factory — a fila é o que falta pra esses setores irem à frente.

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

-- Ao marcar/desmarcar setor no cadastro Ateliê, rematerializa PVs vivos dessa ref.
CREATE OR REPLACE FUNCTION public.tg_atelier_catalog_rematerialize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref uuid := COALESCE(NEW.reference_id, OLD.reference_id);
  r record;
BEGIN
  IF v_ref IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR r IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND soi.reference_id = v_ref
       AND soi.production_excluded_at IS NULL
       AND COALESCE(soi.quantity, 0) > 0
  LOOP
    PERFORM public.materialize_cabedal_prep_demands(r.id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_catalog_rematerialize ON public.atelier_complex_references;
CREATE TRIGGER trg_atelier_catalog_rematerialize
  AFTER INSERT OR UPDATE OR DELETE ON public.atelier_complex_references
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_catalog_rematerialize();

COMMENT ON FUNCTION public.tg_atelier_catalog_rematerialize() IS
  'Após mudança no catálogo Ateliê, rematerializa demandas/jobs dos PVs Aprovado/Em Produção daquela referência.';

-- Backfill: SP301 e qualquer órfão da mesma classe.
SELECT public.reapply_atelier_eligibility();
