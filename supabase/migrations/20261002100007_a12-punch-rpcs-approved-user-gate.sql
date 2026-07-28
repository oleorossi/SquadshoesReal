-- ============================================================================
-- A12 (auditoria 2026-07-28) — punch_map_resolve / get_punch_reconciliation:
-- SECURITY DEFINER liberadas a qualquer authenticated sem is_approved_user().
--
-- As duas RPCs (vivas = 20260627120000) contornam o RLS de punch_device_map
-- por design, mas foram GRANTed a authenticated sem o gate usado no resto do
-- RH (precedente: import_time_records_safe, mig 20260527190000; policies do
-- bucket timesheet-imports, mig 20260525130000). Qualquer conta logada — até
-- não aprovada — podia revincular device→funcionário e disparar o UPDATE em
-- massa de time_records.employee_id, corrompendo a identidade do ponto que
-- alimenta pagamento.
--
-- Fix (diff mínimo sobre as definições vivas): gate
-- `IF NOT public.is_approved_user() THEN RAISE EXCEPTION` no início das duas.
-- get_punch_reconciliation vira plpgsql (era LANGUAGE sql, que não comporta o
-- gate) com o MESMO SELECT em RETURN QUERY; contrato (assinatura/colunas)
-- inalterado. Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_punch_reconciliation()
 RETURNS TABLE(device_id text, device_label text, batidas bigint, primeira_batida date, ultima_batida date, status text, employee_id uuid, employee_name text, suggested_employee_id uuid, suggested_name text, suggestion_score real)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  RETURN QUERY
  with dev as (
    select tr.employee_external_id as device_id,
           max(tr.employee_name)   as device_label,
           count(*)                as batidas,
           min(tr.record_date)     as primeira_batida,
           max(tr.record_date)     as ultima_batida
    from public.time_records tr
    where tr.employee_external_id is not null
      and btrim(tr.employee_external_id) <> ''
    group by tr.employee_external_id
  ),
  sugg as (
    select d.device_id,
           e.id   as suggested_employee_id,
           e.name as suggested_name,
           similarity(lower(coalesce(d.device_label, '')), lower(e.name)) as score,
           row_number() over (
             partition by d.device_id
             order by similarity(lower(coalesce(d.device_label, '')), lower(e.name)) desc, e.name
           ) as rn
    from dev d
    cross join public.employees e
    where e.active = true
  )
  select d.device_id,
         d.device_label,
         d.batidas,
         d.primeira_batida,
         d.ultima_batida,
         coalesce(m.status, 'pendente') as status,
         m.employee_id,
         le.name as employee_name,
         s.suggested_employee_id,
         s.suggested_name,
         s.score as suggestion_score
  from dev d
  left join public.punch_device_map m on m.device_id = d.device_id
  left join public.employees le on le.id = m.employee_id
  left join sugg s on s.device_id = d.device_id and s.rn = 1
  order by (m.employee_id is null) desc, d.batidas desc;
END;
$function$;

CREATE OR REPLACE FUNCTION public.punch_map_resolve(p_device_id text, p_employee_id uuid, p_device_label text, p_status text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_approved_user() then
    raise exception 'Permission denied: usuário não aprovado';
  end if;

  if p_status not in ('vinculado','ignorado','pendente') then
    raise exception 'status invalido: %', p_status;
  end if;
  if p_status = 'vinculado' and p_employee_id is null then
    raise exception 'vinculo requer employee_id';
  end if;

  insert into public.punch_device_map (device_id, employee_id, device_label, status, notes, created_by, updated_at)
  values (
    p_device_id,
    case when p_status = 'vinculado' then p_employee_id else null end,
    p_device_label,
    p_status,
    p_notes,
    auth.uid(),
    now()
  )
  on conflict (device_id) do update
    set employee_id  = case when p_status = 'vinculado' then p_employee_id else null end,
        device_label = coalesce(excluded.device_label, public.punch_device_map.device_label),
        status       = excluded.status,
        notes        = excluded.notes,
        updated_at   = now();

  if p_status = 'vinculado' then
    update public.time_records tr
       set employee_id = p_employee_id
     where tr.employee_external_id = p_device_id
       and tr.employee_id is distinct from p_employee_id;
  else
    update public.time_records tr
       set employee_id = null
     where tr.employee_external_id = p_device_id
       and tr.employee_id is not null;
  end if;
end; $function$;
