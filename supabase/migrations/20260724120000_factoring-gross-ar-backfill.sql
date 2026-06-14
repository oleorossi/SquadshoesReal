-- =============================================================================
-- Decisão Leonardo 2026-06-14 — Factoring 1A: AR BRUTA + juros separados
-- =============================================================================
-- Top10 #2 (parte 1/3). Até agora syncFinancialRecords gravava a AR de PVs com
-- factoring pelo valor LÍQUIDO (present value descontado) E também criava uma
-- linha de despesa financeira separada (reference_type='sale_order_factoring').
-- Resultado: o juros do factoring entrava 2× na DRE — embutido na AR líquida E
-- na linha de despesa. O código (useSaleOrders.ts) passou a gravar a AR BRUTA;
-- esta migration corrige os PVs HISTÓRICOS pra ficarem consistentes.
--
-- Estratégia (CONSERVADORA):
--   • Só mexe em PVs com factoring que ainda têm parcela(s) ABERTA(s) (não
--     recebidas). PVs totalmente recebidos ficam INTOCADOS — não reescrevemos
--     livro fechado (a decisão pede "preserva o amount_received").
--   • A AR bruta-alvo por PV = sale_orders.total (valor cheio da venda).
--   • Distribui o aumento (bruto − líquido) só nas parcelas abertas; as parcelas
--     já recebidas mantêm amount e amount_received originais.
--   • Garante 1 linha de despesa de juros (sale_order_factoring) por PV — usa a
--     existente se houver; senão cria com amount = bruto − líquido.
--   • IDEMPOTENTE: se a soma das parcelas ativas já bate o bruto (PV já migrado
--     ou sem desconto), pula.
-- =============================================================================

DO $backfill$
DECLARE
  v_pv          RECORD;
  v_gross       numeric;
  v_net_active  numeric;
  v_received    numeric;
  v_open_sum    numeric;
  v_open_count  int;
  v_entry_amt   numeric;
  v_discount    numeric;
  v_target_open numeric;
  v_scale       numeric;
  v_new_open    numeric;
  v_residual    numeric;
  v_last_id     uuid;
  v_entry_date  date;
  n_bumped      int := 0;
  n_entries     int := 0;
  n_skip_gross  int := 0;
  n_skip_closed int := 0;
BEGIN
  FOR v_pv IN
    SELECT id, total, delivery_deadline, created_at, client_name, order_number
      FROM public.sale_orders
     WHERE is_factoring = true
  LOOP
    v_gross := COALESCE(v_pv.total, 0);
    IF v_gross <= 0 THEN
      CONTINUE; -- sem valor bruto conhecido → não dá pra reconstruir
    END IF;

    SELECT COALESCE(SUM(amount), 0)
      INTO v_net_active
      FROM public.accounts_receivable
     WHERE sale_order_id = v_pv.id
       AND status NOT IN ('cancelled', 'cancelado');

    IF v_net_active <= 0 THEN
      CONTINUE; -- sem AR ativa
    END IF;

    -- Já bruto (migrado ou sem desconto efetivo)? Tolerância de 1 centavo/parcela.
    IF v_net_active >= v_gross - 0.01 THEN
      n_skip_gross := n_skip_gross + 1;
      CONTINUE;
    END IF;

    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status = 'received'), 0),
      COALESCE(SUM(amount) FILTER (WHERE status NOT IN ('received','cancelled','cancelado')), 0),
      COUNT(*)            FILTER (WHERE status NOT IN ('received','cancelled','cancelado'))
      INTO v_received, v_open_sum, v_open_count
      FROM public.accounts_receivable
     WHERE sale_order_id = v_pv.id;

    -- desconto/juros: usa a linha de despesa existente se houver; senão deriva.
    SELECT amount INTO v_entry_amt
      FROM public.financial_entries
     WHERE reference_type = 'sale_order_factoring'
       AND reference_id = v_pv.id::text
       AND status NOT IN ('cancelado','cancelled','estornado')
     LIMIT 1;
    v_discount := COALESCE(v_entry_amt, v_gross - v_net_active);

    -- garante a linha de despesa de juros (se ainda não existe e há desconto)
    IF v_entry_amt IS NULL AND v_discount > 0.01 THEN
      v_entry_date := COALESCE(v_pv.delivery_deadline, v_pv.created_at::date, CURRENT_DATE);
      INSERT INTO public.financial_entries (
        description, amount, type, entry_date,
        reference_id, reference_type, status, notes
      ) VALUES (
        'Juros factoring (backfill regime caixa) - ' || COALESCE(v_pv.client_name,'') || ' - ' || COALESCE(v_pv.order_number,''),
        round(v_discount, 2), 'despesa', v_entry_date,
        v_pv.id::text, 'sale_order_factoring', 'confirmed',
        'Linha de despesa financeira de juros de factoring criada retroativamente '
        || '(decisão Leonardo 2026-06-14, AR bruta). Valor = bruto - líquido original.'
      );
      n_entries := n_entries + 1;
    END IF;

    -- só reescreve a AR se houver parcela aberta pra absorver o aumento.
    IF v_open_count = 0 OR v_open_sum <= 0 THEN
      n_skip_closed := n_skip_closed + 1;
      CONTINUE; -- todas recebidas → preserva livro fechado
    END IF;

    v_target_open := v_gross - v_received;     -- o que falta receber, agora BRUTO
    IF v_target_open <= 0 THEN
      n_skip_closed := n_skip_closed + 1;
      CONTINUE; -- recebido já cobre/excede o bruto → não mexe
    END IF;

    v_scale := v_target_open / v_open_sum;

    -- bump proporcional das parcelas abertas
    UPDATE public.accounts_receivable
       SET amount = round(amount * v_scale, 2), updated_at = now()
     WHERE sale_order_id = v_pv.id
       AND status NOT IN ('received','cancelled','cancelado');

    -- corrige resíduo de arredondamento na última parcela aberta
    SELECT COALESCE(SUM(amount), 0)
      INTO v_new_open
      FROM public.accounts_receivable
     WHERE sale_order_id = v_pv.id
       AND status NOT IN ('received','cancelled','cancelado');
    v_residual := round(v_target_open - v_new_open, 2);

    IF v_residual <> 0 THEN
      SELECT id INTO v_last_id
        FROM public.accounts_receivable
       WHERE sale_order_id = v_pv.id
         AND status NOT IN ('received','cancelled','cancelado')
       ORDER BY installment_number DESC NULLS LAST, due_date DESC NULLS LAST
       LIMIT 1;
      IF v_last_id IS NOT NULL THEN
        UPDATE public.accounts_receivable
           SET amount = amount + v_residual, updated_at = now()
         WHERE id = v_last_id;
      END IF;
    END IF;

    n_bumped := n_bumped + 1;
  END LOOP;

  RAISE NOTICE 'Factoring AR-bruta backfill: % PVs ajustados p/ bruto, % linhas de juros criadas, % já-bruto pulados, % fechados/recebidos preservados (revisar manualmente se tinham juros embutidos na AR líquida).',
    n_bumped, n_entries, n_skip_gross, n_skip_closed;
END
$backfill$;
