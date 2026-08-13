-- =============================================================================
-- FICHA DE MONTADORES — LANÇAMENTO ATÔMICO E PROTEÇÃO DA FOLHA
--
-- 1. A chamada passa a ser única por (dia, pessoa, setor). Uma mesma pessoa pode
--    trabalhar em dois setores no mesmo dia sem colidir no índice.
-- 2. Produção já reivindicada/paga fica imutável. Um cliente REST também não
--    pode escrever payroll_run_id/pago_em: somente o lifecycle disparado por um
--    trigger da folha pode alterar exclusivamente esses dois campos.
-- 3. Par difícil de funcionário por produção exige também R$/par difícil.
-- 4. Folha e ficha serializam pelo mesmo advisory lock por funcionário. Assim, um
--    lançamento nunca nasce livre dentro de uma janela já aprovada/paga.
-- 5. save_ficha_montadores_batch grava o lote inteiro numa transação, exige a
--    versão esperada (id + atualizado_em) e mantém snapshots por dificuldade.
-- =============================================================================

-- 1) Uma chamada por dia + pessoa + setor --------------------------------------
DROP INDEX IF EXISTS public.ficha_montadores_chamada_dia_montador_uniq;
DROP INDEX IF EXISTS public.ficha_montadores_chamada_dia_montador_setor_uniq;

CREATE UNIQUE INDEX ficha_montadores_chamada_dia_montador_setor_uniq
  ON public.ficha_montadores (dia, montador_id, setor)
  WHERE origem = 'chamada';

-- 2) Linha reivindicada/paga: só o ciclo da folha pode mudar -------------------
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_lock_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_operacional_mudou boolean := false;
  v_lifecycle_mudou boolean := false;
BEGIN
  -- Nenhum fluxo legítimo cria uma ficha já reivindicada/paga. Isso também
  -- impede o cliente de combinar INSERT operacional com lifecycle forjado.
  IF TG_OP = 'INSERT' THEN
    IF NEW.payroll_run_id IS NOT NULL OR NEW.pago_em IS NOT NULL THEN
      RAISE EXCEPTION
        'payroll_run_id/pago_em só podem ser definidos pelo ciclo autorizado da folha.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A versão de concorrência é sempre emitida pelo servidor.
    NEW.atualizado_em := clock_timestamp();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.payroll_run_id IS NOT NULL OR OLD.pago_em IS NOT NULL THEN
      RAISE EXCEPTION
        'Lançamento de % em % já está na folha ou pago e não pode ser excluído.',
        COALESCE(OLD.montador, 'funcionário'), to_char(OLD.dia, 'DD/MM/YYYY')
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    RETURN OLD;
  END IF;

  v_operacional_mudou :=
    (to_jsonb(NEW) - ARRAY['payroll_run_id', 'pago_em'])
      IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['payroll_run_id', 'pago_em']);
  v_lifecycle_mudou :=
    NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
    OR NEW.pago_em IS DISTINCT FROM OLD.pago_em;

  IF v_lifecycle_mudou THEN
    -- REST/RPC direto chega a este trigger na profundidade 1. Claim, stamp,
    -- unstamp e cancelamento executam o UPDATE de ficha dentro de um trigger de
    -- payroll_runs/payroll_payments e chegam na profundidade >= 2. O cliente não
    -- controla pg_trigger_depth(), portanto não consegue forjar esse contexto.
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION
        'payroll_run_id/pago_em só podem ser alterados pelo ciclo autorizado da folha.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_operacional_mudou THEN
      RAISE EXCEPTION
        'O ciclo da folha não pode alterar campos operacionais da Ficha de Montadores.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (OLD.payroll_run_id IS NOT NULL OR OLD.pago_em IS NOT NULL)
     AND v_operacional_mudou THEN
    RAISE EXCEPTION
      'Lançamento de % em % já está na folha ou pago e não pode ser alterado.',
      COALESCE(OLD.montador, 'funcionário'), to_char(OLD.dia, 'DD/MM/YYYY')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_operacional_mudou THEN
    -- Escrita REST antiga também precisa invalidar expected_atualizado_em; não
    -- confiar no timestamp enviado pelo cliente. O +1 µs garante mudança mesmo
    -- em dois UPDATEs que caiam no mesmo tick do relógio.
    NEW.atualizado_em := GREATEST(
      clock_timestamp(),
      OLD.atualizado_em + interval '1 microsecond'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ficha_montadores_lock_closed ON public.ficha_montadores;
CREATE TRIGGER trg_ficha_montadores_lock_closed
  BEFORE INSERT OR UPDATE OR DELETE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_lock_closed();

-- 3) Taxas obrigatórias por dificuldade ---------------------------------------
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_require_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_regime text;
  v_tem_dificil boolean := false;
