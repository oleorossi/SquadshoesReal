-- ════════════════════════════════════════════════════════════════════════
-- Fase 1 — Reconciliação de prestadores e vínculo do ponto.
--
-- Objetivo: dar identidade CONFIÁVEL às batidas antes de qualquer cálculo de
-- pagamento. Hoje `time_records` liga aos prestadores só por texto
-- (employee_name / employee_external_id), sem FK, e ~53% das batidas não casam.
--
-- Esta migration cria a infra de vínculo N:1 (vários IDs de relógio → 1
-- prestador) e a resolução automática na importação. A DESAMBIGUAÇÃO é decisão
-- do operador (tela de reconciliação) — o sistema só SUGERE.
--
-- ⚠ Fora de escopo (adiado p/ Fase 2 — motor de pagamento): a normalização de
-- `employees.payment_type` (§1.1 da spec). Os valores legados
-- ('mensalista'/'diarista'/'remoto') estão cravados na folha ATIVA
-- (salaryPayroll.ts, useMonthlyClosing.ts, FechamentoMensal.tsx, …); migrá-los
-- agora quebraria esses caminhos silenciosamente. Vai junto com a Fase 2, que
-- reescreve o cálculo.
-- ════════════════════════════════════════════════════════════════════════

-- pg_trgm: usado pela sugestão de match (similaridade nome do relógio × cadastro).
create extension if not exists pg_trgm with schema extensions;

-- ── 1.2 Mapa relógio → prestador (N:1) ───────────────────────────────────
create table if not exists public.punch_device_map (
  id            uuid primary key default gen_random_uuid(),
  device_id     text not null,              -- employee_external_id do relógio (ex.: "8","14","20")
  employee_id   uuid references public.employees(id),
  device_label  text,                       -- nome bruto que aparece no relógio (ex.: "edsonChevet")
  status        text not null default 'pendente'
                check (status in ('pendente','vinculado','ignorado')),
  notes         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (device_id)
);
create index if not exists idx_punch_device_map_emp on public.punch_device_map(employee_id);

-- RLS on, sem policy pública: a tela acessa só via RPCs SECURITY DEFINER.
alter table public.punch_device_map enable row level security;

-- ── 1.3 Vínculo resolvido em time_records ────────────────────────────────
alter table public.time_records add column if not exists employee_id uuid references public.employees(id);
create index if not exists idx_time_records_emp on public.time_records(employee_id);
create index if not exists idx_time_records_emp_date on public.time_records(employee_id, record_date);

-- ── 1.4 Resolução automática na importação ───────────────────────────────
-- Ao inserir/atualizar uma batida, preenche employee_id a partir do mapa
-- (só vínculos 'vinculado'). Importações novas resolvem sozinhas.
create or replace function public.resolve_time_record_employee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select m.employee_id into new.employee_id
  from public.punch_device_map m
  where m.device_id = new.employee_external_id
    and m.status = 'vinculado';
  return new;
end; $$;

drop trigger if exists trg_resolve_tr_employee on public.time_records;
create trigger trg_resolve_tr_employee
  before insert or update of employee_external_id on public.time_records
  for each row execute function public.resolve_time_record_employee();

-- ── RPC: seed da tela de reconciliação (§2) ──────────────────────────────
-- 1 linha por device_id distinto do relógio, com total de batidas, período,
-- status atual e a MELHOR sugestão de prestador (similaridade de nome, trgm).
-- SECURITY DEFINER: a tela (authenticated) lê sem depender de RLS das bases.
create or replace function public.get_punch_reconciliation()
returns table (
  device_id             text,
  device_label          text,
  batidas               bigint,
  primeira_batida       date,
  ultima_batida         date,
  status                text,
  employee_id           uuid,
  employee_name         text,
  suggested_employee_id uuid,
  suggested_name        text,
  suggestion_score      real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
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
$$;

-- ── RPC: aplicar decisão do operador (vincular / ignorar / pendente) ──────
-- Faz upsert no mapa E o backfill/cleanup do vínculo histórico em time_records.
create or replace function public.punch_map_resolve(
  p_device_id    text,
  p_employee_id  uuid,
  p_device_label text,
  p_status       text,
  p_notes        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('vinculado','ignorado','pendente') then
    raise exception 'status inválido: %', p_status;
  end if;
  if p_status = 'vinculado' and p_employee_id is null then
    raise exception 'vínculo requer employee_id';
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

  -- Backfill (§3) / cleanup do vínculo histórico.
  if p_status = 'vinculado' then
    update public.time_records tr
       set employee_id = p_employee_id
     where tr.employee_external_id = p_device_id
       and tr.employee_id is distinct from p_employee_id;
  else
    -- ignorado/pendente → desfaz o vínculo das batidas desse device.
    update public.time_records tr
       set employee_id = null
     where tr.employee_external_id = p_device_id
       and tr.employee_id is not null;
  end if;
end; $$;

grant execute on function public.get_punch_reconciliation() to authenticated;
grant execute on function public.punch_map_resolve(text, uuid, text, text, text) to authenticated;

-- Backfill inicial (no-op enquanto o mapa está vazio; idempotente).
update public.time_records tr
   set employee_id = m.employee_id
  from public.punch_device_map m
 where m.device_id = tr.employee_external_id
   and m.status = 'vinculado'
   and tr.employee_id is distinct from m.employee_id;

comment on table public.punch_device_map is
  'Fase 1: mapa N:1 de IDs de relógio (device_id) → prestador (employee). Fonte de verdade do vínculo do ponto.';
