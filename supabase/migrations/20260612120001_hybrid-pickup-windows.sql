-- =============================================================================
-- Modelo Híbrido: Onda Semanal com 2 Janelas de Pickup (Terça + Sexta)
-- =============================================================================
-- Decisão de produto: a fábrica passa a operar como "two-tide week":
--   • A onda mantém o ciclo semanal (segunda a domingo).
--   • Itens são agrupados em blocos `solado × cor` para minimizar setup de
--     silk/injetora/cola (eficiência da Opção 1 — Color Block).
--   • Os blocos são ordenados pelo prazo MAIS CEDO entre seus PVs (eficiência
--     da Opção 2 — JIT).
--   • Em vez de uma única expedição na sexta, criamos DUAS janelas de pickup:
--       - Janela TERÇA: o que ficar pronto até segunda-feira EOD.
--       - Janela SEXTA: o que ficar pronto até quinta-feira EOD.
--     → o caixa começa a entrar na terça (não só na sexta).
--
-- Estruturas adicionadas:
--   1. production_waves: `pickup_tuesday_date`, `pickup_friday_date`.
--   2. production_wave_items: `block_key`, `block_sequence`, `pickup_window`.
--   3. compute_wave_timeline: retorna 2 datas de pickup (snap p/ Ter/Sex
--      após acabamento finalizar).
--   4. update_wave_timeline: persiste pickups + atribui `pickup_window` por
--      item (50/50 dos pares ordenados por prazo+bloco).
--   5. compute_min_billing_date: snap pra próxima janela viável (Ter/Sex).
--   6. v_order_pickup_window: kanban e fichas leem janela de pickup por OP.
--   7. get_wave_pickup_summary: agregado por janela pra UI.
-- =============================================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS pickup_tuesday_date date,
  ADD COLUMN IF NOT EXISTS pickup_friday_date  date;

COMMENT ON COLUMN public.production_waves.pickup_tuesday_date IS
  'Data da janela de pickup TERÇA — pares finalizados até segunda EOD saem aqui.';
COMMENT ON COLUMN public.production_waves.pickup_friday_date IS
  'Data da janela de pickup SEXTA — pares finalizados até quinta EOD saem aqui.';

DO $$ BEGIN
  CREATE TYPE pickup_window_enum AS ENUM ('tuesday', 'friday');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.production_wave_items
  ADD COLUMN IF NOT EXISTS block_key       text,
  ADD COLUMN IF NOT EXISTS block_sequence  integer,
  ADD COLUMN IF NOT EXISTS pickup_window   pickup_window_enum;

COMMENT ON COLUMN public.production_wave_items.block_key IS
  'Chave do bloco para agrupamento (sole_product_id + cor). Itens com mesmo '
  'block_key compartilham setup de máquina.';
COMMENT ON COLUMN public.production_wave_items.block_sequence IS
  'Ordem de execução dentro da onda. Calculada por update_wave_timeline a '
  'partir do prazo mais cedo entre os PVs do bloco.';
COMMENT ON COLUMN public.production_wave_items.pickup_window IS
  'Janela de pickup atribuída ao item: tuesday | friday. Itens early '
  '(50% dos pares ordenados por prazo) caem em tuesday.';

-- Backfill block_key dos items existentes
UPDATE public.production_wave_items
   SET block_key = COALESCE(sole_product_id::text,'no-sole') || '|' || COALESCE(NULLIF(color,''),'sem-cor')
 WHERE block_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_wave_items_pickup
  ON public.production_wave_items(wave_id, pickup_window, block_sequence);


-- ── 2. Helpers de data ───────────────────────────────────────────────────────

