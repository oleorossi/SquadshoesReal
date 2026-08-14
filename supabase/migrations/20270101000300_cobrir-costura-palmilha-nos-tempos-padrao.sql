-- Costura Palmilha: chave explícita para o gerador de BOM
--
-- O relatório de capacidade entendia o padrão legado `Costura`, mas
-- generate_bom_operations consulta o nome literal da operação. Com o setor
-- separado em Costura Palmilha e Costura Cabedal, 47 operações de palmilha
-- permaneciam `pendente` e zeravam a mão de obra no custo. A referência de
-- tempo é a mesma linha Costura já vigente em cada categoria.

DO $migration$
DECLARE
  v_created integer;
BEGIN
  INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
  SELECT shoe_category, 'Costura Palmilha', minutes_per_pair
    FROM public.sector_minutes_default
   WHERE sector = 'Costura'
  ON CONFLICT (shoe_category, sector) DO UPDATE
    SET minutes_per_pair = EXCLUDED.minutes_per_pair;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  IF v_created = 0 THEN
    RAISE EXCEPTION 'Nenhum padrão Costura encontrado para cobrir Costura Palmilha; revise a migration antes de aplicar.';
  END IF;
END;
$migration$;

