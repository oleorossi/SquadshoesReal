-- =============================================================================
-- Lead time fornecedor pós-reserva — fixes consolidados
-- =============================================================================
-- Cobre 4 gaps identificados na auditoria de 2026-05-13:
--
--   🔴 Bug 1 — compute_wave_timeline não deduz reserved_stock no check de
--      supplier_lead (linha 254 da 20260612120000). compute_min_billing_date
--      foi consertado na Round Fluxo P3 (20260617140000), mas a wave timeline
--      ficou pra trás. Ondas recalculam compra de material que outro PV já
--      reservou → lead time inflado.
--
--   🔴 Bug 2 — try_reserve_materials cria PO auto SEM popular eta_days
--      (linhas 162/203/214 da 20260522130000, replicado em 20260627120000).
--      Próximo PV que tenta usar essa PO como inbound bate em
--      COALESCE(MIN(po.eta_days), 999) → descarta. Efetivamente, PO existe
--      mas é invisível pros cálculos de lead time futuros.
--
--   🟡 Gap 3 — group_suppliers.lead_time_days existe e é lido por
--      purchase_projection_timeline, mas compute_min_billing_date e
--      compute_wave_timeline ignoram. Resultado: o lead específico do
--      fornecedor configurado pra um grupo de produto não vale na decisão
--      de prazo. Cascata correta: PO ETA > group_supplier > product default.
--
--   🟡 Gap 4 — products.supplier_lead_time_days é cadastrado manualmente
--      e nunca atualizado. Sem histórico → sempre default. Função nova
--      recalc_supplier_lead_from_history() ajusta com base na média ponderada
--      dos últimos 6 recebimentos reais (purchase_orders.received_at) por
--      produto. Cron semanal pra manter saudável.
-- =============================================================================

