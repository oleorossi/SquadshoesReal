-- G23 (FURO-1) — invariante do livro-razão de estoque.
--
-- Auditoria 2026-08-07 (docs/AUDITORIA_MOTORES_2026-08-07.md): em junho/2026, 70
-- reservas foram marcadas como consumidas SEM gerar o stock_movement correspondente
-- — a reserva dizia "consumido" e o estoque nunca foi debitado. Isso abriu os furos
-- de baixa que `list_stock_debit_holes()` acusa (1.172 linhas, 184 OPs, mar–jun).
--
-- O mecanismo já se fechou sozinho: em julho a consistência é 100% (65/65), e hoje
-- TODAS as 8 funções que escrevem `quantity_consumed` também inserem em
-- `stock_movements`. Não há culpada viva para consertar — há um invariante para
-- travar, de modo que a regressão não passe despercebida de novo.
--
-- O guard é GENÉRICO: varre `pg_proc` em vez de nomear funções, então cobre função
-- nova automaticamente e não envelhece como as assertivas G3–G22, que citam nome.
--
-- Estendido por INJEÇÃO a partir do catálogo (pg_get_functiondef) em vez de
-- reescrever o corpo inteiro: os 22 casos existentes não são transcritos, portanto
-- não podem ser corrompidos por erro de cópia.

DO $mig$
DECLARE
  v_def  text;
  v_novo text;
  v_caso text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_debit_guard_tests';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'run_debit_guard_tests não existe — nada a estender';
  END IF;

  IF position('G23' in v_def) > 0 THEN
    RAISE NOTICE 'G23 já presente em run_debit_guard_tests; nada a fazer';
    RETURN;
  END IF;

  v_caso := $caso$
  -- G23 (FURO-1): toda função que MARCA reserva como consumida tem que gerar o
  -- stock_movement correspondente. Quebrar isso abriu 70 furos de baixa em jun/2026.
  RETURN QUERY
  SELECT 'G23 quem escreve quantity_consumed também gera stock_movement (FURO-1)'::text,
         NOT EXISTS (
           SELECT 1 FROM pg_proc pp JOIN pg_namespace nn ON nn.oid = pp.pronamespace
            WHERE nn.nspname = 'public'
              AND pp.proname <> 'run_debit_guard_tests'
              AND pp.prosrc ~* 'set[^;]*quantity_consumed[[:space:]]*='
              AND pp.prosrc !~* 'insert[[:space:]]+into[[:space:]]+(public\.)?stock_movements'
         ),
         COALESCE((
           SELECT 'violam: ' || string_agg(pp.proname, ', ' ORDER BY pp.proname)
             FROM pg_proc pp JOIN pg_namespace nn ON nn.oid = pp.pronamespace
            WHERE nn.nspname = 'public'
              AND pp.proname <> 'run_debit_guard_tests'
              AND pp.prosrc ~* 'set[^;]*quantity_consumed[[:space:]]*='
              AND pp.prosrc !~* 'insert[[:space:]]+into[[:space:]]+(public\.)?stock_movements'
         ), 'ok: toda função que marca consumo gera movimento');

$caso$;

  v_novo := regexp_replace(v_def, 'END;\s*\$function\$\s*$', v_caso || 'END;' || chr(10) || '$function$');

  IF v_novo = v_def THEN
    RAISE EXCEPTION 'não localizei o fim do corpo de run_debit_guard_tests — injeção abortada';
  END IF;

  EXECUTE v_novo;
END $mig$;
