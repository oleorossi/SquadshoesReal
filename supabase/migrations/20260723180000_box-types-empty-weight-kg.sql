-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria NF-e/embalagem 2026-06-11 — box_types.empty_weight_kg
-- ════════════════════════════════════════════════════════════════════════════
-- Peso da CAIXA VAZIA (tara), em KG, sem ambiguidade. A coluna existente
-- box_types.peso_kg é ambígua — o nome diz "kg" mas a UI rotula/exibe em "g"
-- (PackagingStockPanel mostra `${peso_kg} g`), então não dá pra usar com
-- segurança no cálculo de peso bruto da NF. Esta coluna é a tara canônica em kg.
--
-- Usada por calculate_sale_order_weight (peso bruto = peso líquido +
-- Σ(nº de caixas × empty_weight_kg)). Quando NULL → backward-compat: o cálculo
-- cai no modelo legado por-par (technical_sheets.box_weight_kg × pares).
ALTER TABLE public.box_types
  ADD COLUMN IF NOT EXISTS empty_weight_kg numeric;

COMMENT ON COLUMN public.box_types.empty_weight_kg IS
  'Peso da caixa VAZIA (tara) em KG. Fonte canônica pro peso bruto da NF-e '
  '(pesoB = pesoL + Σ nº_caixas × empty_weight_kg). NULL → cálculo cai no '
  'modelo legado por-par (technical_sheets.box_weight_kg). Não confundir com '
  'a coluna ambígua peso_kg (exibida em g na UI).';
