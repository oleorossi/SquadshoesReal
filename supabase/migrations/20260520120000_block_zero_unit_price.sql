-- Bloqueia INSERT/UPDATE de sale_order_items com unit_price <= 0.
--
-- Motivação (2026-05-20): PV-00122 saiu com CF 07 PRETO em R$ 0,00 (12 pares
-- sem preço unitário). O total do PV ficou R$ 442,80 abaixo do esperado e o
-- user só percebeu olhando manualmente. Defesa em profundidade:
--   1. Frontend já valida (issues type='error') no submit
--   2. Este trigger bloqueia no DB pra cobrir API direta, edição via dashboard, etc
--
-- Permite preço zero apenas em PVs com status terminal (Cancelado/Faturado)
-- pra não bloquear histórico legado (PV-00108 SP117 OURO LIGHT já faturado
-- com preço 0 ficou — não tocamos).

CREATE OR REPLACE FUNCTION public.tg_block_zero_unit_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.unit_price IS NULL OR NEW.unit_price <= 0 THEN
    -- Verifica status do PV — se for terminal (Cancelado/Faturado), permite
    -- (pode ser ajuste contábil/legacy). Caso contrário, rejeita.
    SELECT status INTO v_status FROM public.sale_orders WHERE id = NEW.sale_order_id;
    IF v_status IS NULL OR v_status NOT IN ('Cancelado', 'Faturado', 'Finalizado s/ NF') THEN
      RAISE EXCEPTION 'Pre%co unit%ario nao pode ser zero ou negativo (item de PV ativo)',
        chr(231), chr(225)
        USING HINT = 'Atualize unit_price antes de salvar. Itens de cortesia/brinde devem usar preco minimo (ex: R$ 0,01) ou criar PV separado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_zero_unit_price ON public.sale_order_items;

CREATE TRIGGER trg_block_zero_unit_price
  BEFORE INSERT OR UPDATE OF unit_price, sale_order_id
  ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_zero_unit_price();

COMMENT ON FUNCTION public.tg_block_zero_unit_price IS
  'Rejeita unit_price <= 0 em PVs ativos. PVs terminais (Cancelado/Faturado) passam pra preservar legado.';
