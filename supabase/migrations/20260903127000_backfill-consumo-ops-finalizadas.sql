-- P0.2 / C4 — backfill do ledger de consumo para as OPs já finalizadas.
--
-- Limitação documentada: o standard usa a FICHA VIGENTE (não a da época) — as
-- variâncias históricas são aproximação. O objetivo do P0 é o ledger existir e
-- os novos registros nascerem corretos via trigger; usar
-- technical_sheet_snapshots como fonte histórica é evolução futura.
-- Falha individual vira WARNING (não aborta o lote). OPs Reservado/Em Produção
-- ficam de fora — o trigger registra quando finalizarem.

DO $$
DECLARE
  v RECORD;
  v_ok integer := 0;
  v_err integer := 0;
BEGIN
  FOR v IN
    SELECT o.id FROM public.orders o
     WHERE o.status = 'Finalizado'
       AND NOT EXISTS (
         SELECT 1 FROM public.production_consumptions pc
          WHERE pc.order_id = o.id AND pc.superseded_at IS NULL)
     ORDER BY o.created_at
  LOOP
    BEGIN
      PERFORM public.record_order_consumption(v.id, 'backfill retroativo (ficha vigente em 2026-07-03)');
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE WARNING 'backfill consumo falhou para OP %: %', v.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'backfill consumo: % OPs registradas, % falhas', v_ok, v_err;
END $$;
