-- =============================================================================
-- FIX: check_grade_quantity_coherence barrava TODO produto sem numeração
-- =============================================================================
-- Sintoma reportado (20/08/2026): cancelar as 3 OPs do PV 3e33f8a3 falhava com
--   "restore_product_stocks_for_order: Incoerência de grade no produto
--    3b063cbb-…: soma 0 difere de quantity 89.8838…"
-- O mesmo erro barrava, na prática, QUALQUER escrita de saldo: estorno de OP,
-- débito, ajuste manual (/ajuste-estoque) e criação de produto com estoque
-- inicial — em 200 dos 211 produtos da base.
--
-- CAUSA RAIZ — regressão, não cadastro errado.
-- `products.stock_grade` tem DEFAULT '{}'::jsonb. Logo "produto sem numeração"
-- é `{}`, NUNCA NULL — medido: 0 linhas com stock_grade NULL, 200 com '{}'.
-- A versão original do gatilho (20260429230000) tinha a escapatória explícita:
--
--     -- Apenas valida quando há ao menos uma chave numérica positiva (evita
--     -- falsos positivos com grades vazias = produto sem numeração configurada).
--     IF (SELECT COUNT(*) FROM jsonb_each_text(NEW.stock_grade)) = 0 THEN
--       RETURN NEW;
--     END IF;
--
-- Essa guarda sumiu quando 20270101000900 reescreveu a função. O bug ficou
-- LATENTE porque 20260430175247 fez `DROP FUNCTION … CASCADE`, o que derrubou
-- junto o próprio gatilho — e ninguém o recriou até 20270101000900. Ou seja: a
-- função ficou meses errada sem gatilho, e o gatilho voltou já sem a escapatória.
-- Por isso a quebra apareceu de uma vez, em toda a base, e não gradualmente.
--
-- O FIX é restaurar a escapatória — só que sem reabrir o furo que ela deixava:
-- pular a conferência quando o produto NÃO é rastreado por numeração, definido
-- como "nem a grade nova nem a antiga têm bucket real (chave que não começa com
-- `_`)". Assim:
--   • produto sem numeração ('{}')            → passa, como antes de 20270101000900
--   • produto COM numeração                   → segue conferindo soma × quantity
--   • grade real ESVAZIADA com quantity > 0   → segue barrado (perda silenciosa
--     de numeração); esvaziar junto com quantity = 0 continua permitido, porque
--     aí a soma 0 fecha com o saldo 0 pela própria conferência.
--
-- As validações estruturais (objeto, valor numérico, negativo, fração em
-- unidade discreta) NÃO mudam — com zero buckets reais elas já eram no-op.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_total       numeric := 0;
  v_new_buckets integer := 0;
  v_old_buckets integer := 0;
BEGIN
  IF NEW.stock_grade IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.stock_grade) <> 'object' THEN
    RAISE EXCEPTION 'stock_grade deve ser um objeto JSON (produto %)', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND jsonb_typeof(g.v) IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'stock_grade contém quantidade não numérica (produto %)', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND (g.v #>> '{}')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'stock_grade contém quantidade negativa (produto %)', NEW.id;
  END IF;

  IF public.is_discrete_stock_unit(NEW.unit) AND EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND (g.v #>> '{}')::numeric <> trunc((g.v #>> '{}')::numeric)
  ) THEN
    RAISE EXCEPTION 'stock_grade contém fração em unidade discreta % (produto %)', NEW.unit, NEW.id;
  END IF;

  -- Buckets REAIS (metadados `_*` não contam como numeração).
  SELECT count(*)
    INTO v_new_buckets
    FROM jsonb_each(NEW.stock_grade) AS g(k, v)
   WHERE left(g.k, 1) <> '_';

  IF v_new_buckets = 0 THEN
    -- Sem numeração na linha nova. Em INSERT isso é simplesmente um produto de
    -- matéria-prima/componente: nada a conferir.
    IF TG_OP <> 'UPDATE' THEN
      RETURN NEW;
    END IF;

    IF OLD.stock_grade IS NOT NULL AND jsonb_typeof(OLD.stock_grade) = 'object' THEN
      SELECT count(*)
        INTO v_old_buckets
        FROM jsonb_each(OLD.stock_grade) AS g(k, v)
       WHERE left(g.k, 1) <> '_';
    END IF;

    -- Nunca teve numeração ⇒ produto não rastreado por grade: nada a conferir.
    -- (Tinha e perdeu ⇒ cai na conferência abaixo, que barra se sobrar saldo.)
    IF v_old_buckets = 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(sum((g.v #>> '{}')::numeric), 0)
    INTO v_total
    FROM jsonb_each(NEW.stock_grade) AS g(k, v)
   WHERE left(g.k, 1) <> '_';

  IF abs(v_total - COALESCE(NEW.quantity, 0)) > 0.0001 THEN
    RAISE EXCEPTION
      'Incoerência de grade no produto %: soma % difere de quantity %',
      NEW.id, v_total, COALESCE(NEW.quantity, 0);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_grade_quantity_coherence() IS
  'Confere soma da grade × quantity em produtos rastreados por numeração. Produto sem numeração (stock_grade = ''{}'', o DEFAULT da coluna) é ignorado — a guarda existia em 20260429230000 e foi perdida em 20270101000900, travando toda escrita de saldo.';