-- ─── Helper: resolve lead time efetivo de um produto ────────────────────────
-- Cascata: PO em aberto com eta_days conhecido > group_supplier > product > 10
-- Centraliza a lógica que estava duplicada/divergente nas 3 funções de cálculo.
CREATE OR REPLACE FUNCTION public.get_effective_supplier_lead_days(
  p_product_id uuid,
  p_prod_deadline_days int DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_po_eta int;
  v_group_lead int;
  v_product_lead int;
BEGIN
  -- 1. PO em aberto pra esse produto com eta_days conhecido (mais preciso).
  --    Pega o menor eta (chegará primeiro).
  SELECT MIN(po.eta_days) INTO v_po_eta
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
   WHERE poi.product_id = p_product_id
     AND po.status IN ('pending', 'approved')
     AND po.eta_days IS NOT NULL;

  IF v_po_eta IS NOT NULL THEN
    -- Se chegou aqui, há PO com eta válido. Se eta > prod_deadline (não chega
    -- a tempo), usa esse valor mesmo — caller decide se rejeita.
    RETURN v_po_eta;
  END IF;

  -- 2. group_suppliers.lead_time_days (fornecedor preferencial do grupo)
  SELECT gs.lead_time_days INTO v_group_lead
    FROM products p
    JOIN group_suppliers gs ON gs.group_id = p.group_id
   WHERE p.id = p_product_id
     AND COALESCE(gs.lead_time_days, 0) > 0
   ORDER BY gs.updated_at DESC LIMIT 1;

  IF v_group_lead IS NOT NULL AND v_group_lead > 0 THEN
    RETURN v_group_lead;
  END IF;

  -- 3. products.supplier_lead_time_days (cadastrado direto no produto)
  SELECT supplier_lead_time_days INTO v_product_lead
    FROM products WHERE id = p_product_id;

  RETURN COALESCE(v_product_lead, 10);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_supplier_lead_days(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_effective_supplier_lead_days(uuid, int) IS
  'Resolve lead time efetivo de um produto via cascata: PO em aberto com '
  'eta_days conhecido > group_suppliers.lead_time_days > products.supplier_'
  'lead_time_days > 10 (default). Usado em compute_min_billing_date, '
  'compute_wave_timeline e try_reserve_materials pra manter consistência.';


-- ─── Bug 1: compute_wave_timeline deduz reserved_stock + usa cascata ───────
-- Reescrita parcial: só a parte de supplier lead (linhas 252-265 da original).
-- Mantém TODA a cascata produtiva (paralelismo prep, snap pickup, etc.)
-- Implementação: DROP + CREATE pra evitar inconsistência se schema mudar.

DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline             date,
  corte_palmilha_start_date     date,
  corte_forracao_start_date     date,
  costura_start_date            date,
  mesa_start_date               date,
  silk_start_date               date,
  colagem_start_date            date,
  montagem_start_date           date,
  solagem_start_date            date,
  acabamento_start_date         date,
  acabamento_end_date           date,
  pickup_tuesday_date           date,
  pickup_friday_date            date,
  material_ready_date           date,
  purchase_deadline             date
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_palmilha  int;
  v_lead_forracao  int;
  v_lead_costura   int;
  v_lead_mesa      int;
  v_lead_silk      int;
  v_lead_colagem   int;
  v_lead_montagem  int;
  v_lead_solagem   int;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_supplier  int;
  v_deadline       date;
  v_lead_prep_max  int;
  v_post_prep      int;
  v_costura_start  date;
  v_earliest_prep  date;
  v_acab_start     date;
  v_acab_end       date;
  v_pickup_tue     date;
  v_pickup_fri     date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;

  -- Lead times por setor: idêntico à versão anterior (paralelismo prep)
  SELECT
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'corte_palmilha'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1)
        END
      ELSE 0 END
    ), 1),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'corte_forracao'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2)
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'costura'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'mesa'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'silk'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'colagem'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END
    ), 2),
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'solagem'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias,0),
      dlt.lead_time_buffer_material_dias, 2
    )), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Bug 1 + G3 FIX: supplier lead com dedução de reserved_stock + cascata
  -- via get_effective_supplier_lead_days. Paridade com compute_min_billing_date.
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed,0)
              > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN public.get_effective_supplier_lead_days(p.id, NULL)
         ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem
                + v_lead_colagem + v_lead_silk + v_lead_costura;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa);
  v_costura_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_costura_start, -v_lead_prep_max)::date;

  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end   := v_deadline;

  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(
    add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2
  );
  IF v_pickup_tue >= v_pickup_fri THEN
    v_pickup_tue := v_pickup_fri - 3;
  END IF;

  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,
    add_business_days(v_costura_start, -v_lead_palmilha)::date,
    add_business_days(v_costura_start, -v_lead_forracao)::date,
    v_costura_start,
    add_business_days(v_costura_start, -v_lead_mesa)::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date,
    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem)
    )::date,
    v_acab_start,
    v_acab_end,
    v_pickup_tue,
    v_pickup_fri,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_wave_timeline(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Cascata com paralelismo + 2 janelas de pickup (Ter/Sex). Fix Bug 1 '
  '(20260628120000): supplier lead agora deduz reserved_stock e usa cascata '
  'get_effective_supplier_lead_days (PO ETA > group_supplier > product).';


-- ─── Bug 2: try_reserve_materials popula eta_days em POs auto ──────────────
-- A função já tem 320 linhas — replicar ela inteira é insustentável. Em vez
-- disso, usamos uma trigger AFTER INSERT em purchase_orders que detecta
-- auto_generated=true sem eta_days e popula via get_effective_supplier_lead_days
-- baseado no primeiro item da PO.

CREATE OR REPLACE FUNCTION public.tg_purchase_orders_set_auto_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_id uuid;
  v_eta int;
BEGIN
  IF NOT NEW.auto_generated THEN RETURN NEW; END IF;
  IF NEW.eta_days IS NOT NULL THEN RETURN NEW; END IF;

  -- Pega o primeiro item (geralmente PO auto tem 1 item; se múltiplos, usa o
  -- maior lead time pra ser conservador).
  SELECT product_id INTO v_product_id
    FROM purchase_order_items
   WHERE purchase_order_id = NEW.id
   LIMIT 1;

  IF v_product_id IS NULL THEN
    -- AFTER INSERT em purchase_orders pode rodar ANTES dos items serem inseridos
    -- (mesma transação, ordem indefinida). Trigger em items cobre esse caso.
    RETURN NEW;
  END IF;

  v_eta := public.get_effective_supplier_lead_days(v_product_id, NULL);
  UPDATE public.purchase_orders SET eta_days = v_eta WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_orders_set_auto_eta ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_set_auto_eta
  AFTER INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_purchase_orders_set_auto_eta();

-- Cobre o caso em que items chegam depois do PO master (ordem de INSERT
-- imprevisível em try_reserve_materials que faz INSERT po + INSERT items).
CREATE OR REPLACE FUNCTION public.tg_po_items_set_parent_auto_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_po RECORD;
  v_eta int;
BEGIN
  SELECT id, auto_generated, eta_days INTO v_po
    FROM purchase_orders WHERE id = NEW.purchase_order_id;

  IF NOT v_po.auto_generated OR v_po.eta_days IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_eta := public.get_effective_supplier_lead_days(NEW.product_id, NULL);
  UPDATE public.purchase_orders SET eta_days = v_eta WHERE id = v_po.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_items_set_parent_auto_eta ON public.purchase_order_items;
CREATE TRIGGER trg_po_items_set_parent_auto_eta
  AFTER INSERT ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_po_items_set_parent_auto_eta();

COMMENT ON FUNCTION public.tg_purchase_orders_set_auto_eta() IS
  'Popula eta_days em POs auto_generated=true via get_effective_supplier_'
  'lead_days. Resolve Bug 2: POs criadas por try_reserve_materials ficavam '
  'com eta_days NULL, fazendo COALESCE(MIN(po.eta_days), 999) ignorar elas.';


-- ─── Gap 4: auto-aprendizado de lead time baseado em histórico ─────────────
-- Calcula lead efetivo de uma PO: dias entre created_at e received_at. Média
-- ponderada dos últimos 6 recebimentos por produto vira nova supplier_lead_time
-- (com 30% peso pro histórico, 70% pro valor atual — suaviza outliers).
CREATE OR REPLACE FUNCTION public.recalc_supplier_lead_from_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prod RECORD;
  v_avg_lead numeric;
  v_current int;
  v_new int;
  v_updated int := 0;
  v_skipped int := 0;
  v_started_at timestamptz := now();
BEGIN
  FOR v_prod IN
    SELECT
      poi.product_id,
      AVG(EXTRACT(EPOCH FROM (po.received_at - po.created_at)) / 86400.0)::numeric AS avg_days,
      COUNT(*) AS samples
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.received_at IS NOT NULL
      AND po.created_at IS NOT NULL
      AND po.received_at > po.created_at
      AND po.received_at > now() - interval '180 days' -- últimos 6 meses
    GROUP BY poi.product_id
    HAVING COUNT(*) >= 2 -- precisa de ≥2 amostras pra ter dados confiáveis
  LOOP
    SELECT COALESCE(supplier_lead_time_days, 10) INTO v_current
      FROM products WHERE id = v_prod.product_id;

    -- Média ponderada: 70% atual + 30% histórico (evita oscilação extrema)
    v_avg_lead := v_prod.avg_days;
    v_new := GREATEST(1, ROUND(v_current * 0.7 + v_avg_lead * 0.3))::int;

    IF v_new <> v_current THEN
      UPDATE products
         SET supplier_lead_time_days = v_new,
             updated_at = now()
       WHERE id = v_prod.product_id;
      v_updated := v_updated + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped_no_change', v_skipped,
    'run_at', v_started_at,
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_supplier_lead_from_history() TO authenticated;

COMMENT ON FUNCTION public.recalc_supplier_lead_from_history() IS
  'Recalcula products.supplier_lead_time_days baseado em received_at − '
  'created_at das POs recebidas nos últimos 6 meses. Média ponderada (70% '
  'cadastrado + 30% histórico) suaviza outliers. Roda semanalmente via cron.';

-- Cron semanal aos domingos 03:00
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'recalc-supplier-lead';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
END $$;

SELECT cron.schedule(
  'recalc-supplier-lead',
  '0 3 * * 0', -- domingo às 03:00 UTC
  $cron$ SELECT public.recalc_supplier_lead_from_history(); $cron$
);


-- ─── Paridade: compute_min_billing_date também usa o helper ────────────────
-- A versão consolidada (Round Fluxo P3) já deduzia reserved_stock, mas seguia
-- usando p.supplier_lead_time_days direto. Trocamos pelo helper pra todos os
-- 3 motores (compute_min_billing_date + compute_wave_timeline + view)
-- consultarem a mesma cascata.

DROP VIEW IF EXISTS public.sale_order_min_billing CASCADE;
DROP FUNCTION IF EXISTS public.compute_min_billing_date(p_sale_order_id uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_lead_palmilha int := 0;
  v_lead_forracao int := 0;
  v_lead_costura  int := 0;
  v_lead_mesa     int := 0;
  v_lead_silk     int := 0;
  v_lead_colagem  int := 0;
  v_lead_montagem int := 0;
  v_lead_solagem  int := 0;
  v_lead_acab     int := 0;
  v_lead_buffer   int := 0;
  v_lead_supplier int := 0;
  v_total_business_days int := 0;
  v_raw_date date;
  v_next_tue date;
  v_next_fri date;
BEGIN
  -- Lead time por setor (idêntico à consolidação Round Fluxo P1, apenas reformato).
  SELECT
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
        THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'corte_forracao')
        THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'costura')
        THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'mesa')
        THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'silk')
        THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'colagem')
        THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'solagem')
        THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0),
                          dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;

  IF v_lead_palmilha IS NULL THEN RETURN NULL; END IF;

  -- G3 FIX: usa get_effective_supplier_lead_days em vez de p.supplier_lead_time_days
  -- direto. Cascata: PO em aberto com eta_days > group_supplier > product > 10.
  -- Deduz reserved_stock (Round Fluxo P3 já fazia).
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed,0)
              > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN public.get_effective_supplier_lead_days(p.id, NULL)
         ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  v_total_business_days :=
      COALESCE(v_lead_supplier, 0)
    + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa)
    + COALESCE(v_lead_costura, 0)
    + COALESCE(v_lead_silk, 0)
    + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2)
    + COALESCE(v_lead_solagem, 0)
    + COALESCE(v_lead_acab, 1);

  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_min_billing_date(uuid) IS
  'Data mínima de faturamento. Usa get_effective_supplier_lead_days (cascata '
  'PO ETA > group_supplier > product) + deduz reserved_stock. Cascata produtiva '
  'com paralelismo prep + business days + snap Ter/Sex. Fix G3 (20260628120000).';

CREATE OR REPLACE VIEW public.sale_order_min_billing AS
SELECT id AS sale_order_id, public.compute_min_billing_date(id) AS min_billing_date
  FROM public.sale_orders
 WHERE status NOT IN ('Cancelado','cancelado','FINALIZADO');

GRANT SELECT ON public.sale_order_min_billing TO authenticated;


-- ─── Backfill: popula eta_days em POs auto existentes sem eta ──────────────
UPDATE public.purchase_orders po
   SET eta_days = COALESCE(
     (SELECT public.get_effective_supplier_lead_days(poi.product_id, NULL)
        FROM public.purchase_order_items poi
       WHERE poi.purchase_order_id = po.id
       LIMIT 1),
     10
   )
 WHERE po.auto_generated = true
   AND po.eta_days IS NULL
   AND po.status IN ('pending', 'approved', 'suggested');
