-- ============================================================================
-- HIGIENE DE MIGRATIONS + idempotência do restore (auditoria 2026-06-09, A4)
--
-- 1) DROP de overloads stale que o replay do histórico recria (migrations
--    antigas recriaram assinaturas curtas sem saber das novas com
--    p_force_soft). No banco vivo já foram dropadas via MCP; este arquivo
--    garante o mesmo resultado num replay em banco novo (sem ele, chamadas
--    com N args viram erro 42725 "function is not unique").
--
-- 2) restore_product_stocks_for_order: a versão em produção creditava o
--    líquido (out − in) SEM registrar o movimento 'in' compensatório.
--    Re-execução (retry de cancelamento, resync de OP 2×) creditava o
--    estoque DE NOVO a cada chamada. Restaurada a idempotência por
--    construção da versão 20260508130000: registrar 'in' no ledger faz o
--    net zerar e a re-execução virar no-op. Mantido o skip de produtos com
--    stock_grade (solado é restaurado por restore_sole_grade_for_order) e o
--    fallback para box_types.
--
-- Nota de rastreio: as migrations 20260620230000..20260721160000 foram
-- aplicadas via MCP e registradas manualmente em
-- supabase_migrations.schema_migrations em 2026-06-09 (este commit) para o
-- GitHub Action `supabase db push` não tentar reaplicá-las.
-- ⚠ Existem versões DUPLICADAS no diretório (ex.: 20260601120000,
-- 20260607120000, 20260627120000/130000, 20260628120000/130000,
-- 20260630120000, 20260608120000, 20260610120000): o supabase CLI deduplica
-- por versão, então o segundo arquivo de cada par NUNCA aplica num replay.
-- Renomear com timestamps únicos antes de usar replay em banco novo.
-- ============================================================================

-- ── 1. Overloads stale ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.debit_strap_stock(jsonb, integer, uuid, jsonb);
DROP FUNCTION IF EXISTS public.debit_packaging_for_order(uuid, uuid, uuid, integer, text);

-- ── 2. restore_product_stocks_for_order idempotente ─────────────────────────
CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_current_qty numeric;
  v_stock_grade jsonb;
  v_grade_nonempty boolean;
  v_net_credit numeric;
  v_updated boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOR v_rec IN
    SELECT
      product_id,
      COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'in'  THEN quantity ELSE 0 END), 0) AS net_debit
    FROM public.stock_movements
    WHERE order_id = p_order_id
    GROUP BY product_id
  LOOP
    v_net_credit := v_rec.net_debit;
    IF v_net_credit <= 0 THEN CONTINUE; END IF;
    v_updated := false;

    SELECT quantity, stock_grade INTO v_current_qty, v_stock_grade
      FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF FOUND THEN
      v_grade_nonempty := false;
      IF v_stock_grade IS NOT NULL AND jsonb_typeof(v_stock_grade) = 'object' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_each_text(v_stock_grade)
           WHERE left(key, 1) <> '_'
        ) INTO v_grade_nonempty;
      END IF;

      IF v_grade_nonempty THEN
        -- Solado com grade: restaurado por restore_sole_grade_for_order
        -- (que registra o próprio 'in' por tamanho). Não creditar flat.
        v_updated := true;
      ELSE
        UPDATE public.products
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        -- Movimento compensatório: zera o net pra re-execução virar no-op
        -- (idempotência por construção — design original da 20260508130000).
        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, v_current_qty,
          v_current_qty + v_net_credit,
          'Estorno de débitos da OP (restore)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;

    IF NOT v_updated THEN
      SELECT quantity INTO v_current_qty
        FROM public.box_types WHERE id = v_rec.product_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.box_types
           SET quantity = v_current_qty + v_net_credit, updated_at = now()
         WHERE id = v_rec.product_id;
        -- box_types também precisa do 'in' compensatório (mesmo ledger)
        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_rec.product_id, 'in', v_net_credit, v_current_qty,
          v_current_qty + v_net_credit,
          'Estorno de débitos da OP (restore — caixa)', p_order_id
        );
        v_updated := true;
      END IF;
    END IF;
  END LOOP;
END;
$function$;
