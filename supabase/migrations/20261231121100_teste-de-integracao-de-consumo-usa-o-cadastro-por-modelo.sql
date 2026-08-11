-- Conserta o fixture de `run_consumption_integration_tests()`, que estava
-- gravando consumo do solado numa tabela que virou ESPELHO.
--
-- ── O sintoma ────────────────────────────────────────────────────────────────
-- 3 casos vermelhos, escondidos atrás do skip do vitest (o teste só roda com
-- RUN_DB_INTEGRATION=1, então `bun run test` nunca os viu):
--
--   CASO 2 (size=38) Forro ≈ sole_spec(6.10)      → valor=5.5000
--   CASO 2 (size=38) Palmilha ≈ sole_spec(4.50)   → valor=4.0000
--   CASO 2c Forro do sole_spec NÃO é fallback     → source=fallback_average
--
-- ── A causa ──────────────────────────────────────────────────────────────────
-- `tg_sole_specs_freeze_consumption` transformou `sole_technical_specs` em
-- tabela ESPELHO: o consumo por par passou a ser cadastrado por MODELO, em
-- `sole_group_standard_items` (tela Solados → Consumo Padrão), e o gatilho
-- replica pra todas as cores.
--
-- ⚠ O gatilho é ASSIMÉTRICO, e é isso que tornou a falha silenciosa: no UPDATE
-- ele dá RAISE ("sole_technical_specs é ESPELHO…"), mas no INSERT ele apenas
-- SOBRESCREVE os campos com o valor do modelo. Como o solado de teste não tinha
-- linha em `sole_group_standard_items`, os dm² gravados pelo fixture viravam
-- NULL sem erro nenhum. O motor então não achava consumo por numeração pro nº 38
-- e caía no escalar da ficha (5,50 / 4,00) com source='fallback_average' —
-- exatamente os valores observados.
--
-- ── O que NÃO é ──────────────────────────────────────────────────────────────
-- Não é regressão do motor. Verificado com dado real antes de mexer:
-- `resolve_sole_color` resolve o solado nas 8 fichas com sole_drives_consumption,
-- os solados têm 7 specs cada, e na DS22 (ficha do PV-00157) o motor devolve o
-- valor certo, com a conversão dm²→m² aplicada e a precedência correta
-- (per-size da ficha vence a spec do solado). Só o fixture sintético estava
-- desatualizado em relação à mudança de arquitetura.
--
-- ── O conserto ───────────────────────────────────────────────────────────────
-- O fixture passa a cadastrar por MODELO e deixar o espelho preencher a spec.
-- Validado em transação revertida: espelho grava 6,10/4,50 e o motor devolve
-- 6,10 pro nº 38 — que é o que os 3 casos esperam.
--
-- Patch ANCORADO em vez de reescrita: a função tem 7.884 caracteres e o resto
-- dela (CASO 1, 1b, 3, avisos) está correto e não deve ser retipado à mão.

DO $mig$
DECLARE
  v_src text;
  v_new text;

  v_anchor_clean constant text :=
$a$  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;$a$;

  v_anchor_insert constant text :=
$b$  INSERT INTO sole_technical_specs (sole_id, size, lining_consumption_dm2, insole_consumption_dm2)
  VALUES (v_sole_id, 38, 6.10, 4.50);$b$;

  v_repl_clean constant text :=
$c$  DELETE FROM sole_technical_specs  WHERE sole_id  = v_sole_id;
  DELETE FROM sole_group_standard_items WHERE sole_group_id = v_grp_sole;$c$;

  v_repl_insert constant text :=
$d$  -- sole_technical_specs é ESPELHO (tg_sole_specs_freeze_consumption): no
  -- INSERT ela SOBRESCREVE os dm² com o que vem do cadastro por MODELO. Gravar
  -- direto aqui não dava erro — os valores saíam NULL em silêncio e o CASO 2
  -- caía em fallback_average. O consumo mora em sole_group_standard_items.
  INSERT INTO sole_group_standard_items (sole_group_id, role, consumption_per_pair, consumption_per_size) VALUES
    (v_grp_sole, 'forro_cabedal',  6.10, '{"38": 6.10}'::jsonb),
    (v_grp_sole, 'placa_palmilha', 4.50, '{"38": 4.50}'::jsonb);

  -- A linha da spec nasce só com a numeração; o espelho preenche os dm².
  INSERT INTO sole_technical_specs (sole_id, size) VALUES (v_sole_id, 38);$d$;

BEGIN
  SELECT prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'run_consumption_integration_tests' AND n.nspname = 'public';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'run_consumption_integration_tests() não existe — nada a corrigir.';
  END IF;

  -- Idempotência: se já cadastra por modelo, a migration não tem o que fazer.
  IF position('sole_group_standard_items' in v_src) > 0 THEN
    RAISE NOTICE 'Fixture já usa sole_group_standard_items — nada a fazer.';
    RETURN;
  END IF;

  IF position(v_anchor_clean in v_src) = 0 THEN
    RAISE EXCEPTION 'Âncora de limpeza não encontrada — a função mudou; revisar à mão.';
  END IF;
  IF position(v_anchor_insert in v_src) = 0 THEN
    RAISE EXCEPTION 'Âncora do INSERT da spec não encontrada — a função mudou; revisar à mão.';
  END IF;

  v_new := replace(v_src, v_anchor_insert, v_repl_insert);
  v_new := replace(v_new, v_anchor_clean,  v_repl_clean);

  EXECUTE
    'CREATE OR REPLACE FUNCTION public.run_consumption_integration_tests()' ||
    ' RETURNS TABLE(case_name text, ok boolean, message text)' ||
    ' LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS ' ||
    quote_literal(v_new);
END
$mig$;

-- Trava: depois desta migration a suíte tem que estar 100% verde. Se algum caso
-- seguir falhando, é sinal de que havia MAIS do que o fixture desatualizado —
-- e aí o conserto é outro, não é emendar o teste pra ficar verde.
DO $check$
DECLARE
  v_falhas text;
BEGIN
  SELECT string_agg(case_name || ' → ' || COALESCE(message, ''), ' | ')
    INTO v_falhas
    FROM run_consumption_integration_tests()
   WHERE NOT ok;

  IF v_falhas IS NOT NULL THEN
    RAISE EXCEPTION 'run_consumption_integration_tests() ainda vermelha: %', v_falhas;
  END IF;
END
$check$;
