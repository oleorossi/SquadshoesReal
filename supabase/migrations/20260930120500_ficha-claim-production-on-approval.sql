-- =============================================================================
-- FIM DO PAGAMENTO EM DUPLICIDADE DA PRODUÇÃO POR PAR
--
-- RISCO. Pra regime 'producao' o bruto é a soma da produção da JANELA da folha.
-- `payroll_runs` é único por (employee_id, period), mas nada impede períodos que
-- se cruzam — e o banco tem vários: '2026-06' cruza '2026-06-16_2026-06-30',
-- '2026-06-01_2026-07-18' cruza quase todos. Duas folhas assim, ambas aprovadas,
-- somam os MESMOS dias e pagam duas vezes.
--
-- SOLUÇÃO — o padrão que esta base já usa pra ADIANTAMENTOS
-- (tg_payroll_link_advances_and_overtime): reivindicar na APROVAÇÃO, marcando
-- payroll_run_id só no que ainda está livre. Folha que já é dona de um dia não
-- perde ele pra outra, e o total é reescrito pelo conjunto realmente
-- reivindicado. Sobreposição de período deixa de importar: quem aprova primeiro
-- leva; quem vem depois aprova valendo só o que sobrou, com o aviso em `notes`.
--
-- ⚠ ORDEM DOS TRIGGERS É LOAD-BEARING. Postgres dispara em ordem ALFABÉTICA, e
-- 'tg_' < 'trg_': este roda ANTES de trg_payroll_link_advances_and_overtime. Tem
-- que ser nessa ordem — aqui o total_proventos é reescrito, e é ele que o
-- trigger de adiantamentos usa pra recalcular o líquido. Invertido, o líquido
-- sairia do bruto velho. NÃO renomear pra 'trg_'.
--
-- DUAS RECUSAS DELIBERADAS DE COPIAR O PADRÃO:
--
--  1. CANCELAMENTO LIBERA. O trigger de adiantamentos só devolve os registros
--     quando a folha volta pra 'rascunho', não quando é cancelada — quem cancela
--     uma folha paga deixa os adiantamentos presos. Copiar isso na produção
--     tornaria aqueles dias IMPAGÁVEIS: nenhuma folha nova conseguiria
--     reivindicá-los e o montador simplesmente não receberia. Aqui
--     'cancelado' libera igual a 'rascunho'. (A lacuna nos adiantamentos
--     continua de pé — fora do escopo, mas registrada.)
--
--  2. LANÇAMENTO VALENDO ZERO NÃO É REIVINDICADO. Os 33 lançamentos que existem
--     hoje têm R$/par 0,00 (foram gravados antes de haver taxa cadastrada).
--     Reivindicá-los queimaria a produção: ficariam marcados como pagos por
--     nada, e destravar exigiria UPDATE manual. Ficam livres, e o aviso diz
--     quantos ficaram de fora.
--
-- Só vale pra quem é payment_type='producao'. Produção de mensalista é MEDIÇÃO
-- de produtividade, não pagamento — marcá-la como paga seria mentira.
-- =============================================================================

-- 1) Pares por dificuldade de um lançamento -----------------------------------
-- Espelha diffSizeMapOf/paresDiffOfRow do TS: modelo novo {tamanho,medio,dificil},
-- legado {tamanho,pares} lido como tudo MÉDIO, e sem detalhe cai no total.
CREATE OR REPLACE FUNCTION public.ficha_pares(p_detalhe jsonb, p_total integer)
RETURNS TABLE(medio numeric, dificil numeric)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN jsonb_typeof(p_detalhe) = 'array' AND jsonb_array_length(p_detalhe) > 0 THEN
        (SELECT coalesce(sum(
           CASE WHEN (d->>'medio') IS NOT NULL OR (d->>'dificil') IS NOT NULL
                THEN coalesce((d->>'medio')::numeric, 0)
                ELSE coalesce((d->>'pares')::numeric, 0)
           END), 0)
           FROM jsonb_array_elements(p_detalhe) d)
      ELSE greatest(coalesce(p_total, 0), 0)::numeric
    END,
    CASE
      WHEN jsonb_typeof(p_detalhe) = 'array' AND jsonb_array_length(p_detalhe) > 0 THEN
        (SELECT coalesce(sum(coalesce((d->>'dificil')::numeric, 0)), 0)
           FROM jsonb_array_elements(p_detalhe) d)
      ELSE 0::numeric
    END
$$;

COMMENT ON FUNCTION public.ficha_pares(jsonb, integer) IS
  'Pares por dificuldade de um lançamento da Ficha de Montadores. Espelha '
  'paresDiffOfRow (montadorProduction.ts): modelo novo {tamanho,medio,dificil}, '
  'legado {tamanho,pares} como tudo MÉDIO, sem detalhe cai no total.';

