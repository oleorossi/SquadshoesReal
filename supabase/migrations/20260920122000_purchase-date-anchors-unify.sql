-- ============================================================================
-- Fase 2 da auditoria de motores — Pacote P4 (COMPRAS), parte 3/4
--
-- F3-4 (médio): três âncoras divergentes de "comprar até" pro MESMO material:
--   • purchase_projection_timeline: dias CORRIDOS, Costura SEQUENCIAL (pré-PR3),
--     lead do fornecedor SEMPRE somado (fallback 10);
--   • compute_wave_timeline (CONTRATO CANÔNICO): dias ÚTEIS (add_business_days),
--     Costura PARALELA aos 3 preps (GREATEST(palmilha, forracao, mesa, costura)),
--     lead do fornecedor SÓ com shortage, via get_effective_supplier_lead_days;
--   • v_mrp_needs sem wave: entrega − products.lead_time_days (3ª coluna de
--     lead), sem cadeia de produção nem buffer — order_by_date podia cair
--     DEPOIS da data real necessária.
--
-- Alinhamento ao contrato vivo do compute_wave_timeline:
--   1) purchase_projection_timeline recalculada com a MESMA topologia:
--      dias úteis, Costura no GREATEST dos 4 preps, fórmulas de lead por setor
--      idênticas (NULLIF + fallback de dlt; palmilha usa lead_time_corte_dias
--      como a wave — antes lia lead_time_costura_dias), lead do fornecedor via
--      get_effective_supplier_lead_days e SÓ quando a necessidade convertida da
--      OP excede o estoque líquido (gate por linha OP×material).
--   2) v_mrp_needs: fallback do order_by_date passa a ser
--      compute_po_purchase_by_date(order_ids) (= purchase_deadline do
--      compute_wave_timeline dos PVs da demanda); o legado entrega−lead_time_days
--      permanece só como último recurso (produto abaixo do mínimo sem demanda).
--   3) compute_po_purchase_by_date JÁ delega ao compute_wave_timeline — sem
--      mudança (âncora canônica).
--
-- Colunas da view preservadas (nomes/ordem/tipos) — CREATE OR REPLACE seguro.
-- Inclui a definição FINAL de v_mrp_needs (com is_artisanal da mig
-- 20260920120000). Idempotente, sem DML.
-- ============================================================================

CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
 WITH lt AS (
         SELECT o.id AS order_id,
            o.order_number AS pedido_ref,
            o.sale_order_id,
            so.delivery_deadline AS data_entrega_cliente,
            o.quantity AS op_quantity,
            o.status AS order_status,
            o.reference_id,
            ts.name AS referencia_nome,
            ts.id AS sheet_id,
            ts.shoe_category AS sheet_category,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'corte_palmilha'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day)::numeric)::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 1)
                    END
                    ELSE 0
                END AS lead_time_palmilha_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'corte_forracao'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day)::numeric)::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 2)
                    END
                    ELSE 0
                END AS lead_time_forracao_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'mesa'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity)::numeric)::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_mesa_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'costura'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.costura_capacity_per_day, 0::numeric), dlt.costura_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.costura_capacity_per_day, 0::numeric), dlt.costura_capacity_per_day))::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0), dlt.lead_time_costura_dias, 1)
                    END
                    ELSE 0
                END AS lead_time_costura_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'silk'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_silk_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'colagem'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_colagem_dias,
                CASE
                    WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0), dlt.lead_time_montagem_dias, 2)
                END AS lead_time_montagem_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'solagem'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0)::numeric, dlt.soling_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day, 0)::numeric, dlt.soling_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_solagem_dias,
                CASE
                    WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0), dlt.lead_time_acabamento_dias, 1)
                END AS lead_time_acabamento_dias,
            COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0), dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
           FROM orders o
             JOIN sale_orders so ON so.id = o.sale_order_id
             JOIN technical_sheets ts ON ts.id = o.reference_id
             LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
          WHERE (o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text])) AND so.delivery_deadline IS NOT NULL
        ), lt2 AS (
         -- Topologia canônica do compute_wave_timeline: sequência pós-prep em
         -- dias ÚTEIS; d_silk = início do Silk (fim comum dos 4 preps paralelos);
         -- prep_max = GREATEST dos 4 preps (Costura PARALELA — PR3/mig 20260522).
         SELECT lt.*,
            public.add_business_days(lt.data_entrega_cliente,
              -(lt.lead_time_acabamento_dias + lt.lead_time_solagem_dias + lt.lead_time_montagem_dias + lt.lead_time_colagem_dias + lt.lead_time_silk_dias))::date AS d_silk,
            GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias, lt.lead_time_mesa_dias, lt.lead_time_costura_dias) AS prep_max
           FROM lt
        ), rows_mat AS (
         SELECT lt2.*,
            m.id AS material_id,
            m.name AS material,
            m.group_id AS material_group_id,
            pg.name AS grupo_material,
            m.unit AS unidade,
            GREATEST(0::numeric, m.quantity - COALESCE(m.reserved_stock, 0::numeric)) AS estoque_atual,
            m.quantity AS estoque_bruto,
            COALESCE(m.reserved_stock, 0::numeric) AS estoque_reservado,
            m.min_stock,
            m.supplier_id,
            sup.name AS supplier_name,
            m.supplier_lead_time_days AS material_lead_time_raw,
            sup.lead_time_days AS supplier_lead_time_raw,
            -- F3-4: MESMA fonte de lead do compute_wave_timeline (OC aberta >
            -- grupo > produto > 10) em vez de COALESCE(sup, produto, 10).
            public.get_effective_supplier_lead_days(m.id, NULL) AS supplier_lead_time_days,
            COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric AS quantidade_necessaria_bruta,
                CASE
                    WHEN (conv.target_unit = ANY (ARRAY['m'::text, 'meters'::text, 'metros'::text, 'mt'::text, 'cm'::text])) AND conv.conversion_warning IS NULL AND COALESCE(conv.dm2_per_unit, 0::numeric) > 0::numeric THEN 'linear'::text
                    WHEN (lower(m.unit) = ANY (ARRAY['placa'::text, 'placas'::text])) AND COALESCE(plate.area_dm2, 0::numeric) > 0::numeric THEN 'placa'::text
                    ELSE 'none'::text
                END AS conversao_dm2,
                CASE
                    WHEN (conv.target_unit = ANY (ARRAY['m'::text, 'meters'::text, 'metros'::text, 'mt'::text, 'cm'::text])) AND conv.conversion_warning IS NULL AND COALESCE(conv.dm2_per_unit, 0::numeric) > 0::numeric THEN COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric / conv.dm2_per_unit * (1::numeric + COALESCE(conv.waste_pct, 0::numeric) / 100::numeric)
                    WHEN (lower(m.unit) = ANY (ARRAY['placa'::text, 'placas'::text])) AND COALESCE(plate.area_dm2, 0::numeric) > 0::numeric THEN COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric / plate.area_dm2 * (1::numeric + COALESCE(conv.waste_pct, 0::numeric) / 100::numeric)
                    ELSE COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric
                END AS quantidade_necessaria
           FROM lt2
             JOIN sheet_materials sm ON sm.sheet_id = lt2.reference_id
             JOIN products m ON m.id = sm.product_id
             LEFT JOIN product_groups pg ON pg.id = m.group_id
             LEFT JOIN suppliers sup ON sup.id = m.supplier_id
             LEFT JOIN LATERAL get_material_conversion_info(m.id) conv(dm2_per_unit, waste_pct, target_unit, conversion_warning) ON true
             LEFT JOIN LATERAL ( SELECT
                        CASE lower(cs.dimensions_unit)
                            WHEN 'cm'::text THEN cs.dimensions_width * 10::numeric
                            WHEN 'm'::text THEN cs.dimensions_width * 1000::numeric
                            ELSE cs.dimensions_width
                        END *
                        CASE lower(cs.dimensions_unit)
                            WHEN 'cm'::text THEN cs.dimensions_length * 10::numeric
                            WHEN 'm'::text THEN cs.dimensions_length * 1000::numeric
                            ELSE cs.dimensions_length
                        END / 10000.0 AS area_dm2
                   FROM component_sheets cs
                  WHERE (cs.product_id = m.id OR cs.group_id = m.group_id) AND COALESCE(cs.dimensions_width, 0::numeric) > 0::numeric AND COALESCE(cs.dimensions_length, 0::numeric) > 0::numeric
                  ORDER BY (cs.product_id = m.id) DESC
                 LIMIT 1) plate ON true
        )
 SELECT r.order_id,
    r.pedido_ref,
    r.sale_order_id,
    r.data_entrega_cliente,
    r.op_quantity,
    r.order_status,
    r.reference_id,
    r.referencia_nome,
    r.lead_time_palmilha_dias,
    r.lead_time_forracao_dias,
    r.lead_time_mesa_dias,
    r.lead_time_costura_dias,
    r.lead_time_silk_dias,
    r.lead_time_colagem_dias,
    r.lead_time_montagem_dias,
    r.lead_time_solagem_dias,
    r.lead_time_acabamento_dias,
    r.lead_time_buffer_material_dias,
    r.lead_time_forracao_dias AS lead_time_corte_dias,
    public.add_business_days(r.data_entrega_cliente, -r.lead_time_acabamento_dias)::date AS data_inicio_acabamento,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias))::date AS data_inicio_solagem,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias + r.lead_time_montagem_dias))::date AS data_inicio_montagem,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias + r.lead_time_montagem_dias + r.lead_time_colagem_dias))::date AS data_inicio_colagem,
    r.d_silk AS data_inicio_silk,
    -- Costura PARALELA aos preps (termina no início do Silk, como na wave)
    public.add_business_days(r.d_silk, -r.lead_time_costura_dias)::date AS data_inicio_costura,
    public.add_business_days(r.d_silk, -r.lead_time_forracao_dias)::date AS data_inicio_corte,
    public.add_business_days(r.d_silk, -r.lead_time_palmilha_dias)::date AS data_inicio_palmilha,
    public.add_business_days(r.d_silk, -r.lead_time_mesa_dias)::date AS data_inicio_mesa,
    public.add_business_days(r.d_silk, -r.prep_max)::date AS data_chegada_material,
    r.supplier_lead_time_days,
    r.material_lead_time_raw,
    r.supplier_lead_time_raw,
    -- Âncora canônica (= purchase_deadline da wave, por OP×material):
    -- chegada do material − buffer − lead do fornecedor SÓ quando a
    -- necessidade convertida excede o estoque líquido (gate de shortage).
    public.add_business_days(
      public.add_business_days(r.d_silk, -r.prep_max)::date,
      -(r.lead_time_buffer_material_dias
        + CASE WHEN r.quantidade_necessaria > r.estoque_atual THEN r.supplier_lead_time_days ELSE 0 END)
    )::date AS data_limite_compra,
    r.material_id,
    r.material,
    r.material_group_id,
    r.grupo_material,
    r.unidade,
    r.estoque_atual,
    r.estoque_bruto,
    r.estoque_reservado,
    r.min_stock,
    r.supplier_id,
    r.supplier_name,
    r.quantidade_necessaria_bruta,
    r.conversao_dm2,
    r.quantidade_necessaria
   FROM rows_mat r;

