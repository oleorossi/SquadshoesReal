-- ════════════════════════════════════════════════════════════════════════
-- Gestão de OS (Fase B) — view de visão geral: pagamento + saldo de recebimento
--
-- Junta, por Ordem de Serviço:
--   • PAGAMENTO — a accounts_payable criada na finalização (tg_create_ap_for_service_order),
--     com status (pending/paid), valor, vencimento e data de pagamento.
--   • SALDO (recebimento parcial) — reaproveita v_service_order_balance
--     (enviado / devolvido bom / defeito / perda / na rua).
--
-- A OS tem no MÁXIMO uma AP (o trigger faz guard de duplicidade), mas usamos
-- LATERAL com prioridade pra não-cancelada por segurança. View read-only consumida
-- pelo hook useServiceOrderOverview no frontend — não altera nenhum fluxo existente.
-- ════════════════════════════════════════════════════════════════════════

create or replace view public.v_service_order_overview as
select
  so.id as service_order_id,
  -- ── Pagamento (accounts_payable) ──
  ap.id            as accounts_payable_id,
  ap.status        as payment_status,        -- 'pending' | 'paid' | (nulo se sem AP)
  ap.amount        as payable_amount,
  ap.due_date      as payment_due_date,
  ap.payment_date  as payment_date,
  (ap.id is not null)                  as has_payable,
  coalesce(ap.status = 'paid', false)  as is_paid,
  -- ── Saldo de recebimento parcial (v_service_order_balance) ──
  bal.qty_sent,
  bal.qty_returned_good,
  bal.qty_returned_defect,
  bal.qty_loss,
  bal.qty_in_field,
  bal.last_return_at
from public.service_orders so
left join lateral (
  select ap2.id, ap2.status, ap2.amount, ap2.due_date, ap2.payment_date
  from public.accounts_payable ap2
  where ap2.reference_type = 'service_order'
    and ap2.reference_id = so.id
  -- prioriza AP não-cancelada; entre elas, a de vencimento mais recente
  order by case when ap2.status in ('cancelled','cancelado','estornado') then 1 else 0 end,
           ap2.due_date desc nulls last
  limit 1
) ap on true
left join public.v_service_order_balance bal on bal.service_order_id = so.id;

comment on view public.v_service_order_overview is
  'Visão geral por OS: pagamento (AP: status/valor/vencimento) + saldo de recebimento parcial (enviado/devolvido/na rua). Read-only, consumida pelo hub Terceiros.';