-- 2) Valor do lançamento pelo SNAPSHOT da própria linha ------------------------
CREATE OR REPLACE FUNCTION public.ficha_valor(
  p_detalhe jsonb, p_total integer, p_vp numeric, p_vpm numeric, p_vpd numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(fp.medio * coalesce(p_vpm, p_vp, 0) + fp.dificil * coalesce(p_vpd, 0), 2)
    FROM public.ficha_pares(p_detalhe, p_total) fp
$$;

COMMENT ON FUNCTION public.ficha_valor(jsonb, integer, numeric, numeric, numeric) IS
  'R$ de um lançamento pelo R$/par gravado NELE (snapshot). Mesma conta de '
  'sumProducaoRows (montadorProduction.ts), que é a que a folha executa.';

-- 3) É produção diária (modelo chamada)? --------------------------------------
CREATE OR REPLACE FUNCTION public.ficha_is_chamada(p_origem text, p_numeracoes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_origem = 'chamada'
      OR (p_origem IS NULL AND coalesce(jsonb_array_length(p_numeracoes), 0) = 0)
$$;

-- 4) Reivindicação / liberação na virada de status ----------------------------
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
  SELECT coalesce(payment_type, 'mensalista') INTO v_regime
    FROM employees WHERE id = NEW.employee_id;

  -- Produção de mensalista/diarista/remoto é medição, não pagamento.
  IF v_regime <> 'producao' THEN
    RETURN NEW;
  END IF;

  v_range := public.payroll_period_range(NEW.period);
  IF v_range IS NULL THEN
    RETURN NEW;  -- período ilegível: não mexe em nada
  END IF;

  -- ── APROVAÇÃO: reivindica o que está livre ──────────────────────────────
  -- Vindo de QUALQUER estado não-finalizado, não só de 'rascunho'. O trigger de
  -- adiantamentos testa `OLD.status='rascunho'` e, com isso, uma folha cancelada
  -- e reaprovada não reivindicaria nada — sairia valendo zero em silêncio.
  IF NEW.status IN ('aprovado', 'pago')
     AND coalesce(OLD.status, 'rascunho') NOT IN ('aprovado', 'pago') THEN

    -- Dias da janela que JÁ pertencem a outra folha (o que teria sido pago 2×).
    SELECT count(*), string_agg(to_char(f.dia, 'DD/MM'), ', ' ORDER BY f.dia)
      INTO v_conflito, v_dias_conf
      FROM ficha_montadores f
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NOT NULL
       AND f.payroll_run_id <> NEW.id
       AND public.ficha_is_chamada(f.origem, f.numeracoes);

    -- Lançamentos livres porém sem R$/par: não queimar (ver decisão 2 no topo).
    SELECT count(*) INTO v_zerados
      FROM ficha_montadores f
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NULL
       AND public.ficha_is_chamada(f.origem, f.numeracoes)
       AND public.ficha_valor(f.detalhe, f.total, f.valor_par, f.valor_par_medio, f.valor_par_dificil) <= 0;

    UPDATE ficha_montadores f
       SET payroll_run_id = NEW.id
     WHERE f.montador_id = NEW.employee_id
       AND f.dia <@ v_range
       AND f.payroll_run_id IS NULL
       AND public.ficha_is_chamada(f.origem, f.numeracoes)
       AND public.ficha_valor(f.detalhe, f.total, f.valor_par, f.valor_par_medio, f.valor_par_dificil) > 0;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    -- Bruto = SÓ o que esta folha realmente reivindicou.
    SELECT coalesce(sum(public.ficha_valor(f.detalhe, f.total, f.valor_par, f.valor_par_medio, f.valor_par_dificil)), 0)
      INTO v_bruto
      FROM ficha_montadores f
     WHERE f.payroll_run_id = NEW.id;

    v_antes := coalesce(NEW.total_proventos, 0);
    -- Só colunas que existem em payroll_runs: `gross_value`/`period_base` são
    -- campos do objeto TS de salaryPayroll, não da tabela.
    NEW.total_proventos := v_bruto;
    -- O líquido é refinado logo em seguida por trg_payroll_link_advances_and_overtime,
    -- que roda DEPOIS deste (tg_ < trg_) e desconta os adiantamentos.
    NEW.total_liquido   := v_bruto - coalesce(NEW.total_descontos, 0);

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
      NEW.notes := trim(both E' \n' from coalesce(NEW.notes, '') || E'\n' || v_aviso);
    END IF;

  -- ── VOLTA PRA RASCUNHO **OU CANCELAMENTO**: devolve pro pool ────────────
  -- Na prática o caminho real é o CANCELAMENTO: tg_payroll_lock_finalized barra
  -- aprovado→rascunho no banco. É por isso que copiar os adiantamentos deixaria
  -- a produção presa pra sempre — o branch de liberação deles exige justamente a
  -- transição que o lock impede.
  ELSIF NEW.status IN ('rascunho', 'cancelado') AND coalesce(OLD.status, '') IN ('aprovado', 'pago') THEN
    UPDATE ficha_montadores
       SET payroll_run_id = NULL, pago_em = NULL
     WHERE payroll_run_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ficha_claim_production ON public.payroll_runs;
CREATE TRIGGER tg_ficha_claim_production
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_claim_production();

-- 5) Pagamento agora só DATA o que a folha já reivindicou ----------------------
-- Antes procurava linha livre (payroll_run_id IS NULL). Com a reivindicação na
-- aprovação, as linhas chegam ao pagamento JÁ com payroll_run_id preenchido — a
-- guarda antiga as pularia e pago_em nunca seria gravado.
CREATE OR REPLACE FUNCTION public.tg_ficha_stamp_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE ficha_montadores f
     SET pago_em = NEW.paid_on
   WHERE f.payroll_run_id = NEW.payroll_run_id
     AND f.pago_em IS DISTINCT FROM NEW.paid_on;
  RETURN NEW;
END;
$$;

-- 6) Estorno do pagamento volta pro estado "na folha", não pro pool ------------
-- Some a data de pagamento, mas o vínculo com a folha permanece: quem solta o
-- lançamento é o cancelamento/reabertura da FOLHA (item 4), não o apagar de um
-- recibo.
CREATE OR REPLACE FUNCTION public.tg_ficha_unstamp_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payroll_payments p
                  WHERE p.payroll_run_id = OLD.payroll_run_id) THEN
    UPDATE ficha_montadores SET pago_em = NULL
     WHERE payroll_run_id = OLD.payroll_run_id;
  END IF;
  RETURN OLD;
END;
$$;
