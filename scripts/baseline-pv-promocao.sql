-- Gabarito da promoção de PV para produção — Fase 0 de
-- specs/pv-producao-performance-e-pendencias.md
--
-- Rode ANTES e DEPOIS da troca do motor (promote_sale_order_to_production).
-- A saída das duas execuções tem que ser idêntica para os PVs já promovidos.
--
-- ⚠ Descoberta de 03/08/2026: a promoção NÃO gera stock_movements — gera
-- material_reservations. O movimento nasce depois, na liberação. Um gabarito que
-- olhasse só para stock_movements daria "0 = 0" e não provaria nada.

-- 1) Resumo por PV promovido -------------------------------------------------
select
  so.order_number                                              as pv,
  so.status,
  count(distinct soi.id)                                       as itens,
  count(distinct o.id) filter (where o.status <> 'Cancelada')  as ops,
  count(distinct os.id)                                        as estagios,
  count(distinct mr.id)                                        as reservas,
  count(distinct sm.id)                                        as movimentos
from sale_orders so
left join sale_order_items  soi on soi.sale_order_id = so.id
left join orders            o   on o.sale_order_id   = so.id and o.status <> 'Cancelada'
left join order_stages      os  on os.order_id       = o.id
left join material_reservations mr on mr.order_id    = o.id
left join stock_movements   sm  on sm.order_id       = o.id
where so.status in ('Aprovado', 'Em Produção')
group by 1, 2
having count(distinct o.id) filter (where o.status <> 'Cancelada') > 0
order by itens desc, pv;

-- 2) Impressão digital por OP ------------------------------------------------
-- Trocar o PV alvo conforme necessário. PV-00148 é o maior (12 itens) e é o
-- que a Definition of Done usa como caso de referência.
select
  so.order_number as pv,
  o.order_number  as op,
  o.status        as op_status,
  o.quantity,
  coalesce(nullif(o.color, ''), '—')                                            as cor,
  (select count(*)  from order_stages s        where s.order_id = o.id)         as estagios,
  (select count(*)  from material_reservations r where r.order_id = o.id)       as reservas,
  (select round(sum(r.quantity_reserved)::numeric, 3)
     from material_reservations r where r.order_id = o.id)                      as qtd_reservada,
  (select count(*)  from stock_movements m     where m.order_id = o.id)         as movimentos,
  o.planned_delivery,
  o.is_ahead_of_schedule as adiantada
from sale_orders so
join orders o on o.sale_order_id = so.id and o.status <> 'Cancelada'
where so.order_number = 'PV-00148'
order by o.order_number;

-- 3) Guardas que já existem no banco -----------------------------------------
-- Rodar pelo app (usuário aprovado) — o guard is_approved_user() bloqueia
-- conexões de serviço/MCP:
--   select * from run_consumption_parity_tests();
--   select * from run_consumption_integration_tests();
--   select classe, count(*) from debit_consistency_report(current_date - 400, current_date, true) group by 1;
--   select * from consumption_consistency_report();