BEGIN
  -- Os gatilhos da folha alteram só estes dois campos. Não revalidar cadastro
  -- histórico nessa transição: a produção não está sendo editada.
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['payroll_run_id', 'pago_em'])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['payroll_run_id', 'pago_em']) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.montador_id IS NULL OR COALESCE(NEW.origem, 'chamada') <> 'chamada' THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(payment_type, 'mensalista'))
    INTO v_regime
    FROM public.employees
   WHERE id = NEW.montador_id;

  IF v_regime IS DISTINCT FROM 'producao' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.valor_par_medio, NEW.valor_par, 0) <= 0 THEN
    RAISE EXCEPTION
      'R$/par médio não cadastrado para % — preencha em Funcionários → Remuneração antes de lançar a produção.',
      COALESCE(NEW.montador, 'este funcionário')
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_typeof(NEW.detalhe) = 'array' THEN
    SELECT EXISTS (
      SELECT 1
       FROM jsonb_array_elements(NEW.detalhe) AS d(item)
       WHERE jsonb_typeof(d.item) = 'object'
         AND COALESCE(NULLIF(d.item->>'dificil', '')::numeric, 0) > 0
    ) INTO v_tem_dificil;
  END IF;

  IF v_tem_dificil AND COALESCE(NEW.valor_par_dificil, 0) <= 0 THEN
    RAISE EXCEPTION
      'R$/par difícil não cadastrado para % — preencha em Funcionários → Remuneração antes de lançar pares difíceis.',
      COALESCE(NEW.montador, 'este funcionário')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger já existe nas bases migradas; recriar mantém a definição explícita e
-- garante que INSERT e UPDATE usem a função fortalecida acima.
DROP TRIGGER IF EXISTS trg_ficha_montadores_require_rate ON public.ficha_montadores;
CREATE TRIGGER trg_ficha_montadores_require_rate
  BEFORE INSERT OR UPDATE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_require_rate();

-- 4) Serializa aprovação da folha e lançamento pelo mesmo funcionário --------
-- Um advisory lock derivado do UUID é o mutex transacional comum. O RPC bloqueia
-- todas as pessoas do lote em ordem; a aprovação bloqueia sua pessoa antes de
-- reivindicar. Não usamos employees FOR UPDATE: SECURITY INVOKER exigiria dar
-- UPDATE em employees a operadores que hoje só precisam de SELECT nessa tabela.
-- Se o lote chegar primeiro, a folha espera e depois inclui as linhas novas. Se a
-- folha chegar primeiro, o lote espera e depois enxerga a janela fechada.
CREATE OR REPLACE FUNCTION public.tg_ficha_claim_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_range     daterange;
  v_regime    text;
  v_claimed   integer := 0;
  v_conflito  integer := 0;
  v_dias_conf text;
  v_zerados   integer := 0;
  v_bruto     numeric := 0;
  v_antes     numeric;
  v_aviso     text := '';
