-- =============================================================================
-- PR 7 — DROP de colunas mortas em technical_sheets
-- =============================================================================
-- Resultado da auditoria SQL `audit-technical-sheets-fill-rate.sql`:
--   • 75 colunas com 0% de fill rate em 22 fichas técnicas.
--   • Cruzando com o código (src/ + funções SQL atuais), separamos:
--       - Colunas usadas pela fórmula de onda / consumo / triggers → MANTER
--         (estão vazias só porque nenhuma ficha foi configurada ainda)
--       - Colunas usadas só como stub no form (`useTechnicalSheets.ts`)
--         e nunca lidas por nada funcional → DROP nesta migration.
--
-- A view `purchase_projection_timeline` depende de `handling_time_minutes`
-- (numa fórmula legacy). Esta migration:
--   1. DROPa a view primeiro
--   2. DROPa as colunas
--   3. Recria a view usando `mesa_daily_capacity` (substituto correto)
-- =============================================================================

-- ─── 0. Drop view dependente (recriada no final) ───────────────────────────
DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;


-- ─── 1. Stubs de marketing/etiqueta (nunca preenchidos, sem display) ────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS acceptance_criteria;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS assembly_instructions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS care_instructions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS certifications;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS commercial_description;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS country_origin;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS keywords;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS label_info;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS legal_composition;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS storage_instructions;

-- ─── 2. Versionamento manual stub (nunca usado) ─────────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS approvals;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS change_log;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS data_ultima_revisao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS responsavel_revisao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS responsible_person;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS qtd_prevista;

-- ─── 3. Specs técnicos manuais (substitutos por sole_technical_specs) ──────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_base;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_material;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_type;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS insole_thickness;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS lining_weight;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS upper_finish;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS stitch_spec;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS material_solado_tipo;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS sole_code;

-- ─── 4. Cola/Química — campos manuais nunca usados ─────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cola_cure_time;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cola_type;

-- ─── 5. Embalagem manual (info hoje vem de product_groups) ─────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_box_dimensions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_notes;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_tissue;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS palletization;

-- ─── 6. Capacidades legacy (substituídas pelas *_capacity_per_day novas) ────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS daily_capacity_pairs;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS palmilha_daily_capacity;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS handling_time_minutes;

-- ─── 7. QC/máquinas/medições stub ──────────────────────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS quality_tests;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS sampling_plan;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS tolerances;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS machine_settings;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS measurements;

-- ─── 8. Outros (versão "last_*" e específicos sem uso) ──────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_code;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_exclusive;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_name;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_notes;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS obs_harmonizacao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS acabamento_tiras;


-- ─── 9. Recria purchase_projection_timeline sem handling_time_minutes ──────
-- Substitui o cálculo de lead_time_mesa_dias: era baseado em
-- handling_time_minutes (campo legacy 0%), agora usa mesa_daily_capacity
-- (formato consistente com os demais setores).
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

    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,

    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,

    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,

    -- Mesa/Aviamento: agora usa mesa_daily_capacity (era handling_time_minutes legacy)
    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.mesa_daily_capacity, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             ts.mesa_daily_capacity::numeric)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,

    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,

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
  lt.lead_time_corte_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
    - lt.lead_time_buffer_material_dias
    AS data_chegada_material,

  COALESCE(NULLIF(sup.lead_time_days, 0),
           NULLIF(m.supplier_lead_time_days, 0),
           10) AS supplier_lead_time_days,

  m.supplier_lead_time_days        AS material_lead_time_raw,
  sup.lead_time_days               AS supplier_lead_time_raw,

  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias
    - lt.lead_time_costura_dias - lt.lead_time_corte_dias
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
  m.quantity        AS estoque_atual,
  m.min_stock,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
    AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

ALTER VIEW public.purchase_projection_timeline SET (security_invoker = true);

COMMENT ON VIEW public.purchase_projection_timeline IS
  'Cronograma reverso por OP+material. supplier_lead_time_days é o EFETIVO '
  'aplicando prioridade fornecedor → material → 10. lead_time_mesa_dias usa '
  'mesa_daily_capacity (era handling_time_minutes legacy, dropado no PR 7).';