-- ----------------------------------------------------------------------------
-- v_mrp_needs — fallback do order_by_date sem wave = compute_po_purchase_by_date
-- (âncora do compute_wave_timeline sobre os PVs da demanda). Definição FINAL
-- (inclui is_artisanal da mig 20260920120000).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mrp_needs AS
 WITH demand AS (
         SELECT d_1.product_id,
            d_1.product_name,
            d_1.total_required,
            d_1.earliest_deadline,
            d_1.orders_count,
            d_1.order_ids,
            d_1.conversion_warning
           FROM fn_projected_demand() d_1(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids, conversion_warning)
        ), po_open AS (
         SELECT poi.product_id,
            sum(poi.quantity) AS qty_in_pipeline
           FROM purchase_order_items poi
             JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
          WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text])
          GROUP BY poi.product_id
        ), reserved AS (
         SELECT mr.product_id,
            sum(mr.quantity_reserved - mr.quantity_consumed) AS qty_reserved
           FROM material_reservations mr
          WHERE mr.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
          GROUP BY mr.product_id
        ), wave_deadline AS (
         SELECT sm.product_id,
            min(pw.purchase_deadline) AS wave_purchase_deadline
           FROM production_waves pw
             JOIN production_wave_items pwi ON pwi.wave_id = pw.id
             JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
             JOIN sale_order_items soi ON soi.id = pwis.sale_order_item_id
             JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
          WHERE (pw.status::text <> ALL (ARRAY['finished'::text, 'cancelled'::text])) AND pw.purchase_deadline IS NOT NULL
          GROUP BY sm.product_id
        ), box_po AS (
         SELECT poi.box_type_id,
            sum(poi.quantity) AS qty_in_pipeline
           FROM purchase_order_items poi
             JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
          WHERE poi.box_type_id IS NOT NULL AND (po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text, 'suggested'::text]))
          GROUP BY poi.box_type_id
        ), pkg_demand AS (
         SELECT d.box_type_id,
            d.boxes_required,
            d.earliest_deadline,
            d.orders_count
           FROM fn_projected_packaging_demand() d(box_type_id, boxes_required, earliest_deadline, orders_count)
        )
 SELECT p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    p.unit,
    p.unit_price,
    p.purchase_order_unit,
    COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
    p.min_order_quantity,
    p.lead_time_days,
    p.preferred_supplier_id,
    s.name AS supplier_name,
    p.min_stock,
    p.quantity AS on_hand,
    COALESCE(r.qty_reserved, 0::numeric) AS reserved,
    GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
    COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(d.total_required, 0::numeric) AS projected_demand,
    d.earliest_deadline,
    d.orders_count,
    GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    -- F3-4: sem wave armazenada, a âncora vem do compute_wave_timeline dos PVs
    -- da demanda (compute_po_purchase_by_date) — mesma topologia (Costura
    -- paralela, dias úteis, buffer, lead gated por shortage). O legado
    -- entrega − products.lead_time_days fica só como último recurso (produto
    -- abaixo do mínimo sem demanda projetada).
    COALESCE(wd.wave_purchase_deadline,
             public.compute_po_purchase_by_date(d.order_ids),
             add_business_days(d.earliest_deadline, - COALESCE(p.lead_time_days, 0))) AS order_by_date,
    d.conversion_warning,
    false AS is_packaging,
    COALESCE(p.is_artisanal, false) AS is_artisanal
   FROM products p
     LEFT JOIN demand d ON d.product_id = p.id
     LEFT JOIN po_open po ON po.product_id = p.id
     LEFT JOIN reserved r ON r.product_id = p.id
     LEFT JOIN wave_deadline wd ON wd.product_id = p.id
     LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
  WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock OR d.conversion_warning IS NOT NULL
