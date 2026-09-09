-- =============================================================================
-- RH — ciclo de vida dos adiantamentos, fechamento e pagamentos da folha
-- =============================================================================
-- Contrato ratificado:
--   pending / paid  = dinheiro já entregue e ainda aberto para desconto;
--   deducted       = reivindicado por uma folha fechada;
--   baixado_externo = liquidado fora da folha e nunca mais descontável.
--   cancelado       = lançamento inválido/estornado, preservado para auditoria.
-- `paid` permanece apenas por compatibilidade com os seis registros legados; o
-- frontend novo cria pending. Nenhum dado histórico é reclassificado aqui.

-- O Supabase CLI não envolve automaticamente a migration inteira em uma única
-- transação. Preserve o contrato financeiro como uma promoção atômica.
BEGIN;

ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS settled_by uuid,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS deducted_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_deduction_status text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

UPDATE public.employee_advances
SET settled_at = COALESCE(settled_at, updated_at, created_at)
WHERE status = 'baixado_externo' AND settled_at IS NULL;

-- Bases que já tenham executado uma versão antiga do fechamento podem conter
-- `deducted` sem a memória do estado aberto. Não é possível recuperar com
-- certeza se a grafia era pending ou paid; ambos significam dinheiro entregue
-- e ainda aberto, então usamos pending como restauração conservadora.
UPDATE public.employee_advances
SET pre_deduction_status = COALESCE(pre_deduction_status, 'pending'),
    deducted_at = COALESCE(deducted_at, updated_at, created_at)
WHERE status = 'deducted'
  AND (pre_deduction_status IS NULL OR deducted_at IS NULL);

DO $validate_advance_currency$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employee_advances
    WHERE amount <= 0 OR amount <> round(amount, 2)
  ) THEN
    RAISE EXCEPTION 'employee_advances contém valor inválido ou com fração menor que um centavo';
  END IF;
END
$validate_advance_currency$;

ALTER TABLE public.employee_advances
  DROP CONSTRAINT IF EXISTS employee_advances_amount_positive,
  DROP CONSTRAINT IF EXISTS employee_advances_status_check,
  DROP CONSTRAINT IF EXISTS employee_advances_status_link_check,
  DROP CONSTRAINT IF EXISTS employee_advances_terminal_audit_check,
  DROP CONSTRAINT IF EXISTS employee_advances_cancellation_audit_check,
  DROP CONSTRAINT IF EXISTS employee_advances_created_by_fkey,
  DROP CONSTRAINT IF EXISTS employee_advances_settled_by_fkey,
  DROP CONSTRAINT IF EXISTS employee_advances_cancelled_by_fkey,
  DROP CONSTRAINT IF EXISTS employee_advances_employee_id_fkey,
  DROP CONSTRAINT IF EXISTS employee_advances_payroll_run_id_fkey;

ALTER TABLE public.employee_advances
  ADD CONSTRAINT employee_advances_amount_positive
    CHECK (amount > 0 AND amount = round(amount, 2)),
  ADD CONSTRAINT employee_advances_status_check
    CHECK (status IN ('pending', 'paid', 'deducted', 'baixado_externo', 'cancelado')),
  ADD CONSTRAINT employee_advances_status_link_check
    CHECK (
      (status = 'deducted' AND payroll_run_id IS NOT NULL AND pre_deduction_status IN ('pending', 'paid'))
      OR (status <> 'deducted' AND payroll_run_id IS NULL AND pre_deduction_status IS NULL)
    ),
  ADD CONSTRAINT employee_advances_terminal_audit_check
    CHECK (
      (status = 'baixado_externo' AND settled_at IS NOT NULL)
      OR (status <> 'baixado_externo' AND settled_at IS NULL AND settled_by IS NULL)
    ),
  ADD CONSTRAINT employee_advances_cancellation_audit_check
    CHECK (
      (status = 'cancelado'
        AND cancelled_at IS NOT NULL
        AND NULLIF(btrim(cancellation_reason), '') IS NOT NULL)
      OR (status <> 'cancelado'
        AND cancelled_at IS NULL
        AND cancelled_by IS NULL
        AND cancellation_reason IS NULL)
    ),
  ADD CONSTRAINT employee_advances_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT,
  ADD CONSTRAINT employee_advances_payroll_run_id_fkey
    FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.employee_advances.status IS
  'pending/paid = entregue e ainda a descontar; deducted = descontado pela folha vinculada; '
  'baixado_externo = liquidado fora da folha; cancelado = lançamento estornado com trilha. Estados terminais.';
COMMENT ON COLUMN public.employee_advances.pre_deduction_status IS
  'Estado aberto anterior ao desconto; permite que o cancelamento restaure pending/paid sem adivinhação.';
COMMENT ON COLUMN public.employee_advances.created_by IS
  'UUID imutável do autor. Sem FK para que a exclusão da conta Auth não apague nem bloqueie a trilha financeira.';
