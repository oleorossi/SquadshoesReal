-- Registro de pagamento da folha + recibo assinado (2026-07-01).
--
-- Contexto: `payroll_runs` já persiste a folha calculada (proventos/descontos/
-- líquido) com ciclo rascunho → aprovado → pago, mas NINGUÉM nunca conseguiu
-- marcar como paga: o trigger `tg_payroll_lock_finalized` bloqueava QUALQUER
-- update de uma folha 'aprovado'/'pago' (só deixava passar → 'cancelado' ou
-- no-op). Resultado em produção: 159 folhas, 0 pagas. O botão "Pagar" lançava
-- exceção silenciosa toda vez.
--
-- Esta migration:
--   1. cria `payroll_payments` (1 folha → N pagamentos: permite adiantamento +
--      saldo), cada pagamento com data/valor/método e o RECIBO ASSINADO
--      escaneado (guardado no bucket privado `employee-receipts`);
--   2. corrige `tg_payroll_lock_finalized` pra PERMITIR o toggle aprovado↔pago
--      (só status + paid_at podem mudar; os valores calculados continuam
--      travados) — mantendo a intenção original do lock;
--   3. sincroniza `payroll_runs.status`/`paid_at` a partir da soma dos
--      pagamentos, via trigger — a folha só vira 'pago' quando o total pago
--      cobre o líquido; se um pagamento for removido e cair abaixo, volta
--      pra 'aprovado'.
--
-- Idempotente e aditivo.

