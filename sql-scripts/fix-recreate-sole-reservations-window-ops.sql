-- ⚠ CORREÇÃO DE DADOS — NÃO APLICAR SEM APROVAÇÃO DO USUÁRIO ⚠
-- Contexto: janela 2026-07-02→2026-07-09 com debit_sole_stock_by_grade quebrada
-- (22P02, COALESCE de enum na 20260902140000; corrigida na 20260910160000).
-- As OPs abaixo ficaram SEM a reserva soft kind='sole_grade' — se faturarem
-- assim, convert_reservation_to_out não baixa solado nenhum (estoque fantasma).
--
-- Escopo DELIBERADAMENTE restrito a OPs sem NENHUM risco de duplo débito:
--   • PV-00146 (OP-2026-01139/40/41) — criadas 05/07 DENTRO da janela;
--   • PV-00145 (OP-2026-01142/43)    — criadas 08/07 DENTRO da janela;
--   • PV-00141 (OP-2026-01125/26/27) — criadas 30/06; reservas apagadas pelo
--     re-débito de edição de PV na janela; nunca faturadas (último movimento
--     detached de solado é de 20/06 — não pode ser delas).
-- FORA do escopo (decidir com contagem física — ver relatório):
--   OPs Finalizadas legadas, PV-2026-00097 (legada, vintage incerto) e
--   PV-2026-00094 (PV cancelado).
--
-- Efeito: apenas INSERT de reserva soft (metadata sole_grade) + sync de
-- reserved_stock. NÃO altera products.stock_grade nem quantity.
-- Idempotente: a função deleta reservas sole_grade/sole_pending_grade da OP
-- antes de inserir. Uso: workflow supabase-db-exec.yml (strict=true).
DO $$
DECLARE
  v_op RECORD; v_n int := 0;
BEGIN
  -- is_approved_user() lê auth.uid() do claim (mesmo padrão do E2E DS22)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '49371f4d-641f-466d-be26-686ef57743ec')::text, true);

  FOR v_op IN
    SELECT o.id, o.reference_id, o.color, o.grade, o.order_number
      FROM public.orders o
     WHERE o.order_number IN ('OP-2026-01125','OP-2026-01126','OP-2026-01127',
                              'OP-2026-01139','OP-2026-01140','OP-2026-01141',
                              'OP-2026-01142','OP-2026-01143')
       AND o.status NOT ILIKE '%cancel%'
     ORDER BY o.order_number
  LOOP
    PERFORM public.debit_sole_stock_by_grade(
      v_op.reference_id, v_op.id, COALESCE(v_op.color, ''), v_op.grade, true);
    v_n := v_n + 1;
    RAISE NOTICE 'reserva sole_grade recriada: %', v_op.order_number;
  END LOOP;
  RAISE NOTICE 'total de OPs re-reservadas: %', v_n;
END $$;

-- Verificação: cada OP deve ter exatamente 1 reserva viva kind='sole_grade'
SELECT o.order_number, p.name AS solado, p.color AS cor_solado, mr.status,
       mr.quantity_reserved, mr.metadata -> 'effective_grade' AS grade_reservada
  FROM public.orders o
  JOIN public.material_reservations mr
    ON mr.order_id = o.id AND mr.metadata ->> 'kind' = 'sole_grade'
  JOIN public.products p ON p.id = mr.product_id
 WHERE o.order_number IN ('OP-2026-01125','OP-2026-01126','OP-2026-01127',
                          'OP-2026-01139','OP-2026-01140','OP-2026-01141',
                          'OP-2026-01142','OP-2026-01143')
 ORDER BY o.order_number;