COMMENT ON COLUMN public.employee_advances.idempotency_key IS
  'Chave estável da tentativa de cadastro; retry do mesmo payload retorna a linha existente sem duplicar dinheiro.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_advances_idempotency_key
  ON public.employee_advances (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_guard_employee_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_command text := COALESCE(current_setting('app.employee_advance_command', true), '');
  v_range daterange;
  v_run_employee uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar adiantamentos.' USING ERRCODE = '42501';
  END IF;

  -- Dinheiro entregue e pagamentos são documentos financeiros: nem mesmo um
  -- lançamento aberto desaparece. Correções usam cancelamento auditado.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Adiantamentos não podem ser excluídos; use o cancelamento auditado.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || NEW.employee_id::text, 0));
    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.payroll_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'Novo adiantamento deve nascer pendente e sem folha vinculada.';
    END IF;
    IF COALESCE(auth.role(), '') = 'service_role' THEN
      NEW.created_at := COALESCE(NEW.created_at, now());
    ELSE
      NEW.created_at := now();
      NEW.created_by := auth.uid();
    END IF;
    NEW.updated_at := now();
    NEW.pre_deduction_status := NULL;
    NEW.deducted_at := NULL;
    NEW.settled_at := NULL;
    NEW.settled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;

    IF EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.employee_id = NEW.employee_id
        AND pr.status IN ('aprovado', 'pago')
        AND NEW.advance_date <@ public.payroll_period_range(pr.period)
    ) THEN
      RAISE EXCEPTION 'Já existe folha fechada cobrindo a data do adiantamento. Lance-o em um período aberto.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || OLD.employee_id::text, 0));

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Identidade e autoria do adiantamento são imutáveis.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'Não é permitido transferir um adiantamento para outra pessoa.';
  END IF;

  IF v_command = 'claim' THEN
    IF OLD.status NOT IN ('pending', 'paid') OR OLD.payroll_run_id IS NOT NULL
       OR NEW.status <> 'deducted' OR NEW.payroll_run_id IS NULL
       OR NEW.pre_deduction_status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Transição interna de desconto de adiantamento inválida.';
    END IF;
    SELECT employee_id, public.payroll_period_range(period)
      INTO v_run_employee, v_range
    FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
    IF v_run_employee IS DISTINCT FROM NEW.employee_id OR NOT (NEW.advance_date <@ v_range) THEN
      RAISE EXCEPTION 'A folha vinculada não pertence à pessoa/data do adiantamento.';
    END IF;
    NEW.deducted_at := COALESCE(NEW.deducted_at, now());
    NEW.settled_at := NULL;
    NEW.settled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF v_command = 'release' THEN
    IF OLD.status <> 'deducted' OR OLD.payroll_run_id IS NULL
       OR NEW.status IS DISTINCT FROM OLD.pre_deduction_status
       OR NEW.payroll_run_id IS NOT NULL OR NEW.pre_deduction_status IS NOT NULL THEN
      RAISE EXCEPTION 'Estorno interno de adiantamento inválido.';
    END IF;
    NEW.deducted_at := NULL;
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF v_command = 'external_settle' THEN
    IF OLD.status NOT IN ('pending', 'paid') OR OLD.payroll_run_id IS NOT NULL
       OR NEW.status <> 'baixado_externo' OR NEW.payroll_run_id IS NOT NULL
       OR NEW.pre_deduction_status IS NOT NULL OR NEW.deducted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Baixa externa de adiantamento inválida.' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.employee_id = OLD.employee_id
        AND pr.status IN ('aprovado', 'pago')
        AND OLD.advance_date <@ public.payroll_period_range(pr.period)
    ) THEN
      RAISE EXCEPTION 'Adiantamento pertence a uma folha fechada; desfaça a folha antes da baixa externa.'
        USING ERRCODE = '55000';
    END IF;
    NEW.settled_at := now();
    NEW.settled_by := COALESCE(auth.uid(), OLD.created_by);
    NEW.cancelled_at := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancellation_reason := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF v_command = 'cancel' THEN
    IF OLD.status NOT IN ('pending', 'paid') OR OLD.payroll_run_id IS NOT NULL
       OR NEW.status <> 'cancelado' OR NEW.payroll_run_id IS NOT NULL
       OR NEW.pre_deduction_status IS NOT NULL OR NEW.deducted_at IS NOT NULL
       OR NULLIF(btrim(NEW.cancellation_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Cancelamento de adiantamento inválido ou sem motivo.' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.employee_id = OLD.employee_id
        AND pr.status IN ('aprovado', 'pago')
        AND OLD.advance_date <@ public.payroll_period_range(pr.period)
    ) THEN
      RAISE EXCEPTION 'Adiantamento pertence a uma folha fechada; desfaça a folha antes de cancelar.'
        USING ERRCODE = '55000';
    END IF;
    NEW.cancellation_reason := btrim(NEW.cancellation_reason);
    NEW.cancelled_at := now();
    NEW.cancelled_by := COALESCE(auth.uid(), OLD.created_by);
    NEW.settled_at := NULL;
    NEW.settled_by := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Adiantamentos só podem mudar pelos comandos auditados do RH.'
    USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_employee_advance ON public.employee_advances;
CREATE TRIGGER trg_guard_employee_advance
BEFORE INSERT OR UPDATE OR DELETE ON public.employee_advances
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_employee_advance();

-- Os comandos abaixo adquirem o advisory lock ANTES de tocar qualquer linha.
-- Isso mantém a mesma ordem do fechamento da folha e elimina o ciclo
-- row-lock → advisory-lock que o DML direto poderia criar.
DROP FUNCTION IF EXISTS public.create_employee_advance(uuid, numeric, date, text, text, text);
CREATE OR REPLACE FUNCTION public.create_employee_advance(
  p_employee_id uuid,
  p_amount numeric,
  p_advance_date date,
  p_time text,
  p_description text,
  p_receipt_url text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_existing public.employee_advances%ROWTYPE;
  v_receipt_path text := btrim(COALESCE(p_receipt_url, ''));
  v_receipt_exists boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para registrar adiantamentos.' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL OR p_idempotency_key IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR p_amount <> round(p_amount, 2) OR p_advance_date IS NULL THEN
    RAISE EXCEPTION 'Funcionário, chave, data e valor monetário positivo com até dois decimais são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('employee_advance_idempotency|' || p_idempotency_key::text, 0)
  );
  SELECT * INTO v_existing
  FROM public.employee_advances
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.employee_id IS DISTINCT FROM p_employee_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.advance_date IS DISTINCT FROM p_advance_date
       OR COALESCE(v_existing.time, '') IS DISTINCT FROM COALESCE(p_time, '')
       OR COALESCE(v_existing.description, '') IS DISTINCT FROM COALESCE(p_description, '')
       OR COALESCE(v_existing.receipt_url, '') IS DISTINCT FROM v_receipt_path THEN
      RAISE EXCEPTION 'Chave de idempotência já usada por outro adiantamento.'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || p_employee_id::text, 0));
  IF v_receipt_path <> '' THEN
    SELECT true INTO v_receipt_exists
    FROM storage.objects o
    WHERE o.bucket_id = 'employee-receipts'
      AND o.name = v_receipt_path
    FOR UPDATE;
    IF NOT COALESCE(v_receipt_exists, false) THEN
      RAISE EXCEPTION 'O comprovante do adiantamento não existe no arquivo permanente.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  INSERT INTO public.employee_advances (
    employee_id, amount, advance_date, time, description, receipt_url,
    status, payroll_run_id, idempotency_key
  ) VALUES (
    p_employee_id, p_amount, p_advance_date, COALESCE(p_time, ''),
    COALESCE(p_description, ''), v_receipt_path,
    'pending', NULL, p_idempotency_key
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_employee_advance_external(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_employee_id uuid;
  v_previous_command text := COALESCE(current_setting('app.employee_advance_command', true), '');
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para baixar adiantamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT employee_id INTO v_employee_id FROM public.employee_advances WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adiantamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || v_employee_id::text, 0));
  PERFORM set_config('app.employee_advance_command', 'external_settle', true);
  UPDATE public.employee_advances
  SET status = 'baixado_externo'
  WHERE id = p_id AND status IN ('pending', 'paid') AND payroll_run_id IS NULL
  RETURNING id INTO v_id;
  PERFORM set_config('app.employee_advance_command', v_previous_command, true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Adiantamento não está mais em aberto; atualize a tela.' USING ERRCODE = '55000';
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_employee_advances_external(
  p_employee_id uuid,
  p_from date,
  p_before date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_previous_command text := COALESCE(current_setting('app.employee_advance_command', true), '');
  v_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para baixar adiantamentos.' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL OR p_from IS NULL OR p_before IS NULL OR p_from >= p_before THEN
    RAISE EXCEPTION 'Intervalo de baixa externa inválido.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || p_employee_id::text, 0));
  PERFORM set_config('app.employee_advance_command', 'external_settle', true);
  UPDATE public.employee_advances
  SET status = 'baixado_externo'
  WHERE employee_id = p_employee_id
    AND payroll_run_id IS NULL
    AND status IN ('pending', 'paid')
    AND advance_date >= p_from
    AND advance_date < p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.employee_advance_command', v_previous_command, true);
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_employee_advance(p_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_employee_id uuid;
  v_previous_command text := COALESCE(current_setting('app.employee_advance_command', true), '');
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar adiantamentos.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  SELECT employee_id INTO v_employee_id FROM public.employee_advances WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adiantamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || v_employee_id::text, 0));
  PERFORM set_config('app.employee_advance_command', 'cancel', true);
  UPDATE public.employee_advances
  SET status = 'cancelado', cancellation_reason = btrim(p_reason)
  WHERE id = p_id AND status IN ('pending', 'paid') AND payroll_run_id IS NULL
  RETURNING id INTO v_id;
  PERFORM set_config('app.employee_advance_command', v_previous_command, true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Adiantamento não está mais em aberto; atualize a tela.' USING ERRCODE = '55000';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_employee_advance(uuid, numeric, date, text, text, text, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_employee_advance_external(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_employee_advances_external(uuid, date, date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_employee_advance(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employee_advance(uuid, numeric, date, text, text, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_employee_advance_external(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_employee_advances_external(uuid, date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_employee_advance(uuid, text)
  TO authenticated, service_role;

-- O check legado de sobreposição era check-then-write sem mutex. Duas sessões
-- podiam criar janelas diferentes e sobrepostas para a mesma pessoa antes de
-- qualquer uma enxergar a linha da outra. A mesma chave da ficha de produção
-- mantém uma ordem única entre cadastro, produção e fechamento.
CREATE OR REPLACE FUNCTION public.tg_payroll_block_period_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_range daterange;
  v_conflito record;
  v_lock_id uuid;
BEGIN
  FOR v_lock_id IN
    SELECT DISTINCT ids.employee_id
    FROM unnest(ARRAY[
      NEW.employee_id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.employee_id END
    ]) AS ids(employee_id)
    WHERE ids.employee_id IS NOT NULL
    ORDER BY ids.employee_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ficha_montadores|' || v_lock_id::text, 0)
    );
  END LOOP;

  IF NEW.status = 'cancelado' THEN
    RETURN NEW;
  END IF;

  v_range := public.payroll_period_range(NEW.period);
  IF v_range IS NULL THEN
    RAISE EXCEPTION
      'payroll_runs.period em formato desconhecido: % (esperado YYYY-MM ou YYYY-MM-DD_YYYY-MM-DD)',
      NEW.period;
  END IF;

  SELECT r.period, r.status INTO v_conflito
  FROM public.payroll_runs r
  WHERE r.employee_id = NEW.employee_id
    AND r.id <> NEW.id
    AND r.status <> 'cancelado'
    AND r.period <> NEW.period
    AND public.payroll_period_range(r.period) && v_range
  ORDER BY r.period
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Já existe folha desta pessoa cobrindo dias deste período: % (%). Uma folha por janela — vale no meio do período é adiantamento, não folha.',
      v_conflito.period, v_conflito.status
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tg_payroll_block_period_overlap ON public.payroll_runs;
CREATE TRIGGER tg_payroll_block_period_overlap
BEFORE INSERT OR UPDATE OF period, status, employee_id ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_block_period_overlap();

-- ── Frescor dos insumos: rascunho não fecha com fonte salarial obsoleta ─────
CREATE TABLE IF NOT EXISTS public.payroll_input_epoch (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payroll_input_epoch (singleton, revision)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.payroll_input_epoch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payroll_input_epoch FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payroll_input_epoch TO service_role;

CREATE OR REPLACE FUNCTION public.tg_bump_payroll_input_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Imports podem executar milhares de INSERT/UPDATE statements dentro da
  -- mesma transação. Um único incremento já invalida todos os tokens anteriores
  -- e mantém a linha singleton como mutex até o COMMIT.
  IF current_setting('app.payroll_input_epoch_bumped', true) IS DISTINCT FROM 'on' THEN
    UPDATE public.payroll_input_epoch
    SET revision = revision + 1,
        changed_at = clock_timestamp()
    WHERE singleton;
    PERFORM set_config('app.payroll_input_epoch_bumped', 'on', true);
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_bump_payroll_input_epoch()
FROM PUBLIC, anon, authenticated;

DO $epoch_triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'time_records',
    'employees',
    'work_schedules',
    'holidays',
    'workday_swaps',
    'employee_absences',
    'time_import_logs',
    'time_import_quarantine',
    'punch_device_map'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_00_bump_payroll_input_epoch ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_00_bump_payroll_input_epoch '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION public.tg_bump_payroll_input_epoch()',
      v_table
    );
  END LOOP;
END
$epoch_triggers$;

CREATE OR REPLACE FUNCTION public.begin_payroll_calculation()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  v_revision bigint;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para calcular a folha.' USING ERRCODE = '42501';
  END IF;
  SELECT revision INTO v_revision
  FROM public.payroll_input_epoch
  WHERE singleton;
  RETURN v_revision;
END;
$fn$;

REVOKE ALL ON FUNCTION public.begin_payroll_calculation()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_payroll_calculation()
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_payroll_require_fresh_inputs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_current bigint;
  v_snapshot bigint;
  v_payment_type text;
BEGIN
  IF OLD.status <> 'rascunho' OR NEW.status NOT IN ('aprovado', 'pago') THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(e.payment_type, 'mensalista'))
  INTO v_payment_type
  FROM public.employees e
  WHERE e.id = NEW.employee_id;
  IF v_payment_type = 'producao' THEN
    RETURN NEW;
  END IF;

  -- O row-lock é compartilhado com todos os bumps BEFORE STATEMENT. Quem
  -- começar primeiro vence; o segundo observa a revisão nova ou a folha fechada.
  SELECT revision INTO v_current
  FROM public.payroll_input_epoch
  WHERE singleton
  FOR UPDATE;

  BEGIN
    v_snapshot := (NEW.calculation_snapshot->>'input_epoch')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    v_snapshot := NULL;
  END;

  IF v_snapshot IS NULL OR v_snapshot IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'Dados de ponto/RH mudaram desde o cálculo; recalcule a folha antes de aprovar.'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ab_payroll_require_fresh_inputs ON public.payroll_runs;
