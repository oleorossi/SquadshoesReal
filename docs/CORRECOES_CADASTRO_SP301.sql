-- ============================================================================
-- CORREÇÕES DE CADASTRO — rodar à mão, no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
--
-- NÃO foi aplicado por mim: altera cadastro de produção. Decisões do grill de
-- 12/10/2026 (Q7-bis e Q10). Rode um bloco de cada vez e confira o retorno.
-- ============================================================================


-- ─── 1. Forração da SP301: NAPA SUDANI → NAPA SOFT ──────────────────────────
--
-- ⚠ LEIA ANTES DE RODAR. A SP301 tem `sole_drives_consumption = true` e o
-- SOLADO 01 NÃO tem forro de cabedal (`lining_consumption_dm2` NULL em todas as
-- numerações), só forro de PALMILHA (5,70–6,85 dm²). Pela regra canônica
-- (`suppressCabedalForracao`), o `lining_material` desta ficha dirige o forro da
-- PALMILHA — não o do cabedal.
--
-- Ou seja: este UPDATE faz a PALMILHA passar a ser forrada em NAPA SOFT no
-- lugar de NAPA SUDANI. É mudança real de consumo daqui pra frente.
--
-- Seguro quanto ao histórico: a ficha tem 0 itens de PV salvos (verificado em
-- 12/10/2026), então nenhum pedido existente muda.
--
-- Efeito colateral desejado: NAPA SOFT tem ROCHA ativa (10 m) e NAPA SUDANI
-- não — o bloqueio do PV cai sozinho.

UPDATE technical_sheets
   SET lining_material = 'NAPA SOFT'
 WHERE id = 'e5263807-0dcc-41fa-9c44-58a9f5b2a8db'
   AND lining_material = 'NAPA SUDANI';   -- guarda: no-op se já foi corrigido

-- confere
SELECT code, name, upper_material AS cabedal, lining_material AS forracao
  FROM technical_sheets
 WHERE id = 'e5263807-0dcc-41fa-9c44-58a9f5b2a8db';


-- ─── 2. Códigos de referência com lixo de teste ─────────────────────────────
--
-- Só o `code`; as fichas NÃO são apagadas (a DS19 tem 1 item de PV apontando
-- pra ela). Verificado em 12/10/2026: nenhuma colisão com 'SP301' nem 'DS19'.

UPDATE technical_sheets SET code = 'SP301' WHERE code = 'SADSADAS';
UPDATE technical_sheets SET code = 'DS19'  WHERE code = 'SADSADDASDSA';

-- confere
SELECT id, code, name FROM technical_sheets WHERE name IN ('SP301', 'DS19');


-- ─── NÃO INCLUÍDO AQUI, de propósito ────────────────────────────────────────
--
-- As outras 5 fichas com forração NAPA SUDANI — DS22, S-039, SP101, SP117,
-- SP119 — ficam como estão. Não houve decisão sobre elas, e NAPA SUDANI como
-- forração é padrão da casa, não acidente.
--
-- As 33 lacunas de cor medidas em 20 referências aparecem agora em
-- /system-diagnostics → Consumo → "Cor vendida sem SKU no material do forro".
-- Cada uma é decisão de cadastro sua: criar o SKU na cor, mapear a cor da
-- palmilha na ficha, ou corrigir o material da ficha.
