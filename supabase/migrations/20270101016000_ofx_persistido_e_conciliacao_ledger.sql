-- =============================================================================
-- Extrato OFX persistido + conciliacao autoritativa no ledger financeiro
-- =============================================================================
-- O cliente pode escolher somente a conta cadastrada, a linha persistida e o
-- titulo. Valor, data, banco, origem e FITID sao sempre derivados pelo servidor.
-- Um match OFX so pode ser estornado por `unmatch`, que reverte o evento e
-- desmarca a linha na mesma transacao.

DO $preflight_160$
BEGIN
  IF pg_catalog.to_regnamespace('private') IS NULL
     OR pg_catalog.to_regclass('public.bank_accounts') IS NULL
     OR pg_catalog.to_regclass('public.bank_reconciliations') IS NULL
     OR pg_catalog.to_regclass('public.bank_reconciliation_items') IS NULL THEN
    RAISE EXCEPTION 'Preflight 16000: estruturas bancarias ausentes';
  END IF;
  IF pg_catalog.to_regprocedure(
       'private.execute_financial_settlement_core_159(uuid,text,jsonb,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure('public.strap_payload_hash(jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.user_has_any_role(text[])') IS NULL THEN
    RAISE EXCEPTION 'Preflight 16000: contrato financeiro 15900 ausente';
  END IF;
  -- Nao existe identidade FITID recuperavel nas linhas antigas. Falhar e pedir
  -- decisao e mais seguro que fabricar identidade ou apagar historico.
  IF EXISTS (SELECT 1 FROM public.bank_reconciliations)
     OR EXISTS (SELECT 1 FROM public.bank_reconciliation_items) THEN
    RAISE EXCEPTION
      'Preflight 16000: existem conciliacoes legadas sem FITID; migracao assistida obrigatoria';
  END IF;
END;
$preflight_160$;

CREATE TABLE public.bank_reconciliation_command_receipts (
  command_id uuid PRIMARY KEY,
  command text NOT NULL,
  payload_hash text NOT NULL,
  actor_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bank_reconciliation_receipts_command_ck
    CHECK (command IN ('import', 'match', 'unmatch')),
  CONSTRAINT bank_reconciliation_receipts_hash_ck
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT bank_reconciliation_receipts_result_ck
    CHECK (pg_catalog.jsonb_typeof(result) = 'object')
);

ALTER TABLE public.bank_reconciliations
  DROP CONSTRAINT bank_reconciliations_bank_account_id_fkey,
  ALTER COLUMN imported_by SET NOT NULL,
  ADD COLUMN import_command_id uuid NOT NULL,
  ADD COLUMN statement_hash text NOT NULL,
  ADD COLUMN source_version integer NOT NULL,
  ADD COLUMN account_kind text NOT NULL,
  ADD COLUMN institution_id text NOT NULL,
  ADD COLUMN bank_id text NOT NULL,
  ADD COLUMN branch_id text NOT NULL,
  ADD COLUMN account_number text NOT NULL,
  ADD COLUMN account_type text NOT NULL,
  ADD COLUMN currency text NOT NULL,
  ADD COLUMN ledger_balance numeric,
  ADD COLUMN ledger_balance_date date,
  ADD COLUMN transaction_count integer NOT NULL DEFAULT 0,
  ADD COLUMN pending_count integer NOT NULL DEFAULT 0,
  ADD COLUMN duplicate_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT bank_reconciliations_bank_account_id_fkey
    FOREIGN KEY (bank_account_id)
    REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bank_reconciliations_import_command_uq
    UNIQUE (import_command_id),
  ADD CONSTRAINT bank_reconciliations_import_command_fk
    FOREIGN KEY (import_command_id)
    REFERENCES public.bank_reconciliation_command_receipts(command_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT bank_reconciliations_statement_uq
    UNIQUE (bank_account_id, statement_hash),
  ADD CONSTRAINT bank_reconciliations_identity_uq
    UNIQUE (id, bank_account_id),
  ADD CONSTRAINT bank_reconciliations_statement_hash_ck
    CHECK (statement_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT bank_reconciliations_source_version_ck
    CHECK (source_version = 1),
  ADD CONSTRAINT bank_reconciliations_account_kind_ck
    CHECK (account_kind IN ('bank', 'credit-card')),
  ADD CONSTRAINT bank_reconciliations_currency_ck
    CHECK (currency = 'BRL'),
  ADD CONSTRAINT bank_reconciliations_counts_ck CHECK (
    transaction_count >= 0 AND pending_count >= 0 AND duplicate_count >= 0
    AND matched_count >= 0 AND unmatched_count >= 0
    AND matched_count + unmatched_count = transaction_count
  ),
  ADD CONSTRAINT bank_reconciliations_balance_ck CHECK (
    (ledger_balance IS NULL AND ledger_balance_date IS NULL)
    OR (ledger_balance IS NOT NULL AND ledger_balance_date IS NOT NULL
      AND ledger_balance::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND ledger_balance = pg_catalog.round(ledger_balance, 2))
  );

ALTER TABLE public.bank_reconciliation_items
  DROP CONSTRAINT bank_reconciliation_items_reconciliation_id_fkey,
  DROP CONSTRAINT bank_reconciliation_items_matched_to_type_check,
  DROP CONSTRAINT bank_reconciliation_items_status_check,
  ADD COLUMN bank_account_id uuid NOT NULL,
  ADD COLUMN fit_id text NOT NULL,
  ADD COLUMN posted_at_raw text NOT NULL,
  ADD COLUMN amount_cents bigint NOT NULL,
  ADD COLUMN transaction_type text NOT NULL,
  ADD COLUMN transaction_name text NOT NULL,
  ADD COLUMN memo text NOT NULL,
  ADD COLUMN check_number text NOT NULL,
  ADD COLUMN reference_number text NOT NULL,
  ADD COLUMN raw_hash text NOT NULL,
  ADD COLUMN settlement_event_id uuid,
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT bank_reconciliation_items_header_fk
    FOREIGN KEY (reconciliation_id, bank_account_id)
    REFERENCES public.bank_reconciliations(id, bank_account_id) ON DELETE RESTRICT,
  ADD CONSTRAINT bank_reconciliation_items_settlement_fk
    FOREIGN KEY (settlement_event_id)
    REFERENCES public.financial_settlement_events(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bank_reconciliation_items_fitid_uq
    UNIQUE (bank_account_id, fit_id),
  ADD CONSTRAINT bank_reconciliation_items_action_scope_uq
    UNIQUE (id, reconciliation_id),
  ADD CONSTRAINT bank_reconciliation_items_raw_hash_ck
    CHECK (raw_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT bank_reconciliation_items_revision_ck
    CHECK (revision >= 0),
  ADD CONSTRAINT bank_reconciliation_items_amount_ck CHECK (
    amount_cents <> 0
    AND amount = pg_catalog.abs(amount_cents::numeric) / 100
    AND amount = pg_catalog.round(amount, 2)
    AND ((amount_cents > 0 AND movement_type = 'credito')
      OR (amount_cents < 0 AND movement_type = 'debito'))
  ),
  ADD CONSTRAINT bank_reconciliation_items_match_type_ck
    CHECK (matched_to_type IS NULL OR matched_to_type IN ('payable', 'receivable')),
  ADD CONSTRAINT bank_reconciliation_items_status_ck
    CHECK (status IN ('nao_conciliado', 'conciliado')),
  ADD CONSTRAINT bank_reconciliation_items_projection_ck CHECK (
    (status = 'nao_conciliado'
      AND matched_to_type IS NULL AND matched_to_id IS NULL
      AND matched_at IS NULL AND matched_by IS NULL
      AND settlement_event_id IS NULL)
    OR
    (status = 'conciliado'
      AND matched_to_type IS NOT NULL AND matched_to_id IS NOT NULL
      AND matched_at IS NOT NULL AND matched_by IS NOT NULL
      AND settlement_event_id IS NOT NULL)
  );

CREATE TABLE public.bank_reconciliation_actions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  command_id uuid NOT NULL,
  batch_position integer NOT NULL,
  reconciliation_id uuid NOT NULL,
  item_id uuid NOT NULL,
  action_type text NOT NULL,
  from_revision integer NOT NULL,
  to_revision integer NOT NULL,
  account_kind text NOT NULL,
  payable_id uuid REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  receivable_id uuid REFERENCES public.accounts_receivable(id) ON DELETE RESTRICT,
  settlement_event_id uuid NOT NULL UNIQUE
    REFERENCES public.financial_settlement_events(id) ON DELETE RESTRICT,
  reverses_action_id uuid REFERENCES public.bank_reconciliation_actions(id) ON DELETE RESTRICT,
  reason text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bank_reconciliation_actions_receipt_fk
    FOREIGN KEY (command_id)
    REFERENCES public.bank_reconciliation_command_receipts(command_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT bank_reconciliation_actions_header_fk
    FOREIGN KEY (reconciliation_id)
    REFERENCES public.bank_reconciliations(id) ON DELETE RESTRICT,
  CONSTRAINT bank_reconciliation_actions_item_scope_fk
    FOREIGN KEY (item_id, reconciliation_id)
    REFERENCES public.bank_reconciliation_items(id, reconciliation_id)
    ON DELETE RESTRICT,
  CONSTRAINT bank_reconciliation_actions_command_position_uq
    UNIQUE (command_id, batch_position),
  CONSTRAINT bank_reconciliation_actions_item_revision_uq
    UNIQUE (item_id, to_revision),
  CONSTRAINT bank_reconciliation_actions_type_ck
    CHECK (action_type IN ('match', 'unmatch')),
  CONSTRAINT bank_reconciliation_actions_revision_ck
    CHECK (from_revision >= 0 AND to_revision = from_revision + 1),
  CONSTRAINT bank_reconciliation_actions_target_ck CHECK (
    (account_kind = 'payable' AND payable_id IS NOT NULL AND receivable_id IS NULL)
    OR
    (account_kind = 'receivable' AND receivable_id IS NOT NULL AND payable_id IS NULL)
  ),
  CONSTRAINT bank_reconciliation_actions_shape_ck CHECK (
    (action_type = 'match' AND reverses_action_id IS NULL AND reason IS NULL)
    OR
    (action_type = 'unmatch' AND reverses_action_id IS NOT NULL
      AND reason IS NOT NULL AND pg_catalog.length(reason) BETWEEN 1 AND 4000)
  )
);

CREATE UNIQUE INDEX bank_reconciliation_actions_one_unmatch_uq
  ON public.bank_reconciliation_actions (reverses_action_id)
  WHERE reverses_action_id IS NOT NULL;
CREATE INDEX bank_reconciliation_actions_item_idx
  ON public.bank_reconciliation_actions (item_id, to_revision DESC);
CREATE INDEX bank_reconciliation_items_session_idx
  ON public.bank_reconciliation_items (reconciliation_id, movement_date, id);

COMMENT ON TABLE public.bank_reconciliation_command_receipts IS
  'Recibos idempotentes de importacao, match e unmatch de extrato. Payload divergente nunca reutiliza command_id.';
COMMENT ON TABLE public.bank_reconciliation_actions IS
  'Auditoria imutavel de match/unmatch. O estorno OFX reverte o ledger e a linha do extrato atomicamente.';
COMMENT ON COLUMN public.bank_reconciliation_items.fit_id IS
  'Identidade bancaria unica no escopo da conta cadastrada; descricao/data/valor nao substituem FITID.';
COMMENT ON COLUMN public.bank_reconciliation_items.revision IS
  'CAS persistido. Retry repete o recibo; rematch apos unmatch usa uma revisao nova.';

CREATE OR REPLACE FUNCTION private.normalize_bank_identity_160(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.upper(pg_catalog.btrim(COALESCE(p_value, ''))),
    '[^A-Z0-9]', '', 'g'
  )
$function$;

CREATE OR REPLACE FUNCTION private.ofx_settlement_method_160(
  p_type text,
  p_name text,
  p_memo text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.upper(COALESCE(p_name, '') || ' ' || COALESCE(p_memo, ''))
      LIKE '%PIX%' THEN 'pix'
    WHEN pg_catalog.upper(COALESCE(p_type, '')) = 'CHECK' THEN 'cheque'
    WHEN pg_catalog.upper(COALESCE(p_type, '')) = 'CASH' THEN 'dinheiro'
    WHEN pg_catalog.upper(COALESCE(p_type, '')) IN ('XFER', 'DIRECTDEP', 'DIRECTDEBIT')
      THEN 'transferencia'
    ELSE 'outro'
  END
$function$;

CREATE OR REPLACE FUNCTION private.tg_bank_reconciliation_immutable_160()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% e imutavel; use execute_bank_reconciliation_command', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER trg_bank_reconciliation_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.bank_reconciliation_command_receipts
  FOR EACH ROW EXECUTE FUNCTION private.tg_bank_reconciliation_immutable_160();
CREATE TRIGGER trg_bank_reconciliation_actions_immutable
  BEFORE UPDATE OR DELETE ON public.bank_reconciliation_actions
  FOR EACH ROW EXECUTE FUNCTION private.tg_bank_reconciliation_immutable_160();

CREATE OR REPLACE FUNCTION private.tg_bank_reconciliation_item_guard_160()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action public.bank_reconciliation_actions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Linha OFX e evidencia imutavel; exclusao proibida'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'nao_conciliado' OR NEW.revision <> 0
       OR NEW.matched_to_type IS NOT NULL OR NEW.matched_to_id IS NOT NULL
       OR NEW.matched_at IS NOT NULL OR NEW.matched_by IS NOT NULL
       OR NEW.settlement_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Linha OFX nova deve iniciar nao conciliada na revisao zero'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(
    NEW.reconciliation_id, NEW.bank_account_id, NEW.movement_date,
    NEW.movement_type, NEW.amount, NEW.description, NEW.bank_reference,
    NEW.fit_id, NEW.posted_at_raw, NEW.amount_cents, NEW.transaction_type,
    NEW.transaction_name, NEW.memo, NEW.check_number,
    NEW.reference_number, NEW.raw_hash
  ) IS DISTINCT FROM ROW(
    OLD.reconciliation_id, OLD.bank_account_id, OLD.movement_date,
    OLD.movement_type, OLD.amount, OLD.description, OLD.bank_reference,
    OLD.fit_id, OLD.posted_at_raw, OLD.amount_cents, OLD.transaction_type,
    OLD.transaction_name, OLD.memo, OLD.check_number,
    OLD.reference_number, OLD.raw_hash
  ) THEN
    RAISE EXCEPTION 'Evidencia OFX e imutavel; reimporte o arquivo correto'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Revisao OFX invalida: esperado %, recebido %',
      OLD.revision + 1, NEW.revision USING ERRCODE = '40001';
  END IF;
  SELECT action.* INTO v_action
    FROM public.bank_reconciliation_actions action
   WHERE action.item_id = NEW.id
     AND action.from_revision = OLD.revision
     AND action.to_revision = NEW.revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alteracao OFX exige acao imutavel correspondente'
      USING ERRCODE = '42501';
  END IF;
  IF v_action.action_type = 'match' THEN
    IF NEW.status <> 'conciliado'
       OR NEW.matched_to_type IS DISTINCT FROM v_action.account_kind
       OR NEW.matched_to_id IS DISTINCT FROM
          COALESCE(v_action.payable_id, v_action.receivable_id)
       OR NEW.settlement_event_id IS DISTINCT FROM v_action.settlement_event_id
       OR NEW.matched_by IS DISTINCT FROM v_action.actor_id
       OR NEW.matched_at IS DISTINCT FROM v_action.created_at THEN
      RAISE EXCEPTION 'Projecao do match OFX diverge da auditoria'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.status <> 'nao_conciliado'
       OR NEW.matched_to_type IS NOT NULL OR NEW.matched_to_id IS NOT NULL
       OR NEW.matched_at IS NOT NULL OR NEW.matched_by IS NOT NULL
       OR NEW.settlement_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Projecao do unmatch OFX diverge da auditoria'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_bank_reconciliation_item_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION private.tg_bank_reconciliation_item_guard_160();

CREATE OR REPLACE FUNCTION private.refresh_bank_reconciliation_160(
  p_reconciliation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_total integer;
  v_matched integer;
BEGIN
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (WHERE item.status = 'conciliado')::integer
    INTO v_total, v_matched
    FROM public.bank_reconciliation_items item
   WHERE item.reconciliation_id = p_reconciliation_id;
  UPDATE public.bank_reconciliations reconciliation
     SET transaction_count = v_total,
         matched_count = v_matched,
         unmatched_count = v_total - v_matched,
         status = CASE WHEN v_total = v_matched THEN 'conciliada'
           ELSE 'em_andamento' END
   WHERE reconciliation.id = p_reconciliation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conciliacao % nao encontrada', p_reconciliation_id
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_bank_reconciliation_command(
  p_command_id uuid,
  p_command text,
  p_payload jsonb,
  p_expected_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
  v_payload_hash text;
  v_receipt public.bank_reconciliation_command_receipts%ROWTYPE;
  v_bank public.bank_accounts%ROWTYPE;
  v_reconciliation public.bank_reconciliations%ROWTYPE;
  v_item public.bank_reconciliation_items%ROWTYPE;
  v_match_action public.bank_reconciliation_actions%ROWTYPE;
  v_action_id uuid;
  v_action_created_at timestamptz;
  v_event public.financial_settlement_events%ROWTYPE;
  v_statement jsonb;
  v_account jsonb;
  v_transactions jsonb;
  v_balance jsonb;
  v_entry jsonb;
  v_transaction jsonb;
  v_position integer;
  v_count integer;
  v_existing_id uuid;
  v_reconciliation_id uuid;
  v_item_id uuid;
  v_account_id uuid;
  v_expected_revision integer;
  v_kind text;
  v_reason text;
  v_reversed_on date;
  v_fit_id text;
  v_posted_date date;
  v_amount_cents bigint;
  v_statement_hash text;
  v_core_payload jsonb := pg_catalog.jsonb_build_object('entries', '[]'::jsonb);
  v_core_result jsonb;
  v_source_reference text;
  v_source_line_key text;
  v_result jsonb;
  v_event_ids jsonb := '[]'::jsonb;
  v_item_results jsonb := '[]'::jsonb;
BEGIN
  IF p_expected_actor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'A sessao mudou; atualize antes de operar a conciliacao'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permissao negada para conciliacao bancaria'
      USING ERRCODE = '42501';
  END IF;
  IF v_actor_id IS NULL OR p_command_id IS NULL
     OR p_command NOT IN ('import', 'match', 'unmatch')
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Comando de conciliacao invalido'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := public.strap_payload_hash(pg_catalog.jsonb_build_object(
    'command', p_command, 'payload', p_payload
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_command_id::text, 160)
  );
  SELECT receipt.* INTO v_receipt
    FROM public.bank_reconciliation_command_receipts receipt
   WHERE receipt.command_id = p_command_id;
  IF FOUND THEN
    IF v_receipt.command IS DISTINCT FROM p_command
       OR v_receipt.payload_hash IS DISTINCT FROM v_payload_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Replay divergente para command_id %', p_command_id
        USING ERRCODE = '23505';
    END IF;
    RETURN v_receipt.result || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  IF p_command = 'import' THEN
    IF NOT (p_payload ? 'bank_account_id' AND p_payload ? 'statement')
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_payload)) <> 2
       OR pg_catalog.jsonb_typeof(p_payload -> 'statement') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Importacao exige apenas bank_account_id e statement'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_account_id := (p_payload ->> 'bank_account_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Conta bancaria invalida' USING ERRCODE = '22023';
    END;
    SELECT bank.* INTO v_bank
      FROM public.bank_accounts bank
     WHERE bank.id = v_account_id
     FOR UPDATE;
    IF NOT FOUND OR v_bank.active IS NOT TRUE THEN
      RAISE EXCEPTION 'Conta bancaria inexistente ou inativa'
        USING ERRCODE = '23503';
    END IF;
    v_statement := p_payload -> 'statement';
    IF NOT (v_statement ? 'version' AND v_statement ? 'account'
      AND v_statement ? 'transactions' AND v_statement ? 'balance'
      AND v_statement ? 'pending_count' AND v_statement ? 'duplicate_count')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(v_statement) key
         WHERE key NOT IN ('version', 'account', 'transactions', 'balance',
           'pending_count', 'duplicate_count')
      ) THEN
      RAISE EXCEPTION 'Manifesto OFX possui campos ausentes ou desconhecidos'
        USING ERRCODE = '22023';
    END IF;
    v_account := v_statement -> 'account';
    v_transactions := v_statement -> 'transactions';
    v_balance := v_statement -> 'balance';
    IF (v_statement ->> 'version') IS DISTINCT FROM '1'
       OR pg_catalog.jsonb_typeof(v_statement -> 'version') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(v_statement -> 'pending_count') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(v_statement -> 'duplicate_count') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(v_account) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_transactions) IS DISTINCT FROM 'array'
       OR (v_balance <> 'null'::jsonb
         AND pg_catalog.jsonb_typeof(v_balance) IS DISTINCT FROM 'object')
       OR NOT (v_account ? 'kind' AND v_account ? 'institution_id'
         AND v_account ? 'bank_id' AND v_account ? 'branch_id'
         AND v_account ? 'account_id' AND v_account ? 'account_type'
         AND v_account ? 'currency')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(v_account) key
          WHERE key NOT IN ('kind', 'institution_id', 'bank_id', 'branch_id',
            'account_id', 'account_type', 'currency')
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_each(v_account) field(key, value)
          WHERE pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string'
       ) THEN
      RAISE EXCEPTION 'Identidade/estrutura OFX invalida'
        USING ERRCODE = '22023';
    END IF;
    IF v_account ->> 'kind' NOT IN ('bank', 'credit-card')
       OR v_account ->> 'currency' <> 'BRL'
       OR NULLIF(private.normalize_bank_identity_160(v_account ->> 'account_id'), '') IS NULL
       OR private.normalize_bank_identity_160(v_bank.account_number)
          IS DISTINCT FROM private.normalize_bank_identity_160(v_account ->> 'account_id')
       OR private.normalize_bank_identity_160(v_bank.agency)
          IS DISTINCT FROM private.normalize_bank_identity_160(v_account ->> 'branch_id') THEN
      RAISE EXCEPTION 'O OFX nao corresponde a conta/agencia cadastrada ou nao esta em BRL'
        USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(COALESCE(v_account ->> 'institution_id', '')) > 500
       OR pg_catalog.length(COALESCE(v_account ->> 'bank_id', '')) > 100
       OR pg_catalog.length(COALESCE(v_account ->> 'branch_id', '')) > 100
       OR pg_catalog.length(COALESCE(v_account ->> 'account_id', '')) > 200
       OR pg_catalog.length(COALESCE(v_account ->> 'account_type', '')) > 100 THEN
      RAISE EXCEPTION 'Identidade OFX excede os limites aceitos'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_count := pg_catalog.jsonb_array_length(v_transactions);
      IF (v_statement ->> 'pending_count') !~ '^(0|[1-9][0-9]*)$'
         OR (v_statement ->> 'duplicate_count') !~ '^(0|[1-9][0-9]*)$'
         OR (v_statement ->> 'pending_count')::integer < 0
         OR (v_statement ->> 'duplicate_count')::integer < 0 THEN
        RAISE EXCEPTION 'Contadores OFX invalidos' USING ERRCODE = '22023';
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Contadores OFX invalidos' USING ERRCODE = '22023';
    END;
    IF v_count > 50000 THEN
      RAISE EXCEPTION 'Extrato excede 50 mil lancamentos'
        USING ERRCODE = '22023';
    END IF;
    IF v_balance = 'null'::jsonb AND v_count = 0 THEN
      RAISE EXCEPTION 'Extrato sem lancamentos e sem saldo nao pode ser persistido'
        USING ERRCODE = '22023';
    END IF;
    IF v_balance <> 'null'::jsonb THEN
      IF NOT (v_balance ? 'amount_cents' AND v_balance ? 'as_of_date'
        AND v_balance ? 'as_of_raw')
        OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_balance)) <> 3
        OR pg_catalog.jsonb_typeof(v_balance -> 'amount_cents') IS DISTINCT FROM 'number'
        OR pg_catalog.jsonb_typeof(v_balance -> 'as_of_date') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(v_balance -> 'as_of_raw') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Saldo OFX invalido' USING ERRCODE = '22023';
      END IF;
      IF (v_balance ->> 'amount_cents') !~ '^-?(0|[1-9][0-9]*)$'
         OR (v_balance ->> 'as_of_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Saldo/data OFX invalidos' USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_amount_cents := (v_balance ->> 'amount_cents')::bigint;
        v_posted_date := (v_balance ->> 'as_of_date')::date;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
          OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Saldo/data OFX invalidos' USING ERRCODE = '22023';
      END;
      IF v_posted_date IS NULL
         OR pg_catalog.left(COALESCE(v_balance ->> 'as_of_raw', ''), 8)
           <> pg_catalog.to_char(v_posted_date, 'YYYYMMDD')
         OR pg_catalog.length(COALESCE(v_balance ->> 'as_of_raw', '')) > 100 THEN
        RAISE EXCEPTION 'Evidencia temporal do saldo OFX invalida'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    FOR v_transaction, v_position IN
      SELECT input.value, input.ordinality::integer
        FROM pg_catalog.jsonb_array_elements(v_transactions)
          WITH ORDINALITY input(value, ordinality)
    LOOP
      IF pg_catalog.jsonb_typeof(v_transaction) IS DISTINCT FROM 'object'
         OR NOT (v_transaction ? 'fit_id' AND v_transaction ? 'posted_date'
           AND v_transaction ? 'posted_at_raw' AND v_transaction ? 'amount_cents'
           AND v_transaction ? 'transaction_type' AND v_transaction ? 'name'
           AND v_transaction ? 'memo' AND v_transaction ? 'check_number'
           AND v_transaction ? 'reference_number')
         OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_transaction)) <> 9 THEN
        RAISE EXCEPTION 'Lancamento OFX % possui estrutura invalida', v_position
          USING ERRCODE = '22023';
      END IF;
      IF pg_catalog.jsonb_typeof(v_transaction -> 'amount_cents') IS DISTINCT FROM 'number'
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_each(v_transaction) field(key, value)
            WHERE field.key <> 'amount_cents'
              AND pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string'
         ) THEN
        RAISE EXCEPTION 'Lancamento OFX % possui tipos invalidos', v_position
          USING ERRCODE = '22023';
      END IF;
      IF (v_transaction ->> 'amount_cents') !~ '^-?(0|[1-9][0-9]*)$'
         OR (v_transaction ->> 'posted_date')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Lancamento OFX % possui centavos/data invalidos', v_position
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_fit_id := NULLIF(pg_catalog.btrim(v_transaction ->> 'fit_id'), '');
        v_posted_date := (v_transaction ->> 'posted_date')::date;
        v_amount_cents := (v_transaction ->> 'amount_cents')::bigint;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
          OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Lancamento OFX % possui valor/data invalido', v_position
          USING ERRCODE = '22023';
      END;
      IF v_fit_id IS NULL OR pg_catalog.length(v_fit_id) > 200
         OR v_amount_cents = 0 OR v_posted_date IS NULL
         OR v_posted_date > v_today
         OR pg_catalog.left(COALESCE(v_transaction ->> 'posted_at_raw', ''), 8)
           <> pg_catalog.to_char(v_posted_date, 'YYYYMMDD')
         OR pg_catalog.length(COALESCE(v_transaction ->> 'posted_at_raw', '')) > 100
         OR pg_catalog.length(COALESCE(v_transaction ->> 'transaction_type', '')) > 100
         OR pg_catalog.length(COALESCE(v_transaction ->> 'name', '')) > 2048
         OR pg_catalog.length(COALESCE(v_transaction ->> 'memo', '')) > 2048
         OR pg_catalog.length(COALESCE(v_transaction ->> 'check_number', '')) > 500
         OR pg_catalog.length(COALESCE(v_transaction ->> 'reference_number', '')) > 500 THEN
        RAISE EXCEPTION 'Lancamento OFX % viola limites/identidade/data', v_position
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (SELECT pg_catalog.count(DISTINCT input.value ->> 'fit_id')
          FROM pg_catalog.jsonb_array_elements(v_transactions) input(value)) <> v_count THEN
      RAISE EXCEPTION 'FITID repetido no manifesto OFX'
        USING ERRCODE = '22023';
    END IF;

    v_statement_hash := public.strap_payload_hash(v_statement);
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_account_id::text || ':' || v_statement_hash, 160)
    );
    SELECT reconciliation.id INTO v_existing_id
      FROM public.bank_reconciliations reconciliation
     WHERE reconciliation.bank_account_id = v_account_id
       AND reconciliation.statement_hash = v_statement_hash;
    IF v_existing_id IS NOT NULL THEN
      v_result := pg_catalog.jsonb_build_object(
        'ok', true, 'command_id', p_command_id, 'command', p_command,
        'reconciliation_id', v_existing_id, 'event_ids', '[]'::jsonb,
        'item_count', v_count, 'reused', true, 'replayed', false
      );
      INSERT INTO public.bank_reconciliation_command_receipts (
        command_id, command, payload_hash, actor_id, result
      ) VALUES (p_command_id, p_command, v_payload_hash, v_actor_id, v_result);
      RETURN v_result;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_transactions) input(value)
        JOIN public.bank_reconciliation_items item
          ON item.bank_account_id = v_account_id
         AND item.fit_id = input.value ->> 'fit_id'
    ) THEN
      RAISE EXCEPTION
        'O extrato sobrepoe FITID ja importado em outra sessao; use a sessao existente'
        USING ERRCODE = '23505';
    END IF;
    v_reconciliation_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.bank_reconciliations (
      id, bank_account_id, reconciliation_date, imported_by,
      total_credits, total_debits, matched_count, unmatched_count,
      status, notes, import_command_id, statement_hash, source_version,
      account_kind, institution_id, bank_id, branch_id, account_number,
      account_type, currency, ledger_balance, ledger_balance_date,
      transaction_count, pending_count, duplicate_count
    ) VALUES (
      v_reconciliation_id, v_account_id,
      COALESCE(
        CASE WHEN v_balance <> 'null'::jsonb THEN (v_balance ->> 'as_of_date')::date END,
        (SELECT pg_catalog.max((input.value ->> 'posted_date')::date)
           FROM pg_catalog.jsonb_array_elements(v_transactions) input(value)),
        v_today
      ),
      v_actor_id,
      COALESCE((SELECT pg_catalog.sum((input.value ->> 'amount_cents')::numeric)
        FILTER (WHERE (input.value ->> 'amount_cents')::bigint > 0)
        FROM pg_catalog.jsonb_array_elements(v_transactions) input(value)), 0) / 100,
      COALESCE((SELECT pg_catalog.sum(pg_catalog.abs((input.value ->> 'amount_cents')::numeric))
        FILTER (WHERE (input.value ->> 'amount_cents')::bigint < 0)
        FROM pg_catalog.jsonb_array_elements(v_transactions) input(value)), 0) / 100,
      0, v_count, CASE WHEN v_count = 0 THEN 'conciliada' ELSE 'em_andamento' END,
      NULL, p_command_id, v_statement_hash, 1,
      v_account ->> 'kind', v_account ->> 'institution_id',
      v_account ->> 'bank_id', v_account ->> 'branch_id',
      v_account ->> 'account_id', v_account ->> 'account_type', 'BRL',
      CASE WHEN v_balance <> 'null'::jsonb
        THEN (v_balance ->> 'amount_cents')::numeric / 100 END,
      CASE WHEN v_balance <> 'null'::jsonb
        THEN (v_balance ->> 'as_of_date')::date END,
      v_count, (v_statement ->> 'pending_count')::integer,
      (v_statement ->> 'duplicate_count')::integer
    );
    FOR v_transaction, v_position IN
      SELECT input.value, input.ordinality::integer
        FROM pg_catalog.jsonb_array_elements(v_transactions)
          WITH ORDINALITY input(value, ordinality)
    LOOP
      v_amount_cents := (v_transaction ->> 'amount_cents')::bigint;
      v_item_id := pg_catalog.gen_random_uuid();
      INSERT INTO public.bank_reconciliation_items (
        id, reconciliation_id, bank_account_id, movement_date,
        movement_type, amount, description, bank_reference,
        matched_to_type, matched_to_id, matched_at, matched_by,
        status, notes, fit_id, posted_at_raw, amount_cents,
        transaction_type, transaction_name, memo, check_number,
        reference_number, raw_hash, settlement_event_id, revision
      ) VALUES (
        v_item_id, v_reconciliation_id, v_account_id,
        (v_transaction ->> 'posted_date')::date,
        CASE WHEN v_amount_cents > 0 THEN 'credito' ELSE 'debito' END,
        pg_catalog.abs(v_amount_cents::numeric) / 100,
        NULLIF(pg_catalog.btrim(COALESCE(v_transaction ->> 'name', '') ||
          CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(v_transaction ->> 'memo', '')), '') IS NULL
            THEN '' ELSE ' - ' || pg_catalog.btrim(v_transaction ->> 'memo') END), ''),
        NULLIF(v_transaction ->> 'reference_number', ''),
        NULL, NULL, NULL, NULL, 'nao_conciliado', NULL,
        pg_catalog.btrim(v_transaction ->> 'fit_id'),
        v_transaction ->> 'posted_at_raw', v_amount_cents,
        v_transaction ->> 'transaction_type', v_transaction ->> 'name',
        v_transaction ->> 'memo', v_transaction ->> 'check_number',
        v_transaction ->> 'reference_number',
        public.strap_payload_hash(v_transaction), NULL, 0
      );
      v_item_results := v_item_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('item_id', v_item_id, 'revision', 0)
      );
    END LOOP;
    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'command_id', p_command_id, 'command', p_command,
      'reconciliation_id', v_reconciliation_id, 'event_ids', '[]'::jsonb,
      'item_count', v_count, 'items', v_item_results,
      'reused', false, 'replayed', false
    );
    INSERT INTO public.bank_reconciliation_command_receipts (
      command_id, command, payload_hash, actor_id, result
    ) VALUES (p_command_id, p_command, v_payload_hash, v_actor_id, v_result);
    RETURN v_result;
  END IF;

  IF NOT (p_payload ? 'reconciliation_id' AND p_payload ? 'entries')
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_payload)) <> 2
     OR pg_catalog.jsonb_typeof(p_payload -> 'entries') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '% exige apenas reconciliation_id e entries', p_command
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_reconciliation_id := (p_payload ->> 'reconciliation_id')::uuid;
    v_count := pg_catalog.jsonb_array_length(p_payload -> 'entries');
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'reconciliation_id invalido' USING ERRCODE = '22023';
  END;
  IF v_count < 1 OR v_count > 200 THEN
    RAISE EXCEPTION 'Lote exige entre 1 e 200 linhas OFX'
      USING ERRCODE = '22023';
  END IF;
  SELECT reconciliation.* INTO v_reconciliation
    FROM public.bank_reconciliations reconciliation
   WHERE reconciliation.id = v_reconciliation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conciliacao % nao encontrada', v_reconciliation_id
      USING ERRCODE = 'P0002';
  END IF;
  v_source_reference := v_reconciliation.bank_account_id::text || ':' ||
    v_reconciliation.id::text;

  FOR v_entry, v_position IN
    SELECT input.value, input.ordinality::integer
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries')
        WITH ORDINALITY input(value, ordinality)
  LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR NOT (v_entry ? 'item_id' AND v_entry ? 'expected_revision')
       OR (p_command = 'match' AND NOT (v_entry ? 'kind' AND v_entry ? 'account_id'))
       OR (p_command = 'unmatch' AND NOT (v_entry ? 'reversed_on' AND v_entry ? 'reason'))
       OR pg_catalog.jsonb_typeof(v_entry -> 'item_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_entry -> 'expected_revision') IS DISTINCT FROM 'number'
       OR (v_entry ->> 'expected_revision') !~ '^(0|[1-9][0-9]*)$'
       OR (p_command = 'match' AND (
         pg_catalog.jsonb_typeof(v_entry -> 'kind') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(v_entry -> 'account_id') IS DISTINCT FROM 'string'
       ))
       OR (p_command = 'unmatch' AND (
         pg_catalog.jsonb_typeof(v_entry -> 'reversed_on') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(v_entry -> 'reason') IS DISTINCT FROM 'string'
         OR (v_entry ->> 'reversed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       ))
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_entry))
          <> CASE p_command WHEN 'match' THEN 4 ELSE 4 END THEN
      RAISE EXCEPTION 'Entrada % de % possui estrutura invalida', v_position, p_command
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_item_id := (v_entry ->> 'item_id')::uuid;
      v_expected_revision := (v_entry ->> 'expected_revision')::integer;
      IF p_command = 'match' THEN
        v_account_id := (v_entry ->> 'account_id')::uuid;
      ELSE
        v_reversed_on := (v_entry ->> 'reversed_on')::date;
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
        OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Entrada % possui identificador/revisao/data invalido', v_position
        USING ERRCODE = '22023';
    END;
    IF v_expected_revision IS NULL OR v_expected_revision < 0 THEN
      RAISE EXCEPTION 'Entrada % possui revisao invalida', v_position
        USING ERRCODE = '22023';
    END IF;
    IF p_command = 'match' THEN
      IF v_entry ->> 'kind' NOT IN ('payable', 'receivable') THEN
        RAISE EXCEPTION 'Entrada % possui kind invalido', v_position
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_reason := NULLIF(pg_catalog.btrim(v_entry ->> 'reason'), '');
      IF v_reversed_on IS NULL OR v_reversed_on > v_today
         OR v_reason IS NULL OR pg_catalog.length(v_reason) > 4000 THEN
        RAISE EXCEPTION 'Entrada % exige data/motivo valido para desfazer', v_position
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(DISTINCT input.value ->> 'item_id')
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)) <> v_count THEN
    RAISE EXCEPTION 'Uma linha OFX nao pode aparecer duas vezes no lote'
      USING ERRCODE = '22023';
  END IF;

  -- Ordem de locks: header -> itens OFX por UUID -> core 159 (banco/AP/AR).
  FOR v_item_id IN
    SELECT DISTINCT (input.value ->> 'item_id')::uuid
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
     ORDER BY 1
  LOOP
    PERFORM item.id
      FROM public.bank_reconciliation_items item
     WHERE item.id = v_item_id
       AND item.reconciliation_id = v_reconciliation_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linha OFX % nao pertence a conciliacao', v_item_id
        USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  FOR v_entry, v_position IN
    SELECT input.value, input.ordinality::integer
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries')
        WITH ORDINALITY input(value, ordinality)
  LOOP
    v_item_id := (v_entry ->> 'item_id')::uuid;
    v_expected_revision := (v_entry ->> 'expected_revision')::integer;
    SELECT item.* INTO STRICT v_item
      FROM public.bank_reconciliation_items item
     WHERE item.id = v_item_id;
    IF v_item.revision <> v_expected_revision THEN
      RAISE EXCEPTION 'Linha OFX % mudou (revisao atual %, esperada %)',
        v_item.id, v_item.revision, v_expected_revision USING ERRCODE = '40001';
    END IF;
    IF p_command = 'match' THEN
      v_kind := v_entry ->> 'kind';
      v_account_id := (v_entry ->> 'account_id')::uuid;
      IF v_item.status <> 'nao_conciliado'
         OR (v_item.movement_type = 'debito' AND v_kind <> 'payable')
         OR (v_item.movement_type = 'credito' AND v_kind <> 'receivable') THEN
        RAISE EXCEPTION 'Linha OFX % ja conciliada ou com direcao incompativel', v_item.id
          USING ERRCODE = '55000';
      END IF;
      v_source_line_key := v_item.fit_id || ':r' || v_item.revision::text || ':' ||
        v_kind || ':' || v_account_id::text;
      v_core_payload := pg_catalog.jsonb_set(
        v_core_payload, '{entries}', (v_core_payload -> 'entries') ||
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'kind', v_kind,
            'account_id', v_account_id,
            'amount', v_item.amount,
            'settled_on', v_item.movement_date,
            'method', private.ofx_settlement_method_160(
              v_item.transaction_type, v_item.transaction_name, v_item.memo
            ),
            'bank_account_id', v_item.bank_account_id,
            'reference', 'OFX ' || v_item.fit_id,
            'notes', NULLIF(pg_catalog.left(COALESCE(v_item.description, ''), 4000), ''),
            'source_line_key', v_source_line_key
          ))
      );
    ELSE
      IF v_item.status <> 'conciliado' OR v_item.settlement_event_id IS NULL THEN
        RAISE EXCEPTION 'Linha OFX % nao possui match ativo', v_item.id
          USING ERRCODE = '55000';
      END IF;
      SELECT action.* INTO v_match_action
        FROM public.bank_reconciliation_actions action
       WHERE action.item_id = v_item.id
         AND action.to_revision = v_item.revision
         AND action.action_type = 'match';
      IF NOT FOUND OR v_match_action.settlement_event_id <> v_item.settlement_event_id THEN
        RAISE EXCEPTION 'Auditoria ativa da linha OFX % esta inconsistente', v_item.id
          USING ERRCODE = '55000';
      END IF;
      SELECT event.* INTO v_event
        FROM public.financial_settlement_events event
       WHERE event.id = v_item.settlement_event_id;
      IF NOT FOUND OR v_event.event_type <> 'settlement'
         OR v_event.source_type <> 'ofx'
         OR v_event.source_reference <> v_source_reference THEN
        RAISE EXCEPTION 'Evento ativo da linha OFX % nao pertence a esta conciliacao', v_item.id
          USING ERRCODE = '55000';
      END IF;
      v_reversed_on := (v_entry ->> 'reversed_on')::date;
      v_reason := pg_catalog.btrim(v_entry ->> 'reason');
      v_core_payload := pg_catalog.jsonb_set(
        v_core_payload, '{entries}', (v_core_payload -> 'entries') ||
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'event_id', v_item.settlement_event_id,
            'reversed_on', v_reversed_on,
            'reason', v_reason
          ))
      );
    END IF;
  END LOOP;

  v_core_result := private.execute_financial_settlement_core_159(
    p_command_id,
    CASE p_command WHEN 'match' THEN 'register' ELSE 'reverse' END,
    v_core_payload,
    'ofx',
    v_source_reference
  );

  FOR v_entry, v_position IN
    SELECT input.value, input.ordinality::integer
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries')
        WITH ORDINALITY input(value, ordinality)
  LOOP
    v_item_id := (v_entry ->> 'item_id')::uuid;
    SELECT item.* INTO STRICT v_item
      FROM public.bank_reconciliation_items item
     WHERE item.id = v_item_id;
    SELECT event.* INTO v_event
      FROM public.financial_settlement_events event
     WHERE event.command_id = p_command_id
       AND event.batch_position = v_position;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Core financeiro nao materializou a posicao %', v_position
        USING ERRCODE = '55000';
    END IF;
    IF p_command = 'match' THEN
      v_kind := v_entry ->> 'kind';
      v_account_id := (v_entry ->> 'account_id')::uuid;
      IF v_event.event_type <> 'settlement'
         OR v_event.account_kind <> v_kind
         OR COALESCE(v_event.payable_id, v_event.receivable_id) <> v_account_id
         OR v_event.amount <> v_item.amount
         OR v_event.effective_on <> v_item.movement_date
         OR v_event.bank_account_id <> v_item.bank_account_id
         OR v_event.source_type <> 'ofx'
         OR v_event.source_reference <> v_source_reference
         OR v_event.source_line_key <> (v_item.fit_id || ':r' ||
           v_item.revision::text || ':' || v_kind || ':' || v_account_id::text) THEN
        RAISE EXCEPTION 'Evento financeiro da linha OFX % diverge da evidencia', v_item.id
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.bank_reconciliation_actions (
        command_id, batch_position, reconciliation_id, item_id, action_type,
        from_revision, to_revision, account_kind, payable_id, receivable_id,
        settlement_event_id, reverses_action_id, reason, actor_id
      ) VALUES (
        p_command_id, v_position, v_reconciliation_id, v_item.id, 'match',
        v_item.revision, v_item.revision + 1, v_kind,
        CASE WHEN v_kind = 'payable' THEN v_account_id END,
        CASE WHEN v_kind = 'receivable' THEN v_account_id END,
        v_event.id, NULL, NULL, v_actor_id
      ) RETURNING id, created_at INTO v_action_id, v_action_created_at;
      UPDATE public.bank_reconciliation_items item
         SET status = 'conciliado', matched_to_type = v_kind,
             matched_to_id = v_account_id, matched_at = v_action_created_at,
             matched_by = v_actor_id, settlement_event_id = v_event.id,
             revision = v_item.revision + 1
       WHERE item.id = v_item.id;
    ELSE
      SELECT action.* INTO STRICT v_match_action
        FROM public.bank_reconciliation_actions action
       WHERE action.item_id = v_item.id
         AND action.to_revision = v_item.revision
         AND action.action_type = 'match';
      IF v_event.event_type <> 'reversal'
         OR v_event.reverses_event_id <> v_item.settlement_event_id THEN
        RAISE EXCEPTION 'Estorno financeiro da linha OFX % diverge do match', v_item.id
          USING ERRCODE = '55000';
      END IF;
      INSERT INTO public.bank_reconciliation_actions (
        command_id, batch_position, reconciliation_id, item_id, action_type,
        from_revision, to_revision, account_kind, payable_id, receivable_id,
        settlement_event_id, reverses_action_id, reason, actor_id
      ) VALUES (
        p_command_id, v_position, v_reconciliation_id, v_item.id, 'unmatch',
        v_item.revision, v_item.revision + 1, v_match_action.account_kind,
        v_match_action.payable_id, v_match_action.receivable_id,
        v_event.id, v_match_action.id, pg_catalog.btrim(v_entry ->> 'reason'),
        v_actor_id
      ) RETURNING id, created_at INTO v_action_id, v_action_created_at;
      UPDATE public.bank_reconciliation_items item
         SET status = 'nao_conciliado', matched_to_type = NULL,
             matched_to_id = NULL, matched_at = NULL, matched_by = NULL,
             settlement_event_id = NULL, revision = v_item.revision + 1
       WHERE item.id = v_item.id;
    END IF;
    v_event_ids := v_event_ids || pg_catalog.jsonb_build_array(v_event.id);
    v_item_results := v_item_results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_item.id, 'event_id', v_event.id,
        'revision', v_item.revision + 1,
        'status', CASE p_command WHEN 'match' THEN 'conciliado'
          ELSE 'nao_conciliado' END
      )
    );
  END LOOP;

  PERFORM private.refresh_bank_reconciliation_160(v_reconciliation_id);
  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'command_id', p_command_id, 'command', p_command,
    'reconciliation_id', v_reconciliation_id,
    'event_ids', v_event_ids, 'items', v_item_results,
    'financial', v_core_result, 'replayed', false
  );
  INSERT INTO public.bank_reconciliation_command_receipts (
    command_id, command, payload_hash, actor_id, result
  ) VALUES (p_command_id, p_command, v_payload_hash, v_actor_id, v_result);
  RETURN v_result;
END;
$function$;

ALTER TABLE public.bank_reconciliation_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users reconciliations" ON public.bank_reconciliations;
DROP POLICY IF EXISTS "approved users rec_items" ON public.bank_reconciliation_items;

CREATE POLICY bank_reconciliations_read_management
  ON public.bank_reconciliations FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY bank_reconciliation_items_read_management
  ON public.bank_reconciliation_items FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY bank_reconciliation_receipts_read_management
  ON public.bank_reconciliation_command_receipts FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY bank_reconciliation_actions_read_management
  ON public.bank_reconciliation_actions FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));

REVOKE ALL ON TABLE public.bank_reconciliations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_reconciliation_items
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_reconciliation_command_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bank_reconciliation_actions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.bank_reconciliations,
  public.bank_reconciliation_items,
  public.bank_reconciliation_command_receipts,
  public.bank_reconciliation_actions TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.normalize_bank_identity_160(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ofx_settlement_method_160(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.tg_bank_reconciliation_immutable_160()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.tg_bank_reconciliation_item_guard_160()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.refresh_bank_reconciliation_160(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_bank_reconciliation_command(uuid,text,jsonb,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_bank_reconciliation_command(uuid,text,jsonb,uuid)
  TO authenticated, service_role;
