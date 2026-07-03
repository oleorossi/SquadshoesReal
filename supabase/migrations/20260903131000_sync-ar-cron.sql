-- P0.4 — disparo servidor→servidor da reconciliação de AR.
--
-- pg_cron (*/30) → net.http_post na edge function sync-ar, autenticando por
-- X-Cron-Secret (reusa o secret do vault 'nfe_sync_cron_secret', mesmo padrão
-- de trigger_nfe_sync_cron). Fecha o buraco "AR só nasce se alguém abrir o
-- dashboard": PV faturado com NF autorizada pelo poller ou NF externa ganha
-- parcelas em até 30 min sem intervenção humana.

CREATE OR REPLACE FUNCTION public.trigger_sync_ar_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'net'
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'nfe_sync_cron_secret' LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nfe_sync_cron_secret não encontrado no vault';
  END IF;

  SELECT net.http_post(
    url := 'https://ssvxfoybzmjlypnipqzn.supabase.co/functions/v1/sync-ar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trigger_sync_ar_cron() FROM public, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-ar-reconcile') THEN
    PERFORM cron.unschedule('sync-ar-reconcile');
  END IF;
END $$;

SELECT cron.schedule('sync-ar-reconcile', '*/30 * * * *', $$SELECT public.trigger_sync_ar_cron();$$);