-- Próximo dia da semana (1=Mon..5=Fri) >= base_date.
DROP FUNCTION IF EXISTS public.next_dow(base_date date, target_dow int);
CREATE OR REPLACE FUNCTION public.next_dow(base_date date, target_dow int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT base_date + ((target_dow - EXTRACT(ISODOW FROM base_date)::int + 7) % 7);
$$;

COMMENT ON FUNCTION public.next_dow(date, int) IS
  'Retorna a próxima data com EXTRACT(ISODOW)=target_dow (1=Seg..7=Dom), '
  'incluindo a própria base_date se ela for o dia certo.';


-- ── 3. compute_wave_timeline (retorna pickups) ───────────────────────────────

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
LANGUAGE plpgsql STABLE AS $$
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

  SELECT
    -- Corte Palmilha
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
    -- Corte Forração
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
    -- Costura
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
    -- Mesa/Aviamento
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
    -- Silk
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
    -- Colagem
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
    -- Montagem
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END
    ), 2),
    -- Solagem
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
    -- Acabamento
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    -- Buffer
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

  -- Supplier lead time
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed,0) > COALESCE(p.quantity,0)
         THEN COALESCE(p.supplier_lead_time_days,10) ELSE 0 END
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

  -- Janelas de pickup: SEXTA é a 1ª sexta-feira ≥ acabamento_end (deadline da onda).
  -- TERÇA é a 1ª terça-feira ≥ (acabamento_start + metade do lead_acab) — ou seja,
  -- quando metade dos itens já estaria pronta. Nunca antes do acabamento começar +1.
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(
    add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2
  );
  -- Garante TERÇA antes da SEXTA: se TERÇA caiu depois (raro com lead_acab=1),
  -- recua pra terça da semana anterior à sexta.
  IF v_pickup_tue >= v_pickup_fri THEN
    v_pickup_tue := v_pickup_fri - 3; -- Sexta − 3 = Terça
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
  'Cascata com paralelismo + 2 janelas de pickup (Ter/Sex). pickup_friday é a '
  'primeira sexta ≥ deadline da onda. pickup_tuesday é a primeira terça ≥ '
  '(acabamento_start + lead_acab/2), garantida menor que sexta.';


-- ── 4. update_wave_timeline (persiste pickups + atribui janelas por item) ───

DROP FUNCTION IF EXISTS public.update_wave_timeline(uuid);

CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl record;
  v_total_pairs numeric;
  v_running_pairs numeric := 0;
  v_half_pairs numeric;
  v_item record;
  v_seq int := 0;
BEGIN
  -- 1. Recupera PVs vinculados à onda
  SELECT array_agg(DISTINCT wis.sale_order_id) INTO v_sale_order_ids
    FROM production_wave_item_sources wis
    JOIN production_wave_items wi ON wi.id = wis.wave_item_id
   WHERE wi.wave_id = p_wave_id AND wis.sale_order_id IS NOT NULL;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids,1) IS NULL THEN
    RETURN;
  END IF;

  -- 2. Calcula timeline
  SELECT * INTO v_tl FROM public.compute_wave_timeline(v_sale_order_ids) LIMIT 1;
  IF v_tl IS NULL OR v_tl.earliest_deadline IS NULL THEN
    RETURN;
  END IF;

  -- 3. Persiste timeline na onda (incluindo pickups)
  UPDATE public.production_waves
     SET earliest_deadline         = v_tl.earliest_deadline,
         purchase_deadline         = v_tl.purchase_deadline,
         material_ready_date       = v_tl.material_ready_date,
         corte_palmilha_start_date = v_tl.corte_palmilha_start_date,
         corte_forracao_start_date = v_tl.corte_forracao_start_date,
         costura_start_date        = v_tl.costura_start_date,
         mesa_start_date           = v_tl.mesa_start_date,
         silk_start_date           = v_tl.silk_start_date,
         colagem_start_date        = v_tl.colagem_start_date,
         montagem_start_date       = v_tl.montagem_start_date,
         solagem_start_date        = v_tl.solagem_start_date,
         acabamento_start_date     = v_tl.acabamento_start_date,
         pickup_tuesday_date       = v_tl.pickup_tuesday_date,
         pickup_friday_date        = v_tl.pickup_friday_date,
         updated_at                = now()
   WHERE id = p_wave_id;

  -- 4. Sequencia blocos (solado×cor) por prazo mais cedo entre seus PVs.
  --    Itens com mesmo block_key ficam adjacentes (eficiência de setup).
  WITH block_priority AS (
    SELECT
      wi.id AS item_id,
      wi.block_key,
      MIN(so.delivery_deadline) AS block_earliest_deadline,
      SUM(wis.quantity) OVER (PARTITION BY wi.block_key) AS block_pairs
    FROM production_wave_items wi
    JOIN production_wave_item_sources wis ON wis.wave_item_id = wi.id
    LEFT JOIN sale_orders so ON so.id = wis.sale_order_id
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.id, wi.block_key, wis.quantity
  ),
  block_min AS (
    SELECT block_key, MIN(block_earliest_deadline) AS earliest
      FROM block_priority
     GROUP BY block_key
  ),
  ordered AS (
    SELECT
      wi.id AS item_id,
      ROW_NUMBER() OVER (
        ORDER BY bm.earliest NULLS LAST,
                 wi.block_key,
                 wi.total_quantity DESC,
                 wi.id
      ) AS seq
    FROM production_wave_items wi
    LEFT JOIN block_min bm ON bm.block_key = wi.block_key
    WHERE wi.wave_id = p_wave_id
  )
  UPDATE production_wave_items wi
     SET block_sequence = ordered.seq
    FROM ordered
   WHERE wi.id = ordered.item_id;

  -- 5. Atribui pickup_window: 50% dos pares (cumulativos por sequência)
  --    caem em TUESDAY, restante em FRIDAY. Mantém blocos íntegros.
  SELECT SUM(total_quantity) INTO v_total_pairs
    FROM production_wave_items WHERE wave_id = p_wave_id;
  v_half_pairs := COALESCE(v_total_pairs,0) / 2;

  v_running_pairs := 0;
  FOR v_item IN
    SELECT id, total_quantity, block_sequence
      FROM production_wave_items
     WHERE wave_id = p_wave_id
     ORDER BY block_sequence NULLS LAST, id
  LOOP
    v_running_pairs := v_running_pairs + COALESCE(v_item.total_quantity,0);
    UPDATE production_wave_items
       SET pickup_window = CASE
             WHEN v_running_pairs <= v_half_pairs OR v_total_pairs <= 0
                  THEN 'tuesday'::pickup_window_enum
             ELSE 'friday'::pickup_window_enum
           END
     WHERE id = v_item.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_wave_timeline(uuid) TO authenticated;

