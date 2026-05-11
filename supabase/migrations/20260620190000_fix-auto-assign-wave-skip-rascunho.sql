-- Fix: trigger trg_auto_assign_wave chamava sync_sale_order_wave_items
-- mesmo pra PVs em Rascunho quando billing_week/delivery_deadline mudavam.
-- Isso disparava insert em production_wave_item_sources, que era bloqueado
-- pelo trigger trg_block_rascunho_wave_assignment, devolvendo o erro
-- "O pedido X está em Rascunho e não pode ser atribuído..." em qualquer edição
-- de data de faturamento num PV em rascunho.
--
-- Correção: condição do UPDATE agora exige status IN ('Aprovado','Em Produção')
-- ANTES de verificar mudanças em billing_week/delivery_deadline. Rascunho fica
-- totalmente fora do auto-assign até ser aprovado.

CREATE OR REPLACE FUNCTION public.trg_auto_assign_wave_on_sale_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_old_wave_id uuid;
  v_new_wave_id uuid;
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
  RETURN NEW;
END;
$$;
