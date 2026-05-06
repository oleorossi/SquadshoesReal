-- ============================================================================
-- Audit log for sole standard items consumption changes
-- ============================================================================
create table if not exists public.sole_standard_items_audit (
  id              uuid primary key default gen_random_uuid(),
  sole_product_id uuid not null,
  standard_item_id uuid not null,
  size            integer not null,
  old_consumption numeric(12,4),
  new_consumption numeric(12,4),
  old_unit        text,
  new_unit        text,
  action          text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);

create index if not exists idx_ssi_audit_sole on public.sole_standard_items_audit (sole_product_id, changed_at desc);
create index if not exists idx_ssi_audit_item on public.sole_standard_items_audit (standard_item_id, changed_at desc);

alter table public.sole_standard_items_audit enable row level security;

-- Read-only for approved users
drop policy if exists "Approved users can view audit"     on public.sole_standard_items_audit;
drop policy if exists "Block client writes audit"         on public.sole_standard_items_audit;

create policy "Approved users can view audit"
  on public.sole_standard_items_audit
  for select
  to authenticated
  using (public.is_approved_user());

-- Block direct INSERT/UPDATE/DELETE — only the trigger (security definer) writes here.
create policy "Block client writes audit"
  on public.sole_standard_items_audit
  for all
  to authenticated
  using (false)
  with check (false);

-- ─── Trigger function ───────────────────────────────────────────────────────
create or replace function public.log_sole_standard_items_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.sole_standard_items_audit
      (sole_product_id, standard_item_id, size,
       old_consumption, new_consumption, old_unit, new_unit, action, changed_by)
    values
      (new.sole_product_id, new.standard_item_id, new.size,
       null, new.consumption, null, new.unit, 'INSERT', auth.uid());
    return new;
  elsif (tg_op = 'UPDATE') then
    if (old.consumption is distinct from new.consumption
        or old.unit is distinct from new.unit) then
      insert into public.sole_standard_items_audit
        (sole_product_id, standard_item_id, size,
         old_consumption, new_consumption, old_unit, new_unit, action, changed_by)
      values
        (new.sole_product_id, new.standard_item_id, new.size,
         old.consumption, new.consumption, old.unit, new.unit, 'UPDATE', auth.uid());
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.sole_standard_items_audit
      (sole_product_id, standard_item_id, size,
       old_consumption, new_consumption, old_unit, new_unit, action, changed_by)
    values
      (old.sole_product_id, old.standard_item_id, old.size,
       old.consumption, null, old.unit, null, 'DELETE', auth.uid());
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sole_standard_items_audit on public.sole_standard_items_consumption;
create trigger trg_sole_standard_items_audit
after insert or update or delete on public.sole_standard_items_consumption
for each row execute function public.log_sole_standard_items_change();
