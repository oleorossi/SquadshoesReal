-- =============================================================================
-- 20260515220000 — Blinda triggers AFTER em sale_orders contra perda de PV
-- =============================================================================
--
-- Bug: user reportou 'cadastrei 2 PVs que simplesmente desapareceram'.
-- Investigação: gaps na sequência (PV-00102, 00103, 00105, 00106 sumidos).
--
-- Causa raiz:
--   1. Trigger BEFORE INSERT 'generate_pv_number' consome nextval('pv_number_seq')
--      e seta NEW.order_number.
--   2. Sequence nextval é IMUNE a rollback — uma vez consumido, o número
--      não volta.
--   3. Se QUALQUER trigger AFTER INSERT lançar exception (FK quebrado, RLS
--      barrando insert em financial_entries, função auxiliar com bug),
--      a transação faz rollback. O sale_order não é gravado, MAS o número
--      da sequence ficou queimado.
--
-- Triggers AFTER INSERT em sale_orders que NÃO tinham EXCEPTION wrap:
--   - tg_sale_order_creates_cmv (INSERT em financial_entries)
--   - tg_sale_order_creates_shipping_expense (INSERT em financial_entries)
--   - trg_auto_assign_wave_on_sale_order (sync_sale_order_wave_items)
--
-- Fix: envolver o corpo inteiro de cada uma em BEGIN…EXCEPTION WHEN OTHERS
-- THEN RAISE WARNING; RETURN NEW; END;. Falhas de side-effect viram WARNING
-- no log do Postgres mas NÃO cancelam o INSERT do PV. O PV é gravado;
-- o efeito colateral (CMV automático, frete, atribuição de onda) pode ser
-- reprocessado manualmente.
--
-- (Aplicado direto via MCP. Migration aqui pra rastreamento e replay em
-- ambiente novo.)

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_cmv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_total_cost numeric; v_due_date date; v_existing uuid; v_ref text;
BEGIN
  BEGIN
    v_ref := NEW.id::text;
    IF NEW.status IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado') THEN
      IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Pendente', 'Aprovado') THEN
        UPDATE public.financial_entries SET status = 'cancelado', updated_at = now()
         WHERE reference_type = 'sale_order_cmv' AND reference_id = v_ref AND status = 'pendente';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_costs WHERE sale_order_id = NEW.id) THEN
      UPDATE public.sale_orders SET costs_dirty_at = COALESCE(costs_dirty_at, now()) WHERE id = NEW.id;
      RETURN NEW;
    END IF;
    SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cost FROM public.order_costs WHERE sale_order_id = NEW.id;
    IF v_total_cost <= 0 THEN
      UPDATE public.sale_orders SET costs_dirty_at = COALESCE(costs_dirty_at, now()) WHERE id = NEW.id;
      RETURN NEW;
    END IF;
    v_due_date := COALESCE(NEW.delivery_deadline, CURRENT_DATE);
    SELECT id INTO v_existing FROM public.financial_entries
     WHERE reference_type = 'sale_order_cmv' AND reference_id = v_ref AND status NOT IN ('cancelado', 'cancelled', 'estornado') LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.financial_entries SET amount = v_total_cost, entry_date = v_due_date,
        description = 'CMV - ' || COALESCE(NEW.order_number, v_ref), updated_at = now() WHERE id = v_existing;
    ELSE
      INSERT INTO public.financial_entries (entry_date, type, description, amount, reference_type, reference_id, status, notes)
      VALUES (v_due_date, 'despesa', 'CMV - ' || COALESCE(NEW.order_number, v_ref), v_total_cost, 'sale_order_cmv', v_ref, 'pendente',
        'CMV automatico em transicao para ' || NEW.status);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_sale_order_creates_cmv(%) falhou: % — PV mantido', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_shipping_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_pairs int; v_amount numeric; v_due_date date;
  v_existing_id uuid; v_existing_status text;