CREATE TRIGGER trg_ab_payroll_require_fresh_inputs
BEFORE UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_require_fresh_inputs();

-- ── Fechamento: snapshot e valores não podem divergir dos vales reivindicados ─
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_approved_by_fkey,
  DROP CONSTRAINT IF EXISTS payroll_runs_employee_id_fkey;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT payroll_runs_employee_id_fkey ON public.payroll_runs IS
  'Folhas são documentos permanentes; excluir o cadastro do funcionário nunca pode apagá-las em cascata.';

ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE public.payroll_payments
  DROP CONSTRAINT IF EXISTS payroll_payments_reversed_by_fkey;

-- A versão legada aceitava aprovado/pago → cancelado com RETURN imediato e,
-- portanto, deixava o mesmo UPDATE adulterar totais, pessoa, período e snapshot.
-- Lifecycle muda; o documento salarial não.
CREATE OR REPLACE FUNCTION public.tg_payroll_lock_finalized()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cmp public.payroll_runs%ROWTYPE;
BEGIN
  IF OLD.status = 'cancelado' THEN
    RAISE EXCEPTION 'Folha cancelada é terminal e não pode ser reativada ou alterada.'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status IN ('rascunho', 'aprovado', 'pago') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Rascunho não pode ser descartado como folha cancelada; recalcule ou aprove o período.'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status NOT IN ('aprovado', 'pago') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelado' AND OLD.status <> 'cancelado' THEN
    v_cmp := NEW;
    v_cmp.status := OLD.status;
    v_cmp.updated_at := OLD.updated_at;
    IF v_cmp IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Ao cancelar uma folha, somente status e updated_at podem mudar; valores e auditoria são imutáveis.'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IN ('aprovado', 'pago') THEN
    v_cmp := NEW;
    v_cmp.status := OLD.status;
    v_cmp.paid_at := OLD.paid_at;
    v_cmp.updated_at := OLD.updated_at;
    IF v_cmp IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Folha finalizada: somente o estado derivado de pagamento pode mudar.'
      USING ERRCODE = '22023';
  END IF;

  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Folha em status % não pode ser editada; cancele preservando o documento original.', OLD.status
    USING ERRCODE = '22023';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_payroll_link_advances_and_overtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_range daterange;
  v_open_total numeric := 0;
  v_claimed_total numeric := 0;
  v_snapshot_total numeric;
  v_payment_type text;
  v_employee public.employees%ROWTYPE;
  v_rule text := 'producao-por-par-v1-2026-08-26';
  v_previous_command text := COALESCE(current_setting('app.employee_advance_command', true), '');
