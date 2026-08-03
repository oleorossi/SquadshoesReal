-- Auditoria do PV-00150 (2026-08-03): três cores da MESMA referência (NL02), com
-- grade e quantidade idênticas (1728 pares / 144 fichas cada), saíam com consumos
-- diferentes na ficha de Corte Forração:
--
--   PRETO       81,09 m   (waste_pct = 0)
--   NEW WHISKY  87,57 m   (waste_pct = 8)
--   OFF WHITE   87,57 m   (waste_pct = 8)
--
-- 81,0856 × 1,08 = 87,5724 — a diferença é EXATAMENTE a perda de corte, aplicada
-- por `convertDm2ToLinearMeters` (src/lib/materialConsumption.ts). Largura da
-- ficha de componente (1370mm), specs do solado e grade são idênticas entre as
-- três cores; só o waste_pct do produto de cada cor divergia.
--
-- Perda de corte é propriedade do MATERIAL e da faca, nunca da cor. O 0 não foi
-- decisão de ninguém: o DEFAULT da coluna é 8, os cinco pontos de criação no
-- código gravam 8, e o ProductFormDialog semeava o estado com 0 quando o produto
-- ainda não tinha ficha de componente — salvar gravava 0 e atropelava o default.
-- Corrigido no mesmo commit (DEFAULT_WASTE_PCT em src/hooks/useComponentSheets.ts).

-- ── 1. Perda de corte: uniformizar em 8% os grupos com divergência INTERNA ────
-- Escopo deliberadamente restrito aos grupos onde o MESMO material tem dois
-- valores (o caso indefensável: duas cores da mesma napa com perdas diferentes).
-- Grupos hoje uniformemente em 0 (NAPA SUDANI, NAPA SANTORINE, TIRA OVERLOCK,
-- TRANÇA, GLOW METALIC, NAPA MADRID, NEW VELVET PRETO) NÃO são tocados aqui —
-- exigem decisão de fábrica própria, com impacto muito maior em reserva/custeio.
--
-- Só materiais de ÁREA convertidos para unidade física: waste_pct só é lido por
-- convertDm2ToLinearMeters/convertDm2ToPlates. Em produto de contagem ('un',
-- 'par', 'kg') o campo é inócuo, então fica como está.
update component_sheets cs
set waste_pct = 8,
    updated_at = now()
from products p, product_groups g
where cs.product_id = p.id
  and p.group_id = g.id
  and g.name in ('NAPA SOFT', 'PALMILHA', 'TIRA CHATA COSTURADA 11MM')
  and lower(coalesce(p.unit, '')) in ('m', 'cm', 'dm²', 'placa')
  and coalesce(cs.waste_pct, 0) <> 8;

-- ── 2. NL01–NL04: material da palmilha (placa) faltando ──────────────────────
-- As quatro fichas da família NL têm consumo de palmilha preenchido (4,4343 dm²
-- escalar + tabela completa por numeração, ~7.635 dm² por OP de 1728 pares) e
-- `insole_material` VAZIO. As outras 37 fichas do sistema usam o grupo
-- 'PALMILHA'. Sem o grupo, `resolveMaterialProductCanonical('')` devolve null e
-- a linha inteira fica fora do consumo, da reserva e do débito (o SQL tem gate
-- `insole_material <> ''`) — o caso CONS-8 já documentado em
-- src/lib/orderConsumption.ts:1450. A regra do dono é explícita: tudo que está
-- preenchido na ficha técnica tem que ser debitado.
--
-- `insole_material` guarda o NOME DO GRUPO; o produto é resolvido por cor dentro
-- dele (cor exata > cor no nome > maior estoque), então isto não fixa um SKU.
update technical_sheets
set insole_material = 'PALMILHA',
    updated_at = now()
where name in ('NL01', 'NL02', 'NL03', 'NL04')
  and coalesce(nullif(trim(insole_material), ''), '') = ''
  and (coalesce(insole_consumption, 0) > 0 or insole_consumption_per_size::text <> '{}');

-- ── 3. NL02: cabedal fantasma ────────────────────────────────────────────────
-- A NL02 é sandália de tiras (has_straps = true) e o cabedal dela É a tira, que
-- já tem caminho próprio no motor (orderConsumption.ts:1846-1882, 100 cm/par com
-- cor por item do PV). Mesmo assim a ficha carregava
-- `upper_consumption_per_size = {34:1, …, 40:1}` SEM material — 1 dm²/par, contra
-- 11–23 dm²/par das fichas com cabedal real (BT01 22,83; DS12 19,4). É
-- placeholder, não medida.
--
-- Aqui a regra "tudo preenchido deve ser debitado" pede o INVERSO de preencher:
-- dar material a essa linha contaria a mesma peça duas vezes — o bug da forração
-- 2× do PV-00146. O que não deve debitar não pode ficar preenchido gerando aviso
-- falso de "Cabedal sem material" em toda ficha e todo cálculo.
-- É a única ficha do sistema com cabedal preenchido e material vazio.
update technical_sheets
set upper_consumption_per_size = '{}'::jsonb,
    updated_at = now()
where name = 'NL02'
  and coalesce(nullif(trim(upper_material), ''), '') = ''
  and coalesce(upper_consumption, 0) = 0
  and upper_consumption_per_size::text <> '{}';
