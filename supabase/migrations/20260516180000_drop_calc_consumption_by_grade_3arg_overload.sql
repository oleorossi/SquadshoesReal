-- Remove o overload 3-arg de calculate_order_consumption_by_grade, que era
-- apenas um shim chamando o 4-arg com NULL pro p_material_variant_id. A
-- existência dos 2 overloads tornava qualquer chamada com 3 args ambígua
-- (PostgreSQL 42725 — function is not unique). O 4-arg com DEFAULT NULL::uuid
-- já cobre chamadores antigos (hybrid_debit_stock_for_order etc.).
--
-- Causa raiz: na auditoria Round 2 (20260524150000_audit-round-2-fixes.sql)
-- foi adicionado p_material_variant_id ao 4-arg, mas o 3-arg ficou como
-- compat shim — Postgres aceita por arity mas não consegue decidir entre
-- os 2 quando recebe 3 args. Resync de OPs falhava intermitentemente com
-- "function is not unique" mascarado por outras mensagens upstream.
--
-- Aplicado via MCP em 2026-05-15. Registrado aqui pra rastreabilidade.

DROP FUNCTION IF EXISTS public.calculate_order_consumption_by_grade(uuid, jsonb, text);
