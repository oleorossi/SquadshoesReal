-- Normaliza a geometria das napas em component_sheets: 1000 × 1370 mm
-- ============================================================================
-- Decisão do dono (31/07/2026): "o tamanho de todas as napas é 1000 mm × 1370 mm".
-- A LARGURA ÚTIL — a que converte dm²/par em metro — é 1370.
--
-- Cadastro medido em 31/07 (46 fichas de componente furadas):
--   • 20 NAPA SOFT + 4 GLOW METALIC gravadas 1370 × 1000 (lados trocados)
--   • 24 NAPA SOFT gravadas 1370 × 1370 (quadrado impossível)
--   •  2 NAPA SUDANI com comprimento 0
--
-- ⚠ ISTO NÃO MUDA NENHUM CÁLCULO DE CONSUMO. Os dois motores já pegam o maior
-- dos dois lados — `get_material_conversion_info` usa
-- GREATEST(dimensions_width, dimensions_length) e o TS usa Math.max
-- (`materialConsumption.ts:120`). Verificado rodando a função em 9 napas antes
-- desta migration: `dm2_per_unit = 137,0` em TODAS, inclusive nas trocadas. O
-- motor nunca usou o 1000. É higiene de dado, não correção de cálculo — não
-- invalida snapshot congelado nem reserva de OP em produção.
--
-- Escopo: só os grupos de napa. `component_sheets` de outros materiais (placa
-- de EVA, tira, elástico) têm geometria própria e não entram.

UPDATE public.component_sheets cs
   SET dimensions_length = 1000,
       dimensions_width  = 1370,
       dimensions_unit   = 'mm'
  FROM public.products p
  JOIN public.product_groups g ON g.id = p.group_id
 WHERE cs.product_id = p.id
   AND upper(btrim(g.name)) IN ('NAPA SOFT', 'NAPA SUDANI', 'GLOW METALIC', 'NAPA MADRID')
   AND (COALESCE(cs.dimensions_length, 0) <> 1000
        OR COALESCE(cs.dimensions_width, 0) <> 1370
        OR COALESCE(cs.dimensions_unit, '') <> 'mm');

-- NÃO mexe em `products.dimensions_width` (1000 em 58 de 60 napas). Essa coluna
-- é lida CRUA pelo MRP (`MrpNeedsTable.tsx`, sem GREATEST) pra montar a sugestão
-- em unidade de compra; corrigir ali muda o número exibido nas 5 napas que
-- compram em unidade diferente da de estoque. Fica pra decisão separada.
