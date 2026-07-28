-- Fecha achado da auditoria independente (throw latente em render de
-- resolveConversionFactors): o CHECK anterior permitia conversion_rate NULL.
-- JÁ APLICADO via MCP. Exige rate>0 só quando a unidade de compra difere da de
-- estoque (estado que dispara o throw). 0 linhas violam. Idempotente.
alter table public.products drop constraint if exists products_conversion_rate_positive;
alter table public.products add constraint products_conversion_rate_positive
  check (
    conversion_rate > 0
    OR coalesce(purchase_order_unit, purchase_unit) is null
    OR lower(trim(coalesce(purchase_order_unit, purchase_unit))) = lower(trim(unit))
  );