BEGIN
  BEGIN
    IF COALESCE(NEW.shipping_rate_per_pair, 0) <= 0 THEN
      IF TG_OP = 'UPDATE' AND COALESCE(OLD.shipping_rate_per_pair, 0) > 0 THEN
        UPDATE public.financial_entries
           SET status = 'cancelado', updated_at = now()
         WHERE reference_type = 'sale_order_frete'
           AND reference_id = NEW.id::text AND status = 'pendente';
      END IF;
      RETURN NEW;
    END IF;
    SELECT COALESCE(SUM(quantity)::int, 0) INTO v_total_pairs
      FROM public.sale_order_items WHERE sale_order_id = NEW.id;
    IF v_total_pairs <= 0 THEN RETURN NEW; END IF;
    v_amount := NEW.shipping_rate_per_pair * v_total_pairs;
    v_due_date := public.add_business_days(CURRENT_DATE, 3)::date;
    SELECT id, status INTO v_existing_id, v_existing_status
      FROM public.financial_entries
     WHERE reference_type = 'sale_order_frete' AND reference_id = NEW.id::text
       AND status NOT IN ('cancelado', 'cancelled', 'estornado') LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      IF v_existing_status IN ('pago', 'paid', 'confirmed', 'posted', 'reconciled') THEN
        RETURN NEW;
      END IF;
      UPDATE public.financial_entries
         SET amount = v_amount,
             description = 'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
             updated_at = now()
       WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.financial_entries (
        entry_date, type, description, amount,
        reference_type, reference_id, status, notes
      ) VALUES (
        v_due_date, 'despesa',
        'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
        v_amount, 'sale_order_frete', NEW.id::text, 'pendente',
        'Lançamento automático gerado ao criar/atualizar PV com taxa de frete por par. ' ||
          'Pagamento previsto pra ' || to_char(v_due_date, 'DD/MM/YYYY') ||
          ' (3 dias úteis). Taxa: R$ ' || NEW.shipping_rate_per_pair ||
          '/par × ' || v_total_pairs || ' pares.'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_sale_order_creates_shipping_expense(%) falhou: % — PV mantido', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_auto_assign_wave_on_sale_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_wave_id uuid; v_new_wave_id uuid;
BEGIN
  BEGIN
    IF (TG_OP = 'INSERT' AND NEW.status IN ('Aprovado','Em Produção'))
       OR (TG_OP = 'UPDATE'
           AND NEW.status IN ('Aprovado','Em Produção')
           AND (
                NEW.status IS DISTINCT FROM OLD.status
             OR NEW.billing_week IS DISTINCT FROM OLD.billing_week
             OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
           ))
    THEN
      SELECT pwi.wave_id INTO v_old_wave_id
        FROM production_wave_item_sources pwis
        JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
        JOIN production_waves pw ON pw.id = pwi.wave_id
       WHERE pwis.sale_order_id = NEW.id
         AND pw.status::text NOT IN ('cancelled','finished')
       LIMIT 1;
      PERFORM sync_sale_order_wave_items(NEW.id);
      SELECT pwi.wave_id INTO v_new_wave_id
        FROM production_wave_item_sources pwis
        JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
        JOIN production_waves pw ON pw.id = pwi.wave_id
       WHERE pwis.sale_order_id = NEW.id
         AND pw.status::text NOT IN ('cancelled','finished')
       LIMIT 1;
      IF v_old_wave_id IS NOT NULL AND v_old_wave_id IS DISTINCT FROM v_new_wave_id THEN
        BEGIN
          PERFORM update_wave_timeline(v_old_wave_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'update_wave_timeline(%) falhou (old wave): %', v_old_wave_id, SQLERRM;
        END;
      END IF;
      IF v_new_wave_id IS NOT NULL THEN
        BEGIN
          PERFORM update_wave_timeline(v_new_wave_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'update_wave_timeline(%) falhou (new wave): %', v_new_wave_id, SQLERRM;
        END;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_auto_assign_wave_on_sale_order(%) falhou: % — PV mantido', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
