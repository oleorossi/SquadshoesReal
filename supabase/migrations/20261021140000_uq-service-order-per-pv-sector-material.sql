-- Índice único que faltava para o atalho "Gerar OS" do modal de Consumo do PV.
--
-- Os dois índices que existiam NÃO cobrem esse caminho:
--   uq_os_per_op_sector                        exige order_id                (fica NULL aqui)
--   uq_service_order_per_pv_item_terceirizacao exige source_terceirizacao_id (idem)
-- A única guarda era estado de UI (existingOsByKey), então duas abas duplicavam.
--
-- ⚠ Não era só risco: em 31/07/2026 foram encontradas 12 OS duplicadas no
-- PV-00148, criadas entre 06:59:27 e 06:59:37 de 22/07 (dez segundos), todas
-- 'Pendente' com total_value 0. As 7 excedentes foram CANCELADAS (não apagadas,
-- pra preservar o rastro) mantendo a primeira de cada grupo.
--
-- 'Cancelado' fica fora do índice de propósito: permite refazer a OS depois de
-- cancelar uma errada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_per_pv_sector_material
  ON public.service_orders (
    sale_order_id, target_sector,
    lower(btrim(coalesce(material_color, ''))),
    lower(btrim(coalesce(description, '')))
  )
  WHERE sale_order_id IS NOT NULL
    AND target_sector IS NOT NULL
    AND order_id IS NULL
    AND source_terceirizacao_id IS NULL
    AND status <> ALL (ARRAY['Cancelado','cancelled','cancelada']);