-- ── 1. Tabela de pagamentos ──────────────────────────────────────────
create table if not exists public.payroll_payments (
  id             uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id    uuid not null references public.employees(id),
  paid_on        date not null default current_date,
  amount         numeric not null check (amount > 0),
  method         text not null default 'pix'
                   check (method in ('pix','dinheiro','transferencia','cheque','outro')),
  reference      text default '',            -- txid Pix / nº do comprovante
  notes          text default '',
  -- recibo assinado (escaneado) — path no bucket privado 'employee-receipts'
  receipt_path   text default '',
  receipt_name   text default '',
  receipt_size   integer,
  receipt_mime   text default '',
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.payroll_payments is
  'Registro de pagamento da folha (1 folha → N pagamentos: adiantamento + saldo). '
  'Cada linha guarda valor/data/método e o recibo assinado escaneado '
  '(receipt_path no bucket employee-receipts). A folha vira ''pago'' quando a '
  'soma cobre payroll_runs.total_liquido (trigger tg_sync_payroll_paid).';

create index if not exists idx_payroll_payments_run on public.payroll_payments(payroll_run_id);
create index if not exists idx_payroll_payments_emp on public.payroll_payments(employee_id);
create index if not exists idx_payroll_payments_paid_on on public.payroll_payments(paid_on desc);

-- ── 2. RLS (espelha employee_advances: approved users) ───────────────
alter table public.payroll_payments enable row level security;

drop policy if exists "Approved users can read payroll_payments"   on public.payroll_payments;
drop policy if exists "Approved users can insert payroll_payments" on public.payroll_payments;
drop policy if exists "Approved users can update payroll_payments" on public.payroll_payments;
drop policy if exists "Approved users can delete payroll_payments" on public.payroll_payments;

create policy "Approved users can read payroll_payments"
  on public.payroll_payments for select to authenticated using ((select is_approved_user()));
create policy "Approved users can insert payroll_payments"
  on public.payroll_payments for insert to authenticated with check ((select is_approved_user()));
create policy "Approved users can update payroll_payments"
  on public.payroll_payments for update to authenticated
  using ((select is_approved_user())) with check ((select is_approved_user()));
create policy "Approved users can delete payroll_payments"
  on public.payroll_payments for delete to authenticated using ((select is_approved_user()));

-- ── 3. Corrige o lock: permite o toggle aprovado↔pago ────────────────
-- Antes: qualquer diferença numa folha aprovado/pago = EXCEPTION → travava o
-- pagamento. Agora: além de 'cancelado' e no-op, permite mudar ENTRE
-- aprovado/pago desde que SÓ status + paid_at mudem (valores calculados
-- continuam imutáveis depois de aprovada).
create or replace function public.tg_payroll_lock_finalized()
 returns trigger
 language plpgsql
as $function$
DECLARE
  cmp public.payroll_runs%ROWTYPE;
BEGIN
  IF OLD.status IN ('aprovado', 'pago') THEN
    -- Cancelamento (estorno) sempre permitido.
    IF NEW.status = 'cancelado' AND OLD.status <> 'cancelado' THEN
      RETURN NEW;
    END IF;
    -- Registro/estorno de pagamento: transita entre aprovado↔pago, mas SÓ
    -- status/paid_at/updated_at podem mudar — o resto da folha fica travado.
    IF NEW.status IN ('aprovado', 'pago') THEN
      cmp := NEW;
      cmp.status     := OLD.status;
      cmp.paid_at    := OLD.paid_at;
      cmp.updated_at := OLD.updated_at;
      IF cmp IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Folha finalizada: apenas o status de pagamento pode mudar, não os valores.'
        USING ERRCODE = '22023';
    END IF;
    -- Status idêntico + nenhuma coluna mudou: no-op.
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Folha em status % nao pode ser editada. Crie nova folha ou cancele a atual.', OLD.status
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4. Guard: só registra pagamento em folha aprovada/paga ───────────
create or replace function public.tg_payroll_payment_guard()
 returns trigger
 language plpgsql
as $function$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
    SELECT status INTO v_status FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Folha de pagamento não encontrada.' USING ERRCODE = '23503';
    END IF;
    IF v_status NOT IN ('aprovado', 'pago') THEN
      RAISE EXCEPTION 'Aprove a folha antes de registrar o pagamento (status atual: %).', v_status
        USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

drop trigger if exists tg_payroll_payment_guard on public.payroll_payments;
create trigger tg_payroll_payment_guard
  before insert or update on public.payroll_payments
  for each row execute function public.tg_payroll_payment_guard();

-- ── 5. Sincroniza status/paid_at da folha a partir dos pagamentos ────
create or replace function public.recompute_payroll_paid(p_run uuid)
 returns void
 language plpgsql
as $function$
DECLARE
  v_net    numeric;
  v_status text;
  v_paid   numeric;
  v_last   date;
BEGIN
  SELECT total_liquido, status INTO v_net, v_status
  FROM public.payroll_runs WHERE id = p_run;
  IF NOT FOUND THEN RETURN; END IF;
  -- Nunca mexer em folha rascunho/cancelada — pagamento pressupõe aprovada.
  IF v_status NOT IN ('aprovado', 'pago') THEN RETURN; END IF;

  SELECT coalesce(sum(amount), 0), max(paid_on)
    INTO v_paid, v_last
  FROM public.payroll_payments WHERE payroll_run_id = p_run;

  IF v_net > 0 AND round(v_paid, 2) >= round(v_net, 2) THEN
    IF v_status <> 'pago' THEN
      UPDATE public.payroll_runs
        SET status = 'pago', paid_at = coalesce(v_last::timestamptz, now()), updated_at = now()
        WHERE id = p_run;
    END IF;
  ELSE
    IF v_status = 'pago' THEN
      UPDATE public.payroll_runs
        SET status = 'aprovado', paid_at = NULL, updated_at = now()
        WHERE id = p_run;
    END IF;
  END IF;
END;
$function$;

create or replace function public.tg_sync_payroll_paid()
 returns trigger
 language plpgsql
as $function$
BEGIN
  PERFORM public.recompute_payroll_paid(coalesce(NEW.payroll_run_id, OLD.payroll_run_id));
  IF TG_OP = 'UPDATE' AND NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id THEN
    PERFORM public.recompute_payroll_paid(OLD.payroll_run_id);
  END IF;
  RETURN NULL;
END;
$function$;

drop trigger if exists tg_sync_payroll_paid on public.payroll_payments;
create trigger tg_sync_payroll_paid
  after insert or update or delete on public.payroll_payments
  for each row execute function public.tg_sync_payroll_paid();
