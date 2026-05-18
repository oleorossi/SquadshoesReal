-- =============================================================================
-- BUG GRAVE — consumo de Napa "Dublada" inflado ~100× no PV individual
-- =============================================================================
--
-- 🔴 Sintoma reportado pelo usuário: ao visualizar consumo de materiais dentro
--    do pedido de venda individual, materiais Napa apareciam com medidas
--    muito infladas.
--
-- 🕵️ Causa raiz: get_material_conversion_info(product_id) (criada na
--    20260524120000) converte dm² → metros lineares dividindo pela largura
--    do material em component_sheets.dimensions_width. Quando ESSA LARGURA
--    NÃO ESTÁ CADASTRADA (NULL ou 0), a função cai num fallback silencioso
--    que retorna dm2_per_unit=1 — tratando dm² como se fosse metro linear,
--    inflando o consumo final ~100×.
--
--    Auditoria já documentava o caso (warning conversion_warning na função),
--    mas a UI nunca consumia o warning e o fallback continuava ativo.
--
--    Os Napas comuns (NAPA SOFT, NAPA SANTORINE — 38+ variantes de cor) já
--    tinham component_sheets com dimensions_width=1370mm e funcionavam OK
--    (dm2_per_unit=137). Mas 5 produtos do grupo DUBLAGEM nunca tiveram
--    component_sheets criada — e o fallback de "buscar largura de outro
--    produto do mesmo grupo" também falhava porque o grupo INTEIRO estava
--    sem nenhuma largura cadastrada.
--
--    Produtos afetados:
--      • Napa Soft com Cacharrel/EVA — CAPUCCINO (d78dc462)
--      • Napa Sudani Dublada — CARAMELO (477d9301)
--      • Napa Sudani Dublada — OFF WHITE (a8f88857)
--      • Dublado PU600 — CARAMELO (Dublagem)
--      • Dublado PU600 — OFF WHITE (Dublagem)
--
-- ✅ Fix:
--   1. Criar component_sheets para os 5 produtos da DUBLAGEM com
--      dimensions_width=1370mm, dimensions_unit='mm', waste_pct=8 (padrão
--      do default da coluna). Confirmada pelo usuário: 1.37m é a largura
--      real de rolo desses materiais (igual aos Napas comuns).
--   2. Marcar PVs que referenciam esses produtos (via technical_sheets
--      upper_material ou sheet_materials) como costs_dirty pra forçar
--      recálculo do custo na próxima visualização.
--
-- A parte de UI (banner amarelo exibindo conversion_warning) vai em commit
-- frontend separado — sem mudança SQL adicional.
-- =============================================================================

-- 1) Backfill: cria component_sheets para todos os 5 produtos do grupo DUBLAGEM
--    que estão sem ela e têm unit linear (m/mt/metros/cm). Idempotente —
--    ON CONFLICT (product_id) atualiza só se a largura ainda estiver vazia.
INSERT INTO public.component_sheets
  (product_id, dimensions_length, dimensions_width, dimensions_unit, waste_pct)
SELECT
  p.id,
  1370,                -- length (mesma do width pra Napa, é um material 2D em rolo)
  1370,                -- width 1.37m em mm
  'mm',
  8                    -- waste padrão de napa
FROM public.products p
JOIN public.product_groups pg ON pg.id = p.group_id
LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
WHERE pg.name = 'DUBLAGEM'
  AND p.unit IN ('m','metros','mt','meters','cm')
  AND cs.product_id IS NULL
ON CONFLICT (product_id) DO UPDATE
  SET dimensions_width = EXCLUDED.dimensions_width,
      dimensions_length = COALESCE(NULLIF(component_sheets.dimensions_length, 0), EXCLUDED.dimensions_length),
      dimensions_unit = EXCLUDED.dimensions_unit,
      waste_pct = COALESCE(NULLIF(component_sheets.waste_pct, 0), EXCLUDED.waste_pct)
  WHERE component_sheets.dimensions_width IS NULL
     OR component_sheets.dimensions_width = 0;

-- 2) Marcar PVs com custo defasado: qualquer PV cujos itens referenciem ficha
--    que use um dos 5 produtos da DUBLAGEM (como upper_material direto, ou
--    via sheet_materials, ou via strap_colors do PV).
WITH affected_products AS (
  SELECT p.id
  FROM public.products p
  JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE pg.name = 'DUBLAGEM' AND p.unit IN ('m','metros','mt','meters','cm')
),
affected_sheets AS (
  -- via upper_material (texto livre = group_name "DUBLAGEM" ou nome do produto)
  SELECT DISTINCT ts.id
  FROM public.technical_sheets ts
  WHERE ts.upper_material ILIKE '%dublagem%'
     OR ts.upper_material ILIKE '%dublad%'
     OR ts.upper_material ILIKE '%cacharrel%'
  UNION
  -- via sheet_materials linkando produto afetado
  SELECT DISTINCT sm.sheet_id
  FROM public.sheet_materials sm
  JOIN affected_products ap ON ap.id = sm.product_id
),
affected_sale_orders AS (
  -- PVs com itens referenciando essas fichas
  SELECT DISTINCT soi.sale_order_id
  FROM public.sale_order_items soi
  JOIN affected_sheets afs ON afs.id = soi.technical_sheet_id
  WHERE soi.sale_order_id IS NOT NULL
)
UPDATE public.sale_orders so
SET costs_dirty_at = NOW()
FROM affected_sale_orders aso
WHERE so.id = aso.sale_order_id;
