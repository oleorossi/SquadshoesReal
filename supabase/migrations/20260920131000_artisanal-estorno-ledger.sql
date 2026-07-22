-- Auditoria de motores Fase 2 — Pacote P5 (F4-2 + F5-01, mesma causa raiz)
--
-- CAUSA RAIZ
-- ----------
-- tg_revert_service_order_base_on_cancel RECOMPUTAVA a fórmula da receita
-- (artisanal_output_meters / yield_per_meter, valor CHEIO e pós-edição) em vez
-- de ler o que o ledger realmente debitou. O débito (tg_debit_service_order_base,
-- DEB-6) clampa com LEAST(required, estoque) e registra o valor clampado com
-- sufixo '(parcial X de Y)' e marcador [os:<id>]. Consequências do estorno velho:
--
--   1. Débito parcial (10 de 25) + cancelamento -> crédito de 25 = +15 de
--      estoque FANTASMA.
--   2. Metros editados após o débito (100 -> 300; nenhum trigger de UPDATE
--      re-debita) + cancelamento -> credita 300/yield tendo debitado 100/yield.
--   3. Re-resolvia o produto por grupo/cor + ORDER BY quantity DESC — como o
--      débito reduziu a quantity do produto escolhido, o re-pick podia creditar
--      um produto-IRMÃO do mesmo grupo (NAPA SOFT tem cor duplicada viva).
--   4. Idempotência pelo padrão legado com COALESCE(order_number,'?') — duas OS
--      sem número cruzavam entre si.
--
-- FIX (padrão restore_* das OPs: devolver o NET do próprio ledger)
-- ----------------------------------------------------------------
-- O estorno soma os movimentos 'out' da OS (marcador [os:<id>]; fallback legado
-- por order_number pros 12 débitos pré-DEB-6) MENOS os estornos 'in' já feitos,
-- e credita exatamente esse net no MESMO product_id de cada movimento — sem
-- recomputar fórmula, sem re-resolver produto. Idempotente por construção
-- (net <= 0 não credita nada). O estorno novo grava o marcador [os:<id>] pra
-- entrar no net de execuções futuras.
--
-- Sem UPDATE retroativo de dados históricos (só CREATE OR REPLACE da função).

CREATE OR REPLACE FUNCTION public.tg_revert_service_order_base_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mov  RECORD;
  v_prev numeric;
BEGIN
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada')
     AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelado','cancelled','rejeitada')
     AND NEW.artisanal_recipe_id IS NOT NULL THEN

    -- F4-2/F5-01: devolve EXATAMENTE o que o ledger debitou (net por produto).
    -- Sem gate em artisanal_output_meters: mesmo que os metros tenham sido
    -- editados/zerados depois do débito, o que manda é o movimento registrado.
    FOR v_mov IN
      SELECT sm.product_id,
             SUM(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE -sm.quantity END) AS net
        FROM public.stock_movements sm
       WHERE sm.product_id IS NOT NULL
         AND (
           (sm.movement_type = 'out'
             AND (sm.description LIKE '%[os:' || NEW.id || ']%'
                  OR (NEW.order_number IS NOT NULL
                      AND sm.description LIKE 'OS Artesanal ' || NEW.order_number || ' — base%')))
           OR
           (sm.movement_type = 'in'
             AND (sm.description LIKE 'Estorno OS%[os:' || NEW.id || ']%'
                  OR (NEW.order_number IS NOT NULL
                      AND sm.description LIKE 'Estorno OS ' || NEW.order_number || ' cancelada — base%')))
         )
       GROUP BY sm.product_id
      HAVING SUM(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE -sm.quantity END) > 0
    LOOP
      SELECT quantity INTO v_prev
        FROM public.products
       WHERE id = v_mov.product_id
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      UPDATE public.products
         SET quantity = quantity + v_mov.net, updated_at = now()
       WHERE id = v_mov.product_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
      ) VALUES (
        v_mov.product_id, 'in', v_mov.net, v_prev, v_prev + v_mov.net,
        'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base [os:' || NEW.id || ']',
        NULL
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
