-- P0.3 — OS nunca mais nasce órfã + arquivamento ortogonal à máquina de estados.
--
-- (1) archived_at: coluna de soft-archive pra triagem das OS legadas. NÃO usar
--     um status 'Arquivada': normalizeOsStatus (osStatusMachine.ts) mapeia
--     grafia desconhecida para PENDENTE — uma OS "Arquivada" voltaria a contar
--     em filtro/trigger que usa as listas de status (incl. bloqueio de Montagem).
-- (2) Guard BEFORE INSERT: OS não-avulsa precisa nascer com ALGUM vínculo
--     (source_sale_order_id do fluxo integrado, sale_order_id/linked legados ou
--     order_id de OP). Só INSERT — não pune UPDATE de linha legada (o backfill e
--     a triagem fazem UPDATE nessas linhas).

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.service_orders.archived_at IS
  'Soft-archive da triagem de OS órfãs (P0.3, 2026-07). Preenchida = fora das listagens default; história preservada. Ortogonal ao status de propósito (status desconhecido normaliza pra Pendente no app).';

CREATE INDEX IF NOT EXISTS idx_service_orders_archived
  ON public.service_orders (archived_at) WHERE archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_service_order_orphan_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF COALESCE(NEW.is_avulsa, false) = false
     AND NEW.source_sale_order_id IS NULL
     AND NEW.sale_order_id IS NULL
     AND NEW.order_id IS NULL
     AND COALESCE(cardinality(NEW.linked_sale_order_ids), 0) = 0 THEN
    RAISE EXCEPTION 'OS precisa de vínculo com um PV ou OP — ou ser marcada como avulsa (is_avulsa).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_service_order_orphan_guard ON public.service_orders;
CREATE TRIGGER trg_service_order_orphan_guard
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_orphan_guard();
