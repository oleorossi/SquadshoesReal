-- ============================================================================
-- Criar Pedido estava quebrado: gatilho lia coluna que não existe no cabeçalho
-- ============================================================================
--
-- SINTOMA: toda tentativa de criar PV devolvia
--   ERROR: record "new" has no field "sale_order_id"
-- e o pedido não nascia. Medido em 10/08/2026: NENHUM PV criado desde
-- 31/07/2026 14:47 — a venda ficou 10 dias travada, por qualquer caminho
-- (desktop, PWA, cópia de itens), porque o gatilho é AFTER INSERT ON sale_orders
-- e o erro estoura DENTRO da transação de create_sale_order_atomic.
--
-- CAUSA: `tg_min_billing_mark_dirty` (migration 20261115120000_pv-min-billing-cache)
-- serve DUAS tabelas — sale_orders, onde o PV é `id`, e sale_order_items, onde é
-- `sale_order_id`. A distinção era feita por um CASE:
--
--     v_so_id := CASE TG_TABLE_NAME
--                  WHEN 'sale_orders' THEN COALESCE(NEW.id, OLD.id)
--                  ELSE COALESCE(NEW.sale_order_id, OLD.sale_order_id)
--                END;
--
-- ⚠ CASE escolhe o VALOR, não protege a RESOLUÇÃO DE CAMPO. O CASE inteiro é UMA
-- expressão SQL: o PL/pgSQL resolve os `NEW.<coluna>` de TODOS os ramos contra o
-- tipo da linha antes de executar qualquer um. Em sale_orders o ramo do item não
-- tem como resolver `sale_order_id`, e a expressão inteira falha — mesmo o ramo
-- certo tendo casado. Em sale_order_items a coluna existe, e por isso AQUELE
-- gatilho sempre funcionou: só o lado do cabeçalho quebrava.
--
-- CORREÇÃO: ler a linha como jsonb. `->>` é operador sobre um valor, não
-- resolução de campo em tempo de plano, então chave ausente vira NULL em vez de
-- erro. O CASE em TG_TABLE_NAME fica (a intenção do autor estava certa).
--
-- Nada muda no comportamento: mesma chave, mesmo ON CONFLICT, mesma invalidação.
-- Os dois gatilhos continuam como estão — não precisam ser recriados.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_min_billing_mark_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row   jsonb;
  v_so_id uuid;
BEGIN
  -- ⚠ NÃO voltar a ler NEW.<coluna> / OLD.<coluna> direto aqui. Esta função está
  -- pendurada em DUAS tabelas com nomes de coluna diferentes pro mesmo PV, e o
  -- PL/pgSQL exige que todo campo citado exista no tipo da linha — inclusive em
  -- ramo de CASE que não vai ser escolhido. Foi exatamente assim que todo INSERT
  -- em sale_orders passou a falhar. Via jsonb não há campo a resolver.
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  v_so_id := (CASE TG_TABLE_NAME
                WHEN 'sale_orders' THEN v_row->>'id'
                ELSE v_row->>'sale_order_id'
              END)::uuid;

  IF v_so_id IS NOT NULL THEN
    INSERT INTO public.sale_order_min_billing_cache (sale_order_id, dirty)
    VALUES (v_so_id, true)
    ON CONFLICT (sale_order_id) DO UPDATE SET dirty = true, updated_at = now();
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Guarda contra reincidência
-- ---------------------------------------------------------------------------
-- Cruza todo `NEW.`/`OLD.` citado em função de gatilho plpgsql contra as colunas
-- da tabela em que ela está pendurada. Toda linha devolvida é uma bomba armada:
-- o erro só aparece quando um usuário real dispara aquele caminho — aqui foram
-- 10 dias de venda parada até alguém reclamar.
--
-- ⚠ Casa por NOME de coluna, então não enxerga campo montado por SQL dinâmico
-- (EXECUTE format(...)) nem alias de RECORD local. É rede de segurança, não prova.
CREATE OR REPLACE FUNCTION public.list_trigger_field_mismatches()
RETURNS TABLE (funcao text, tabela text, gatilho text, campo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH refs AS (
    SELECT DISTINCT
           p.proname::text AS funcao,
           c.relname::text AS tabela,
           t.tgname::text  AS gatilho,
           lower((regexp_matches(p.prosrc, '\m(?:NEW|OLD)\.([a-zA-Z_][a-zA-Z0-9_]*)', 'gi'))[1]) AS campo
    FROM pg_trigger t
    JOIN pg_class     c ON c.oid = t.tgrelid
    JOIN pg_proc      p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
  )
  SELECT r.funcao, r.tabela, r.gatilho, r.campo
  FROM refs r
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name   = r.tabela
      AND lower(col.column_name) = r.campo
  )
  ORDER BY r.funcao, r.tabela, r.campo;
$function$;

REVOKE ALL ON FUNCTION public.list_trigger_field_mismatches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_trigger_field_mismatches() TO authenticated;

-- Barra o defeito na hora de aplicar, em vez de meses depois pelo usuário.
DO $$
DECLARE
  v_sobras text;
  v_n      int;
BEGIN
  SELECT count(*), string_agg(format('%s em %s (%s.%s)', funcao, tabela, 'NEW', campo), '; ')
    INTO v_n, v_sobras
  FROM public.list_trigger_field_mismatches();

  IF v_n > 0 THEN
    RAISE EXCEPTION 'Gatilho lendo coluna inexistente (% caso(s)): %', v_n, v_sobras;
  END IF;
END $$;
