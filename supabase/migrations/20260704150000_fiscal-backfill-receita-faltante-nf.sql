-- =============================================================================
-- AUDITORIA FISCAL — Backfill (B): receita faltante de NF-e autorizada
-- =============================================================================
-- PVs com NF-e AUTORIZADA mas receita zero (C2: o caminho fiscal só fazia
-- UPDATE status='Faturado' e nunca criava receita/AR — corrigido forward no
-- lote 6). Gera receita BRUTA (total) + AR por parcela (payment_condition).
-- AR só onde falta (alguns PVs já tinham AR do estágio 'Aprovado' — guarda
-- NOT EXISTS por parcela). Factoring: receita bruta correta; a despesa de
-- desconto factoring dos PVs com is_factoring fica como refinamento menor.
-- 8 PVs / R$26.936. Aplicada via MCP em 2026-06-01. Idempotente (NOT EXISTS
-- receita pula PVs já reconhecidos).
-- =============================================================================
DO $$
DECLARE r RECORD; days int[]; n int; i int; base date; cents bigint; base_cent bigint; amt numeric; due date;
BEGIN
  FOR r IN
    SELECT so.id, so.order_number, so.total, so.client_name, so.client_cnpj,
           so.payment_condition, so.delivery_deadline, so.created_at
    FROM public.sale_orders so
    WHERE EXISTS (SELECT 1 FROM public.nfe_emitidas n WHERE n.sale_order_id = so.id AND n.status='autorizada')
      AND NOT EXISTS (SELECT 1 FROM public.financial_entries fe
                      WHERE fe.reference_type='sale_order' AND fe.type='receita'
                        AND fe.reference_id = so.id::text AND fe.status IN ('confirmed','posted','paid','reconciled'))
  LOOP
    INSERT INTO public.financial_entries (description, amount, type, entry_date, reference_id, reference_type, status, notes)
    VALUES ('Faturamento - '||COALESCE(r.client_name,'')||' - '||COALESCE(r.order_number,''), r.total, 'receita',
            CURRENT_DATE, r.id::text, 'sale_order', 'confirmed',
            'Backfill auditoria fiscal 2026-06-01: receita de NF-e autorizada que nao fora reconhecida');

    days := ARRAY(SELECT m[1]::int FROM regexp_matches(COALESCE(r.payment_condition,''), '\d+', 'g') AS m);
    IF days IS NULL OR array_length(days,1) IS NULL OR array_length(days,1)=0 THEN days := ARRAY[0]; END IF;
    n := array_length(days,1);
    base := COALESCE(r.delivery_deadline, r.created_at::date, CURRENT_DATE);
    cents := round(COALESCE(r.total,0)*100)::bigint;
    base_cent := (cents / n);
    FOR i IN 1..n LOOP
      IF NOT EXISTS (SELECT 1 FROM public.accounts_receivable WHERE sale_order_id = r.id AND installment_number = i) THEN
        due := base + (days[i] || ' days')::interval;
        amt := CASE WHEN i=n THEN (cents - base_cent*(n-1))/100.0 ELSE base_cent/100.0 END;
        INSERT INTO public.accounts_receivable
          (description, client_name, client_cnpj, sale_order_id, category, due_date, amount, status, installment_number, total_installments, notes)
        VALUES ('Pedido '||COALESCE(r.order_number, r.id::text)||CASE WHEN n>1 THEN ' ('||i||'/'||n||')' ELSE '' END,
                r.client_name, r.client_cnpj, r.id, 'venda', due, amt, 'pending', i, n,
                'Backfill auditoria fiscal 2026-06-01');
      END IF;
    END LOOP;
  END LOOP;
END $$;