UNION ALL
 SELECT bt.id AS product_id,
    bt.nome AS product_name,
    NULL::text AS sku,
    'Embalagem'::text AS category,
        CASE
            WHEN bt.tipo::text = 'fitilho'::text THEN 'm'::text
            ELSE 'cx'::text
        END AS unit,
    bt.unit_price,
        CASE
            WHEN bt.tipo::text = 'fitilho'::text THEN 'm'::text
            ELSE 'cx'::text
        END AS purchase_order_unit,
    1::numeric AS conversion_rate,
    NULL::numeric AS min_order_quantity,
    0 AS lead_time_days,
    bt.supplier_id AS preferred_supplier_id,
    s.name AS supplier_name,
    bt.min_stock,
    bt.quantity AS on_hand,
    0::numeric AS reserved,
    GREATEST(bt.quantity - 0::numeric, 0::numeric) AS available_now,
    COALESCE(bpo.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(pd.boxes_required, 0::numeric) AS projected_demand,
    pd.earliest_deadline,
    pd.orders_count,
    GREATEST(COALESCE(pd.boxes_required, 0::numeric) + COALESCE(bt.min_stock, 0::numeric) - bt.quantity - COALESCE(bpo.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    pd.earliest_deadline AS order_by_date,
    NULL::text AS conversion_warning,
    true AS is_packaging,
    false AS is_artisanal
   FROM box_types bt
     LEFT JOIN pkg_demand pd ON pd.box_type_id = bt.id
     LEFT JOIN box_po bpo ON bpo.box_type_id = bt.id
     LEFT JOIN suppliers s ON s.id = bt.supplier_id
  WHERE bt.active = true AND (COALESCE(pd.boxes_required, 0::numeric) > 0::numeric OR bt.quantity < COALESCE(bt.min_stock, 0::numeric));