COMMENT ON FUNCTION public.update_wave_timeline(uuid) IS
  'Persiste timeline (incluindo pickup_tuesday/friday) + sequencia blocos '
  'por prazo + atribui pickup_window aos items: 50% pares iniciais → tuesday, '
  'resto → friday. Mantém blocos solado×cor íntegros (não fatia bloco entre janelas).';


-- ── 5. compute_min_billing_date com snap pra Ter/Sex ─────────────────────────

DROP VIEW IF EXISTS public.sale_order_min_billing CASCADE;
DROP FUNCTION IF EXISTS public.compute_min_billing_date(p_sale_order_id uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_total_days integer := 0;
  v_max_supplier_lead integer := 0;
  v_buffer_material integer := 2;
  v_corte integer := 0;
  v_costura integer := 0;
  v_montagem integer := 0;
  v_acabamento integer := 0;
  v_raw_date date;
  v_next_tue date;
  v_next_fri date;
BEGIN
  SELECT
    COALESCE(MAX(
      CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
      END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
      END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
      END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day))::integer)
        ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
      END
    ), 0),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), MAX(dlt.lead_time_buffer_material_dias), 2)
  INTO v_corte, v_costura, v_montagem, v_acabamento, v_buffer_material
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
   WHERE o.sale_order_id = p_sale_order_id
     AND o.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO', 'Pronto');

  SELECT COALESCE(MAX(p.supplier_lead_time_days), 7)
    INTO v_max_supplier_lead
    FROM public.orders o
    JOIN public.sheet_materials sm ON sm.sheet_id = o.reference_id
    JOIN public.products p ON p.id = sm.product_id
   WHERE o.sale_order_id = p_sale_order_id
     AND o.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO', 'Pronto');

  v_total_days := COALESCE(v_max_supplier_lead, 7)
                + COALESCE(v_buffer_material, 2)
                + COALESCE(v_corte, 2)
                + COALESCE(v_costura, 3)
                + COALESCE(v_montagem, 2)
                + COALESCE(v_acabamento, 1);

  v_raw_date := CURRENT_DATE + v_total_days;

  -- Snap pra próxima janela de pickup viável (Ter ou Sex, o que vier antes).
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_min_billing_date(uuid) IS
  'Data mínima de faturamento alinhada às janelas de pickup. Calcula '
  'lead time bruto (compra + buffer + setores) e arredonda pra próxima '
  'terça ou sexta — o que vier antes.';

