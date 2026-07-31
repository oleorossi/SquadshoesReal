-- EC23: o forro da ficha passa a ser NAPA SOFT (era NAPA SUDANI)
-- ============================================================================
-- Decisão do dono (31/07/2026): a fábrica corta NAPA SOFT no EC23 — a variante
-- estava certa e a FICHA é que estava errada.
--
-- Contexto: a ficha EC23 tem `upper_material` vazio, então a napa dela sai por
-- Forração e Forração Palmilha, que liam `lining_material = NAPA SUDANI`. A
-- única variante (NAPA SOFT) pinava o CABEDAL — slot que a ficha não consome —
-- logo era no-op, e o PV-00141 produziu 600 pares debitando SUDANI. O estorno
-- da napa saiu na migration 20261027120100.
--
-- Com o forro da ficha em NAPA SOFT:
--   • Vender EC23 SEM variante passa a produzir NAPA SOFT (o correto).
--   • Vender COM a variante NAPA SOFT dá o mesmo resultado — a variante deixa de
--     ser a única coisa segurando o material certo.
--   • O aviso "o material da ficha não tem variante" some, porque a ficha e a
--     variante passam a concordar.
--
-- ⚠ Não recalcula OP em produção nem snapshot congelado — é a regra do projeto
-- (ver project_cost_snapshot_freeze_gotcha). Vale de agora em diante.

UPDATE public.technical_sheets
   SET lining_material = 'NAPA SOFT',
       -- O pin de SKU apontava um produto de NAPA SUDANI; deixar o pin com a
       -- troca de grupo faria o débito continuar puxando SUDANI (pin vence grupo).
       lining_material_product_id = NULL,
       updated_at = now()
 WHERE upper(btrim(name)) = 'EC23'
   AND upper(btrim(COALESCE(lining_material, ''))) = 'NAPA SUDANI';
