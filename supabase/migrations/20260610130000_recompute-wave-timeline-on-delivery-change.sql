-- =============================================================================
-- AUDITORIA #1 — wave timeline NÃO recalcula quando delivery_deadline muda
-- =============================================================================
--
-- 🔴 Bug crítico encontrado na auditoria pós-PR1/PR2:
--
-- Quando o usuário muda sale_orders.delivery_deadline, o trigger
-- trg_auto_assign_wave chama sync_sale_order_wave_items(NEW.id), que faz:
--   - Reassign do PV pra outra wave se billing_week mudou
--   - Sync de wave_items + sources
--   - Recompute totais (total_pairs, total_items, updated_at)
--
-- Mas NÃO chama update_wave_timeline(wave_id). Resultado: as colunas
-- production_waves.purchase_deadline, material_ready_date e os 8
-- *_start_date ficam DEFASADAS depois de qualquer mudança em delivery_deadline.
--
-- Isso quebra o princípio "data de faturamento é o motriz gerador" — o sistema
-- até calcula a nova timeline quando você abre o PV (compute_wave_timeline
-- roda on-demand), mas as colunas persistidas em production_waves continuam
-- mostrando datas antigas. UI que lê dessas colunas (ProductionWavesPage,
-- WaveDetailPanel) exibe info errada.
--
-- ✓ FIX: estende o trigger pra recalcular timeline da wave envolvida
-- (e da wave anterior, caso o PV tenha mudado de wave por troca de billing_week).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_auto_assign_wave_on_sale_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_wave_id uuid;
  v_new_wave_id uuid;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status IN ('Aprovado','Em Produção'))
     OR (TG_OP = 'UPDATE' AND (
           NEW.status IN ('Aprovado','Em Produção')
        OR NEW.billing_week IS DISTINCT FROM OLD.billing_week
        OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
     ))
  THEN
    -- Captura wave atual ANTES do sync (caso o sync reassine pra outra wave,
    -- precisamos recalcular timeline da wave antiga também).
    SELECT pwi.wave_id INTO v_old_wave_id
      FROM production_wave_item_sources pwis
      JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
      JOIN production_waves pw ON pw.id = pwi.wave_id
     WHERE pwis.sale_order_id = NEW.id
       AND pw.status::text NOT IN ('cancelled','finished')
     LIMIT 1;

    PERFORM sync_sale_order_wave_items(NEW.id);

    -- Captura wave nova DEPOIS do sync.
    SELECT pwi.wave_id INTO v_new_wave_id
      FROM production_wave_item_sources pwis
      JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
      JOIN production_waves pw ON pw.id = pwi.wave_id
     WHERE pwis.sale_order_id = NEW.id
       AND pw.status::text NOT IN ('cancelled','finished')
     LIMIT 1;

    -- Recalcula timeline da wave antiga (se diferente da nova) e da nova.
    -- Wraps em BEGIN/EXCEPTION pra não bloquear o trigger se update_wave_timeline
    -- falhar por dado inconsistente (devem ser raros mas defensivo).
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
$function$;

COMMENT ON FUNCTION public.trg_auto_assign_wave_on_sale_order() IS
  'Trigger handler que sincroniza wave_items e RECALCULA TIMELINE da onda '
  'quando muda status/billing_week/delivery_deadline. Cobre tanto wave atual '
  'quanto wave anterior em caso de migração entre semanas. Antes (audit pre-2026-06): '
  'só sincronizava itens — timeline ficava com datas defasadas após mudança.';

-- ─── Recompute one-shot pras waves não-finalizadas pra normalizar estado atual ─
-- Após a migration anterior (PR1+PR2), as funções compute_* mudaram. As waves
-- em produção precisam de uma volta pra refletir a nova fórmula (que conta
-- 8 setores + buffer + supplier descontando POs pending).
DO $$
DECLARE
  v_wave RECORD;
BEGIN
  FOR v_wave IN
    SELECT id FROM public.production_waves
    WHERE status::text NOT IN ('cancelled', 'finished')
  LOOP
    BEGIN
      PERFORM public.update_wave_timeline(v_wave.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'recompute pós-PR1 falhou pra wave %: %', v_wave.id, SQLERRM;
    END;
  END LOOP;
END $$;
