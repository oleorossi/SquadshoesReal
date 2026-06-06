-- =============================================================================
-- FIX: purchase_projection_timeline.quantidade_necessaria inflada ~100× em
--      materiais de ÁREA (napa/couro/forro/placa).
-- =============================================================================
--
-- Bug: a view calculava
--   quantidade_necessaria = COALESCE(sm.quantity_per_unit, 1) * op_quantity
-- SEM converter dm²→unidade física do produto. Para materiais de ÁREA cortados
-- de bobina/placa, `sheet_materials.quantity_per_unit` está em **dm²/par**, então
-- a multiplicação crua infla a necessidade ~100× (mesmo padrão já corrigido no
-- modal de Consumo, no motor src/lib/orderConsumption.ts, no custeio —
-- 20260703170000 — e na reserva — 20260703200000).
--
-- Telas afetadas que leem a QUANTIDADE: PurchaseTimeline, ProductionScheduleTimeline,
-- ProductionPlanning, ProductionControlCenter. (A "Por Semana"/WeeklyPurchasing usa
-- só a coluna de DATA `data_limite_compra`; a quantidade dela vem do motor frontend
-- weeklyPurchasingPlan.ts, que já converte — por isso NÃO estava afetada.)
--
-- Fix: recria a view convertendo dm²→unidade física do produto, espelhando a
-- regra canônica de src/lib/materialConsumption.ts (convertDm2ToLinearMeters /
-- convertDm2ToPlates) e o helper SQL get_material_conversion_info(p_product_id):
--   • LINEAR (m/cm) com largura na ficha de componente →
--       crude_dm² / dm2_per_unit * (1 + waste%)   [dm2_per_unit = largura_mm/10,
--       já normalizado p/ cm dentro do helper; resultado fica na unidade do produto]
--   • PLACA (placa) com área da placa na ficha →
--       crude_dm² / area_da_placa_dm² * (1 + waste%)   [convertDm2ToPlates]
--   • LINEAR sem largura (tiras/elásticos diretos — get_material_conversion_info
--       devolve conversion_warning ≠ NULL), CONTAGEM (un/par), MASSA (kg/g) e
--       ÁREA-em-ÁREA (dm²): NÃO converte — valor cru já está na unidade certa.
--
-- O resto da view (cascata reversa de prazos, datas por setor, supplier lead,
-- estoque líquido) é idêntico à definição anterior (20260617140000). Só muda a
-- coluna `quantidade_necessaria` + 2 colunas de auditoria
-- (`quantidade_necessaria_bruta`, `conversao_dm2`).
--
-- Nota de consistência: usamos o MESMO get_material_conversion_info do custeio/
-- reserva, então em qualquer caso de borda (ex.: largura herdada por group_id) a
-- timeline acompanha o custeio/MRP em vez de divergir.
-- =============================================================================

DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;

