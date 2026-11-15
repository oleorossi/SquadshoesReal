-- Já aplicada no cknb (15/11/2026) via MCP com o carimbo de calendário 20261115130115 (acl_validador_prazos_pagamento_check).
-- Idempotente: pode ser reexecutada pelo workflow de migrations sem efeito adicional
-- (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, GRANT/REVOKE determinísticos).
-- is_valid_strap_payment_terms é usado em CHECK de suppliers, purchase_orders, purchase_receipts e
-- purchase_demand_contributions: quem grava nessas tabelas precisa de EXECUTE (função pura, sem efeito).
GRANT EXECUTE ON FUNCTION public.is_valid_strap_payment_terms(jsonb) TO authenticated, service_role;
