-- P0.2 / C1 — semântica fina de movimentação SEM re-tipar movement_type.
--
-- stock_movements só tinha 'in'/'out' — impossível separar consumo de OP de
-- ajuste de inventário ou compra nos relatórios. Re-tipar movement_type
-- quebraria ~30 leitores SQL e ~10 TS que filtram ='out' literal (restore_*,
-- resync_op_atomic, generate_bloco_k, KPIs, StockHistory...). A semântica vai
-- em coluna NOVA `movement_reason`, preenchida por trigger BEFORE INSERT com a
-- MESMA função usada no backfill — writers existentes não mudam nada.
--
-- Padrões validados contra o dado real (SELECT DISTINCT description em 03/07):
--   out: 'Debito BOM/Tira/Solado por grade', 'Baixa automática de componente',
--        'Conversão Palmilha/Forração/Cabedal/BOM/Item padrão', 'Embalagem OP',
--        'Consumo de reserva', 'Ajuste manual — .'
--   in:  'Estorno automático - …', 'Entrada via NF …', 'Ajuste manual …'

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS movement_reason text
  CHECK (movement_reason IS NULL OR movement_reason IN
         ('consumo_op','ajuste','compra','devolucao','estorno'));

COMMENT ON COLUMN public.stock_movements.movement_reason IS
  'Semântica fina do movimento (P0.2): consumo_op (débito/conversão ligado a produção) | compra (entrada NF/PO) | estorno (reversão automática) | devolucao | ajuste (manual/inventário). movement_type continua sendo o eixo binário in/out usado pelos motores.';

CREATE INDEX IF NOT EXISTS idx_stock_movements_reason
  ON public.stock_movements (movement_reason) WHERE movement_reason IS NOT NULL;

-- Função classificadora única (backfill + trigger). A regra por description vem
-- ANTES do order_id: resync_op_atomic detacha os 'out' antigos (order_id=NULL)
-- mas eles continuam sendo consumo de produção.
CREATE OR REPLACE FUNCTION public.classify_movement_reason(
  p_type text, p_description text, p_order_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type = 'out' THEN
      CASE
        WHEN COALESCE(p_description,'') ~* '^(debito|débito|baixa|convers|consumo|embalagem)' THEN 'consumo_op'
        WHEN p_order_id IS NOT NULL THEN 'consumo_op'
        ELSE 'ajuste'
      END
    WHEN p_type = 'in' THEN
      CASE
        WHEN COALESCE(p_description,'') ~* 'estorno'                                  THEN 'estorno'
        WHEN COALESCE(p_description,'') ~* 'devolu'                                   THEN 'devolucao'
        WHEN COALESCE(p_description,'') ~* '(entrada via nf|compra|recebimento|pedido de compra)' THEN 'compra'
        ELSE 'ajuste'
      END
    ELSE 'ajuste'
  END;
$$;

-- Backfill do histórico
UPDATE public.stock_movements
   SET movement_reason = public.classify_movement_reason(movement_type, description, order_id)
 WHERE movement_reason IS NULL;

-- Novos registros nascem classificados (writers existentes intocados; um writer
-- futuro pode setar movement_reason explicitamente que o trigger respeita).
CREATE OR REPLACE FUNCTION public.tg_stock_movements_fill_reason()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.movement_reason IS NULL THEN
    NEW.movement_reason := public.classify_movement_reason(NEW.movement_type, NEW.description, NEW.order_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stock_movements_fill_reason ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_fill_reason
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_fill_reason();