BEGIN
  v_range := public.payroll_period_range(NEW.period);
  IF v_range IS NULL THEN
    RAISE EXCEPTION 'payroll_runs.period em formato desconhecido: %', NEW.period;
  END IF;

  IF NEW.status IN ('aprovado', 'pago') AND OLD.status = 'rascunho' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || NEW.employee_id::text, 0));
    SELECT * INTO v_employee FROM public.employees WHERE id = NEW.employee_id;
    v_payment_type := lower(COALESCE(v_employee.payment_type, 'mensalista'));

    SELECT COALESCE(sum(a.amount), 0)
      INTO v_open_total
    FROM public.employee_advances a
    WHERE a.employee_id = NEW.employee_id
      AND a.advance_date <@ v_range
      AND a.payroll_run_id IS NULL
      AND a.status IN ('pending', 'paid');

    IF v_payment_type = 'producao' AND NEW.calculation_snapshot IS NULL THEN
      NEW.total_descontos := COALESCE(NEW.total_descontos, 0)
        - COALESCE(NEW.advances_total, 0) + v_open_total;
      NEW.advances_total := v_open_total;
      NEW.total_liquido := COALESCE(NEW.total_proventos, 0) - NEW.total_descontos;
      NEW.calculation_rule_version := v_rule;
      NEW.calculation_snapshot := jsonb_build_object(
        'schema_version', 1,
        'rule_version', v_rule,
        'calculated_at', now(),
        'period', jsonb_build_object(
          'from', lower(v_range)::text,
          'to', (upper(v_range) - 1)::text
        ),
        'employee', jsonb_build_object(
          'id', v_employee.id,
          'name', v_employee.name,
          'external_id', v_employee.external_id,
          'role', v_employee.role,
          'department', v_employee.department,
          'payment_type', 'producao',
          'salary', COALESCE(v_employee.salary, 0),
          'he_normal_rate', COALESCE(v_employee.he_normal_rate, 0),
          'he_sunday_holiday_rate', COALESCE(v_employee.he_sunday_holiday_rate, 0)
        ),
        'schedule', NULL,
        'result', jsonb_build_object(
          'rule_version', v_rule,
          'payment_type', 'producao',
          'gross_value', COALESCE(NEW.total_proventos, 0),
          'net_value', COALESCE(NEW.total_liquido, 0),
          'total_proventos', COALESCE(NEW.total_proventos, 0),
          'total_descontos', COALESCE(NEW.total_descontos, 0),
          'advances_total', COALESCE(NEW.advances_total, 0),
          'paid_days', COALESCE(NEW.business_days_worked, 0),
          'workdays', COALESCE(NEW.business_days, 0),
          'worked_days', COALESCE(NEW.business_days_worked, 0),
          'pares_medio', COALESCE(NEW.pares_medio, 0),
          'pares_dificil', COALESCE(NEW.pares_dificil, 0),
          'pending_days', 0,
          'he_rate_missing', false,
          'day_ledger', '[]'::jsonb
        )
      );
    ELSE
      BEGIN
        v_snapshot_total := (NEW.calculation_snapshot->'result'->>'advances_total')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_snapshot_total := NULL;
      END;
      IF v_snapshot_total IS NULL
         OR round(v_snapshot_total, 2) <> round(v_open_total, 2)
         OR round(COALESCE(NEW.advances_total, 0), 2) <> round(v_open_total, 2) THEN
        RAISE EXCEPTION 'Adiantamentos mudaram desde o cálculo (% no snapshot, % abertos). Recalcule a folha antes de aprovar.',
          COALESCE(v_snapshot_total, -1), v_open_total
          USING ERRCODE = '40001';
      END IF;
    END IF;

    PERFORM set_config('app.employee_advance_command', 'claim', true);
    UPDATE public.employee_advances a
    SET payroll_run_id = NEW.id,
        pre_deduction_status = a.status,
        status = 'deducted',
        deducted_at = now(),
        updated_at = now()
    WHERE a.employee_id = NEW.employee_id
      AND a.advance_date <@ v_range
      AND a.payroll_run_id IS NULL
      AND a.status IN ('pending', 'paid');
    PERFORM set_config('app.employee_advance_command', v_previous_command, true);

    SELECT COALESCE(sum(amount), 0) INTO v_claimed_total
    FROM public.employee_advances WHERE payroll_run_id = NEW.id;
    IF round(v_claimed_total, 2) <> round(v_open_total, 2) THEN
      RAISE EXCEPTION 'Falha ao reivindicar adiantamentos de forma atômica.' USING ERRCODE = '40001';
    END IF;

    UPDATE public.overtime_resolutions
    SET payroll_run_id = NEW.id
    WHERE employee_id = NEW.employee_id
      AND month <@ v_range
      AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    -- Autoria e relógio são do servidor. O payload do navegador não pode
    -- pré-datar nem atribuir a aprovação a outra pessoa.
    NEW.approved_at := now();
    NEW.approved_by := auth.uid();
    IF round(COALESCE(NEW.total_liquido, 0), 2) <= 0 THEN
      NEW.status := 'pago';
      NEW.paid_at := now();
    END IF;

  ELSIF NEW.status = 'cancelado' AND OLD.status IN ('aprovado', 'pago') THEN
    IF EXISTS (
      SELECT 1 FROM public.payroll_payments p
      WHERE p.payroll_run_id = NEW.id AND p.reversed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Remova/estorne os pagamentos antes de cancelar a folha.' USING ERRCODE = '55000';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('employee_advances|' || NEW.employee_id::text, 0));
    PERFORM set_config('app.employee_advance_command', 'release', true);
    UPDATE public.employee_advances a
    SET status = a.pre_deduction_status,
        payroll_run_id = NULL,
        pre_deduction_status = NULL,
        deducted_at = NULL,
        updated_at = now()
    WHERE a.payroll_run_id = NEW.id;
    PERFORM set_config('app.employee_advance_command', v_previous_command, true);
    UPDATE public.overtime_resolutions SET payroll_run_id = NULL WHERE payroll_run_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.employee_advance_command', v_previous_command, true);
  RAISE;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_payroll_link_advances_and_overtime ON public.payroll_runs;
CREATE TRIGGER trg_payroll_link_advances_and_overtime
BEFORE UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_link_advances_and_overtime();

-- Valida o snapshot que será congelado e faz `pago` permanecer um estado
-- derivado da soma dos pagamentos, inclusive contra UPDATE/INSERT direto.
CREATE OR REPLACE FUNCTION public.tg_guard_payroll_snapshot_and_paid_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_range daterange;
  v_result jsonb;
  v_paid_total numeric := 0;
  v_last_paid date;
  v_employee_payment_type text;
  v_closing boolean := TG_OP = 'UPDATE'
    AND OLD.status = 'rascunho'
    AND NEW.status IN ('aprovado', 'pago');
BEGIN
  -- O writer atômico de adiantamentos/horas extras é um trigger de UPDATE.
  -- Proibir folha já fechada no INSERT impede que esse vínculo seja contornado
  -- e mantém a criação normal de rascunhos sem exigir snapshot definitivo.
  IF TG_OP = 'INSERT' AND (
    NEW.status IS DISTINCT FROM 'rascunho'
    OR NEW.approved_at IS NOT NULL
    OR NEW.approved_by IS NOT NULL
    OR NEW.paid_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A folha deve nascer como rascunho e ser fechada por atualização.'
      USING ERRCODE = '55000';
  END IF;

  IF v_closing THEN
    v_range := public.payroll_period_range(NEW.period);
    v_result := NEW.calculation_snapshot->'result';
    SELECT lower(COALESCE(e.payment_type, 'mensalista'))
      INTO v_employee_payment_type
    FROM public.employees e
    WHERE e.id = NEW.employee_id;

    BEGIN
      IF jsonb_typeof(NEW.calculation_snapshot) IS DISTINCT FROM 'object'
         OR (NEW.calculation_snapshot->>'schema_version')::integer IS DISTINCT FROM 1
         OR jsonb_typeof(v_result) IS DISTINCT FROM 'object'
         OR NEW.calculation_rule_version IS NULL
         OR NEW.calculation_snapshot->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version
         OR v_result->>'rule_version' IS DISTINCT FROM NEW.calculation_rule_version
         OR NEW.calculation_snapshot->'employee'->>'id' IS DISTINCT FROM NEW.employee_id::text
         OR lower(COALESCE(NEW.calculation_snapshot->'employee'->>'payment_type', ''))
              IS DISTINCT FROM v_employee_payment_type
         OR lower(COALESCE(v_result->>'payment_type', '')) IS DISTINCT FROM v_employee_payment_type
         OR NEW.calculation_snapshot->'period'->>'from' IS DISTINCT FROM lower(v_range)::text
         OR NEW.calculation_snapshot->'period'->>'to' IS DISTINCT FROM (upper(v_range) - 1)::text
         OR NOT (v_result ? 'pending_days')
         OR jsonb_typeof(v_result->'pending_days') <> 'number'
         OR (v_result->>'pending_days')::integer < 0
         OR NOT (v_result ? 'he_rate_missing')
         OR jsonb_typeof(v_result->'he_rate_missing') <> 'boolean'
         OR NOT (v_result ? 'advances_total')
         OR jsonb_typeof(v_result->'advances_total') <> 'number'
         OR NOT (v_result ? 'total_proventos')
         OR jsonb_typeof(v_result->'total_proventos') <> 'number'
         OR NOT (v_result ? 'total_descontos')
         OR jsonb_typeof(v_result->'total_descontos') <> 'number'
         OR NOT (v_result ? 'net_value')
         OR jsonb_typeof(v_result->'net_value') <> 'number'
         OR NOT (v_result ? 'gross_value')
         OR jsonb_typeof(v_result->'gross_value') <> 'number'
         OR round((v_result->>'advances_total')::numeric, 2)
              <> round(COALESCE(NEW.advances_total, 0), 2)
         OR round((v_result->>'total_proventos')::numeric, 2)
              <> round(COALESCE(NEW.total_proventos, 0), 2)
         OR round((v_result->>'total_descontos')::numeric, 2)
              <> round(COALESCE(NEW.total_descontos, 0), 2)
         OR round((v_result->>'net_value')::numeric, 2)
              <> round(COALESCE(NEW.total_liquido, 0), 2)
         OR round(COALESCE(NEW.total_liquido, 0), 2)
              <> round(
                   COALESCE(NEW.total_proventos, 0)
                   - COALESCE(NEW.total_descontos, 0),
                   2
                 )
         OR round((v_result->>'gross_value')::numeric, 2)
              <> round(
                   COALESCE(NEW.total_proventos, 0)
                   - COALESCE(NEW.total_descontos, 0)
                   + COALESCE(NEW.advances_total, 0),
                   2
                 ) THEN
        RAISE EXCEPTION 'Snapshot da folha diverge da pessoa, período ou totais persistidos. Recalcule antes de aprovar.'
          USING ERRCODE = '22000';
      END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Snapshot da folha possui campos financeiros inválidos. Recalcule antes de aprovar.'
          USING ERRCODE = '22000';
    END;
  END IF;

  IF NEW.status IN ('aprovado', 'pago') THEN
    SELECT COALESCE(sum(p.amount), 0), max(p.paid_on)
      INTO v_paid_total, v_last_paid
    FROM public.payroll_payments p
    WHERE p.payroll_run_id = NEW.id
      AND p.reversed_at IS NULL;

    IF NEW.status = 'pago'
       AND round(COALESCE(NEW.total_liquido, 0), 2) > 0
       AND round(v_paid_total, 2) < round(NEW.total_liquido, 2) THEN
      RAISE EXCEPTION 'Folha só pode ficar paga quando os pagamentos cobrem o saldo líquido.'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'aprovado'
       AND (round(COALESCE(NEW.total_liquido, 0), 2) <= 0
            OR round(v_paid_total, 2) >= round(NEW.total_liquido, 2)) THEN
      RAISE EXCEPTION 'Folha quitada deve permanecer com status pago.'
        USING ERRCODE = '55000';
    END IF;

    NEW.paid_at := CASE
      WHEN NEW.status <> 'pago' THEN NULL
      WHEN TG_OP = 'UPDATE' AND OLD.status = 'pago' THEN OLD.paid_at
      WHEN round(COALESCE(NEW.total_liquido, 0), 2) <= 0
        THEN COALESCE(OLD.approved_at, NEW.approved_at, now())
      ELSE now()
    END;

    UPDATE public.ficha_montadores f
    SET pago_em = CASE WHEN NEW.status = 'pago'
      THEN COALESCE(v_last_paid, NEW.approved_at::date, current_date)
      ELSE NULL END
    WHERE f.payroll_run_id = NEW.id
      AND f.pago_em IS DISTINCT FROM CASE WHEN NEW.status = 'pago'
        THEN COALESCE(v_last_paid, NEW.approved_at::date, current_date)
        ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_zzzy_guard_payroll_integrity ON public.payroll_runs;
CREATE TRIGGER trg_zzzy_guard_payroll_integrity
BEFORE INSERT OR UPDATE OF status, total_liquido, calculation_snapshot,
  calculation_rule_version, paid_at ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_payroll_snapshot_and_paid_state();

-- Estado legado impossível de quitar pela UI: líquido zero não possui saldo a
-- registrar. A derivação usada nos novos fechamentos é aplicada também à única
-- classe histórica determinística, sem fabricar pagamento ou alterar valores.
UPDATE public.payroll_runs
SET status = 'pago',
    paid_at = COALESCE(paid_at, approved_at, updated_at, created_at, now()),
    updated_at = now()
WHERE status = 'aprovado'
  AND round(COALESCE(total_liquido, 0), 2) <= 0;

-- O snapshot precisa ser validado DEPOIS de Produção e Adiantamentos preencherem
-- o NEW da linha. Triggers do mesmo evento executam em ordem alfabética.
DROP TRIGGER IF EXISTS trg_lock_closed_payroll_snapshot ON public.payroll_runs;
DROP TRIGGER IF EXISTS trg_zzzz_lock_closed_payroll_snapshot ON public.payroll_runs;
CREATE TRIGGER trg_zzzz_lock_closed_payroll_snapshot
BEFORE UPDATE OF status, calculation_rule_version, calculation_snapshot
ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_lock_closed_payroll_snapshot();

-- Cobertura vem do protocolo do arquivo, não do último dia civil com alguma
-- batida. Permite fim de semana sem expediente e detecta lacuna interna.
CREATE OR REPLACE FUNCTION public.tg_payroll_block_incomplete_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_range daterange;
  v_missing_date date;
  v_payment_type text;
  v_schedule_id uuid;
  v_external_id text;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'rascunho' OR NEW.status NOT IN ('aprovado', 'pago') THEN
    RETURN NEW;
  END IF;
  SELECT lower(COALESCE(payment_type, 'mensalista')), work_schedule_id, NULLIF(btrim(external_id), '')
    INTO v_payment_type, v_schedule_id, v_external_id
  FROM public.employees WHERE id = NEW.employee_id;

  IF v_payment_type IN ('mensalista', 'diarista') THEN
    IF jsonb_typeof(NEW.calculation_snapshot->'result') IS DISTINCT FROM 'object'
       OR NOT (NEW.calculation_snapshot->'result' ? 'pending_days')
       OR jsonb_typeof(NEW.calculation_snapshot->'result'->'pending_days') <> 'number'
       OR NOT (NEW.calculation_snapshot->'result' ? 'he_rate_missing')
       OR jsonb_typeof(NEW.calculation_snapshot->'result'->'he_rate_missing') <> 'boolean' THEN
      RAISE EXCEPTION 'Snapshot da folha incompleto; recalcule antes de aprovar.';
    END IF;
    IF (NEW.calculation_snapshot->'result'->>'pending_days')::integer > 0 THEN
      RAISE EXCEPTION 'Folha possui batidas pendentes. Resolva o ponto antes de aprovar.';
    END IF;
    IF (NEW.calculation_snapshot->'result'->>'he_rate_missing')::boolean THEN
      RAISE EXCEPTION 'Folha possui hora extra sem taxa financeira cadastrada.';
    END IF;
    IF v_schedule_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem jornada própria. Cadastre a jornada antes de aprovar a folha.';
    END IF;
    IF v_external_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem matrícula do relógio. Cadastre a matrícula antes de aprovar a folha.';
    END IF;
    v_range := public.payroll_period_range(NEW.period);
    IF EXISTS (
      SELECT 1
      FROM public.time_import_quarantine q
      WHERE q.resolved_at IS NULL
        AND q.record_date <@ v_range
        AND btrim(q.employee_external_id) = ANY (
          regexp_split_to_array(v_external_id, '\s*,\s*')
        )
    ) THEN
      RAISE EXCEPTION 'Existem batidas desta matrícula em quarentena no período. Resolva o vínculo antes de aprovar a folha.';
    END IF;
    SELECT d::date INTO v_missing_date
    FROM generate_series(lower(v_range), upper(v_range) - 1, interval '1 day') d
    WHERE NOT EXISTS (
      -- Arquivo filtrado aplica suas batidas, mas não prova a ausência em dias
      -- sem linha. Cobertura financeira exige exportação integral, roster
      -- validado no protocolo e a matrícula desta folha no arquivo congelado.
      SELECT 1 FROM public.time_import_logs l
      WHERE l.archive_status = 'available'
        AND l.status IN ('success', 'partial')
        AND l.coverage_scope = 'all_employees'
        AND l.covered_employee_external_ids
          && regexp_split_to_array(v_external_id, '\s*,\s*')
        AND d::date BETWEEN l.start_date AND LEAST(
          l.end_date,
          COALESCE(l.archived_at, l.created_at) AT TIME ZONE 'America/Sao_Paulo',
          now() AT TIME ZONE 'America/Sao_Paulo'
        )::date
    )
    ORDER BY d
    LIMIT 1;
    IF v_missing_date IS NOT NULL THEN
      RAISE EXCEPTION 'Ponto sem arquivo de cobertura em %. Importe o período completo antes de aprovar.', v_missing_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- ── Pagamentos: funcionário, autoria, saldo e concorrência no servidor ───────
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

DO $validate_payment_currency$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payroll_payments
    WHERE amount <= 0 OR amount <> round(amount, 2)
  ) THEN
    RAISE EXCEPTION 'payroll_payments contém valor inválido ou com fração menor que um centavo';
  END IF;
END
$validate_payment_currency$;

ALTER TABLE public.payroll_payments
  DROP CONSTRAINT IF EXISTS payroll_payments_amount_positive,
  DROP CONSTRAINT IF EXISTS payroll_payments_reversal_audit_check,
  ADD CONSTRAINT payroll_payments_amount_positive
    CHECK (amount > 0 AND amount = round(amount, 2)),
  ADD CONSTRAINT payroll_payments_reversal_audit_check CHECK (
    (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR (reversed_at IS NOT NULL AND NULLIF(btrim(reversal_reason), '') IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_payments_idempotency_key
  ON public.payroll_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.payroll_payments IS
  'Pagamentos do saldo líquido pós-adiantamentos. Linhas são imutáveis; correções usam estorno auditado e preservam o recibo.';

CREATE OR REPLACE FUNCTION public.tg_payroll_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_existing numeric;
  v_command text := COALESCE(current_setting('app.payroll_payment_command', true), '');
  v_run_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_run_id ELSE NEW.payroll_run_id END;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para registrar pagamentos.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pagamentos não podem ser excluídos; use o estorno auditado.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_run FROM public.payroll_runs WHERE id = v_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha de pagamento não encontrada.' USING ERRCODE = '23503';
  END IF;
  IF v_run.status NOT IN ('aprovado', 'pago') THEN
    RAISE EXCEPTION 'A folha precisa estar aprovada para alterar pagamentos (status: %).', v_run.status;
  END IF;

  IF NEW.employee_id IS DISTINCT FROM v_run.employee_id THEN
    RAISE EXCEPTION 'O pagamento não pertence ao funcionário da folha.';
  END IF;
  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'O pagamento deve ser maior que zero.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.paid_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
      RAISE EXCEPTION 'A data do pagamento não pode ser futura.' USING ERRCODE = '22023';
    END IF;
    IF NEW.reversed_at IS NOT NULL OR NEW.reversed_by IS NOT NULL OR NEW.reversal_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Pagamento novo não pode nascer estornado.' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(auth.role(), '') = 'service_role' THEN
      NEW.created_at := COALESCE(NEW.created_at, now());
    ELSE
      NEW.created_at := now();
      NEW.created_by := auth.uid();
    END IF;
    NEW.idempotency_key := COALESCE(NEW.idempotency_key, gen_random_uuid());
    SELECT COALESCE(sum(p.amount), 0) INTO v_existing
    FROM public.payroll_payments p
    WHERE p.payroll_run_id = v_run.id AND p.reversed_at IS NULL;

    IF round(v_existing + NEW.amount, 2) > round(v_run.total_liquido, 2) THEN
      RAISE EXCEPTION 'Pagamento excede o saldo da folha: saldo %, tentativa %.',
        GREATEST(round(v_run.total_liquido - v_existing, 2), 0), NEW.amount
        USING ERRCODE = '22003';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.receipt_path IS DISTINCT FROM OLD.receipt_path
     OR NEW.receipt_name IS DISTINCT FROM OLD.receipt_name
     OR NEW.receipt_size IS DISTINCT FROM OLD.receipt_size
     OR NEW.receipt_mime IS DISTINCT FROM OLD.receipt_mime THEN
    RAISE EXCEPTION 'Pagamento e recibo são imutáveis; use estorno e registre um novo pagamento.'
      USING ERRCODE = '55000';
  END IF;
  IF v_command <> 'reverse'
     OR OLD.reversed_at IS NOT NULL
     OR NEW.reversed_at IS NULL
     OR NULLIF(btrim(NEW.reversal_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Transição de pagamento inválida; use o estorno auditado.'
      USING ERRCODE = '42501';
  END IF;
  NEW.reversed_at := now();
  NEW.reversed_by := COALESCE(auth.uid(), OLD.created_by);
  NEW.reversal_reason := btrim(NEW.reversal_reason);
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tg_payroll_payment_guard ON public.payroll_payments;
CREATE TRIGGER tg_payroll_payment_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_payment_guard();

CREATE OR REPLACE FUNCTION public.recompute_payroll_paid(p_run uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_net numeric;
  v_status text;
  v_paid numeric;
  v_last date;
BEGIN
  SELECT total_liquido, status INTO v_net, v_status
  FROM public.payroll_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('aprovado', 'pago') THEN RETURN; END IF;

  SELECT COALESCE(sum(amount), 0), max(paid_on)
    INTO v_paid, v_last
  FROM public.payroll_payments
  WHERE payroll_run_id = p_run AND reversed_at IS NULL;

  IF round(v_net, 2) <= 0 OR round(v_paid, 2) >= round(v_net, 2) THEN
    IF v_status <> 'pago' THEN
      UPDATE public.payroll_runs
      SET status = 'pago', paid_at = now(), updated_at = now()
      WHERE id = p_run;
    END IF;
  ELSIF v_status = 'pago' THEN
    UPDATE public.payroll_runs
    SET status = 'aprovado', paid_at = NULL, updated_at = now()
      WHERE id = p_run;
  END IF;

  -- Os triggers legados de ficha carimbavam o primeiro pagamento parcial como
  -- quitação. A fonte de verdade é a mesma soma que deriva o status da folha.
  UPDATE public.ficha_montadores f
  SET pago_em = CASE
    WHEN round(v_net, 2) <= 0 OR round(v_paid, 2) >= round(v_net, 2)
      THEN COALESCE(v_last, current_date)
    ELSE NULL
  END
  WHERE f.payroll_run_id = p_run
    AND f.pago_em IS DISTINCT FROM CASE
      WHEN round(v_net, 2) <= 0 OR round(v_paid, 2) >= round(v_net, 2)
        THEN COALESCE(v_last, current_date)
      ELSE NULL
    END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.register_payroll_payment(
  p_payroll_run_id uuid,
  p_employee_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_on date,
  p_reference text,
  p_notes text,
  p_receipt_path text,
  p_receipt_name text,
  p_receipt_size integer,
  p_receipt_mime text,
  p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_existing public.payroll_payments%ROWTYPE;
  v_receipt_metadata jsonb;
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para registrar pagamentos.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_payroll_run_id IS NULL OR p_employee_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
     OR p_paid_on IS NULL THEN
    RAISE EXCEPTION 'Folha, funcionário, chave, data e valor monetário positivo com até dois decimais são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF p_paid_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data do pagamento não pode estar no futuro.' USING ERRCODE = '22023';
  END IF;

  -- Ordem canônica: folha primeiro, depois recibo e pagamento. O row-lock do
  -- objeto permanece até o COMMIT; uma exclusão/substituição concorrente espera
  -- e, ao retomar, a policy já enxerga o pagamento que referencia o arquivo.
  SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_payroll_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status NOT IN ('aprovado', 'pago') THEN
    RAISE EXCEPTION 'A folha precisa estar aprovada para registrar pagamento.' USING ERRCODE = '55000';
  END IF;
  IF v_run.employee_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'O pagamento não pertence ao funcionário da folha.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_receipt_path, '') <> ''
     AND p_receipt_path NOT LIKE p_payroll_run_id::text || '/%' THEN
    RAISE EXCEPTION 'Caminho do recibo não pertence à folha informada.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_receipt_path, '') <> '' THEN
    IF NULLIF(btrim(COALESCE(p_receipt_name, '')), '') IS NULL
       OR p_receipt_size IS NULL OR p_receipt_size <= 0 OR p_receipt_size > 10485760
       OR COALESCE(p_receipt_mime, '') NOT IN (
         'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
       ) THEN
      RAISE EXCEPTION 'Metadados do recibo são inválidos.' USING ERRCODE = '22023';
    END IF;

    SELECT o.metadata INTO v_receipt_metadata
    FROM storage.objects o
    WHERE o.bucket_id = 'employee-receipts'
      AND o.name = p_receipt_path
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O recibo informado não existe no arquivo permanente.' USING ERRCODE = '23503';
    END IF;
    IF COALESCE(v_receipt_metadata ->> 'size', '') ~ '^\d+$'
       AND (v_receipt_metadata ->> 'size')::bigint <> p_receipt_size THEN
      RAISE EXCEPTION 'O tamanho do recibo não confere com o arquivo arquivado.' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_receipt_metadata ->> 'mimetype', '') IS NOT NULL
       AND lower(v_receipt_metadata ->> 'mimetype') <> lower(p_receipt_mime) THEN
      RAISE EXCEPTION 'O tipo do recibo não confere com o arquivo arquivado.' USING ERRCODE = '22023';
    END IF;
  ELSIF NULLIF(btrim(COALESCE(p_receipt_name, '')), '') IS NOT NULL
        OR p_receipt_size IS NOT NULL
        OR NULLIF(btrim(COALESCE(p_receipt_mime, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Metadados de recibo exigem um arquivo arquivado.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.payroll_payments
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id
       OR v_existing.employee_id IS DISTINCT FROM p_employee_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.method IS DISTINCT FROM p_method
       OR v_existing.paid_on IS DISTINCT FROM p_paid_on
       OR COALESCE(v_existing.reference, '') IS DISTINCT FROM COALESCE(p_reference, '')
       OR COALESCE(v_existing.notes, '') IS DISTINCT FROM COALESCE(p_notes, '')
       OR COALESCE(v_existing.receipt_path, '') IS DISTINCT FROM COALESCE(p_receipt_path, '')
       OR COALESCE(v_existing.receipt_name, '') IS DISTINCT FROM COALESCE(p_receipt_name, '')
       OR v_existing.receipt_size IS DISTINCT FROM p_receipt_size
       OR COALESCE(v_existing.receipt_mime, '') IS DISTINCT FROM COALESCE(p_receipt_mime, '') THEN
      RAISE EXCEPTION 'Chave de idempotência já usada por outro pagamento.' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.payroll_payments (
    payroll_run_id, employee_id, amount, method, paid_on, reference, notes,
    receipt_path, receipt_name, receipt_size, receipt_mime, idempotency_key
  ) VALUES (
    p_payroll_run_id, p_employee_id, p_amount, p_method, p_paid_on,
    COALESCE(p_reference, ''), COALESCE(p_notes, ''), COALESCE(p_receipt_path, ''),
    COALESCE(p_receipt_name, ''), p_receipt_size, COALESCE(p_receipt_mime, ''),
    p_idempotency_key
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reverse_payroll_payment(p_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_run_id uuid;
  v_previous_command text := COALESCE(current_setting('app.payroll_payment_command', true), '');
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']) THEN
    RAISE EXCEPTION 'Usuário sem permissão para estornar pagamentos.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do estorno.' USING ERRCODE = '22023';
  END IF;

  SELECT payroll_run_id INTO v_run_id FROM public.payroll_payments WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.payroll_runs WHERE id = v_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folha de pagamento não encontrada.' USING ERRCODE = '23503'; END IF;

  PERFORM set_config('app.payroll_payment_command', 'reverse', true);
  UPDATE public.payroll_payments
  SET reversed_at = now(), reversal_reason = btrim(p_reason)
  WHERE id = p_id AND reversed_at IS NULL
  RETURNING id INTO v_id;
  PERFORM set_config('app.payroll_payment_command', v_previous_command, true);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Pagamento já foi estornado; atualize a tela.' USING ERRCODE = '55000';
  END IF;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.register_payroll_payment(
  uuid, uuid, numeric, text, date, text, text, text, text, integer, text, uuid
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_payroll_payment(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_payroll_payment(
  uuid, uuid, numeric, text, date, text, text, text, text, integer, text, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_payment(uuid, text)
  TO authenticated, service_role;

-- ── RLS de insumos e documentos salariais ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_payroll_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync$
BEGIN
  PERFORM public.recompute_payroll_paid(COALESCE(NEW.payroll_run_id, OLD.payroll_run_id));
  IF TG_OP = 'UPDATE' AND NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id THEN
    PERFORM public.recompute_payroll_paid(OLD.payroll_run_id);
  END IF;
  RETURN NULL;
END;
$sync$;

-- Os triggers legados carimbavam a ficha no primeiro pagamento parcial e
-- adquiriam row-lock antes do advisory usado pela ficha, abrindo ciclo de
-- deadlock. A recomputação canônica já sincroniza a ficha após cada mutação.
DROP TRIGGER IF EXISTS tg_ficha_stamp_payment ON public.payroll_payments;
DROP TRIGGER IF EXISTS tg_ficha_unstamp_payment ON public.payroll_payments;
DROP TRIGGER IF EXISTS tg_sync_payroll_paid ON public.payroll_payments;
CREATE TRIGGER tg_sync_payroll_paid
AFTER INSERT OR UPDATE OR DELETE ON public.payroll_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_payroll_paid();

REVOKE ALL ON FUNCTION public.recompute_payroll_paid(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_payroll_paid(uuid) TO service_role;

-- Policies são permissivas (combinadas por OR). Remover também todos os nomes
-- históricos evita que um grant amplo sobreviva ao contrato final de RH.
DROP POLICY IF EXISTS "Authenticated can read payroll_runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "Approved can write payroll_runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "approved users select payroll" ON public.payroll_runs;
DROP POLICY IF EXISTS "approved users modify payroll" ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_read ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_write ON public.payroll_runs;
CREATE POLICY payroll_runs_read ON public.payroll_runs
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
CREATE POLICY payroll_runs_write ON public.payroll_runs
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS "Approved users can read employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can insert employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can update employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Approved users can delete employee_advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can view advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can insert advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can update advances" ON public.employee_advances;
DROP POLICY IF EXISTS "Auth users can delete advances" ON public.employee_advances;
DROP POLICY IF EXISTS employee_advances_rh_select ON public.employee_advances;
DROP POLICY IF EXISTS employee_advances_rh_write ON public.employee_advances;
CREATE POLICY employee_advances_rh_select ON public.employee_advances
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS approved_select ON public.employee_absences;
DROP POLICY IF EXISTS approved_insert ON public.employee_absences;
DROP POLICY IF EXISTS approved_update ON public.employee_absences;
DROP POLICY IF EXISTS approved_delete ON public.employee_absences;
DROP POLICY IF EXISTS "Users can view their own absences" ON public.employee_absences;
DROP POLICY IF EXISTS "Admins can manage all absences" ON public.employee_absences;
CREATE POLICY employee_absences_rh_select ON public.employee_absences
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
CREATE POLICY employee_absences_rh_write ON public.employee_absences
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS holidays_mutate ON public.holidays;
DROP POLICY IF EXISTS holidays_select ON public.holidays;
DROP POLICY IF EXISTS "Auth users can view holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can delete holidays" ON public.holidays;
DROP POLICY IF EXISTS "Approved users can insert holidays" ON public.holidays;
DROP POLICY IF EXISTS "Approved users can update holidays" ON public.holidays;
DROP POLICY IF EXISTS "Approved users can delete holidays" ON public.holidays;
CREATE POLICY holidays_approved_select ON public.holidays
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY holidays_rh_write ON public.holidays
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS workday_swaps_select ON public.workday_swaps;
DROP POLICY IF EXISTS workday_swaps_mutate ON public.workday_swaps;
CREATE POLICY workday_swaps_approved_select ON public.workday_swaps
  FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY workday_swaps_rh_write ON public.workday_swaps
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS "Approved users can read payroll_payments" ON public.payroll_payments;
DROP POLICY IF EXISTS "Approved users can insert payroll_payments" ON public.payroll_payments;
DROP POLICY IF EXISTS "Approved users can update payroll_payments" ON public.payroll_payments;
DROP POLICY IF EXISTS "Approved users can delete payroll_payments" ON public.payroll_payments;
DROP POLICY IF EXISTS payroll_payments_read ON public.payroll_payments;
DROP POLICY IF EXISTS payroll_payments_write ON public.payroll_payments;
CREATE POLICY payroll_payments_read ON public.payroll_payments
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));

DROP POLICY IF EXISTS "Approved users can read employee-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can upload employee-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can update employee receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can delete employee-receipts" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete receipts" ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_select ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_insert ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_update ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_delete ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_update_unreferenced ON storage.objects;
DROP POLICY IF EXISTS employee_receipts_rh_delete_unreferenced ON storage.objects;
CREATE POLICY employee_receipts_rh_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'employee-receipts'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
CREATE POLICY employee_receipts_rh_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-receipts'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh']));
-- Retry pode substituir/remover somente upload órfão. Assim que qualquer linha
-- financeira referencia o path, o blob vira parte imutável da auditoria.
CREATE POLICY employee_receipts_rh_update_unreferenced ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-receipts'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_payments p WHERE p.receipt_path = storage.objects.name
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_advances a
      WHERE COALESCE(a.receipt_url, '') = storage.objects.name
         OR right(COALESCE(a.receipt_url, ''), length(storage.objects.name)) = storage.objects.name
    )
  )
  WITH CHECK (
    bucket_id = 'employee-receipts'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_payments p WHERE p.receipt_path = storage.objects.name
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_advances a
      WHERE COALESCE(a.receipt_url, '') = storage.objects.name
         OR right(COALESCE(a.receipt_url, ''), length(storage.objects.name)) = storage.objects.name
    )
  );
CREATE POLICY employee_receipts_rh_delete_unreferenced ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-receipts'
    AND public.user_has_any_role(ARRAY['admin', 'gerente', 'rh'])
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_payments p WHERE p.receipt_path = storage.objects.name
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_advances a
      WHERE COALESCE(a.receipt_url, '') = storage.objects.name
         OR right(COALESCE(a.receipt_url, ''), length(storage.objects.name)) = storage.objects.name
    )
  );

-- Escrita financeira só pelas funções SECURITY DEFINER acima. As tabelas
-- continuam legíveis ao RH, mas INSERT/UPDATE/DELETE diretos são negados mesmo
-- que uma policy permissiva histórica volte a aparecer.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.employee_advances
FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payroll_payments
FROM PUBLIC, anon, authenticated;

-- TRUNCATE não passa por RLS nem pelos guards financeiros. O frontend usa os
-- comandos/RPCs canônicos e nunca precisa dele.
REVOKE TRUNCATE ON TABLE
  public.payroll_runs,
  public.payroll_payments,
  public.employee_advances,
  public.employee_absences,
  public.employees,
  public.work_schedules,
  public.holidays,
  public.workday_swaps,
  public.overtime_resolutions,
  public.ficha_montadores
FROM PUBLIC, anon, authenticated;

-- Folha é documento financeiro permanente. Rascunho é recalculado por upsert
-- e fechamento é desfeito por cancelamento; não há fluxo legítimo de DELETE.
-- Isto também impede que o CASCADE apague pagamentos e seus vínculos de recibo.
REVOKE DELETE ON TABLE public.payroll_runs
FROM PUBLIC, anon, authenticated;

DO $migration_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employee_advances
    WHERE amount <= 0 OR amount <> round(amount, 2)
      OR status NOT IN ('pending', 'paid', 'deducted', 'baixado_externo', 'cancelado')
      OR ((status = 'deducted') IS DISTINCT FROM (payroll_run_id IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Adiantamentos fora do contrato após migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.payroll_runs'::regclass
      AND c.conname = 'payroll_runs_employee_id_fkey'
      AND c.contype = 'f'
      AND c.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'Folha ainda permite exclusão em cascata pelo funcionário';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_payments p
    JOIN public.payroll_runs pr ON pr.id = p.payroll_run_id
    WHERE p.employee_id IS DISTINCT FROM pr.employee_id
       OR p.amount <= 0
       OR p.amount <> round(p.amount, 2)
  ) THEN
    RAISE EXCEPTION 'Pagamento com funcionário ou valor fora do contrato';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payroll_payments
    WHERE (reversed_at IS NULL AND (reversed_by IS NOT NULL OR reversal_reason IS NOT NULL))
       OR (reversed_at IS NOT NULL AND NULLIF(btrim(reversal_reason), '') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Pagamento estornado sem trilha completa';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payroll_runs pr
    WHERE (
      pr.status = 'aprovado'
      AND (
        round(COALESCE(pr.total_liquido, 0), 2) <= 0
        OR round(COALESCE((
          SELECT sum(p.amount) FROM public.payroll_payments p
          WHERE p.payroll_run_id = pr.id AND p.reversed_at IS NULL
        ), 0), 2) >= round(COALESCE(pr.total_liquido, 0), 2)
      )
    ) OR (
      pr.status = 'pago'
      AND round(COALESCE(pr.total_liquido, 0), 2) > 0
      AND round(COALESCE((
        SELECT sum(p.amount) FROM public.payroll_payments p
        WHERE p.payroll_run_id = pr.id AND p.reversed_at IS NULL
      ), 0), 2) < round(COALESCE(pr.total_liquido, 0), 2)
    )
  ) THEN
    RAISE EXCEPTION 'Status da folha diverge da soma ativa de pagamentos';
  END IF;
END
$migration_check$;

COMMIT;
