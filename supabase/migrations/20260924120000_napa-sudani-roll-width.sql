-- Largura do rolo da NAPA SUDANI = NAPA SOFT (cadastro confirmado pelo usuário)
-- ============================================================================
-- Contexto: na tela "Consumo de Materiais" dos pedidos selecionados, as seções
-- de NAPA SUDANI mostravam "N itens ficaram fora do total — cadastro incompleto":
-- as tiras artesanais dessas referências (Tira chata 8mm, Overlock 5mm, etc.)
-- apontam pra NAPA SUDANI como base (napa da ficha), mas não há receita
-- `(tira, NAPA SUDANI)` em `artisanal_recipes` — só (tira, NAPA SOFT) e
-- (tira, NAPA MADRID), ambas rolo de 1000 mm.
--
-- O motor TS (strapYieldResolution.ts) herda o rendimento de outra base da MESMA
-- tira quando a LARGURA DO ROLO bate. A NAPA SUDANI estava com
-- `product_groups.dimensions_width = 0` → caía na inferência por unanimidade.
-- O usuário confirmou (2026-07-24) que a dimensão do rolo da SUDANI é igual à da
-- NAPA SOFT → registrar a largura torna a herança por largura-de-rolo explícita
-- (robusta mesmo se no futuro entrar uma receita divergente em outra base).
--
-- ⚠ `product_groups.dimensions_width` de uma napa é lido SÓ pela resolução de
-- rendimento de tira e pelo bloco de corte do rolo. A conversão dm²→unidade de
-- estoque/custeio/entrada de NF usa `component_sheets.dimensions_width` /
-- `products.dimensions_width` (função `get_material_conversion_info`), caminho
-- separado — este UPDATE não infla estoque nem custo. NAPA SOFT e NAPA MADRID já
-- rodam com 1000 mm em produção; a SUDANI passa a ficar consistente com as irmãs.
--
-- Idempotente e guardado: só preenche quando a largura está ausente/zero (não
-- sobrescreve um valor cadastrado depois). Não toca `sector` → não dispara o
-- cascade de setor (`tg_group_sector_cascade`).
-- ============================================================================

UPDATE public.product_groups
SET
  dimensions_width = COALESCE(
    (SELECT dimensions_width FROM public.product_groups WHERE name = 'NAPA SOFT' LIMIT 1),
    1000
  ),
  dimensions_unit = COALESCE(
    (SELECT dimensions_unit FROM public.product_groups WHERE name = 'NAPA SOFT' LIMIT 1),
    'mm'
  )
WHERE name = 'NAPA SUDANI'
  AND (dimensions_width IS NULL OR dimensions_width = 0);