CREATE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,

    -- Corte Palmilha (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
        ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 1)
      END
      ELSE 0
    END AS lead_time_palmilha_dias,
    -- Corte Forração (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
        ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
      END
      ELSE 0
    END AS lead_time_forracao_dias,
    -- Mesa/Aviamento (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(ts.mesa_daily_capacity, dlt.mesa_daily_capacity, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                      dlt.mesa_daily_capacity)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_mesa_dias,
    -- Costura
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(ts.costura_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / ts.costura_capacity_per_day::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_costura_dias,
    -- Silk
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(ts.silk_capacity_per_day, dlt.silk_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.silk_capacity_per_day, 0),
                      dlt.silk_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_silk_dias,
    -- Colagem
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(ts.gluing_capacity_per_day, dlt.gluing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.gluing_capacity_per_day, 0),
                      dlt.gluing_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_colagem_dias,
    -- Montagem (sempre)
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
      THEN GREATEST(1, CEIL(o.quantity::numeric /
           COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                    dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,
    -- Solagem
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(ts.soling_capacity_per_day, dlt.soling_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.soling_capacity_per_day, 0),
                      dlt.soling_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_solagem_dias,
    -- Acabamento (sempre)
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
      THEN GREATEST(1, CEIL(o.quantity::numeric /
           COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                    dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,
    -- Buffer
    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias

  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,

  -- Lead times individuais (todos os setores agora)
  lt.lead_time_palmilha_dias,
  lt.lead_time_forracao_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_silk_dias,
  lt.lead_time_colagem_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_solagem_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  -- Alias legacy (frontend ProductionScheduleTimeline ainda usa estas chaves)
  lt.lead_time_forracao_dias AS lead_time_corte_dias,

  -- Datas em cascata reversa (do deadline pra trás), com paralelismo prep.
  -- post_prep = acabamento + solagem + montagem + colagem + silk + costura
  -- costura_start = deadline - post_prep
  -- earliest_prep = costura_start - MAX(palmilha,forracao,mesa)
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias
    AS data_inicio_solagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias
    AS data_inicio_colagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    AS data_inicio_silk,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  -- Alias legacy: frontend usa data_inicio_corte/data_inicio_mesa.
  -- Prep paralelo: data_inicio = costura_start - lead_time_prep_individual.
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_forracao_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_palmilha_dias
    AS data_inicio_palmilha,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  -- Material chega no início mais antigo de todos os prep (= mais restritivo)
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    - GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias, lt.lead_time_mesa_dias)
    AS data_chegada_material,

  COALESCE(NULLIF(sup.lead_time_days, 0),
           NULLIF(m.supplier_lead_time_days, 0),
           10) AS supplier_lead_time_days,

  m.supplier_lead_time_days        AS material_lead_time_raw,
  sup.lead_time_days               AS supplier_lead_time_raw,

  -- data_limite_compra = data_chegada_material - supplier_lead_time
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    - GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias, lt.lead_time_mesa_dias)
    - lt.lead_time_buffer_material_dias
    - COALESCE(NULLIF(sup.lead_time_days, 0),
               NULLIF(m.supplier_lead_time_days, 0),
               10)
    AS data_limite_compra,

  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  -- Deduz reserved_stock pra refletir disponível real
  GREATEST(0, m.quantity - COALESCE(m.reserved_stock, 0))::numeric AS estoque_atual,
  m.quantity        AS estoque_bruto,
  COALESCE(m.reserved_stock, 0) AS estoque_reservado,
  m.min_stock,
  m.supplier_id,
  sup.name          AS supplier_name,

  -- ── QUANTIDADE NECESSÁRIA ────────────────────────────────────────────────
  -- Valor BRUTO (dm²/par × qtd, pré-conversão) — guardado p/ auditoria/before-after.
  (COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric)
    AS quantidade_necessaria_bruta,

  -- Tipo de conversão aplicada ('linear' | 'placa' | 'none') — depuração.
  CASE
    WHEN conv.target_unit IN ('m','meters','metros','mt','cm')
         AND conv.conversion_warning IS NULL
         AND COALESCE(conv.dm2_per_unit, 0) > 0
      THEN 'linear'
    WHEN LOWER(m.unit) IN ('placa','placas')
         AND COALESCE(plate.area_dm2, 0) > 0
      THEN 'placa'
    ELSE 'none'
  END AS conversao_dm2,

  -- Necessidade convertida p/ a unidade física do produto (regra canônica —
  -- materialConsumption.ts: convertDm2ToLinearMeters / convertDm2ToPlates).
  CASE
    -- Material de ÁREA, produto LINEAR (m/cm) com largura na ficha → m/cm.
    WHEN conv.target_unit IN ('m','meters','metros','mt','cm')
         AND conv.conversion_warning IS NULL
         AND COALESCE(conv.dm2_per_unit, 0) > 0
      THEN (COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric / conv.dm2_per_unit)
           * (1 + COALESCE(conv.waste_pct, 0) / 100)
    -- Material de ÁREA, produto PLACA com área da placa na ficha → nº de placas.
    WHEN LOWER(m.unit) IN ('placa','placas')
         AND COALESCE(plate.area_dm2, 0) > 0
      THEN (COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric / plate.area_dm2)
           * (1 + COALESCE(conv.waste_pct, 0) / 100)
    -- Demais (linear direto sem ficha, un/par, kg/g, dm²): NÃO converte.
    ELSE COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
  END AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.reference_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id
  -- Fator de conversão dm²→unidade física (mesmo helper do custeio/reserva).
  LEFT JOIN LATERAL public.get_material_conversion_info(m.id) conv ON true
  -- Área da placa (convertDm2ToPlates): preferir ficha por product_id, senão por
  -- group_id; precisa de largura E comprimento > 0. Normaliza unidade da dimensão.
  LEFT JOIN LATERAL (
    SELECT (
      (CASE LOWER(cs.dimensions_unit) WHEN 'cm' THEN cs.dimensions_width * 10
                                      WHEN 'm'  THEN cs.dimensions_width * 1000
                                      ELSE cs.dimensions_width END)
      *
      (CASE LOWER(cs.dimensions_unit) WHEN 'cm' THEN cs.dimensions_length * 10
                                      WHEN 'm'  THEN cs.dimensions_length * 1000
                                      ELSE cs.dimensions_length END)
    ) / 10000.0 AS area_dm2
    FROM public.component_sheets cs
    WHERE (cs.product_id = m.id OR cs.group_id = m.group_id)
      AND COALESCE(cs.dimensions_width, 0)  > 0
      AND COALESCE(cs.dimensions_length, 0) > 0
    ORDER BY (cs.product_id = m.id) DESC
    LIMIT 1
  ) plate ON true;

ALTER VIEW public.purchase_projection_timeline SET (security_invoker = true);

COMMENT ON VIEW public.purchase_projection_timeline IS
  'Cronograma reverso por OP+material — usa MESMA fórmula da compute_wave_timeline '
  'com paralelismo prep e todos os 10 setores. estoque_atual deduz reserved_stock. '
  'quantidade_necessaria converte dm²→unidade física (largura/área da ficha de '
  'componente) p/ materiais de ÁREA; quantidade_necessaria_bruta guarda o valor cru.';
