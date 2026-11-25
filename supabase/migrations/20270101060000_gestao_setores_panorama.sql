-- =============================================================================
-- Gestão · Setores — panorama de leitura em UMA chamada (25/11/2026)
--
-- Por quê: a aba nova "Setores" da Central de Produção precisa cruzar a fila do
-- motor (v_production_queue_detail, na ordem que o motor devolve), a agenda por
-- setor×dia (production_schedule do último run), as etapas abertas de cada OP
-- (order_stages), o gate de material (orders) e o cabedal complexo do Ateliê
-- (cabedal_prep_jobs). Pelo cliente isso eram 8+ idas ao servidor, três delas
-- em série. Aqui é uma só, filtrada às OPs da fila.
--
-- Contrato:
--   • SOMENTE LEITURA. STABLE + SECURITY INVOKER (RLS do chamador vale).
--     Nada aqui chama função que trave linha (FOR UPDATE): o PostgREST roda
--     STABLE em transação read-only (lição da 20270101054300).
--   • NÃO recalcula nem reordena a fila: consome queue_position, late_days e
--     projected_completion exatamente como o motor publica. Se o motor mudar
--     a ordem, a tela acompanha sem tocar nesta função.
--   • Pares reais = remaining_pairs_net (remaining_pairs é carga pares·setor).
-- =============================================================================

create or replace function public.get_sector_panorama(
  p_from date default null,
  p_days integer default 28
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, br_today());
  v_to   date := coalesce(p_from, br_today()) + greatest(1, least(coalesce(p_days, 28), 120));
  v_out  jsonb;
begin
  with q as (
    select d.*
      from v_production_queue_detail d
  ),
  o as (
    select o.id, o.sale_order_item_id, o.is_ahead_of_schedule,
           o.material_ready_date, o.material_gate_reason
      from orders o
     where o.id in (select order_id from q)
  ),
  so as (
    select s.id, s.status, s.deleted_at
      from sale_orders s
     where s.id in (select sale_order_id from q where sale_order_id is not null)
  ),
  jobs as (
    select o.id as order_id,
           jsonb_agg(jsonb_build_object(
             'sector', j.sector,
             'status', j.pipeline_status,
             'mode', j.execution_mode,
             'pairs', coalesce(j.pairs, 0),
             'received_pairs', coalesce(j.received_pairs, 0),
             'target_end', j.target_end
           ) order by j.sector) as atelier
      from o
      join cabedal_prep_jobs j
        on j.sale_order_item_id = o.sale_order_item_id
       and j.pipeline_status <> 'cancelled'
     group by o.id
  ),
  stg as (
    select os.order_id,
           jsonb_agg(jsonb_build_object(
             'sector', os.stage_name,
             'stage_order', os.stage_order,
             'status', os.status,
             'remaining', greatest(0, coalesce(os.quantity_total, 0) - coalesce(os.quantity_processed, 0)),
             'blocked_until', os.blocked_until
           ) order by os.stage_order) as open_stages
      from order_stages os
     where os.order_id in (select order_id from q)
       and os.status <> 'concluido'
     group by os.order_id
  ),
  sched as (
    select jsonb_agg(jsonb_build_object(
             'order_id', ps.order_id,
             'sector', ps.sector,
             'date', ps.date,
             'planned_pairs', ps.planned_pairs,
             'carryover_pairs', ps.carryover_pairs,
             'day_fraction', coalesce(ps.day_fraction, 0)
           ) order by ps.date, ps.sector) as rows
      from production_schedule ps
     where ps.recalc_run_id = latest_schedule_run_id()
       and ps.date >= v_from
       and ps.date < v_to
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'generated_at', now(),
    'last_run', (
      select jsonb_build_object('ran_at', r.ran_at, 'ran_on', r.ran_on)
        from production_engine_runs r
       order by r.ran_at desc
       limit 1
    ),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sector', ss.sector,
               'flow_order', ss.flow_order,
               'enabled', ss.enabled,
               'parallel_group', ss.parallel_group,
               'daily_capacity_pairs', ss.daily_capacity_pairs
             ) order by ss.flow_order, ss.sector)
        from sector_settings ss
    ), '[]'::jsonb),
    'ops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', q.order_id,
               'order_number', q.order_number,
               'order_status', q.order_status,
               'queue_status', q.queue_status,
               'queue_position', q.queue_position,
               'pinned_position', q.pinned_position,
               'sale_order_id', q.sale_order_id,
               'sale_order_number', q.sale_order_number,
               'sale_order_status', so.status,
               'sale_order_deleted_at', so.deleted_at,
               'client_name', q.client_name,
               'reference_id', q.reference_id,
               'reference_name', q.reference_name,
               'color', q.color,
               'quantity', q.quantity,
               'remaining_pairs_net', q.remaining_pairs_net,
               'due_date', q.due_date,
               'projected_completion', q.projected_completion,
               'next_scheduled_date', q.next_scheduled_date,
               'late_days', q.late_days,
               'route_progress_pct', q.route_progress_pct,
               'is_ahead_of_schedule', coalesce(o.is_ahead_of_schedule, false),
               'material_ready_date', o.material_ready_date,
               'material_gate_reason', o.material_gate_reason,
               'atelier', coalesce(jobs.atelier, '[]'::jsonb),
               'open_stages', coalesce(stg.open_stages, '[]'::jsonb)
             ) order by q.queue_position)
        from q
        left join o    on o.id = q.order_id
        left join so   on so.id = q.sale_order_id
        left join jobs on jobs.order_id = q.order_id
        left join stg  on stg.order_id = q.order_id
    ), '[]'::jsonb),
    'schedule', coalesce((select rows from sched), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$$;

comment on function public.get_sector_panorama(date, integer) is
  'Gestão · Setores: fila do motor + agenda setor×dia + etapas abertas + gate de material + cabedal complexo, numa leitura só. SOMENTE LEITURA; não reordena a fila.';

revoke all on function public.get_sector_panorama(date, integer) from public;
grant execute on function public.get_sector_panorama(date, integer) to authenticated, service_role;
