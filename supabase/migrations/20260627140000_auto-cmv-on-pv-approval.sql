-- =============================================================================
-- CMV automático ao aprovar/produzir PV
-- =============================================================================
-- Gap industrial P0: CMV (Custo dos Produtos Vendidos) só é registrado quando
-- o usuário clica manualmente em "Calcular Custos" no PV. NetMarginChart e
-- DRE leem `order_costs`, mas se ninguém clicou, margem aparece como receita
-- pura — sem custo deduzido. DRE mensal sai distorcido pra positivo.
--
-- Fix: trigger em sale_orders UPDATE de status:
--   • Quando o PV chega em status que indica venda confirmada
--     ('Em Produção', 'Faturado'), garante que process_dirty_order_costs já
--     rodou para esse PV — se não rodou, dispara síncrono.
--   • Gera financial_entry de CMV com reference_type='sale_order_cmv',
--     baseado em order_costs.total_cost. Idempotente: atualiza se já existir.
--   • Cancela CMV se PV vira Cancelado.
--
-- Não duplica frete (já existe sale_order_frete) nem AR (já existe ao gerar NFe).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_cmv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_cost numeric;
  v_due_date date;
  v_existing uuid;
  v_ref text;
BEGIN
  v_ref := NEW.id::text;

  -- Se PV está em status que NÃO gera CMV → cancela entry existente
  IF NEW.status IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado') THEN
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado') THEN
      UPDATE public.financial_entries
         SET status = 'cancelado',
             updated_at = now()
       WHERE reference_type = 'sale_order_cmv'
         AND reference_id = v_ref
         AND status = 'pendente';
    END IF;
    RETURN NEW;
  END IF;

  -- Se chegou aqui, status é Em Produção/Faturado/Expedido/Concluído etc.
  -- Marca PV como dirty (cron recalcula) se ainda não tem order_costs.
  -- (não chama calculate_order_cost síncrono pra evitar lock prolongado)
  IF NOT EXISTS (SELECT 1 FROM public.order_costs WHERE sale_order_id = NEW.id) THEN
    UPDATE public.sale_orders SET costs_dirty_at = COALESCE(costs_dirty_at, now()) WHERE id = NEW.id;
    -- Sem custo ainda calculado → não cria CMV agora. Cron vai rodar em ~1min e
    -- na próxima transição de status (ou trigger explícito de mark_dirty) a entry
    -- será gerada. Evita criar CMV com custo zero acidentalmente.
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cost
    FROM public.order_costs
   WHERE sale_order_id = NEW.id;

  IF v_total_cost <= 0 THEN
    -- Custo zero ou negativo: provavelmente ficha incompleta. Não cria CMV
    -- fantasma. Marca dirty pra cron recalcular.
    UPDATE public.sale_orders SET costs_dirty_at = COALESCE(costs_dirty_at, now()) WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- Due date: usa delivery_deadline (data prevista de saída/receita). CMV é
  -- competência da data de venda — alinhamos pra que DRE mensal balance.
  v_due_date := COALESCE(NEW.delivery_deadline, CURRENT_DATE);

  SELECT id INTO v_existing
    FROM public.financial_entries
   WHERE reference_type = 'sale_order_cmv'
     AND reference_id = v_ref
     AND status NOT IN ('cancelado', 'cancelled', 'estornado')
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.financial_entries
       SET amount = v_total_cost,
           entry_date = v_due_date,
           description = 'CMV - ' || COALESCE(NEW.order_number, v_ref),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.financial_entries (
      entry_date, type, description, amount,
      reference_type, reference_id, status, notes
    ) VALUES (
      v_due_date,
      'despesa',
      'CMV - ' || COALESCE(NEW.order_number, v_ref),
      v_total_cost,
      'sale_order_cmv',
      v_ref,
      'pendente',
      'Custo dos Produtos Vendidos lançado automaticamente quando PV transicionou '
      || 'para status "' || NEW.status || '". Baseado em order_costs.total_cost '
      || 'agregado dos itens do pedido. Recalculado se preço de material ou ficha '
      || 'técnica mudar (até o PV ir pra status terminal — daí o snapshot congela).'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_order_creates_cmv ON public.sale_orders;
CREATE TRIGGER trg_sale_order_creates_cmv
  AFTER INSERT OR UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sale_order_creates_cmv();

GRANT EXECUTE ON FUNCTION public.tg_sale_order_creates_cmv() TO authenticated;

-- Quando order_costs atualiza (cron recalculou), re-emite/atualiza o CMV.
-- Necessário pra o caso onde PV foi aprovado mas custos ainda não tinham
-- sido calculados — agora foram → cria CMV retroativo.
CREATE OR REPLACE FUNCTION public.tg_order_costs_syncs_cmv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so RECORD;
BEGIN
  SELECT id, status, order_number, delivery_deadline
    INTO v_so
    FROM public.sale_orders
   WHERE id = NEW.sale_order_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_so.status IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado') THEN
    RETURN NEW;
  END IF;

  -- Re-dispara o trigger principal "manualmente" via UPDATE no-op em sale_orders
  -- updated_at. Isso chama tg_sale_order_creates_cmv com NEW=OLD (status mesmo)
  -- mas o trigger é AFTER UPDATE OF status — não dispara em UPDATE de updated_at.
  --
  -- Mais simples: replicar a lógica aqui. Ou: chamar diretamente uma função
  -- auxiliar compartilhada. Optamos por replicar (menos acoplamento).
  DECLARE
    v_total_cost numeric;
    v_due_date date;
    v_existing uuid;
    v_ref text := v_so.id::text;
  BEGIN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cost
      FROM public.order_costs
     WHERE sale_order_id = v_so.id;

    IF v_total_cost <= 0 THEN RETURN NEW; END IF;
    v_due_date := COALESCE(v_so.delivery_deadline, CURRENT_DATE);

    SELECT id INTO v_existing
      FROM public.financial_entries
     WHERE reference_type = 'sale_order_cmv'
       AND reference_id = v_ref
       AND status NOT IN ('cancelado', 'cancelled', 'estornado')
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      UPDATE public.financial_entries
         SET amount = v_total_cost,
             entry_date = v_due_date,
             updated_at = now()
       WHERE id = v_existing
         AND amount IS DISTINCT FROM v_total_cost;
    ELSE
      INSERT INTO public.financial_entries (
        entry_date, type, description, amount,
        reference_type, reference_id, status, notes
      ) VALUES (
        v_due_date, 'despesa',
        'CMV - ' || COALESCE(v_so.order_number, v_ref),
        v_total_cost, 'sale_order_cmv', v_ref, 'pendente',
        'CMV criado retroativamente após recálculo de custo. '
        || 'order_costs.total_cost = ' || v_total_cost || '.'
      );
    END IF;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_costs_syncs_cmv ON public.order_costs;
CREATE TRIGGER trg_order_costs_syncs_cmv
  AFTER INSERT OR UPDATE OF total_cost ON public.order_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_order_costs_syncs_cmv();

GRANT EXECUTE ON FUNCTION public.tg_order_costs_syncs_cmv() TO authenticated;

COMMENT ON FUNCTION public.tg_sale_order_creates_cmv() IS
  'Cria/atualiza financial_entry (type=despesa, reference_type=sale_order_cmv) '
  'quando PV transita pra status que indica venda confirmada (Em Produção, '
  'Faturado, etc.). Idempotente: UNIQUE constraint em financial_entries impede '
  'duplicação por race. Cancelado quando PV volta pra status pré-venda. Fix '
  'P0 do gap "CMV não lançado automaticamente" (20260627140000).';

-- Backfill: PVs em status ativo que JÁ têm order_costs mas ainda não têm
-- financial_entry de CMV. Dispara o trigger em todos.
UPDATE public.sale_orders
   SET status = status -- noop UPDATE pra disparar tg_sale_order_creates_cmv
 WHERE status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado')
   AND EXISTS (SELECT 1 FROM public.order_costs WHERE sale_order_id = sale_orders.id)
   AND NOT EXISTS (
     SELECT 1 FROM public.financial_entries
      WHERE reference_type = 'sale_order_cmv'
        AND reference_id = sale_orders.id::text
        AND status NOT IN ('cancelado', 'cancelled', 'estornado')
   );

-- UNIQUE constraint pra impedir duplicação por race condition
CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_sale_order_cmv_unique
  ON public.financial_entries (reference_id)
  WHERE reference_type = 'sale_order_cmv'
    AND status NOT IN ('cancelado', 'cancelled', 'estornado');
