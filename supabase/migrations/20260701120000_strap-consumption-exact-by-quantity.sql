-- Consumo de TIRA exato por quantidade (2026-07-01): remove o arredondamento
-- pra ficha cheia do débito e da checagem de estoque. Antes:
--   v_fichas := GREATEST(1, ceil(p_order_quantity / v_grade_total))  (arredonda p/ cima)
-- Agora:
--   v_fichas := p_order_quantity / v_grade_total                     (fração exata)
-- Fica igual ao TS calculateStrapConsumptionCm e ao calculateGradeBasedDm2
-- (cabedal/forro/palmilha, que já eram exatos). NO-OP pros pedidos atuais (todos
-- fichas cheias); só muda quantidade fracionária futura.
-- Aplicado via patch do source VIVO (pg_get_functiondef) pra não recriar as
-- funções (~6k chars) à mão. IDEMPOTENTE: se o padrão já sumiu, não faz nada.
DO $mig$
DECLARE d text; n int := 0;
BEGIN
  FOR d IN
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname IN ('debit_strap_stock','check_stock_availability')
  LOOP
    IF position('GREATEST(1, ceil(p_order_quantity::numeric / v_grade_total))' in d) > 0 THEN
      d := replace(d,
        'GREATEST(1, ceil(p_order_quantity::numeric / v_grade_total))',
        '(p_order_quantity::numeric / v_grade_total)');
      EXECUTE d;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'strap exact-by-qty: % funcao(oes) atualizada(s)', n;
END $mig$;