BEGIN
  -- Load-bearing para concorrência com save_ficha_montadores_batch e o guard
  -- direto: os três usam exatamente a mesma chave antes de ficha/folha.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ficha_montadores|' || NEW.employee_id::text,
      0
    )
  );

  SELECT COALESCE(e.payment_type, 'mensalista')
    INTO v_regime
    FROM public.employees e
   WHERE e.id = NEW.employee_id;

  -- Produção de mensalista/diarista/remoto é medição, não pagamento.
  IF v_regime IS DISTINCT FROM 'producao' THEN
    RETURN NEW;
  END IF;

  v_range := public.payroll_period_range(NEW.period);
  IF v_range IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('aprovado', 'pago')
     AND COALESCE(OLD.status, 'rascunho') NOT IN ('aprovado', 'pago') THEN

    SELECT count(*), string_agg(to_char(f.dia, 'DD/MM'), ', ' ORDER BY f.dia)
      INTO v_conflito, v_dias_conf
      FROM public.ficha_montadores f
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NOT NULL
       AND f.payroll_run_id <> NEW.id
       AND public.ficha_is_chamada(f.origem, f.numeracoes);

    SELECT count(*)
      INTO v_zerados
      FROM public.ficha_montadores f
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NULL
       AND public.ficha_is_chamada(f.origem, f.numeracoes)
       AND public.ficha_valor(
             f.detalhe, f.total, f.valor_par,
             f.valor_par_medio, f.valor_par_dificil
           ) <= 0;

    UPDATE public.ficha_montadores f
       SET payroll_run_id = NEW.id
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NULL
       AND public.ficha_is_chamada(f.origem, f.numeracoes)
       AND public.ficha_valor(
             f.detalhe, f.total, f.valor_par,
             f.valor_par_medio, f.valor_par_dificil
           ) > 0;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    SELECT COALESCE(sum(public.ficha_valor(
             f.detalhe, f.total, f.valor_par,
             f.valor_par_medio, f.valor_par_dificil
           )), 0)
      INTO v_bruto
      FROM public.ficha_montadores f
     WHERE f.payroll_run_id = NEW.id;

    v_antes := COALESCE(NEW.total_proventos, 0);
    NEW.total_proventos := v_bruto;
    NEW.total_liquido := v_bruto - COALESCE(NEW.total_descontos, 0);

    IF v_conflito > 0 THEN
      v_aviso := v_aviso || format(
        '[%s] %s dia(s) já pertenciam a outra folha e ficaram de fora (%s). Bruto recalculado de %s para %s. ',
        to_char(now(), 'DD/MM/YYYY HH24:MI'), v_conflito, v_dias_conf,
        to_char(v_antes, 'FM999999990.00'), to_char(v_bruto, 'FM999999990.00'));
    END IF;
    IF v_zerados > 0 THEN
      v_aviso := v_aviso || format(
        '[%s] %s lançamento(s) sem R$/par cadastrado NÃO entraram e seguem em aberto. ',
        to_char(now(), 'DD/MM/YYYY HH24:MI'), v_zerados);
    END IF;
    IF v_aviso <> '' THEN
      NEW.notes := trim(both E' \n' from COALESCE(NEW.notes, '') || E'\n' || v_aviso);
    END IF;

  ELSIF NEW.status IN ('rascunho', 'cancelado')
        AND COALESCE(OLD.status, '') IN ('aprovado', 'pago') THEN
    UPDATE public.ficha_montadores
       SET payroll_run_id = NULL,
           pago_em = NULL
     WHERE payroll_run_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger já existe. Recriá-lo documenta que a função acima continua no
-- mesmo ponto da ordem alfabética em relação aos demais triggers da folha.
DROP TRIGGER IF EXISTS tg_ficha_claim_production ON public.payroll_runs;
CREATE TRIGGER tg_ficha_claim_production
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_claim_production();

-- Defesa também para INSERT/UPDATE direto na tabela: uma produção livre não
-- pode nascer nem ser movida para uma janela já aprovada/paga.
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_guard_open_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lock_id uuid;
  v_new_employee_found boolean := false;
  v_regime text;
  v_folha record;