CREATE OR REPLACE VIEW public.sale_order_min_billing
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.delivery_deadline,
  so.manual_billing_override,
  so.original_min_billing_date,
  public.compute_min_billing_date(so.id) AS min_billing_date
FROM public.sale_orders so
WHERE so.status NOT IN ('Cancelado', 'cancelado', 'Faturado', 'faturado');

GRANT SELECT ON public.sale_order_min_billing TO authenticated, anon;


-- ── 6. View pra Kanban: pickup_window por OP ─────────────────────────────────

DROP VIEW IF EXISTS public.v_order_pickup_window CASCADE;
CREATE OR REPLACE VIEW public.v_order_pickup_window
WITH (security_invoker = true) AS
SELECT DISTINCT ON (o.id)
  o.id              AS order_id,
  o.sale_order_id,
  wi.wave_id,
  wi.pickup_window,
  wi.block_key,
  wi.block_sequence,
  pw.pickup_tuesday_date,
  pw.pickup_friday_date,
  CASE wi.pickup_window
    WHEN 'tuesday' THEN pw.pickup_tuesday_date
    WHEN 'friday'  THEN pw.pickup_friday_date
    ELSE NULL
  END AS pickup_date
FROM public.orders o
JOIN public.production_wave_item_sources wis ON wis.sale_order_id = o.sale_order_id
JOIN public.production_wave_items wi          ON wi.id = wis.wave_item_id
JOIN public.production_waves pw               ON pw.id = wi.wave_id
WHERE pw.status IN ('draft','planning','running')
ORDER BY o.id, wi.block_sequence NULLS LAST;

GRANT SELECT ON public.v_order_pickup_window TO authenticated;

COMMENT ON VIEW public.v_order_pickup_window IS
  'Janela de pickup atribuída a cada OP via sua sale_order → wave_item. '
  'Usar pra mostrar badge "Pickup Ter/Sex" no Kanban e fichas de operador. '
  'DISTINCT ON garante 1 linha por OP (mesmo se o PV tem múltiplos itens).';


-- ── 7. Resumo agregado por janela de pickup ──────────────────────────────────

DROP FUNCTION IF EXISTS public.get_wave_pickup_summary(uuid);
CREATE OR REPLACE FUNCTION public.get_wave_pickup_summary(p_wave_id uuid)
RETURNS TABLE (
  pickup_window pickup_window_enum,
  pickup_date   date,
  total_items   int,
  total_pairs   numeric,
  block_count   int,
  sale_order_count int
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      wi.pickup_window,
      CASE wi.pickup_window
        WHEN 'tuesday' THEN pw.pickup_tuesday_date
        WHEN 'friday'  THEN pw.pickup_friday_date
      END AS pickup_date,
      wi.id AS item_id,
      wi.block_key,
      wi.total_quantity,
      wis.sale_order_id
    FROM production_wave_items wi
    JOIN production_waves pw ON pw.id = wi.wave_id
    LEFT JOIN production_wave_item_sources wis ON wis.wave_item_id = wi.id
    WHERE wi.wave_id = p_wave_id
  )
  SELECT
    pickup_window,
    MAX(pickup_date)               AS pickup_date,
    COUNT(DISTINCT item_id)::int   AS total_items,
    SUM(total_quantity)            AS total_pairs,
    COUNT(DISTINCT block_key)::int AS block_count,
    COUNT(DISTINCT sale_order_id)::int AS sale_order_count
  FROM base
  WHERE pickup_window IS NOT NULL
  GROUP BY pickup_window;
$$;

GRANT EXECUTE ON FUNCTION public.get_wave_pickup_summary(uuid) TO authenticated;


-- ── 8. Re-roda update_wave_timeline em ondas ativas pra preencher pickups ──

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.production_waves
     WHERE status IN ('draft','planning','running')
  LOOP
    BEGIN
      PERFORM public.update_wave_timeline(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'update_wave_timeline falhou pra wave % — %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;