BEGIN
  IF NEW.montador_id IS NULL
     OR NOT public.ficha_is_chamada(NEW.origem, NEW.numeracoes) THEN
    RETURN NEW;
  END IF;

  -- Claim/stamp/cancelamento mudam só lifecycle e já estão serializados pelo
  -- trigger da folha. Não rejeitar a própria reivindicação que fecha a linha.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['payroll_run_id', 'pago_em'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['payroll_run_id', 'pago_em']) THEN
    RETURN NEW;
  END IF;

  -- UPDATE direto pode trocar montador_id. Bloquear as duas chaves em ordem
  -- determinística evita deadlock com outra transferência em sentido contrário.
  FOR v_lock_id IN
    SELECT DISTINCT ids.employee_id
      FROM unnest(ARRAY[
        NEW.montador_id,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.montador_id END
      ]) AS ids(employee_id)
     WHERE ids.employee_id IS NOT NULL
     ORDER BY ids.employee_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'ficha_montadores|' || v_lock_id::text,
        0
      )
    );
    IF v_lock_id = NEW.montador_id THEN
      v_new_employee_found := true;
    END IF;
  END LOOP;

  SELECT lower(COALESCE(e.payment_type, 'mensalista'))
    INTO v_regime
    FROM public.employees e
   WHERE e.id = NEW.montador_id;
  IF NOT v_new_employee_found OR NOT FOUND THEN
    RAISE EXCEPTION 'Funcionário % não encontrado.', NEW.montador_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Para mensalista/diarista/remoto a ficha é só medição e nunca é
  -- reivindicada por tg_ficha_claim_production; manter esse fluxo legítimo.
  IF v_regime IS DISTINCT FROM 'producao' THEN
    RETURN NEW;
  END IF;

  -- Linha já vinculada será tratada pelo lock_closed. Aqui interessa impedir
  -- exclusivamente a criação/edição de produção ainda livre.
  IF NEW.payroll_run_id IS NULL THEN
    SELECT r.id, r.period, r.status
      INTO v_folha
      FROM public.payroll_runs r
     WHERE r.employee_id = NEW.montador_id
       AND r.status IN ('aprovado', 'pago')
       AND NEW.dia <@ public.payroll_period_range(r.period)
     ORDER BY r.period, r.id
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'A folha % (%) já fechou o dia % para %. Cancele/reabra a folha antes de lançar nova produção.',
        v_folha.period, v_folha.status, to_char(NEW.dia, 'DD/MM/YYYY'),
        COALESCE(NEW.montador, 'este funcionário')
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ficha_montadores_guard_open_period ON public.ficha_montadores;
CREATE TRIGGER trg_ficha_montadores_guard_open_period
  BEFORE INSERT OR UPDATE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_guard_open_period();

-- Snapshot por categoria também vale para escrita REST antiga/direta. O nome do
-- trigger é intencional: guard_open_period (g) adquire o mutex da pessoa,
-- lock_closed (l) protege folha e rate_snapshot (ra) roda antes de require_rate
-- (re), que valida o resultado final.
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_rate_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_regime text;
  v_taxa_medio numeric;
  v_taxa_dificil numeric;
  v_old_medio numeric := 0;
  v_old_dificil numeric := 0;
  v_new_medio numeric := 0;
  v_new_dificil numeric := 0;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['payroll_run_id', 'pago_em'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['payroll_run_id', 'pago_em']) THEN
    RETURN NEW;
  END IF;

  IF NEW.montador_id IS NULL
     OR NOT public.ficha_is_chamada(NEW.origem, NEW.numeracoes) THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(e.payment_type, 'mensalista')),
         e.valor_par_medio,
         e.valor_par_dificil
    INTO v_regime, v_taxa_medio, v_taxa_dificil
    FROM public.employees e
   WHERE e.id = NEW.montador_id;

  IF v_regime IS DISTINCT FROM 'producao' THEN
    RETURN NEW;
  END IF;

  SELECT p.medio, p.dificil
    INTO v_new_medio, v_new_dificil
    FROM public.ficha_pares(NEW.detalhe, NEW.total) p;

  IF TG_OP = 'INSERT' THEN
    -- INSERT sempre nasce da taxa vigente; valores enviados pelo cliente não
    -- são confiados. Categoria ainda sem pares será recapturada no primeiro 0→>0.
    NEW.valor_par := v_taxa_medio;
    NEW.valor_par_medio := v_taxa_medio;
    NEW.valor_par_dificil := v_taxa_dificil;
    RETURN NEW;
  END IF;

  SELECT p.medio, p.dificil
    INTO v_old_medio, v_old_dificil
    FROM public.ficha_pares(OLD.detalhe, OLD.total) p;

  -- Não é seguro "consertar" usando a taxa de hoje: isso reprecificaria
  -- produção histórica. O erro exige uma correção de dados consciente.
  IF v_old_medio > 0
     AND COALESCE(OLD.valor_par_medio, OLD.valor_par, 0) <= 0 THEN
    RAISE EXCEPTION
      'Histórico inconsistente: % já tem pares médios sem snapshot de R$/par. Corrija a linha antes de editá-la.',
      COALESCE(OLD.montador, 'este funcionário')
      USING ERRCODE = 'data_exception';
  END IF;

  IF v_old_dificil > 0 AND COALESCE(OLD.valor_par_dificil, 0) <= 0 THEN
    RAISE EXCEPTION
      'Histórico inconsistente: % já tem pares difíceis sem snapshot de R$/par. Corrija a linha antes de editá-la.',
      COALESCE(OLD.montador, 'este funcionário')
      USING ERRCODE = 'data_exception';
  END IF;

  IF v_old_medio > 0 THEN
    NEW.valor_par := OLD.valor_par;
    NEW.valor_par_medio := OLD.valor_par_medio;
  ELSIF v_new_medio > 0 THEN
    -- Primeira entrada de pares médios nesta categoria: taxa vigente agora.
    NEW.valor_par := v_taxa_medio;
    NEW.valor_par_medio := v_taxa_medio;
  ELSE
    NEW.valor_par := OLD.valor_par;
    NEW.valor_par_medio := OLD.valor_par_medio;
  END IF;

  IF v_old_dificil > 0 THEN
    NEW.valor_par_dificil := OLD.valor_par_dificil;
  ELSIF v_new_dificil > 0 THEN
    -- Primeira entrada de pares difíceis não reprecifica os pares médios.
    NEW.valor_par_dificil := v_taxa_dificil;
  ELSE
    NEW.valor_par_dificil := OLD.valor_par_dificil;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ficha_montadores_rate_snapshot ON public.ficha_montadores;
CREATE TRIGGER trg_ficha_montadores_rate_snapshot
  BEFORE INSERT OR UPDATE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_rate_snapshot();

-- 5) Lote transacional ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_ficha_montadores_batch(
  p_setor text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_setor text := btrim(COALESCE(p_setor, ''));
  v_item jsonb;
  v_det jsonb;
  v_detalhe_normalizado jsonb;
  v_pos bigint;
  v_dia date;
  v_montador_id uuid;
  v_lock_id uuid;
  v_lock_ids uuid[] := ARRAY[]::uuid[];
  v_expected_id uuid;
  v_expected_atualizado_em timestamptz;
  v_nome text;
  v_regime text;
  v_valor_medio numeric;
  v_valor_dificil numeric;
  v_tamanho numeric;
  v_medio numeric;
  v_dificil numeric;
  v_total numeric;
  v_total_medio numeric;
  v_total_dificil numeric;
  v_fichas numeric;
  v_existing public.ficha_montadores%ROWTYPE;
  v_existing_found boolean;
  v_existing_medio numeric;
  v_existing_dificil numeric;
  v_next_valor_par numeric;
  v_next_valor_medio numeric;
  v_next_valor_dificil numeric;
  v_folha record;
  v_mutated_id uuid;
  v_seen_keys text[] := ARRAY[]::text[];
  v_seen_sizes integer[];
  v_key text;
  v_inseridos integer := 0;
  v_atualizados integer := 0;
  v_excluidos integer := 0;
BEGIN
  IF v_setor = '' THEN
    RAISE EXCEPTION 'Setor é obrigatório para salvar a Ficha de Montadores.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_items deve ser um array JSON de lançamentos.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Primeira passagem: validar/colecionar IDs sem tocar em ficha. Todos os locks
  -- são adquiridos em ordem UUID antes do lote, evitando deadlock entre dois
  -- lotes com os mesmos funcionários em ordens opostas.
  FOR v_item, v_pos IN
    SELECT x.item, x.ord
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(item, ord)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Item % do lote deve ser um objeto JSON.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    BEGIN
      v_montador_id := NULLIF(v_item->>'montador_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Item %: montador_id inválido.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END;
    IF v_montador_id IS NULL THEN
      RAISE EXCEPTION 'Item %: montador_id é obrigatório.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_lock_ids := array_append(v_lock_ids, v_montador_id);
  END LOOP;

  FOR v_lock_id IN
    SELECT DISTINCT u.employee_id
      FROM unnest(v_lock_ids) AS u(employee_id)
     ORDER BY u.employee_id
  LOOP
    -- Mesmo mutex usado por tg_ficha_claim_production e pelo guard direto. Não
    -- exige UPDATE em employees e não amplia os privilégios do invocador.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'ficha_montadores|' || v_lock_id::text,
        0
      )
    );
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e WHERE e.id = v_lock_id
    ) THEN
      RAISE EXCEPTION 'Funcionário % não encontrado ou sem acesso.', v_lock_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;

  FOR v_item, v_pos IN
    SELECT x.item, x.ord
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(item, ord)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Item % do lote deve ser um objeto JSON.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF COALESCE(v_item->>'dia', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Item %: dia deve estar no formato YYYY-MM-DD.', v_pos
        USING ERRCODE = 'invalid_datetime_format';
    END IF;
    BEGIN
      v_dia := (v_item->>'dia')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RAISE EXCEPTION 'Item %: dia inválido (%).', v_pos, v_item->>'dia'
        USING ERRCODE = 'invalid_datetime_format';
    END;

    BEGIN
      v_montador_id := NULLIF(v_item->>'montador_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Item %: montador_id inválido.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END;
    IF v_montador_id IS NULL THEN
      RAISE EXCEPTION 'Item %: montador_id é obrigatório.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_item ? 'expected_id'
       AND jsonb_typeof(v_item->'expected_id') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Item %: expected_id deve ser UUID textual ou null.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    BEGIN
      v_expected_id := NULLIF(v_item->>'expected_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Item %: expected_id inválido.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END;

    IF v_item ? 'expected_atualizado_em'
       AND jsonb_typeof(v_item->'expected_atualizado_em') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION
        'Item %: expected_atualizado_em deve ser timestamp ISO textual ou null.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    BEGIN
      v_expected_atualizado_em :=
        NULLIF(v_item->>'expected_atualizado_em', '')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Item %: expected_atualizado_em inválido.', v_pos
        USING ERRCODE = 'invalid_datetime_format';
    END;

    v_key := v_dia::text || '|' || v_montador_id::text;
    IF v_key = ANY(v_seen_keys) THEN
      RAISE EXCEPTION 'Lote contém lançamento duplicado para montador % no dia %.',
        v_montador_id, to_char(v_dia, 'DD/MM/YYYY')
        USING ERRCODE = 'unique_violation';
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_key);

    IF jsonb_typeof(v_item->'detalhe') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Item %: detalhe deve ser um array JSON.', v_pos
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_total := 0;
    v_total_medio := 0;
    v_total_dificil := 0;
    v_fichas := 0;
    v_detalhe_normalizado := '[]'::jsonb;
    v_seen_sizes := ARRAY[]::integer[];

    FOR v_det IN SELECT value FROM jsonb_array_elements(v_item->'detalhe')
    LOOP
      IF jsonb_typeof(v_det) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Item %: cada entrada de detalhe deve ser um objeto JSON.', v_pos
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      IF jsonb_typeof(v_det->'tamanho') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Item %: tamanho deve ser numérico.', v_pos
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_tamanho := (v_det->>'tamanho')::numeric;
      IF v_tamanho <> trunc(v_tamanho) OR v_tamanho NOT IN (12, 15, 18) THEN
        RAISE EXCEPTION 'Item %: tamanho % inválido; use 12, 15 ou 18.', v_pos, v_tamanho
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_tamanho::integer = ANY(v_seen_sizes) THEN
        RAISE EXCEPTION 'Item %: tamanho % aparece mais de uma vez no detalhe.', v_pos, v_tamanho
          USING ERRCODE = 'unique_violation';
      END IF;
      v_seen_sizes := array_append(v_seen_sizes, v_tamanho::integer);

      IF v_det ? 'medio' AND jsonb_typeof(v_det->'medio') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Item %: médio deve ser um inteiro não negativo.', v_pos
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF v_det ? 'dificil' AND jsonb_typeof(v_det->'dificil') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Item %: difícil deve ser um inteiro não negativo.', v_pos
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      v_medio := COALESCE((v_det->>'medio')::numeric, 0);
      v_dificil := COALESCE((v_det->>'dificil')::numeric, 0);
      IF v_medio < 0 OR v_medio <> trunc(v_medio) THEN
        RAISE EXCEPTION 'Item %: médio deve ser um inteiro não negativo.', v_pos
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_dificil < 0 OR v_dificil <> trunc(v_dificil) THEN
        RAISE EXCEPTION 'Item %: difícil deve ser um inteiro não negativo.', v_pos
          USING ERRCODE = 'check_violation';
      END IF;

      v_total := v_total + v_medio + v_dificil;
      v_total_medio := v_total_medio + v_medio;
      v_total_dificil := v_total_dificil + v_dificil;
      v_fichas := v_fichas + round((v_medio + v_dificil) / v_tamanho);

      -- Linhas zeradas não são persistidas no detalhe canônico.
      IF v_medio + v_dificil > 0 THEN
        v_detalhe_normalizado := v_detalhe_normalizado || jsonb_build_array(
          jsonb_build_object(
            'tamanho', v_tamanho::integer,
            'medio', v_medio::integer,
            'dificil', v_dificil::integer
          )
        );
      END IF;
    END LOOP;

    IF v_total > 2147483647 OR v_fichas > 2147483647 THEN
      RAISE EXCEPTION 'Item % excede o limite inteiro de pares/fichas.', v_pos
        USING ERRCODE = 'numeric_value_out_of_range';
    END IF;

    SELECT e.name,
           lower(COALESCE(e.payment_type, 'mensalista')),
           e.valor_par_medio,
           e.valor_par_dificil
      INTO v_nome, v_regime, v_valor_medio, v_valor_dificil
      FROM public.employees e
     WHERE e.id = v_montador_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item %: funcionário % não encontrado.', v_pos, v_montador_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT f.*
      INTO v_existing
      FROM public.ficha_montadores f
     WHERE f.dia = v_dia
       AND f.montador_id = v_montador_id
       AND f.setor = v_setor
       AND f.origem = 'chamada'
     FOR UPDATE;
    v_existing_found := FOUND;

    -- Concorrência otimista: id protege delete/reinsert (ABA) e atualizado_em
    -- protege UPDATE concorrente da mesma linha. O lock de employees faz a
    -- mutex da pessoa faz a ausência também ficar estável contra outro
    -- lote/REST que respeite os triggers.
    IF v_existing_found THEN
      IF v_expected_id IS NULL OR v_expected_atualizado_em IS NULL THEN
        RAISE EXCEPTION
          'Conflito no item %: a linha já existe; recarregue antes de salvar.', v_pos
          USING ERRCODE = 'serialization_failure';
      END IF;
      IF v_existing.id <> v_expected_id
         OR v_existing.atualizado_em IS DISTINCT FROM v_expected_atualizado_em THEN
        RAISE EXCEPTION
          'Conflito no item %: a ficha foi alterada por outra sessão; recarregue antes de salvar.',
          v_pos
          USING ERRCODE = 'serialization_failure';
      END IF;
    ELSIF v_expected_id IS NOT NULL OR v_expected_atualizado_em IS NOT NULL THEN
      RAISE EXCEPTION
        'Conflito no item %: a ficha esperada não existe mais; recarregue antes de salvar.',
        v_pos
        USING ERRCODE = 'serialization_failure';
    END IF;

    IF v_total = 0 THEN
      IF v_existing_found THEN
        DELETE FROM public.ficha_montadores
         WHERE id = v_expected_id
           AND atualizado_em = v_expected_atualizado_em
         RETURNING id INTO v_mutated_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION
            'Conflito no item %: a ficha mudou antes da exclusão; recarregue.', v_pos
            USING ERRCODE = 'serialization_failure';
        END IF;
        v_excluidos := v_excluidos + 1;
      END IF;
      CONTINUE;
    END IF;

    -- O mutex por funcionário garante que uma aprovação concorrente não pode
    -- aparecer entre esta leitura e a gravação. Rascunho/cancelada não fecha a
    -- janela; aprovado/pago exige cancelar/reabrir antes de novo lançamento.
    IF v_regime = 'producao' THEN
      SELECT r.id, r.period, r.status
        INTO v_folha
        FROM public.payroll_runs r
       WHERE r.employee_id = v_montador_id
         AND r.status IN ('aprovado', 'pago')
         AND v_dia <@ public.payroll_period_range(r.period)
       ORDER BY r.period, r.id
       LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION
          'A folha % (%) já fechou o dia % para %. Cancele/reabra a folha antes de lançar nova produção.',
          v_folha.period, v_folha.status, to_char(v_dia, 'DD/MM/YYYY'), v_nome
          USING ERRCODE = 'object_not_in_prerequisite_state';
      END IF;
    END IF;

    IF v_existing_found THEN
      SELECT p.medio, p.dificil
        INTO v_existing_medio, v_existing_dificil
        FROM public.ficha_pares(v_existing.detalhe, v_existing.total) p;

      IF v_existing_medio > 0
         AND COALESCE(v_existing.valor_par_medio, v_existing.valor_par, 0) <= 0 THEN
        RAISE EXCEPTION
          'Histórico inconsistente: % já tem pares médios sem snapshot de R$/par. Corrija a linha antes de editá-la.',
          COALESCE(v_existing.montador, v_nome)
          USING ERRCODE = 'data_exception';
      END IF;
      IF v_existing_dificil > 0
         AND COALESCE(v_existing.valor_par_dificil, 0) <= 0 THEN
        RAISE EXCEPTION
          'Histórico inconsistente: % já tem pares difíceis sem snapshot de R$/par. Corrija a linha antes de editá-la.',
          COALESCE(v_existing.montador, v_nome)
          USING ERRCODE = 'data_exception';
      END IF;

      -- Snapshot independente por categoria. Categoria já usada conserva sua
      -- taxa; uma transição 0→>0 captura somente a taxa vigente daquela categoria.
      v_next_valor_par := v_existing.valor_par;
      v_next_valor_medio := v_existing.valor_par_medio;
      v_next_valor_dificil := v_existing.valor_par_dificil;
      IF v_existing_medio <= 0 AND v_total_medio > 0 THEN
        v_next_valor_par := v_valor_medio;
        v_next_valor_medio := v_valor_medio;
      END IF;
      IF v_existing_dificil <= 0 AND v_total_dificil > 0 THEN
        v_next_valor_dificil := v_valor_dificil;
      END IF;

      UPDATE public.ficha_montadores
         SET montador = v_nome,
             detalhe = v_detalhe_normalizado,
             total = v_total::integer,
             fichas_dia = v_fichas::integer,
             valor_par = v_next_valor_par,
             valor_par_medio = v_next_valor_medio,
             valor_par_dificil = v_next_valor_dificil,
             atualizado_em = now()
       WHERE id = v_expected_id
         AND atualizado_em = v_expected_atualizado_em
       RETURNING id INTO v_mutated_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Conflito no item %: a ficha mudou antes da atualização; recarregue.', v_pos
          USING ERRCODE = 'serialization_failure';
      END IF;
      v_atualizados := v_atualizados + 1;
    ELSE
      -- Linha nova captura as taxas vigentes. O trigger rate_snapshot repete a
      -- regra para impedir que um cliente REST antigo/malicioso envie outra taxa.
      INSERT INTO public.ficha_montadores (
        dia, montador, montador_id, setor,
        fichas_dia, total, copias, grade, numeracoes, quantidades,
        cor, referencia, reference_id, detalhe, origem,
        valor_par, valor_par_medio, valor_par_dificil, atualizado_em
      ) VALUES (
        v_dia, v_nome, v_montador_id, v_setor,
        v_fichas::integer, v_total::integer, 1, 'adulto', '[]'::jsonb, '[]'::jsonb,
        NULL, NULL, NULL, v_detalhe_normalizado, 'chamada',
        COALESCE(v_valor_medio, 0), v_valor_medio, v_valor_dificil, now()
      );
      v_inseridos := v_inseridos + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'gravados', v_inseridos + v_atualizados + v_excluidos,
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'excluidos', v_excluidos
  );
END;
$$;

COMMENT ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) IS
  'Salva atomicamente a chamada de um setor. p_items = '
  '[{"dia":"YYYY-MM-DD","montador_id":"uuid","expected_id":"uuid|null",'
  '"expected_atualizado_em":"ISO timestamptz|null","detalhe":'
  '[{"tamanho":12,"medio":12,"dificil":0}]}]. Para linha existente, os dois '
  'expected_* são obrigatórios; para INSERT ficam null/ausentes. Divergência gera '
  'SQLSTATE 40001. Snapshot é preservado por categoria; a primeira transição '
  '0→>0 captura apenas a taxa vigente da categoria; total zero exclui.';

REVOKE ALL ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) TO authenticated;
